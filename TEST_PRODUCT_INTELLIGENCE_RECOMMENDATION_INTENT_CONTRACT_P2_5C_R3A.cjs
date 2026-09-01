'use strict';

const assert = require('node:assert/strict');
const {
  SEMANTIC_KINDS,
  COMPLETENESS_STATUSES,
  REASON_CODES,
  classifyRecommendationIntent,
  buildRecommendationIntentContract,
  normalizeRecommendationIntent,
  determineCompleteness,
  parseControlledValue
} = require('./engine/product-intelligence-recommendation-intent-contract.cjs');

function hasNoAuthorized(result) {
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'authorized'), false, 'contract must not assert an authorization state');
}

const completeRecommendation = buildRecommendationIntentContract({
  route: 'expert_rule',
  intent: 'product_recommendation',
  plannerAnswerIntent: 'product_recommendation',
  materializationFamily: 'recommendation',
  productId: 'aktiv_szenes_szappan',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary',
  safetyInteraction: 'none'
});
assert.equal(completeRecommendation.kind, 'RECOMMENDATION');
assert.equal(completeRecommendation.completenessStatus, 'COMPLETE');
assert.deepEqual(completeRecommendation.missingDimensions, []);
assert.equal(completeRecommendation.reasonCode, null);
hasNoAuthorized(completeRecommendation);

const missingProduct = buildRecommendationIntentContract({
  route: 'expert_rule',
  intent: 'product_recommendation',
  plannerAnswerIntent: 'product_recommendation',
  materializationFamily: 'recommendation',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary'
});
assert.equal(missingProduct.completenessStatus, 'INCOMPLETE');
assert.deepEqual(missingProduct.missingDimensions, ['productId']);
assert.equal(missingProduct.reasonCode, 'MISSING_PRODUCT_ID');

const missingConcern = buildRecommendationIntentContract({
  productId: 'aktiv_szenes_szappan',
  applicationArea: 'face',
  recommendationRole: 'primary',
  route: 'expert_rule',
  intent: 'product_recommendation',
  materializationFamily: 'recommendation'
});
assert.equal(missingConcern.completenessStatus, 'INCOMPLETE');
assert.deepEqual(missingConcern.missingDimensions, ['concernContext']);
assert.equal(missingConcern.reasonCode, 'MISSING_CONCERN_CONTEXT');

const missingArea = buildRecommendationIntentContract({
  productId: 'aktiv_szenes_szappan',
  concernContext: 'acne',
  recommendationRole: 'primary',
  route: 'expert_rule',
  intent: 'product_recommendation',
  materializationFamily: 'recommendation'
});
assert.equal(missingArea.completenessStatus, 'INCOMPLETE');
assert.deepEqual(missingArea.missingDimensions, ['applicationArea']);
assert.equal(missingArea.reasonCode, 'MISSING_APPLICATION_AREA');

const unknownArea = buildRecommendationIntentContract({
  productId: 'aktiv_szenes_szappan',
  concernContext: 'acne',
  applicationArea: 'unknown',
  recommendationRole: 'primary',
  route: 'expert_rule',
  intent: 'product_recommendation',
  materializationFamily: 'recommendation'
});
assert.equal(unknownArea.completenessStatus, 'INCOMPLETE');
assert.deepEqual(unknownArea.missingDimensions, ['applicationArea']);
assert.equal(unknownArea.reasonCode, 'MISSING_APPLICATION_AREA');

const missingRole = buildRecommendationIntentContract({
  productId: 'aktiv_szenes_szappan',
  concernContext: 'acne',
  applicationArea: 'face',
  route: 'expert_rule',
  intent: 'product_recommendation',
  materializationFamily: 'recommendation'
});
assert.equal(missingRole.completenessStatus, 'INCOMPLETE');
assert.deepEqual(missingRole.missingDimensions, ['recommendationRole']);
assert.equal(missingRole.reasonCode, 'MISSING_RECOMMENDATION_ROLE');

