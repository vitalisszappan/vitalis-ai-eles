'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateEvent, createLocalPocEventStore, createRateLimiter } = require('./engine/commerce-events.cjs');

const now = Date.parse('2026-08-07T10:00:00Z');
const base = {
  eventId: crypto.randomUUID(), attributionId: crypto.randomUUID(),
  chatSessionId: crypto.randomUUID(), eventType: 'product_clicked',
  route: 'product', intent: 'product_detail', canonicalProductId: 'soap-1',
  unasProductId: '1553769891', sku: 'Vitdermsamp01', recommendationType: 'primary',
  recommendationRank: 1, occurredAt: new Date(now).toISOString(), schemaVersion: 1
};

const valid = validateEvent(base, { now: () => now });
assert.equal(valid.ok, true);
for (const forbidden of ['email', 'name', 'phone', 'address', 'message', 'url', 'revenue', 'price', 'adminToken', 'apiKey']) {
  assert.equal(validateEvent({ ...base, [forbidden]: 'forbidden' }, { now: () => now }).error, 'unknown_fields');
}
assert.equal(validateEvent({ ...base, eventId: 'bad' }, { now: () => now }).error, 'invalid_uuid');
assert.equal(validateEvent({ ...base, chatSessionId: null }, { now: () => now }).error, 'invalid_chat_session');
assert.equal(validateEvent({ ...base, eventType: 'purchase_attributed' }, { now: () => now }).error, 'invalid_event_type');
assert.equal(validateEvent({ ...base, schemaVersion: 2 }, { now: () => now }).error, 'invalid_schema_version');
assert.equal(validateEvent({ ...base, occurredAt: 'invalid' }, { now: () => now }).error, 'invalid_occurred_at');
assert.equal(validateEvent({ ...base, canonicalProductId: null, unasProductId: null, sku: null }, { now: () => now }).error, 'product_identifier_required');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-commerce-'));
const file = path.join(dir, 'events.jsonl');
const store = createLocalPocEventStore(file);
assert.equal(store.kind, 'local_poc_jsonl');
assert.equal(store.productionDurable, false);
assert.equal(store.idempotencyScope, 'available_local_file');
assert.equal(store.append(valid.event).duplicate, false);
assert.equal(store.append(valid.event).duplicate, true);
assert.equal(fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).length, 1);
assert.equal(createLocalPocEventStore(file).append(valid.event).duplicate, true, 'A rendelkezésre álló helyi PoC fájlon belül újranyitás után is idempotens.');

let clock = 0;
const allow = createRateLimiter({ limit: 2, windowMs: 1000, now: () => clock });
assert.equal(allow('client'), true); assert.equal(allow('client'), true); assert.equal(allow('client'), false);
clock = 1001; assert.equal(allow('client'), true);
fs.rmSync(dir, { recursive: true, force: true });
console.log('Commerce event validációs és idempotencia tesztek: OK');
