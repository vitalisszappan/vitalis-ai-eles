'use strict';

const { PRODUCTS } = require('./product-catalog.cjs');
const { APPROVAL_STATES, APPROVAL_SCOPES, FACT_STATUSES, CONFLICT_STATUSES, DIMENSIONS } = require('./product-intelligence-schema.cjs');

function isNonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
function isPlainObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function isPlaceholder(value) { return /^(?:unknown|n\/a|none|null|undefined|tbd)$/i.test(String(value || '').trim()); }

function matchesValueType(value, valueType) {
  if (valueType === 'money') return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (valueType === 'currency') return isNonEmptyString(value) && /^[A-Z]{3}$/.test(value);
  if (valueType === 'enum' || valueType === 'instruction') return isNonEmptyString(value);
  if (valueType === 'string_list' || valueType === 'enum_list') return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
  if (valueType === 'ingredient_list') return Array.isArray(value) && value.length > 0 && value.every((item) => isPlainObject(item) && isNonEmptyString(item.rawName) && isNonEmptyString(item.ingredientId));
  if (valueType === 'claim_list') return Array.isArray(value) && value.length > 0 && value.every((item) => isPlainObject(item) && isNonEmptyString(item.claim));
  return false;
}

function validateProductFact(fact, products = PRODUCTS) {
  const errors = [];
  if (!isPlainObject(fact)) return { valid: false, errors: ['fact must be an object'], runtimeEligible: false };
  if (!isNonEmptyString(fact.factId)) errors.push('factId must be a non-empty string');
  if (fact.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!isNonEmptyString(fact.canonicalProductId) || !products[fact.canonicalProductId]) errors.push('canonicalProductId is unknown');
  const definition = DIMENSIONS[fact.dimension];
  if (!definition) errors.push('dimension is unknown');
  if (fact.valueType !== definition?.valueType) errors.push('valueType does not match dimension');
  if (!matchesValueType(fact.value, fact.valueType)) errors.push('value does not match valueType');
  if (!FACT_STATUSES.includes(fact.status)) errors.push('status is invalid');
  if (!isPlainObject(fact.source) || !isNonEmptyString(fact.source.sourceType) || !isNonEmptyString(fact.source.sourceId)) errors.push('source identity is required');
  if (isPlaceholder(fact.source?.sourceType) || isPlaceholder(fact.source?.sourceId)) errors.push('source identity cannot be a placeholder');
  if (fact.source?.location !== undefined && (!isPlainObject(fact.source.location) || !isNonEmptyString(fact.source.location.kind) || !isNonEmptyString(fact.source.location.path))) errors.push('source location is malformed');
  if (fact.source?.capturedAt !== undefined && (!isNonEmptyString(fact.source.capturedAt) || Number.isNaN(Date.parse(fact.source.capturedAt)))) errors.push('capturedAt is malformed');
  if (!isPlainObject(fact.approval)) errors.push('approval is required');
  for (const scope of APPROVAL_SCOPES) if (!APPROVAL_STATES.includes(fact.approval?.[scope])) errors.push(`approval.${scope} is invalid`);
  if (typeof fact.approved === 'boolean') errors.push('generic approved is not an authorization field');
  if (fact.approval?.reviewerId !== undefined && !isNonEmptyString(fact.approval.reviewerId)) errors.push('reviewerId is malformed');
  if (fact.approval?.reviewedAt !== undefined && (!isNonEmptyString(fact.approval.reviewedAt) || Number.isNaN(Date.parse(fact.approval.reviewedAt)))) errors.push('reviewedAt is malformed');
  if (!Number.isInteger(fact.version) || fact.version < 1) errors.push('version must be a positive integer');
  if (!Array.isArray(fact.supersedes) || fact.supersedes.some((id) => !isNonEmptyString(id))) errors.push('supersedes must be an array of non-empty fact IDs');
  if (fact.supersedes?.includes(fact.factId)) errors.push('fact cannot supersede itself');
  if (!CONFLICT_STATUSES.includes(fact.conflictStatus)) errors.push('conflictStatus is invalid');
  if (fact.status === 'active' && !['none', 'duplicate'].includes(fact.conflictStatus)) errors.push('active fact cannot have unresolved conflict');
  if (fact.approval?.comparison === 'approved' && !definition?.comparisonCapable) errors.push('dimension does not allow comparison approval');
  if (fact.approval?.decisionSupport === 'approved' && !definition?.decisionSupportCapable) errors.push('dimension does not allow decision support approval');
  if (fact.runtimeEligible === true && fact.status !== 'active') errors.push('non-active fact cannot be runtime eligible');
  return { valid: errors.length === 0, errors, runtimeEligible: errors.length === 0 && fact.status === 'active' && fact.conflictStatus === 'none' };
}

module.exports = { matchesValueType, validateProductFact };