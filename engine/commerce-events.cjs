'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const EVENT_TYPES = Object.freeze([
  'chat_open',
  'chat_started',
  'product_recommended',
  'product_clicked'
]);
const ALLOWED_FIELDS = new Set([
  'eventId', 'attributionId', 'chatSessionId', 'eventType', 'route', 'intent',
  'canonicalProductId', 'unasProductId', 'sku', 'recommendationType',
  'recommendationRank', 'occurredAt', 'schemaVersion'
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_RE = /^[a-zA-Z0-9-]{16,100}$/;

function text(value, max) {
  return typeof value === 'string' && value.length <= max && !/[\r\n\0]/.test(value) ? value : null;
}

function validateEvent(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_payload' };
  const unknown = Object.keys(input).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length) return { ok: false, error: 'unknown_fields' };
  if (input.schemaVersion !== SCHEMA_VERSION) return { ok: false, error: 'invalid_schema_version' };
  if (!UUID_RE.test(input.eventId || '') || !UUID_RE.test(input.attributionId || '')) return { ok: false, error: 'invalid_uuid' };
  if (!EVENT_TYPES.includes(input.eventType)) return { ok: false, error: 'invalid_event_type' };
  if (!SESSION_RE.test(input.chatSessionId || '')) return { ok: false, error: 'invalid_chat_session' };
  const occurredAtMs = Date.parse(input.occurredAt);
  const now = typeof options.now === 'function' ? options.now() : Date.now();
  if (!Number.isFinite(occurredAtMs) || occurredAtMs < now - 31 * 864e5 || occurredAtMs > now + 5 * 60e3) {
    return { ok: false, error: 'invalid_occurred_at' };
  }
  const recommendationType = input.recommendationType == null ? null : text(input.recommendationType, 20);
  if (recommendationType && !['primary', 'secondary', 'related'].includes(recommendationType)) {
    return { ok: false, error: 'invalid_recommendation_type' };
  }
  const rank = input.recommendationRank == null ? null : Number(input.recommendationRank);
  if (rank !== null && (!Number.isInteger(rank) || rank < 1 || rank > 3)) return { ok: false, error: 'invalid_recommendation_rank' };
  if (input.eventType.startsWith('product_')) {
    if (!input.canonicalProductId && !input.unasProductId && !input.sku) return { ok: false, error: 'product_identifier_required' };
    if (!recommendationType || rank === null) return { ok: false, error: 'recommendation_metadata_required' };
  }
  const optionalTextFields = [
    ['chatSessionId', 100], ['route', 60], ['intent', 80], ['canonicalProductId', 100],
    ['unasProductId', 100], ['sku', 100]
  ];
  for (const [name, max] of optionalTextFields) {
    if (input[name] != null && text(input[name], max) === null) return { ok: false, error: 'invalid_field' };
  }
  const fields = {
    event_id: input.eventId,
    attribution_id: input.attributionId,
    chat_session_id: input.chatSessionId == null ? null : text(input.chatSessionId, 100),
    event_type: input.eventType,
    route: input.route == null ? null : text(input.route, 60),
    intent: input.intent == null ? null : text(input.intent, 80),
    canonical_product_id: input.canonicalProductId == null ? null : text(input.canonicalProductId, 100),
    unas_product_id: input.unasProductId == null ? null : text(input.unasProductId, 100),
    sku: input.sku == null ? null : text(input.sku, 100),
    recommendation_type: recommendationType,
    recommendation_rank: rank,
    occurred_at: new Date(occurredAtMs).toISOString(),
    schema_version: SCHEMA_VERSION
  };
  return { ok: true, event: fields };
}

// Local/PoC fallback only. A Render deploy may discard this file, so this adapter
// must never be treated as production-durable idempotency storage.
function createLocalPocEventStore(filePath) {
  const seen = new Set();
  const readRows = () => {
    try { return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
    catch (_) { return []; }
  };
  try {
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      if (!line) continue;
      try { const row = JSON.parse(line); if (UUID_RE.test(row.event_id || '')) seen.add(row.event_id); } catch (_) {}
    }
  } catch (_) {}
  return {
    kind: 'local_poc_jsonl',
    productionDurable: false,
    idempotencyScope: 'available_local_file',
    append(event) {
      if (seen.has(event.event_id)) return { duplicate: true };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, `${JSON.stringify({ ...event, received_at: new Date().toISOString() })}\n`, 'utf8');
      seen.add(event.event_id);
      return { duplicate: false };
    },
    hasEventId(eventId) { return seen.has(eventId); },
    findAttribution(attributionId, beforeIso) {
      const before = beforeIso ? Date.parse(beforeIso) : Infinity;
      return readRows().filter((row) => row.attribution_id === attributionId && Date.parse(row.occurred_at) <= before);
    },
    findProductClickedByAttribution(attributionId, beforeIso) {
      return this.findAttribution(attributionId, beforeIso).filter((row) => row.event_type === 'product_clicked' && row.sku);
    },
    loadRecentEventIds(limit = 1000) { return readRows().slice(-limit).reverse().map((row) => row.event_id); }
  };
}

function createRateLimiter(options = {}) {
  const limit = options.limit || 60;
  const windowMs = options.windowMs || 60_000;
  const now = options.now || Date.now;
  const buckets = new Map();
  return function allow(key) {
    const time = now();
    const bucket = buckets.get(key);
    if (!bucket || time - bucket.startedAt >= windowMs) {
      buckets.set(key, { startedAt: time, count: 1 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= limit;
  };
}

function parseAllowedOrigins(value) {
  return new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    try { return new URL(item).origin; } catch (_) { return ''; }
  }).filter(Boolean));
}

module.exports = {
  SCHEMA_VERSION, EVENT_TYPES, ALLOWED_FIELDS, validateEvent,
  createLocalPocEventStore, createRateLimiter, parseAllowedOrigins
};
