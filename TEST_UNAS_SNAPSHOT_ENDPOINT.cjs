'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3398;
const ADMIN_TOKEN = 'snapshot-endpoint-test-token';
const ROOT = __dirname;
const SNAPSHOT_PATH = path.join(ROOT, 'data', 'unas-catalog-snapshot.json');
const PID_PATH = path.join(ROOT, 'chatbot.pid');

function request(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: pathname,
      method: 'GET',
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`A tesztszerver idő előtt leállt (${child.exitCode}).`);
    }

    try {
      const response = await request('/api/status');
      if (response.status === 200) return;
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('A tesztszerver nem indult el időben.');
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
  const hadSnapshot = fs.existsSync(SNAPSHOT_PATH);
  const originalSnapshot = hadSnapshot ? fs.readFileSync(SNAPSHOT_PATH) : null;
  const hadPid = fs.existsSync(PID_PATH);
  const originalPid = hadPid ? fs.readFileSync(PID_PATH) : null;
  if (hadSnapshot) fs.unlinkSync(SNAPSHOT_PATH);

  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      ADMIN_TOKEN
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  try {
    await waitForServer(child);

    const missingToken = await request('/api/admin/unas/snapshot');
    assert.equal(missingToken.status, 401);

    const wrongToken = await request('/api/admin/unas/snapshot', {
      'X-Admin-Token': 'wrong-token'
    });
    assert.equal(wrongToken.status, 401);

    const queryToken = await request(
      `/api/admin/unas/snapshot?token=${encodeURIComponent(ADMIN_TOKEN)}`
    );
    assert.equal(queryToken.status, 401);

    const missingSnapshot = await request('/api/admin/unas/snapshot', {
      'X-Admin-Token': ADMIN_TOKEN
    });
    assert.equal(missingSnapshot.status, 404);

    const snapshot = {
      schema: 'vitalis-unas-commerce-catalog/v1',
      products: [{ unasId: 'test-1', name: 'Teszttermék' }],
      categories: [],
      audit: { totalRecords: 1 }
    };
    const snapshotBody = Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8');
    fs.writeFileSync(SNAPSHOT_PATH, snapshotBody);

    const success = await request('/api/admin/unas/snapshot', {
      'X-Admin-Token': ADMIN_TOKEN
    });
    assert.equal(success.status, 200);
    assert.match(success.headers['content-type'], /^application\/json\b/);
    assert.equal(success.headers['cache-control'], 'no-store');
    assert.deepEqual(success.body, snapshotBody);
    assert.deepEqual(JSON.parse(success.body.toString('utf8')), snapshot);
  } finally {
    await stopServer(child);
    if (fs.existsSync(SNAPSHOT_PATH)) fs.unlinkSync(SNAPSHOT_PATH);
    if (hadSnapshot) fs.writeFileSync(SNAPSHOT_PATH, originalSnapshot);
    if (fs.existsSync(PID_PATH)) fs.unlinkSync(PID_PATH);
    if (hadPid) fs.writeFileSync(PID_PATH, originalPid);
  }

  assert.equal(stderr, '');
  console.log('TEST_UNAS_SNAPSHOT_ENDPOINT: minden ellenőrzés sikeres');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
