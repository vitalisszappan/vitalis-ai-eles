'use strict';
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');
const { mergeTasks } = require('../engine/knowledge-tasks.cjs');

const root = path.join(__dirname, '..');
const input = path.join(root, 'data', 'logs', 'conversations.jsonl');
const output = path.join(root, 'data', 'logs', 'knowledge-tasks.jsonl');
const mappingPath = path.join(root, 'data', 'canonical-unas-mapping.json');

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    values[match[1]] = value.replace(/\\n/g, '\n');
  }
  return values;
}

function loadEnvironment(baseDir = root, environment = process.env) {
  const loaded = [];
  for (const name of ['.env.local', '.env']) {
    const file = path.join(baseDir, name);
    if (!fs.existsSync(file)) continue;
    loaded.push(name);
    for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) {
      if (environment[key] === undefined) environment[key] = value;
    }
  }
  return loaded;
}

function inspectServiceRoleKey(key) {
  if (!key) return { type: 'missing', serviceRole: false };
  if (key.startsWith('sb_secret_')) return { type: 'secret', serviceRole: true };
  if (key.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
      return { type: 'legacy-jwt', serviceRole: payload.role === 'service_role', role: payload.role || null };
    } catch { return { type: 'invalid-jwt', serviceRole: false }; }
  }
  return { type: 'unknown', serviceRole: false };
}

function taskToRow(task) {
  return {
    id: task.id, normalized_question_key: task.normalizedQuestionKey, conversation_id: task.conversationId,
    conversation_ids: task.conversationIds, question: task.question, answer: task.answer, answer_source: task.answerSource,
    confidence_score: task.confidenceScore, detected_intent: task.detectedIntent, canonical_ids: task.canonicalIds,
    page_url: task.pageUrl, occurred_at: task.occurredAt, classification: task.classification,
    classification_reason: task.classificationReason, root_cause: task.rootCause, root_cause_reason: task.rootCauseReason,
    repair_target: task.repairTarget, estimated_impact: task.estimatedImpact, impact_breakdown: task.impactBreakdown,
    priority: task.priority, business_value: task.businessValue, topic: task.topic, product_family: task.productFamily,
    suggested_action: task.suggestedAction, status: task.status, occurrence_count: task.occurrenceCount,
    first_seen_at: task.firstSeenAt, last_seen_at: task.lastSeenAt, reviewer_note: task.reviewerNote,
    reviewed_at: task.reviewedAt, resolved_at: task.resolvedAt, created_at: task.createdAt, updated_at: task.updatedAt
  };
}

function supabaseRequest({ url, key, rows }) {
  return new Promise((resolve, reject) => {
    let base;
    try { base = new URL(url); } catch (error) { reject(new Error(`Hibas SUPABASE_URL: ${error.message}`)); return; }
    if (!['https:', 'http:'].includes(base.protocol)) { reject(new Error(`Nem tamogatott SUPABASE_URL protokoll: ${base.protocol}`)); return; }
    const body = JSON.stringify(rows);
    const headers = { apikey: key, Accept: 'application/json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Prefer: 'resolution=merge-duplicates,return=representation' };
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
    const request = (base.protocol === 'https:' ? https : http).request({
      protocol: base.protocol, hostname: base.hostname, port: base.port || undefined,
      method: 'POST', path: '/rest/v1/knowledge_tasks?on_conflict=id', headers, timeout: 15000
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => {
        const status = response.statusCode || 0;
        if (status < 200 || status >= 300) { reject(new Error(`Supabase HTTP ${status}: ${responseBody || response.statusMessage || 'ismeretlen hiba'}`)); return; }
        let written;
        try { written = JSON.parse(responseBody || '[]'); } catch { reject(new Error('A Supabase irasi valasza nem ervenyes JSON.')); return; }
        if (!Array.isArray(written) || written.length !== rows.length) {
          reject(new Error(`A Supabase ${rows.length} rekord helyett ${Array.isArray(written) ? written.length : 0} rekordot igazolt vissza.`)); return;
        }
        resolve({ status, count: written.length });
      });
    });
    request.on('timeout', () => request.destroy(new Error('Supabase kapcsolat idotullepes.')));
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function writeJsonl(tasks, file = output) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, tasks.map(task => JSON.stringify(task)).join('\n') + (tasks.length ? '\n' : ''), 'utf8');
  return tasks.length;
}

async function run(options = {}) {
  const args = options.args || process.argv.slice(2);
  const environment = options.environment || process.env;
  const loadedEnvFiles = loadEnvironment(options.root || root, environment);
  const conversations = fs.existsSync(input) ? fs.readFileSync(input, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
  const mapping = fs.existsSync(mappingPath) ? JSON.parse(fs.readFileSync(mappingPath, 'utf8')) : { mappings: [] };
  const productStatuses = Object.fromEntries((mapping.mappings || []).map(item => [item.canonicalId, item.mappingStatus]));
  const tasks = mergeTasks(conversations, { productStatuses });
  const write = args.includes('--write');
  const url = String(environment.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(environment.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const keyInfo = inspectServiceRoleKey(key);
  const configured = Boolean(url && key);
  const writes = { supabase: { occurred: false, records: 0 }, jsonl: { occurred: false, records: 0 } };
  const summary = {
    dryRun: !write, conversations: conversations.length, tasks: tasks.length,
    environment: { loadedFiles: loadedEnvFiles, supabaseUrl: Boolean(url), serviceRoleKey: keyInfo.type, serviceRole: keyInfo.serviceRole },
    selectedStorage: configured ? 'supabase' : 'jsonl', writes
  };
  if (write) {
    if (configured) {
      if (!keyInfo.serviceRole) throw new Error(`A SUPABASE_SERVICE_ROLE_KEY nem service role kulcs (tipus: ${keyInfo.type}${keyInfo.role ? `, role: ${keyInfo.role}` : ''}).`);
      const result = await (options.supabaseWrite || supabaseRequest)({ url, key, rows: tasks.map(taskToRow) });
      writes.supabase = { occurred: true, records: result.count };
    } else writes.jsonl = { occurred: true, records: (options.jsonlWrite || writeJsonl)(tasks) };
  }
  summary.writeResult = writes.supabase.occurred && writes.jsonl.occurred ? 'both' : writes.supabase.occurred ? 'supabase' : writes.jsonl.occurred ? 'jsonl' : 'neither';
  return summary;
}

if (require.main === module) {
  run().then(summary => console.log(JSON.stringify(summary, null, 2))).catch(error => {
    console.error(JSON.stringify({ ok: false, writeResult: 'neither', error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
module.exports = { inspectServiceRoleKey, loadEnvironment, parseEnv, run, supabaseRequest, taskToRow, writeJsonl };
