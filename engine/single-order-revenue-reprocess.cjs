'use strict';

const TARGET_ORDER_KEY = '99212-459544';

function stop(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function stringSet(values) {
  return new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean));
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function requireMonetaryEvidence(order) {
  if (!order?.currency || !order?.date || !order?.status || !order?.statusId || !order?.statusType) {
    stop('MONETARY_EVIDENCE_REQUIRED');
  }
  if (!Array.isArray(order.items) || order.items.length === 0 || order.items.some((item) => (
    !item?.id || !item?.quantity || !item?.priceGross
  ))) stop('MONETARY_EVIDENCE_REQUIRED');
}

async function runSingleOrderRevenueReprocess(options = {}) {
  const orderKey = options.orderKey || TARGET_ORDER_KEY;
  if (orderKey !== TARGET_ORDER_KEY) stop('EXACT_ORDER_KEY_REQUIRED');
  for (const name of ['loadProof', 'loadEvents', 'loadOutcome', 'fetchRevenueEvidence']) {
    if (typeof options[name] !== 'function') stop('REPROCESS_DEPENDENCIES_REQUIRED');
  }
  if (typeof options.phase4?.persistVerified !== 'function') stop('REPROCESS_DEPENDENCIES_REQUIRED');

  const proof = await options.loadProof(orderKey);
  if (!proof?.proof_id) stop('VERIFIED_PROOF_REQUIRED');
  if (proof.verified !== true || !proof.verified_at || !validUuid(proof.attribution_id)) stop('VERIFIED_PROOF_REQUIRED');

  const proofTime = Date.parse(proof.verified_at);
  if (!Number.isFinite(proofTime)) stop('VERIFIED_PROOF_REQUIRED');
  const events = await options.loadEvents(proof.attribution_id, proof.verified_at);
  if (!Array.isArray(events) || events.some((event) => (
    event.attribution_id !== proof.attribution_id ||
    !Number.isFinite(Date.parse(event.occurred_at)) ||
    Date.parse(event.occurred_at) > proofTime
  ))) stop('ATTRIBUTION_EVIDENCE_INVALID');
  const recommendations = (events || []).filter((event) => event.event_type === 'product_recommended' && event.sku);
  const clicks = (events || []).filter((event) => event.event_type === 'product_clicked' && event.sku);
  if (!recommendations.length || !clicks.length) stop('ATTRIBUTION_EVIDENCE_REQUIRED');

  const [outcome, verification] = await Promise.all([
    options.loadOutcome(orderKey),
    options.fetchRevenueEvidence(orderKey)
  ]);
  if (!verification?.ok) {
    if (verification?.reason === 'order_not_found') stop('UNAS_ORDER_NOT_FOUND');
    if (verification?.reason === 'multiple_orders') stop('UNAS_MULTIPLE_ORDERS');
    stop('UNAS_REVENUE_VERIFICATION_FAILED');
  }
  const order = verification.order;
  if (order?.key !== orderKey) stop('UNAS_REVENUE_VERIFICATION_FAILED');
  requireMonetaryEvidence(order);
  if (outcome && (
    outcome.order_key !== orderKey ||
    outcome.attribution_id !== proof.attribution_id
  )) stop('OUTCOME_EVIDENCE_MISMATCH');

  const orderSkus = stringSet(order.items.map((item) => item.sku));
  const recommendedSkus = stringSet(recommendations.map((event) => event.sku));
  const clickedSkus = stringSet(clicks.map((event) => event.sku));
  const candidateSkus = Array.isArray(outcome?.matched_skus) && outcome.matched_skus.length
    ? stringSet(outcome.matched_skus)
    : recommendedSkus;
  const matchedSkus = [...candidateSkus].filter((sku) => (
    orderSkus.has(sku) && recommendedSkus.has(sku) && clickedSkus.has(sku)
  ));
  if (!matchedSkus.length) stop('SKU_MISMATCH');

  const context = {
    proof: { orderKey, attributionId: proof.attribution_id },
    proofRow: proof,
    order,
    priorEvents: events,
    clickedEvents: clicks,
    outcome: { outcomeId: outcome?.outcome_id || null, matchedSkus },
    evidenceCapturedAt: new Date().toISOString()
  };
  const first = await options.phase4.persistVerified(context);
  if (first?.duplicate !== false || first?.code !== 'created') stop('FIRST_PERSISTENCE_FAILED');
  const second = await options.phase4.persistVerified(context);
  if (second?.duplicate !== true || second?.code !== 'duplicate') stop('IDEMPOTENCY_FAILED');
  if (!first.revenueOrderId || second.revenueOrderId !== first.revenueOrderId) stop('IDEMPOTENCY_FAILED');
  return {
    ok: true,
    orderKey,
    first: 'created',
    second: 'duplicate',
    revenueOrderId: first.revenueOrderId,
    matchedSkus
  };
}

module.exports = {
  TARGET_ORDER_KEY,
  requireMonetaryEvidence,
  runSingleOrderRevenueReprocess
};
