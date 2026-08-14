'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { unasRequest } = require('./unas-sync.cjs');
const { buildSafeDiagnostic, mapTransportCode } = require('./engine/unas-sync-diagnostics.cjs');
const { createUnasSyncCoordinator } = require('./unas-sync-coordinator.cjs');

async function requestFailure(code, options = {}) {
  const original = https.request;
  https.request = () => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => queueMicrotask(() => {
      if (options.timeout) request.emit('timeout');
      else {
        const error = new Error(`SECRET_MESSAGE ${options.secret || ''}`);
        error.code = code;
        error.stack = `SECRET_STACK ${options.secret || ''}`;
        request.emit('error', error);
      }
    });
    request.destroy = (error) => queueMicrotask(() => request.emit('error', error));
    return request;
  };
  try {
    await unasRequest({ endpoint: 'getCategory', token: 'SECRET_TOKEN', body: '<SECRET_XML />' });
    assert.fail('request failure expected');
  } catch (error) {
    return buildSafeDiagnostic({ trigger: 'startup', error, durationMs: 42 });
  } finally {
    https.request = original;
  }
}

function expected(code) {
  return {
    trigger: 'startup', phase: 'categories', category: 'transport', http_status: null,
    page: null, transport_code: code, retryable: false, duration_ms: 42
  };
}

async function main() {
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED']) {
    assert.deepEqual(await requestFailure(code), expected(code));
  }
  for (const code of ['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_WRONG_VERSION_NUMBER']) {
    assert.equal(mapTransportCode(code), 'TLS_ERROR');
    assert.deepEqual(await requestFailure(code), expected('TLS_ERROR'));
  }
  assert.deepEqual(await requestFailure('SOME_PRIVATE_CODE'), expected('OTHER'));

  assert.deepEqual(await requestFailure('ETIMEDOUT', { timeout: true }), {
    trigger: 'startup', phase: 'categories', category: 'timeout', http_status: null,
    page: null, transport_code: null, retryable: true, duration_ms: 42
  });

  const secret = 'SECRET_API_HOST_BODY_XML_STACK';
  const safe = JSON.stringify(await requestFailure('ENOTFOUND', { secret }));
  for (const forbidden of [secret, 'SECRET_MESSAGE', 'SECRET_STACK', 'SECRET_TOKEN', 'SECRET_XML']) {
    assert.equal(safe.includes(forbidden), false);
  }

  let calls = 0;
  const coordinator = createUnasSyncCoordinator({
    snapshotPath: `${__dirname}/data/nonexistent-transport-test.json`,
    buildSync: async () => {
      calls += 1;
      const error = new Error('do not log');
      error.code = 'ECONNRESET';
      throw error;
    },
    logger: { info() {}, error() {} }
  });
  await assert.rejects(coordinator.run('startup'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1, 'automatic retry must remain disabled');

  console.log('UNAS transport diagnostic regresszió: PASS');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
