'use strict';

const {
  CONCERNS,
  APPLICATION_AREAS,
  RECOMMENDATION_ROLES
} = require('./product-intelligence-schema.cjs');

const ENVELOPE_VERSION = 1;
const STATE_VERSION_MIN = 0;
const FIELD_CLEAR_STATUSES = Object.freeze(['EXPLICIT_CLEAR', 'NEVER_SET', 'INVALIDATED']);
const FIELD_CONFLICT_STATUSES = Object.freeze(['UNRESOLVED']);
const FIELD_INVALIDATION_STATUSES = Object.freeze(['NON_EXECUTABLE', 'INVALIDATED']);
const CLOSED_FIELD_PATHS = Object.freeze([
  'input.rawText', 'input.normalizedText', 'explicit.concerns', 'explicit.applicationAreas', 'explicit.products', 'explicit.goal',
  'explicit.qualifiers', 'explicit.complaintState', 'explicit.safetySignals', 'resolved.productFocus', 'resolved.referencedProducts',
  'resolved.problemDomain', 'resolved.concernContext', 'resolved.applicationArea', 'resolved.requestedProductType', 'resolved.commerceIntent',
  'resolved.complaintIntent', 'resolved.safetyClass', 'derived.answerIntent', 'derived.route', 'derived.answerTarget', 'derived.fallbackType',
  'derived.ownershipState', 'derived.isolationBoundary', 'derived.ambiguity', 'derived.evidenceIds', 'governance.scopeId', 'governance.scopeVersion',
  'governance.criterionSetId', 'governance.criterionSetVersion', 'governance.bindingId', 'governance.bindingVersion', 'governance.reviewRecordId',
  'governance.wordingArtifactId', 'governance.wordingArtifactVersion', 'governance.wordingLocale', 'governance.authorizationStatus', 'governance.authorizationReason',
  'governance.authorizedProductIds', 'governance.authorizationEvidenceIds'
]);
const PROVENANCE_SOURCE_TYPES = Object.freeze([
  'USER_EXPLICIT',
  'CANONICAL_RESOLUTION',
  'APPROVED_PRODUCT_FACT',
  'PROBLEM_DOMAIN_DECISION',
  'ASSISTANT_OUTPUT_RECOVERY',
  'LEGACY_TEXT_RECOVERY',
  'UNKNOWN'
]);
const OWNERSHIP_STATES = Object.freeze([
  'UNRESOLVED', 'SAFETY', 'MEDICAL', 'ACTIVE_COMPLAINT',
  'RESOLVED_COMPLAINT_TRANSITION', 'COMMERCE', 'SELECTION',
  'RECOMMENDATION', 'NEUTRAL_PRODUCT_FACT', 'FALLBACK', 'AMBIGUOUS'
]);
const SOURCE_KINDS = Object.freeze({
  USER_EXPLICIT: { authorizationCapable: true },
  CANONICAL_RESOLUTION: { authorizationCapable: true },
  APPROVED_PRODUCT_FACT: { authorizationCapable: true },
  PROBLEM_DOMAIN_DECISION: { authorizationCapable: true },
  ASSISTANT_OUTPUT_RECOVERY: { authorizationCapable: false },
  LEGACY_TEXT_RECOVERY: { authorizationCapable: false },
  UNKNOWN: { authorizationCapable: false }
});
const APPLICATION_AREA_VALUES = Object.freeze([
  ...new Set([...APPLICATION_AREAS, 'neck', 'hands', 'feet'])
]);
const PRODUCT_TYPE_VALUES = Object.freeze([
  'szappan', 'krem', 'balzsam', 'tusfurdo',
  'shampoo', 'shampoo_soap', 'solid_shampoo', 'liquid_shampoo'
]);
const GOAL_VALUES = Object.freeze([
  'selection', 'alternative', 'companion', 'usage_question',
  'suitability_question', 'comparison', 'clarification',
  'commerce', 'safety_escalation', 'complaint_resolution'
]);
const QUALIFIER_KEYS = Object.freeze([
  'severity', 'temporality', 'polarity', 'causality', 'negated',
  'hypothetical', 'reported', 'acneFrequencyOrIntensity',
  'skinOiliness', 'blackheads', 'dry'
]);
const AUTHORIZATION_STATUSES = Object.freeze([
  'AUTHORIZED', 'UNAVAILABLE', 'DENIED', 'INVALID', 'CONFLICT',
  'MEDICAL_ESCALATION', 'COMPLAINT_OWNED', null
]);

