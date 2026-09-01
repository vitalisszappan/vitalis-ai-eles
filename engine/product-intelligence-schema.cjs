'use strict';

const APPROVAL_STATES = Object.freeze(['unknown', 'not_applicable', 'pending_review', 'approved', 'rejected', 'deprecated']);
const APPROVAL_SCOPES = Object.freeze(['sourceExists', 'authoritative', 'customerAnswer', 'comparison', 'decisionSupport']);
const FACT_STATUSES = Object.freeze(['active', 'pending_review', 'rejected', 'deprecated', 'superseded']);
const CONFLICT_STATUSES = Object.freeze(['none', 'duplicate', 'conflicted', 'unresolved']);
const PRODUCT_CLASSIFICATIONS = Object.freeze(['cosmetic', 'unknown']);
const SCOPE_TYPES = Object.freeze(['product', 'product_class', 'brand']);
const JURISDICTIONS = Object.freeze(['HU', 'unknown']);
const REGULATORY_AUTHORITIES = Object.freeze(['NNGYK', 'other_authority', 'unknown']);
const REGULATORY_EVIDENCE_STATES = Object.freeze(['unknown', 'not_proven', 'evidenced']);
const PUBLIC_CLAIM_KINDS = Object.freeze(['none', 'authority_status']);
const CLAIM_CATEGORIES = Object.freeze(['cosmetic_descriptive', 'cosmetic_intended_use', 'cosmetic_recommendation', 'therapeutic', 'diagnosis', 'treatment_cure', 'regulatory_authority']);
const CLAIM_DISPOSITIONS = Object.freeze(['allowed_with_authorization', 'prohibited']);
const AUTHORIZATION_STATUSES = Object.freeze(['authorized', 'unavailable', 'prohibited']);
const CONCERNS = Object.freeze(['eczema', 'psoriasis', 'acne', 'irritated_red_skin', 'scalp_complaint']);
const APPLICATION_AREAS = Object.freeze(['skin', 'face', 'body', 'scalp', 'hair', 'unknown']);
const RECOMMENDATION_ROLES = Object.freeze(['primary', 'secondary', 'companion', 'routine_care']);
const ELIGIBILITY_STATES = Object.freeze(['approved', 'unavailable', 'prohibited']);
const SAFETY_INTERACTIONS = Object.freeze(['none', 'caution_boundary', 'medical_escalation']);
const STRUCTURED_OUTPUT_ENFORCEMENT = Object.freeze(['allow', 'redact', 'block']);

const DIMENSIONS = Object.freeze({
  productType: { valueType: 'enum', multiple: false, comparisonCapable: true, decisionSupportCapable: true, ownership: 'knowledge' },
  applicationArea: { valueType: 'enum_list', multiple: true, comparisonCapable: true, decisionSupportCapable: true, ownership: 'knowledge' },
  primaryPurpose: { valueType: 'enum_list', multiple: true, comparisonCapable: true, decisionSupportCapable: true, ownership: 'knowledge' },
  recommendedFor: { valueType: 'string_list', multiple: true, comparisonCapable: true, decisionSupportCapable: true, ownership: 'knowledge' },
  concerns: { valueType: 'enum_list', multiple: true, comparisonCapable: true, decisionSupportCapable: true, ownership: 'knowledge' },
  usageRole: { valueType: 'enum_list', multiple: true, comparisonCapable: true, decisionSupportCapable: true, ownership: 'knowledge' },
  limitations: { valueType: 'string_list', multiple: true, comparisonCapable: true, decisionSupportCapable: true, ownership: 'knowledge' },
  keyIngredients: { valueType: 'ingredient_list', multiple: true, comparisonCapable: true, decisionSupportCapable: false, ownership: 'knowledge' },
  ingredients: { valueType: 'ingredient_list', multiple: true, comparisonCapable: true, decisionSupportCapable: false, ownership: 'commerce' },
  inci: { valueType: 'string_list', multiple: true, comparisonCapable: true, decisionSupportCapable: false, ownership: 'commerce' },
  usageInstructions: { valueType: 'instruction', multiple: false, comparisonCapable: true, decisionSupportCapable: true, ownership: 'knowledge' },
  frequency: { valueType: 'instruction', multiple: false, comparisonCapable: true, decisionSupportCapable: true, ownership: 'knowledge' },
  skinTypes: { valueType: 'enum_list', multiple: true, comparisonCapable: true, decisionSupportCapable: true, ownership: 'knowledge' },
  scalpTypes: { valueType: 'enum_list', multiple: true, comparisonCapable: true, decisionSupportCapable: true, ownership: 'knowledge' },
  warnings: { valueType: 'string_list', multiple: true, comparisonCapable: true, decisionSupportCapable: true, ownership: 'knowledge' },
  price: { valueType: 'money', multiple: false, comparisonCapable: true, decisionSupportCapable: false, ownership: 'commerce' },
  currency: { valueType: 'currency', multiple: false, comparisonCapable: true, decisionSupportCapable: false, ownership: 'commerce' },
  productBenefits: { valueType: 'claim_list', multiple: true, comparisonCapable: true, decisionSupportCapable: true, ownership: 'knowledge' }
});

function unknownApproval() {
  return Object.fromEntries(APPROVAL_SCOPES.map((scope) => [scope, 'unknown']));
}

function migrateLegacyApprovedFact(legacyFact, factId) {
  return {
    factId,
    schemaVersion: 1,
    canonicalProductId: legacyFact.productId,
    dimension: legacyFact.factType,
    value: legacyFact.value,
    valueType: DIMENSIONS[legacyFact.factType]?.valueType,
    status: 'active',
    source: { sourceType: legacyFact.sourceType, sourceId: legacyFact.sourceId },
    approval: unknownApproval(),
    version: 1,
    supersedes: [],
    conflictStatus: 'none'
  };
}

module.exports = {
  APPROVAL_STATES,
  APPROVAL_SCOPES,
  FACT_STATUSES,
  CONFLICT_STATUSES,
  PRODUCT_CLASSIFICATIONS,
  SCOPE_TYPES,
  JURISDICTIONS,
  REGULATORY_AUTHORITIES,
  REGULATORY_EVIDENCE_STATES,
  PUBLIC_CLAIM_KINDS,
  CLAIM_CATEGORIES,
  CLAIM_DISPOSITIONS,
  AUTHORIZATION_STATUSES,
  CONCERNS,
  APPLICATION_AREAS,
  RECOMMENDATION_ROLES,
  ELIGIBILITY_STATES,
  SAFETY_INTERACTIONS,
  STRUCTURED_OUTPUT_ENFORCEMENT,
  DIMENSIONS,
  unknownApproval,
  migrateLegacyApprovedFact
};