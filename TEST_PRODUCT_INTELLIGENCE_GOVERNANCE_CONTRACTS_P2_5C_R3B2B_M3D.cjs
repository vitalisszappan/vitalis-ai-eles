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

const nonAcneCriterion = criterion('synthetic-body', 1, [all(leaf('productType', 'soap'), leaf('applicationArea', 'body'), leaf('recommendationRole', 'primary'))]);
assert.equal(validateSelectionCriterion(nonAcneCriterion).valid, true);
assert.equal(evaluateSelectionCriterion(nonAcneCriterion, { productType: 'soap', applicationArea: 'body', recommendationRole: 'primary' }).status, 'MATCH');
assert.equal(evaluateSelectionCriterion(nonAcneCriterion, { productType: 'cream', applicationArea: 'body', recommendationRole: 'primary' }).status, 'CRITERION_NO_MATCH');

const binding = { bindingId: 'synthetic-binding', bindingVersion: 1, recommendationScopeId: 'synthetic-scope', recommendationScopeVersion: 1, criterionSetId: 'synthetic-acne', criterionSetVersion: 1, lifecycle: 'active', conflictStatus: 'none', provenance: { sourceType: 'synthetic', sourceId: 'synthetic:binding' }, ownerApproved: 'approved', complianceApproved: 'approved' };
assert.equal(validateRecommendationBinding(binding).usable, true);
assert.equal(validateRecommendationBinding({ ...binding, recommendationScopeVersion: '*' }).valid, false);
const criteria = { 'synthetic-acne:1': acneA };
assert.equal(resolveMatchingBindings([binding], criteria, { acneFrequencyOrIntensity: 'occasional_mild', skinOiliness: 'combination' }).status, 'MATCH');
assert.equal(resolveMatchingBindings([binding, { ...binding, bindingId: 'synthetic-binding-2' }], criteria, { acneFrequencyOrIntensity: 'occasional_mild', skinOiliness: 'combination' }).status, 'CRITERION_CONFLICT');
assert.equal(Object.prototype.hasOwnProperty.call(binding, 'allowedWording'), false);

const nonAcneBinding = { ...binding, bindingId: 'synthetic-body-binding', recommendationScopeId: 'synthetic_body_cleanser|psoriasis|body|primary', criterionSetId: 'synthetic-body' };
assert.equal(validateRecommendationBinding(nonAcneBinding).valid, true);
assert.equal(resolveMatchingBindings([nonAcneBinding], { 'synthetic-body:1': nonAcneCriterion }, { productType: 'soap', applicationArea: 'body', recommendationRole: 'primary' }).status, 'MATCH');

const wording = { wordingId: 'synthetic-wording', version: 1, locale: 'hu-HU', mode: 'EXACT_TEXT', exactText: 'Synthetic approved wording.', lifecycle: 'active', conflictStatus: 'none', provenance: { sourceType: 'synthetic', sourceId: 'synthetic:wording' }, ownerApproved: 'approved', complianceApproved: 'approved', customerAnswerApproved: 'approved' };
assert.equal(validateWordingArtifact(wording).usable, true);
assert.equal(resolveWordingArtifacts([wording], { wordingId: 'synthetic-wording', version: 1, locale: 'hu-HU' }).status, 'AUTHORIZED');
assert.equal(resolveWordingArtifacts([wording], { wordingId: 'synthetic-wording', version: 1, locale: 'de-DE' }).status, 'WORDING_UNAVAILABLE');
assert.equal(resolveWordingArtifacts([wording, wording], { wordingId: 'synthetic-wording', version: 1, locale: 'hu-HU' }).status, 'WORDING_CONFLICT');
assert.equal(validateWordingArtifact({ ...wording, mode: 'CLOSED_TEMPLATE', template: 'x {{product}}', slots: [{ name: 'product', valueType: 'productName', allowedValues: ['Synthetic Product'] }], exactText: undefined }).valid, true);
assert.equal(validateWordingArtifact({ ...wording, mode: 'CLOSED_TEMPLATE', template: 'x {{free}}', slots: [{ name: 'free', valueType: 'free_text' }], exactText: undefined }).valid, false);

