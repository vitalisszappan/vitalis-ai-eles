'use strict';

const assert = require('node:assert/strict');
const { createProductFactsResolver, normalizeIngredient } = require('./engine/product-facts.cjs');

const resolver = createProductFactsResolver();
const known = resolver.getProductFacts('dermavital_krem');
assert.equal(known.canonicalProductId, 'dermavital_krem');
assert.equal(known.facts.name.status, 'grounded');
assert.equal(known.facts.price.status, 'grounded');
assert.ok(known.identityProvenance.every((item) => item.approved && item.productId === 'dermavital_krem'));

assert.equal(resolver.getProductFacts('does_not_exist'), null);

const missing = resolver.getProductFacts('parajdi_sotomb');
assert.equal(missing.facts.ingredientBenefits.status, 'unavailable');
assert.equal(missing.facts.ingredientBenefits.value, null);

for (const fact of Object.values(known.facts).filter((item) => item.status === 'grounded')) {
  assert.ok(fact.provenance.length > 0);
  assert.ok(fact.provenance.every((item) => item.sourceType && item.sourceId && item.productId === 'dermavital_krem' && item.approved));
}

assert.equal(normalizeIngredient('Urea'), 'urea');
assert.equal(normalizeIngredient('Karbamid'), 'urea');
assert.equal(resolver.hasIngredient('dermavital_krem', 'Karbamid').exists, true);
assert.doesNotMatch(resolver.getFact('dermavital_krem', 'usageInstructions').value || '', /használatra alkalmas/i);
assert.ok(!resolver.getFact('dermavital_krem', 'ingredientBenefits').value || resolver.getFact('dermavital_krem', 'ingredientBenefits').value.every((item) => resolver.hasIngredient('dermavital_krem', item.ingredientId).exists));

const conflictResolver = createProductFactsResolver({
  additionalFacts: [
    { productId: 'dermavital_krem', factType: 'price', value: 1, sourceType: 'unas_snapshot', sourceId: 'conflict-a' },
    { productId: 'dermavital_krem', factType: 'price', value: 2, sourceType: 'unas_snapshot', sourceId: 'conflict-b' }
  ]
});
const conflict = conflictResolver.getFact('dermavital_krem', 'price');
assert.equal(conflict.status, 'conflicted');
assert.equal(conflict.value, null);
assert.ok(conflict.conflicts.length >= 2);

const identityOnly = createProductFactsResolver({
  mappingData: { mappings: [{ canonicalId: 'identity_only', unasId: '1', sku: 'SKU', mappingStatus: 'approved' }] },
  snapshotData: { generatedAt: '2026-01-01T00:00:00Z', products: [{ unasId: '1', sku: 'SKU', name: 'Identity only', longDescription: 'INCI: Aqua, Urea', priceGross: 10, url: 'https://www.vitalis-szappan.hu/test' }] },
  deterministicProducts: { identity_only: { id: 'identity_only', name: 'Identity only' } }
});
assert.equal(identityOnly.hasIngredient('identity_only', 'Karbamid').exists, true);
assert.equal(identityOnly.getFact('identity_only', 'ingredientBenefits').status, 'unavailable');
assert.equal(identityOnly.getFact('identity_only', 'ingredientBenefits').value, null);

console.log('Product Facts regressions: PASS (known, unknown, missing, provenance, alias, conflict, no inferred benefit)');
