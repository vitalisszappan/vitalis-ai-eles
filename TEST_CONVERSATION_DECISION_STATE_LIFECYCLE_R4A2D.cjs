'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const lifecyclePath = path.join(__dirname, 'engine', 'conversation-decision-state-lifecycle.cjs');
const adapterPath = path.join(__dirname, 'engine', 'conversation-decision-proposal-adapter.cjs');
const lifecycle = require(lifecyclePath);
const { admitSemanticProposal } = require(adapterPath);
const { validateEnvelope } = require('./engine/conversation-decision-envelope-schema.cjs');
const { validateTransitionEvent } = require('./engine/conversation-decision-transition-validator.cjs');

let count = 0;
function test(name, fn) { try { fn(); count++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
function clone(value) { return structuredClone(value); }
function initInput(overrides = {}) {
  return {
    conversationId: 'conversation-1', turnId: 'turn-1', createdAt: '2026-09-30T08:00:00.000Z',
    input: { rawText: 'Nyakra keresek valamit', normalizedText: 'nyakra keresek valamit', source: 'user', locale: 'hu-HU' },
    ...overrides
  };
}
function initialized(overrides) {
  const result = lifecycle.initializeDecisionState(initInput(overrides));
  assert.equal(result.status, 'INITIALIZED');
  return result.state;
}
function proposal(overrides = {}) {
  return {
    proposalVersion: 1, proposalId: 'proposal-1', conversationId: 'conversation-1', turnId: 'turn-2',
    producerId: 'fixture:producer', fieldPath: 'resolved.applicationArea', disposition: 'SET', value: 'neck',
    provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'e-1', sourceTurnId: 'turn-2' },
    evidenceIds: ['e-1'], evidence: [{ evidenceId: 'e-1', sourceType: 'USER_EXPLICIT', fieldPath: 'resolved.applicationArea',
      sourceTurnId: 'turn-2', sourceReference: 'fixture:conversation-1/turn-2/input' }], ...overrides
  };
}
function admission(state, overrides = {}, proposalOverrides = {}) {
  return admitSemanticProposal({
    currentEnvelope: state.envelope, proposal: proposal(proposalOverrides), eventId: 'event-1', eventVersion: 1,
    baseEnvelopeVersion: state.envelope.envelopeVersion, baseStateVersion: state.envelope.stateVersion, ...overrides
  });
}
function commitOne(state = initialized()) {
  const admitted = admission(state);
  assert.equal(admitted.status, 'ADMITTED');
  const committed = lifecycle.commitAdmissionResult({ currentState: state, admissionResult: admitted });
  assert.equal(committed.status, 'COMMITTED');
  return { admitted, committed, state: committed.state };
}
function unresolvedAdmission() {
  return {
    status: 'UNRESOLVED', reasonCode: 'UNRESOLVED_PROPOSAL', transitionEvent: null,
    reducerResult: null, reducerReasonCode: null, nextEnvelope: null,
    diagnostic: { proposalId: 'p', conversationId: 'conversation-1', turnId: 'turn-2', fieldPath: 'resolved.productFocus', candidateValues: [] }
  };
}
function rejectedAdmission() {
  return { status: 'REJECTED', reasonCode: 'INVALID_PROPOSAL', transitionEvent: null, reducerResult: null,
    reducerReasonCode: null, nextEnvelope: null, errors: ['invalid'] };
}
function isolatedLifecycle(reduce) {
  const source = fs.readFileSync(lifecyclePath, 'utf8');
  const modules = {
    './conversation-decision-envelope-schema.cjs': require('./engine/conversation-decision-envelope-schema.cjs'),
    './conversation-decision-transition-validator.cjs': require('./engine/conversation-decision-transition-validator.cjs'),
    './conversation-decision-reducer.cjs': { reduceDecisionEnvelope: reduce },
    './conversation-decision-proposal-adapter.cjs': require('./engine/conversation-decision-proposal-adapter.cjs')
  };
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: lifecyclePath })((id) => modules[id], module, module.exports);
  return module.exports;
}