const criterionReviewV1 = { reviewRecordId: 'synthetic-criterion-review-v1', targetRecordType: 'CriterionSet', targetRecordId: 'synthetic-versioned', targetVersion: 1, reviewScope: 'owner', reviewerId: 'owner:human-1', decision: 'approved', reviewedAt: '2026-01-01T00:00:00.000Z' };
const criterionV1 = criterion('synthetic-versioned', 1, [leaf('skinOiliness', 'combination')]);
const criterionV2 = criterion('synthetic-versioned', 2, [leaf('skinOiliness', 'mildly_oily')]);
assert.equal(resolveGovernanceReviews([criterionReviewV1], { targetRecordType: 'CriterionSet', targetRecordId: 'synthetic-versioned', targetVersion: 1, reviewScope: 'owner' }).status, 'APPROVED');
assert.equal(resolveGovernanceReviews([criterionReviewV1], { targetRecordType: 'CriterionSet', targetRecordId: 'synthetic-versioned', targetVersion: 2, reviewScope: 'owner' }).status, 'REVIEW_UNAVAILABLE');
assert.equal(evaluateSelectionCriterion(criterionV1, { skinOiliness: 'combination' }).status, 'MATCH');
assert.equal(evaluateSelectionCriterion(criterionV2, { skinOiliness: 'combination' }).status, 'CRITERION_NO_MATCH');

const bindingV1 = { ...binding, bindingId: 'synthetic-versioned-binding', bindingVersion: 1, criterionSetId: 'synthetic-versioned', criterionSetVersion: 1 };
const bindingV2 = { ...bindingV1, bindingVersion: 2, criterionSetVersion: 2 };
const bindingReviewV1 = { ...criterionReviewV1, reviewRecordId: 'synthetic-binding-review-v1', targetRecordType: 'RecommendationBinding', targetRecordId: 'synthetic-versioned-binding', targetVersion: 1 };
assert.equal(validateRecommendationBinding(bindingV1).valid, true);
assert.equal(validateRecommendationBinding(bindingV2).valid, true);
assert.equal(resolveGovernanceReviews([bindingReviewV1], { targetRecordType: 'RecommendationBinding', targetRecordId: 'synthetic-versioned-binding', targetVersion: 1, reviewScope: 'owner' }).status, 'APPROVED');
assert.equal(resolveGovernanceReviews([bindingReviewV1], { targetRecordType: 'RecommendationBinding', targetRecordId: 'synthetic-versioned-binding', targetVersion: 2, reviewScope: 'owner' }).status, 'REVIEW_UNAVAILABLE');

const wordingV2 = { ...wording, version: 2, exactText: 'Synthetic changed wording.' };
const wordingReviewV1 = { ...criterionReviewV1, reviewRecordId: 'synthetic-wording-review-v1', targetRecordType: 'WordingArtifact', targetRecordId: 'synthetic-wording|hu-HU', targetVersion: 1, reviewScope: 'customer_answer' };
assert.equal(validateWordingArtifact(wordingV2).valid, true);
assert.equal(resolveWordingArtifacts([wording, wordingV2], { wordingId: 'synthetic-wording', version: 1, locale: 'hu-HU' }).status, 'AUTHORIZED');
assert.equal(resolveWordingArtifacts([wording, wordingV2], { wordingId: 'synthetic-wording', version: 2, locale: 'hu-HU' }).status, 'AUTHORIZED');
assert.equal(resolveGovernanceReviews([wordingReviewV1], { targetRecordType: 'WordingArtifact', targetRecordId: 'synthetic-wording|hu-HU', targetVersion: 1, reviewScope: 'customer_answer' }).status, 'APPROVED');
assert.equal(resolveGovernanceReviews([wordingReviewV1], { targetRecordType: 'WordingArtifact', targetRecordId: 'synthetic-wording|hu-HU', targetVersion: 2, reviewScope: 'customer_answer' }).status, 'REVIEW_UNAVAILABLE');
assert.equal(resolveGovernanceReviews([wordingReviewV1], { targetRecordType: 'WordingArtifact', targetRecordId: 'synthetic-wording|hu-HU', targetVersion: 1, reviewScope: 'compliance' }).status, 'REVIEW_UNAVAILABLE');
assert.equal(resolveWordingArtifacts([wording, { ...wording, locale: 'de-DE' }], { wordingId: 'synthetic-wording', version: 1, locale: 'de-DE' }).status, 'AUTHORIZED');
assert.equal(resolveGovernanceReviews([wordingReviewV1], { targetRecordType: 'WordingArtifact', targetRecordId: 'synthetic-wording|de-DE', targetVersion: 1, reviewScope: 'customer_answer' }).status, 'REVIEW_UNAVAILABLE');
assert.equal(resolveWordingArtifacts([wording], { wordingId: 'synthetic-wording', version: 1, locale: 'de-DE' }).status, 'WORDING_UNAVAILABLE');

