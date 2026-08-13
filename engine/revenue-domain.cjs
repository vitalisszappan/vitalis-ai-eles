'use strict';

const FINAL_STATUS = Object.freeze({ statusType: 'close_ok', statusId: '283142', status: 'Megrendelés lezárva' });
const PENDING_STATUS = Object.freeze({ statusType: 'open_normal', statusId: '283137', status: 'Feldolgozásra vár' });
const FAILURE_KINDS = new Set(['transport_failure', 'login_failure', 'timeout', 'malformed_xml', 'upstream_failure', 'generic_502']);
const MAX_DECIMAL_DIGITS = 30;
const MAX_DECIMAL_SCALE = 12;

function pow10(scale) { return 10n ** BigInt(scale); }

function normalizeDecimal(coefficient, scale) {
  let value = coefficient;
  let digits = scale;
  while (digits > 0 && value % 10n === 0n) { value /= 10n; digits -= 1; }
  return Object.freeze({ coefficient: value, scale: digits });
}

function parseExactDecimal(input) {
  if (typeof input !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input)) throw new Error('invalid_decimal');
  const negative = input.startsWith('-');
  const unsigned = negative ? input.slice(1) : input;
  const [whole, fraction = ''] = unsigned.split('.');
  if (whole.length + fraction.length > MAX_DECIMAL_DIGITS || fraction.length > MAX_DECIMAL_SCALE) throw new Error('decimal_out_of_range');
  const coefficient = BigInt(`${negative ? '-' : ''}${whole}${fraction}`);
  return normalizeDecimal(coefficient, fraction.length);
}

function decimalToString(decimal) {
  const negative = decimal.coefficient < 0n;
  const absolute = (negative ? -decimal.coefficient : decimal.coefficient).toString().padStart(decimal.scale + 1, '0');
  if (decimal.scale === 0) return `${negative ? '-' : ''}${absolute}`;
  return `${negative ? '-' : ''}${absolute.slice(0, -decimal.scale)}.${absolute.slice(-decimal.scale)}`;
}

function addExact(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return normalizeDecimal(left.coefficient * pow10(scale - left.scale) + right.coefficient * pow10(scale - right.scale), scale);
}

function multiplyExact(left, right) {
  return normalizeDecimal(left.coefficient * right.coefficient, left.scale + right.scale);
}

function nonNegativeDecimal(value, errorCode) {
  let parsed;
  try { parsed = parseExactDecimal(value); } catch { throw new Error(errorCode); }
  if (parsed.coefficient < 0n) throw new Error(errorCode);
  return parsed;
}

function positiveDecimal(value) {
  const parsed = nonNegativeDecimal(value, 'invalid_quantity');
  if (parsed.coefficient <= 0n) throw new Error('invalid_quantity');
  return parsed;
}

function classifyOrderItem(item) {
  const id = typeof item?.id === 'string' ? item.id.trim() : '';
  const sku = typeof item?.sku === 'string' ? item.sku.trim() : '';
  if (id === 'shipping-cost') return { lineType: 'shipping', needsReview: false };
  if (id === 'handel-cost') return { lineType: 'payment_fee', needsReview: false };
  if (item?.isTechnical === true) return { lineType: 'other', needsReview: true };
  if (!sku || id === sku) return { lineType: 'other', needsReview: true };
  return { lineType: 'product', needsReview: false };
}

function evidenceSkuSet(events) {
  return new Set((events || []).map((event) => typeof event?.sku === 'string' ? event.sku.trim() : '').filter(Boolean));
}

function recommendedEvidence(evidence) { return evidence.recommended || evidence.recommendationEvidence || []; }
function clickedEvidence(evidence) { return evidence.clicked || evidence.clickEvidence || []; }

function uniqueEvidenceValues(events, sku, field) {
  const exactSku = typeof sku === 'string' ? sku.trim() : '';
  const values = [];
  const seen = new Set();
  for (const event of events || []) {
    if ((typeof event?.sku === 'string' ? event.sku.trim() : '') !== exactSku) continue;
    const value = typeof event?.[field] === 'string' ? event[field].trim() : '';
    if (value && !seen.has(value)) { seen.add(value); values.push(value); }
  }
  return values;
}

function matchSkuAttribution(sku, evidence = {}) {
  const matches = matchSkuEvidence(sku, evidence);
  const recommended = recommendedEvidence(evidence);
  const clicked = clickedEvidence(evidence);
  return {
    ...matches,
    canonicalProductIds: [...new Set([
      ...uniqueEvidenceValues(recommended, sku, 'canonicalProductId'),
      ...uniqueEvidenceValues(clicked, sku, 'canonicalProductId')
    ])],
    recommendationEventIds: uniqueEvidenceValues(recommended, sku, 'eventId'),
    clickEventIds: uniqueEvidenceValues(clicked, sku, 'eventId')
  };
}

function matchSkuEvidence(sku, evidence = {}) {
  const exactSku = typeof sku === 'string' ? sku.trim() : '';
  const recommended = evidenceSkuSet(recommendedEvidence(evidence));
  const clicked = evidenceSkuSet(clickedEvidence(evidence));
  return { recommendedMatch: exactSku !== '' && recommended.has(exactSku), clickedMatch: exactSku !== '' && clicked.has(exactSku) };
}

