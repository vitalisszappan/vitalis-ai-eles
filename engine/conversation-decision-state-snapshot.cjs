'use strict';

// R4A2E — pure, dormant lifecycle snapshot and reconstruction. Accepted
// transition events plus genesis are executable reconstruction input;
// checkpointEnvelope is verification material only.
const { validateEnvelope } = require('./conversation-decision-envelope-schema.cjs');
const {
  validateTransitionEvent,
  validateTransitionBase,
  compareTransitionReplay
} = require('./conversation-decision-transition-validator.cjs');
const { reduceDecisionEnvelope } = require('./conversation-decision-reducer.cjs');
const {
  initializeDecisionState,
  commitAdmissionResult,
  LIFECYCLE_VERSION
} = require('./conversation-decision-state-lifecycle.cjs');

const SNAPSHOT_VERSION = 1;
const SNAPSHOT_STATUSES = Object.freeze(['SNAPSHOT_CREATED', 'RECONSTRUCTED', 'REJECTED']);
const SNAPSHOT_REASON_CODES = Object.freeze([
  'INVALID_INPUT', 'INVALID_STATE', 'INVALID_SNAPSHOT', 'INVALID_GENESIS',
  'INVALID_EVENT', 'DUPLICATE_EVENT_ID', 'EVENT_ID_COLLISION',
  'CONVERSATION_MISMATCH', 'STALE_BASE', 'FUTURE_BASE', 'INVALID_BASE',
  'REPLAY_REJECTED', 'CHECKPOINT_MISMATCH', 'LEDGER_MISMATCH',
  'LAST_ACCEPTED_TURN_MISMATCH'
]);
const CREATE_KEYS = Object.freeze(['currentState']);
const RECONSTRUCT_KEYS = Object.freeze(['snapshot']);
const SNAPSHOT_KEYS = Object.freeze([
  'snapshotVersion', 'lifecycleVersion', 'conversationId', 'genesis',
  'acceptedEvents', 'checkpointEnvelope', 'lastAcceptedTurnId'
]);
const GENESIS_KEYS = Object.freeze(['turnId', 'createdAt', 'input']);
const STATE_KEYS = Object.freeze([
  'lifecycleVersion', 'conversationId', 'envelope', 'acceptedEvents', 'lastAcceptedTurnId'
]);

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
function deepEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length
    && left.every((item, index) => deepEqual(item, right[index]));
  if (plainObject(left) && plainObject(right)) {
    const leftKeys = Object.keys(left), rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
  }
  return false;
}
function output(status, reasonCode, snapshot = null, state = null) {
  return { status, reasonCode, snapshot, state };
}
function reject(reasonCode) { return output('REJECTED', reasonCode); }

function validateSnapshotShape(snapshot) {
  return exactKeys(snapshot, SNAPSHOT_KEYS)
    && snapshot.snapshotVersion === SNAPSHOT_VERSION
    && snapshot.lifecycleVersion === LIFECYCLE_VERSION
    && text(snapshot.conversationId)
    && exactKeys(snapshot.genesis, GENESIS_KEYS)
    && text(snapshot.genesis.turnId)
    && typeof snapshot.genesis.createdAt === 'string'
    && plainObject(snapshot.genesis.input)
    && typeof snapshot.genesis.input.rawText === 'string'
    && typeof snapshot.genesis.input.normalizedText === 'string'
    && Array.isArray(snapshot.acceptedEvents)
    && safeValid(validateEnvelope, snapshot.checkpointEnvelope)
    && (snapshot.lastAcceptedTurnId === null || text(snapshot.lastAcceptedTurnId));
}

