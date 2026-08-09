'use strict';

const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const OUTCOME_TYPE = 'verified_order';
const SOURCE = 'unas_server_verified';

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

module.exports = { SCHEMA_VERSION, OUTCOME_TYPE, SOURCE, deterministicOutcomeId, buildVerifiedOrderOutcome };