function exactStatusTuple(value, expected) {
  return value?.statusType === expected.statusType && String(value?.statusId ?? '') === expected.statusId && value?.status === expected.status;
}

function mapLifecycle(currentState = 'verified_pending', observation = {}) {
  if (FAILURE_KINDS.has(observation.kind)) {
    return { state: currentState, changed: false, refreshFailed: true, reason: observation.kind };
  }
  if (observation.kind === 'authoritative_not_found' && observation.authoritative === true) {
    return { state: 'unverifiable', changed: currentState !== 'unverifiable', refreshFailed: false, reason: 'authoritative_not_found' };
  }
  if (observation.kind !== 'status') return { state: currentState, changed: false, refreshFailed: false, reason: 'no_status_evidence' };
  if (exactStatusTuple(observation, FINAL_STATUS)) return { state: 'finalized', changed: currentState !== 'finalized', refreshFailed: false, reason: 'proven_close_ok' };
  if (exactStatusTuple(observation, PENDING_STATUS)) return { state: 'verified_pending', changed: currentState !== 'verified_pending', refreshFailed: false, reason: 'proven_open_normal' };
  return { state: 'unknown', changed: currentState !== 'unknown', refreshFailed: false, reason: 'unmapped_status' };
}

function buildRevenueSnapshot({ order, evidence = {}, currentLifecycleState = 'verified_pending', lifecycleObservation } = {}) {
  if (!order || typeof order !== 'object' || !Array.isArray(order.items)) throw new Error('invalid_order');
  if (typeof order.currency !== 'string' || !/^[A-Z]{3}$/.test(order.currency)) throw new Error('invalid_currency');
  const zero = parseExactDecimal('0');
  const totals = { product: zero, shipping: zero, payment_fee: zero, other: zero };
  let needsReview = false;
  const items = order.items.map((item, lineOrdinal) => {
    const classification = classifyOrderItem(item);
    const matches = classification.lineType === 'product' ? matchSkuAttribution(item.sku, evidence) : { recommendedMatch: false, clickedMatch: false, canonicalProductIds: [], recommendationEventIds: [], clickEventIds: [] };
    let quantity = null, unitGross = null, lineGross = null, moneyValid = true;
    try {
      quantity = positiveDecimal(item.quantity);
      unitGross = nonNegativeDecimal(item.priceGross, 'invalid_price_gross');
      lineGross = multiplyExact(quantity, unitGross);
      totals[classification.lineType] = addExact(totals[classification.lineType], lineGross);
    } catch {
      moneyValid = false;
      needsReview = true;
    }
    if (classification.needsReview) needsReview = true;
    return {
      lineOrdinal, itemId: String(item?.id || ''), sku: typeof item?.sku === 'string' && item.sku.trim() ? item.sku.trim() : null,
      lineType: classification.lineType, quantity: quantity ? decimalToString(quantity) : null,
      unitGross: unitGross ? decimalToString(unitGross) : null, lineGross: lineGross ? decimalToString(lineGross) : null,
      recommendedMatch: matches.recommendedMatch, clickedMatch: matches.clickedMatch,
      canonicalProductIds: matches.canonicalProductIds, recommendationEventIds: matches.recommendationEventIds, clickEventIds: matches.clickEventIds,
      moneyValid, needsReview: classification.needsReview || !moneyValid
    };
  });
  const assistedItems = items.filter((item) => item.lineType === 'product' && item.moneyValid && (item.recommendedMatch || item.clickedMatch));
  const assisted = assistedItems.reduce((total, item) => addExact(total, parseExactDecimal(item.lineGross)), zero);
  const full = Object.values(totals).reduce(addExact, zero);
  const lifecycle = mapLifecycle(currentLifecycleState, lifecycleObservation || { kind: 'none' });
  const finalizedRevenue = lifecycle.state === 'finalized' && !needsReview ? assisted : zero;
  return {
    schemaVersion: 1, orderKey: String(order.orderKey || ''), orderId: String(order.orderId || ''), currency: order.currency,
    lifecycle, items, needsReview, aiAssistedOrder: assistedItems.length > 0,
    hasRecommendedMatch: assistedItems.some((item) => item.recommendedMatch), hasClickedMatch: assistedItems.some((item) => item.clickedMatch),
    aiAssistedProductRevenue: decimalToString(assisted), productOrderValue: decimalToString(totals.product),
    shippingValue: decimalToString(totals.shipping), paymentFeeValue: decimalToString(totals.payment_fee),
    otherValue: decimalToString(totals.other), fullOrderValue: decimalToString(full), finalAiAssistedRevenue: decimalToString(finalizedRevenue)
  };
}

module.exports = { FINAL_STATUS, PENDING_STATUS, MAX_DECIMAL_DIGITS, MAX_DECIMAL_SCALE, parseExactDecimal, decimalToString, addExact, multiplyExact, classifyOrderItem, matchSkuEvidence, matchSkuAttribution, mapLifecycle, buildRevenueSnapshot };
