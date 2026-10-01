'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snapshotPath = path.join(__dirname, 'engine', 'conversation-decision-state-snapshot.cjs');
const snapshotApi = require(snapshotPath);
const { initializeDecisionState, commitAdmissionResult } = require('./engine/conversation-decision-state-lifecycle.cjs');
const { reduceDecisionEnvelope } = require('./engine/conversation-decision-reducer.cjs');
const { getInvalidationTargets } = require('./engine/conversation-decision-field-policy.cjs');

let count = 0;
function test(name, fn) { try { fn(); count++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
function clone(value) { return structuredClone(value); }
function initial() {
  const result = initializeDecisionState({
    conversationId: 'conversation-1', turnId: 'turn-1', createdAt: '2026-10-01T08:00:00.000Z',
    input: { rawText: 'Nyakra keresek terméket', normalizedText: 'nyakra keresek termeket', source: 'user', locale: 'hu-HU' }
  });
  assert.equal(result.status, 'INITIALIZED');
  return result.state;
}
function event(state, overrides = {}) {
  return {
    contractVersion: 1, eventId: `event-${state.acceptedEvents.length + 1}`, conversationId: state.conversationId,
    turnId: `turn-${state.acceptedEvents.length + 2}`, fieldPath: 'resolved.applicationArea', operation: 'SET',
    eventType: 'FIELD_TRANSITION', eventVersion: 1, baseEnvelopeVersion: state.envelope.envelopeVersion,
    baseStateVersion: state.envelope.stateVersion, provenance: { sourceType: 'USER_EXPLICIT', evidenceId: `e-${state.acceptedEvents.length + 1}` },
    payload: 'neck', evidenceIds: [`e-${state.acceptedEvents.length + 1}`], reasonCode: 'CURRENT_TURN_REPLACEMENT', ...overrides
  };
}
function commitEvent(state, transitionEvent) {
  const reduced = reduceDecisionEnvelope(state.envelope, transitionEvent);
  assert.ok(['APPLIED', 'NO_OP'].includes(reduced.result));
  const committed = commitAdmissionResult({ currentState: state, admissionResult: {
    status: 'ADMITTED', reasonCode: null, transitionEvent,
    reducerResult: reduced.result, reducerReasonCode: reduced.reasonCode, nextEnvelope: reduced.nextEnvelope
  } });
  assert.equal(committed.status, 'COMMITTED');
  return committed.state;
}
function appliedState() { const state = initial(); return commitEvent(state, event(state)); }
function mixedState() {
  const first = appliedState();
  return commitEvent(first, event(first, { eventId: 'event-2', turnId: 'turn-3', provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'e-2' }, evidenceIds: ['e-2'] }));
}
function multiState() {
  const first = appliedState();
  return commitEvent(first, event(first, { eventId: 'event-2', turnId: 'turn-3', payload: 'scalp', provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'e-2' }, evidenceIds: ['e-2'] }));
}
function makeSnapshot(state = initial()) {
  const result = snapshotApi.createDecisionStateSnapshot({ currentState: state });
  assert.equal(result.status, 'SNAPSHOT_CREATED');
  return result.snapshot;
}
function reconstruct(snapshot) { return snapshotApi.reconstructDecisionState({ snapshot }); }

