'use strict';

const APPROVAL_STATES = Object.freeze(['unknown', 'not_applicable', 'pending_review', 'approved', 'rejected', 'deprecated']);
const APPROVAL_SCOPES = Object.freeze(['sourceExists', 'authoritative', 'customerAnswer', 'comparison', 'decisionSupport']);
const FACT_STATUSES = Object.freeze(['active', 'pending_review', 'rejected', 'deprecated', 'superseded']);
const CONFLICT_STATUSES = Object.freeze(['none', 'duplicate', 'conflicted', 'unresolved']);

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

module.exports = { APPROVAL_STATES, APPROVAL_SCOPES, FACT_STATUSES, CONFLICT_STATUSES, DIMENSIONS, unknownApproval, migrateLegacyApprovedFact };