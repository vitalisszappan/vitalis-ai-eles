'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const contract = require('./engine/page-context-observation.cjs');
const read = file => fs.readFileSync(require('node:path').join(__dirname, file), 'utf8');
const widgetSource = read('public/widget.js'), embedSource = read('public/embed.js'), serverSource = read('server.cjs');
const origin = 'https://www.vitalis-szappan.hu', widgetOrigin = 'https://chat.example.test';
const restoredSession = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const copy = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
let count = 0;
async function test(name, fn) { try { await fn(); count++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }

function browser({ standalone = false, source = widgetSource, embed = embedSource, referrer = origin + '/A' } = {}) {
  let now = 1790000000000, serial = 0;
  const timers = new Map(), parentMessages = [], childMessages = [], requests = [], parentHandlers = {}, childHandlers = {}, nodes = new Map();
  const frame = { contentWindow: { postMessage(data, target) { childMessages.push({ data: copy(data), target }); } } };
  function element() {
    const handlers = {};
    return { handlers, style: {}, dataset: {}, value: '', scrollHeight: 10, classList: { contains: () => false, toggle() {} },
      addEventListener(type, fn) { handlers[type] = fn; }, setAttribute() {}, append() {}, appendChild() {}, replaceChildren() {}, focus() {}, remove() {},
      querySelector: () => frame, querySelectorAll: () => [] };
  }
  const document = { referrer, currentScript: { src: widgetOrigin + '/embed.js' },
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement: element, createTextNode: value => value, querySelectorAll: () => [], body: element(), head: element() };
  const storage = new Map();
  const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const parent = { location: { href: origin + '/A', origin }, crypto, localStorage,
    addEventListener: (type, fn) => { parentHandlers[type] = fn; },
    postMessage(data, target) { parentMessages.push({ data: copy(data), target }); } };
  const child = { location: { href: widgetOrigin + '/widget', origin: widgetOrigin }, crypto, localStorage,
    addEventListener: (type, fn) => { childHandlers[type] = fn; }, confirm: () => true,
    VitalisCommerceEventClient: { createClient: () => ({ send() {}, setAttributionId() {}, productClick() {} }) } };
  child.parent = standalone ? child : parent;
  const common = { URL, Uint8Array, crypto, console, localStorage, performance: { now: () => now },
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; }, clearTimeout: id => timers.delete(id) };
  const parentVm = vm.createContext({ ...common, window: parent, document });
  vm.runInContext(embed, parentVm);
  const childVm = vm.createContext({ ...common, window: child, document,
    fetch: (url, options) => new Promise(resolve => requests.push({ url, payload: JSON.parse(options.body), resolve })) });
  vm.runInContext(source, childVm);
  const evaluate = text => vm.runInContext(text, childVm);
  function dispatch(data, overrides = {}) { childHandlers.message({ source: parent, origin, data: copy(data), ...overrides }); }
  function restore(sessionId = restoredSession) { dispatch({ type: 'vitalis-chat-state', state: { version: 2, updatedAt: now, sessionId, messages: [] } }); }
  function captureRequest() { return parentMessages.filter(x => x.data.type === 'vitalis-page-observation-request').at(-1); }
  function parentCapture(request = captureRequest()?.data, overrides = {}) {
    const before = childMessages.length;
    parentHandlers.message({ source: frame.contentWindow, origin: widgetOrigin, data: copy(request), ...overrides });
    return childMessages.length > before ? childMessages.at(-1) : null;
  }
  async function advance(ms) {
    const target = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
    }
    now = target; await flush();
  }
  async function answer(index = requests.length - 1) {
    requests[index].resolve({ json: async () => ({ answer: 'unchanged', links: [], suggestions: [], turnId: requests[index].payload.turnId }) });
    await flush(); await advance(550);
  }
  return { evaluate, dispatch, restore, captureRequest, parentCapture, requests, parentMessages, childMessages, parent, child, frame, nodes, storage,
    send: question => evaluate(`ask(${JSON.stringify(question)})`), advance, answer,
    jump: ms => { now += ms; }, capture: () => { const result = parentCapture(); dispatch(result.data); return result; } };
}

