'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildUnasKnowledge, getProducts, getCategories, loginToUnas } = require('./unas-sync.cjs');
const { buildSafeDiagnostic, tagSyncError } = require('./engine/unas-sync-diagnostics.cjs');
const { createUnasSyncCoordinator } = require('./unas-sync-coordinator.cjs');

const product = { unasId: '1', sku: 'SAFE', name: 'Safe', active: true, public: true };
const success = {
  loginFn: async () => ({ token: 'opaque' }),
  productsFn: async () => ({ products: [product], rawProducts: [product], pages: 1, pageSize: 100 }),
  categoriesFn: async () => ({ categories: [], count: 0 })
};

async function diagnosticFor(options, trigger = 'startup') {
  try {
    await buildUnasKnowledge(options);
    assert.fail('failure expected');
  } catch (error) {
    return buildSafeDiagnostic({ trigger, error, durationMs: 123.9 });
  }
}

function expected(phase, category, extra = {}) {
  return { trigger: 'startup', phase, category, http_status: null, page: null, transport_code: null, retryable: false, duration_ms: 123, ...extra };
}

async function main() {
  assert.deepEqual(await diagnosticFor({ ...success, loginFn: async () => { throw tagSyncError(new Error('secret timeout'), { phase: 'login', category: 'timeout' }); } }),
    expected('login', 'timeout', { retryable: true }));

  for (const status of [401, 403]) {
    assert.deepEqual(await diagnosticFor({ ...success, loginFn: async () => { throw tagSyncError(new Error('raw auth body'), { phase: 'login', http_status: status }); } }),
      expected('login', 'http_auth', { http_status: status }));
  }
  assert.deepEqual(await diagnosticFor({ ...success, productsFn: async () => { throw tagSyncError(new Error('rate body'), { phase: 'products', http_status: 429, page: 4 }); } }),
    expected('products', 'rate_limit', { http_status: 429, page: 4, retryable: true }));
  assert.deepEqual(await diagnosticFor({ ...success, categoriesFn: async () => { throw tagSyncError(new Error('upstream body'), { phase: 'categories', http_status: 503 }); } }),
    expected('categories', 'upstream', { http_status: 503, retryable: true }));

  await assert.rejects(loginToUnas({ apiKey: 'not-logged', requestFn: async () => ({ body: '<broken secret="x">' }) }), (error) => {
    assert.deepEqual(buildSafeDiagnostic({ trigger: 'manual', error, durationMs: Infinity }), {
      trigger: 'manual', phase: 'login', category: 'invalid_xml', http_status: null, page: null, transport_code: null, retryable: false, duration_ms: 0
    });
    return true;
  });
  await assert.rejects(getProducts('opaque', { requestFn: async () => ({ body: '<Products><Product></Products>' }) }), (error) => {
    assert.equal(error.unasSyncPhase, 'products');
    assert.equal(error.unasSyncCategory, 'invalid_xml');
    assert.equal(error.unasPage, 0);
    return true;
  });
  await assert.rejects(getCategories('opaque', { requestFn: async () => { throw new Error('category response body'); } }), (error) => {
    assert.equal(error.unasSyncPhase, 'categories');
    assert.equal(error.unasSyncCategory, 'unknown');
    return true;
  });
  await assert.rejects(getCategories('opaque', { requestFn: async () => ({ body: '<Categories><Category></Categories>' }) }), (error) => {
    assert.equal(error.unasSyncPhase, 'categories');
    assert.equal(error.unasSyncCategory, 'invalid_xml');
    assert.equal(error.unasPage, null);
    return true;
  });

  const oneProductXml = '<?xml version="1.0"?><Products><Product><Id>1</Id><Sku>A</Sku><Name>A</Name></Product></Products>';
  await assert.rejects(getProducts('opaque', { pageSize: 1, requestFn: async () => ({ body: oneProductXml }) }), (error) => {
    assert.equal(error.unasSyncCategory, 'repeated_page');
    assert.equal(error.unasPage, 1);
    return true;
  });

  assert.deepEqual(await diagnosticFor({ ...success, productsFn: async () => ({ products: [], rawProducts: [], pages: 1 }) }), expected('validate', 'empty_products'));
  assert.deepEqual(await diagnosticFor({ ...success, productsFn: async () => ({ products: null, rawProducts: null }) }), expected('normalize', 'unknown'));
  assert.deepEqual(await diagnosticFor({ ...success, productsFn: async () => ({ products: [null], rawProducts: [null] }) }), expected('normalize', 'unknown'));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unas-observability-'));
  try {
    const impossibleTarget = path.join(tempDir, 'target-directory');
    fs.mkdirSync(impossibleTarget);
    assert.deepEqual(await diagnosticFor({ ...success, snapshotPath: impossibleTarget }), expected('snapshot_write', 'filesystem'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const logs = [];
  const secret = 'UNAS_API_KEY_SECRET';
  const rawXml = '<Products><Product><Sku>PRIVATE-SKU</Sku></Product></Products>';
  const coordinator = createUnasSyncCoordinator({
    snapshotPath: path.join(os.tmpdir(), `missing-${process.pid}-${Date.now()}.json`),
    buildSync: async () => { throw tagSyncError(new Error(`${secret}${rawXml}response body`), { phase: 'products', category: 'upstream', http_status: 502, page: 2 }); },
    logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) }
  });
  await assert.rejects(coordinator.run('startup'));
  const status = coordinator.status();
  assert.deepEqual(status.lastUnasSyncDiagnostic, {
    trigger: 'startup', phase: 'products', category: 'upstream', http_status: 502, page: 2, transport_code: null, retryable: true, duration_ms: status.lastUnasSyncDiagnostic.duration_ms
  });
  assert.equal(Number.isInteger(status.lastUnasSyncDiagnostic.duration_ms), true);
  const serialized = JSON.stringify({ logs, status });
  for (const forbidden of [secret, rawXml, 'PRIVATE-SKU', 'response body']) assert.equal(serialized.includes(forbidden), false);

  const successLogs = [];
  const successPath = path.join(os.tmpdir(), `unas-success-${process.pid}-${Date.now()}.json`);
  const successCoordinator = createUnasSyncCoordinator({
    snapshotPath: successPath,
    buildSync: async () => ({ products: 1, categories: 0 }),
    logger: { info: (...args) => successLogs.push(args), error: (...args) => successLogs.push(args) }
  });
  await successCoordinator.run('manual');
  assert.equal(successCoordinator.status().lastUnasSyncDiagnostic, null);
  assert.equal(successLogs.some(([message]) => String(message).includes('sikertelen')), false);

  console.log('TEST_UNAS_SYNC_OBSERVABILITY: minden ellenőrzés sikeres');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
