'use strict';

// R4A2F — pure, dormant, single-proposal turn orchestration. This module owns
// mechanical composition only; it performs no interpretation, allocation,
// persistence, routing, lookup, authorization, or runtime integration.
const { validateSemanticProposal } = require('./conversation-decision-semantic-proposal-contract.cjs');
const { admitSemanticProposal } = require('./conversation-decision-proposal-adapter.cjs');
const { compareTransitionReplay } = require('./conversation-decision-transition-validator.cjs');
const { reduceDecisionEnvelope } = require('./conversation-decision-reducer.cjs');
const { initializeDecisionState, commitAdmissionResult } = require('./conversation-decision-state-lifecycle.cjs');
const { createDecisionStateSnapshot, reconstructDecisionState } = require('./conversation-decision-state-snapshot.cjs');

const TURN_ORCHESTRATOR_VERSION = 1;
const TURN_STATUSES = Object.freeze(['COMMITTED', 'EXACT_REPLAY', 'NO_CHANGE', 'REJECTED']);
const TURN_REASON_CODES = Object.freeze([
  'INVALID_INPUT', 'INVALID_STATE_SOURCE', 'INVALID_GENESIS', 'INVALID_SNAPSHOT',
  'INVALID_PROPOSAL', 'INVALID_EVENT_ID', 'INVALID_EVENT_VERSION',
  'CONVERSATION_MISMATCH', 'EVENT_ID_COLLISION', 'REPLAY_MISMATCH',
  'ADMISSION_REJECTED', 'LIFECYCLE_REJECTED', 'SNAPSHOT_REJECTED'
]);
const INPUT_KEYS = Object.freeze(['currentSnapshot', 'genesis', 'proposal', 'eventId', 'eventVersion']);
const GENESIS_KEYS = Object.freeze(['conversationId', 'turnId', 'createdAt', 'input']);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function captureData(value, seen = new Set()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite contract number');
    return value;
  }
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
    if (!plainObject(value)) throw new Error('non-plain contract object');
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
  return plainObject(value) && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function safeValid(validator, value) {
  try { return validator(value)?.valid === true; } catch { return false; }
}
function result(status, reasonCode, admissionResult = null, lifecycleResult = null, previousSnapshot = null, nextSnapshot = null) {
  return { status, reasonCode, admissionResult, lifecycleResult, previousSnapshot, nextSnapshot };
}
function rejected(reasonCode, admissionResult = null, lifecycleResult = null, previousSnapshot = null) {
  return result('REJECTED', reasonCode, admissionResult, lifecycleResult, previousSnapshot, previousSnapshot ? captureData(previousSnapshot) : null);
}

function snapshotState(state) {
  const created = createDecisionStateSnapshot({ currentState: state });
  return created.status === 'SNAPSHOT_CREATED' ? created.snapshot : null;
}

// Rebuild only the accepted prefix using canonical reducer and lifecycle
// execution. This recovers the exact pre-event authority required for retry;
// no stored checkpoint participates in the replay.
function reconstructPrefix(snapshot, endExclusive) {
  const initialized = initializeDecisionState({
    conversationId: snapshot.conversationId,
    turnId: snapshot.genesis.turnId,
    createdAt: snapshot.genesis.createdAt,
    input: snapshot.genesis.input
  });
  if (initialized.status !== 'INITIALIZED') return null;
  let state = initialized.state;
  for (const event of snapshot.acceptedEvents.slice(0, endExclusive)) {
    let reduced;
    try { reduced = reduceDecisionEnvelope(state.envelope, event); } catch { return null; }
    if (!reduced || !['APPLIED', 'NO_OP'].includes(reduced.result)) return null;
    const committed = commitAdmissionResult({ currentState: state, admissionResult: {
      status: 'ADMITTED', reasonCode: null, transitionEvent: event,
      reducerResult: reduced.result, reducerReasonCode: reduced.reasonCode,
      nextEnvelope: reduced.nextEnvelope
    } });
    if (committed.status !== 'COMMITTED') return null;
    state = committed.state;
  }
  return state;
}

