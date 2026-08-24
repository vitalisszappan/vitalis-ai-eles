'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');

const restoreCatalogFixture = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restoreCatalogFixture);

const { createAnswer } = require('./engine/answer-service.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const knowledge = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'knowledge.json'), 'utf8'));
const ruleEngine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
const ask = (question, history) => createAnswer({ question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {} });
const assistant = (result) => ({ role: 'assistant', content: result.answer, route: result.route, intent: result.intent, links: result.links });

// 1. Egyetlen konkrét ajánlásra az „ezt” visszamutat.
let history = [
  { role: 'user', content: 'Melyik krémet ajánlod problémás bőrre?' },
  { role: 'assistant', content: 'A Dermavital krémet ajánlom.', route: 'expert_rule', intent: 'product_recommendation', links: [{ id: 'dermavital_krem', name: 'Dermavital krém' }] }
];
let result = ask('Csak ezt kérem.', history);
assert.equal(result.route, 'commerce');
assert.equal(result.intent, 'order_start');
assert.equal(result.contextTarget, 'dermavital_krem');
assert.deepEqual(result.links.map((item) => item.id), ['dermavital_krem']);

// 2. Explicit termék marad aktív a „nem kell más” lezárásnál.
history = [
  { role: 'user', content: 'A Holt-tengeri só balzsamot szeretném.' },
  { role: 'assistant', content: 'A Holt-tengeri só balzsam az érintett termék.', route: 'exact_product', intent: 'product_detail', links: [{ id: 'holt_tengeri_so_balzsam', name: 'Holt-tengeri só balzsam' }] }
];
result = ask('Nem kell más.', history);
assert.equal(result.intent, 'order_start');
assert.equal(result.contextTarget, 'holt_tengeri_so_balzsam');

// 3. A checkout-probléma megőrzi a korábbi purchase targetet.
history = [
  { role: 'user', content: 'A Dermavital krémet szeretném.' },
  { role: 'assistant', content: 'A Dermavital krém az érintett termék.', route: 'exact_product', intent: 'product_detail', links: [{ id: 'dermavital_krem', name: 'Dermavital krém' }] }
];
result = ask('Ezt akarom megrendelni.', history);
history.push({ role: 'user', content: 'Ezt akarom megrendelni.' }, assistant(result));
result = ask('Nem enged tovább.', history);
assert.equal(result.intent, 'checkout_problem');
assert.equal(result.contextTarget, 'dermavital_krem');
assert.deepEqual(result.links.map((item) => item.id), ['dermavital_krem']);

// 4. Több bemutatott termékből az „ezt” nem választja ki önkényesen.
history = [
  { role: 'user', content: 'A Dermavital krém és a kecsketejes testápoló közül melyiket ajánlod?' },
  { role: 'assistant', content: 'Mindkettő szóba jöhet.', route: 'comparison', intent: 'compare_products', links: [
    { id: 'dermavital_krem', name: 'Dermavital krém' },
    { id: 'kecsketejes_testapolo', name: 'Kecsketejes testápoló' }
  ] }
];
result = ask('Csak ezt kérem.', history);
assert.equal(result.route, 'clarification');
assert.equal(result.intent, 'order_start');
assert.match(result.answer, /Melyik termékre gondolsz/i);
assert.equal(result.contextTarget, 'product');

// 5. Egy új explicit termék felülírja a régi fókuszt.
history = [
  { role: 'user', content: 'A Holt-tengeri só balzsam érdekel.' },
  { role: 'assistant', content: 'A Holt-tengeri só balzsam az érintett termék.', route: 'exact_product', intent: 'product_detail', links: [{ id: 'holt_tengeri_so_balzsam', name: 'Holt-tengeri só balzsam' }] }
];
result = ask('Inkább a Dermavital krémet kérem.', history);
assert.equal(result.route, 'commerce');
assert.equal(result.intent, 'order_start');
assert.equal(result.contextTarget, 'dermavital_krem');

restoreCatalogFixture();
console.log('Multi-turn purchase context regressions: PASS (5/5)');
