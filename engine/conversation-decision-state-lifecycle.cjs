'use strict';

// R4A2D — pure, dormant authoritative decision-state lifecycle. This module
// owns one validated envelope and its accepted transition identities; it does
// not produce proposals, persist state, or participate in runtime routing.
const { ENVELOPE_VERSION, validateEnvelope } = require('./conversation-decision-envelope-schema.cjs');
const {
  validateTransitionEvent,
  validateTransitionBase,
  compareTransitionReplay
} = require('./conversation-decision-transition-validator.cjs');
const { reduceDecisionEnvelope } = require('./conversation-decision-reducer.cjs');
const { ADMISSION_STATUSES, ADMISSION_REASON_CODES } = require('./conversation-decision-proposal-adapter.cjs');

const LIFECYCLE_VERSION = 1;
const LIFECYCLE_STATUSES = Object.freeze([
  'INITIALIZED', 'COMMITTED', 'EXACT_REPLAY', 'NO_CHANGE', 'REJECTED'
]);
const LIFECYCLE_REASON_CODES = Object.freeze([
  'INVALID_INPUT', 'INVALID_STATE', 'INVALID_ADMISSION_RESULT',
  'CONVERSATION_MISMATCH', 'EVENT_ID_COLLISION', 'RESULT_MISMATCH',
  'STALE_BASE', 'FUTURE_BASE', 'INVALID_BASE'
]);
const INITIALIZE_KEYS = Object.freeze(['conversationId', 'turnId', 'createdAt', 'input']);
const STATE_KEYS = Object.freeze([
  'lifecycleVersion', 'conversationId', 'envelope', 'acceptedEvents', 'lastAcceptedTurnId'
]);
const COMMIT_KEYS = Object.freeze(['currentState', 'admissionResult']);

function dataObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

