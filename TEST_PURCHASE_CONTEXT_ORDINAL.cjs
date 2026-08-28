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
const card = (id, name) => ({ id, name });
const assistant = (result) => ({ role: 'assistant', content: result.answer, route: result.route, intent: result.intent, links: result.links });
const twoProducts = () => [
  { role: 'user', content: 'Melyiket ajánlod?' },
  { role: 'assistant', content: '1. Dermavital krém. 2. Kecsketejes testápoló.', route: 'comparison', intent: 'compare_products', links: [card('dermavital_krem', 'Dermavital krém'), card('kecsketejes_testapolo', 'Kecsketejes testápoló')] }
];
const threeProducts = () => [
  { role: 'user', content: 'Mutass három lehetőséget.' },
  { role: 'assistant', content: '1. Dermavital krém. 2. Kecsketejes testápoló. 3. Holt-tengeri só balzsam.', route: 'comparison', intent: 'compare_products', links: [card('dermavital_krem', 'Dermavital krém'), card('kecsketejes_testapolo', 'Kecsketejes testápoló'), card('holt_tengeri_so_balzsam', 'Holt-tengeri só balzsam')] }
];
const expectResolved = (question, history, productId) => {
  const result = ask(question, history);
  assert.equal(result.route, 'commerce', question);
  assert.equal(result.intent, 'order_start', question);
  assert.equal(result.contextTarget, productId, question);
  return result;
};
const expectClarification = (question, history) => {
  const result = ask(question, history);
  assert.equal(result.route, 'clarification', question);
  assert.equal(result.intent, 'order_start', question);
  assert.equal(result.contextTarget, 'product', question);
  assert.match(result.answer, /Melyik termékre gondolsz/i, question);
};

// 1.
let history = twoProducts();
let result = expectResolved('A másodikat kérem.', history, 'kecsketejes_testapolo');

// 2.
history.push({ role: 'user', content: 'A másodikat kérem.' }, assistant(result));
result = ask('Nem enged tovább.', history);
assert.equal(result.intent, 'checkout_problem');
assert.equal(result.contextTarget, 'kecsketejes_testapolo');

// 3.
expectResolved('Az elsőt venném meg.', twoProducts(), 'dermavital_krem');

// 4. A korábbi explicit kiválasztás teszi egyértelművé a „másikat”.
history = twoProducts();
history.push({ role: 'user', content: 'Az elsőt kérem.' }, { role: 'assistant', content: 'Rendben.', route: 'commerce', intent: 'order_start', links: [] });
expectResolved('Inkább a másikat.', history, 'kecsketejes_testapolo');

// 5.
expectClarification('Inkább a másikat.', threeProducts());

// 6.
expectResolved('A harmadikat kérem.', threeProducts(), 'holt_tengeri_so_balzsam');

// 7.
history = [{ role: 'assistant', content: 'Dermavital krém.', links: [card('dermavital_krem', 'Dermavital krém')] }];
expectClarification('A másodikat kérem.', history);

// 8.
expectResolved('Az utóbbit kérem.', twoProducts(), 'kecsketejes_testapolo');

// 9.
expectResolved('Az előbbit kérem.', twoProducts(), 'dermavital_krem');

// 10. A frissebb explicit fókusz felülírja a régi listát.
history = twoProducts();
history.push(
  { role: 'user', content: 'A Holt-tengeri só balzsamot szeretném.' },
  { role: 'assistant', content: 'A Holt-tengeri só balzsam az érintett termék.', route: 'exact_product', intent: 'product_detail', links: [card('holt_tengeri_so_balzsam', 'Holt-tengeri só balzsam')] }
);
expectResolved('Ezt kérem.', history, 'holt_tengeri_so_balzsam');

restoreCatalogFixture();
console.log('Ordinal/relative purchase context regressions: PASS (10/10)');
