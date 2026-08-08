'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCommerceEventStore, createSupabaseCommerceEventStore, createLocalCommerceEventStore, createUnavailableProductionStore } = require('./engine/commerce-event-store.cjs');
const { validateEvent } = require('./engine/commerce-events.cjs');
const { createLocalPocProofStore, processOrderProof } = require('./engine/order-proof.cjs');

function mockSupabase() {
  const rows = new Map();
  return async ({ method = 'GET', pathname, body }) => {
    if (method === 'POST') {
      if (rows.has(body.event_id)) return { body: '[]' };
      rows.set(body.event_id, { ...body, received_at: new Date().toISOString() });
      return { body: JSON.stringify([{ event_id: body.event_id }]) };
    }
    const url = new URL(`https://mock.invalid${pathname}`);
    let result = [...rows.values()];
    const attribution = url.searchParams.get('attribution_id')?.replace(/^eq\./, '');
    const eventId = url.searchParams.get('event_id')?.replace(/^eq\./, '');
    const eventType = url.searchParams.get('event_type')?.replace(/^eq\./, '');
    const before = url.searchParams.get('occurred_at')?.replace(/^lte\./, '');
    if (attribution) result = result.filter((row) => row.attribution_id === attribution);
    if (eventId) result = result.filter((row) => row.event_id === eventId);
    if (eventType) result = result.filter((row) => row.event_type === eventType);
    if (before) result = result.filter((row) => row.occurred_at <= before);
    if (url.searchParams.get('sku') === 'not.is.null') result = result.filter((row) => row.sku != null);
    return { body: JSON.stringify(result) };
  };
}

async function main() {
  const now = Date.now();
  const attributionId = crypto.randomUUID();
  const input = {
    eventId: crypto.randomUUID(), attributionId, chatSessionId: crypto.randomUUID(), eventType: 'product_clicked',
    route: 'product', intent: 'recommendation', canonicalProductId: 'dermavital_sampon', unasProductId: '123', sku: 'SKU-1',
    recommendationType: 'primary', recommendationRank: 1, occurredAt: new Date(now - 1000).toISOString(), schemaVersion: 1
  };
  const validation = validateEvent(input, { now: () => now });
  assert.equal(validation.ok, true);
  assert.equal(validateEvent({ ...input, email: 'pii@example.com' }, { now: () => now }).error, 'unknown_fields');

  const request = mockSupabase();
  const firstProcess = createSupabaseCommerceEventStore({ request });
  assert.deepEqual(await firstProcess.insertEvent(validation.event), { duplicate: false });
  assert.deepEqual(await firstProcess.insertEvent(validation.event), { duplicate: true });
  assert.equal(await firstProcess.hasEventId(input.eventId), true);

  // New adapter instance simulates a server restart; the authoritative remote rows remain.
  const afterRestart = createSupabaseCommerceEventStore({ request });
  assert.equal((await afterRestart.findAttribution(attributionId, new Date(now).toISOString())).length, 1);
  assert.equal((await afterRestart.findProductClickedByAttribution(attributionId, new Date(now).toISOString()))[0].sku, 'SKU-1');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-supabase-commerce-'));
  try {
    const proofStore = createLocalPocProofStore(path.join(temp, 'proofs.jsonl'));
    const result = await processOrderProof({ orderKey: '970185', attributionId, schemaVersion: 1, timestamp: new Date(now).toISOString() }, {
      eventStore: afterRestart, proofStore,
      verifyOrder: async (key) => ({ ok: true, order: { key, id: '99212-970185', date: '2026.08.08', items: [{ id: '1', sku: 'SKU-1' }] } })
    });
    assert.deepEqual(result, { ok: true, verified: true, duplicate: false });
    const local = createLocalCommerceEventStore(path.join(temp, 'local-events.jsonl'));
    assert.equal(local.kind, 'local_poc_jsonl'); assert.equal(local.productionDurable, false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }

  const unavailable = createUnavailableProductionStore();
  assert.equal(unavailable.kind, 'unavailable'); assert.equal(unavailable.productionDurable, false);
  await assert.rejects(unavailable.insertEvent(validation.event), /production_commerce_event_store_unavailable/);
  assert.equal(createCommerceEventStore({ productionRuntime: true, supabaseConfigured: false }).kind, 'unavailable');
  assert.equal(createCommerceEventStore({ productionRuntime: false, supabaseConfigured: false, filePath: path.join(os.tmpdir(), 'unused-commerce-events.jsonl') }).kind, 'local_poc_jsonl');
  console.log('Supabase commerce event storage, restart es proof lookup: OK');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