test('exact exports and frozen closed vocabularies', () => {
  assert.deepEqual(Object.keys(lifecycle).sort(), ['initializeDecisionState', 'commitAdmissionResult', 'LIFECYCLE_VERSION', 'LIFECYCLE_STATUSES', 'LIFECYCLE_REASON_CODES'].sort());
  assert.equal(lifecycle.LIFECYCLE_VERSION, 1);
  assert.deepEqual(lifecycle.LIFECYCLE_STATUSES, ['INITIALIZED', 'COMMITTED', 'EXACT_REPLAY', 'NO_CHANGE', 'REJECTED']);
  assert.deepEqual(lifecycle.LIFECYCLE_REASON_CODES, ['INVALID_INPUT', 'INVALID_STATE', 'INVALID_ADMISSION_RESULT', 'CONVERSATION_MISMATCH', 'EVENT_ID_COLLISION', 'RESULT_MISMATCH', 'STALE_BASE', 'FUTURE_BASE', 'INVALID_BASE']);
  assert.ok(Object.isFrozen(lifecycle.LIFECYCLE_STATUSES) && Object.isFrozen(lifecycle.LIFECYCLE_REASON_CODES));
});
test('initializes canonical neutral authoritative state', () => {
  const result = lifecycle.initializeDecisionState(initInput());
  assert.deepEqual(Object.keys(result), ['status', 'reasonCode', 'state']);
  assert.equal(result.status, 'INITIALIZED'); assert.equal(result.reasonCode, null);
  assert.deepEqual(Object.keys(result.state), ['lifecycleVersion', 'conversationId', 'envelope', 'acceptedEvents', 'lastAcceptedTurnId']);
  assert.equal(result.state.lifecycleVersion, 1); assert.equal(result.state.conversationId, 'conversation-1');
  assert.deepEqual(result.state.acceptedEvents, []); assert.equal(result.state.lastAcceptedTurnId, null);
  assert.equal(validateEnvelope(result.state.envelope).valid, true);
});
test('initial envelope preserves caller identity turn time and input', () => {
  const source = initInput(); const state = initialized();
  assert.equal(state.envelope.conversationId, source.conversationId); assert.equal(state.envelope.turnId, source.turnId);
  assert.equal(state.envelope.createdAt, source.createdAt); assert.deepEqual(state.envelope.input, source.input);
});
test('initial envelope contains every neutral section without authority', () => {
  const envelope = initialized().envelope;
  assert.equal(envelope.envelopeVersion, 1); assert.equal(envelope.stateVersion, 0);
  assert.deepEqual(envelope.explicit, { concerns: [], applicationAreas: [], products: [], goal: null, qualifiers: [], complaintState: null, safetySignals: [] });
  assert.ok(Object.values(envelope.resolved).every((value) => value === null || Array.isArray(value) && value.length === 0));
  assert.equal(envelope.derived.ownershipState, 'UNRESOLVED'); assert.deepEqual(envelope.derived.evidenceIds, []);
  assert.equal(envelope.governance.authorizationStatus, null); assert.deepEqual(envelope.governance.authorizedProductIds, []);
  assert.deepEqual(envelope.provenance, []); assert.deepEqual(envelope.fieldClears, []); assert.deepEqual(envelope.fieldConflicts, []); assert.deepEqual(envelope.fieldInvalidations, []);
});
test('initialization rejects invalid and open outer inputs', () => {
  for (const value of [null, undefined, 1, 'x', [], {}, { ...initInput(), extra: true }, { ...initInput(), conversationId: '' }, { ...initInput(), turnId: '' }, { ...initInput(), createdAt: 'bad' }, { ...initInput(), input: {} }]) {
    const result = lifecycle.initializeDecisionState(value); assert.equal(result.status, 'REJECTED'); assert.equal(result.reasonCode, 'INVALID_INPUT'); assert.equal(result.state, null);
  }
});
test('initialization does not alias caller input', () => {
  const source = initInput(); const state = lifecycle.initializeDecisionState(source).state;
  assert.notEqual(state.envelope.input, source.input); source.input.rawText = 'changed';
  assert.equal(state.envelope.input.rawText, 'Nyakra keresek valamit');
});
test('mutation of initialized result cannot mutate caller input', () => {
  const source = initInput(); const result = lifecycle.initializeDecisionState(source);
  result.state.envelope.input.locale = 'xx'; assert.equal(source.input.locale, 'hu-HU');
});
test('initialization is deterministic', () => assert.deepEqual(lifecycle.initializeDecisionState(initInput()), lifecycle.initializeDecisionState(initInput())));

