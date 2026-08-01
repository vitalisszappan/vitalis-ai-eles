'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { inspectServiceRoleKey, loadEnvironment, parseEnv, run } = require('./scripts/backfill-knowledge-tasks.cjs');

assert.deepEqual(parseEnv('A=one\nexport B="two words"\n# C=no\n'), { A: 'one', B: 'two words' });
const jwt = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"role":"service_role"}').toString('base64url')}.x`;
assert.equal(inspectServiceRoleKey(jwt).serviceRole, true);
const anonJwt = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"role":"anon"}').toString('base64url')}.x`;
assert.equal(inspectServiceRoleKey(anonJwt).serviceRole, false);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-backfill-'));
fs.writeFileSync(path.join(temp, '.env'), 'FROM_ENV=base\nORDER=base\n');
fs.writeFileSync(path.join(temp, '.env.local'), 'ORDER=local\n');
const environment = {};
assert.deepEqual(loadEnvironment(temp, environment), ['.env.local', '.env']);
assert.deepEqual(environment, { ORDER: 'local', FROM_ENV: 'base' });

(async () => {
  const dry = await run({ args: [], environment: {} });
  assert.equal(dry.selectedStorage, 'jsonl');
  assert.equal(dry.writeResult, 'neither');
  let received;
  const supabase = await run({
    args: ['--write'], environment: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test' },
    supabaseWrite: async request => { received = request; return { count: request.rows.length }; }
  });
  assert.equal(supabase.selectedStorage, 'supabase');
  assert.equal(supabase.writes.supabase.records, supabase.tasks);
  assert.equal(supabase.writes.supabase.occurred, true);
  assert.equal(supabase.writes.jsonl.occurred, false);
  assert.equal(supabase.writeResult, 'supabase');
  assert(received.rows.every(row => row.normalized_question_key));
  await assert.rejects(() => run({
    args: ['--write'], environment: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: anonJwt },
    supabaseWrite: async () => { throw new Error('nem hivhato'); }
  }), /nem service role/);
  console.log('Knowledge Task backfill regressziotesztek: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
