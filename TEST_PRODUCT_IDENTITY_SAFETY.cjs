'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');

function ask(question) {
  return createAnswer({ question, history: [], knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });
}

for (const question of [
  '??? koromvirag balzsam mirevalo pls',
  'levendulas balzsam ara',
  'csodabogyos sampon',
  'erdei harmat szappan hasznalata',
  'aranyfeny krem'
]) {
  const result = ask(question);
  assert.ok(['clarification', 'hard_fallback'].includes(result.route), question);
  assert.equal(result.targetProductId, undefined, question);
  assert.deepEqual(result.routing.matchedCanonicalIds, [], question);
  assert.deepEqual(result.routing.matchedProductIds, [], question);
  assert.deepEqual(result.links, [], question);
}

for (const [question, productId] of [
  ['Dermavital sampon', 'dermavital_sampon'],
  ['!!! Shea vajas szappan ???', 'shea_vajas_szappan'],
  ['Holt tengeri so balzsam', 'holt_tengeri_so_balzsam'],
  ['kerlek, a Psorivital csomagrol meselj', 'psorivital_csomag'],
  ['Rozmaringos samponszappan', 'rozmaringos_samponszappan']
]) {
  const result = ask(question);
  assert.equal(result.route, 'exact_product', question);
  assert.ok(result.routing.matchedProductIds.includes(productId), question);
}

for (const question of ['Dermavital', 'Derma Vital']) {
  const result = ask(question);
  assert.equal(result.route, 'clarification', question);
  assert.equal(result.targetProductId, undefined, question);
  assert.ok(result.routing.matchedProductIds.length > 1, question);
  assert.deepEqual(result.links.map((item) => item.id), result.routing.matchedProductIds, question);
}

const recommendation = ask('milyen balzsamot ajanlasz');
assert.equal(recommendation.route, 'product_category');

console.log('PRODUCT_IDENTITY_SAFETY_OK');
