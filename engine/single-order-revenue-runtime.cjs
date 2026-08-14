'use strict';

function rows(response) {
  const parsed = JSON.parse(response?.body || '[]');
  if (!Array.isArray(parsed)) throw new Error('invalid_supabase_response');
  return parsed;
}

function createSingleOrderRevenueRuntime({ request, fetchRevenueEvidence } = {}) {
  if (typeof request !== 'function' || typeof fetchRevenueEvidence !== 'function') {
    throw new Error('single_order_revenue_runtime_dependencies_required');
  }

  async function loadProof(orderKey) {
    const response = await request({
      pathname: `/rest/v1/commerce_order_proofs?select=proof_id,attribution_id,verified,verified_at&schema_version=eq.1&order_key=eq.${encodeURIComponent(orderKey)}&limit=2`,
      operation: 'single_order_revenue_proof_read',
      table: 'commerce_order_proofs'
    });
    const result = rows(response);
    return result.length === 1 ? result[0] : null;
  }

  async function loadEvents(attributionId, beforeIso) {
    const response = await request({
      pathname: `/rest/v1/commerce_events?select=event_id,attribution_id,event_type,sku,canonical_product_id,occurred_at&attribution_id=eq.${encodeURIComponent(attributionId)}&event_type=in.(product_recommended,product_clicked)&occurred_at=lte.${encodeURIComponent(beforeIso)}&order=occurred_at.asc`,
      operation: 'single_order_revenue_event_read',
      table: 'commerce_events'
    });
    return rows(response);
  }

  async function loadOutcome(orderKey) {
    const response = await request({
      pathname: `/rest/v1/commerce_outcomes?select=outcome_id,attribution_id,order_key,matched_skus&schema_version=eq.1&order_key=eq.${encodeURIComponent(orderKey)}&limit=1`,
      operation: 'single_order_revenue_outcome_read',
      table: 'commerce_outcomes'
    });
    return rows(response)[0] || null;
  }

  return { fetchRevenueEvidence, loadEvents, loadOutcome, loadProof };
}

module.exports = { createSingleOrderRevenueRuntime, rows };