test('commits APPLIED admission and records event once', () => {
  const { admitted, state } = commitOne();
  assert.equal(state.envelope.stateVersion, 1); assert.equal(state.envelope.resolved.applicationArea, 'neck');
  assert.deepEqual(state.acceptedEvents, [admitted.transitionEvent]); assert.equal(state.lastAcceptedTurnId, 'turn-2');
  assert.equal(validateTransitionEvent(state.acceptedEvents[0]).valid, true);
});
test('commit result has stable closed shape', () => {
  const result = commitOne().committed;
  assert.deepEqual(Object.keys(result), ['status', 'reasonCode', 'state']); assert.equal(result.reasonCode, null);
});
test('owned envelope turn metadata is not rewritten on commit', () => {
  const state = commitOne().state; assert.equal(state.envelope.turnId, 'turn-1'); assert.equal(state.lastAcceptedTurnId, 'turn-2');
});
test('commits canonical NO_OP and records it without version increment', () => {
  const first = commitOne().state;
  const admitted = admission(first, { eventId: 'event-2' }, { proposalId: 'proposal-2', turnId: 'turn-3', provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'e-2', sourceTurnId: 'turn-3' }, evidenceIds: ['e-2'], evidence: [{ evidenceId: 'e-2', sourceType: 'USER_EXPLICIT', fieldPath: 'resolved.applicationArea', sourceTurnId: 'turn-3', sourceReference: 'fixture:turn-3' }] });
  assert.equal(admitted.reducerResult, 'NO_OP');
  const result = lifecycle.commitAdmissionResult({ currentState: first, admissionResult: admitted });
  assert.equal(result.status, 'COMMITTED'); assert.equal(result.state.envelope.stateVersion, 1);
  assert.equal(result.state.acceptedEvents.length, 2); assert.equal(result.state.lastAcceptedTurnId, 'turn-3');
});
test('UNRESOLVED admission is NO_CHANGE', () => {
  const state = initialized(); const result = lifecycle.commitAdmissionResult({ currentState: state, admissionResult: unresolvedAdmission() });
  assert.equal(result.status, 'NO_CHANGE'); assert.equal(result.reasonCode, null); assert.deepEqual(result.state, state); assert.notEqual(result.state, state);
});
test('rejected admission is NO_CHANGE', () => {
  const state = initialized(); const result = lifecycle.commitAdmissionResult({ currentState: state, admissionResult: rejectedAdmission() });
  assert.equal(result.status, 'NO_CHANGE'); assert.deepEqual(result.state, state);
});
test('REDUCER_REJECTED admission is NO_CHANGE', () => {
  const state = initialized(); const rejected = admission(state, { baseStateVersion: 1 });
  assert.equal(rejected.status, 'REDUCER_REJECTED');
  assert.equal(lifecycle.commitAdmissionResult({ currentState: state, admissionResult: rejected }).status, 'NO_CHANGE');
});
test('cross-conversation transition is rejected', () => {
  const state = initialized(); const admitted = admission(state); admitted.transitionEvent.conversationId = 'other'; admitted.nextEnvelope.conversationId = 'other';
  assert.equal(lifecycle.commitAdmissionResult({ currentState: state, admissionResult: admitted }).reasonCode, 'CONVERSATION_MISMATCH');
});
test('malformed admission result is rejected', () => {
  const state = initialized(); const result = lifecycle.commitAdmissionResult({ currentState: state, admissionResult: { status: 'ADMITTED' } });
  assert.equal(result.status, 'REJECTED'); assert.equal(result.reasonCode, 'INVALID_ADMISSION_RESULT'); assert.deepEqual(result.state, state);
});
test('unknown R4A2C reason and open diagnostic are rejected', () => {
  const state = initialized();
  assert.equal(lifecycle.commitAdmissionResult({ currentState: state, admissionResult: { ...rejectedAdmission(), reasonCode: 'MADE_UP' } }).reasonCode, 'INVALID_ADMISSION_RESULT');
  assert.equal(lifecycle.commitAdmissionResult({ currentState: state, admissionResult: { ...unresolvedAdmission(), diagnostic: { ...unresolvedAdmission().diagnostic, extra: true } } }).reasonCode, 'INVALID_ADMISSION_RESULT');
});
test('malformed lifecycle state is rejected fail closed', () => {
  const state = initialized(); state.acceptedEvents = [{ bad: true }];
  const result = lifecycle.commitAdmissionResult({ currentState: state, admissionResult: unresolvedAdmission() });
  assert.equal(result.status, 'REJECTED'); assert.equal(result.reasonCode, 'INVALID_STATE'); assert.equal(result.state, null);
});
test('empty ledger cannot claim advanced state', () => {
  const state = initialized(); state.envelope.stateVersion = 1;
  assert.equal(lifecycle.commitAdmissionResult({ currentState: state, admissionResult: unresolvedAdmission() }).reasonCode, 'INVALID_STATE');
});
test('duplicate ledger event IDs invalidate state', () => {
  const state = commitOne().state; state.acceptedEvents.push(clone(state.acceptedEvents[0])); state.lastAcceptedTurnId = 'turn-2';
  assert.equal(lifecycle.commitAdmissionResult({ currentState: state, admissionResult: unresolvedAdmission() }).reasonCode, 'INVALID_STATE');
});

