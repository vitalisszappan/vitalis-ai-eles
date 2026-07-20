'use strict';

const assert = require('assert');
const path = require('path');
const knowledge = require('./data/knowledge.json');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { findProductInText } = require('./engine/product-faq.cjs');
const { normalize } = require('./engine/normalizer.cjs');

const ruleEngine = new ExpertRuleEngine(
  path.join(__dirname, 'data', 'rules', 'expert-rules.json')
);

function ask(question) {
  return createAnswer({
    question,
    history: [],
    knowledge,
    ruleEngine,
    logGap: () => {}
  });
}

function cardIds(result) {
  return (result.links || []).map((card) => card.id);
}

function assertProductName(question, productId, namePart) {
  assert.strictEqual(findProductInText(normalize(question)), productId, question);
  const result = ask(question);
  assert.strictEqual(result.source, 'product-context', question);
  assert.strictEqual(result.intent, 'product-detail', question);
  assert(result.answer.includes(namePart), question);
  assert.deepStrictEqual(cardIds(result), [productId], question);
  assert.notStrictEqual(result.source, 'knowledge-fallback', question);
}

for (const name of [
  'Gyógyászati kátrány szappan',
  'kátrány szappan',
  'gyógyászati-kátrány-szappan',
  'kátrányszappan'
]) {
  assertProductName(name, 'katrany_szappan', 'Gyógyászati kátrány szappan');
}

for (const name of [
  'Holt tengeri iszap szappan',
  'Holt-tengeri iszapos szappan',
  'iszap szappan',
  'iszapos szappan'
]) {
  assertProductName(
    name,
    'holt_tengeri_iszapos_szappan',
    'Holt-tengeri iszapos szappan'
  );
}

const recommendationCases = [
  {
    question: 'Mit ajánlasz pattanásos bőrre?',
    intent: 'acne',
    ids: ['aktiv_szenes_szappan', 'katrany_szappan'],
    answerParts: ['Aktív szenes szappant', 'kátrány szappan']
  },
  {
    question: 'Mit ajánlasz száraz bőrre?',
    intent: 'dry_skin',
    ids: ['shea_vajas_szappan'],
    answerParts: ['Shea vajas szappant']
  },
  {
    question: 'Mit ajánlasz pikkelysömörös fejbőrre?',
    intent: 'scalp_psoriasis',
    ids: ['dermavital_sampon', 'rozmaringos_samponszappan'],
    answerParts: ['Dermavital sampont', 'rozmaringos samponszappan']
  },
  {
    question: 'Mit ajánlasz rosaceára?',
    intent: 'problem-recommendation',
    ids: ['dermavital_krem'],
    answerParts: ['Dermavital krém']
  },
  {
    question: 'Mit ajánlasz hajszálértágulatra?',
    intent: 'problem-recommendation',
    ids: ['dermavital_krem'],
    answerParts: ['Dermavital krém']
  }
];

for (const test of recommendationCases) {
  const result = ask(test.question);
  assert.strictEqual(result.intent, test.intent, test.question);
  assert.deepStrictEqual(cardIds(result), test.ids, test.question);
  assert.notStrictEqual(result.source, 'knowledge-fallback', test.question);
  for (const text of test.answerParts) {
    assert(result.answer.includes(text), `${test.question}: ${text}`);
  }
  assert(!/Kecsketejes|Olíva/.test(result.answer), test.question);
}

assert.strictEqual(
  findProductInText(normalize('Dermavital nyugtató bőrápoló krém')),
  'dermavital_krem'
);

console.log('TEST_PRODUCT_AUDIT_FIXES: minden ellenőrzés sikeres');
