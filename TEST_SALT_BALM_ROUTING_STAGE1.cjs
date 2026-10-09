'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { normalize } = require('./engine/normalizer.cjs');
const { findProductInText } = require('./engine/product-faq.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');
const legacyAnswer = 'Ápol. Az elhalt hámréteget távolítja el, megerősíti az új réteget.';

function ask(question) {
  return createAnswer({
    question,
    history: [],
    conversationState: structuredState([]),
    knowledge,
    ruleEngine,
    logGap() {},
    logDiagnostic() {}
  });
}

for (const question of [
  'Holt tengeri sóbalzsam',
  'Holt-tengeri sóbalzsam',
  'Holt-tengeri só balzsam',
  'Holt tengeri só balzsam'
]) {
  assert.equal(findProductInText(normalize(question)), 'holt_tengeri_so_balzsam', question);
  const result = ask(question);
  assert.equal(result.route, 'exact_product', question);
  assert.deepEqual(result.routing.matchedCanonicalIds, ['holt_tengeri_so_balzsam'], question);
  assert.deepEqual(result.links.map((item) => item.id), ['holt_tengeri_so_balzsam'], question);
  assert.notEqual(result.responseSource, 'knowledge-fallback', question);
  assert.notEqual(result.answer, legacyAnswer, question);
}

const detail = ask('Holt tengeri sóbalzsam');
assert.equal(detail.intent, 'product-detail');
assert.match(detail.answer, /Holt-tengeri só balzsam/i);

const benefit = ask('Mire jó a Holt tengeri sóbalzsam?');
assert.equal(benefit.route, 'exact_product');
assert.equal(benefit.targetProductId, 'holt_tengeri_so_balzsam');
assert.equal(benefit.answerIntent, 'product_benefits');
assert.notEqual(benefit.responseSource, 'knowledge-fallback');
assert.notEqual(benefit.answer, legacyAnswer);

const usage = ask('Hogy kell használni a Holt tengeri sóbalzsam?');
assert.equal(usage.route, 'exact_product');
assert.equal(usage.targetProductId, 'holt_tengeri_so_balzsam');
assert.equal(usage.answerIntent, 'usage');
assert.equal(usage.groundingStatus, 'grounded');
assert.match(usage.answer, /Vigyél fel egy vékony réteget/);

const ingredients = ask('Miből készül a Holt tengeri sóbalzsam?');
assert.equal(ingredients.route, 'exact_product');
assert.equal(ingredients.targetProductId, 'holt_tengeri_so_balzsam');
assert.equal(ingredients.answerIntent, 'ingredients');
assert.equal(ingredients.groundingStatus, 'unavailable');
assert.notEqual(ingredients.responseSource, 'knowledge-fallback');
assert.doesNotMatch(ingredients.answer, /elhalt hámréteget/i);

assert.equal(findProductInText(normalize('Sóbalzsam')), null);
assert.equal(findProductInText(normalize('Parajdi sótömb')), 'parajdi_sotomb');
assert.equal(findProductInText(normalize('Tengeri sószappan')), 'tengeri_soszappan');
assert.equal(findProductInText(normalize('Parajdi fürdősó natúr')), null);
assert.equal(findProductInText(normalize('Fürdősó')), null);

for (const [question, productId] of [
  ['Dermavital sampon', 'dermavital_sampon'],
  ['Parajdi sótömb', 'parajdi_sotomb'],
  ['Tengeri sószappan', 'tengeri_soszappan']
]) {
  const result = ask(question);
  assert.equal(result.route, 'exact_product', question);
  assert.deepEqual(result.routing.matchedCanonicalIds, [productId], question);
}

const unrelatedKnowledge = ask('Pikkelyesömöre használ?');
assert.equal(unrelatedKnowledge.route, 'knowledge');
assert.equal(unrelatedKnowledge.responseSource, 'knowledge-fallback');
assert.equal(unrelatedKnowledge.answer, 'Rendszeresen rendelik pikkelysömörös problémával.');

console.log('SALT_BALM_ROUTING_STAGE1_OK');
