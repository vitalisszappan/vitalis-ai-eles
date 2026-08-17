'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixturePath = path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');
const restoreCatalogFixture = installCatalogFixture(fixturePath);
process.once('exit', restoreCatalogFixture);
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { detectExcludedProductTypes, detectProductTypeConstraint } = require('./engine/product-type-constraint.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');
function ask(question, history = []) {
  return createAnswer({ question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });
}
function assertNoShampoo(result, question) {
  assert.notEqual(result.route, 'product_category', question);
  assert.notEqual(result.domain, 'shampoo', question);
  assert.doesNotMatch(result.answer, /^Igen, van sampon/i, question);
  assert.ok(result.links.every((item) => !['liquid_shampoo', 'solid_shampoo', 'shampoo_soap'].includes(item.productType)), question);
}

for (const question of ['nem sampon érdekelne', 'sampon nem érdekel', 'sampont nem szeretnék', 'bármit, csak sampont ne']) {
  const result = ask(question);
  assertNoShampoo(result, question);
  assert.equal(result.route, 'clarification', question);
  assert.equal(result.source, 'product-type-negation', question);
  assert.match(result.answer, /Milyen terméktípust keresel a sampon helyett\?/i, question);
  assert.deepEqual(detectExcludedProductTypes(question), ['shampoo'], question);
}

const cream = ask('sampon helyett krémet keresek');
assert.equal(cream.route, 'product_category');
assert.equal(cream.domain, 'cream');
assert.equal(detectProductTypeConstraint('sampon helyett krémet keresek'), 'krem');
assert.ok(cream.links.length > 0);
assert.ok(cream.links.every((item) => !['liquid_shampoo', 'solid_shampoo', 'shampoo_soap'].includes(item.productType)));

const shampooHistory = [
  { role: 'user', content: 'Van sampon?' },
  { role: 'assistant', content: 'Igen, van sampon.', links: [{ id: 'dermavital_sampon', name: 'Dermavital sampon' }] }
];
assertNoShampoo(ask('nem sampon érdekelne', shampooHistory), 'samponos history');

const psoriasisHistory = [
  { role: 'user', content: 'Mit ajánlasz pikkelysömörös fejbőrre?' },
  { role: 'assistant', content: 'Elsőként a Dermavital sampont ajánlom.', links: [{ id: 'dermavital_sampon', name: 'Dermavital sampon' }] }
];
assertNoShampoo(ask('nem sampon érdekelne', psoriasisHistory), 'pikkelysömörös history');

const liquid = ask('nem samponszappan, folyékony sampont szeretnék');
assert.deepEqual(detectExcludedProductTypes('nem samponszappan, folyékony sampont szeretnék'), ['shampoo_soap']);
assert.equal(detectProductTypeConstraint('nem samponszappan, folyékony sampont szeretnék'), 'liquid_shampoo');
assert.equal(liquid.route, 'hair_product_type');
assert.ok(liquid.links.length > 0);
assert.ok(liquid.links.every((item) => item.productType === 'liquid_shampoo'));

const control = ask('Van sampon?');
assert.equal(control.route, 'hair_product_type');
assert.equal(control.intent, 'product_type_availability');
assert.match(control.answer, /^Igen\./);

restoreCatalogFixture();
console.log('Product-type negation regressions: PASS');
