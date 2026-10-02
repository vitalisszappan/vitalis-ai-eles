'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shadow = require('./engine/conversation-decision-shadow-runner.cjs');

let count = 0;
async function test(name, fn) {
  try { await fn(); count++; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}
function uuidFactory(start = 1) {
  let value = start;
  return () => `00000000-0000-4000-8000-${(value++).toString(16).padStart(12, '0')}`;
}
const CONVERSATION = 'session-abcdefghijklmnop';
const TURN = '123e4567-e89b-42d3-a456-426614174000';
function payload(overrides = {}) {
  return {
    runnerVersion: 1,
    correlation: {
      correlationVersion: 1, conversationId: CONVERSATION, turnId: TURN,
      correlationSource: 'VALIDATED_CLIENT', requestReference: `request:chat/${TURN}`
    },
    rawText: 'Mennyibe kerul a szallitas?',
    routing: { intent: 'shipping_cost', domain: null, evidence: ['commerce:shipping_cost'] },
    ...overrides
  };
}
function runner(options = {}) { return shadow.createShadowRunner({ randomUUID: uuidFactory(), ...options }); }
function completed(value, observations = 1) {
  assert.equal(value.status, 'COMPLETED'); assert.equal(value.reasonCode, null);
  assert.equal(value.observationCount, observations); assert.equal(value.admittedCount, observations);
  return value;
}
function suppressed(value, reason) { assert.equal(value.status, 'SUPPRESSED'); assert.equal(value.reasonCode, reason); return value; }
const tick = () => new Promise((resolve) => setImmediate(resolve));

(async () => {
await test('public constants are closed and frozen', () => {
  assert.equal(shadow.SHADOW_RUNNER_VERSION, 1);
  assert.equal(shadow.DEFAULT_REGISTRY_MAX_ENTRIES, 128);
  assert.ok(Object.isFrozen(shadow.RUNNER_STATUSES)); assert.ok(Object.isFrozen(shadow.RUNNER_REASON_CODES));
});
await test('shadow disabled schedules nothing', () => {
  let scheduled = 0, ran = 0;
  const result = shadow.scheduleShadowExecution({ enabled: false, payload: payload(), runner: { run() { ran++; } }, schedule() { scheduled++; } });
  assert.deepEqual(result, { status: 'DISABLED', reasonCode: null }); assert.equal(scheduled, 0); assert.equal(ran, 0);
});
await test('valid adopted client coordinates are preserved and validated', () => {
  const result = shadow.buildShadowPayload({ clientConversationId: CONVERSATION, clientTurnId: TURN, rawText: 'x', routing: payload().routing }, { randomUUID: uuidFactory() });
  assert.equal(result.status, 'READY'); assert.equal(result.payload.correlation.conversationId, CONVERSATION);
  assert.equal(result.payload.correlation.turnId, TURN); assert.equal(result.payload.correlation.correlationSource, 'VALIDATED_CLIENT');
  assert.equal(result.payload.correlation.requestReference, `request:chat/${TURN}`);
});
await test('missing coordinates receive server UUID fallbacks', () => {
  const result = shadow.buildShadowPayload({ clientConversationId: null, clientTurnId: null, rawText: 'x', routing: payload().routing }, { randomUUID: uuidFactory(20) });
  assert.equal(result.status, 'READY'); assert.equal(result.payload.correlation.correlationSource, 'SERVER_ASSIGNED');
  assert.match(result.payload.correlation.conversationId, /^[0-9a-f-]{36}$/); assert.match(result.payload.correlation.turnId, /^[0-9a-f-]{36}$/);
});
await test('one invalid coordinate makes correlation server assigned without altering live IDs', () => {
  const result = shadow.buildShadowPayload({ clientConversationId: null, clientTurnId: TURN, rawText: 'x', routing: payload().routing }, { randomUUID: uuidFactory(30) });
  assert.equal(result.status, 'READY'); assert.equal(result.payload.correlation.turnId, TURN); assert.equal(result.payload.correlation.correlationSource, 'SERVER_ASSIGNED');
});
await test('invalid allocated correlation fails closed', () => {
  suppressed(shadow.buildShadowPayload({ clientConversationId: null, clientTurnId: null, rawText: 'x', routing: payload().routing }, { randomUUID: () => 'BAD' }), 'INVALID_CORRELATION');
});
await test('payload capture is detached and narrow', () => {
  const routing = payload().routing;
  const result = shadow.buildShadowPayload({ clientConversationId: CONVERSATION, clientTurnId: TURN, rawText: 'x', routing });
  routing.intent = 'changed'; routing.evidence.push('secret');
  assert.deepEqual(Object.keys(result.payload).sort(), ['correlation', 'rawText', 'routing', 'runnerVersion']);
  assert.equal(result.payload.routing.intent, 'shipping_cost'); assert.deepEqual(result.payload.routing.evidence, ['commerce:shipping_cost']);
});
await test('payload capture rejects accessors without invoking them', () => {
  let calls = 0; const routing = payload().routing;
  Object.defineProperty(routing, 'intent', { enumerable: true, get() { calls++; throw Error('secret'); } });
  suppressed(shadow.buildShadowPayload({ clientConversationId: CONVERSATION, clientTurnId: TURN, rawText: 'x', routing }), 'INVALID_INPUT');
  assert.equal(calls, 0);
});
await test('valid commerce observation reaches R4A2J admission', () => {
  const value = completed(runner().run(payload())); assert.deepEqual(value.predicates, ['COMMERCE_INTENT']);
});
await test('valid problem-domain observation reaches R4A2J admission', () => {
  const value = completed(runner().run(payload({ rawText: 'viszket', routing: { intent: null, domain: 'itchy_scalp', evidence: ['problem:itchy_scalp'] } })));
  assert.deepEqual(value.predicates, ['PROBLEM_DOMAIN']);
});
await test('both direct observations are admitted with empty dependencies', () => {
  let admissions = 0;
  const real = require('./engine/conversation-decision-evidence-identity.cjs').admitSemanticEvidence;
  const value = runner({ admit(input) { admissions++; assert.deepEqual(input.dependencyBindings, []); assert.deepEqual(input.observation.dependencies, []); return real(input); } })
    .run(payload({ routing: { intent: 'shipping_cost', domain: 'itchy_scalp', evidence: ['commerce:shipping_cost', 'problem:itchy_scalp'] } }));
  completed(value, 2); assert.equal(admissions, 2);
});
await test('no supported observation completes without allocating registry entries', () => {
  const instance = runner(); const value = instance.run(payload({ routing: { intent: null, domain: null, evidence: [] } }));
  assert.equal(value.status, 'COMPLETED'); assert.equal(value.observationCount, 0); assert.equal(value.registryCapacity.size, 0);
});
await test('R4A2H rejection suppresses before adapter', () => {
  let calls = 0; const value = runner({ adapter() { calls++; } }).run(payload({ correlation: { ...payload().correlation, turnId: 'bad' } }));
  suppressed(value, 'INVALID_CORRELATION'); assert.equal(calls, 0);
});
await test('adapter rejection is contained', () => {
  suppressed(runner({ adapter: () => ({ status: 'REJECTED', reasonCode: 'INVALID_INPUT', observations: null }) }).run(payload()), 'ADAPTER_REJECTED');
});
await test('R4A2J rejection is contained and not committed', () => {
  const instance = runner({ admit: () => ({ status: 'REJECTED', reasonCode: 'INVALID_OBSERVATION', evidence: null }) });
  const value = suppressed(instance.run(payload()), 'ADMISSION_REJECTED'); assert.equal(value.registryCapacity.size, 0);
});
await test('synchronous dependency throw is contained', () => {
  assert.doesNotThrow(() => suppressed(runner({ adapter: () => { throw Error('raw secret'); } }).run(payload()), 'EXECUTION_FAILED'));
});
await test('malformed shadow input is total', () => {
  for (const value of [null, [], 'x', {}, new Proxy({}, { ownKeys() { throw Error('x'); } })]) {
    let result;
    assert.doesNotThrow(() => { result = runner().run(value); });
    assert.equal(result.status, 'SUPPRESSED');
    assert.ok(['INVALID_INPUT', 'EXECUTION_FAILED'].includes(result.reasonCode));
  }
});
await test('same retry coordinates producer and predicate reuse both identities', () => {
  const instance = runner(); completed(instance.run(payload()));
  const first = instance.inspectIdentity({ conversationId: CONVERSATION, turnId: TURN, producer: 'COMMERCE_INTENT_CLASSIFIER', predicate: 'COMMERCE_INTENT' });
  completed(instance.run(payload()));
  const second = instance.inspectIdentity({ conversationId: CONVERSATION, turnId: TURN, producer: 'COMMERCE_INTENT_CLASSIFIER', predicate: 'COMMERCE_INTENT' });
  assert.deepEqual(second, first);
});
await test('different turn has independent identity', () => {
  const instance = runner(); completed(instance.run(payload()));
  const otherTurn = '223e4567-e89b-42d3-a456-426614174000';
  completed(instance.run(payload({ correlation: { ...payload().correlation, turnId: otherTurn, requestReference: `request:chat/${otherTurn}` } })));
  const first = instance.inspectIdentity({ conversationId: CONVERSATION, turnId: TURN, producer: 'COMMERCE_INTENT_CLASSIFIER', predicate: 'COMMERCE_INTENT' });
  const second = instance.inspectIdentity({ conversationId: CONVERSATION, turnId: otherTurn, producer: 'COMMERCE_INTENT_CLASSIFIER', predicate: 'COMMERCE_INTENT' });
  assert.notDeepEqual(second, first);
});
await test('different predicate has independent identity', () => {
  const instance = runner(); completed(instance.run(payload({ routing: { intent: 'shipping_cost', domain: 'itchy_scalp', evidence: ['commerce:shipping_cost', 'problem:itchy_scalp'] } })), 2);
  const commerce = instance.inspectIdentity({ conversationId: CONVERSATION, turnId: TURN, producer: 'COMMERCE_INTENT_CLASSIFIER', predicate: 'COMMERCE_INTENT' });
  const problem = instance.inspectIdentity({ conversationId: CONVERSATION, turnId: TURN, producer: 'PROBLEM_DOMAIN_CLASSIFIER', predicate: 'PROBLEM_DOMAIN' });
  assert.notDeepEqual(problem, commerce);
});
await test('registry bound suppresses without eviction', () => {
  const instance = runner({ maxRegistryEntries: 1 }); completed(instance.run(payload()));
  const first = instance.inspectIdentity({ conversationId: CONVERSATION, turnId: TURN, producer: 'COMMERCE_INTENT_CLASSIFIER', predicate: 'COMMERCE_INTENT' });
  const otherTurn = '323e4567-e89b-42d3-a456-426614174000';
  const value = suppressed(instance.run(payload({ correlation: { ...payload().correlation, turnId: otherTurn, requestReference: `request:chat/${otherTurn}` } })), 'REGISTRY_CAPACITY');
  assert.equal(value.registryCapacity.size, 1); assert.deepEqual(instance.inspectIdentity({ conversationId: CONVERSATION, turnId: TURN, producer: 'COMMERCE_INTENT_CLASSIFIER', predicate: 'COMMERCE_INTENT' }), first);
});
await test('two-observation capacity failure is atomic', () => {
  const instance = runner({ maxRegistryEntries: 1 });
  const value = suppressed(instance.run(payload({ routing: { intent: 'shipping_cost', domain: 'itchy_scalp', evidence: ['commerce:shipping_cost', 'problem:itchy_scalp'] } })), 'REGISTRY_CAPACITY');
  assert.equal(value.registryCapacity.size, 0);
});
await test('soft budget reports suppression after bounded work', () => {
  const times = [0, 30]; const value = runner({ now: () => times.shift() ?? 30, softBudgetMs: 25 }).run(payload());
  suppressed(value, 'SOFT_BUDGET_EXCEEDED'); assert.equal(value.elapsedMs, 30);
});
await test('scheduler begins work only when deferred callback runs', async () => {
  const events = [], queue = [], logs = [];
  shadow.scheduleShadowExecution({ enabled: true, payload: payload(), runner: { run() { events.push('run'); return { status: 'COMPLETED' }; } }, schedule(fn) { events.push('scheduled'); queue.push(fn); }, logger: (value) => logs.push(value) });
  assert.deepEqual(events, ['scheduled']); queue[0](); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(events, ['scheduled', 'run']); assert.deepEqual(logs, [{ status: 'COMPLETED' }]);
});
await test('scheduler contains synchronous runner throw', async () => {
  const logs = []; shadow.scheduleShadowExecution({ enabled: true, payload: payload(), runner: { run() { throw Error('question secret'); } }, schedule: (fn) => fn(), logger: (value) => logs.push(value) });
  await Promise.resolve(); await Promise.resolve(); suppressed(logs[0], 'EXECUTION_FAILED');
});
await test('scheduler contains rejected async execution', async () => {
  const logs = []; shadow.scheduleShadowExecution({ enabled: true, payload: payload(), runner: { run() { return Promise.reject(Error('symptom secret')); } }, schedule: (fn) => fn(), logger: (value) => logs.push(value) });
  await tick(); suppressed(logs[0], 'EXECUTION_FAILED');
});
await test('diagnostics are sanitized and contain no raw text or observations', () => {
  const secret = 'private-question-and-email@example.test';
  const value = runner().run(payload({ rawText: secret })); const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /private-question|example\.test|observationReference|evidenceId|rawText|sources/);
  assert.deepEqual(Object.keys(value), ['status', 'reasonCode', 'observationCount', 'admittedCount', 'predicates', 'elapsedMs', 'registryCapacity', 'processLocalIdentity']);
});
await test('runner does not mutate live input', () => {
  const input = payload(), before = structuredClone(input); completed(runner().run(input)); assert.deepEqual(input, before);
});
await test('only H Slice 1 J and node crypto are production dependencies', () => {
  const source = fs.readFileSync(path.join(__dirname, 'engine', 'conversation-decision-shadow-runner.cjs'), 'utf8');
  const imports = [...source.matchAll(/require\((['"])(.*?)\1\)/g)].map((match) => match[2]);
  assert.deepEqual(imports, ['node:crypto', './conversation-decision-correlation-contract.cjs', './conversation-decision-shadow-observation-adapter.cjs', './conversation-decision-evidence-identity.cjs']);
  assert.doesNotMatch(source, /conversation-decision-(?:semantic-proposal-producer|proposal-adapter|reducer|state-lifecycle|state-snapshot|turn-orchestrator)/);
  assert.doesNotMatch(source, /answer-service|answer-router|answer-planner|supabase|sql|jsonl|fetch|node:fs|process\.env/i);
});
await test('server enablement is exact and attachment follows sendJson', () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.cjs'), 'utf8');
  assert.match(source, /process\.env\.VITALIS_R4_SHADOW_ENABLED === '1'/);
  const handler = source.slice(source.indexOf('async function handleChat('), source.indexOf('async function handleAdminConversations('));
  assert.ok(handler.indexOf('sendJson(') < handler.indexOf('scheduleShadowExecution({'));
  assert.doesNotMatch(handler.slice(handler.indexOf('scheduleShadowExecution({')), /await\s+scheduleShadowExecution/);
});

const serverSource = fs.readFileSync(path.join(__dirname, 'server.cjs'), 'utf8');
const handlerSource = serverSource.slice(serverSource.indexOf('async function handleChat('), serverSource.indexOf('async function handleAdminConversations('));
async function serverProbe({ enabled, execution = 'normal', capture = 'normal' }) {
  const events = [], queued = [], diagnostics = [];
  const route = { intent: 'shipping_cost', domain: null, evidence: ['commerce:shipping_cost'] };
  const liveResult = { answer: 'same answer', source: 'test', confidence: 90, matchedKnowledgeIds: [], links: [], suggestions: [], routing: route };
  let baseRunner = null;
  const actualRunner = execution === 'throw' ? { run() { events.push('run'); throw Error('secret'); } }
    : execution === 'reject' ? { run() { events.push('run'); return Promise.reject(Error('secret')); } }
      : (() => { baseRunner = execution === 'capacity' ? runner({ maxRegistryEntries: 1 }) : runner(); return { run(value) { events.push('run'); return baseRunner.run(value); } }; })();
  if (execution === 'capacity') {
    const occupiedTurn = '423e4567-e89b-42d3-a456-426614174000';
    completed(baseRunner.run(payload({ correlation: { ...payload().correlation, turnId: occupiedTurn, requestReference: `request:chat/${occupiedTurn}` } })));
  }
  const sandbox = {
    JSON, Array, Date, console: { info() {}, error() {} },
    parseBody: async () => JSON.stringify({ message: 'Mennyibe kerul a szallitas?', sessionId: CONVERSATION, turnId: TURN, history: [] }),
    validatePageObservation: () => ({ status: 'ABSENT' }), assessPageObservationFreshness: (value) => value,
    rehydrateSessionHistory: async () => ({ history: [], state: {}, technicalFailure: false }), readSessionConversationRows: async () => [],
    knowledge: [], ruleEngine: {}, logGap() {}, createAnswer: () => structuredClone(liveResult),
    normalizeMatchedIds: () => [], normalizeConfidence: () => 90, persistConversation: async () => { events.push('persist'); },
    validSessionId: () => true, R4_SHADOW_ENABLED: enabled,
    buildShadowPayload: capture === 'malformed' ? () => ({ status: 'READY', payload: { malformed: true } })
      : (input) => shadow.buildShadowPayload(structuredClone(input)),
    r4ShadowRunner: actualRunner,
    logR4ShadowDiagnostic: (value) => diagnostics.push(value),
    scheduleShadowExecution(options) {
      events.push('schedule');
      return shadow.scheduleShadowExecution({ ...options, runner: actualRunner, schedule: (fn) => queued.push(fn), logger: (value) => diagnostics.push(value) });
    },
    sendJson(res, status, body) { events.push('send'); res.status = status; res.serialized = JSON.stringify(body); }
  };
  vm.createContext(sandbox); vm.runInContext(`${handlerSource}\nthis.handleChat=handleChat;`, sandbox);
  const response = {}; await sandbox.handleChat({ headers: {} }, response);
  assert.equal(events[0], 'persist'); assert.equal(events.includes('run'), false);
  if (enabled) { assert.deepEqual(events.slice(0, 3), ['persist', 'send', 'schedule']); for (const fn of queued) fn(); await tick(); await tick(); }
  else assert.deepEqual(events, ['persist', 'send']);
  return { response, events, diagnostics };
}
await test('enabled and disabled server responses are byte-identical', async () => {
  const disabled = await serverProbe({ enabled: false }); const enabled = await serverProbe({ enabled: true });
  assert.equal(enabled.response.status, disabled.response.status); assert.equal(enabled.response.serialized, disabled.response.serialized);
});
for (const execution of ['throw', 'reject', 'malformed', 'capacity']) {
  await test(`${execution} shadow failure preserves HTTP response and answer selection`, async () => {
    const baseline = await serverProbe({ enabled: false });
    const candidate = await serverProbe({ enabled: true, execution: execution === 'malformed' ? 'normal' : execution, capture: execution === 'malformed' ? 'malformed' : 'normal' });
    assert.equal(candidate.response.status, 200); assert.equal(candidate.response.serialized, baseline.response.serialized);
    assert.match(candidate.response.serialized, /same answer/);
    const expectedReason = execution === 'capacity' ? 'REGISTRY_CAPACITY'
      : execution === 'malformed' ? 'INVALID_INPUT' : 'EXECUTION_FAILED';
    assert.equal(candidate.diagnostics.at(-1).reasonCode, expectedReason);
  });
}
await test('server shadow execution starts only after response dispatch', async () => {
  const value = await serverProbe({ enabled: true }); assert.ok(value.events.indexOf('send') < value.events.indexOf('schedule')); assert.ok(value.events.indexOf('schedule') < value.events.indexOf('run'));
});
await test('server wiring passes no result history memory or request body to runner payload', async () => {
  const value = await serverProbe({ enabled: true }); assert.ok(value.diagnostics.length >= 1);
  const source = handlerSource.slice(handlerSource.indexOf('const shadowCapture'), handlerSource.indexOf('sendJson(', handlerSource.indexOf('const shadowCapture')));
  assert.doesNotMatch(source, /history\s*[:,]|memory\s*[:,]|answer\s*[:,]|parsed\s*[:,]|result\s*[:,]/);
});
await test('server and runner contain no feedback into live result', () => {
  const source = handlerSource.slice(handlerSource.indexOf('scheduleShadowExecution({'));
  assert.doesNotMatch(source, /result\s*[.=]|routing\s*[.=]|history\s*[.=]|memory\s*[.=]|persistConversation|sendJson/);
});

console.log(`PASS TEST_CONVERSATION_DECISION_SHADOW_RUNNER (${count} cases)`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