test('exact replay returns authoritative state without ledger append', () => {
  const first = commitOne(); const result = lifecycle.commitAdmissionResult({ currentState: first.state, admissionResult: first.admitted });
  assert.equal(result.status, 'EXACT_REPLAY'); assert.equal(result.state.acceptedEvents.length, 1); assert.deepEqual(result.state, first.state);
});
test('canonical reordered replay is exact', () => {
  const first = commitOne(); const replay = clone(first.admitted);
  replay.transitionEvent = { ...replay.transitionEvent, provenance: { evidenceId: 'e-1', sourceReference: 'fixture:conversation-1/turn-2/input', sourceTurnId: 'turn-2', sourceType: 'USER_EXPLICIT' } };
  assert.equal(lifecycle.commitAdmissionResult({ currentState: first.state, admissionResult: replay }).status, 'EXACT_REPLAY');
});
test('event ID collision rejects without state advance', () => {
  const first = commitOne(); const collision = clone(first.admitted); collision.transitionEvent.payload = 'scalp';
  const result = lifecycle.commitAdmissionResult({ currentState: first.state, admissionResult: collision });
  assert.equal(result.status, 'REJECTED'); assert.equal(result.reasonCode, 'EVENT_ID_COLLISION'); assert.deepEqual(result.state, first.state);
});
test('distinct event commits', () => {
  const first = commitOne().state;
  const admitted = admission(first, { eventId: 'event-2' }, { proposalId: 'proposal-2', value: 'scalp' });
  const result = lifecycle.commitAdmissionResult({ currentState: first, admissionResult: admitted });
  assert.equal(result.status, 'COMMITTED'); assert.equal(result.state.acceptedEvents.length, 2);
});

test('stale base reaches lifecycle and is rejected', () => {
  const original = initialized(); const oldAdmission = admission(original); const advanced = commitOne(original).state;
  const stale = clone(oldAdmission); stale.transitionEvent.eventId = 'stale-event';
  const result = lifecycle.commitAdmissionResult({ currentState: advanced, admissionResult: stale });
  assert.equal(result.reasonCode, 'STALE_BASE'); assert.deepEqual(result.state, advanced);
});
test('future base reaches lifecycle and is rejected', () => {
  const initial = initialized(); const advanced = commitOne(initial).state;
  const future = admission(advanced, { eventId: 'future-event' }, { proposalId: 'future-proposal', value: 'scalp' });
  const result = lifecycle.commitAdmissionResult({ currentState: initial, admissionResult: future });
  assert.equal(result.reasonCode, 'FUTURE_BASE'); assert.deepEqual(result.state, initial);
});
test('invalid base -0 is rejected as invalid admission', () => {
  const state = initialized(); const admitted = admission(state); admitted.transitionEvent.baseStateVersion = -0;
  const result = lifecycle.commitAdmissionResult({ currentState: state, admissionResult: admitted });
  assert.equal(result.reasonCode, 'INVALID_ADMISSION_RESULT');
});
test('invalid envelope base coordinate is invalid admission', () => {
  const state = initialized(); const admitted = admission(state); admitted.transitionEvent.baseEnvelopeVersion = 0;
  assert.equal(lifecycle.commitAdmissionResult({ currentState: state, admissionResult: admitted }).reasonCode, 'INVALID_ADMISSION_RESULT');
});