test('exports exact closed public API', () => {
  assert.deepEqual(Object.keys(snapshotApi).sort(), ['createDecisionStateSnapshot', 'reconstructDecisionState', 'SNAPSHOT_VERSION', 'SNAPSHOT_STATUSES', 'SNAPSHOT_REASON_CODES'].sort());
  assert.equal(snapshotApi.SNAPSHOT_VERSION, 1);
  assert.deepEqual(snapshotApi.SNAPSHOT_STATUSES, ['SNAPSHOT_CREATED', 'RECONSTRUCTED', 'REJECTED']);
  assert.ok(Object.isFrozen(snapshotApi.SNAPSHOT_STATUSES) && Object.isFrozen(snapshotApi.SNAPSHOT_REASON_CODES));
});
test('empty initialized state round trips', () => {
  const state = initial(), created = snapshotApi.createDecisionStateSnapshot({ currentState: state });
  assert.deepEqual(Object.keys(created), ['status', 'reasonCode', 'snapshot', 'state']);
  assert.equal(created.status, 'SNAPSHOT_CREATED'); assert.equal(created.state, null);
  const restored = reconstruct(created.snapshot);
  assert.equal(restored.status, 'RECONSTRUCTED'); assert.deepEqual(restored.state, state);
});
test('snapshot has exact canonical shape', () => {
  const value = makeSnapshot();
  assert.deepEqual(Object.keys(value), ['snapshotVersion', 'lifecycleVersion', 'conversationId', 'genesis', 'acceptedEvents', 'checkpointEnvelope', 'lastAcceptedTurnId']);
  assert.deepEqual(Object.keys(value.genesis), ['turnId', 'createdAt', 'input']);
});
test('genesis is derived losslessly from canonical envelope', () => {
  const state = appliedState(), value = makeSnapshot(state);
  assert.equal(value.genesis.turnId, state.envelope.turnId); assert.equal(value.genesis.createdAt, state.envelope.createdAt);
  assert.deepEqual(value.genesis.input, state.envelope.input);
});
test('multi-event APPLIED replay reproduces state', () => {
  const state = multiState(), restored = reconstruct(makeSnapshot(state));
  assert.equal(restored.status, 'RECONSTRUCTED'); assert.deepEqual(restored.state, state); assert.equal(restored.state.envelope.stateVersion, 2);
});
test('mixed APPLIED and NO_OP replay preserves both events', () => {
  const state = mixedState(), restored = reconstruct(makeSnapshot(state));
  assert.equal(state.envelope.stateVersion, 1); assert.equal(state.acceptedEvents.length, 2);
  assert.equal(restored.state.acceptedEvents.length, 2); assert.equal(restored.state.envelope.stateVersion, 1);
});
test('CLEAR effects reconstruct', () => {
  let state = appliedState();
  state = commitEvent(state, event(state, { eventId: 'event-2', turnId: 'turn-3', operation: 'CLEAR', payload: null,
    reasonCode: 'EXPLICIT_CLEAR', provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'e-2' }, evidenceIds: ['e-2'] }));
  const restored = reconstruct(makeSnapshot(state));
  assert.equal(restored.state.envelope.resolved.applicationArea, null); assert.equal(restored.state.envelope.fieldClears.length, 1);
});
test('CONFLICT effects reconstruct without promoting candidates', () => {
  const state0 = initial();
  const state = commitEvent(state0, event(state0, { operation: 'CONFLICT', payload: { candidates: ['neck', 'scalp'] }, reasonCode: 'EVIDENCE_CONFLICT' }));
  const restored = reconstruct(makeSnapshot(state));
  assert.equal(restored.state.envelope.resolved.applicationArea, null); assert.equal(restored.state.envelope.fieldConflicts[0].status, 'UNRESOLVED');
});
test('INVALIDATE effects reconstruct', () => {
  const state0 = initial();
  const targets = getInvalidationTargets('resolved.applicationArea').slice(0, 2);
  const state = commitEvent(state0, event(state0, { operation: 'INVALIDATE', payload: { invalidatesFields: targets }, reasonCode: 'DEPENDENCY_INVALIDATED' }));
  const restored = reconstruct(makeSnapshot(state));
  assert.deepEqual(restored.state.envelope.fieldInvalidations.map((item) => item.targetFieldPath), targets);
});
test('snapshot and reconstruction are deterministic', () => {
  const state = multiState();
  assert.deepEqual(snapshotApi.createDecisionStateSnapshot({ currentState: state }), snapshotApi.createDecisionStateSnapshot({ currentState: state }));
  const value = makeSnapshot(state); assert.deepEqual(reconstruct(value), reconstruct(value));
});

test('reordered events fail closed', () => {
  const value = makeSnapshot(multiState()); value.acceptedEvents.reverse();
  assert.equal(reconstruct(value).status, 'REJECTED');
});
test('missing first event fails closed', () => {
  const value = makeSnapshot(multiState()); value.acceptedEvents.shift();
  assert.equal(reconstruct(value).status, 'REJECTED');
});
test('missing last event mismatches checkpoint', () => {
  const value = makeSnapshot(multiState()); value.acceptedEvents.pop();
  assert.equal(reconstruct(value).reasonCode, 'CHECKPOINT_MISMATCH');
});
test('extra event mismatches checkpoint', () => {
  const state = appliedState(), extended = commitEvent(state, event(state, { eventId: 'event-2', turnId: 'turn-3', payload: 'scalp', provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'e-2' }, evidenceIds: ['e-2'] }));
  const value = makeSnapshot(state); value.acceptedEvents.push(clone(extended.acceptedEvents[1])); value.lastAcceptedTurnId = 'turn-3';
  assert.equal(reconstruct(value).reasonCode, 'CHECKPOINT_MISMATCH');
});
test('dropped trailing NO_OP is detected by accepted-turn metadata', () => {
  const value = makeSnapshot(mixedState()); value.acceptedEvents.pop();
  assert.equal(reconstruct(value).reasonCode, 'LAST_ACCEPTED_TURN_MISMATCH');
});
test('duplicate event ID fails closed', () => {
  const value = makeSnapshot(appliedState()); value.acceptedEvents.push(clone(value.acceptedEvents[0]));
  assert.equal(reconstruct(value).reasonCode, 'DUPLICATE_EVENT_ID');
});
test('event-ID collision is distinct from exact duplicate', () => {
  const value = makeSnapshot(appliedState()), collision = clone(value.acceptedEvents[0]); collision.payload = 'scalp'; value.acceptedEvents.push(collision);
  assert.equal(reconstruct(value).reasonCode, 'EVENT_ID_COLLISION');
});
test('stale base fails closed', () => {
  const value = makeSnapshot(multiState()); value.acceptedEvents[1].baseStateVersion = 0;
  assert.equal(reconstruct(value).reasonCode, 'STALE_BASE');
});
test('future base fails closed', () => {
  const value = makeSnapshot(appliedState()); value.acceptedEvents[0].baseStateVersion = 1;
  assert.equal(reconstruct(value).reasonCode, 'FUTURE_BASE');
});
test('invalid negative base fails event validation', () => {
  const value = makeSnapshot(appliedState()); value.acceptedEvents[0].baseStateVersion = -1;
  assert.equal(reconstruct(value).reasonCode, 'INVALID_EVENT');
});
test('negative-zero base fails event validation', () => {
  const value = makeSnapshot(appliedState()); value.acceptedEvents[0].baseStateVersion = -0;
  assert.equal(reconstruct(value).reasonCode, 'INVALID_EVENT');
});
test('invalid envelope-version base fails event validation', () => {
  const value = makeSnapshot(appliedState()); value.acceptedEvents[0].baseEnvelopeVersion = 0;
  assert.equal(reconstruct(value).reasonCode, 'INVALID_EVENT');
});

