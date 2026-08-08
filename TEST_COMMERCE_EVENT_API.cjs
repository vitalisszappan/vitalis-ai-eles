'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const PORT = 3403;
const ROOT = __dirname;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-commerce-api-'));
const logFile = path.join(tempDir, 'events.jsonl');
const pidFile = path.join(ROOT, 'chatbot.pid');
const originalPid = fs.existsSync(pidFile) ? fs.readFileSync(pidFile) : null;

function request(method, pathname, body, origin = 'https://www.vitalis-szappan.hu', contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const data = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: pathname, method, headers: {
      ...(origin ? { Origin: origin } : {}), ...(contentType ? { 'Content-Type': contentType } : {}),
      'Content-Length': Buffer.byteLength(data)
    } }, (res) => {
      let response = '';
      res.on('data', (chunk) => { response += chunk; });
      res.on('end', () => {
        let parsed = response;
        if (/^application\/json\b/i.test(String(res.headers['content-type'] || ''))) parsed = response ? JSON.parse(response) : {};
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

async function waitForServer(child) {
  for (let i = 0; i < 60; i += 1) {
    if (child.exitCode !== null) throw new Error(`server_exit_${child.exitCode}`);
    try { if ((await request('GET', '/api/status', null, null, null)).status === 200) return; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server_start_timeout');
}

async function main() {
  const child = spawn(process.execPath, ['server.cjs'], { cwd: ROOT, env: {
    ...process.env, PORT: String(PORT), HOST: '127.0.0.1', SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '', UNAS_API_KEY: '', UNAS_SYNC_INTERVAL_MS: '0',
    COMMERCE_EVENT_LOG: logFile, COMMERCE_EVENT_RATE_LIMIT: '100'
  }, stdio: 'ignore' });
  try {
    await waitForServer(child);
    const status = await request('GET', '/api/status', null, null, null);
    assert.equal(status.body.commerceEventStorage.kind, 'local_poc_jsonl');
    assert.equal(status.body.commerceEventStorage.productionDurable, false);
    assert.equal(status.body.commerceEventStorage.idempotencyScope, 'available_local_file');
    const event = {
      eventId: crypto.randomUUID(), attributionId: crypto.randomUUID(), chatSessionId: crypto.randomUUID(),
      eventType: 'chat_started', route: null, intent: null, canonicalProductId: null,
      unasProductId: null, sku: null, recommendationType: null, recommendationRank: null,
      occurredAt: new Date().toISOString(), schemaVersion: 1
    };
    assert.equal((await request('POST', '/api/commerce/event', event, 'https://evil.example')).status, 403);
    assert.equal((await request('POST', '/api/commerce/event', event, null)).status, 403);
    assert.equal((await request('POST', '/api/commerce/event', event, undefined, 'text/plain')).status, 415);
    assert.equal((await request('POST', '/api/commerce/event', { ...event, revenue: 1000 })).status, 400);
    const created = await request('POST', '/api/commerce/event', event);
    assert.equal(created.status, 201); assert.equal(created.body.duplicate, false);
    const duplicate = await request('POST', '/api/commerce/event', event);
    assert.equal(duplicate.status, 200); assert.equal(duplicate.body.duplicate, true);
    assert.equal(fs.readFileSync(logFile, 'utf8').trim().split(/\r?\n/).length, 1);
    assert.equal((await request('POST', '/api/commerce/event', 'x'.repeat(5000))).status, 413);
    assert.equal((await request('GET', '/attribution-lifecycle.js', null, null, null)).status, 200);
    assert.equal((await request('GET', '/unas-order-bridge.js', null, null, null)).status, 200);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (originalPid) fs.writeFileSync(pidFile, originalPid); else if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  console.log('Commerce event API, origin és security tesztek: OK');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
