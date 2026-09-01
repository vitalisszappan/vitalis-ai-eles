'use strict';

const assert = require('node:assert/strict');
const { createRecommendationScopeRepository } = require('./engine/product-intelligence-recommendation-scope-repository.cjs');
const { resolveRecommendationAuthorization } = require('./engine/product-intelligence-recommendation-authorization-adapter.cjs');

function makeRecord(overrides = {}) {
  const base = {
    recordId: 'synthetic:scope:approved-1',
    lifecycle: 'active',
    conflictStatus: 'none',
    provenance: { sourceType: 'synthetic', sourceId: 'synthetic-source-a' },
    ownerApproved: 'approved',
    complianceApproved: 'approved',
    customerAnswerApproved: 'approved',
    comparisonApproved: 'approved',
    decisionSupportApproved: 'approved',
    effectiveAt: '2026-01-01T00:00:00.000Z',
    reviewedAt: '2026-01-02T00:00:00.000Z',
    supersedes: [],
    productId: 'synthetic-product-a',
    concernContext: 'acne',
    applicationArea: 'face',
    recommendationRole: 'primary',
    eligibilityState: 'approved',
    safetyInteraction: 'none',
    allowedWordingId: 'synthetic:wording:01',
    evidenceRecordIds: ['synthetic:evidence:01'],
    limitations: ['Synthetic limitation.'],
    exclusions: ['Synthetic exclusion.'],
    allowedWording: 'Synthetic approved wording.',
    source: 'synthetic-source-a',
    comparisonUse: false,
    decisionSupportUse: false,
    medicalEscalationPolicy: 'none'
  };
  return { ...base, ...overrides, provenance: { ...base.provenance, ...(overrides.provenance || {}) } };
}

const approved = makeRecord();
const repo = createRecommendationScopeRepository([approved]);
const happy = resolveRecommendationAuthorization({
  productId: 'synthetic-product-a',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary',
  repository: repo
});
assert.equal(happy.status, 'AUTHORIZED');
assert.equal(happy.authorized, true);
assert.equal(happy.repositoryStatus, 'approved');
assert.equal(happy.evaluatorStatus, 'approved');
assert.equal(happy.allowedWording, 'Synthetic approved wording.');
assert.deepEqual(happy.limitations, ['Synthetic limitation.']);
assert.deepEqual(happy.exclusions, ['Synthetic exclusion.']);
assert.equal(happy.provenance.sourceType, 'synthetic');
assert.equal(happy.scopeKey, 'synthetic-product-a|acne|face|primary');
assert.equal('customerText' in happy, false);

const deniedBySafety = resolveRecommendationAuthorization({
  productId: 'synthetic-product-a',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary',
  safetyInteraction: 'medical_escalation',
  repository: repo
});
assert.equal(deniedBySafety.status, 'MEDICAL_ESCALATION');
assert.equal(deniedBySafety.authorized, false);

const prohibited = makeRecord({ recordId: 'synthetic:scope:prohibited', eligibilityState: 'prohibited' });
const prohibitedResult = resolveRecommendationAuthorization({
  productId: 'synthetic-product-a',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary',
  repository: createRecommendationScopeRepository([approved, prohibited])
});
assert.equal(prohibitedResult.status, 'DENIED');
assert.equal(prohibitedResult.authorized, false);

const unavailable = makeRecord({ recordId: 'synthetic:scope:unavailable', eligibilityState: 'unavailable' });
const unavailableResult = resolveRecommendationAuthorization({
  productId: 'synthetic-product-a',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary',
  repository: createRecommendationScopeRepository([approved, unavailable])
});
assert.equal(unavailableResult.status, 'DENIED');
assert.equal(unavailableResult.authorized, false);

const invalid = makeRecord({ recordId: 'synthetic:scope:invalid', ownerApproved: 'unknown' });
const invalidResult = resolveRecommendationAuthorization({
  productId: 'synthetic-product-a',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary',
  repository: createRecommendationScopeRepository([approved, invalid])
});
assert.equal(invalidResult.status, 'INVALID');
assert.equal(invalidResult.authorized, false);

const duplicateA = makeRecord({ recordId: 'synthetic:scope:duplicate-a', allowedWordingId: 'synthetic:wording:duplicate-a', allowedWording: 'Synthetic duplicate A.' });
const duplicateB = makeRecord({ recordId: 'synthetic:scope:duplicate-b', productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary', allowedWordingId: 'synthetic:wording:duplicate-b', allowedWording: 'Synthetic duplicate B.' });
const conflictResult = resolveRecommendationAuthorization({
  productId: 'synthetic-product-a',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary',
  repository: createRecommendationScopeRepository([duplicateA, duplicateB])
});
assert.equal(conflictResult.status, 'CONFLICT');
assert.equal(conflictResult.authorized, false);

const missing = resolveRecommendationAuthorization({
  productId: 'synthetic-product-z',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary',
  repository: repo
});
assert.equal(missing.status, 'MISSING');
assert.equal(missing.authorized, false);

assert.equal(resolveRecommendationAuthorization({
  productId: 'synthetic-product-b',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary',
  repository: repo
}).status, 'MISSING');
assert.equal(resolveRecommendationAuthorization({
  productId: 'synthetic-product-a',
  concernContext: 'psoriasis',
  applicationArea: 'face',
  recommendationRole: 'primary',
  repository: repo
}).status, 'MISSING');
assert.equal(resolveRecommendationAuthorization({
  productId: 'synthetic-product-a',
  concernContext: 'acne',
  applicationArea: 'scalp',
  recommendationRole: 'primary',
  repository: repo
}).status, 'MISSING');
assert.equal(resolveRecommendationAuthorization({
  productId: 'synthetic-product-a',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'companion',
  repository: repo
}).status, 'MISSING');

const invalidInput = resolveRecommendationAuthorization({
  productId: '',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary',
  repository: repo
});
assert.equal(invalidInput.status, 'INVALID');
assert.equal(invalidInput.authorized, false);

const nonMatchingNegative = makeRecord({ recordId: 'synthetic:scope:other-negative', productId: 'synthetic-product-b', concernContext: 'psoriasis', applicationArea: 'body', recommendationRole: 'secondary', eligibilityState: 'prohibited' });
const unrelated = resolveRecommendationAuthorization({
  productId: 'synthetic-product-a',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary',
  repository: createRecommendationScopeRepository([nonMatchingNegative, approved])
});
assert.equal(unrelated.status, 'AUTHORIZED');
assert.equal(unrelated.authorized, true);

assert.equal(resolveRecommendationAuthorization({
  productId: 'synthetic-product-a',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary',
  repository: createRecommendationScopeRepository([{ ...approved, source: 'synthetic-source-a' }])
}).provenance.sourceId, 'synthetic-source-a');

console.log('Product Intelligence Recommendation Authorization Adapter P2.5C-R2: PASS');
