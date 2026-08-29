'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const { PRODUCTS } = require('./engine/product-catalog.cjs');
const { DIMENSIONS, APPROVAL_SCOPES, migrateLegacyApprovedFact } = require('./engine/product-intelligence-schema.cjs');
const { validateProductFact } = require('./engine/product-intelligence-validator.cjs');

assert.deepEqual(Object.keys(DIMENSIONS).sort(), ['applicationArea', 'concerns', 'currency', 'frequency', 'inci', 'ingredients', 'keyIngredients', 'limitations', 'price', 'primaryPurpose', 'productBenefits', 'productType', 'recommendedFor', 'scalpTypes', 'skinTypes', 'usageInstructions', 'usageRole', 'warnings']);
assert.equal(DIMENSIONS.productBenefits.comparisonCapable, true);
assert.equal(DIMENSIONS.price.decisionSupportCapable, false);

const validFact = {
  factId: 'test:benefit:1', schemaVersion: 1, canonicalProductId: 'aktiv_szenes_szappan', dimension: 'productBenefits',
  value: [{ claim: 'Tesztállítás.' }], valueType: 'claim_list', status: 'active',
  source: { sourceType: 'owner_statement', sourceId: 'test-source' },
  approval: { sourceExists: 'approved', authoritative: 'approved', customerAnswer: 'approved', comparison: 'approved', decisionSupport: 'unknown' },
  version: 1, supersedes: [], conflictStatus: 'none'
};
assert.equal(validateProductFact(validFact).valid, true);
assert.equal(validFact.approval.decisionSupport, 'unknown');
assert.equal(validateProductFact({ ...validFact, canonicalProductId: 'missing' }).valid, false);
assert.equal(validateProductFact({ ...validFact, dimension: 'missing' }).valid, false);
assert.equal(validateProductFact({ ...validFact, value: 'wrong' }).valid, false);
assert.equal(validateProductFact({ ...validFact, approval: { ...validFact.approval, comparison: 'yes' } }).valid, false);
assert.equal(validateProductFact({ ...validFact, source: { sourceType: '', sourceId: 'x' } }).valid, false);
assert.equal(validateProductFact({ ...validFact, source: { sourceType: 'unknown', sourceId: 'unknown' } }).valid, false);
assert.equal(validateProductFact({ ...validFact, approved: true }).valid, false);
assert.equal(validateProductFact({ ...validFact, schemaVersion: 2 }).valid, false);
assert.equal(validateProductFact({ ...validFact, version: 0 }).valid, false);
assert.equal(validateProductFact({ ...validFact, supersedes: ['test:benefit:1'] }).valid, false);
assert.equal(validateProductFact({ ...validFact, conflictStatus: 'conflicted' }).valid, false);
assert.equal(validateProductFact({ ...validFact, dimension: 'price', value: 100, valueType: 'money', approval: { ...validFact.approval, decisionSupport: 'approved' } }).valid, false);
assert.equal(validateProductFact({ ...validFact, status: 'rejected', runtimeEligible: true }).valid, false);

const legacy = JSON.parse(fs.readFileSync('data/approved-product-facts.json', 'utf8')).facts;
assert.equal(legacy.length, 5);
for (const [index, legacyFact] of legacy.entries()) {
  const migrated = migrateLegacyApprovedFact(legacyFact, `migration-fixture:${index + 1}`);
  assert.equal(validateProductFact(migrated).valid, true);
  assert.equal(migrated.canonicalProductId, legacyFact.productId);
  assert.equal(migrated.dimension, legacyFact.factType);
  assert.deepEqual(migrated.value, legacyFact.value);
  assert.equal(migrated.source.sourceType, legacyFact.sourceType);
  assert.equal(migrated.source.sourceId, legacyFact.sourceId);
  assert.equal(migrated.source.location, undefined);
  assert.equal(migrated.source.capturedAt, undefined);
  assert.equal(migrated.approval.reviewerId, undefined);
  assert.equal(migrated.approval.reviewedAt, undefined);
  for (const scope of APPROVAL_SCOPES) assert.equal(migrated.approval[scope], 'unknown');
}

assert.equal(PRODUCTS.katrany_szappan.displayName, 'Kátrány szappan');
assert.equal(DIMENSIONS.productBenefits.ownership, 'knowledge');
console.log('Product Intelligence Foundation: PASS');