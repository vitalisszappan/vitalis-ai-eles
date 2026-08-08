'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const DEFAULT_CLOCK_DRIFT_MS = 5 * 60 * 1000;
const ALLOWED_FIELDS = new Set(['orderKey', 'attributionId', 'schemaVersion', 'timestamp']);
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ORDER_KEY_RE = /^[A-Za-z0-9._:\/-]+$/;

function validateOrderProof(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_payload' };
  const keys = Object.keys(input);
  if (keys.some((key) => !ALLOWED_FIELDS.has(key))) return { ok: false, error: 'unknown_fields' };
  if (keys.length !== ALLOWED_FIELDS.size || [...ALLOWED_FIELDS].some((key) => !Object.prototype.hasOwnProperty.call(input, key))) return { ok: false, error: 'missing_fields' };
  if (input.schemaVersion !== SCHEMA_VERSION) return { ok: false, error: 'invalid_schema_version' };
  if (!UUID_V4_RE.test(input.attributionId || '')) return { ok: false, error: 'invalid_attribution_id' };
  if (typeof input.orderKey !== 'string' || !input.orderKey.length) return { ok: false, error: 'invalid_order_key' };
  if (input.orderKey.length > 100) return { ok: false, error: 'order_key_too_long' };
  if (!SAFE_ORDER_KEY_RE.test(input.orderKey)) return { ok: false, error: 'unsafe_order_key' };
  if (typeof input.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.timestamp)) return { ok: false, error: 'invalid_timestamp' };
  const timestampMs = Date.parse(input.timestamp);
  const now = typeof options.now === 'function' ? options.now() : Date.now();
  const tolerance = Number.isFinite(options.clockDriftMs) ? options.clockDriftMs : DEFAULT_CLOCK_DRIFT_MS;
  if (!Number.isFinite(timestampMs) || Math.abs(timestampMs - now) > tolerance) return { ok: false, error: 'timestamp_out_of_range' };
  return { ok: true, proof: { orderKey: input.orderKey, attributionId: input.attributionId, schemaVersion: SCHEMA_VERSION, timestamp: new Date(timestampMs).toISOString() } };
}

function readEvents(filePath, attributionId) {
  try { return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((row) => row.attribution_id === attributionId); }
  catch (_) { return []; }
}

// LOCAL/POC ONLY. Render's ephemeral filesystem is not production persistence.
function createLocalPocProofStore(filePath) {
  const rows = new Map();
  try { for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)) { const row = JSON.parse(line); rows.set(row.idempotency_key, row); } } catch (_) {}
  return {
    kind: 'local_poc_jsonl', productionDurable: false, idempotencyScope: 'available_local_file',
    get(key) { return rows.get(key) || null; },
    append(row) {
      if (rows.has(row.idempotency_key)) return { duplicate: true, row: rows.get(row.idempotency_key) };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf8'); rows.set(row.idempotency_key, row);
      return { duplicate: false, row };
    }
  };
}

function idempotencyKey(proof) { return `${proof.schemaVersion}:${proof.attributionId}:${proof.orderKey}`; }

async function processOrderProof(proof, options) {
  const key = idempotencyKey(proof);
  let existing;
  try { existing = options.proofStore.findProof
    ? await options.proofStore.findProof({ schemaVersion: proof.schemaVersion, attributionId: proof.attributionId, orderKey: proof.orderKey })
    : await options.proofStore.get(key); }
  catch (_) { return { ok: false, verified: false, duplicate: false, error: 'proof_storage_failed' }; }
  if (existing) return { ok: true, verified: existing.verified === true, duplicate: true };
  const proofTime = Date.parse(proof.timestamp);
  let events;
  try {
    events = options.eventStore
      ? await options.eventStore.findAttribution(proof.attributionId, proof.timestamp)
      : await (options.findEvents || readEvents)(options.eventLogPath, proof.attributionId);
  } catch (_) { return { ok: false, verified: false, duplicate: false, error: 'commerce_event_store_unavailable' }; }
  const priorEvents = events.filter((row) => Number.isFinite(Date.parse(row.occurred_at)) && Date.parse(row.occurred_at) <= proofTime);
  if (!priorEvents.length) return { ok: false, verified: false, duplicate: false, error: 'attribution_not_found' };
  let clickedEvents;
  try {
    clickedEvents = options.eventStore
      ? await options.eventStore.findProductClickedByAttribution(proof.attributionId, proof.timestamp)
      : priorEvents.filter((row) => row.event_type === 'product_clicked' && row.sku);
  } catch (_) { return { ok: false, verified: false, duplicate: false, error: 'commerce_event_store_unavailable' }; }
  const clickedSkus = new Set(clickedEvents.map((row) => String(row.sku)).filter(Boolean));
  if (!clickedSkus.size) return { ok: false, verified: false, duplicate: false, error: 'product_clicked_not_found' };
  let verification;
  try { verification = await options.verifyOrder(proof.orderKey); } catch (_) { return { ok: false, verified: false, duplicate: false, error: 'unas_verification_failed' }; }
  if (!verification?.ok) return { ok: false, verified: false, duplicate: false, error: 'unas_verification_failed' };
  const order = verification.order;
  const orderSkus = Array.isArray(order?.items) ? order.items.filter((item) => item?.id && item?.sku).map((item) => String(item.sku)) : [];
  const verified = order?.key === proof.orderKey && Boolean(order?.id) && orderSkus.length > 0 && orderSkus.some((sku) => clickedSkus.has(sku));
  const row = { schema_version: proof.schemaVersion, attribution_id: proof.attributionId, order_key: proof.orderKey, verified, verified_at: verified ? new Date().toISOString() : null };
  let stored;
  try { stored = options.proofStore.insertProof ? await options.proofStore.insertProof(row) : await options.proofStore.append({ ...row, idempotency_key: key }); }
  catch (_) { return { ok: false, verified: false, duplicate: false, error: 'proof_storage_failed' }; }
  return { ok: true, verified: stored?.duplicate ? stored.row?.verified === true : verified, duplicate: stored?.duplicate === true };
}

module.exports = { SCHEMA_VERSION, DEFAULT_CLOCK_DRIFT_MS, ALLOWED_FIELDS, validateOrderProof, createLocalPocProofStore, idempotencyKey, processOrderProof, readEvents };