test('fabricated checkpoint field is rejected', () => {
  const value = makeSnapshot(appliedState()); value.checkpointEnvelope.resolved.applicationArea = 'scalp';
  assert.equal(reconstruct(value).reasonCode, 'CHECKPOINT_MISMATCH');
});
test('fabricated checkpoint stateVersion is rejected', () => {
  const value = makeSnapshot(appliedState()); value.checkpointEnvelope.stateVersion = 7;
  assert.equal(reconstruct(value).reasonCode, 'CHECKPOINT_MISMATCH');
});
test('fabricated snapshot conversation identity is rejected', () => {
  const value = makeSnapshot(appliedState()); value.conversationId = 'other';
  assert.equal(reconstruct(value).reasonCode, 'CONVERSATION_MISMATCH');
});
test('fabricated checkpoint conversation identity is rejected', () => {
  const value = makeSnapshot(appliedState()); value.checkpointEnvelope.conversationId = 'other';
  assert.equal(reconstruct(value).reasonCode, 'CONVERSATION_MISMATCH');
});
test('fabricated lastAcceptedTurnId is rejected', () => {
  const value = makeSnapshot(appliedState()); value.lastAcceptedTurnId = 'other-turn';
  assert.equal(reconstruct(value).reasonCode, 'LAST_ACCEPTED_TURN_MISMATCH');
});
test('fabricated genesis is rejected by checkpoint comparison', () => {
  const value = makeSnapshot(appliedState()); value.genesis.input.rawText = 'fabricated';
  assert.equal(reconstruct(value).reasonCode, 'CHECKPOINT_MISMATCH');
});
test('event from another conversation is rejected', () => {
  const value = makeSnapshot(appliedState()); value.acceptedEvents[0].conversationId = 'other';
  assert.equal(reconstruct(value).reasonCode, 'CONVERSATION_MISMATCH');
});
test('open snapshot shape is rejected', () => {
  const value = makeSnapshot(); value.extra = true; assert.equal(reconstruct(value).reasonCode, 'INVALID_SNAPSHOT');
});
test('open genesis shape is rejected', () => {
  const value = makeSnapshot(); value.genesis.extra = true; assert.equal(reconstruct(value).reasonCode, 'INVALID_SNAPSHOT');
});
test('invalid current state cannot be snapshotted', () => {
  const state = initial(); state.envelope.stateVersion = 1;
  assert.equal(snapshotApi.createDecisionStateSnapshot({ currentState: state }).reasonCode, 'INVALID_STATE');
});
test('snapshot creation independently detects fabricated ledger', () => {
  const state = appliedState(); state.acceptedEvents[0].payload = 'scalp';
  assert.equal(snapshotApi.createDecisionStateSnapshot({ currentState: state }).reasonCode, 'INVALID_STATE');
});

