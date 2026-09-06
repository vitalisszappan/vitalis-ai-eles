'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { CONCERNS } = require('./engine/product-intelligence-schema.cjs');
const { buildProblemDomainDecision } = require('./engine/problem-domain-decision.cjs');

let failed = 0;

function check(label, callback) {
  try {
    callback();
    console.log('OK  ', label);
  } catch (error) {
    failed += 1;
    console.log('HIBA', label, '-', error.message);
  }
}

const cases = [
  ['psoriasis', 'psoriasis'],
  ['eczema', 'eczema'],
  ['acne', 'acne'],
  ['rosacea', null],
  ['dry_skin', null],
  ['itchy_scalp', null],
  ['dandruff', null],
  ['unknown', null]
];

for (const [domain, concernContext] of cases) {
  check(`${domain} concern mapping`, () => {
    const decision = buildProblemDomainDecision({ domain, evidence: [`problem:${domain}`], expertRuleId: null });
    assert.strictEqual(decision.domain, domain);
    assert.strictEqual(decision.concernContext, concernContext);
  });
}

check('missing domain fails closed', () => {
  const decision = buildProblemDomainDecision({ evidence: ['face'], expertRuleId: 'synthetic-rule' });
  assert.deepStrictEqual(decision, { domain: null, evidence: ['face'], expertRuleId: 'synthetic-rule', concernContext: null });
});

check('product-looking input cannot create product metadata', () => {
  const decision = buildProblemDomainDecision({
    domain: 'acne', evidence: [], expertRuleId: 'acne', productId: 'synthetic-product',
    productIds: ['synthetic-product'], targetProductId: 'synthetic-product', selectedProductId: 'synthetic-product'
  });
  for (const key of ['productId', 'productIds', 'targetProductId', 'selectedProductId', 'suggestions', 'links', 'cards', 'recommendationType']) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(decision, key), false, key);
  }
});

check('suggestions and cards cannot create product metadata', () => {
  const decision = buildProblemDomainDecision({
    domain: 'eczema', evidence: ['PsoriVital csomag', 'face'], expertRuleId: 'eczema',
    suggestions: ['Dermavital krém'], cards: [{ id: 'synthetic-product', rank: 1 }]
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(decision, 'productId'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(decision, 'applicationArea'), false);
});

check('area text cannot create applicationArea', () => {
  const decision = buildProblemDomainDecision({ domain: 'acne', evidence: ['face', 'body', 'scalp', 'skin'] });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(decision, 'applicationArea'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(decision, 'bodyArea'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(decision, 'area'), false);
});

check('ordering and rule IDs cannot create role or product metadata', () => {
  const decision = buildProblemDomainDecision({ domain: 'psoriasis', evidence: ['primary', 'secondary'], expertRuleId: 'primary' });
  for (const key of ['recommendationRole', 'primary', 'secondary', 'companion', 'routine_care', 'productId']) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(decision, key), false, key);
  }
});

check('semantic kind is not created', () => {
  const decision = buildProblemDomainDecision({ domain: 'acne', evidence: [], expertRuleId: 'acne' });
  for (const key of ['semanticKind', 'kind', 'decisionType', 'recommendationIntent']) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(decision, key), false, key);
  }
});

check('authoritative CONCERNS enum is reused', () => {
  assert.ok(CONCERNS.includes('psoriasis'));
  assert.ok(CONCERNS.includes('eczema'));
  assert.ok(CONCERNS.includes('acne'));
  assert.ok(fs.readFileSync(path.join(__dirname, 'engine', 'problem-domain-decision.cjs'), 'utf8').includes("require('./product-intelligence-schema.cjs')"));
});

check('non-activation dependencies are absent', () => {
  const source = fs.readFileSync(path.join(__dirname, 'engine', 'problem-domain-decision.cjs'), 'utf8');
  for (const forbidden of ['recommendation-intent', 'R3A', 'R2', 'R1', 'governance', 'authorization', 'RecommendationScope']) {
    assert.strictEqual(source.includes(forbidden), false, forbidden);
  }
});

if (failed) {
  console.error(`\n${failed} M2 teszt hibás.`);
  process.exit(1);
}
console.log('\nMinden M2 ProblemDomain döntés teszt sikeres.');