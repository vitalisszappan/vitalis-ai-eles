'use strict';

const { PROVENANCE_SOURCE_TYPES, OWNERSHIP_STATES, TRANSITION_FIELD_PATHS, TRANSITION_PAYLOAD_KINDS } = require('./conversation-decision-transition-schema.cjs');

const CLASSIFICATIONS = Object.freeze(['AUTHORITATIVE_WRITE', 'ADMISSIBLE_CANDIDATE', 'RECOVERY_ONLY', 'DIAGNOSTIC_ONLY', 'FORBIDDEN']);
const RECOVERY = Object.freeze(['ASSISTANT_OUTPUT_RECOVERY', 'LEGACY_TEXT_RECOVERY', 'UNKNOWN']);
const USER_FIELDS = Object.freeze(['explicit.concerns', 'explicit.applicationAreas', 'explicit.products', 'explicit.goal', 'explicit.qualifiers', 'explicit.complaintState', 'explicit.safetySignals']);
const CANONICAL_FIELDS = Object.freeze(['resolved.productFocus', 'resolved.referencedProducts', 'resolved.problemDomain', 'resolved.concernContext', 'resolved.applicationArea', 'resolved.requestedProductType', 'resolved.commerceIntent', 'resolved.complaintIntent', 'resolved.safetyClass']);
const GOVERNANCE_FIELDS = Object.freeze(['governance.scopeId', 'governance.scopeVersion', 'governance.criterionSetId', 'governance.criterionSetVersion', 'governance.bindingId', 'governance.bindingVersion', 'governance.reviewRecordId', 'governance.wordingArtifactId', 'governance.wordingArtifactVersion', 'governance.wordingLocale', 'governance.authorizationStatus', 'governance.authorizationReason', 'governance.authorizedProductIds', 'governance.authorizationEvidenceIds']);

const FIELD_PROVENANCE_POLICY = Object.freeze(Object.fromEntries([
  ...USER_FIELDS.map((field) => [field, Object.freeze({ USER_EXPLICIT: 'AUTHORITATIVE_WRITE', CANONICAL_RESOLUTION: 'ADMISSIBLE_CANDIDATE', PROBLEM_DOMAIN_DECISION: 'ADMISSIBLE_CANDIDATE', ASSISTANT_OUTPUT_RECOVERY: 'RECOVERY_ONLY', LEGACY_TEXT_RECOVERY: 'RECOVERY_ONLY', APPROVED_PRODUCT_FACT: 'FORBIDDEN', UNKNOWN: 'FORBIDDEN' })]),
  ...CANONICAL_FIELDS.map((field) => [field, Object.freeze({ USER_EXPLICIT: 'ADMISSIBLE_CANDIDATE', CANONICAL_RESOLUTION: 'AUTHORITATIVE_WRITE', PROBLEM_DOMAIN_DECISION: ['resolved.problemDomain', 'resolved.concernContext'].includes(field) ? 'AUTHORITATIVE_WRITE' : 'ADMISSIBLE_CANDIDATE', APPROVED_PRODUCT_FACT: field === 'resolved.referencedProducts' ? 'ADMISSIBLE_CANDIDATE' : 'FORBIDDEN', ASSISTANT_OUTPUT_RECOVERY: 'RECOVERY_ONLY', LEGACY_TEXT_RECOVERY: 'RECOVERY_ONLY', UNKNOWN: 'FORBIDDEN' })]),
  ['derived.ownershipState', Object.freeze({ USER_EXPLICIT: 'ADMISSIBLE_CANDIDATE', CANONICAL_RESOLUTION: 'ADMISSIBLE_CANDIDATE', PROBLEM_DOMAIN_DECISION: 'AUTHORITATIVE_WRITE', APPROVED_PRODUCT_FACT: 'FORBIDDEN', ASSISTANT_OUTPUT_RECOVERY: 'DIAGNOSTIC_ONLY', LEGACY_TEXT_RECOVERY: 'DIAGNOSTIC_ONLY', UNKNOWN: 'FORBIDDEN' })],
  ...GOVERNANCE_FIELDS.map((field) => [field, Object.freeze({ USER_EXPLICIT: 'FORBIDDEN', CANONICAL_RESOLUTION: 'FORBIDDEN', PROBLEM_DOMAIN_DECISION: 'FORBIDDEN', APPROVED_PRODUCT_FACT: 'FORBIDDEN', ASSISTANT_OUTPUT_RECOVERY: 'FORBIDDEN', LEGACY_TEXT_RECOVERY: 'FORBIDDEN', UNKNOWN: 'FORBIDDEN' })])
]));

