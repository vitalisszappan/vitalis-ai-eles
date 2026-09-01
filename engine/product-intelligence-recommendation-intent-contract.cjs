'use strict';

const {
  CONCERNS,
  APPLICATION_AREAS,
  RECOMMENDATION_ROLES,
  SAFETY_INTERACTIONS
} = require('./product-intelligence-schema.cjs');

const SEMANTIC_KINDS = Object.freeze([
  'RECOMMENDATION',
  'NEUTRAL_PRODUCT_FACT',
  'COMMERCE',
  'SAFETY',
  'REGULATORY',
  'COMPARISON_NEUTRAL',
  'SELECTION_GUIDANCE',
  'UNKNOWN'
]);

const COMPLETENESS_STATUSES = Object.freeze(['COMPLETE', 'INCOMPLETE', 'NOT_APPLICABLE']);

const REASON_CODES = Object.freeze([
  'MISSING_PRODUCT_ID',
  'MISSING_CONCERN_CONTEXT',
  'MISSING_APPLICATION_AREA',
  'MISSING_RECOMMENDATION_ROLE',
  'MULTIPLE_REQUIRED_DIMENSIONS_MISSING',
  'UNSUPPORTED_SEMANTIC_KIND',
  'INVALID_CONTROLLED_VALUE',
  'NOT_APPLICABLE'
]);