const multiMissing = buildRecommendationIntentContract({
  route: 'expert_rule',
  intent: 'product_recommendation',
  plannerAnswerIntent: 'product_recommendation',
  materializationFamily: 'recommendation',
  productId: 'aktiv_szenes_szappan'
});
assert.equal(multiMissing.completenessStatus, 'INCOMPLETE');
assert.deepEqual(multiMissing.missingDimensions, ['concernContext', 'applicationArea', 'recommendationRole']);
assert.equal(multiMissing.reasonCode, 'MULTIPLE_REQUIRED_DIMENSIONS_MISSING');

const invalidConcern = buildRecommendationIntentContract({
  productId: 'aktiv_szenes_szappan',
  concernContext: 'bad_concern',
  applicationArea: 'face',
  recommendationRole: 'primary',
  route: 'expert_rule',
  intent: 'product_recommendation',
  materializationFamily: 'recommendation'
});
assert.equal(invalidConcern.completenessStatus, 'INCOMPLETE');
assert.equal(invalidConcern.reasonCode, 'INVALID_CONTROLLED_VALUE');

const invalidArea = buildRecommendationIntentContract({
  productId: 'aktiv_szenes_szappan',
  concernContext: 'acne',
  applicationArea: 'not_a_real_area',
  recommendationRole: 'primary',
  route: 'expert_rule',
  intent: 'product_recommendation',
  materializationFamily: 'recommendation'
});
assert.equal(invalidArea.completenessStatus, 'INCOMPLETE');
assert.equal(invalidArea.reasonCode, 'INVALID_CONTROLLED_VALUE');

const invalidRole = buildRecommendationIntentContract({
  productId: 'aktiv_szenes_szappan',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'unknown_role',
  route: 'expert_rule',
  intent: 'product_recommendation',
  materializationFamily: 'recommendation'
});
assert.equal(invalidRole.completenessStatus, 'INCOMPLETE');
assert.equal(invalidRole.reasonCode, 'INVALID_CONTROLLED_VALUE');

const neutralFact = buildRecommendationIntentContract({
  route: 'exact_product',
  intent: 'ingredients',
  plannerAnswerIntent: 'ingredients',
  materializationFamily: 'facts',
  productId: 'aktiv_szenes_szappan',
  safetyInteraction: 'none'
});
assert.equal(neutralFact.kind, 'NEUTRAL_PRODUCT_FACT');
assert.equal(neutralFact.completenessStatus, 'NOT_APPLICABLE');
assert.equal(neutralFact.reasonCode, null);

const commerceFlow = buildRecommendationIntentContract({
  route: 'commerce',
  intent: 'order_start',
  plannerAnswerIntent: 'order_start',
  materializationFamily: 'commerce',
  productId: 'aktiv_szenes_szappan',
  safetyInteraction: 'none'
});
assert.equal(commerceFlow.kind, 'COMMERCE');
assert.equal(commerceFlow.completenessStatus, 'NOT_APPLICABLE');
assert.equal(commerceFlow.reasonCode, null);

const safetyFlow = buildRecommendationIntentContract({
  route: 'safety',
  intent: 'medical_escalation',
  plannerAnswerIntent: 'medical_escalation',
  materializationFamily: 'safety',
  safetyInteraction: 'medical_escalation'
});
assert.equal(safetyFlow.kind, 'SAFETY');
assert.equal(safetyFlow.completenessStatus, 'NOT_APPLICABLE');
assert.equal(safetyFlow.reasonCode, null);

const regulatoryFlow = buildRecommendationIntentContract({
  route: 'regulatory',
  intent: 'claim_policy',
  plannerAnswerIntent: 'regulatory',
  materializationFamily: 'regulatory',
  safetyInteraction: 'none'
});
assert.equal(regulatoryFlow.kind, 'REGULATORY');
assert.equal(regulatoryFlow.completenessStatus, 'NOT_APPLICABLE');
assert.equal(regulatoryFlow.reasonCode, null);

const neutralComparison = buildRecommendationIntentContract({
  route: 'product_comparison',
  intent: 'compare_products',
  plannerAnswerIntent: 'comparison',
  materializationFamily: 'comparison',
  productId: 'aktiv_szenes_szappan',
  safetyInteraction: 'none'
});
assert.equal(neutralComparison.kind, 'COMPARISON_NEUTRAL');
assert.equal(neutralComparison.completenessStatus, 'NOT_APPLICABLE');
assert.equal(neutralComparison.reasonCode, null);

