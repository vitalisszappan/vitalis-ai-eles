'use strict';

const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const {
  MAX_BODY_BYTES,
  createTemporaryRevenueExecutionEndpoint
} = require('./engine/temporary-revenue-execution-endpoint.cjs');

const ADMIN = 'admin-secret-value';
const EXECUTION = 'execution-secret-value';
const PII = 'customer@example.invalid';
const UNAS_RAW = '<Order><Customer>Private Person</Customer></Order>';
const auth = {
  'x-admin-token': ADMIN,
  'x-revenue-execution-token': EXECUTION
};

function sendJson(res, status, body) {
  res.status = status;
  res.body = body;
}

function request(method = 'POST', headers = {}, body = '') {
  const req = Readable.from(body ? [body] : []);
  req.method = method;
  req.headers = { ...headers };
  return req;
}

async function invoke(handler, { method = 'POST', headers = auth, body = '', query = '' } = {}) {
  const req = request(method, headers, body);
  const res = {};
  await handler(req, res, new URL(`https://example.invalid/api/admin/commerce/revenue/run-99212-459544${query}`));
  return res;
}

function handler(overrides = {}) {
  const logs = [];
  const endpoint = createTemporaryRevenueExecutionEndpoint({
    adminToken: ADMIN,
    executionToken: EXECUTION,
    sendJson,
    logger: (event) => logs.push(event),
    revenueOrderExists: async (orderKey) => {
      assert.equal(orderKey, '99212-459544');
      return false;
    },
    execute: async () => ({
      ok: true,
      orderKey: '99212-459544',
      first: 'created',
      second: 'duplicate',
      revenueOrderId: 'internal-only-id'
    }),
    ...overrides
  });
  return { endpoint, logs };
}

(async () => {
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const { endpoint } = handler();
    assert.deepEqual(await invoke(endpoint, { method }), {
      status: 405,
      body: { ok: false, status: 'method_not_allowed' }
    });
  }

  {
    const { endpoint } = handler({ adminToken: '' });
    assert.equal((await invoke(endpoint)).status, 401);
  }
  {
    const { endpoint } = handler();
    assert.equal((await invoke(endpoint, { headers: { 'x-revenue-execution-token': EXECUTION } })).status, 401);
    assert.equal((await invoke(endpoint, { headers: { ...auth, 'x-admin-token': 'bad' } })).status, 401);
    assert.equal((await invoke(endpoint, { headers: { 'x-admin-token': ADMIN } })).status, 401);
    assert.equal((await invoke(endpoint, { headers: { ...auth, 'x-revenue-execution-token': 'bad' } })).status, 401);
  }
  {
    const { endpoint } = handler({ executionToken: '' });
    assert.deepEqual(await invoke(endpoint), {
      status: 503,
      body: { ok: false, status: 'execution_unavailable' }
    });
  }
  {
    const { endpoint } = handler();
    const extra = await invoke(endpoint, {
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ orderKey: '99212-459544' })
    });
    assert.equal(extra.status, 400);
    assert.equal((await invoke(endpoint, { query: '?token=forbidden' })).status, 400);
    assert.equal((await invoke(endpoint, {
      headers: { ...auth, 'content-type': 'application/json', 'content-length': String(MAX_BODY_BYTES + 1) },
      body: '{}'
    })).status, 400);
  }
  {
    const { endpoint } = handler();
    assert.equal((await invoke(endpoint)).status, 200);
  }
  {
    const { endpoint } = handler();
    assert.equal((await invoke(endpoint, {
      headers: { ...auth, 'content-type': 'application/json' },
      body: '{}'
    })).status, 200);
  }
  {
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    const { endpoint } = handler({ revenueOrderExists: async () => waiting });
    const first = invoke(endpoint);
    await new Promise((resolve) => setImmediate(resolve));
    const concurrent = await invoke(endpoint);
    assert.deepEqual(concurrent, { status: 409, body: { ok: false, status: 'execution_in_progress' } });
    release(false);
    assert.equal((await first).status, 200);
  }
  {
    const { endpoint } = handler();
    assert.equal((await invoke(endpoint)).status, 200);
    assert.deepEqual(await invoke(endpoint), { status: 409, body: { ok: false, status: 'already_processed' } });
  }
  {
    let executeCalls = 0;
    const { endpoint } = handler({
      revenueOrderExists: async () => true,
      execute: async () => { executeCalls += 1; }
    });
    assert.deepEqual(await invoke(endpoint), { status: 409, body: { ok: false, status: 'already_processed' } });
    assert.equal(executeCalls, 0);
  }
  {
    const { endpoint, logs } = handler({ execute: async () => { throw new Error(`${PII} ${ADMIN} ${EXECUTION} ${UNAS_RAW}`); } });
    const failed = await invoke(endpoint);
    assert.deepEqual(failed, { status: 500, body: { ok: false, status: 'execution_failed' } });
    const serialized = JSON.stringify({ failed, logs });
    for (const forbidden of [PII, ADMIN, EXECUTION, UNAS_RAW, '99212-459544']) {
      assert.equal(serialized.includes(forbidden), false);
    }
  }
  {
    const { endpoint, logs } = handler();
    const success = await invoke(endpoint);
    assert.deepEqual(success, {
      status: 200,
      body: { ok: true, status: 'completed', first: 'created', second: 'duplicate' }
    });
    assert.equal(JSON.stringify(success).includes('internal-only-id'), false);
    assert.equal(logs.length, 1);
    assert.deepEqual(Object.keys(logs[0]).sort(), [
      'duration_ms', 'http_status', 'operation', 'safe_status', 'target'
    ]);
  }

  console.log('Temporary single-order revenue execution endpoint regresszio: OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