function extractFunction(source, start, next) { return source.slice(source.indexOf(start), source.indexOf(next, source.indexOf(start))); }
const handlerSource = extractFunction(serverSource, 'async function handleChat(', '\n/* =========================================================');
const persistenceSource = extractFunction(serverSource, 'async function persistConversation(', '\n/* =========================================================');

// Only mutation matching normalizes EOLs; production files are never rewritten.
const normalizeMutationSource = source => source.replace(/\r\n?/g, '\n');
let killedMutants = 0;
function constructMutation(original, from, to) {
  const normalized = normalizeMutationSource(original);
  const target = normalizeMutationSource(from), replacement = normalizeMutationSource(to);
  const matches = target ? normalized.split(target).length - 1 : 0;
  if (matches !== 1) throw Object.assign(new Error('MUTATION_SETUP_FAILED: expected one target, found ' + matches), { code: 'MUTATION_SETUP_FAILED' });
  const changed = normalized.replace(target, replacement);
  if (changed === normalized) throw Object.assign(new Error('MUTATION_SETUP_FAILED: source unchanged'), { code: 'MUTATION_SETUP_FAILED' });
  return changed;
}
function killed(name, invariant) {
  const evidence = { name, targetFound: true, constructed: true, sourceChanged: true, executed: true };
  try { assert.throws(invariant, assert.AssertionError); }
  catch (error) { console.log(JSON.stringify({ ...evidence, invariantFailed: false, classification: 'SURVIVED' })); throw error; }
  killedMutants++;
  console.log(JSON.stringify({ ...evidence, invariantFailed: true, classification: 'KILLED' }));
}

