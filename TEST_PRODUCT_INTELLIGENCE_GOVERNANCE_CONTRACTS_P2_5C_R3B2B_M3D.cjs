'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateSelectionCriterion, evaluateSelectionCriterion, resolveMatchingCriteria } = require('./engine/product-intelligence-selection-criterion-validator.cjs');
const { validateRecommendationBinding, resolveMatchingBindings } = require('./engine/product-intelligence-recommendation-binding-validator.cjs');
const { validateWordingArtifact, resolveWordingArtifacts } = require('./engine/product-intelligence-wording-artifact-validator.cjs');
const { validateGovernanceReviewRecord, resolveGovernanceReviews } = require('./engine/product-intelligence-governance-review-validator.cjs');

function criterion(id, version = 1, alternatives = []) {
  return { criterionSetId: id, criterionSetVersion: version, lifecycle: 'active', conflictStatus: 'none', provenance: { sourceType: 'synthetic', sourceId: `synthetic:${id}` }, ownerApproved: 'approved', complianceApproved: 'approved', alternatives };
}
const leaf = (field, value) => ({ type: 'LEAF', field, operator: 'EXACT', value });
const any = (...conditions) => ({ type: 'ANY', conditions });
const all = (...conditions) => ({ type: 'ALL', conditions });
const acneA = criterion('synthetic-acne', 1, [all(leaf('acneFrequencyOrIntensity', 'occasional_mild'), any(leaf('skinOiliness', 'combination'), leaf('skinOiliness', 'mildly_oily')))]);
const acneB = criterion('synthetic-acne', 2, [all(leaf('blackheads', 'present'), any(leaf('skinOiliness', 'combination'), leaf('skinOiliness', 'mildly_oily')))]);

assert.equal(validateSelectionCriterion(acneA).valid, true);
assert.equal(evaluateSelectionCriterion(acneA, { acneFrequencyOrIntensity: 'occasional_mild', skinOiliness: 'combination' }).status, 'MATCH');
assert.equal(evaluateSelectionCriterion(acneA, { acneFrequencyOrIntensity: 'frequent_stronger', skinOiliness: 'combination' }).status, 'CRITERION_NO_MATCH');
assert.equal(evaluateSelectionCriterion(acneA, { acneFrequencyOrIntensity: 'occasional_mild', skinOiliness: 'unknown' }).status, 'MISSING_CRITERION');
assert.equal(evaluateSelectionCriterion(acneB, { blackheads: 'present', skinOiliness: 'mildly_oily' }).status, 'MATCH');
assert.equal(evaluateSelectionCriterion(acneB, { blackheads: 'present', skinOiliness: 'dry' }).status, 'CRITERION_NO_MATCH');
assert.equal(validateSelectionCriterion({ ...acneA, criterionSetVersion: 0 }).valid, false);
assert.equal(validateSelectionCriterion({ ...acneA, alternatives: [{ type: 'LEAF', field: 'not-a-field', operator: 'EXACT', value: 'combination' }] }).valid, false);
const immutableInput = JSON.parse(JSON.stringify(acneA)); evaluateSelectionCriterion(acneA, { acneFrequencyOrIntensity: 'occasional_mild', skinOiliness: 'combination' }); assert.deepEqual(acneA, immutableInput);
assert.equal(resolveMatchingCriteria([acneA, { ...acneA, criterionSetId: 'synthetic-acne-duplicate' }], { acneFrequencyOrIntensity: 'occasional_mild', skinOiliness: 'combination' }).status, 'CRITERION_CONFLICT');
assert.equal(resolveMatchingCriteria([acneA], { acneFrequencyOrIntensity: 'occasional_mild', skinOiliness: 'combination' }).status, 'MATCH');

const binding = { bindingId: 'synthetic-binding', bindingVersion: 1, recommendationScopeId: 'synthetic-scope', recommendationScopeVersion: 1, criterionSetId: 'synthetic-acne', criterionSetVersion: 1, lifecycle: 'active', conflictStatus: 'none', provenance: { sourceType: 'synthetic', sourceId: 'synthetic:binding' }, ownerApproved: 'approved', complianceApproved: 'approved' };
assert.equal(validateRecommendationBinding(binding).usable, true);
assert.equal(validateRecommendationBinding({ ...binding, recommendationScopeVersion: '*' }).valid, false);
const criteria = { 'synthetic-acne:1': acneA };
assert.equal(resolveMatchingBindings([binding], criteria, { acneFrequencyOrIntensity: 'occasional_mild', skinOiliness: 'combination' }).status, 'MATCH');
assert.equal(resolveMatchingBindings([binding, { ...binding, bindingId: 'synthetic-binding-2' }], criteria, { acneFrequencyOrIntensity: 'occasional_mild', skinOiliness: 'combination' }).status, 'CRITERION_CONFLICT');
assert.equal(Object.prototype.hasOwnProperty.call(binding, 'allowedWording'), false);

