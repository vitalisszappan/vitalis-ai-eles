'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contractPath = path.join(__dirname, 'engine', 'conversation-decision-correlation-contract.cjs');
const contract = require(contractPath);

let count = 0;
function test(name, fn) { try { fn(); count++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
function input(overrides = {}) {
  return {
    correlationVersion: 1,
    conversationId: 'session-abcdefghijklmnop',
    turnId: '123e4567-e89b-42d3-a456-426614174000',
    correlationSource: 'VALIDATED_CLIENT',
    requestReference: 'request:chat/accepted-turn-1',
    ...overrides
  };
}
function validate(value) { return contract.validateDecisionCorrelation(arguments.length ? value : input()); }
function valid(value) { const result = arguments.length ? validate(value) : validate(); assert.equal(result.status, 'VALID'); assert.equal(result.reasonCode, null); assert.deepEqual(result.errors, []); return result; }
function rejected(value, reasonCode) { const result = validate(value); assert.equal(result.status, 'REJECTED'); assert.equal(result.reasonCode, reasonCode); assert.equal(result.correlation, null); assert.ok(result.errors.length > 0); return result; }

test('exact public API and frozen closed vocabularies', () => {
  assert.deepEqual(Object.keys(contract).sort(), ['validateDecisionCorrelation', 'DECISION_CORRELATION_VERSION', 'CORRELATION_SOURCES', 'CORRELATION_STATUSES', 'CORRELATION_REASON_CODES'].sort());
  assert.equal(contract.DECISION_CORRELATION_VERSION, 1);
  assert.deepEqual(contract.CORRELATION_SOURCES, ['VALIDATED_CLIENT', 'SERVER_ASSIGNED']);
  assert.deepEqual(contract.CORRELATION_STATUSES, ['VALID', 'REJECTED']);
  assert.deepEqual(contract.CORRELATION_REASON_CODES, ['INVALID_INPUT', 'INVALID_VERSION', 'INVALID_CONVERSATION_ID', 'INVALID_TURN_ID', 'INVALID_CORRELATION_SOURCE', 'INVALID_REQUEST_REFERENCE', 'UNKNOWN_PROPERTY']);
  assert.ok(Object.isFrozen(contract.CORRELATION_SOURCES)); assert.ok(Object.isFrozen(contract.CORRELATION_STATUSES)); assert.ok(Object.isFrozen(contract.CORRELATION_REASON_CODES));
});
test('stable result shape for valid and rejected results', () => { for (const result of [valid(), rejected(null, 'INVALID_INPUT')]) assert.deepEqual(Object.keys(result), ['status', 'reasonCode', 'correlation', 'errors']); });
test('VALIDATED_CLIENT transports already adopted coordinates', () => { const source = input(), result = valid(source); assert.deepEqual(result.correlation, source); });
test('SERVER_ASSIGNED transports already assigned coordinates', () => { const source = input({ conversationId: 'server-assigned-0001', correlationSource: 'SERVER_ASSIGNED', requestReference: 'request:server-allocation/1' }), result = valid(source); assert.deepEqual(result.correlation, source); });
test('all identifiers source and request reference are preserved byte-for-byte', () => { const source = input({ conversationId: 'AaZz-0123456789abcd', requestReference: 'opaque:Case-Sensitive_Reference#1' }), result = valid(source); assert.deepEqual(result.correlation, source); });

for (const key of ['correlationVersion', 'conversationId', 'turnId', 'correlationSource', 'requestReference']) {
  test(`missing required ${key} fails closed`, () => { const value = input(); delete value[key]; rejected(value, 'INVALID_INPUT'); });
}
for (const key of ['extra', 'sessionId', 'responseTurnId', 'clientTurnId', 'browserTurnId', 'requestId', 'fieldPath', 'evidence', 'productId', 'pageObservation', 'recommendationAuthorization']) {
  test(`unknown or authority-bearing property ${key} rejected`, () => rejected({ ...input(), [key]: 'x' }, 'UNKNOWN_PROPERTY'));
}
test('nested unexpected object rejected', () => rejected(input({ requestReference: { request: 'x' } }), 'INVALID_REQUEST_REFERENCE'));

for (const value of [0, 2, '1', null, -0]) test(`invalid version ${String(value)}`, () => rejected(input({ correlationVersion: value }), 'INVALID_VERSION'));
test('undefined version is rejected as non-plain contract data', () => rejected(input({ correlationVersion: undefined }), 'INVALID_INPUT'));

for (const value of ['', ' ', ' short ', 'short', 'session_with_underscore', 123, null, 'a'.repeat(101)]) {
  test(`invalid conversationId ${String(value).slice(0, 20)}`, () => rejected(input({ conversationId: value }), 'INVALID_CONVERSATION_ID'));
}
for (const value of ['abcdefghijklmnop', 'SESSION-ABCDEFGHIJ', 'session-1234567890', 'A'.repeat(100), '123e4567-e89b-42d3-a456-426614174000']) {
  test(`valid canonical conversationId ${value.slice(0, 20)}`, () => assert.equal(valid(input({ conversationId: value })).correlation.conversationId, value));
}
test('conversation identity is not silently trimmed', () => rejected(input({ conversationId: ' session-abcdefghijklmnop ' }), 'INVALID_CONVERSATION_ID'));
test('conversation identity is not coerced', () => rejected(input({ conversationId: 1234567890123456 }), 'INVALID_CONVERSATION_ID'));

for (const value of [null, '', ' ', 'server-assigned-0001', 123, '123e4567-e89b-12d3-a456-426614174000', '123e4567-e89b-42d3-7456-426614174000', '123E4567-E89B-42D3-A456-426614174000', '123e4567-e89b-42d3-a456-4266141740000']) {
  test(`invalid turnId ${String(value).slice(0, 20)}`, () => rejected(input({ turnId: value }), 'INVALID_TURN_ID'));
}
for (const value of ['123e4567-e89b-42d3-a456-426614174000', '00000000-0000-4000-8000-000000000000', 'ffffffff-ffff-4fff-bfff-ffffffffffff']) {
  test(`valid lowercase UUIDv4 turn ${value}`, () => assert.equal(valid(input({ turnId: value })).correlation.turnId, value));
}
test('conversation and turn formats are separate', () => { const value = input({ conversationId: 'server-assigned-0001', turnId: 'server-assigned-0001' }); rejected(value, 'INVALID_TURN_ID'); });
test('swapping distinct conversation and turn shapes is rejected', () => { const value = input(), swapped = { ...value, conversationId: value.turnId, turnId: value.conversationId }; rejected(swapped, 'INVALID_TURN_ID'); });
test('turn identity is not silently trimmed', () => rejected(input({ turnId: ' 123e4567-e89b-42d3-a456-426614174000 ' }), 'INVALID_TURN_ID'));

for (const value of ['CLIENT', 'BROWSER', 'SERVER', 'validated_client', 'server_assigned', '', null, 1]) {
  test(`unapproved source ${String(value)} rejected`, () => rejected(input({ correlationSource: value }), 'INVALID_CORRELATION_SOURCE'));
}
test('VALIDATED_CLIENT is preserved rather than inferred from a raw source', () => assert.equal(valid().correlation.correlationSource, 'VALIDATED_CLIENT'));
test('SERVER_ASSIGNED is preserved and does not generate coordinates', () => { const source = input({ correlationSource: 'SERVER_ASSIGNED' }), result = valid(source); assert.equal(result.correlation.conversationId, source.conversationId); assert.equal(result.correlation.turnId, source.turnId); });

for (const value of ['', ' ', ' reference ', 1, null, {}, [], 'x'.repeat(201), 'request\nreference']) {
  test(`invalid requestReference ${String(value).slice(0, 20)}`, () => rejected(input({ requestReference: value }), 'INVALID_REQUEST_REFERENCE'));
}
for (const value of ['r', 'request:1', 'opaque value with spaces', 'x'.repeat(200)]) {
  test(`valid opaque requestReference length ${value.length}`, () => assert.equal(valid(input({ requestReference: value })).correlation.requestReference, value));
}
test('requestReference is not substituted for missing turnId', () => { const value = input(); value.requestReference = value.turnId; value.turnId = null; rejected(value, 'INVALID_TURN_ID'); });
test('undefined required scalar is rejected without escaping', () => { for (const key of ['conversationId', 'turnId', 'correlationSource', 'requestReference']) rejected(input({ [key]: undefined }), 'INVALID_INPUT'); });
test('requestReference is not silently trimmed or reinterpreted', () => rejected(input({ requestReference: ' request:1 ' }), 'INVALID_REQUEST_REFERENCE'));

test('same accepted correlation is deterministic and fresh', () => { const source = input(), a = validate(source), b = validate(structuredClone(source)); assert.deepEqual(a, b); assert.notEqual(a, b); assert.notEqual(a.correlation, b.correlation); assert.notEqual(a.errors, b.errors); });
test('distinct turns remain distinct without retry side effects', () => { const a = valid(input({ turnId: '00000000-0000-4000-8000-000000000000' })), b = valid(input({ turnId: '00000000-0000-4000-8000-000000000001' })); assert.notEqual(a.correlation.turnId, b.correlation.turnId); });
test('repeated calls never regenerate identifiers', () => { const source = input(); for (let i = 0; i < 5; i++) assert.deepEqual(valid(source).correlation, source); });

for (const value of [null, undefined, true, 1, 'correlation', [], () => {}, 1n, new Date(), new Map(), new Set(), new Uint8Array()]) {
  test(`hostile top-level ${Object.prototype.toString.call(value)}`, () => assert.doesNotThrow(() => rejected(value, 'INVALID_INPUT')));
}
test('getter is rejected without invocation', () => { let calls = 0; const value = {}; Object.defineProperty(value, 'conversationId', { enumerable: true, get() { calls++; throw new Error('getter'); } }); rejected(value, 'INVALID_INPUT'); assert.equal(calls, 0); });
test('stateful getter is never invoked', () => { let calls = 0; const value = input(); Object.defineProperty(value, 'turnId', { enumerable: true, get() { calls++; if (calls > 1) throw new Error('later'); return input().turnId; } }); rejected(value, 'INVALID_INPUT'); assert.equal(calls, 0); });
test('proxy get failure cannot escape', () => { const value = new Proxy(input(), { get() { throw new Error('get'); } }); assert.doesNotThrow(() => validate(value)); });
test('proxy ownKeys failure cannot escape', () => { const value = new Proxy(input(), { ownKeys() { throw new Error('keys'); } }); rejected(value, 'INVALID_INPUT'); });
test('proxy descriptor failure cannot escape', () => { const value = new Proxy(input(), { getOwnPropertyDescriptor() { throw new Error('descriptor'); } }); rejected(value, 'INVALID_INPUT'); });
test('symbol key rejected', () => { const value = input(); value[Symbol('x')] = true; rejected(value, 'INVALID_INPUT'); });
test('cycle rejected', () => { const value = input(); value.loop = value; rejected(value, 'INVALID_INPUT'); });
test('custom prototype rejected', () => { const value = input(); Object.setPrototypeOf(value, { adopted: true }); rejected(value, 'INVALID_INPUT'); });
test('sparse array rejected', () => { const value = new Array(2); value[1] = input(); rejected(value, 'INVALID_INPUT'); });
for (const value of [NaN, Infinity, -Infinity]) test(`nonfinite value ${value} rejected`, () => rejected(input({ requestReference: value }), 'INVALID_INPUT'));
test('poisoned scalar wrapper rejected', () => { const value = input({ requestReference: Object.create({ inherited: true }) }); rejected(value, 'INVALID_INPUT'); });

test('caller input is unchanged', () => { const source = input(), before = structuredClone(source); validate(source); assert.deepEqual(source, before); });
test('returned correlation never aliases caller input', () => { const source = input(), result = valid(source); result.correlation.conversationId = 'changed-identifier'; assert.notEqual(source.conversationId, result.correlation.conversationId); });
test('mutating a result cannot affect later calls or constants', () => { const source = input(), first = valid(source); first.correlation.turnId = 'changed'; first.errors.push('changed'); assert.throws(() => contract.CORRELATION_SOURCES.push('CLIENT'), TypeError); const second = valid(source); assert.deepEqual(second.correlation, source); assert.deepEqual(second.errors, []); assert.deepEqual(contract.CORRELATION_SOURCES, ['VALIDATED_CLIENT', 'SERVER_ASSIGNED']); });
test('rejected errors are fresh', () => { const a = validate(null), b = validate(null); assert.notEqual(a.errors, b.errors); a.errors.push('changed'); assert.equal(b.errors.includes('changed'), false); });

test('production contract has zero imports', () => { const source = fs.readFileSync(contractPath, 'utf8'); assert.deepEqual([...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)], []); });
test('production contract contains no I/O environment clock randomness UUID generation or mutable identity state', () => { const source = fs.readFileSync(contractPath, 'utf8'); assert.doesNotMatch(source, /\b(?:fs|http|https|net|fetch|XMLHttpRequest|process\.env|Date\.now|new Date|performance\.now|Math\.random|randomUUID|crypto|supabase|sql|jsonl)\b/i); assert.doesNotMatch(source, /\b(?:proposalId|eventId|evidenceId)\b/); });
test('only approved R4 observation contracts and fail-isolated shadow runner import correlation contract', () => { const target = 'conversation-decision-correlation-contract.cjs'; const allowed = ['engine/conversation-decision-semantic-evidence-observation.cjs', 'engine/conversation-decision-shadow-observation-adapter.cjs', 'engine/conversation-decision-shadow-runner.cjs']; const rootFiles = fs.readdirSync(__dirname).filter((name) => /\.(?:cjs|js)$/.test(name) && !name.startsWith('TEST_')); const engineFiles = fs.readdirSync(path.join(__dirname, 'engine')).filter((name) => /\.(?:cjs|js)$/.test(name) && name !== target).map((name) => `engine/${name}`); const importers = [...rootFiles, ...engineFiles].filter((name) => fs.readFileSync(path.join(__dirname, name), 'utf8').includes(target)).sort(); assert.deepEqual(importers, allowed); });

console.log(`PASS TEST_CONVERSATION_DECISION_CORRELATION_CONTRACT_R4A2H (${count} cases)`);
