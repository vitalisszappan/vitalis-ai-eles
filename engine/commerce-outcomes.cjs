'use strict';

const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const OUTCOME_TYPE = 'verified_order';
const SOURCE = 'unas_server_verified';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function deterministicOutcomeId(orderKey) {
  const bytes = Buffer.from(crypto.createHash('sha256').update(`vitalis-commerce-outcome:v1:${orderKey}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function buildVerifiedOrderOutcome({ proof, order, priorEvents, clickedEvents, verifiedAt = new Date().toISOString() }) {
  const orderSkus = uniqueStrings(order.items.map((item) => item.sku));
  const clickedSkus = uniqueStrings(clickedEvents.map((event) => event.sku));
  const matchedSkus = clickedSkus.filter((sku) => orderSkus.includes(sku));
  if (!matchedSkus.length) throw new Error('verified_sku_match_required');
  const evidenceEvents = priorEvents.filter((event) => matchedSkus.includes(String(event.sku || '')) &&
    (event.event_type === 'product_recommended' || event.event_type === 'product_clicked'));
  return {
    schemaVersion: SCHEMA_VERSION,
    outcomeId: deterministicOutcomeId(proof.orderKey),
    attributionId: proof.attributionId,
    orderKey: proof.orderKey,
    orderId: String(order.id),
    outcomeType: OUTCOME_TYPE,
    matchedSkus,
    clickedSkus,
    conversationSessionIds: uniqueStrings(evidenceEvents.map((event) => event.chat_session_id)),
    recommendationEvidence: evidenceEvents.filter((event) => event.event_type === 'product_recommended').map((event) => ({
      eventId: event.event_id || null, sku: String(event.sku), canonicalProductId: event.canonical_product_id || null,
      recommendationType: event.recommendation_type || null, recommendationRank: event.recommendation_rank || null
    })),
    clickEvidence: evidenceEvents.filter((event) => event.event_type === 'product_clicked').map((event) => ({
      eventId: event.event_id || null, sku: String(event.sku), canonicalProductId: event.canonical_product_id || null
    })),
    verifiedAt,
    source: SOURCE
  };
}

function validateVerifiedOrderOutcome(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_outcome');
  if (value.schemaVersion !== SCHEMA_VERSION) throw new Error('invalid_outcome_schema_version');
  if (!UUID_RE.test(value.outcomeId || '')) throw new Error('invalid_outcome_id');
  if (!UUID_RE.test(value.attributionId || '')) throw new Error('invalid_outcome_attribution_id');
  if (typeof value.orderKey !== 'string' || !value.orderKey || value.orderKey.length > 100) throw new Error('invalid_outcome_order_key');
  if (typeof value.orderId !== 'string' || !value.orderId || value.orderId.length > 100) throw new Error('invalid_outcome_order_id');
  if (value.outcomeType !== OUTCOME_TYPE || value.source !== SOURCE) throw new Error('invalid_outcome_type');
  if (!Array.isArray(value.matchedSkus) || !value.matchedSkus.length || !Array.isArray(value.clickedSkus) || !value.clickedSkus.length) throw new Error('invalid_outcome_skus');
  for (const field of ['conversationSessionIds','recommendationEvidence','clickEvidence']) if (!Array.isArray(value[field])) throw new Error(`invalid_outcome_${field}`);
  if (typeof value.verifiedAt !== 'string' || !Number.isFinite(Date.parse(value.verifiedAt))) throw new Error('invalid_outcome_verified_at');
  return value;
}

module.exports = { SCHEMA_VERSION, OUTCOME_TYPE, SOURCE, deterministicOutcomeId, buildVerifiedOrderOutcome, validateVerifiedOrderOutcome };