test('fabricated nextEnvelope is rejected', () => {
  const state = initialized(); const admitted = admission(state); admitted.nextEnvelope.resolved.applicationArea = 'scalp';
  assert.equal(lifecycle.commitAdmissionResult({ currentState: state, admissionResult: admitted }).reasonCode, 'RESULT_MISMATCH');
});
test('fabricated reducer status is rejected', () => {
  const state = initialized(); const admitted = admission(state); admitted.reducerResult = 'NO_OP';
  assert.equal(lifecycle.commitAdmissionResult({ currentState: state, admissionResult: admitted }).reasonCode, 'RESULT_MISMATCH');
});
test('fabricated reducer reason is rejected', () => {
  const state = initialized(); const admitted = admission(state); admitted.reducerReasonCode = 'fabricated';
  assert.equal(lifecycle.commitAdmissionResult({ currentState: state, admissionResult: admitted }).reasonCode, 'RESULT_MISMATCH');
});
test('fabricated next stateVersion is rejected', () => {
  const state = initialized(); const admitted = admission(state); admitted.nextEnvelope.stateVersion = 0;
  assert.equal(lifecycle.commitAdmissionResult({ currentState: state, admissionResult: admitted }).reasonCode, 'RESULT_MISMATCH');
});
test('owned envelope rather than supplied next history drives reduction', () => {
  const state = initialized(); const admitted = admission(state); admitted.nextEnvelope.provenance = [];
  assert.equal(lifecycle.commitAdmissionResult({ currentState: state, admissionResult: admitted }).reasonCode, 'RESULT_MISMATCH');
});

test('commit does not mutate currentState or admissionResult', () => {
  const state = initialized(), admitted = admission(state), beforeState = clone(state), beforeAdmission = clone(admitted);
  lifecycle.commitAdmissionResult({ currentState: state, admissionResult: admitted });
  assert.deepEqual(state, beforeState); assert.deepEqual(admitted, beforeAdmission);
});
test('committed output aliases neither input', () => {
  const state = initialized(), admitted = admission(state);
  const output = lifecycle.commitAdmissionResult({ currentState: state, admissionResult: admitted }).state;
  output.envelope.resolved.applicationArea = 'scalp'; output.acceptedEvents[0].payload = 'scalp';
  assert.equal(state.envelope.resolved.applicationArea, null); assert.equal(admitted.transitionEvent.payload, 'neck');
});
test('commit is deterministic', () => {
  const state = initialized(), admitted = admission(state);
  assert.deepEqual(lifecycle.commitAdmissionResult({ currentState: state, admissionResult: admitted }), lifecycle.commitAdmissionResult({ currentState: state, admissionResult: admitted }));
});

for (const [name, make] of [
  ['top-level accessor', () => Object.defineProperty({}, 'currentState', { enumerable: true, get() { throw new Error('getter'); } })],
  ['nested envelope accessor', () => { const state = initialized(); Object.defineProperty(state.envelope, 'conversationId', { enumerable: true, get() { throw new Error('getter'); } }); return { currentState: state, admissionResult: unresolvedAdmission() }; }],
  ['nested ledger accessor', () => { const state = initialized(); Object.defineProperty(state, 'acceptedEvents', { enumerable: true, get() { throw new Error('getter'); } }); return { currentState: state, admissionResult: unresolvedAdmission() }; }],
  ['nested admission accessor', () => { const admitted = unresolvedAdmission(); Object.defineProperty(admitted.diagnostic, 'proposalId', { enumerable: true, get() { throw new Error('getter'); } }); return { currentState: initialized(), admissionResult: admitted }; }],
  ['cycle', () => { const value = { currentState: initialized(), admissionResult: unresolvedAdmission() }; value.self = value; return value; }],
  ['symbol key', () => ({ currentState: initialized(), admissionResult: { ...unresolvedAdmission(), [Symbol('x')]: true } })],
  ['sparse array', () => { const state = initialized(); state.acceptedEvents = new Array(1); return { currentState: state, admissionResult: unresolvedAdmission() }; }],
  ['non-plain nested object', () => { const state = initialized(); state.envelope.input = new Map(); return { currentState: state, admissionResult: unresolvedAdmission() }; }]
]) test(`${name} cannot escape commit`, () => assert.doesNotThrow(() => { const result = lifecycle.commitAdmissionResult(make()); assert.equal(result.status, 'REJECTED'); }));
test('stateful initialization getter is never executed', () => {
  let calls = 0; const value = initInput(); Object.defineProperty(value.input, 'rawText', { enumerable: true, get() { calls++; if (calls > 1) throw new Error('later'); return 'x'; } });
  assert.doesNotThrow(() => assert.equal(lifecycle.initializeDecisionState(value).status, 'REJECTED')); assert.equal(calls, 0);
});
test('symbols and primitives are total at both public boundaries', () => {
  for (const value of [Symbol('x'), 1n, () => {}, null, undefined, true]) {
    assert.doesNotThrow(() => lifecycle.initializeDecisionState(value));
    assert.doesNotThrow(() => lifecycle.commitAdmissionResult(value));
  }
});

