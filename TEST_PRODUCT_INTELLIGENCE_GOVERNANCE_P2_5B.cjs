'use strict';

const assert = require('node:assert/strict');
const { resolveProductClassification, resolveRegulatoryStatus, evaluateClaimAuthorization, evaluateConcernBoundary, evaluateRecommendationScope } = require('./engine/product-intelligence-governance-evaluator.cjs');

const base = { lifecycle: 'active', conflictStatus: 'none', provenance: { sourceType: 'authoritative', sourceId: 'synthetic:source' }, ownerApproved: 'approved', complianceApproved: 'approved', customerAnswerApproved: 'approved', comparisonApproved: 'not_applicable', decisionSupportApproved: 'not_applicable', supersedes: [] };
const classification = { ...base, recordId: 'classification:class', scopeType: 'product_class', productClassScope: 'synthetic-class', classification: 'cosmetic' };
const productClassification = { ...base, recordId: 'classification:product', scopeType: 'product', productId: 'synthetic-product', classification: 'cosmetic' };
const regulatory = { ...base, recordId: 'regulatory:1', scopeType: 'product', productId: 'synthetic-product', jurisdiction: 'HU', authority: 'NNGYK', evidenceState: 'evidenced', publicClaimKind: 'authority_status', allowedPublicWording: 'synthetic-wording:authority', effectiveAt: '2026-01-01T00:00:00Z', reviewedAt: '2026-01-02T00:00:00Z' };
const policy = { ...base, recordId: 'policy:descriptive', claimCategory: 'cosmetic_descriptive', defaultDisposition: 'allowed_with_authorization', structuredOutputEnforcement: 'allow' };
const regulatoryPolicy = { ...base, recordId: 'policy:regulatory', claimCategory: 'regulatory_authority', defaultDisposition: 'allowed_with_authorization', structuredOutputEnforcement: 'block' };
const authorization = { ...base, recordId: 'authorization:descriptive', claimCategory: 'cosmetic_descriptive', authorizationStatus: 'authorized', evidenceRecordIds: ['evidence:1'], allowedWordingId: 'synthetic-wording:descriptive' };
const regulatoryAuthorization = { ...base, recordId: 'authorization:regulatory', claimCategory: 'regulatory_authority', authorizationStatus: 'authorized', evidenceRecordIds: ['regulatory:1'], allowedWordingId: 'synthetic-wording:authority' };
const boundary = { ...base, recordId: 'boundary:acne', concern: 'acne', medicalClaimDisposition: 'prohibited', diagnosisDisposition: 'prohibited', treatmentCureDisposition: 'prohibited', defaultSafetyInteraction: 'none', cosmeticDiscussionPermitted: true };
const scope = { ...base, recordId: 'scope:acne-skin', productId: 'synthetic-product', concernContext: 'acne', applicationArea: 'skin', recommendationRole: 'primary', eligibilityState: 'approved', allowedWordingId: 'synthetic-wording:scope', evidenceRecordIds: ['evidence:scope'], safetyInteraction: 'none' };

assert.deepEqual(resolveProductClassification({ productId: 'synthetic-product' }), { classification: 'unknown', status: 'unknown', reasonCode: 'UNKNOWN', supportingRecordIds: [], authorizationUsable: false });
assert.equal(resolveProductClassification({ productId: 'synthetic-product', records: [{ ...productClassification, classification: 'unknown', customerAnswerApproved: 'unknown' }] }).authorizationUsable, false);
assert.equal(resolveProductClassification({ productId: 'synthetic-product', productClassScope: 'synthetic-class', records: [classification, productClassification] }).supportingRecordIds[0], 'classification:product');
for (const record of [{ ...productClassification, lifecycle: 'rejected' }, { ...productClassification, conflictStatus: 'conflicted' }, { ...productClassification, lifecycle: 'deprecated' }, { ...productClassification, ownerApproved: 'unknown' }, { ...productClassification, complianceApproved: 'unknown' }, { ...productClassification, provenance: {} }]) assert.equal(resolveProductClassification({ productId: 'synthetic-product', records: [record] }).authorizationUsable, false);

assert.equal(resolveRegulatoryStatus({ productId: 'synthetic-product', jurisdiction: 'HU', authority: 'NNGYK' }).publicClaimAuthorized, false);
for (const record of [{ ...regulatory, evidenceState: 'not_proven' }, { ...regulatory, evidenceState: 'unknown' }, { ...regulatory, complianceApproved: 'unknown' }, { ...regulatory, customerAnswerApproved: 'unknown' }, { ...regulatory, allowedPublicWording: '' }, { ...regulatory, conflictStatus: 'conflicted' }]) assert.equal(resolveRegulatoryStatus({ productId: 'synthetic-product', jurisdiction: 'HU', authority: 'NNGYK', records: [record] }).publicClaimAuthorized, false);
const resolvedRegulatory = resolveRegulatoryStatus({ productId: 'synthetic-product', jurisdiction: 'HU', authority: 'NNGYK', records: [regulatory] });
assert.equal(resolvedRegulatory.allowedWording, 'synthetic-wording:authority');