function replaySnapshot(snapshot) {
  if (!validateSnapshotShape(snapshot)) return reject('INVALID_SNAPSHOT');
  if (snapshot.checkpointEnvelope.conversationId !== snapshot.conversationId) return reject('CONVERSATION_MISMATCH');
  const initialized = initializeDecisionState({
    conversationId: snapshot.conversationId,
    turnId: snapshot.genesis.turnId,
    createdAt: snapshot.genesis.createdAt,
    input: snapshot.genesis.input
  });
  if (initialized.status !== 'INITIALIZED') return reject('INVALID_GENESIS');
  let state = initialized.state;
  const seen = [];

  for (const event of snapshot.acceptedEvents) {
    if (!safeValid(validateTransitionEvent, event) || Object.is(event.baseStateVersion, -0)) return reject('INVALID_EVENT');
    if (event.conversationId !== snapshot.conversationId) return reject('CONVERSATION_MISMATCH');
    const prior = seen.find((accepted) => accepted.eventId === event.eventId);
    if (prior) {
      let replay = 'INVALID';
      try { replay = compareTransitionReplay(prior, event).result; } catch { /* fail closed below */ }
      return reject(replay === 'EVENT_ID_COLLISION' ? 'EVENT_ID_COLLISION' : 'DUPLICATE_EVENT_ID');
    }
    let base = 'INVALID_BASE';
    try { base = validateTransitionBase(event, state.envelope.stateVersion, state.envelope.envelopeVersion).result; } catch { /* fail closed below */ }
    if (base !== 'ELIGIBLE') return reject(['STALE_BASE', 'FUTURE_BASE', 'INVALID_BASE'].includes(base) ? base : 'INVALID_BASE');
    let reduced;
    try { reduced = reduceDecisionEnvelope(state.envelope, event); } catch { return reject('REPLAY_REJECTED'); }
    if (!reduced || !['APPLIED', 'NO_OP'].includes(reduced.result)) return reject('REPLAY_REJECTED');
    const admissionResult = {
      status: 'ADMITTED', reasonCode: null, transitionEvent: event,
      reducerResult: reduced.result, reducerReasonCode: reduced.reasonCode,
      nextEnvelope: reduced.nextEnvelope
    };
    const committed = commitAdmissionResult({ currentState: state, admissionResult });
    if (committed.status !== 'COMMITTED') return reject('REPLAY_REJECTED');
    state = committed.state;
    seen.push(event);
  }

  if (!deepEqual(state.envelope, snapshot.checkpointEnvelope)) return reject('CHECKPOINT_MISMATCH');
  if (!deepEqual(state.acceptedEvents, snapshot.acceptedEvents)) return reject('LEDGER_MISMATCH');
  if (state.conversationId !== snapshot.conversationId) return reject('CONVERSATION_MISMATCH');
  if (state.lastAcceptedTurnId !== snapshot.lastAcceptedTurnId) return reject('LAST_ACCEPTED_TURN_MISMATCH');
  return output('RECONSTRUCTED', null, captureData(snapshot), captureData(state));
}

function reconstructDecisionState(rawInput) {
  let input;
  try { input = captureData(rawInput); } catch { return reject('INVALID_INPUT'); }
  if (!exactKeys(input, RECONSTRUCT_KEYS)) return reject('INVALID_INPUT');
  return replaySnapshot(input.snapshot);
}

function createDecisionStateSnapshot(rawInput) {
  let input;
  try { input = captureData(rawInput); } catch { return reject('INVALID_INPUT'); }
  if (!exactKeys(input, CREATE_KEYS) || !exactKeys(input.currentState, STATE_KEYS)) return reject('INVALID_INPUT');
  const state = input.currentState;
  if (state.lifecycleVersion !== LIFECYCLE_VERSION || !text(state.conversationId)
    || !safeValid(validateEnvelope, state.envelope) || !Array.isArray(state.acceptedEvents)
    || state.lastAcceptedTurnId !== null && !text(state.lastAcceptedTurnId)) return reject('INVALID_STATE');
  const snapshot = {
    snapshotVersion: SNAPSHOT_VERSION,
    lifecycleVersion: state.lifecycleVersion,
    conversationId: state.conversationId,
    genesis: {
      turnId: state.envelope.turnId,
      createdAt: state.envelope.createdAt,
      input: captureData(state.envelope.input)
    },
    acceptedEvents: state.acceptedEvents.map((event) => captureData(event)),
    checkpointEnvelope: captureData(state.envelope),
    lastAcceptedTurnId: state.lastAcceptedTurnId
  };
  const verified = replaySnapshot(snapshot);
  if (verified.status !== 'RECONSTRUCTED' || !deepEqual(verified.state, state)) return reject('INVALID_STATE');
  return output('SNAPSHOT_CREATED', null, captureData(snapshot), null);
}

module.exports = {
  createDecisionStateSnapshot,
  reconstructDecisionState,
  SNAPSHOT_VERSION,
  SNAPSHOT_STATUSES,
  SNAPSHOT_REASON_CODES
};
