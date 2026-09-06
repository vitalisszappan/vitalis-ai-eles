'use strict';

const {
  R4A2A_VERSION, TRANSITION_OPERATIONS, TRANSITION_EVENT_TYPES, TRANSITION_FIELD_PATHS,
  TRANSITION_BOUNDARY_TYPES, TRANSITION_REASON_CODES, PROVENANCE_SOURCE_TYPES
} = require('./conversation-decision-transition-schema.cjs');
const { policyFor, isRecoveryOnly, getFieldDependents } = require('./conversation-decision-field-policy.cjs');

function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function version(value) { return Number.isInteger(value) && value > 0; }
function uniqueStrings(value) { return Array.isArray(value) && new Set(value).size === value.length && value.every(text); }

function validateTransitionIdentity(event, errors) {
  for (const field of ['eventId', 'conversationId', 'turnId', 'fieldPath']) if (!text(event[field])) errors.push(`${field} is required`);
  if (!version(event.eventVersion)) errors.push('eventVersion is invalid');
  if (!version(event.baseEnvelopeVersion)) errors.push('baseEnvelopeVersion is invalid');
  if (!TRANSITION_FIELD_PATHS.includes(event.fieldPath)) errors.push('fieldPath is invalid');
}

function validateTransitionOperation(event, errors) {
  if (!TRANSITION_OPERATIONS.includes(event.operation)) errors.push('operation is invalid');
  if (!TRANSITION_EVENT_TYPES.includes(event.eventType)) errors.push('eventType is invalid');
  if (!event.provenance || !PROVENANCE_SOURCE_TYPES.includes(event.provenance.sourceType) || !text(event.provenance.evidenceId)) errors.push('provenance is invalid');
  if (event.operation === 'SET' && event.payload === undefined) errors.push('SET requires payload');
  if (event.operation === 'CONFLICT' && (!Array.isArray(event.payload?.candidates) || event.payload.candidates.length < 2)) errors.push('CONFLICT requires candidates');
  if (event.operation === 'INVALIDATE' && (!Array.isArray(event.payload?.invalidatesFields) || event.payload.invalidatesFields.length === 0)) errors.push('INVALIDATE requires fields');
  if (event.operation === 'CLEAR' && event.payload !== undefined && event.payload !== null) errors.push('CLEAR payload must be null');
  if (event.operation === 'UNSET' && event.payload !== undefined && event.payload !== null) errors.push('UNSET payload must be null');
  if (event.reasonCode !== undefined && !TRANSITION_REASON_CODES.includes(event.reasonCode)) errors.push('reasonCode is invalid');
  if (event.boundaryType !== undefined && !TRANSITION_BOUNDARY_TYPES.includes(event.boundaryType)) errors.push('boundaryType is invalid');
  if (event.evidenceIds !== undefined && !uniqueStrings(event.evidenceIds)) errors.push('evidenceIds are invalid');
  if (event.operation === 'SET' && isRecoveryOnly(event.provenance.sourceType)) errors.push('recovery cannot SET active state');
  if (event.operation === 'SET' && policyFor(event.fieldPath, event.provenance.sourceType) === 'FORBIDDEN') errors.push('provenance is forbidden for field');
  if (event.operation === 'INVALIDATE' && getFieldDependents(event.fieldPath).length === 0) errors.push('invalidation field has no declared dependency policy');
}

function validateTransitionEvent(event) {
  const errors = [];
  if (!event || typeof event !== 'object' || Array.isArray(event)) return { valid: false, errors: ['event must be an object'] };
  if (event.contractVersion !== R4A2A_VERSION) errors.push('contractVersion is invalid');
  validateTransitionIdentity(event, errors);
  validateTransitionOperation(event, errors);
  return { valid: errors.length === 0, errors };
}

function validateTransitionBatch(events) {
  const list = Array.isArray(events) ? events : [];
  const errors = [];
  const ids = new Set();
  list.forEach((event, index) => {
    const result = validateTransitionEvent(event);
    result.errors.forEach((error) => errors.push(`events[${index}].${error}`));
    if (ids.has(event?.eventId)) errors.push(`events[${index}].duplicate eventId`);
    if (event?.eventId) ids.add(event.eventId);
  });
  return { valid: errors.length === 0, errors };
}

module.exports = { validateTransitionEvent, validateTransitionBatch, validateTransitionIdentity, validateTransitionOperation, validateTransitionProvenance: (event) => validateTransitionEvent(event), validateTransitionDependencies: (event) => validateTransitionEvent(event) };