for (const claimCategory of ['diagnosis', 'treatment_cure', 'therapeutic']) assert.equal(evaluateClaimAuthorization({ claimCategory, policies: [policy], authorizations: [authorization] }).authorized, false);
const bypassBase = { ...authorization, ownerApproved: 'unknown', complianceApproved: 'unknown', customerAnswerApproved: 'unknown' };
for (const mutated of [{ ...bypassBase, customerAnswerApproved: 'approved' }, { ...bypassBase, comparisonApproved: 'approved' }, { ...bypassBase, decisionSupportApproved: 'approved' }, { ...bypassBase, catalogPresent: true }, { ...bypassBase, expertRuleMetadata: true }, { ...bypassBase, productFactExists: true }, { ...bypassBase, displayName: 'permissive' }]) assert.equal(evaluateClaimAuthorization({ claimCategory: 'cosmetic_descriptive', policies: [policy], authorizations: [mutated] }).authorized, false);
assert.equal(evaluateClaimAuthorization({ claimCategory: 'cosmetic_descriptive' }).authorized, false);
assert.equal(evaluateClaimAuthorization({ claimCategory: 'cosmetic_descriptive', policies: [policy] }).authorized, false);
assert.equal(evaluateClaimAuthorization({ claimCategory: 'cosmetic_descriptive', policies: [policy], authorizations: [{ ...authorization, conflictStatus: 'conflicted' }] }).authorized, false);
assert.equal(evaluateClaimAuthorization({ claimCategory: 'cosmetic_descriptive', policies: [policy], authorizations: [{ ...authorization, lifecycle: 'rejected' }] }).authorized, false);
assert.equal(evaluateClaimAuthorization({ claimCategory: 'cosmetic_descriptive', policies: [policy], authorizations: [authorization] }).authorized, true);
const prohibitedAuthorization = { ...authorization, recordId: 'authorization:prohibited', authorizationStatus: 'prohibited' };
const unavailableAuthorization = { ...authorization, recordId: 'authorization:unavailable', authorizationStatus: 'unavailable' };
assert.equal(evaluateClaimAuthorization({ claimCategory: 'cosmetic_descriptive', policies: [policy], authorizations: [authorization, prohibitedAuthorization] }).authorized, false);
assert.equal(evaluateClaimAuthorization({ claimCategory: 'cosmetic_descriptive', policies: [policy], authorizations: [authorization, unavailableAuthorization] }).authorized, false);
assert.equal(evaluateClaimAuthorization({ claimCategory: 'cosmetic_descriptive', policies: [policy], authorizations: [authorization, { ...authorization, recordId: 'authorization:contradictory-wording', allowedWordingId: 'synthetic-wording:other' }] }).authorized, false);
assert.equal(evaluateClaimAuthorization({ claimCategory: 'cosmetic_descriptive', policies: [policy], authorizations: [prohibitedAuthorization] }).authorized, false);
assert.equal(evaluateClaimAuthorization({ claimCategory: 'cosmetic_descriptive', policies: [policy], authorizations: [unavailableAuthorization] }).authorized, false);
assert.equal(evaluateClaimAuthorization({ claimCategory: 'cosmetic_descriptive', policies: [policy], authorizations: [authorization, { ...prohibitedAuthorization, claimCategory: 'cosmetic_intended_use' }] }).authorized, true);
assert.equal(evaluateClaimAuthorization({ claimCategory: 'regulatory_authority', policies: [regulatoryPolicy], authorizations: [regulatoryAuthorization] }).authorized, false);
const regulatoryClaim = evaluateClaimAuthorization({ claimCategory: 'regulatory_authority', policies: [regulatoryPolicy], authorizations: [regulatoryAuthorization], regulatoryStatus: regulatory });
assert.equal(regulatoryClaim.authorized, true); assert.equal(regulatoryClaim.allowedWording, 'synthetic-wording:authority');

assert.equal(evaluateConcernBoundary({ concern: 'acne', records: [boundary] }).recommendationScopeRequired, true);
assert.equal(evaluateConcernBoundary({ concern: 'acne', safetyInteraction: 'medical_escalation', records: [boundary] }).medicalEscalationRequired, true);
assert.equal(evaluateConcernBoundary({ concern: 'acne', records: [boundary] }).prohibitedClaimCategories.includes('diagnosis'), true);
assert.equal(evaluateConcernBoundary({ concern: 'acne', records: [boundary] }).prohibitedClaimCategories.includes('treatment_cure'), true);

assert.equal(evaluateRecommendationScope({ productId: 'synthetic-product', concernContext: 'acne', applicationArea: 'skin', recommendationRole: 'primary', records: [scope] }).eligible, true);
for (const input of [{ concernContext: 'eczema' }, { applicationArea: 'face' }, { concernContext: 'psoriasis' }, { applicationArea: 'scalp' }, { safetyInteraction: 'medical_escalation' }]) assert.equal(evaluateRecommendationScope({ productId: 'synthetic-product', concernContext: 'acne', applicationArea: 'skin', recommendationRole: 'primary', records: [scope], ...input }).eligible, false);
for (const record of [{ ...scope, eligibilityState: 'unavailable' }, { ...scope, eligibilityState: 'prohibited' }, { ...scope, complianceApproved: 'unknown' }, { ...scope, evidenceRecordIds: [] }, { ...scope, conflictStatus: 'conflicted' }]) assert.equal(evaluateRecommendationScope({ productId: 'synthetic-product', concernContext: 'acne', applicationArea: 'skin', recommendationRole: 'primary', records: [record] }).eligible, false);

console.log('Product Intelligence Governance P2.5B: PASS');