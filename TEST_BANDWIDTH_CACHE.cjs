'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const PORT = 3417;
const PID_PATH = path.join(ROOT, 'chatbot.pid');
const originalPid = fs.existsSync(PID_PATH) ? fs.readFileSync(PID_PATH) : null;

function request(method, pathname, { headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, method, path: pathname, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function ready() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await request('GET', '/api/status')).status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server_start_timeout');
}

(async () => {
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      ADMIN_TOKEN: 'bandwidth-test-token',
      SUPABASE_URL: '',
      SUPABASE_KEY: '',
      UNAS_API_KEY: '',
      UNAS_API_URL: '',
      UNAS_SYNC_INTERVAL_MS: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await ready();

    const logo = await request('GET', '/vitalis-logo.jpg');
    assert.equal(logo.status, 200);
    assert.equal(logo.headers['content-type'], 'image/jpeg');
    assert.match(logo.headers['cache-control'], /^public, max-age=86400, must-revalidate$/);
    assert.notEqual(logo.headers['cache-control'], 'no-store');
    assert.ok(logo.headers.etag);
    assert.ok(logo.headers['last-modified']);
    assert.equal(Number(logo.headers['content-length']), fs.statSync(path.join(ROOT, 'public', 'vitalis-logo.jpg')).size);

    const revalidated = await request('GET', '/vitalis-logo.jpg', { headers: { 'If-None-Match': logo.headers.etag } });
    assert.equal(revalidated.status, 304);
    assert.equal(revalidated.body.length, 0);

    for (const [asset, type] of [['/embed.js', /^text\/javascript/], ['/widget.css', /^text\/css/]]) {
      const response = await request('GET', asset);
      assert.equal(response.status, 200);
      assert.match(response.headers['content-type'], type);
      assert.equal(response.headers['cache-control'], 'public, max-age=3600, must-revalidate');
      assert.ok(response.headers.etag);
      assert.ok(response.headers['last-modified']);
    }

    const widget = await request('GET', '/widget');
    assert.equal(widget.status, 200);
    assert.equal(widget.headers['cache-control'], 'public, max-age=0, must-revalidate');
    assert.match(widget.body.toString('utf8'), /src="\/vitalis-logo\.jpg"/);
    assert.match(fs.readFileSync(path.join(ROOT, 'public', 'embed.js'), 'utf8'), /\/vitalis-logo\.jpg/);

    const status = await request('GET', '/api/status');
    assert.equal(status.status, 200);
    assert.equal(status.headers['cache-control'], 'no-store');
    assert.equal(JSON.parse(status.body.toString('utf8')).ok, true);

    const chat = await request('POST', '/api/chat', {
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(chat.status, 400);
    assert.equal(chat.headers['cache-control'], 'no-store');
    assert.equal(JSON.parse(chat.body.toString('utf8')).success, false);

    const admin = await request('GET', '/api/admin/conversations');
    assert.equal(admin.status, 401);
    assert.equal(admin.headers['cache-control'], 'no-store');

    console.log('Bandwidth/cache Phase 1 regresszio: PASS');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    if (originalPid) fs.writeFileSync(PID_PATH, originalPid);
    else if (fs.existsSync(PID_PATH)) fs.unlinkSync(PID_PATH);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