test('snapshot creation does not alias state', () => {
  const state = appliedState(), value = makeSnapshot(state); value.checkpointEnvelope.resolved.applicationArea = 'scalp'; value.acceptedEvents[0].payload = 'scalp';
  assert.equal(state.envelope.resolved.applicationArea, 'neck'); assert.equal(state.acceptedEvents[0].payload, 'neck');
});
test('caller mutation after snapshot creation does not alter snapshot', () => {
  const state = appliedState(), value = makeSnapshot(state); state.envelope.input.rawText = 'changed';
  assert.equal(value.genesis.input.rawText, 'Nyakra keresek terméket');
});
test('reconstructed state aliases neither snapshot nor returned snapshot', () => {
  const source = makeSnapshot(appliedState()), restored = reconstruct(source);
  restored.state.envelope.input.rawText = 'state-change'; restored.snapshot.genesis.input.rawText = 'snapshot-change';
  assert.equal(source.genesis.input.rawText, 'Nyakra keresek terméket');
  assert.notEqual(restored.state.envelope.input.rawText, restored.snapshot.genesis.input.rawText);
});
test('caller mutation after reconstruction cannot alter returned state', () => {
  const source = makeSnapshot(appliedState()), restored = reconstruct(source); source.checkpointEnvelope.resolved.applicationArea = 'scalp';
  assert.equal(restored.state.envelope.resolved.applicationArea, 'neck');
});

for (const [name, make] of [
  ['top-level accessor', () => Object.defineProperty({}, 'snapshot', { enumerable: true, get() { throw new Error('getter'); } })],
  ['nested stateful accessor', () => { const value = makeSnapshot(); let calls = 0; Object.defineProperty(value.genesis.input, 'rawText', { enumerable: true, get() { if (++calls > 1) throw new Error('later'); return 'x'; } }); return { snapshot: value }; }],
  ['event accessor', () => { const value = makeSnapshot(appliedState()); Object.defineProperty(value.acceptedEvents[0], 'eventId', { enumerable: true, get() { throw new Error('getter'); } }); return { snapshot: value }; }],
  ['cycle', () => { const value = makeSnapshot(); value.self = value; return { snapshot: value }; }],
  ['symbol', () => { const value = makeSnapshot(); value[Symbol('x')] = true; return { snapshot: value }; }],
  ['sparse ledger', () => { const value = makeSnapshot(); value.acceptedEvents = new Array(1); return { snapshot: value }; }],
  ['custom prototype', () => { const value = makeSnapshot(); value.genesis.input = Object.create({ poisoned: true }); return { snapshot: value }; }],
  ['catchable proxy failure', () => ({ snapshot: new Proxy({}, { ownKeys() { throw new Error('proxy'); } }) })]
]) test(`${name} fails closed without escaping`, () => assert.doesNotThrow(() => assert.equal(snapshotApi.reconstructDecisionState(make()).status, 'REJECTED')));
test('hostile create input is total', () => {
  const state = initial(); Object.defineProperty(state.envelope, 'turnId', { enumerable: true, get() { throw new Error('getter'); } });
  assert.doesNotThrow(() => assert.equal(snapshotApi.createDecisionStateSnapshot({ currentState: state }).status, 'REJECTED'));
});
test('unsupported primitives are total', () => {
  for (const value of [null, undefined, true, 1, 1n, Symbol('x'), () => {}, []]) {
    assert.doesNotThrow(() => snapshotApi.createDecisionStateSnapshot(value));
    assert.doesNotThrow(() => snapshotApi.reconstructDecisionState(value));
  }
});
test('non-finite numbers fail closed', () => {
  const value = makeSnapshot(); value.genesis.input.extra = Infinity;
  assert.equal(reconstruct(value).status, 'REJECTED');
});

test('source imports only dormant canonical decision contracts', () => {
  const source = fs.readFileSync(snapshotPath, 'utf8');
  const imports = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]).sort();
  assert.deepEqual(imports, ['./conversation-decision-envelope-schema.cjs', './conversation-decision-reducer.cjs', './conversation-decision-state-lifecycle.cjs', './conversation-decision-transition-validator.cjs'].sort());
});
test('source has no I/O clock randomness environment or runtime coupling', () => {
  const source = fs.readFileSync(snapshotPath, 'utf8');
  assert.doesNotMatch(source, /\b(?:fs|http|https|net|fetch|XMLHttpRequest|process\.env|Date\.now|new Date|Math\.random|crypto|supabase|sql|jsonl)\b/i);
  assert.doesNotMatch(source, /server|widget|router|planner|answer-service|conversation-memory|product-catalog|page-context/i);
});
test('no existing production module imports snapshot module', () => {
  const target = 'conversation-decision-state-snapshot.cjs';
  const files = fs.readdirSync(path.join(__dirname, 'engine')).filter((name) => name.endsWith('.cjs') && name !== target);
  assert.deepEqual(files.filter((name) => fs.readFileSync(path.join(__dirname, 'engine', name), 'utf8').includes(target)), []);
});

console.log(`PASS TEST_CONVERSATION_DECISION_STATE_SNAPSHOT_R4A2E (${count} cases)`);