const FIELD_DEPENDENCY_POLICY = Object.freeze({
  'explicit.products': Object.freeze(['resolved.productFocus', 'governance'] ),
  'explicit.concerns': Object.freeze(['resolved.problemDomain', 'resolved.concernContext', 'governance']),
  'explicit.applicationAreas': Object.freeze(['resolved.applicationArea', 'governance']),
  'explicit.qualifiers': Object.freeze(['governance']),
  'resolved.productFocus': Object.freeze(['governance']),
  'resolved.problemDomain': Object.freeze(['resolved.concernContext', 'governance']),
  'resolved.concernContext': Object.freeze(['governance']),
  'resolved.applicationArea': Object.freeze(['governance']),
  'resolved.requestedProductType': Object.freeze(['governance']),
  'derived.ownershipState': Object.freeze(['governance']),
  governance: Object.freeze(['governance.authorizationStatus', 'governance.authorizedProductIds', 'governance.authorizationEvidenceIds'])
});
const FIELD_REPLACEMENT_POLICY = Object.freeze({
  'resolved.productFocus': Object.freeze({ requiresCanonicalResolution: true }),
  'resolved.applicationArea': Object.freeze({ currentTurnExplicitReplacesPrior: true }),
  'resolved.requestedProductType': Object.freeze({ currentTurnExplicitReplacesPrior: true })
});
const FIELD_CONFLICT_POLICY = Object.freeze({ default: 'CONFLICT', 'resolved.productFocus': 'AMBIGUOUS', 'resolved.applicationArea': 'CONFLICT' });
const FIELD_INVALIDATION_POLICY = Object.freeze({
  'resolved.productFocus': Object.freeze(['governance']),
  'resolved.concernContext': Object.freeze(['governance']),
  'resolved.applicationArea': Object.freeze(['governance']),
  'resolved.requestedProductType': Object.freeze(['governance']),
  'explicit.qualifiers': Object.freeze(['governance']),
  'derived.ownershipState': Object.freeze(['governance'])
});
const FIELD_PAYLOAD_POLICY = Object.freeze(Object.fromEntries([
  ...['explicit.concerns', 'explicit.applicationAreas', 'explicit.products', 'explicit.goal', 'explicit.complaintState', 'explicit.safetySignals', 'resolved.referencedProducts'].map((field) => [field, 'VALUE_EVIDENCE']),
  ['explicit.qualifiers', 'QUALIFIER_OBJECT'],
  ...['resolved.productFocus', 'resolved.problemDomain', 'resolved.concernContext', 'resolved.applicationArea', 'resolved.requestedProductType', 'resolved.commerceIntent', 'resolved.complaintIntent', 'resolved.safetyClass'].map((field) => [field, 'SCALAR_STRING']),
  ['derived.ownershipState', 'OWNERSHIP_ENUM'],
  ...TRANSITION_FIELD_PATHS.filter((field) => field.startsWith('governance.')).map((field) => [field, field === 'governance.authorizationStatus' ? 'AUTHORIZATION_STATE' : field.endsWith('authorizedProductIds') || field.endsWith('authorizationEvidenceIds') ? 'STRING_ARRAY' : 'GOVERNANCE_REFERENCE'])
]));

function policyFor(fieldPath, sourceType) { return FIELD_PROVENANCE_POLICY[fieldPath]?.[sourceType] || 'FORBIDDEN'; }
function isRecoveryOnly(sourceType) { return RECOVERY.includes(sourceType); }
function isAuthorizationCapableSource(sourceType) { return PROVENANCE_SOURCE_TYPES.includes(sourceType) && !isRecoveryOnly(sourceType) && sourceType !== 'UNKNOWN'; }
function getFieldDependents(fieldPath) { return FIELD_DEPENDENCY_POLICY[fieldPath] || (fieldPath.startsWith('governance.') ? ['governance'] : []); }
function getFieldInvalidationBoundary(fieldPath) { return FIELD_INVALIDATION_POLICY[fieldPath] || ['governance']; }

module.exports = { CLASSIFICATIONS, FIELD_PROVENANCE_POLICY, FIELD_DEPENDENCY_POLICY, FIELD_REPLACEMENT_POLICY, FIELD_CONFLICT_POLICY, FIELD_INVALIDATION_POLICY, FIELD_PAYLOAD_POLICY, policyFor, isRecoveryOnly, isAuthorizationCapableSource, getFieldDependents, getFieldInvalidationBoundary, OWNERSHIP_STATES };