const selectionGuidance = buildRecommendationIntentContract({
  route: 'expert_rule',
  intent: 'selection_guidance',
  plannerAnswerIntent: 'product_recommendation',
  materializationFamily: 'selection_guidance',
  productId: 'aktiv_szenes_szappan',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary',
  safetyInteraction: 'none'
});
assert.equal(selectionGuidance.kind, 'SELECTION_GUIDANCE');
assert.equal(selectionGuidance.completenessStatus, 'COMPLETE');
assert.deepEqual(selectionGuidance.missingDimensions, []);

const selectionMissingRole = buildRecommendationIntentContract({
  route: 'expert_rule',
  intent: 'selection_guidance',
  plannerAnswerIntent: 'product_recommendation',
  materializationFamily: 'selection_guidance',
  productId: 'aktiv_szenes_szappan',
  concernContext: 'acne',
  applicationArea: 'face',
  safetyInteraction: 'none'
});
assert.equal(selectionMissingRole.kind, 'SELECTION_GUIDANCE');
assert.equal(selectionMissingRole.completenessStatus, 'INCOMPLETE');
assert.deepEqual(selectionMissingRole.missingDimensions, ['recommendationRole']);
assert.equal(selectionMissingRole.reasonCode, 'MISSING_RECOMMENDATION_ROLE');

const unknownPath = buildRecommendationIntentContract({
  route: 'unclassified',
  intent: 'mystery',
  plannerAnswerIntent: 'unknown',
  materializationFamily: 'unknown',
  safetyInteraction: 'none'
});
assert.equal(unknownPath.kind, 'UNKNOWN');
assert.equal(unknownPath.completenessStatus, 'NOT_APPLICABLE');
assert.equal(unknownPath.reasonCode, 'UNSUPPORTED_SEMANTIC_KIND');

assert.ok(SEMANTIC_KINDS.includes('RECOMMENDATION'));
assert.ok(COMPLETENESS_STATUSES.includes('COMPLETE'));
assert.ok(REASON_CODES.includes('MISSING_PRODUCT_ID'));

assert.equal(classifyRecommendationIntent({ route: 'expert_rule', intent: 'product_recommendation' }).kind, 'RECOMMENDATION');
assert.equal(classifyRecommendationIntent({ route: 'commerce', intent: 'order_start' }).kind, 'COMMERCE');
assert.equal(classifyRecommendationIntent({ route: 'safety', intent: 'medical_escalation' }).kind, 'SAFETY');
assert.equal(classifyRecommendationIntent({ route: 'exact_product', intent: 'ingredients' }).kind, 'NEUTRAL_PRODUCT_FACT');
assert.equal(classifyRecommendationIntent({ route: 'product_comparison', intent: 'compare_products' }).kind, 'COMPARISON_NEUTRAL');
assert.equal(parseControlledValue('acne', 'concern'), 'acne');
assert.equal(parseControlledValue('unknown', 'applicationArea'), null);
assert.equal(parseControlledValue('primary', 'recommendationRole'), 'primary');

assert.equal(determineCompleteness({
  productId: 'aktiv_szenes_szappan',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary'
}).completenessStatus, 'COMPLETE');
assert.equal(determineCompleteness({
  productId: 'aktiv_szenes_szappan',
  concernContext: 'acne',
  applicationArea: 'unknown',
  recommendationRole: 'primary'
}).completenessStatus, 'INCOMPLETE');

assert.equal(normalizeRecommendationIntent({
  route: 'expert_rule',
  intent: 'product_recommendation',
  plannerAnswerIntent: 'product_recommendation',
  materializationFamily: 'recommendation',
  productId: 'aktiv_szenes_szappan',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: 'primary'
}).kind, 'RECOMMENDATION');
assert.equal(normalizeRecommendationIntent({
  route: 'safety',
  intent: 'medical_escalation',
  plannerAnswerIntent: 'medical_escalation',
  materializationFamily: 'safety'
}).kind, 'SAFETY');

console.log('Recommendation Intent Contract test: PASS');
