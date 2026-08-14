'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROUTE = '/api/admin/commerce/revenue/run-99212-459544';
const root = __dirname;
const serverSource = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
const runnerSource = fs.readFileSync(path.join(root, 'RUN_SINGLE_ORDER_REVENUE_REPROCESS.cjs'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(root, 'engine', 'single-order-revenue-runtime.cjs'), 'utf8');

assert.equal(serverSource.includes(ROUTE), false);
assert.equal(serverSource.includes('temporary-revenue-execution-endpoint'), false);
assert.equal(fs.existsSync(path.join(root, 'engine', 'temporary-revenue-execution-endpoint.cjs')), false);
assert.equal(fs.existsSync(path.join(root, 'TEST_TEMPORARY_REVENUE_EXECUTION_ENDPOINT.cjs')), false);
assert.equal(runnerSource.includes("require('./engine/single-order-revenue-runtime.cjs')"), true);
assert.equal(runtimeSource.includes('revenueOrderExists'), false);

const port = 3421;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-revenue-cleanup-'));

function request(method) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: ROUTE, method }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await new Promise((resolve, reject) => {
        const req = http.get({ hostname: '127.0.0.1', port, path: '/api/status' }, resolve);
        req.on('error', reject);
      });
      response.resume();
      if (response.statusCode === 200) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('cleanup_test_server_not_ready');
}

(async () => {
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      ADMIN_TOKEN: 'cleanup-admin-token',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      UNAS_API_KEY: '',
      UNAS_SYNC_INTERVAL_MS: '0',
      COMMERCE_EVENT_LOG: path.join(temp, 'events.jsonl'),
      ORDER_PROOF_LOG: path.join(temp, 'proofs.jsonl')
    },
    stdio: 'ignore'
  });
  try {
    await waitForServer();
    assert.equal((await request('GET')).status, 404);
    assert.equal((await request('POST')).status, 404);
    assert.equal((await request('PUT')).status, 404);
    assert.equal((await request('OPTIONS')).status, 204);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log('Temporary revenue execution surface cleanup: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
