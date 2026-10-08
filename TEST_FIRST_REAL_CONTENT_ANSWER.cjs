'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { createProductFactsResolver } = require('./engine/product-facts.cjs');
const { createAnswer } = require('./engine/answer-service.cjs');

const firstSentence = 'Nedvesítsd be a szappant, habosítsd fel a kezedben vagy közvetlenül a bőrön, majd alaposan öblítsd le.';
const fullUsage = `${firstSentence} Mindennapi használatra alkalmas arcra és testre egyaránt. Ha intenzívebb ápolást keresel, fedezd fel a Holt-tengeri só balzsamot is.`;
const mappingData = { mappings: [{
  canonicalId: 'dermavital_szappan', unasId: '1462570616', sku: 'VDVSZ',
  mappingStatus: 'approved', approvedAt: '2026-07-21T11:11:31+02:00'
}] };
const product = {
  unasId: '1462570616', sku: 'VDVSZ', name: 'Dermavital szappan',
  longDescription: `Mit tapasztalhatsz rendszeres használat mellett? frissebb bőrérzet Hogyan használd? ${fullUsage} Összetevők: Sodium Cocoate`,
  actualPriceGross: 2700, currency: 'HUF', url: 'https://www.vitalis-szappan.hu/vitalis-dermavital-szappan'
};
const snapshotData = { generatedAt: '2026-10-04T08:34:54.731Z', products: [product] };
const options = { mappingData, snapshotData, deterministicProducts: {}, approvedFactData: { facts: [] } };

const resolver = createProductFactsResolver(options);
const fact = resolver.getFact('dermavital_szappan', 'usageInstructions');
assert.equal(fact.status, 'grounded');
assert.equal(fact.value, fullUsage);
assert.deepEqual(fact.provenance, [{
  sourceType: 'unas_snapshot', sourceId: 'unas:1462570616', productId: 'dermavital_szappan',
  groundingStatus: 'grounded', approved: true, sourceUpdatedAt: snapshotData.generatedAt
}]);

const withoutUsage = createProductFactsResolver({
  ...options, snapshotData: { ...snapshotData, products: [{ ...product, longDescription: 'Összetevők: Sodium Cocoate' }] }
});
assert.equal(withoutUsage.getFact('dermavital_szappan', 'usageInstructions').status, 'unavailable');

const unrelated = createProductFactsResolver({
  ...options,
  mappingData: { mappings: [...mappingData.mappings, {
    canonicalId: 'other_product', unasId: 'other-1', sku: 'OTHER', mappingStatus: 'approved'
  }] },
  snapshotData: { ...snapshotData, products: [product, {
    unasId: 'other-1', sku: 'OTHER', longDescription: 'Hogyan használd? Idegen használati tartalom.'
  }] }
});
assert.equal(unrelated.getFact('dermavital_szappan', 'usageInstructions').value, fullUsage);
assert.equal(unrelated.getFact('other_product', 'usageInstructions').value, 'Idegen használati tartalom.');

for (const malformed of [null, '', 'rendszeres használat mellett']) {
  const safe = createProductFactsResolver({
    ...options, snapshotData: { ...snapshotData, products: [{ ...product, longDescription: malformed }] }
  });
  assert.equal(safe.getFact('dermavital_szappan', 'usageInstructions').status, 'unavailable');
}

const answer = createAnswer({
  question: 'Hogyan használjam a Dermavital szappant?', history: [], knowledge: [],
  ruleEngine: new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json')),
  logGap: () => {}, conversationState: null, logDiagnostic: () => {}
});
assert.equal(answer.route, 'exact_product');
assert.equal(answer.intent, 'usage');
assert.equal(answer.targetProductId, 'dermavital_szappan');
assert.equal(answer.groundingStatus, 'grounded');
assert.equal(answer.answer, fullUsage);
assert.equal(answer.factsUsed[0].provenance[0].sourceType, 'unas_snapshot');
assert.equal(answer.factsUsed[0].provenance[0].sourceId, 'unas:1462570616');

for (const [question, productId, intent, factType] of [
  ['Mi ez a Dermavital sampon?', 'dermavital_sampon', 'product_description', 'productDescription'],
  ['Mire való a Dermavital sampon?', 'dermavital_sampon', 'product_description', 'productDescription'],
  ['Mit tud a Dermavital szappan?', 'dermavital_szappan', 'product_description', 'productDescription'],
  ['Kinek ajánlott a Dermavital szappan?', 'dermavital_szappan', 'product_suitability', 'recommendedFor']
]) {
  const result = createAnswer({
    question, history: [], knowledge: [],
    ruleEngine: new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json')),
    logGap: () => {}, conversationState: null, logDiagnostic: () => {}
  });
  assert.equal(result.targetProductId, productId, question);
  assert.equal(result.answerIntent, intent, question);
  assert.equal(result.factsUsed[0].factType, factType, question);
  assert.equal(result.factsUsed[0].provenance[0].sourceType, 'unas_snapshot', question);
  assert.doesNotMatch(result.answer, /Hogyan használd|INCI|Ingredients|Összetevők|Fontos tudnivaló/i, question);
  if (productId === 'dermavital_sampon' && intent === 'product_description') {
    assert.doesNotMatch(result.answer, /Kíméletes tisztítás, tudatos összetétel|nem az erős tisztító hatásra épül/i, question);
    assert.match(result.answer, /fejlesztettük|mindennapi ápolás|kíméletes/i, question);
  }
  if (intent === 'product_suitability') assert.doesNotMatch(result.answer, /csodát ígérni|nem gyógyszer|nem helyettesíti/i, question);
}


const shampooSuitabilityAnswer = createAnswer({
  question: 'Kinek ajánlott a Dermavital sampon?', history: [], knowledge: [],
  ruleEngine: new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json')),
  logGap: () => {}, conversationState: null, logDiagnostic: () => {}
});
assert.equal(shampooSuitabilityAnswer.answerIntent, 'product_suitability');
assert.equal(shampooSuitabilityAnswer.factsUsed[0].factType, 'recommendedFor');
assert.match(shampooSuitabilityAnswer.answer, /mindennapi ápolásához keresnek kíméletes kozmetikumot\.$/);
assert.doesNotMatch(shampooSuitabilityAnswer.answer, /csodát ígérni|nem gyógyszer|nem helyettesíti/i);

const exclusionAnswer = createAnswer({
  question: 'Tartalmaznak SLS-t vagy SLES-t a termékek?', history: [], knowledge: [],
  ruleEngine: new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json')),
  logGap: () => {}, conversationState: null, logDiagnostic: () => {}
});
assert.equal(exclusionAnswer.route, 'expert_rule');
assert.equal(exclusionAnswer.intent, 'ingredient-question');
assert.match(exclusionAnswer.answer, /nem tartalmaznak SLS-t vagy SLES-t/i);

for (const question of [
  'Ez meggyógyítja az ekcémát?',
  'Kiválthatom vele az orvos által felírt gyógyszert?',
  'Abbahagyhatom a gyógyszeremet?'
]) {
  const safety = createAnswer({
    question, history: [], knowledge: [],
    ruleEngine: new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json')),
    logGap: () => {}, conversationState: null, logDiagnostic: () => {}
  });
  assert.equal(safety.route, 'safety', question);
  assert.equal(safety.safetyClass, 'medical_escalation', question);
  assert.match(safety.answer, /orvosi segítséget|sürgős ellátás/i, question);
}

console.log('FIRST_REAL_CONTENT_ANSWER_OK');
