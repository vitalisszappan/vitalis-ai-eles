'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { DEFAULT_POLICY, validatePageObservation: validate, assessPageObservationFreshness: freshness, sanitizePageUrl } = require('./engine/page-context-observation.cjs');
const sessionId = '11111111-1111-4111-8111-111111111111';
const turnId = '22222222-2222-4222-8222-222222222222';
const now = 1790000000000;
const base = Object.freeze({ observationVersion: 1, observationId: '33333333-3333-4333-8333-333333333333', sessionId, turnId,
  observedAt: now, pageUrl: 'https://www.vitalis-szappan.hu/product?token=secret#private',
  pageOrigin: 'https://www.vitalis-szappan.hu', sourceType: 'UNTRUSTED_PAGE_OBSERVATION', sourceFrame: 'PARENT_STOREFRONT' });
let count = 0;
function test(name, fn) { try { fn(); count++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
const check = value => validate(value, { sessionId, turnId });
test('sanitized detached immutable result', () => {
  const before = JSON.stringify(base), out = check(base);
  assert.equal(out.status, 'VALID');
  assert.equal(out.observation.pageUrl, 'https://www.vitalis-szappan.hu/product');
  assert.equal(JSON.stringify(base), before);
  assert.notEqual(out.observation, base);
  assert(Object.isFrozen(out) && Object.isFrozen(out.observation));
  assert.deepEqual(Object.keys(out.observation).sort(), Object.keys(base).sort());
});
for (const value of [undefined, null]) test('missing', () => assert.equal(check(value).status, 'MISSING'));
for (const value of [[], '', 1, true, new Date(), Object.create({ observationVersion: 1 })]) test('non JSON object', () => assert.equal(check(value).status, 'INVALID'));
for (const version of [undefined, '1', 1.5, NaN]) test('version shape', () => assert.equal(check({ ...base, observationVersion: version }).status, 'INVALID'));
for (const version of [0, 2, -1]) test('unsupported integer', () => assert.equal(check({ ...base, observationVersion: version }).status, 'UNSUPPORTED_VERSION'));
for (const key of Object.keys(base)) test(`missing ${key}`, () => { const item = { ...base }; delete item[key]; assert.equal(check(item).status, 'INVALID'); });
for (const extra of ['canonicalProductId', 'productId', 'sku', 'unasId', 'productName', 'category', 'pageType', 'provenance', 'authorization']) {
  test(`unknown ${extra}`, () => assert.equal(check({ ...base, [extra]: 'forbidden' }).status, 'INVALID'));
}
for (const patch of [{ sessionId: 'different-session-000' }, { turnId: '44444444-4444-4444-8444-444444444444' }, { turnId: turnId.toUpperCase().replace('2222', 'AAAA') },
  { observationId: '33333333-3333-5333-8333-333333333333' }, { sessionId: 123 }, { observedAt: -1 }, { observedAt: 1.2 }, { observedAt: Number.MAX_SAFE_INTEGER + 1 },
  { sourceType: 'USER_EXPLICIT' }, { sourceFrame: 'IFRAME' }, { pageOrigin: '*' }, { pageOrigin: 'https://vitalis-szappan.hu' }]) {
  test(`reject ${JSON.stringify(patch)}`, () => assert.equal(check({ ...base, ...patch }).status, 'INVALID'));
}
for (const pageUrl of ['relative/path', 'javascript:alert(1)', 'http://www.vitalis-szappan.hu/a', 'https://evil.vitalis-szappan.hu/a', 'https://www.vitalis-szappan.hu.evil.test/a',
  'https://user:pass@www.vitalis-szappan.hu/a', ' https://www.vitalis-szappan.hu/a', 'https://www.vitalis-szappan.hu/a\n', 'https://www.vitalis-szappan.hu/\u0000a',
  'https://www.vitalis-szappan.hu/' + 'a'.repeat(2048), 'https://www.vitalis-szappan.hu/?' + 'q'.repeat(2048)]) {
  test(`URL rejection ${pageUrl.slice(0, 45)}`, () => { assert.equal(check({ ...base, pageUrl }).status, 'INVALID'); assert.equal(sanitizePageUrl(pageUrl), null); });
}
test('maximum URL accepted, not truncated', () => { const prefix = 'https://www.vitalis-szappan.hu/'; assert.equal(sanitizePageUrl(prefix + 'a'.repeat(2048 - prefix.length)).pageUrl.length, 2048); });
test('explicit development policy only', () => {
  const dev = { ...DEFAULT_POLICY, allowedOrigins: ['http://localhost:3212'], allowedProtocols: ['http:'] };
  assert.equal(sanitizePageUrl('http://localhost:3212/a'), null);
  assert.equal(sanitizePageUrl('http://localhost:3212/a?q#f', dev).pageUrl, 'http://localhost:3212/a');
  assert.equal(sanitizePageUrl(base.pageUrl, { ...DEFAULT_POLICY, allowedOrigins: ['*'] }), null);
});
for (const [age, status, reason] of [[60000, 'VALID', null], [60001, 'STALE', 'AGE_EXCEEDED'], [-5000, 'VALID', null], [-5001, 'INVALID', 'CLOCK_SKEW']]) {
  test(`freshness ${age}`, () => { const out = freshness(check(base).observation, now + age); assert.equal(out.status, status); assert.equal(out.reasonCode, reason); if (status !== 'VALID') assert.equal(out.observation, null); });
}
test('accessors and symbol properties not executed/accepted', () => {
  const item = { ...base }; Object.defineProperty(item, 'observedAt', { get() { throw Error('getter'); }, enumerable: true });
  assert.equal(check(item).status, 'INVALID'); assert.equal(check({ ...base, [Symbol('x')]: 1 }).status, 'INVALID');
});

// Narrow in-memory mutants: never edit production files.
const source = fs.readFileSync(require.resolve('./engine/page-context-observation.cjs'), 'utf8');
let killedMutants = 0;
function constructMutation(original, from, to) {
  const matches = from ? original.split(from).length - 1 : 0;
  if (matches !== 1) throw Object.assign(new Error('MUTATION_SETUP_FAILED: expected one target, found ' + matches), { code: 'MUTATION_SETUP_FAILED' });
  const changed = original.replace(from, to);
  if (changed === original) throw Object.assign(new Error('MUTATION_SETUP_FAILED: source unchanged'), { code: 'MUTATION_SETUP_FAILED' });
  return changed;
}
function mutant(from, to) {
  const changed = constructMutation(source, from, to);
  const sandbox = { module: { exports: {} }, URL, Object, Number, Array, Reflect };
  vm.runInNewContext(changed, sandbox);
  return sandbox.module.exports;
}
function killed(name, invariant) {
  const evidence = { name, targetFound: true, constructed: true, sourceChanged: true, executed: true };
  try { assert.throws(invariant, assert.AssertionError); }
  catch (error) { console.log(JSON.stringify({ ...evidence, invariantFailed: false, classification: 'SURVIVED' })); throw error; }
  killedMutants++;
  console.log(JSON.stringify({ ...evidence, invariantFailed: true, classification: 'KILLED' }));
}

test('harness rejects absent, ambiguous and unchanged mutation setup before execution', () => {
  const killsBefore = killedMutants;
  for (const [original, target, replacement] of [['', 'target', 'replacement'], ['other', 'target', 'replacement'], ['target target', 'target', 'replacement'], ['target', 'target', 'target']]) {
    let executed = false;
    assert.throws(() => {
      constructMutation(original, target, replacement);
      executed = true;
      killed('must-not-execute', () => assert.fail('must not count setup as kill'));
    }, { code: 'MUTATION_SETUP_FAILED' });
    assert.equal(executed, false);
    assert.equal(killedMutants, killsBefore);
  }
});

test('kill missing turn equality', () => {
  const api = mutant(' || value.turnId !== expectedCorrelation.turnId', '');
  const actual = api.validatePageObservation(base, { sessionId, turnId: 'wrong' }).status;
  killed('turn equality', () => assert.equal(actual, 'INVALID'));
});
test('kill wildcard origins', () => {
  const api = mutant('!policy.allowedOrigins?.includes(url.origin)', 'false');
  const actual = api.sanitizePageUrl('https://evil.test/a');
  killed('origin enforcement', () => assert.equal(actual, null));
});
test('kill retained query', () => {
  const api = mutant("url.search = '';", '');
  const actual = api.sanitizePageUrl(base.pageUrl).pageUrl;
  killed('query retention', () => assert.doesNotMatch(actual, /token=secret/));
});
test('kill retained fragment', () => {
  const api = mutant("url.hash = '';", '');
  const actual = api.sanitizePageUrl(base.pageUrl).pageUrl;
  killed('fragment retention', () => assert.doesNotMatch(actual, /#private/));
});
test('kill user-explicit relabeling', () => {
  const api = mutant('{ ...value, ...url }', "{ ...value, ...url, sourceType: 'USER_EXPLICIT' }");
  const actual = api.validatePageObservation(base, { sessionId, turnId }).observation.sourceType;
  killed('USER_EXPLICIT contamination', () => assert.equal(actual, 'UNTRUSTED_PAGE_OBSERVATION'));
});
test('kill URL-to-canonical identity injection', () => {
  const api = mutant('{ ...value, ...url }', '{ ...value, ...url, canonicalProductId: url.pageUrl }');
  const actual = api.validatePageObservation(base, { sessionId, turnId }).observation.canonicalProductId;
  killed('canonical identity injection', () => assert.equal(actual, undefined));
});
assert.equal(killedMutants, 6);
console.log(`Page context observation: PASS (${count} cases; ${killedMutants} targeted mutants killed; 0 SETUP_FAILED, 0 SURVIVED among intended mutants)`);