test('executable commit invokes canonical reducer exactly once', () => {
  let calls = 0; const real = require('./engine/conversation-decision-reducer.cjs').reduceDecisionEnvelope;
  const isolated = isolatedLifecycle((...args) => { calls++; return real(...args); });
  const state = initialized(), admitted = admission(state);
  assert.equal(isolated.commitAdmissionResult({ currentState: state, admissionResult: admitted }).status, 'COMMITTED'); assert.equal(calls, 1);
});
test('non-executable and invalid admission invoke reducer zero times', () => {
  let calls = 0; const isolated = isolatedLifecycle(() => { calls++; throw new Error('must not execute'); }); const state = initialized();
  assert.equal(isolated.commitAdmissionResult({ currentState: state, admissionResult: unresolvedAdmission() }).status, 'NO_CHANGE');
  assert.equal(isolated.commitAdmissionResult({ currentState: state, admissionResult: { status: 'ADMITTED' } }).status, 'REJECTED'); assert.equal(calls, 0);
});
test('exact replay invokes reducer zero times', () => {
  let calls = 0; const isolated = isolatedLifecycle(() => { calls++; throw new Error('must not execute'); }); const first = commitOne();
  assert.equal(isolated.commitAdmissionResult({ currentState: first.state, admissionResult: first.admitted }).status, 'EXACT_REPLAY'); assert.equal(calls, 0);
});

test('production source is dormant and uses only permitted contracts', () => {
  const source = fs.readFileSync(lifecyclePath, 'utf8');
  const imports = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]);
  assert.deepEqual(imports.sort(), ['./conversation-decision-envelope-schema.cjs', './conversation-decision-proposal-adapter.cjs', './conversation-decision-reducer.cjs', './conversation-decision-transition-validator.cjs'].sort());
  assert.doesNotMatch(source, /\b(?:fs|http|https|net|fetch|XMLHttpRequest|process\.env|Date\.now|new Date|Math\.random|crypto)\b/);
  assert.doesNotMatch(source, /server|router|planner|answer-service|conversation-context|conversation-memory|widget|catalog|page-context|supabase/i);
});
test('only explicitly approved dormant downstream contracts may import lifecycle', () => {
  const target = 'conversation-decision-state-lifecycle.cjs';
  const approvedDormantConsumers = new Set([
    'engine/conversation-decision-state-snapshot.cjs',
    'engine/conversation-decision-turn-orchestrator.cjs'
  ]);
  const unauthorizedImporters = (files, readSource) => files.filter((name) => !name.startsWith('TEST_')
    && name !== 'engine/conversation-decision-state-lifecycle.cjs'
    && readSource(name).includes(target)
    && !approvedDormantConsumers.has(name));
  const files = fs.readdirSync(__dirname).filter((name) => name.endsWith('.cjs')).concat(fs.readdirSync(path.join(__dirname, 'engine')).filter((name) => name.endsWith('.cjs')).map((name) => `engine/${name}`));
  const importers = files.filter((name) => !name.startsWith('TEST_') && name !== 'engine/conversation-decision-state-lifecycle.cjs'
    && fs.readFileSync(path.join(__dirname, name), 'utf8').includes(target));
  assert.deepEqual(importers, [
    'engine/conversation-decision-state-snapshot.cjs',
    'engine/conversation-decision-turn-orchestrator.cjs'
  ]);
  assert.deepEqual(unauthorizedImporters(files, (name) => fs.readFileSync(path.join(__dirname, name), 'utf8')), []);

  const importingSource = `require('./${target}')`;
  const simulated = [
    'engine/conversation-decision-state-snapshot.cjs', 'server.cjs',
    'engine/answer-planner.cjs', 'engine/arbitrary-new-module.cjs'
  ];
  assert.deepEqual(unauthorizedImporters(simulated, () => importingSource), [
    'server.cjs', 'engine/answer-planner.cjs', 'engine/arbitrary-new-module.cjs'
  ]);
  assert.equal(approvedDormantConsumers.size, 2);
  assert.equal(approvedDormantConsumers.has('engine/answer-planner.cjs'), false);
});

console.log(`PASS TEST_CONVERSATION_DECISION_STATE_LIFECYCLE_R4A2D (${count} cases)`);
