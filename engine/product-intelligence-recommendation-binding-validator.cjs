'use strict';

const { CONFLICT_STATUSES, FACT_STATUSES, APPROVAL_STATES } = require('./product-intelligence-schema.cjs');
const { BINDING_STATUSES } = require('./product-intelligence-recommendation-binding-schema.cjs');
const { validateSelectionCriterion, evaluateSelectionCriterion } = require('./product-intelligence-selection-criterion-validator.cjs');

function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function positive(value) { return Number.isInteger(value) && value > 0; }
function validApproval(value) { return APPROVAL_STATES.includes(value); }

function validateRecommendationBinding(binding) {
  const errors = [];
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return { valid: false, errors: ['binding must be an object'], usable: false };
  for (const field of ['bindingId', 'recommendationScopeId', 'criterionSetId']) if (!text(binding[field])) errors.push(`${field} is required`);
  for (const field of ['bindingVersion', 'recommendationScopeVersion', 'criterionSetVersion']) if (!positive(binding[field])) errors.push(`${field} must be a positive integer`);
  if (!BINDING_STATUSES.includes(binding.lifecycle)) errors.push('lifecycle is invalid');
  if (!CONFLICT_STATUSES.includes(binding.conflictStatus)) errors.push('conflictStatus is invalid');
  if (!binding.provenance || !text(binding.provenance.sourceType) || !text(binding.provenance.sourceId)) errors.push('provenance identity is required');
  if (!validApproval(binding.ownerApproved)) errors.push('ownerApproved is invalid');
  if (!validApproval(binding.complianceApproved)) errors.push('complianceApproved is invalid');
  for (const forbidden of ['allowedWording', 'productFact', 'claimAuthorization', 'producerText', 'safetyOverride']) if (Object.prototype.hasOwnProperty.call(binding, forbidden)) errors.push(`${forbidden} is not binding data`);
  if (binding.lifecycle === 'active' && !['none', 'duplicate'].includes(binding.conflictStatus)) errors.push('active binding cannot have unresolved conflict');
  return { valid: errors.length === 0, errors, usable: errors.length === 0 && binding.lifecycle === 'active' && binding.conflictStatus === 'none' && binding.ownerApproved === 'approved' && binding.complianceApproved === 'approved' };
}

function resolveMatchingBindings(bindings, criteriaByVersion, state) {
  const matches = [];
  for (const binding of Array.isArray(bindings) ? bindings : []) {
    const validation = validateRecommendationBinding(binding);
    if (!validation.usable) continue;
    const criterion = criteriaByVersion?.[`${binding.criterionSetId}:${binding.criterionSetVersion}`];
    if (!criterion || !validateSelectionCriterion(criterion).usable) continue;
    if (evaluateSelectionCriterion(criterion, state).matched) matches.push(binding);
  }
  if (matches.length > 1) return { status: 'CRITERION_CONFLICT', records: matches };
  if (matches.length === 1) return { status: 'MATCH', record: matches[0], records: matches };
  return { status: 'CRITERION_NO_MATCH', records: [] };
}

module.exports = { validateRecommendationBinding, resolveMatchingBindings };