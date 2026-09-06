'use strict';

const {
  R4A2A_VERSION, TRANSITION_OPERATIONS, TRANSITION_EVENT_TYPES, TRANSITION_FIELD_PATHS,
  TRANSITION_BOUNDARY_TYPES, TRANSITION_REASON_CODES, PROVENANCE_SOURCE_TYPES,
  TRANSITION_BASE_RESULTS, TRANSITION_REPLAY_RESULTS, OWNERSHIP_STATES, AUTHORIZATION_STATUSES
} = require('./conversation-decision-transition-schema.cjs');
const { policyFor, isRecoveryOnly, getFieldDependents, FIELD_PAYLOAD_POLICY } = require('./conversation-decision-field-policy.cjs');

function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function version(value) { return Number.isInteger(value) && value > 0; }
function uniqueStrings(value) { return Array.isArray(value) && new Set(value).size === value.length && value.every(text); }
function validPayloadKind(kind, payload) {
  if (kind === 'SCALAR_STRING' || kind === 'NULLABLE_STRING' || kind === 'GOVERNANCE_REFERENCE') return payload === null || text(payload);
  if (kind === 'STRING_ARRAY') return uniqueStrings(payload);
  if (kind === 'OWNERSHIP_ENUM') return OWNERSHIP_STATES.includes(payload);
  if (kind === 'AUTHORIZATION_STATE') return AUTHORIZATION_STATUSES.includes(payload);
  if (kind === 'VALUE_EVIDENCE') return Array.isArray(payload) && payload.every((item) => item && text(item.value) && uniqueStrings(item.evidenceIds));
  if (kind === 'QUALIFIER_OBJECT') return Array.isArray(payload) && payload.every((item) => item && text(item.key) && item.value !== undefined && uniqueStrings(item.evidenceIds));
  if (kind === 'CONFLICT_CANDIDATES') return uniqueStrings(payload);
  if (kind === 'INVALIDATION_FIELDS') return uniqueStrings(payload) && payload.every((field) => TRANSITION_FIELD_PATHS.includes(field));
  return false;
}

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
  if (event.operation === 'SET' && !validPayloadKind(FIELD_PAYLOAD_POLICY[event.fieldPath], event.payload)) errors.push('SET payload is incompatible with field');
  if (event.operation === 'CONFLICT' && !validPayloadKind('CONFLICT_CANDIDATES', event.payload?.candidates)) errors.push('CONFLICT candidates are invalid');
  if (event.operation === 'INVALIDATE' && !validPayloadKind('INVALIDATION_FIELDS', event.payload?.invalidatesFields)) errors.push('INVALIDATE targets are invalid');
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

function validateTransitionProvenance(input) {
  const provenance = input?.provenance;
  const errors = [];
  if (!provenance || !PROVENANCE_SOURCE_TYPES.includes(provenance.sourceType) || !text(provenance.evidenceId)) errors.push('provenance is invalid');
  if (isRecoveryOnly(provenance?.sourceType) && input?.operation === 'SET') errors.push('recovery cannot SET active state');
  return { valid: errors.length === 0, errors };
}

function validateTransitionDependencies(input) {
  const errors = [];
  if (!TRANSITION_FIELD_PATHS.includes(input?.fieldPath)) errors.push('fieldPath is invalid');
  if (input?.operation === 'INVALIDATE' && !validPayloadKind('INVALIDATION_FIELDS', input.payload?.invalidatesFields)) errors.push('INVALIDATE targets are invalid');
  return { valid: errors.length === 0, errors };
}

function canonicalizeTransitionEvent(event) {
  const result = { ...event, provenance: event?.provenance ? { ...event.provenance } : event?.provenance };
  if (Array.isArray(result.evidenceIds)) result.evidenceIds = [...result.evidenceIds].sort();
  if (result.operation === 'CONFLICT' && Array.isArray(result.payload?.candidates)) result.payload = { ...result.payload, candidates: [...result.payload.candidates].sort() };
  if (result.operation === 'INVALIDATE' && Array.isArray(result.payload?.invalidatesFields)) result.payload = { ...result.payload, invalidatesFields: [...result.payload.invalidatesFields].sort() };
  return result;
}

function compareTransitionReplay(existing, incoming) {
  const existingResult = validateTransitionEvent(existing);
  const incomingResult = validateTransitionEvent(incoming);
  if (!existingResult.valid || !incomingResult.valid) return { result: 'INVALID' };
  const a = canonicalizeTransitionEvent(existing), b = canonicalizeTransitionEvent(incoming);
  if (a.eventId !== b.eventId) return { result: 'DISTINCT_EVENT' };
  return { result: JSON.stringify(a) === JSON.stringify(b) ? 'EXACT_REPLAY' : 'EVENT_ID_COLLISION' };
}

function validateTransitionBase(event, currentEnvelopeVersion) {
  if (!Number.isInteger(currentEnvelopeVersion) || currentEnvelopeVersion < 1) return { result: 'INVALID_BASE' };
  if (!Number.isInteger(event?.baseEnvelopeVersion) || event.baseEnvelopeVersion < 1) return { result: 'INVALID_BASE' };
  return { result: event.baseEnvelopeVersion === currentEnvelopeVersion ? 'BASE_MATCH' : event.baseEnvelopeVersion < currentEnvelopeVersion ? 'STALE_BASE' : 'FUTURE_BASE' };
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

module.exports = { validateTransitionEvent, validateTransitionBatch, validateTransitionIdentity, validateTransitionOperation, validateTransitionProvenance, validateTransitionDependencies, canonicalizeTransitionEvent, compareTransitionReplay, validateTransitionBase, TRANSITION_BASE_RESULTS, TRANSITION_REPLAY_RESULTS };