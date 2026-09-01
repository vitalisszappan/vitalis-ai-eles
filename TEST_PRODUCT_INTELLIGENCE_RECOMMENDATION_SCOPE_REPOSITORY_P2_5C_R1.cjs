'use strict';

const assert = require('node:assert/strict');
const {
  createRecommendationScopeRepository,
  buildRecommendationScopeKey,
  determineRecommendationScopeResolution,
  RecommendationScopeRepository
} = require('./engine/product-intelligence-recommendation-scope-repository.cjs');

function makeScope(overrides = {}) {
  const base = {
    recordId: 'synthetic:scope:01',
    lifecycle: 'active',
    conflictStatus: 'none',
    provenance: { sourceType: 'synthetic', sourceId: 'synthetic:recommendation-source' },
    ownerApproved: 'approved',
    complianceApproved: 'approved',
    customerAnswerApproved: 'approved',
    comparisonApproved: 'approved',
    decisionSupportApproved: 'approved',
    effectiveAt: '2025-01-01T00:00:00.000Z',
    reviewedAt: '2025-01-01T00:00:00.000Z',
    supersedes: [],
    productId: 'synthetic-product-a',
    concernContext: 'acne',
    applicationArea: 'face',
    recommendationRole: 'primary',
    eligibilityState: 'approved',
    safetyInteraction: 'none',
    allowedWordingId: 'synthetic:wording:approved',
    evidenceRecordIds: ['synthetic:evidence:approved-1'],
    limitations: ['Avoid direct medical claims.'],
    exclusions: ['Not for scalp concerns.'],
    allowedWording: 'Synthetic approved wording.',
    source: 'synthetic:recommendation-source',
    decisionSupportUse: false,
    comparisonUse: false,
    medicalEscalationPolicy: 'none'
  };
  return { ...base, ...overrides, provenance: { ...base.provenance, ...(overrides.provenance || {}) } };
}

assert.equal(typeof buildRecommendationScopeKey, 'function');
assert.equal(typeof createRecommendationScopeRepository, 'function');
assert.equal(typeof determineRecommendationScopeResolution, 'function');
assert.equal(typeof RecommendationScopeRepository, 'function');