const REQUIRED_AUTHORIZATION_DIMENSIONS = Object.freeze([
  'productId',
  'concernContext',
  'applicationArea',
  'recommendationRole'
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasExplicitControlledValue(value) {
  return isNonEmptyString(value) && value.trim() !== '';
}

function parseControlledValue(value, field) {
  if (!isNonEmptyString(value)) return null;
  const trimmed = value.trim();
  if (field === 'concern') return CONCERNS.includes(trimmed) ? trimmed : null;
  if (field === 'applicationArea') {
    if (!APPLICATION_AREAS.includes(trimmed)) return null;
    return trimmed === 'unknown' ? null : trimmed;
  }
  if (field === 'recommendationRole') return RECOMMENDATION_ROLES.includes(trimmed) ? trimmed : null;
  if (field === 'safetyInteraction') return SAFETY_INTERACTIONS.includes(trimmed) ? trimmed : null;
  return trimmed;
}

function normalizeRouteInput(rawRoute) {
  if (!rawRoute) return null;
  const route = String(rawRoute).trim();
  return route || null;
}

function classifyRecommendationIntent(input = {}) {
  const route = normalizeRouteInput(input.route);
  const intent = input.intent ? String(input.intent).trim() : '';
  const plannerAnswerIntent = input.plannerAnswerIntent ? String(input.plannerAnswerIntent).trim() : '';
  const materializationFamily = input.materializationFamily ? String(input.materializationFamily).trim() : '';
  const safetyInteraction = parseControlledValue(input.safetyInteraction, 'safetyInteraction');

  if (safetyInteraction === 'medical_escalation' || route === 'safety' || intent === 'medical_escalation' || plannerAnswerIntent === 'medical_escalation') {
    return { kind: 'SAFETY', reasonCode: null };
  }

  if (route === 'commerce' || intent === 'order_start' || plannerAnswerIntent === 'order_start' || materializationFamily === 'commerce') {
    return { kind: 'COMMERCE', reasonCode: null };
  }

  if (route === 'regulatory' || intent === 'regulatory' || plannerAnswerIntent === 'regulatory' || materializationFamily === 'regulatory') {
    return { kind: 'REGULATORY', reasonCode: null };
  }

  if (route === 'product_comparison' || intent === 'compare_products' || plannerAnswerIntent === 'comparison' || materializationFamily === 'comparison') {
    return { kind: 'COMPARISON_NEUTRAL', reasonCode: null };
  }

  if (route === 'expert_rule' && (intent === 'selection_guidance' || materializationFamily === 'selection_guidance')) {
    return { kind: 'SELECTION_GUIDANCE', reasonCode: null };
  }

  if (route === 'expert_rule' || route === 'knowledge' || route === 'product_category' || route === 'exact_product' || route === 'problem_domain' || route === 'hair_product_type' || route === 'context_followup' || route === 'product_type') {
    if (intent === 'product_recommendation' || plannerAnswerIntent === 'product_recommendation' || materializationFamily === 'recommendation') {
      return { kind: 'RECOMMENDATION', reasonCode: null };
    }
  }

  if (route === 'exact_product' || intent === 'ingredients' || intent === 'usage' || intent === 'price_query' || plannerAnswerIntent === 'ingredients' || plannerAnswerIntent === 'usage' || plannerAnswerIntent === 'price_query' || materializationFamily === 'facts') {
    return { kind: 'NEUTRAL_PRODUCT_FACT', reasonCode: null };
  }

  if (route === 'unknown' || route === 'hard_fallback' || route === 'clarification' || !route) {
    return { kind: 'UNKNOWN', reasonCode: 'UNSUPPORTED_SEMANTIC_KIND' };
  }

  return { kind: 'UNKNOWN', reasonCode: 'UNSUPPORTED_SEMANTIC_KIND' };
}

function determineCompleteness(input = {}) {
  const normalized = {
    productId: input.productId,
    concernContext: input.concernContext,
    applicationArea: input.applicationArea,
    recommendationRole: input.recommendationRole
  };

  const missingDimensions = [];
  for (const key of REQUIRED_AUTHORIZATION_DIMENSIONS) {
    if (key === 'productId') {
      if (!hasExplicitControlledValue(normalized.productId)) missingDimensions.push('productId');
      continue;
    }
    if (key === 'concernContext') {
      const concernValue = parseControlledValue(normalized.concernContext, 'concern');
      if (!concernValue) missingDimensions.push('concernContext');
      continue;
    }
    if (key === 'applicationArea') {
      const areaValue = parseControlledValue(normalized.applicationArea, 'applicationArea');
      if (!areaValue || areaValue === 'unknown') missingDimensions.push('applicationArea');
      continue;
    }
    if (key === 'recommendationRole') {
      const roleValue = parseControlledValue(normalized.recommendationRole, 'recommendationRole');
      if (!roleValue) missingDimensions.push('recommendationRole');
    }
  }

  if (missingDimensions.length === 0) {
    return {
      completenessStatus: 'COMPLETE',
      missingDimensions: [],
      reasonCode: null
    };
  }

  if (missingDimensions.length === 1) {
    const reasonCodeMap = {
      productId: 'MISSING_PRODUCT_ID',
      concernContext: 'MISSING_CONCERN_CONTEXT',
      applicationArea: 'MISSING_APPLICATION_AREA',
      recommendationRole: 'MISSING_RECOMMENDATION_ROLE'
    };
    return {
      completenessStatus: 'INCOMPLETE',
      missingDimensions,
      reasonCode: reasonCodeMap[missingDimensions[0]] || 'MULTIPLE_REQUIRED_DIMENSIONS_MISSING'
    };
  }

  return {
    completenessStatus: 'INCOMPLETE',
    missingDimensions,
    reasonCode: 'MULTIPLE_REQUIRED_DIMENSIONS_MISSING'
  };
}

function validateControlledValue(fieldName, value) {
  if (fieldName === 'productId') return hasExplicitControlledValue(value) ? value : null;
  if (fieldName === 'concernContext') {
    const parsed = parseControlledValue(value, 'concern');
    return parsed || null;
  }
  if (fieldName === 'applicationArea') {
    const parsed = parseControlledValue(value, 'applicationArea');
    return parsed && parsed !== 'unknown' ? parsed : null;
  }
  if (fieldName === 'recommendationRole') {
    const parsed = parseControlledValue(value, 'recommendationRole');
    return parsed || null;
  }
  return null;
}

function buildRecommendationIntentContract(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const route = normalizeRouteInput(raw.route);
  const classification = classifyRecommendationIntent(raw);
  const kind = classification.kind;

  if (kind === 'COMMERCE' || kind === 'SAFETY' || kind === 'REGULATORY' || kind === 'NEUTRAL_PRODUCT_FACT' || kind === 'COMPARISON_NEUTRAL') {
    return {
      kind,
      productId: raw.productId || null,
      concernContext: raw.concernContext || null,
      applicationArea: raw.applicationArea || null,
      recommendationRole: raw.recommendationRole || null,
      sourceRoute: route,
      sourceIntent: raw.intent || null,
      materializationFamily: raw.materializationFamily || null,
      groundingStatus: raw.groundingStatus || null,
      completenessStatus: 'NOT_APPLICABLE',
      missingDimensions: [],
      reasonCode: null
    };
  }

  if (kind === 'UNKNOWN') {
    return {
      kind,
      productId: raw.productId || null,
      concernContext: raw.concernContext || null,
      applicationArea: raw.applicationArea || null,
      recommendationRole: raw.recommendationRole || null,
      sourceRoute: route,
      sourceIntent: raw.intent || null,
      materializationFamily: raw.materializationFamily || null,
      groundingStatus: raw.groundingStatus || null,
      completenessStatus: 'NOT_APPLICABLE',
      missingDimensions: [],
      reasonCode: classification.reasonCode || 'UNSUPPORTED_SEMANTIC_KIND'
    };
  }

  const productId = validateControlledValue('productId', raw.productId);
  const concernContext = validateControlledValue('concernContext', raw.concernContext);
  const applicationArea = validateControlledValue('applicationArea', raw.applicationArea);
  const recommendationRole = validateControlledValue('recommendationRole', raw.recommendationRole);

  const normalized = {
    productId,
    concernContext,
    applicationArea,
    recommendationRole
  };

  const completeness = determineCompleteness(normalized);

  const record = {
    kind,
    productId: productId || null,
    concernContext: concernContext || null,
    applicationArea: applicationArea || null,
    recommendationRole: recommendationRole || null,
    sourceRoute: route,
    sourceIntent: raw.intent || null,
    materializationFamily: raw.materializationFamily || null,
    groundingStatus: raw.groundingStatus || null,
    completenessStatus: completeness.completenessStatus,
    missingDimensions: completeness.missingDimensions,
    reasonCode: completeness.reasonCode
  };

  if (['RECOMMENDATION', 'SELECTION_GUIDANCE'].includes(kind) && completeness.completenessStatus === 'INCOMPLETE') {
    const invalidField = completeness.missingDimensions.length > 0 ? completeness.missingDimensions[0] : null;
    if (invalidField === 'applicationArea' && raw.applicationArea && raw.applicationArea !== 'unknown' && parseControlledValue(raw.applicationArea, 'applicationArea') === null) {
      record.reasonCode = 'INVALID_CONTROLLED_VALUE';
    }
    if (invalidField === 'concernContext' && raw.concernContext && parseControlledValue(raw.concernContext, 'concern') === null) {
      record.reasonCode = 'INVALID_CONTROLLED_VALUE';
    }
    if (invalidField === 'recommendationRole' && raw.recommendationRole && parseControlledValue(raw.recommendationRole, 'recommendationRole') === null) {
      record.reasonCode = 'INVALID_CONTROLLED_VALUE';
    }
  }

  if (kind === 'SELECTION_GUIDANCE' && completeness.completenessStatus === 'INCOMPLETE') {
    if (raw.productId && !productId) record.reasonCode = 'INVALID_CONTROLLED_VALUE';
    if (raw.concernContext && !concernContext) record.reasonCode = 'INVALID_CONTROLLED_VALUE';
    if (raw.applicationArea && raw.applicationArea === 'unknown') record.reasonCode = 'MISSING_APPLICATION_AREA';
    if (raw.applicationArea && !applicationArea && raw.applicationArea !== 'unknown') record.reasonCode = 'INVALID_CONTROLLED_VALUE';
    if (raw.recommendationRole && !recommendationRole) record.reasonCode = 'INVALID_CONTROLLED_VALUE';
  }

  if (kind === 'RECOMMENDATION' && completeness.completenessStatus === 'COMPLETE') {
    record.reasonCode = null;
  }

  return record;
}

function normalizeRecommendationIntent(input = {}) {
  return buildRecommendationIntentContract(input);
}

module.exports = {
  SEMANTIC_KINDS,
  COMPLETENESS_STATUSES,
  REASON_CODES,
  REQUIRED_AUTHORIZATION_DIMENSIONS,
  classifyRecommendationIntent,
  determineCompleteness,
  parseControlledValue,
  normalizeRecommendationIntent,
  buildRecommendationIntentContract
};
