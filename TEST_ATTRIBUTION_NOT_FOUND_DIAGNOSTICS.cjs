'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  CHECK_DELAYS_MS,
  createAttributionNotFoundDiagnostics,
  originBucket
} = require('./engine/attribution-not-found-diagnostics.cjs');

const ATTRIBUTION = '10000000-0000-4000-8000-000000000001';
const ORDER_KEY = '99212-private';
const SKU = 'PRIVATE-SKU';
const PII = 'customer@example.invalid';
const SECRET = 'super-secret-token';
const PROOF_TIME = Date.parse('2026-08-14T12:00:00.000Z');

function fixture(overrides = {}) {
  const logs = [];
  const timers = [];
  const lookups = [];
  const diagnostics = createAttributionNotFoundDiagnostics({
    lookupEvents: async (attributionId) => {
      lookups.push(attributionId);
      return [
        { event_type: 'product_recommended', received_at: '2026-08-14T12:00:00.500Z', sku: SKU, pii: PII },
        { event_type: 'product_clicked', received_at: '2026-08-14T12:00:01.000Z', sku: SKU, secret: SECRET }
      ];
    },
    logger: (event) => logs.push(event),
    randomUUID: () => '90000000-0000-4000-8000-000000000009',
    now: () => PROOF_TIME + 125,
    schedule: (callback, delay) => { const timer = { callback, delay, cancelled: false }; timers.push(timer); return timer; },
    cancelSchedule: (timer) => { timer.cancelled = true; },
    lookupWithTimeout: (run) => run(),
    ...overrides
  });
  return { diagnostics, logs, timers, lookups };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

(async () => {
  assert.equal(originBucket('https://vitalis-szappan.hu'), 'apex');
  assert.equal(originBucket('https://www.vitalis-szappan.hu'), 'www');
  assert.equal(originBucket('https://checkout.example'), 'other_allowed');

  const run = fixture();
  const started = Date.now();
  assert.equal(run.diagnostics.observeFailure('product_clicked_not_found', { attributionId: ATTRIBUTION, proofTimestamp: new Date(PROOF_TIME).toISOString(), origin: 'https://www.vitalis-szappan.hu' }), null);
  assert.equal(run.logs.length, 0);
  assert.equal(run.timers.length, 0);
  const diagnosticId = run.diagnostics.observeFailure('attribution_not_found', { attributionId: ATTRIBUTION, proofTimestamp: new Date(PROOF_TIME).toISOString(), origin: 'https://www.vitalis-szappan.hu' });
  assert.equal(Date.now() - started < 100, true, 'observe must not wait for follow-up checks');
  assert.equal(diagnosticId, '90000000-0000-4000-8000-000000000009');
  assert.deepEqual(run.timers.map((timer) => timer.delay), CHECK_DELAYS_MS);
  assert.equal(run.lookups.length, 0);
  assert.deepEqual(run.logs[0], {
    diagnosticId,
    failure: 'attribution_not_found',
    origin_bucket: 'www',
    initial_event_count: 0,
    proof_age_ms: 125
  });

  run.timers[0].callback();
  await flush();
  run.timers[1].callback();
  await flush();
  assert.deepEqual(run.lookups, [ATTRIBUTION, ATTRIBUTION]);
  assert.equal(run.logs.length, 3);
  assert.equal(run.logs.every((event) => event.diagnosticId === diagnosticId), true);
  assert.deepEqual(run.logs.slice(1).map((event) => event.check_delay_ms), CHECK_DELAYS_MS);
  for (const event of run.logs.slice(1)) {
    assert.equal(event.event_count, 2);
    assert.equal(event.recommended_count, 1);
    assert.equal(event.clicked_count, 1);
    assert.equal(event.first_received_after_proof_ms, 500);
    assert.deepEqual(Object.keys(event).sort(), ['check_delay_ms', 'clicked_count', 'diagnosticId', 'event_count', 'first_received_after_proof_ms', 'recommended_count'].sort());
  }
  const serialized = JSON.stringify(run.logs);
  for (const forbidden of [ATTRIBUTION, ORDER_KEY, SKU, PII, SECRET, 'proofId', 'eventId', 'Customer']) {
    assert.equal(serialized.includes(forbidden), false);
  }

  let rejectionCalls = 0;
  const rejected = fixture({ lookupEvents: async () => { rejectionCalls += 1; throw new Error(`${PII} ${SECRET}`); } });
  rejected.diagnostics.observeFailure('attribution_not_found', { attributionId: ATTRIBUTION, proofTimestamp: new Date(PROOF_TIME).toISOString(), origin: 'https://vitalis-szappan.hu' });
  rejected.timers.forEach((timer) => timer.callback());
  await flush();
  assert.equal(rejectionCalls, 2);
  assert.equal(rejected.logs.length, 1);

  const shutdown = fixture();
  shutdown.diagnostics.observeFailure('attribution_not_found', { attributionId: ATTRIBUTION, proofTimestamp: new Date(PROOF_TIME).toISOString(), origin: 'https://vitalis-szappan.hu' });
  shutdown.diagnostics.close();
  assert.equal(shutdown.timers.every((timer) => timer.cancelled), true);
  shutdown.timers.forEach((timer) => { if (!timer.cancelled) timer.callback(); });
  await flush();
  assert.equal(shutdown.lookups.length, 0);

  const serverSource = fs.readFileSync('./server.cjs', 'utf8');
  assert.match(serverSource, /attributionNotFoundDiagnostics\.observeFailure\(result\.error/);
  const moduleSource = fs.readFileSync('./engine/attribution-not-found-diagnostics.cjs', 'utf8');
  for (const forbidden of ['insertEvent', 'insertProof', 'verifyUnasOrder', 'persistVerified', 'createRevenue', 'POST', 'PATCH', 'DELETE']) {
    assert.equal(moduleSource.includes(forbidden), false);
  }

  console.log('Attribution-not-found bounded PII-free observability: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
