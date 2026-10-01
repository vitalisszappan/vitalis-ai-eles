'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const orchestratorPath = path.join(__dirname, 'engine', 'conversation-decision-turn-orchestrator.cjs');
const orchestrator = require(orchestratorPath);
const { reconstructDecisionState } = require('./engine/conversation-decision-state-snapshot.cjs');

let count = 0;
function test(name, fn) { try { fn(); count++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
function clone(value) { return structuredClone(value); }
function genesis(overrides = {}) {
  return { conversationId: 'conversation-1', turnId: 'turn-1', createdAt: '2026-10-01T08:00:00.000Z',
    input: { rawText: 'Nyakra keresek terméket', normalizedText: 'nyakra keresek termeket', source: 'user', locale: 'hu-HU' }, ...overrides };
}
function proposal(overrides = {}) {
  const base = {
    proposalVersion: 1, proposalId: 'proposal-1', conversationId: 'conversation-1', turnId: 'turn-1',
    producerId: 'fixture:producer', fieldPath: 'resolved.applicationArea', disposition: 'SET', value: 'neck',
    provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'e-1', sourceTurnId: 'turn-1' },
    evidenceIds: ['e-1'], evidence: [{ evidenceId: 'e-1', sourceType: 'USER_EXPLICIT', fieldPath: 'resolved.applicationArea',
      sourceTurnId: 'turn-1', sourceReference: 'fixture:conversation-1/turn-1/input' }]
  };
  return { ...base, ...overrides };
}
function proposalFor(value, id, turn = 'turn-2') {
  return proposal({ proposalId: `proposal-${id}`, turnId: turn, value,
    provenance: { sourceType: 'USER_EXPLICIT', evidenceId: `e-${id}`, sourceTurnId: turn }, evidenceIds: [`e-${id}`],
    evidence: [{ evidenceId: `e-${id}`, sourceType: 'USER_EXPLICIT', fieldPath: 'resolved.applicationArea', sourceTurnId: turn, sourceReference: `fixture:${turn}` }] });
}
function unresolved() {
  const value = proposal({ fieldPath: 'resolved.productFocus', disposition: 'UNRESOLVED', referenceResolutionStatus: 'unresolved' });
  delete value.value; value.evidence[0].fieldPath = value.fieldPath; return value;
}
function ownershipNoOp() {
  return {
    proposalVersion: 1, proposalId: 'proposal-own', conversationId: 'conversation-1', turnId: 'turn-1', producerId: 'fixture:domain',
    fieldPath: 'derived.ownershipState', disposition: 'SET', value: 'UNRESOLVED',
    provenance: { sourceType: 'PROBLEM_DOMAIN_DECISION', evidenceId: 'domain-1', sourceTurnId: 'turn-1' }, evidenceIds: ['domain-1'],
    evidence: [{ evidenceId: 'user-own', sourceType: 'USER_EXPLICIT', fieldPath: 'derived.ownershipState', sourceTurnId: 'turn-1', sourceReference: 'fixture:input' },
      { evidenceId: 'domain-1', sourceType: 'PROBLEM_DOMAIN_DECISION', fieldPath: 'derived.ownershipState', sourceTurnId: 'turn-1', sourceReference: 'fixture:domain', producerId: 'fixture:domain', supportEvidenceIds: ['user-own'] }]
  };
}
function input(p = proposal(), overrides = {}) {
  return { currentSnapshot: null, genesis: genesis(), proposal: p, eventId: 'event-1', eventVersion: 1, ...overrides };
}
function process(value) { return orchestrator.processDecisionTurn(value); }
function first() { const result = process(input()); assert.equal(result.status, 'COMMITTED'); return result; }

test('exact exports and closed frozen vocabularies', () => {
  assert.deepEqual(Object.keys(orchestrator).sort(), ['processDecisionTurn', 'TURN_ORCHESTRATOR_VERSION', 'TURN_STATUSES', 'TURN_REASON_CODES'].sort());
  assert.equal(orchestrator.TURN_ORCHESTRATOR_VERSION, 1);
  assert.deepEqual(orchestrator.TURN_STATUSES, ['COMMITTED', 'EXACT_REPLAY', 'NO_CHANGE', 'REJECTED']);
  assert.ok(Object.isFrozen(orchestrator.TURN_STATUSES) && Object.isFrozen(orchestrator.TURN_REASON_CODES));
});
test('genesis to first APPLIED commit', () => {
  const result = first(); assert.equal(result.admissionResult.reducerResult, 'APPLIED');
  assert.equal(result.lifecycleResult.status, 'COMMITTED'); assert.equal(result.nextSnapshot.checkpointEnvelope.stateVersion, 1);
  assert.equal(result.nextSnapshot.checkpointEnvelope.resolved.applicationArea, 'neck');
});
test('stable output shape', () => assert.deepEqual(Object.keys(first()), ['status', 'reasonCode', 'admissionResult', 'lifecycleResult', 'previousSnapshot', 'nextSnapshot']));
test('genesis accepted NO_OP is committed to ledger', () => {
  const result = process(input(ownershipNoOp()));
  assert.equal(result.status, 'COMMITTED'); assert.equal(result.admissionResult.reducerResult, 'NO_OP');
  assert.equal(result.nextSnapshot.checkpointEnvelope.stateVersion, 0); assert.equal(result.nextSnapshot.acceptedEvents.length, 1);
});
test('existing snapshot advances next event', () => {
  const one = first(); const result = process(input(proposalFor('scalp', '2'), { currentSnapshot: one.nextSnapshot, genesis: null, eventId: 'event-2' }));
  assert.equal(result.status, 'COMMITTED'); assert.equal(result.nextSnapshot.checkpointEnvelope.stateVersion, 2);
  assert.equal(result.nextSnapshot.checkpointEnvelope.resolved.applicationArea, 'scalp');
});
test('SET coordinates come from genesis authority', () => {
  const result = first(), event = result.admissionResult.transitionEvent;
  assert.equal(event.baseEnvelopeVersion, 1); assert.equal(event.baseStateVersion, 0); assert.equal(event.eventId, 'event-1');
});
test('next SET coordinates come from reconstructed authority', () => {
  const one = first(); const result = process(input(proposalFor('scalp', '2'), { currentSnapshot: one.nextSnapshot, genesis: null, eventId: 'event-2' }));
  assert.equal(result.admissionResult.transitionEvent.baseStateVersion, 1);
});
test('CLEAR commits through all layers', () => {
  const one = first(), clear = proposalFor(undefined, '2'); delete clear.value; clear.disposition = 'CLEAR'; clear.evidence[0].disposition = 'CLEAR';
  const result = process(input(clear, { currentSnapshot: one.nextSnapshot, genesis: null, eventId: 'event-2' }));
  assert.equal(result.status, 'COMMITTED'); assert.equal(result.nextSnapshot.checkpointEnvelope.resolved.applicationArea, null);
  assert.equal(result.nextSnapshot.checkpointEnvelope.fieldClears.length, 1);
});
test('CONFLICT commits without promoting candidate', () => {
  const conflict = proposalFor(undefined, '1', 'turn-1'); delete conflict.value; conflict.disposition = 'CONFLICT';
  conflict.evidence.push({ ...conflict.evidence[0], evidenceId: 'e-2', sourceReference: 'fixture:second' });
  conflict.candidates = [{ value: 'neck', evidenceIds: ['e-1'] }, { value: 'scalp', evidenceIds: ['e-2'] }];
  const result = process(input(conflict)); assert.equal(result.status, 'COMMITTED');
  assert.equal(result.nextSnapshot.checkpointEnvelope.resolved.applicationArea, null); assert.equal(result.nextSnapshot.checkpointEnvelope.fieldConflicts.length, 1);
});
test('UNRESOLVED proposal produces NO_CHANGE', () => {
  const result = process(input(unresolved())); assert.equal(result.status, 'NO_CHANGE'); assert.equal(result.admissionResult.status, 'UNRESOLVED');
  assert.equal(result.nextSnapshot.checkpointEnvelope.stateVersion, 0); assert.deepEqual(result.nextSnapshot, result.previousSnapshot);
});
test('invalid proposal rejects without state result', () => {
  const p = proposal(); p.value = 'invalid-area'; const result = process(input(p));
  assert.equal(result.status, 'REJECTED'); assert.equal(result.reasonCode, 'INVALID_PROPOSAL'); assert.equal(result.admissionResult, null);
});

test('exact duplicate retry at first accepted event', () => {
  const one = first(); const retry = process(input(proposal(), { currentSnapshot: one.nextSnapshot, genesis: null }));
  assert.equal(retry.status, 'EXACT_REPLAY'); assert.equal(retry.lifecycleResult.status, 'EXACT_REPLAY');
  assert.equal(retry.nextSnapshot.acceptedEvents.length, 1); assert.deepEqual(retry.nextSnapshot, one.nextSnapshot);
});
test('duplicate retry after state advanced further uses original coordinates', () => {
  const one = first(); const two = process(input(proposalFor('scalp', '2'), { currentSnapshot: one.nextSnapshot, genesis: null, eventId: 'event-2' }));
  const retry = process(input(proposal(), { currentSnapshot: two.nextSnapshot, genesis: null, eventId: 'event-1' }));
  assert.equal(retry.status, 'EXACT_REPLAY'); assert.equal(retry.admissionResult.transitionEvent.baseStateVersion, 0);
  assert.equal(retry.nextSnapshot.acceptedEvents.length, 2); assert.equal(retry.nextSnapshot.checkpointEnvelope.stateVersion, 2);
});
test('retry after independent R4A2E reconstruction remains exact', () => {
  const one = first(); const restored = reconstructDecisionState({ snapshot: one.nextSnapshot }); assert.equal(restored.status, 'RECONSTRUCTED');
  const retry = process(input(proposal(), { currentSnapshot: restored.snapshot, genesis: null })); assert.equal(retry.status, 'EXACT_REPLAY');
});
test('changed payload with accepted event ID is collision', () => {
  const one = first(); const collision = process(input(proposalFor('scalp', '1', 'turn-1'), { currentSnapshot: one.nextSnapshot, genesis: null }));
  assert.equal(collision.status, 'REJECTED'); assert.equal(collision.reasonCode, 'EVENT_ID_COLLISION');
  assert.equal(collision.nextSnapshot.acceptedEvents.length, 1);
});
test('changed eventVersion with accepted event ID is collision', () => {
  const one = first(); const collision = process(input(proposal(), { currentSnapshot: one.nextSnapshot, genesis: null, eventVersion: 2 }));
  assert.equal(collision.reasonCode, 'EVENT_ID_COLLISION');
});
test('changed turn correlation with accepted event ID is collision', () => {
  const one = first(); const collision = process(input(proposalFor('neck', '1', 'other-turn'), { currentSnapshot: one.nextSnapshot, genesis: null }));
  assert.equal(collision.reasonCode, 'EVENT_ID_COLLISION');
});
test('replay never duplicates ledger', () => {
  const one = first(); const retry = process(input(proposal(), { currentSnapshot: one.nextSnapshot, genesis: null }));
  assert.deepEqual(retry.nextSnapshot.acceptedEvents, one.nextSnapshot.acceptedEvents);
});

test('caller cannot inject top-level base coordinates', () => {
  const result = process({ ...input(), baseStateVersion: 99 }); assert.equal(result.reasonCode, 'INVALID_INPUT');
});
test('caller cannot inject proposal base coordinates', () => {
  const p = proposal({ baseStateVersion: 99 }); assert.equal(process(input(p)).reasonCode, 'INVALID_PROPOSAL');
});
test('event identity is preserved exactly', () => assert.equal(process(input(proposal(), { eventId: 'caller-stable-id' })).admissionResult.transitionEvent.eventId, 'caller-stable-id'));
test('invalid event identity rejected', () => { for (const value of ['', '  ', null, 1]) assert.equal(process(input(proposal(), { eventId: value })).reasonCode, 'INVALID_EVENT_ID'); });
test('invalid event version rejected including -0', () => {
  for (const value of [0, -0, -1, 1.5, '1']) assert.equal(process(input(proposal(), { eventVersion: value })).reasonCode, 'INVALID_EVENT_VERSION');
  for (const value of [NaN, Infinity]) assert.equal(process(input(proposal(), { eventVersion: value })).reasonCode, 'INVALID_INPUT');
});
test('both state sources rejected', () => assert.equal(process(input(proposal(), { currentSnapshot: first().nextSnapshot })).reasonCode, 'INVALID_STATE_SOURCE'));
test('neither state source rejected', () => assert.equal(process(input(proposal(), { genesis: null })).reasonCode, 'INVALID_STATE_SOURCE'));
test('conversation mismatch rejects without advancement', () => {
  const one = first(), p = proposal({ conversationId: 'other' }); const result = process(input(p, { currentSnapshot: one.nextSnapshot, genesis: null, eventId: 'event-2' }));
  assert.equal(result.reasonCode, 'CONVERSATION_MISMATCH'); assert.deepEqual(result.nextSnapshot, one.nextSnapshot);
});
test('malformed genesis rejected', () => assert.equal(process(input(proposal(), { genesis: { bad: true } })).reasonCode, 'INVALID_STATE_SOURCE'));
test('invalid genesis date rejected', () => assert.equal(process(input(proposal(), { genesis: genesis({ createdAt: 'bad' }) })).reasonCode, 'INVALID_GENESIS'));
test('malformed snapshot rejected', () => assert.equal(process(input(proposal(), { currentSnapshot: { bad: true }, genesis: null })).reasonCode, 'INVALID_SNAPSHOT'));
test('fabricated checkpoint rejected before proposal admission', () => {
  const one = first(), value = clone(one.nextSnapshot); value.checkpointEnvelope.stateVersion = 8;
  assert.equal(process(input(proposalFor('scalp', '2'), { currentSnapshot: value, genesis: null, eventId: 'event-2' })).reasonCode, 'INVALID_SNAPSHOT');
});
test('concurrent calls from same snapshot receive same owned base without mutating it', () => {
  const one = first(), source = clone(one.nextSnapshot);
  const a = process(input(proposalFor('scalp', '2'), { currentSnapshot: source, genesis: null, eventId: 'event-a' }));
  const b = process(input(proposalFor('face', '3'), { currentSnapshot: source, genesis: null, eventId: 'event-b' }));
  assert.equal(a.admissionResult.transitionEvent.baseStateVersion, 1); assert.equal(b.admissionResult.transitionEvent.baseStateVersion, 1);
  assert.deepEqual(source, one.nextSnapshot);
});

test('process does not mutate genesis proposal or snapshot', () => {
  const g = genesis(), p = proposal(), beforeG = clone(g), beforeP = clone(p); process(input(p, { genesis: g }));
  assert.deepEqual(g, beforeG); assert.deepEqual(p, beforeP);
  const one = first(), source = clone(one.nextSnapshot), before = clone(source); process(input(proposalFor('scalp', '2'), { currentSnapshot: source, genesis: null, eventId: 'event-2' })); assert.deepEqual(source, before);
});
test('returned snapshots alias no caller input', () => {
  const g = genesis(), p = proposal(), result = process(input(p, { genesis: g }));
  result.nextSnapshot.genesis.input.rawText = 'changed'; result.nextSnapshot.acceptedEvents[0].payload = 'scalp';
  assert.equal(g.input.rawText, 'Nyakra keresek terméket'); assert.equal(p.value, 'neck');
});
test('repeated execution is deterministic', () => assert.deepEqual(process(input()), process(input())));

for (const [name, make] of [
  ['top-level getter', () => Object.defineProperty({}, 'genesis', { enumerable: true, get() { throw new Error('getter'); } })],
  ['nested stateful getter', () => { const value = input(); let calls = 0; Object.defineProperty(value.genesis.input, 'rawText', { enumerable: true, get() { if (++calls > 1) throw new Error('later'); return 'x'; } }); return value; }],
  ['proposal getter', () => { const value = input(); Object.defineProperty(value.proposal, 'proposalId', { enumerable: true, get() { throw new Error('getter'); } }); return value; }],
  ['snapshot getter', () => { const one = first(), value = input(proposalFor('scalp', '2'), { currentSnapshot: one.nextSnapshot, genesis: null, eventId: 'event-2' }); Object.defineProperty(value.currentSnapshot, 'conversationId', { enumerable: true, get() { throw new Error('getter'); } }); return value; }],
  ['cycle', () => { const value = input(); value.self = value; return value; }],
  ['symbol key', () => ({ ...input(), [Symbol('x')]: true })],
  ['sparse evidence', () => { const value = input(); value.proposal.evidence = new Array(1); return value; }],
  ['custom prototype', () => { const value = input(); value.genesis.input = Object.create({ poison: true }); return value; }],
  ['proxy failure', () => new Proxy({}, { ownKeys() { throw new Error('proxy'); } })]
]) test(`${name} fails closed without exception`, () => assert.doesNotThrow(() => assert.equal(process(make()).status, 'REJECTED')));
test('unsupported primitives are total', () => {
  for (const value of [null, undefined, true, 1, 1n, Symbol('x'), () => {}, []]) assert.doesNotThrow(() => process(value));
});

test('source imports only approved dormant contracts', () => {
  const source = fs.readFileSync(orchestratorPath, 'utf8');
  const imports = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]).sort();
  assert.deepEqual(imports, [
    './conversation-decision-proposal-adapter.cjs', './conversation-decision-reducer.cjs',
    './conversation-decision-semantic-proposal-contract.cjs', './conversation-decision-state-lifecycle.cjs',
    './conversation-decision-state-snapshot.cjs', './conversation-decision-transition-validator.cjs'
  ].sort());
});
test('source is pure and dormant', () => {
  const source = fs.readFileSync(orchestratorPath, 'utf8');
  assert.doesNotMatch(source, /\b(?:fs|http|https|net|fetch|XMLHttpRequest|process\.env|Date\.now|new Date|Math\.random|crypto|supabase|sql|jsonl)\b/i);
  assert.doesNotMatch(source, /server|widget|router|planner|answer-service|conversation-memory|product-catalog|page-context/i);
});
test('runtime modules do not import orchestrator', () => {
  const target = 'conversation-decision-turn-orchestrator';
  for (const file of ['server.cjs', 'public/widget.js', 'engine/answer-router.cjs', 'engine/answer-planner.cjs', 'engine/answer-service.cjs', 'engine/conversation-memory.cjs']) {
    assert.equal(fs.readFileSync(path.join(__dirname, file), 'utf8').includes(target), false, file);
  }
});

console.log(`PASS TEST_CONVERSATION_DECISION_TURN_ORCHESTRATOR_R4A2F (${count} cases)`);