const key = buildRecommendationScopeKey({ productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary' });
assert.equal(key, 'synthetic-product-a|acne|face|primary');

const approved = makeScope();
const repo = createRecommendationScopeRepository([approved]);
const exactApproved = repo.resolveExactScope({ productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary' });
assert.equal(exactApproved.status, 'approved');
assert.equal(exactApproved.eligible, true);
assert.equal(exactApproved.record.allowedWording, 'Synthetic approved wording.');
assert.deepEqual(exactApproved.record.limitations, ['Avoid direct medical claims.']);
assert.deepEqual(exactApproved.record.exclusions, ['Not for scalp concerns.']);
assert.equal(exactApproved.record.lifeCycle, undefined);

const wrongProduct = repo.resolveExactScope({ productId: 'synthetic-product-b', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary' });
assert.equal(wrongProduct.status, 'missing');
assert.equal(wrongProduct.eligible, false);

const wrongConcern = repo.resolveExactScope({ productId: 'synthetic-product-a', concernContext: 'psoriasis', applicationArea: 'face', recommendationRole: 'primary' });
assert.equal(wrongConcern.status, 'missing');

const wrongArea = repo.resolveExactScope({ productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'scalp', recommendationRole: 'primary' });
assert.equal(wrongArea.status, 'missing');

const wrongRole = repo.resolveExactScope({ productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'companion' });
assert.equal(wrongRole.status, 'missing');

const prohibited = makeScope({ recordId: 'synthetic:scope:prohibited', productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary', eligibilityState: 'prohibited', allowedWordingId: 'synthetic:wording:prohibited' });
const prohibitedRepo = createRecommendationScopeRepository([approved, prohibited]);
const prohibitedResult = prohibitedRepo.resolveExactScope({ productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary' });
assert.equal(prohibitedResult.status, 'prohibited');
assert.equal(prohibitedResult.eligible, false);

const unavailable = makeScope({ recordId: 'synthetic:scope:unavailable', productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary', eligibilityState: 'unavailable', allowedWordingId: 'synthetic:wording:unavailable' });
const unavailableRepo = createRecommendationScopeRepository([approved, unavailable]);
const unavailableResult = unavailableRepo.resolveExactScope({ productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary' });
assert.equal(unavailableResult.status, 'unavailable');
assert.equal(unavailableResult.eligible, false);

const invalid = makeScope({ recordId: 'synthetic:scope:invalid', productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary', ownerApproved: 'unknown', complianceApproved: 'approved', customerAnswerApproved: 'approved', comparisonApproved: 'approved', decisionSupportApproved: 'approved' });
const invalidRepo = createRecommendationScopeRepository([approved, invalid]);
const invalidResult = invalidRepo.resolveExactScope({ productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary' });
assert.equal(invalidResult.status, 'invalid');
assert.equal(invalidResult.eligible, false);

const duplicateA = makeScope({ recordId: 'synthetic:scope:duplicate-a', productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary', allowedWordingId: 'synthetic:wording:duplicate-a' });
const duplicateB = makeScope({ recordId: 'synthetic:scope:duplicate-b', productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary', allowedWordingId: 'synthetic:wording:duplicate-b' });
const conflictRepo = createRecommendationScopeRepository([duplicateA, duplicateB]);
const conflictResult = conflictRepo.resolveExactScope({ productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary' });
assert.equal(conflictResult.status, 'conflicted');
assert.equal(conflictResult.eligible, false);

const missingRepo = createRecommendationScopeRepository([]);
assert.equal(missingRepo.resolveExactScope({ productId: 'synthetic-product-z', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary' }).status, 'missing');

const deprecatedRecord = makeScope({ recordId: 'synthetic:scope:deprecated', lifecycle: 'deprecated', conflictStatus: 'none' });
const deprecatedRepo = createRecommendationScopeRepository([deprecatedRecord]);
assert.equal(deprecatedRepo.resolveExactScope({ productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary' }).status, 'invalid');

const conflictedRecord = makeScope({ recordId: 'synthetic:scope:conflicted', conflictStatus: 'conflicted' });
const conflictedRepo = createRecommendationScopeRepository([conflictedRecord]);
assert.equal(conflictedRepo.resolveExactScope({ productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary' }).status, 'conflicted');

const incompleteProvenance = makeScope({ recordId: 'synthetic:scope:bad-provenance', provenance: { sourceType: 'unknown', sourceId: '' } });
assert.equal(determineRecommendationScopeResolution([incompleteProvenance]).status, 'invalid');

const incompleteApproval = makeScope({ recordId: 'synthetic:scope:bad-approval', complianceApproved: 'pending_review' });
assert.equal(determineRecommendationScopeResolution([incompleteApproval]).status, 'invalid');

const escalation = makeScope({ recordId: 'synthetic:scope:medical', safetyInteraction: 'medical_escalation', eligibilityState: 'approved' });
assert.equal(determineRecommendationScopeResolution([escalation]).status, 'medical_escalation');

const nonMatchingNegative = makeScope({ recordId: 'synthetic:scope:nonmatch-negative', productId: 'synthetic-product-b', concernContext: 'psoriasis', applicationArea: 'body', recommendationRole: 'secondary', eligibilityState: 'prohibited' });
const unrelatedRepo = createRecommendationScopeRepository([nonMatchingNegative, approved]);
assert.equal(unrelatedRepo.resolveExactScope({ productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary' }).status, 'approved');

const noCatalogInspectionRepo = createRecommendationScopeRepository([makeScope({ productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary', source: 'synthetic:recommendation-source' })]);
assert.equal(noCatalogInspectionRepo.resolveExactScope({ productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary' }).record.source, 'synthetic:recommendation-source');
assert.equal(noCatalogInspectionRepo.resolveExactScope({ productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary' }).record.allowedWording, 'Synthetic approved wording.');
assert.equal(noCatalogInspectionRepo.resolveExactScope({ productId: 'synthetic-product-a', concernContext: 'acne', applicationArea: 'face', recommendationRole: 'primary' }).record.provenance.sourceType, 'synthetic');

console.log('Product Intelligence Recommendation Scope Repository P2.5C-R1: PASS');
