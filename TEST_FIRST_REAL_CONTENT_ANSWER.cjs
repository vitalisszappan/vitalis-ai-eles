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

console.log('FIRST_REAL_CONTENT_ANSWER_OK');