function validId(value) { return typeof value === 'string' && value.trim().length > 0; }
function validVersion(value) { return Number.isInteger(value) && value > 0; }
function validStateVersion(value) { return Number.isInteger(value) && value >= STATE_VERSION_MIN && !Object.is(value, -0); }
function validDate(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function hasAll(object, fields) { return object && fields.every((field) => Object.prototype.hasOwnProperty.call(object, field)); }
function validEvidence(value) {
  return value && validId(value.evidenceId) && PROVENANCE_SOURCE_TYPES.includes(value.sourceType)
    && (value.sourceTurnId === undefined || value.sourceTurnId === null || validId(value.sourceTurnId))
    && (value.fieldPath === undefined || value.fieldPath === null || validId(value.fieldPath));
}
function validFieldDiagnosticClear(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && validId(value.fieldPath) && CLOSED_FIELD_PATHS.includes(value.fieldPath)
    && FIELD_CLEAR_STATUSES.includes(value.status) && validId(value.reasonCode) && (value.sourceEventId === undefined || value.sourceEventId === null || validId(value.sourceEventId))
    && (value.sourceFieldPath === undefined || value.sourceFieldPath === null || (validId(value.sourceFieldPath) && CLOSED_FIELD_PATHS.includes(value.sourceFieldPath)));
}
function validFieldDiagnosticConflict(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && validId(value.fieldPath) && CLOSED_FIELD_PATHS.includes(value.fieldPath)
    && FIELD_CONFLICT_STATUSES.includes(value.status) && Array.isArray(value.candidateValues) && value.candidateValues.length > 0
    && value.candidateValues.every((candidate) => candidate !== undefined && candidate !== null && (typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean'))
    && validId(value.reasonCode) && (value.sourceEventId === undefined || value.sourceEventId === null || validId(value.sourceEventId));
}
function validFieldDiagnosticInvalidation(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && validId(value.targetFieldPath) && CLOSED_FIELD_PATHS.includes(value.targetFieldPath)
    && (value.sourceFieldPath === undefined || value.sourceFieldPath === null || (validId(value.sourceFieldPath) && CLOSED_FIELD_PATHS.includes(value.sourceFieldPath)))
    && (value.sourceEventId === undefined || value.sourceEventId === null || validId(value.sourceEventId)) && validId(value.reasonCode)
    && FIELD_INVALIDATION_STATUSES.includes(value.invalidationStatus);
}

function validateEnvelope(envelope) {
  const errors = [];
  const explicitFields = ['concerns', 'applicationAreas', 'products', 'goal', 'qualifiers', 'complaintState', 'safetySignals'];
  const resolvedFields = ['productFocus', 'referencedProducts', 'problemDomain', 'concernContext', 'applicationArea', 'requestedProductType', 'commerceIntent', 'complaintIntent', 'safetyClass'];
  const derivedFields = ['answerIntent', 'route', 'answerTarget', 'fallbackType', 'ownershipState', 'isolationBoundary', 'ambiguity', 'evidenceIds'];
  const governanceFields = ['scopeId', 'scopeVersion', 'criterionSetId', 'criterionSetVersion', 'bindingId', 'bindingVersion', 'reviewRecordId', 'wordingArtifactId', 'wordingArtifactVersion', 'wordingLocale', 'authorizationStatus', 'authorizationReason', 'authorizedProductIds', 'authorizationEvidenceIds'];
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) errors.push('envelope must be an object');
  else {
    if (envelope.envelopeVersion !== ENVELOPE_VERSION) errors.push('envelopeVersion is invalid');
    if (!validStateVersion(envelope.stateVersion)) errors.push('stateVersion is invalid');
    for (const field of ['conversationId', 'turnId']) if (!validId(envelope[field])) errors.push(`${field} is required`);
    if (!validDate(envelope.createdAt)) errors.push('createdAt is invalid');
    for (const [name, fields] of [['explicit', explicitFields], ['resolved', resolvedFields], ['derived', derivedFields], ['governance', governanceFields]]) if (!hasAll(envelope[name], fields)) errors.push(`${name} section is invalid`);
    if (!Array.isArray(envelope.provenance) || envelope.provenance.some((item) => !validEvidence(item))) errors.push('provenance is invalid');
    if (!Array.isArray(envelope.fieldClears) || envelope.fieldClears.some((item) => !validFieldDiagnosticClear(item))) errors.push('fieldClears is invalid');
    if (!Array.isArray(envelope.fieldConflicts) || envelope.fieldConflicts.some((item) => !validFieldDiagnosticConflict(item))) errors.push('fieldConflicts is invalid');
    if (!Array.isArray(envelope.fieldInvalidations) || envelope.fieldInvalidations.some((item) => !validFieldDiagnosticInvalidation(item))) errors.push('fieldInvalidations is invalid');
    if (!Array.isArray(envelope.invalidation?.invalidatesTurnIds) || !Array.isArray(envelope.invalidation?.invalidatesFields)) errors.push('invalidation is invalid');
    if (!OWNERSHIP_STATES.includes(envelope.derived?.ownershipState)) errors.push('ownershipState is invalid');
    if (!AUTHORIZATION_STATUSES.includes(envelope.governance?.authorizationStatus)) errors.push('authorizationStatus is invalid');
    if (envelope.derived?.answerTarget !== null && typeof envelope.derived?.answerTarget === 'object') errors.push('answerTarget is invalid');
    if (envelope.resolved?.concernContext !== null && !CONCERNS.includes(envelope.resolved.concernContext)) errors.push('concernContext is invalid');
    if (envelope.resolved?.applicationArea !== null && !APPLICATION_AREA_VALUES.includes(envelope.resolved.applicationArea)) errors.push('applicationArea is invalid');
    if (envelope.resolved?.requestedProductType !== null && !PRODUCT_TYPE_VALUES.includes(envelope.resolved.requestedProductType)) errors.push('requestedProductType is invalid');
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  ENVELOPE_VERSION,
  STATE_VERSION_MIN,
  FIELD_CLEAR_STATUSES,
  FIELD_CONFLICT_STATUSES,
  FIELD_INVALIDATION_STATUSES,
  CLOSED_FIELD_PATHS,
  PROVENANCE_SOURCE_TYPES,
  OWNERSHIP_STATES,
  SOURCE_KINDS,
  CONCERNS,
  APPLICATION_AREA_VALUES,
  PRODUCT_TYPE_VALUES,
  RECOMMENDATION_ROLES,
  GOAL_VALUES,
  QUALIFIER_KEYS,
  AUTHORIZATION_STATUSES,
  validateEnvelope
};