async function handlerProbe(pageObservation, legacyUrl, handler = handlerSource) {
  const inputs = [], logs = [], outputs = [], errors = [];
  const now = 1790000000000, turnId = '22222222-2222-4222-8222-222222222222';
  const { createAnswer } = require('./engine/answer-service.cjs');
  const { rehydrateSessionHistory } = require('./engine/conversation-memory.cjs');
  const sandbox = { ...contract, JSON, console: { info() {}, log() {}, error: (...args) => errors.push(args) }, Date: class extends Date { static now() { return now; } },
    parseBody: async () => JSON.stringify({ message: 'Fejbőrre ami hámlik és piros irritált, melyik termék jó?', history: [], sessionId: restoredSession, turnId, pageObservation, pageUrl: legacyUrl }),
    rehydrateSessionHistory, readSessionConversationRows: async () => [], knowledge: [], ruleEngine: { resolve: () => null }, logGap() {},
    createAnswer(args) { inputs.push(copy(args)); return createAnswer(args); },
    normalizeMatchedIds: result => result.matchedKnowledgeIds || [], normalizeConfidence: result => result.confidence,
    cleanText: (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '',
    fs: { appendFileSync: (file, data) => logs.push(JSON.parse(data)) }, CONVERSATION_LOG: 'memory-only',
    supabaseConfigured: () => false,
    isDiagnosticOnlyConversation: () => true,
    sendJson: (res, status, body) => outputs.push({ status, body: copy(body) }) };
  vm.createContext(sandbox);
  vm.runInContext(persistenceSource + '\n' + handler + '\nthis.run = handleChat;', sandbox);
  await sandbox.run({ headers: {} }, {});
  await flush();
  assert.deepEqual(errors, [], 'handler/persistence must not hide harness errors');
  return { inputs, logs, response: outputs[0] };
}

async function run() {
  await test('A/B navigation, delayed answer and immutable payload', async () => {
    const b = browser(); b.restore(); const turnA = b.send('first'); await flush();
    assert.equal(b.captureRequest().target, origin);
    assert.deepEqual(Object.keys(b.captureRequest().data).sort(), ['sessionId', 'turnId', 'type']);
    b.parent.location.href = origin + '/A?secret=x#private';
    const resultA = b.capture(); await flush();
    assert.equal(resultA.target, widgetOrigin); assert.equal(resultA.data.observation.pageUrl, origin + '/A');
    assert.equal(b.requests[0].payload.pageObservation.pageUrl, origin + '/A');
    b.parent.location.href = origin + '/B'; await b.answer(0); await turnA;
    assert.equal(b.requests[0].payload.pageObservation.pageUrl, origin + '/A');
    const turnB = b.send('second'); await flush(); b.capture(); await flush();
    assert.equal(b.requests[1].payload.pageObservation.pageUrl, origin + '/B');
    assert.notEqual(b.requests[0].payload.turnId, b.requests[1].payload.turnId);
    assert.notEqual(b.requests[0].payload.pageObservation.observationId, b.requests[1].payload.pageObservation.observationId);
    assert.equal('pageUrl' in b.requests[1].payload, false);
    assert.equal(b.evaluate('pendingCapture'), null);
    assert(![...b.storage.values()].some(value => value.includes('pageObservation')));
    await b.answer(); await turnB;
  });
  await test('navigation before capture uses handling-time location', async () => {
    const b = browser(); b.restore(); const p = b.send('q'); await flush(); b.parent.location.href = origin + '/B'; b.capture(); await flush();
    assert.equal(b.requests[0].payload.pageObservation.pageUrl, origin + '/B'); await b.answer(); await p;
  });
  await test('previous valid observation never substitutes for next missing capture', async () => {
    const b = browser(); b.restore(); const first = b.send('first'); await flush(); b.capture(); await flush(); await b.answer(); await first;
    const second = b.send('second'); await flush(); await b.advance(750);
    assert.equal(b.requests[1].payload.pageObservation, null); await b.answer(); await second;
  });
  await test('timeout, cleanup, late reply and no cached reuse', async () => {
    const b = browser(); b.restore(); const p = b.send('q'); await flush(); const late = b.parentCapture();
    await b.advance(750); assert.equal(b.requests[0].payload.pageObservation, null); assert.equal(b.evaluate('pendingCapture'), null);
    b.dispatch(late.data); assert.equal(b.requests[0].payload.pageObservation, null); await b.answer(); await p;
    const p2 = b.send('next'); await flush(); b.dispatch(late.data); assert.equal(b.requests.length, 1);
    await b.advance(750); assert.equal(b.requests[1].payload.pageObservation, null); await b.answer(); await p2;
  });
  await test('standalone and missing trusted parent', async () => {
    for (const options of [{ standalone: true }, { referrer: '' }, { referrer: 'https://evil.test/A' }]) {
      const b = browser(options); const p = b.send('q'); await b.advance(750);
      assert.equal(b.requests[0].payload.pageObservation, null); assert.equal(b.captureRequest(), undefined); await b.answer(); await p;
    }
  });
  await test('frame/origin, correlation, duplicate and unsolicited messages', async () => {
    const b = browser(); b.restore(); b.dispatch({ type: 'vitalis-page-observation-result' });
    const p = b.send('q'); b.send('rapid duplicate'); await flush();
    assert.equal(b.parentCapture(undefined, { source: {} }), null);
    assert.equal(b.parentCapture(undefined, { origin: '*' }), null);
    assert.equal(b.parentCapture({ ...b.captureRequest().data, question: 'forbidden' }), null);
    const result = b.parentCapture();
    b.dispatch(result.data, { source: {} }); b.dispatch(result.data, { origin: '*' });
    b.dispatch({ ...result.data, sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    b.dispatch({ ...result.data, turnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    b.dispatch({ ...result.data, observation: { ...result.data.observation, turnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } });
    await flush(); assert.equal(b.requests.length, 0);
    b.dispatch(result.data); b.dispatch(result.data); await flush(); assert.equal(b.requests.length, 1); await b.answer(); await p;
  });
  await test('late event before timeout callback still rejected', async () => {
    const b = browser(); b.restore(); const p = b.send('q'); await flush(); const result = b.parentCapture();
    b.jump(751); b.dispatch(result.data); await flush(); assert.equal(b.requests[0].payload.pageObservation, null); await b.answer(); await p;
  });
  await test('restoration wait and session lock', async () => {
    const b = browser(); const p = b.send('q'); await flush(); assert.equal(b.captureRequest(), undefined);
    b.restore(); await flush(); assert.equal(b.captureRequest().data.sessionId, restoredSession); b.capture(); await flush();
    b.restore('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    assert.equal(b.evaluate('sessionId'), restoredSession); assert.equal(b.requests[0].payload.sessionId, restoredSession); await b.answer(); await p;
    const c = browser(); const p2 = c.send('q'); await c.advance(750); const frozen = c.captureRequest().data.sessionId;
    c.restore(); c.capture(); await flush(); assert.equal(c.requests[0].payload.sessionId, frozen); await c.answer(); await p2;
  });
  await test('parent rejects unsafe locations without emitting raw URLs', async () => {
    for (const url of ['https://u:p@www.vitalis-szappan.hu/a', origin + '/' + 'x'.repeat(2048), 'https://evil.vitalis-szappan.hu/a', 'http://www.vitalis-szappan.hu/a', 'malformed', '']) {
      const b = browser(); b.restore(); const p = b.send('q'); await flush(); b.parent.location.href = url; b.capture(); await flush();
      assert.equal(b.requests[0].payload.pageObservation, null); await b.answer(); await p;
    }
  });
  await test('overdue restoration event before timer callback cannot replace session', async () => {
    const b = browser(); const initial = b.evaluate('sessionId'); const p = b.send('q'); await flush();
    b.jump(751); b.restore(); await flush(); assert.equal(b.captureRequest().data.sessionId, initial);
    b.capture(); await flush(); await b.answer(); await p;
  });
  await test('historical observation cannot become current observation after restoration', async () => {
    const b = browser();
    b.dispatch({ type: 'vitalis-chat-state', state: { version: 2, updatedAt: 1790000000000, sessionId: restoredSession,
      pageObservation: { pageUrl: origin + '/A' }, messages: [{ role: 'bot', content: 'previous answer', pageObservation: { pageUrl: origin + '/A' } }] } });
    b.parent.location.href = origin + '/B'; const p = b.send('q'); await flush(); b.capture(); await flush();
    assert.equal(b.requests[0].payload.pageObservation.pageUrl, origin + '/B');
    assert(!JSON.stringify(b.requests[0].payload.history).includes('pageObservation')); await b.answer(); await p;
  });
  const observation = { observationVersion: 1, observationId: '33333333-3333-4333-8333-333333333333', sessionId: restoredSession,
    turnId: '22222222-2222-4222-8222-222222222222', observedAt: 1790000000000, pageUrl: origin + '/A?secret=x#private', pageOrigin: origin,
    sourceType: 'UNTRUSTED_PAGE_OBSERVATION', sourceFrame: 'PARENT_STOREFRONT' };
  await test('actual handler, answer engine and persistence: context isolation', async () => {
    const cases = [[observation, 'VALID'], [null, 'MISSING'], [{ ...observation, pageUrl: 'bad' }, 'INVALID'],
      [{ ...observation, observedAt: observation.observedAt - 60001 }, 'STALE'], [{ ...observation, observationVersion: 2 }, 'UNSUPPORTED_VERSION']];
    let baselineInputs, baselineAnswer;
    for (const [value, status] of cases) {
      const out = await handlerProbe(value, origin + '/legacy?secret=x#private');
      assert.equal(out.response.status, 200); assert.equal(out.response.body.pageContextStatus, status);
      assert.equal(out.logs[0].page_url, origin + '/legacy');
      const { turnId, pageContextStatus, ...answer } = out.response.body;
      // Guard timing is diagnostic, not answer behavior.
      if (answer.routing?.semanticGuard) delete answer.routing.semanticGuard.timingMs;
      if (!baselineInputs) { baselineInputs = out.inputs; baselineAnswer = answer; }
      assert.deepEqual(out.inputs, baselineInputs); assert.deepEqual(answer, baselineAnswer);
      assert.deepEqual(Object.keys(out.inputs[0]).sort(), ['conversationState', 'history', 'knowledge', 'question', 'ruleEngine', 'technicalFailure']);
      assert(!JSON.stringify(out.inputs).includes('UNTRUSTED_PAGE_OBSERVATION'));
      assert(!JSON.stringify(out.logs).includes('pageObservation'));
      assert(!JSON.stringify(out.response).includes('/A'));
    }
    for (const unsafe of ['https://u:p@www.vitalis-szappan.hu/a', origin + '/' + 'x'.repeat(2048), 'https://evil.test/a']) {
      const out = await handlerProbe(null, unsafe); assert.equal(out.logs[0].page_url, ''); assert.equal(out.response.body.pageContextStatus, 'MISSING');
    }
  });
  await test('no downstream imports or calls added to acquisition/handler', () => {
    const acquisition = embedSource.slice(embedSource.indexOf('function capturePageObservation'), embedSource.indexOf('function toggle'));
    for (const source of [read('engine/page-context-observation.cjs'), acquisition, handlerSource]) {
      assert.doesNotMatch(source, /USER_EXPLICIT|canonicalProductId|productFocus|referencedProducts|validateSemanticProposal|reduceConversation|validateTransition|product-registry|catalog-search/);
    }
  });
  // Mutants run only inside disposable VM contexts.
  await test('harness rejects missing/ambiguous/unchanged targets before browser execution', () => {
    const killsBefore = killedMutants;
    for (const [original, target, replacement] of [['', 'target', 'replacement'], ['other', 'target', 'replacement'], ['target target', 'target', 'replacement'], ['target', 'target', 'target']]) {
      let executed = false;
      assert.throws(() => {
        const source = constructMutation(original, target, replacement);
        executed = true;
        browser({ source });
      }, { code: 'MUTATION_SETUP_FAILED' });
      assert.equal(executed, false);
      assert.equal(killedMutants, killsBefore);
    }
  });
  await test('mutant: missing timeout cleanup fails invariant', async () => {
    const lf = normalizeMutationSource(widgetSource), crlf = lf.replace(/\n/g, '\r\n');
    const target = 'pendingCapture = null;\n      resolve(observation);';
    const lfMutant = constructMutation(lf, target, 'resolve(observation);');
    const crlfMutant = constructMutation(crlf, target, 'resolve(observation);');
    assert.equal(lfMutant, crlfMutant, 'LF and CRLF must construct the identical semantic mutant');
    for (const [eol, source] of [['LF', lfMutant], ['CRLF', crlfMutant]]) {
      const b = browser({ source });
      b.restore(); const p = b.send('q'); await flush(); await b.advance(750);
      const actual = b.evaluate('pendingCapture');
      killed('timeout cleanup ' + eol, () => assert.equal(actual, null)); await b.answer(); await p;
    }
  });
  await test('mutant: accepting late capture fails null invariant', async () => {
    const source = constructMutation(widgetSource, 'performance.now() - pendingCapture.started >= PAGE_CAPTURE_MS', 'false');
    const b = browser({ source });
    b.restore(); const p = b.send('q'); await flush(); const response = b.parentCapture(); b.jump(751); b.dispatch(response.data); await flush();
    const actual = b.requests[0].payload.pageObservation;
    killed('late capture', () => assert.equal(actual, null)); await b.answer(); await p;
  });
  await test('mutant: previous observation reuse violates missing invariant', async () => {
    const declared = constructMutation(widgetSource, 'let pendingCapture = null;', 'let pendingCapture = null; let previousObservation = null;');
    const source = constructMutation(declared, 'resolve(observation);', 'if (observation) previousObservation = observation; resolve(observation || previousObservation);');
    const b = browser({ source }); b.restore(); const first = b.send('first'); await flush(); b.capture(); await flush(); await b.answer(); await first;
    const second = b.send('second'); await flush(); await b.advance(750);
    const actual = b.requests[1].payload.pageObservation;
    killed('previous observation reuse', () => assert.equal(actual, null)); await b.answer(); await second;
  });
  await test('mutant: page context in conversation state violates isolation', async () => {
    const handler = constructMutation(handlerSource, 'conversationState:memory.state,', 'conversationState:{...memory.state,pageContext},');
    const mutated = await handlerProbe(observation, undefined, handler);
    assert.notEqual(mutated.inputs[0].conversationState.pageContext, undefined);
    const original = await handlerProbe(observation);
    killed('conversation-state contamination', () => assert.deepEqual(mutated.inputs, original.inputs));
  });
  assert.equal(killedMutants, 5);
  console.log(`Page context transport: PASS (${count} scenarios; 4 targeted mutants killed, timeout verified under both LF and CRLF; 0 SETUP_FAILED, 0 SURVIVED among intended mutants)`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
