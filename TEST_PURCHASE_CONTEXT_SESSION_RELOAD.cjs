'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');

const restoreCatalogFixture = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restoreCatalogFixture);

const { createAnswer } = require('./engine/answer-service.cjs');
const { rehydrateSessionHistory } = require('./engine/conversation-memory.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const knowledge = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'knowledge.json'), 'utf8'));
const ruleEngine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
const SESSION_A = 'session-reload-proof-a';
const SESSION_B = 'session-reload-proof-b';
const card = (id, name) => ({ id, name });
const answer = (question, memory) => createAnswer({ question, history: memory.history, conversationState: memory.state, knowledge, ruleEngine, logGap() {} });
const assistant = (result) => ({ role: 'assistant', content: result.answer, route: result.route, intent: result.intent, links: result.links });
const reload = (sessionId, clientHistory, rowsBySession = {}) => rehydrateSessionHistory({ sessionId, clientHistory, loadRows: async (id) => rowsBySession[id] || [] });
const twoProducts = () => [
  { role: 'user', content: 'Melyiket ajánlod?' },
  { role: 'assistant', content: '1. Dermavital krém. 2. Kecsketejes testápoló.', route: 'comparison', intent: 'compare_products', links: [card('dermavital_krem', 'Dermavital krém'), card('kecsketejes_testapolo', 'Kecsketejes testápoló')] }
];

(async () => {
  // 1. Explicit termékfókusz reload után.
  let history = [
    { role: 'user', content: 'A Dermavital krémet szeretném.' },
    { role: 'assistant', content: 'A Dermavital krém az érintett termék.', route: 'exact_product', intent: 'product_detail', links: [card('dermavital_krem', 'Dermavital krém')] }
  ];
  let memory = await reload(SESSION_A, history);
  let result = answer('Ezt akarom megrendelni.', memory);
  assert.equal(result.contextTarget, 'dermavital_krem');
  assert.equal(memory.state.productContextStatus, 'resolved');

  // 2. Purchase intent és target reload után checkoutnál is megmarad.
  history = [
    { role: 'user', content: 'A Holt-tengeri só balzsamot kérem.' },
    { role: 'assistant', content: 'A Holt-tengeri só balzsam az érintett termék.', route: 'commerce', intent: 'order_start', links: [card('holt_tengeri_so_balzsam', 'Holt-tengeri só balzsam')] }
  ];
  memory = await reload(SESSION_A, history);
  result = answer('Ezt veszem.', memory);
  history.push({ role: 'user', content: 'Ezt veszem.' }, assistant(result));
  memory = await reload(SESSION_A, history);
  result = answer('Nem enged tovább.', memory);
  assert.equal(result.intent, 'checkout_problem');
  assert.equal(result.contextTarget, 'holt_tengeri_so_balzsam');

  // 3. Strukturált ordinális product ID reload után is rekonstruálható.
  history = twoProducts();
  memory = await reload(SESSION_A, history);
  result = answer('A másodikat kérem.', memory);
  history.push({ role: 'user', content: 'A másodikat kérem.' }, assistant(result));
  memory = await reload(SESSION_A, history);
  assert.equal(memory.state.purchaseProductId, 'kecsketejes_testapolo');
  result = answer('Ezt szeretném megvenni.', memory);
  assert.equal(result.contextTarget, 'kecsketejes_testapolo');

  // 4. Kiválasztás nélküli többtermékes state reload után is ambiguous.
  memory = await reload(SESSION_A, twoProducts());
  assert.equal(memory.state.productContextStatus, 'ambiguous');
  result = answer('Csak ezt kérem.', memory);
  assert.equal(result.route, 'clarification');
  assert.equal(result.contextTarget, 'product');

  // 5. Új session nem örökli a korábbi session explicit fókuszát.
  const rowsBySession = {
    [SESSION_A]: [{ created_at: '2026-08-24T10:00:00Z', question: 'A Dermavital krémet szeretném.', answer: 'A Dermavital krém az érintett termék.' }]
  };
  memory = await reload(SESSION_B, [], rowsBySession);
  assert.equal(memory.state.purchaseProductId, null);
  result = answer('Ezt szeretném megvenni.', memory);
  assert.equal(result.contextTarget, null);
  assert.equal(result.route, 'commerce');
  assert.equal(result.intent, 'order_start');
  assert.equal(result.responseStrategy, 'clarify_product');
  assert.match(result.answer, /Melyik termékre gondolsz/i);

  // 6. Új session nem örököl régi ordinális listát sem.
  memory = await reload(SESSION_B, [], { [SESSION_A]: [] });
  assert.deepEqual(memory.state.lastOrdinalProductList, []);
  result = answer('A másodikat kérem.', memory);
  assert.equal(result.route, 'clarification');
  assert.equal(result.contextTarget, 'product');

  // 7. Reload után egy új explicit termék felülírja a korábbi targetet.
  history = [
    { role: 'user', content: 'A Holt-tengeri só balzsamot kérem.' },
    { role: 'assistant', content: 'A Holt-tengeri só balzsam az érintett termék.', links: [card('holt_tengeri_so_balzsam', 'Holt-tengeri só balzsam')] }
  ];
  memory = await reload(SESSION_A, history);
  result = answer('Inkább a Dermavital krémet szeretném.', memory);
  assert.equal(result.contextTarget, 'dermavital_krem');

  // 8. A 20 üzenetes ablakból kieső bizonyíték nem rekonstruálható.
  history = [
    { role: 'user', content: 'A Dermavital krémet szeretném.' },
    { role: 'assistant', content: 'A Dermavital krém az érintett termék.', links: [card('dermavital_krem', 'Dermavital krém')] }
  ];
  for (let index = 0; index < 10; index += 1) history.push(
    { role: 'user', content: `Általános kérdés ${index + 1}.` },
    { role: 'assistant', content: `Általános válasz ${index + 1}.` }
  );
  memory = await reload(SESSION_A, history);
  assert.equal(memory.history.length, 20);
  assert.equal(memory.state.purchaseProductId, null);
  result = answer('Ezt szeretném megvenni.', memory);
  assert.equal(result.contextTarget, null);

  const widget = fs.readFileSync(path.join(__dirname, 'public', 'widget.js'), 'utf8');
  assert.match(widget, /history\.push\([\s\S]*?links:\s*Array\.isArray\(options\.links\)/);
  assert.match(widget, /sessionId\s*=\s*state\.sessionId/);
  assert.match(widget, /sessionId\s*=\s*createSessionId\(\)/);

  restoreCatalogFixture();
  console.log('Purchase session reload/isolation regressions: PASS (8/8)');
})().catch((error) => {
  restoreCatalogFixture();
  console.error(error);
  process.exitCode = 1;
});
