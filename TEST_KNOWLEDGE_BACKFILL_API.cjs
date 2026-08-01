'use strict';
const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const APP_PORT = 3401, SUPABASE_PORT = 3402, TOKEN = 'backfill-admin-token';
const SECRET = 'sb_secret_BACKFILL_SECRET_MUST_NOT_LEAK', LEAK_MARKER = 'SUPABASE_PRIVATE_ERROR_MUST_NOT_LEAK';
const PRIVATE_ANSWER = 'private-answer', PRIVATE_URL = '/private-page', PRIVATE_AGENT = 'private-agent';
const state = { fail: false, delay: false, legacyKnowledgeTaskSchema: false, tasks: new Map(), conversations: [{ id: 77, created_at: '2026-07-31T10:00:00.000Z',
  session_id: 'session-private', question: 'Mennyi a szállítási idő?', answer: PRIVATE_ANSWER, confidence: 0.2,
  matched_knowledge_ids: [], source: 'gap', response_ms: 20, user_agent: PRIVATE_AGENT, page_url: PRIVATE_URL }] };
function json(res, status, body) { const text = JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) }); res.end(text); }
function readBody(req) { return new Promise(resolve => { let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => resolve(body ? JSON.parse(body) : null)); }); }
const supabase = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${SUPABASE_PORT}`);
  if (state.fail) return json(res, 500, { message: LEAK_MARKER });
  if (req.method === 'GET' && url.pathname === '/rest/v1/chat_conversations') { if (state.delay) await new Promise(resolve => setTimeout(resolve, 200)); return json(res, 200, state.conversations); }
  if (req.method === 'GET' && url.pathname === '/rest/v1/knowledge_tasks') return json(res, 200, [...state.tasks.values()]);
  if (req.method === 'POST' && url.pathname === '/rest/v1/knowledge_tasks') { const row = await readBody(req);
    if (state.legacyKnowledgeTaskSchema && Object.prototype.hasOwnProperty.call(row, 'root_cause')) return json(res, 400, { code: 'PGRST204', message: "Could not find the 'root_cause' column of 'knowledge_tasks' in the schema cache" });
    state.tasks.set(row.id, row); res.writeHead(201, { 'Content-Type': 'application/json' }); return res.end(''); }
  return json(res, 404, { message: 'not found' });
});
function request(pathname, token, body) { return new Promise((resolve, reject) => {
  const text = body === undefined ? null : JSON.stringify(body);
  const req = http.request({ hostname: '127.0.0.1', port: APP_PORT, method: 'POST', path: pathname, headers: {
    ...(token ? { 'X-Admin-Token': token } : {}), ...(text ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) } : {}) } }, res => {
    let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }));
  }); req.on('error', reject); if (text) req.write(text); req.end();
}); }
async function main() {
  await new Promise(resolve => supabase.listen(SUPABASE_PORT, '127.0.0.1', resolve));
  let output = '';
  const child = spawn(process.execPath, ['server.cjs'], { cwd: __dirname, env: { ...process.env, PORT: String(APP_PORT), HOST: '127.0.0.1', ADMIN_TOKEN: TOKEN,
    SUPABASE_URL: `http://127.0.0.1:${SUPABASE_PORT}`, SUPABASE_SERVICE_ROLE_KEY: SECRET, UNAS_API_KEY: '', UNAS_SYNC_INTERVAL_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  try {
    let ready = false; for (let i = 0; i < 50; i += 1) { try { if ((await request('/api/admin/knowledge-tasks/backfill', TOKEN)).status === 200) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); } assert(ready);
    state.tasks.clear();
    assert.equal((await request('/api/admin/knowledge-tasks/backfill', null, {})).status, 401);
    assert.equal((await request(`/api/admin/knowledge-tasks/backfill?token=${TOKEN}`, null, {})).status, 401);
    const dry = await request('/api/admin/knowledge-tasks/backfill', TOKEN, {});
    assert.equal(dry.status, 200);
    assert.deepEqual({ storageUsed: dry.body.storageUsed, conversationsRead: dry.body.conversationsRead, tasksCreated: dry.body.tasksCreated,
      tasksUpdated: dry.body.tasksUpdated, skipped: dry.body.skipped, dryRun: dry.body.dryRun },
    { storageUsed: 'supabase', conversationsRead: 1, tasksCreated: 1, tasksUpdated: 0, skipped: 0, dryRun: true });
    const dryText = JSON.stringify(dry.body);
    assert.equal(state.tasks.size, 0); for (const privateValue of ['szállítási', 'session-private', PRIVATE_ANSWER, PRIVATE_URL, PRIVATE_AGENT]) assert.equal(dryText.includes(privateValue), false);
    assert.equal(dry.body.classificationSummary.missing_knowledge, 1);
    const nonBooleanWrite = await request('/api/admin/knowledge-tasks/backfill', TOKEN, { write: 'true' });
    assert.equal(nonBooleanWrite.status, 200); assert.equal(nonBooleanWrite.body.dryRun, true); assert.equal(state.tasks.size, 0);
    state.legacyKnowledgeTaskSchema = true;
    const legacyWritten = await request('/api/admin/knowledge-tasks/backfill', TOKEN, { write: true });
    assert.equal(legacyWritten.status, 200); assert.equal(legacyWritten.body.tasksCreated, 1); assert.equal(legacyWritten.body.dryRun, false); assert.equal(state.tasks.size, 1);
    const legacyRow = [...state.tasks.values()][0]; assert.equal(Object.prototype.hasOwnProperty.call(legacyRow, 'root_cause'), false);
    await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(output.includes('code=PGRST204'), true); assert.equal(output.includes('session-private'), false); assert.equal(output.includes(PRIVATE_ANSWER), false);
    state.legacyKnowledgeTaskSchema = false; state.tasks.clear();
    const written = await request('/api/admin/knowledge-tasks/backfill', TOKEN, { write: true });
    assert.equal(written.status, 200); assert.equal(written.body.tasksCreated, 1); assert.equal(written.body.dryRun, false); assert.equal(state.tasks.size, 1);
    const existing = [...state.tasks.values()][0]; existing.status = 'in_review'; existing.reviewer_note = 'Megőrzendő review'; state.tasks.set(existing.id, existing);
    state.conversations.push({ ...state.conversations[0], id: 78, created_at: '2026-08-01T10:00:00.000Z' });
    const updated = await request('/api/admin/knowledge-tasks/backfill', TOKEN, { write: true });
    assert.equal(updated.status, 200); assert.equal(updated.body.tasksUpdated, 1); assert.equal(state.tasks.size, 1);
    const preserved = [...state.tasks.values()][0]; assert.equal(preserved.status, 'in_review'); assert.equal(preserved.reviewer_note, 'Megőrzendő review');
    const second = await request('/api/admin/knowledge-tasks/backfill', TOKEN, { write: true });
    assert.equal(second.status, 200); assert.equal(second.body.skipped, 1); assert.equal(second.body.tasksCreated, 0); assert.equal(second.body.tasksUpdated, 0); assert.equal(state.tasks.size, 1);
    state.delay = true; const first = request('/api/admin/knowledge-tasks/backfill', TOKEN, {}); await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal((await request('/api/admin/knowledge-tasks/backfill', TOKEN, {})).status, 409); assert.equal((await first).status, 200); state.delay = false;
    state.fail = true; const failed = await request('/api/admin/knowledge-tasks/backfill', TOKEN, { write: true });
    assert.equal(failed.status, 500); assert.deepEqual(failed.body, { ok: false, error: 'A Knowledge Task backfill jelenleg nem futtatható.' });
    await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(JSON.stringify(failed.body).includes(LEAK_MARKER), false); assert.equal(output.includes(LEAK_MARKER), false); assert.equal(output.includes(SECRET), false);
    console.log('Knowledge Task Supabase backfill API regressziótesztek: OK');
  } finally { child.kill('SIGTERM'); await new Promise(resolve => setTimeout(resolve, 150)); await new Promise(resolve => supabase.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
