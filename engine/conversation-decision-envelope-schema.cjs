'use strict';

const {
  CONCERNS,
  APPLICATION_AREAS,
  RECOMMENDATION_ROLES
} = require('./product-intelligence-schema.cjs');

const ENVELOPE_VERSION = 1;
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
function validDate(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function hasAll(object, fields) { return object && fields.every((field) => Object.prototype.hasOwnProperty.call(object, field)); }
function validEvidence(value) {
  return value && validId(value.evidenceId) && PROVENANCE_SOURCE_TYPES.includes(value.sourceType)
    && (value.sourceTurnId === undefined || value.sourceTurnId === null || validId(value.sourceTurnId))
    && (value.fieldPath === undefined || value.fieldPath === null || validId(value.fieldPath));
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
    for (const field of ['conversationId', 'turnId']) if (!validId(envelope[field])) errors.push(`${field} is required`);
    if (!validDate(envelope.createdAt)) errors.push('createdAt is invalid');
    for (const [name, fields] of [['explicit', explicitFields], ['resolved', resolvedFields], ['derived', derivedFields], ['governance', governanceFields]]) if (!hasAll(envelope[name], fields)) errors.push(`${name} section is invalid`);
    if (!Array.isArray(envelope.provenance) || envelope.provenance.some((item) => !validEvidence(item))) errors.push('provenance is invalid');
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