const wording = { wordingId: 'synthetic-wording', version: 1, locale: 'hu-HU', mode: 'EXACT_TEXT', exactText: 'Synthetic approved wording.', lifecycle: 'active', conflictStatus: 'none', provenance: { sourceType: 'synthetic', sourceId: 'synthetic:wording' }, ownerApproved: 'approved', complianceApproved: 'approved', customerAnswerApproved: 'approved' };
assert.equal(validateWordingArtifact(wording).usable, true);
assert.equal(resolveWordingArtifacts([wording], { wordingId: 'synthetic-wording', version: 1, locale: 'hu-HU' }).status, 'AUTHORIZED');
assert.equal(resolveWordingArtifacts([wording], { wordingId: 'synthetic-wording', version: 1, locale: 'de-DE' }).status, 'WORDING_UNAVAILABLE');
assert.equal(resolveWordingArtifacts([wording, wording], { wordingId: 'synthetic-wording', version: 1, locale: 'hu-HU' }).status, 'WORDING_CONFLICT');
assert.equal(validateWordingArtifact({ ...wording, mode: 'CLOSED_TEMPLATE', template: 'x {{product}}', slots: [{ name: 'product', valueType: 'productName', allowedValues: ['Synthetic Product'] }], exactText: undefined }).valid, true);
assert.equal(validateWordingArtifact({ ...wording, mode: 'CLOSED_TEMPLATE', template: 'x {{free}}', slots: [{ name: 'free', valueType: 'free_text' }], exactText: undefined }).valid, false);

const review = { reviewRecordId: 'synthetic-review', targetRecordType: 'RecommendationBinding', targetRecordId: 'synthetic-binding', targetVersion: 1, reviewScope: 'owner', reviewerId: 'owner:human-1', decision: 'approved', reviewedAt: '2026-01-01T00:00:00.000Z', evidenceRefs: ['synthetic:evidence'] };
assert.equal(validateGovernanceReviewRecord(review).usable, true);
assert.equal(validateGovernanceReviewRecord({ ...review, reviewerId: 'codex:agent' }).valid, false);
assert.equal(validateGovernanceReviewRecord({ ...review, reviewScope: ['owner', 'compliance'] }).valid, false);
assert.equal(resolveGovernanceReviews([review], { targetRecordType: 'RecommendationBinding', targetRecordId: 'synthetic-binding', targetVersion: 1, reviewScope: 'owner' }).status, 'APPROVED');
assert.equal(resolveGovernanceReviews([review, { ...review, reviewRecordId: 'synthetic-review-2', decision: 'rejected' }], { targetRecordType: 'RecommendationBinding', targetRecordId: 'synthetic-binding', targetVersion: 1, reviewScope: 'owner' }).status, 'APPROVED');
assert.equal(resolveGovernanceReviews([review, { ...review, reviewRecordId: 'synthetic-review-2' }], { targetRecordType: 'RecommendationBinding', targetRecordId: 'synthetic-binding', targetVersion: 1, reviewScope: 'owner' }).status, 'REVIEW_CONFLICT');
assert.equal(resolveGovernanceReviews([review], { targetRecordType: 'RecommendationBinding', targetRecordId: 'synthetic-binding', targetVersion: 2, reviewScope: 'owner' }).status, 'REVIEW_UNAVAILABLE');

const safetyStates = new Set(['MEDICAL_ESCALATION', 'COMPLAINT_OWNED']);
for (const state of safetyStates) assert.equal(['CRITERION_EVALUATION', 'BINDING_AUTHORIZATION', 'WORDING_RESOLUTION'].some((stage) => stage === state), false);
assert.equal(validateRecommendationBinding({ ...binding, recommendationScopeId: 'aktiv_szenes_szappan|acne|face|primary' }).valid, true);
const sourceFiles = ['engine/product-intelligence-selection-criterion-schema.cjs', 'engine/product-intelligence-selection-criterion-validator.cjs', 'engine/product-intelligence-recommendation-binding-schema.cjs', 'engine/product-intelligence-recommendation-binding-validator.cjs', 'engine/product-intelligence-wording-artifact-schema.cjs', 'engine/product-intelligence-wording-artifact-validator.cjs', 'engine/product-intelligence-governance-review-schema.cjs', 'engine/product-intelligence-governance-review-validator.cjs'];
for (const file of sourceFiles) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  assert.equal(/require\(['"]\.\/answer-(?:service|router)|\.\/server\.cjs/.test(source), false, `${file} imports production answer path`);
  assert.equal(/eval\s*\(|new Function|require\(['"]\.\/product-catalog/.test(source), false, `${file} has forbidden integration`);
}

console.log('Product Intelligence dormant governance contracts M3D: PASS');