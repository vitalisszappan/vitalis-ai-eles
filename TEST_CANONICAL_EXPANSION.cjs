'use strict';

const assert = require('assert');
const path = require('path');
const { normalize } = require('./engine/normalizer.cjs');
const { PRODUCTS } = require('./engine/product-catalog.cjs');
const { findProductsInText } = require('./engine/product-faq.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { createAnswer } = require('./engine/answer-service.cjs');
const mapping = require('./data/canonical-unas-mapping.json');

const EXPECTED_NEW_MAPPINGS = Object.freeze({
  natur_kecsketejes_szappan: ['1241472589', 'Vksz03'],
  kecsketejes_levendulas_szappan: ['1241471919', 'Vksz02'],
  oliva_szappan: ['111374990', 'Vsz008'],
  teafa_szappan: ['111374987', 'Vsz005'],
  parajdi_sotomb: ['111374965', 'PSSZ01']
});

const PREVIOUS_APPROVED = Object.freeze({
  dermavital_sampon: ['1553769891', 'Vitdermsamp01'],
  rozmaringos_samponszappan: ['1467825966', 'Vssz02'],
  dermavital_krem: ['1412837511', 'VDVK100'],
  dermavital_szappan: ['1462570616', 'VDVSZ'],
  psorivital_csomag: ['1120057029', 'CS001'],
  holt_tengeri_so_balzsam: ['163833663', 'VEM02'],
  holt_tengeri_iszapos_szappan: ['111374989', 'Vsz007'],
  katrany_szappan: ['111374984', 'VSZ002'],
  shea_vajas_szappan: ['111374997', 'Vsz016']
});

function recognized(text) {
  return findProductsInText(normalize(text));
}

const recognitionCases = [
  ['Natúr kecsketejes szappan', 'natur_kecsketejes_szappan'],
  ['natur kecsketejes szappan', 'natur_kecsketejes_szappan'],
  ['illatmentes kecsketejes szappan', 'natur_kecsketejes_szappan'],
  ['kecsketejes szappan natur', 'natur_kecsketejes_szappan'],
  ['Kecsketejes levendulás szappan', 'kecsketejes_levendulas_szappan'],
  ['kecsketejes levendulas szappan', 'kecsketejes_levendulas_szappan'],
  ['levendulás kecsketejes szappan', 'kecsketejes_levendulas_szappan'],
  ['kecsketejes levendula szappan', 'kecsketejes_levendulas_szappan'],
  ['Olíva kézműves szappan', 'oliva_szappan'],
  ['oliva szappan', 'oliva_szappan'],
  ['Teafa szappan', 'teafa_szappan'],
  ['teafas szappan', 'teafa_szappan'],
  ['teafaolajos szappan', 'teafa_szappan'],
  ['Parajdi sótömb', 'parajdi_sotomb'],
  ['parajdi sotomb', 'parajdi_sotomb'],
  ['Parajdi sószappan', 'parajdi_sotomb']
];

for (const [text, expected] of recognitionCases) {
  assert.deepStrictEqual(recognized(text), [expected], `Hibás aliasfelismerés: ${text}`);
}

assert.deepStrictEqual(recognized('Samponszappan – Teafa & Aktív szén 110 g'), []);
assert.deepStrictEqual(recognized('Sószappan 120 g'), []);
assert.equal(PRODUCTS.parajdi_sotomb.description.includes('nem tisztító'), true);
assert.equal(Object.hasOwn(PRODUCTS, 'soszappan'), false);

for (const [canonicalId, [unasId, sku]] of Object.entries({ ...PREVIOUS_APPROVED, ...EXPECTED_NEW_MAPPINGS })) {
  const item = mapping.mappings.find((entry) => entry.canonicalId === canonicalId);
  assert.ok(item, `Hiányzó mapping: ${canonicalId}`);
  assert.equal(item.mappingStatus, 'approved');
  assert.equal(item.unasId, unasId);
  assert.equal(item.sku, sku);
}

const charcoal = mapping.mappings.find((item) => item.canonicalId === 'aktiv_szenes_szappan');
assert.equal(charcoal.mappingStatus, 'needs_review');
assert.equal(Object.hasOwn(charcoal, 'unasId'), false);

const expert = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
const expectedRecommendations = [
  ['pikkelysömör', ['psorivital_csomag', 'holt_tengeri_so_balzsam']],
  ['ekcéma', ['dermavital_krem', 'dermavital_szappan']],
  ['akné', ['aktiv_szenes_szappan', 'katrany_szappan']],
  ['száraz bőr', ['shea_vajas_szappan']],
  ['pikkelysömörös fejbőr', ['dermavital_sampon', 'rozmaringos_samponszappan']],
  ['hajhullás', ['rozmaringos_samponszappan']]
];
for (const [question, expectedIds] of expectedRecommendations) {
  const answer = expert.resolve(question, []);
  assert.deepStrictEqual(answer.links.map((card) => card.id), expectedIds, `Megváltozott ajánlási sorrend: ${question}`);
  const serviceAnswer = createAnswer({
    question,
    history: [],
    knowledge: [],
    ruleEngine: expert,
    logGap() {}
  });
  assert.deepStrictEqual(
    serviceAnswer.links.map((card) => card.id),
    expectedIds,
    `Megváltozott createAnswer ajánlási sorrend: ${question}`
  );
}

console.log('TEST_CANONICAL_EXPANSION: minden ellenőrzés sikeres');