function processDecisionTurn(rawInput) {
  let input;
  try { input = captureData(rawInput); } catch { return rejected('INVALID_INPUT'); }
  if (!exactKeys(input, INPUT_KEYS)) return rejected('INVALID_INPUT');
  const hasSnapshot = input.currentSnapshot !== null;
  const hasGenesis = input.genesis !== null;
  if (hasSnapshot === hasGenesis || hasSnapshot && !plainObject(input.currentSnapshot)
    || hasGenesis && !exactKeys(input.genesis, GENESIS_KEYS)) return rejected('INVALID_STATE_SOURCE');
  if (!text(input.eventId)) return rejected('INVALID_EVENT_ID');
  if (!Number.isInteger(input.eventVersion) || input.eventVersion <= 0 || Object.is(input.eventVersion, -0)) return rejected('INVALID_EVENT_VERSION');
  if (!safeValid(validateSemanticProposal, input.proposal)) return rejected('INVALID_PROPOSAL');

  let state, previousSnapshot;
  if (hasSnapshot) {
    const reconstructed = reconstructDecisionState({ snapshot: input.currentSnapshot });
    if (reconstructed.status !== 'RECONSTRUCTED') return rejected('INVALID_SNAPSHOT');
    state = reconstructed.state;
    previousSnapshot = reconstructed.snapshot;
  } else {
    const initialized = initializeDecisionState(input.genesis);
    if (initialized.status !== 'INITIALIZED') return rejected('INVALID_GENESIS');
    state = initialized.state;
    previousSnapshot = snapshotState(state);
    if (!previousSnapshot) return rejected('SNAPSHOT_REJECTED');
  }

  if (input.proposal.conversationId !== state.conversationId) {
    return rejected('CONVERSATION_MISMATCH', null, null, previousSnapshot);
  }

  const existingIndex = state.acceptedEvents.findIndex((event) => event.eventId === input.eventId);
  if (existingIndex >= 0) {
    const existing = state.acceptedEvents[existingIndex];
    const preEventState = reconstructPrefix(previousSnapshot, existingIndex);
    if (!preEventState) return rejected('REPLAY_MISMATCH', null, null, previousSnapshot);
    const admission = admitSemanticProposal({
      currentEnvelope: preEventState.envelope,
      proposal: input.proposal,
      eventId: input.eventId,
      eventVersion: input.eventVersion,
      baseEnvelopeVersion: existing.baseEnvelopeVersion,
      baseStateVersion: existing.baseStateVersion
    });
    if (admission.status !== 'ADMITTED' || !admission.transitionEvent) {
      return rejected('EVENT_ID_COLLISION', admission, null, previousSnapshot);
    }
    let replay = 'INVALID';
    try { replay = compareTransitionReplay(existing, admission.transitionEvent).result; } catch { /* fail closed */ }
    if (replay !== 'EXACT_REPLAY') return rejected(replay === 'EVENT_ID_COLLISION' ? 'EVENT_ID_COLLISION' : 'REPLAY_MISMATCH', admission, null, previousSnapshot);
    const lifecycle = commitAdmissionResult({ currentState: state, admissionResult: admission });
    if (lifecycle.status !== 'EXACT_REPLAY') return rejected('LIFECYCLE_REJECTED', admission, lifecycle, previousSnapshot);
    return result('EXACT_REPLAY', null, captureData(admission), captureData(lifecycle), captureData(previousSnapshot), captureData(previousSnapshot));
  }

  const admission = admitSemanticProposal({
    currentEnvelope: state.envelope,
    proposal: input.proposal,
    eventId: input.eventId,
    eventVersion: input.eventVersion,
    baseEnvelopeVersion: state.envelope.envelopeVersion,
    baseStateVersion: state.envelope.stateVersion
  });
  if (admission.status === 'REJECTED' || admission.status === 'REDUCER_REJECTED') {
    return rejected('ADMISSION_REJECTED', admission, null, previousSnapshot);
  }
  const lifecycle = commitAdmissionResult({ currentState: state, admissionResult: admission });
  if (!['COMMITTED', 'NO_CHANGE'].includes(lifecycle.status)) {
    return rejected('LIFECYCLE_REJECTED', admission, lifecycle, previousSnapshot);
  }
  const nextSnapshot = snapshotState(lifecycle.state);
  if (!nextSnapshot) return rejected('SNAPSHOT_REJECTED', admission, lifecycle, previousSnapshot);
  const status = lifecycle.status === 'COMMITTED' ? 'COMMITTED' : 'NO_CHANGE';
  return result(status, null, captureData(admission), captureData(lifecycle), captureData(previousSnapshot), captureData(nextSnapshot));
}

module.exports = {
  processDecisionTurn,
  TURN_ORCHESTRATOR_VERSION,
  TURN_STATUSES,
  TURN_REASON_CODES
};
