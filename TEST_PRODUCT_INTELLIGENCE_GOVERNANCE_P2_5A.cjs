'use strict';

const assert = require('node:assert/strict');
const {
  validateProductClassification, validateRegulatoryStatus, validateClaimPolicy,
  validateClaimAuthorization, validateConcernBoundary, validateRecommendationScope
} = require('./engine/product-intelligence-validator.cjs');

const base = { recordId: 'governance:1', lifecycle: 'active', conflictStatus: 'none', provenance: { sourceType: 'owner_approved', sourceId: 'owner:1' }, ownerApproved: 'approved', complianceApproved: 'approved', customerAnswerApproved: 'approved', comparisonApproved: 'not_applicable', decisionSupportApproved: 'not_applicable', supersedes: [] };
const classification = { ...base, scopeType: 'product', productId: 'dermavital_krem', classification: 'cosmetic' };
assert.equal(validateProductClassification(classification).valid, true);
assert.equal(validateProductClassification({ ...classification, classification: 'unknown', customerAnswerApproved: 'unknown' }).valid, true);
assert.equal(validateProductClassification({ ...classification, classification: 'unknown', customerAnswerApproved: 'unknown' }).usable, false);
assert.equal(validateProductClassification({ ...classification, classification: 'medicine' }).valid, false);
assert.equal(validateProductClassification({ ...classification, scopeType: 'invalid' }).valid, false);
assert.equal(validateProductClassification({ ...classification, provenance: {} }).valid, false);
assert.equal(validateProductClassification({ ...classification, productId: '' }).valid, false);
assert.equal(validateProductClassification({ ...classification, scopeType: 'product_class', productId: undefined, productClassScope: '' }).valid, false);

const regulatory = { ...base, recordId: 'regulatory:1', scopeType: 'product', productId: 'dermavital_krem', jurisdiction: 'HU', authority: 'NNGYK', evidenceState: 'evidenced', publicClaimKind: 'authority_status', allowedPublicWording: 'approved-wording:1', provenance: { sourceType: 'authoritative', sourceId: 'authority:1' }, effectiveAt: '2026-01-01T00:00:00Z', reviewedAt: '2026-01-02T00:00:00Z' };
assert.equal(validateRegulatoryStatus({ ...regulatory, allowedPublicWording: '' }).valid, false);
assert.equal(validateRegulatoryStatus({ ...regulatory, evidenceState: 'not_proven' }).valid, false);
assert.equal(validateRegulatoryStatus({ ...regulatory, complianceApproved: 'unknown' }).valid, false);
assert.equal(validateRegulatoryStatus({ ...regulatory, customerAnswerApproved: 'unknown' }).valid, false);
assert.equal(validateRegulatoryStatus({ ...regulatory, provenance: { sourceType: 'owner_approved', sourceId: 'owner:1' } }).valid, false);

const policy = { ...base, recordId: 'policy:1', claimCategory: 'cosmetic_recommendation', defaultDisposition: 'allowed_with_authorization', structuredOutputEnforcement: 'allow' };
assert.equal(validateClaimPolicy(policy).valid, true);
for (const claimCategory of ['diagnosis', 'treatment_cure', 'therapeutic']) assert.equal(validateClaimPolicy({ ...policy, claimCategory, defaultDisposition: 'allowed_with_authorization' }).valid, false);
const authorization = { ...base, recordId: 'authorization:1', claimCategory: 'cosmetic_recommendation', authorizationStatus: 'authorized', evidenceRecordIds: ['scope:1'], allowedWordingId: 'wording:1' };
assert.equal(validateClaimAuthorization(authorization, null, { requiresComplianceApproval: true, requiresCustomerAnswerApproval: true }).valid, true);
assert.equal(validateClaimAuthorization({ ...authorization, claimCategory: 'diagnosis' }).valid, false);
assert.equal(validateClaimAuthorization({ ...authorization, claimCategory: 'treatment_cure' }).valid, false);
assert.equal(validateClaimAuthorization({ ...authorization, claimCategory: 'therapeutic' }).valid, false);
assert.equal(validateClaimAuthorization({ ...authorization, evidenceRecordIds: [] }).valid, false);
assert.equal(validateClaimAuthorization({ ...authorization, complianceApproved: 'unknown' }, null, { requiresComplianceApproval: true }).valid, false);
assert.equal(validateClaimAuthorization({ ...authorization, customerAnswerApproved: 'unknown' }, null, { requiresCustomerAnswerApproval: true }).valid, false);
assert.equal(validateClaimAuthorization({ ...authorization, claimCategory: 'regulatory_authority' }).valid, false);

const boundary = { ...base, recordId: 'boundary:1', concern: 'eczema', medicalClaimDisposition: 'prohibited', diagnosisDisposition: 'prohibited', treatmentCureDisposition: 'prohibited', defaultSafetyInteraction: 'caution_boundary' };
assert.equal(validateConcernBoundary(boundary).valid, true);
assert.equal(validateConcernBoundary({ ...boundary, recommendationAuthorizationId: 'authorization:1' }).valid, false);
assert.equal(validateConcernBoundary({ ...boundary, diagnosisDisposition: 'allowed_with_authorization' }).valid, false);

const scope = { ...base, recordId: 'scope:1', productId: 'dermavital_krem', concernContext: 'eczema', applicationArea: 'skin', recommendationRole: 'primary', eligibilityState: 'approved', allowedWordingId: 'wording:1', evidenceRecordIds: ['evidence:1'], safetyInteraction: 'none' };
assert.equal(validateRecommendationScope(scope).valid, true);
assert.equal(validateRecommendationScope({ ...scope, evidenceRecordIds: [] }).valid, false);
assert.equal(validateRecommendationScope({ ...scope, safetyInteraction: 'medical_escalation' }).valid, false);
assert.equal(validateRecommendationScope({ ...scope, comparisonUse: true }).valid, false);
assert.equal(validateRecommendationScope({ ...scope, decisionSupportUse: true }).valid, false);
assert.equal(validateRecommendationScope({ ...scope, conflictStatus: 'conflicted' }).usable, false);
for (const lifecycle of ['rejected', 'deprecated']) assert.equal(validateRecommendationScope({ ...scope, lifecycle }).usable, false);

console.log('Product Intelligence Governance P2.5A: PASS');