// Descriptor-only capture never invokes caller-owned accessors. Contract data
// is deliberately limited to finite, dense, acyclic plain data structures.
function captureData(value, seen = new Set()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value !== 'object') throw new Error('unsupported contract value');
  if (seen.has(value)) throw new Error('cyclic contract data');
  seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string')) throw new Error('symbol contract key');
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || descriptors.length?.value !== value.length) throw new Error('invalid contract array');
      const keys = Object.keys(descriptors).filter((key) => key !== 'length');
      if (keys.length !== value.length) throw new Error('sparse contract array');
      return keys.map((key, index) => {
        const descriptor = descriptors[String(index)];
        if (key !== String(index) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('invalid contract array entry');
        return captureData(descriptor.value, seen);
      });
    }
    if (!dataObject(value)) throw new Error('non-plain contract object');
    const result = {};
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('accessor contract value');
      result[key] = captureData(descriptor.value, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function exactKeys(value, keys) {
  return dataObject(value) && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function safeValid(validator, value) {
  try { return validator(value)?.valid === true; } catch { return false; }
}
function deepEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  if (dataObject(left) && dataObject(right)) {
    const leftKeys = Object.keys(left), rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
  }
  return false;
}
function result(status, reasonCode, state) { return { status, reasonCode, state }; }

function neutralEnvelope(input) {
  return {
    envelopeVersion: ENVELOPE_VERSION,
    stateVersion: 0,
    conversationId: input.conversationId,
    turnId: input.turnId,
    createdAt: input.createdAt,
    input: input.input,
    explicit: { concerns: [], applicationAreas: [], products: [], goal: null, qualifiers: [], complaintState: null, safetySignals: [] },
    resolved: { productFocus: null, referencedProducts: [], problemDomain: null, concernContext: null, applicationArea: null, requestedProductType: null, commerceIntent: null, complaintIntent: null, safetyClass: null },
    derived: { answerIntent: null, route: null, answerTarget: null, fallbackType: null, ownershipState: 'UNRESOLVED', isolationBoundary: null, ambiguity: null, evidenceIds: [] },
    governance: { scopeId: null, scopeVersion: null, criterionSetId: null, criterionSetVersion: null, bindingId: null, bindingVersion: null, reviewRecordId: null, wordingArtifactId: null, wordingArtifactVersion: null, wordingLocale: null, authorizationStatus: null, authorizationReason: null, authorizedProductIds: [], authorizationEvidenceIds: [] },
    provenance: [], fieldClears: [], fieldConflicts: [], fieldInvalidations: [],
    invalidation: { invalidatesTurnIds: [], invalidatesFields: [], reason: null, boundaryType: null }
  };
}

function initializeDecisionState(rawInput) {
  let input;
  try { input = captureData(rawInput); } catch { return result('REJECTED', 'INVALID_INPUT', null); }
  if (!exactKeys(input, INITIALIZE_KEYS) || !text(input.conversationId) || !text(input.turnId)
    || typeof input.createdAt !== 'string'
    || !dataObject(input.input) || typeof input.input.rawText !== 'string'
    || typeof input.input.normalizedText !== 'string') return result('REJECTED', 'INVALID_INPUT', null);
  const envelope = neutralEnvelope(input);
  if (!safeValid(validateEnvelope, envelope)) return result('REJECTED', 'INVALID_INPUT', null);
  return result('INITIALIZED', null, {
    lifecycleVersion: LIFECYCLE_VERSION,
    conversationId: input.conversationId,
    envelope,
    acceptedEvents: [],
    lastAcceptedTurnId: null
  });
}

function validState(state) {
  if (!exactKeys(state, STATE_KEYS) || state.lifecycleVersion !== LIFECYCLE_VERSION
    || !text(state.conversationId) || state.lastAcceptedTurnId !== null && !text(state.lastAcceptedTurnId)
    || !safeValid(validateEnvelope, state.envelope) || state.envelope.conversationId !== state.conversationId
    || !Array.isArray(state.acceptedEvents)) return false;
  const ids = new Set();
  let expectedBase = 0;
  for (let index = 0; index < state.acceptedEvents.length; index++) {
    const event = state.acceptedEvents[index];
    if (!safeValid(validateTransitionEvent, event) || event.conversationId !== state.conversationId
      || Object.is(event.baseStateVersion, -0)
      || ids.has(event.eventId) || event.baseEnvelopeVersion !== state.envelope.envelopeVersion
      || event.baseStateVersion !== expectedBase) return false;
    ids.add(event.eventId);
    const next = state.acceptedEvents[index + 1];
    if (next) {
      if (![expectedBase, expectedBase + 1].includes(next.baseStateVersion)) return false;
      expectedBase = next.baseStateVersion;
    }
  }
  if (state.acceptedEvents.length === 0) return state.envelope.stateVersion === 0 && state.lastAcceptedTurnId === null;
  const last = state.acceptedEvents[state.acceptedEvents.length - 1];
  return [last.baseStateVersion, last.baseStateVersion + 1].includes(state.envelope.stateVersion)
    && state.lastAcceptedTurnId === last.turnId;
}

function validAdmission(admission) {
  if (!dataObject(admission) || !ADMISSION_STATUSES.includes(admission.status)) return false;
  if (admission.status === 'ADMITTED') {
    return exactKeys(admission, ['status', 'reasonCode', 'transitionEvent', 'reducerResult', 'reducerReasonCode', 'nextEnvelope'])
      && admission.reasonCode === null && ['APPLIED', 'NO_OP'].includes(admission.reducerResult)
      && (admission.reducerReasonCode === null || text(admission.reducerReasonCode))
      && safeValid(validateTransitionEvent, admission.transitionEvent)
      && !Object.is(admission.transitionEvent.baseStateVersion, -0)
      && safeValid(validateEnvelope, admission.nextEnvelope);
  }
  if (admission.status === 'UNRESOLVED') {
    return exactKeys(admission, ['status', 'reasonCode', 'transitionEvent', 'reducerResult', 'reducerReasonCode', 'nextEnvelope', 'diagnostic'])
      && admission.reasonCode === 'UNRESOLVED_PROPOSAL' && admission.transitionEvent === null
      && admission.reducerResult === null && admission.reducerReasonCode === null && admission.nextEnvelope === null
      && exactKeys(admission.diagnostic, ['proposalId', 'conversationId', 'turnId', 'fieldPath', 'candidateValues'])
      && text(admission.diagnostic.proposalId) && text(admission.diagnostic.conversationId)
      && text(admission.diagnostic.turnId) && text(admission.diagnostic.fieldPath)
      && Array.isArray(admission.diagnostic.candidateValues);
  }
  if (admission.status === 'REJECTED') {
    return exactKeys(admission, ['status', 'reasonCode', 'transitionEvent', 'reducerResult', 'reducerReasonCode', 'nextEnvelope', 'errors'])
      && ADMISSION_REASON_CODES.includes(admission.reasonCode) && admission.transitionEvent === null && admission.reducerResult === null
      && admission.reducerReasonCode === null && admission.nextEnvelope === null && Array.isArray(admission.errors)
      && admission.errors.every((error) => typeof error === 'string');
  }
  return exactKeys(admission, ['status', 'reasonCode', 'transitionEvent', 'reducerResult', 'reducerReasonCode', 'nextEnvelope'])
    && ADMISSION_REASON_CODES.includes(admission.reasonCode) && safeValid(validateTransitionEvent, admission.transitionEvent)
    && admission.reducerResult === 'REJECTED' && text(admission.reducerReasonCode)
    && safeValid(validateEnvelope, admission.nextEnvelope);
}

function unchanged(status, reasonCode, state) { return result(status, reasonCode, captureData(state)); }

function commitAdmissionResult(rawInput) {
  let input;
  try { input = captureData(rawInput); } catch { return result('REJECTED', 'INVALID_INPUT', null); }
  if (!exactKeys(input, COMMIT_KEYS)) return result('REJECTED', 'INVALID_INPUT', null);
  if (!validState(input.currentState)) return result('REJECTED', 'INVALID_STATE', null);
  const state = input.currentState;
  if (!validAdmission(input.admissionResult)) return unchanged('REJECTED', 'INVALID_ADMISSION_RESULT', state);
  const admission = input.admissionResult;
  if (admission.status !== 'ADMITTED') return unchanged('NO_CHANGE', null, state);

  const event = admission.transitionEvent;
  if (event.conversationId !== state.conversationId || admission.nextEnvelope.conversationId !== state.conversationId) {
    return unchanged('REJECTED', 'CONVERSATION_MISMATCH', state);
  }
  const existing = state.acceptedEvents.find((accepted) => accepted.eventId === event.eventId);
  if (existing) {
    let replay;
    try { replay = compareTransitionReplay(existing, event).result; } catch { replay = 'INVALID'; }
    if (replay === 'EXACT_REPLAY') return unchanged('EXACT_REPLAY', null, state);
    return unchanged('REJECTED', replay === 'EVENT_ID_COLLISION' ? 'EVENT_ID_COLLISION' : 'INVALID_ADMISSION_RESULT', state);
  }

  let base;
  try { base = validateTransitionBase(event, state.envelope.stateVersion, state.envelope.envelopeVersion).result; } catch { base = 'INVALID_BASE'; }
  if (base !== 'ELIGIBLE') {
    const reasonCode = ['STALE_BASE', 'FUTURE_BASE', 'INVALID_BASE'].includes(base) ? base : 'INVALID_BASE';
    return unchanged('REJECTED', reasonCode, state);
  }

  let reduced;
  try { reduced = reduceDecisionEnvelope(state.envelope, event); } catch { return unchanged('REJECTED', 'RESULT_MISMATCH', state); }
  if (!reduced || !['APPLIED', 'NO_OP'].includes(reduced.result)
    || reduced.result !== admission.reducerResult
    || reduced.reasonCode !== admission.reducerReasonCode
    || !deepEqual(reduced.nextEnvelope, admission.nextEnvelope)) {
    return unchanged('REJECTED', 'RESULT_MISMATCH', state);
  }

  return result('COMMITTED', null, {
    lifecycleVersion: state.lifecycleVersion,
    conversationId: state.conversationId,
    envelope: captureData(reduced.nextEnvelope),
    acceptedEvents: [...state.acceptedEvents.map((accepted) => captureData(accepted)), captureData(event)],
    lastAcceptedTurnId: event.turnId
  });
}

module.exports = {
  initializeDecisionState,
  commitAdmissionResult,
  LIFECYCLE_VERSION,
  LIFECYCLE_STATUSES,
  LIFECYCLE_REASON_CODES
};