const review = { reviewRecordId: 'synthetic-review', targetRecordType: 'RecommendationBinding', targetRecordId: 'synthetic-binding', targetVersion: 1, reviewScope: 'owner', reviewerId: 'owner:human-1', decision: 'approved', reviewedAt: '2026-01-01T00:00:00.000Z', evidenceRefs: ['synthetic:evidence'] };
assert.equal(validateGovernanceReviewRecord(review).usable, true);
assert.equal(validateGovernanceReviewRecord({ ...review, reviewerId: 'codex:agent' }).valid, false);
assert.equal(validateGovernanceReviewRecord({ ...review, reviewScope: ['owner', 'compliance'] }).valid, false);
assert.equal(resolveGovernanceReviews([review], { targetRecordType: 'RecommendationBinding', targetRecordId: 'synthetic-binding', targetVersion: 1, reviewScope: 'owner' }).status, 'APPROVED');
assert.equal(resolveGovernanceReviews([review, { ...review, reviewRecordId: 'synthetic-review-2', decision: 'rejected' }], { targetRecordType: 'RecommendationBinding', targetRecordId: 'synthetic-binding', targetVersion: 1, reviewScope: 'owner' }).status, 'APPROVED');
assert.equal(resolveGovernanceReviews([review, { ...review, reviewRecordId: 'synthetic-review-2' }], { targetRecordType: 'RecommendationBinding', targetRecordId: 'synthetic-binding', targetVersion: 1, reviewScope: 'owner' }).status, 'REVIEW_CONFLICT');
assert.equal(resolveGovernanceReviews([review], { targetRecordType: 'RecommendationBinding', targetRecordId: 'synthetic-binding', targetVersion: 2, reviewScope: 'owner' }).status, 'REVIEW_UNAVAILABLE');

function runSyntheticPipeline(ownership) {
  const calls = { criterionEvaluationCalls: 0, bindingResolutionCalls: 0, authorizationCalls: 0, wordingResolutionCalls: 0 };
  if (ownership === 'MEDICAL_ESCALATION' || ownership === 'COMPLAINT_OWNED') return { result: ownership, calls };
  calls.criterionEvaluationCalls += 1;
  calls.bindingResolutionCalls += 1;
  calls.authorizationCalls += 1;
  calls.wordingResolutionCalls += 1;
  return { result: 'AUTHORIZED', calls };
}
for (const state of ['MEDICAL_ESCALATION', 'COMPLAINT_OWNED']) {
  const outcome = runSyntheticPipeline(state);
  assert.equal(outcome.result, state);
  assert.deepEqual(outcome.calls, { criterionEvaluationCalls: 0, bindingResolutionCalls: 0, authorizationCalls: 0, wordingResolutionCalls: 0 });
}
const normalOutcome = runSyntheticPipeline('RECOMMENDATION');
assert.equal(normalOutcome.result, 'AUTHORIZED');
assert.deepEqual(normalOutcome.calls, { criterionEvaluationCalls: 1, bindingResolutionCalls: 1, authorizationCalls: 1, wordingResolutionCalls: 1 });
console.log('TEST_ONLY_SIMULATION safety/complaint short-circuit: PASS');
assert.equal(validateRecommendationBinding({ ...binding, recommendationScopeId: 'aktiv_szenes_szappan|acne|face|primary' }).valid, true);
const sourceFiles = ['engine/product-intelligence-selection-criterion-schema.cjs', 'engine/product-intelligence-selection-criterion-validator.cjs', 'engine/product-intelligence-recommendation-binding-schema.cjs', 'engine/product-intelligence-recommendation-binding-validator.cjs', 'engine/product-intelligence-wording-artifact-schema.cjs', 'engine/product-intelligence-wording-artifact-validator.cjs', 'engine/product-intelligence-governance-review-schema.cjs', 'engine/product-intelligence-governance-review-validator.cjs'];
for (const file of sourceFiles) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  assert.equal(/require\(['"]\.\/answer-(?:service|router)|\.\/server\.cjs/.test(source), false, `${file} imports production answer path`);
  assert.equal(/eval\s*\(|new Function|require\(['"]\.\/product-catalog/.test(source), false, `${file} has forbidden integration`);
}

console.log('Product Intelligence dormant governance contracts M3D: PASS');