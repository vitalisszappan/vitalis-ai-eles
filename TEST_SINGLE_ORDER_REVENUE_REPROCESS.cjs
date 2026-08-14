'use strict';

const assert = require('node:assert/strict');
const {
  parseRevenueOrderResponse,
  fetchUnasRevenueEvidence
} = require('./engine/unas-revenue-evidence.cjs');
const {
  TARGET_ORDER_KEY,
  runSingleOrderRevenueReprocess
} = require('./engine/single-order-revenue-reprocess.cjs');
const { createRevenuePhase4Service } = require('./engine/revenue-phase4.cjs');

const attributionId = '10000000-0000-4000-8000-000000000001';
const proof = { proof_id: '20000000-0000-4000-8000-000000000002', attribution_id: attributionId, verified: true, verified_at: new Date().toISOString() };
const events = [
  { event_id: '30000000-0000-4000-8000-000000000003', attribution_id: attributionId, event_type: 'product_recommended', sku: 'SKU-1', canonical_product_id: 'product-1', occurred_at: new Date(Date.now() - 2000).toISOString() },
  { event_id: '40000000-0000-4000-8000-000000000004', attribution_id: attributionId, event_type: 'product_clicked', sku: 'SKU-1', canonical_product_id: 'product-1', occurred_at: new Date(Date.now() - 1000).toISOString() }
];
const order = {
  key: TARGET_ORDER_KEY, id: '123', date: '2026.08.14 12:00:00', currency: 'HUF',
  status: 'Feldolgozásra vár', statusId: '283137', statusType: 'open_normal',
  items: [{ id: 'item-1', sku: 'SKU-1', quantity: '1', priceGross: '1000' }]
};

function fixture(overrides = {}) {
  let calls = 0;
  const revenueOrderId = '50000000-0000-4000-8000-000000000005';
  return {
    orderKey: TARGET_ORDER_KEY,
    loadProof: async () => proof,
    loadEvents: async () => events,
    loadOutcome: async () => null,
    fetchRevenueEvidence: async () => ({ ok: true, readOnly: true, order }),
    phase4: { persistVerified: async () => (++calls === 1
      ? { duplicate: false, code: 'created', revenueOrderId }
      : { duplicate: true, code: 'duplicate', revenueOrderId }) },
    ...overrides
  };
}

(async () => {
  const result = await runSingleOrderRevenueReprocess(fixture());
  assert.equal(result.first, 'created');
  assert.equal(result.second, 'duplicate');
  assert.deepEqual(result.matchedSkus, ['SKU-1']);

  await assert.rejects(() => runSingleOrderRevenueReprocess(fixture({ orderKey: '99212-OTHER' })), /EXACT_ORDER_KEY_REQUIRED/);
  await assert.rejects(() => runSingleOrderRevenueReprocess(fixture({ loadProof: async () => null })), /VERIFIED_PROOF_REQUIRED/);
  await assert.rejects(() => runSingleOrderRevenueReprocess(fixture({ loadProof: async () => ({ ...proof, verified: false }) })), /VERIFIED_PROOF_REQUIRED/);
  await assert.rejects(() => runSingleOrderRevenueReprocess(fixture({ loadEvents: async () => [] })), /ATTRIBUTION_EVIDENCE_REQUIRED/);
  await assert.rejects(() => runSingleOrderRevenueReprocess(fixture({ loadEvents: async () => events.filter((event) => event.event_type !== 'product_recommended') })), /ATTRIBUTION_EVIDENCE_REQUIRED/);
  await assert.rejects(() => runSingleOrderRevenueReprocess(fixture({ loadEvents: async () => events.filter((event) => event.event_type !== 'product_clicked') })), /ATTRIBUTION_EVIDENCE_REQUIRED/);
  await assert.rejects(() => runSingleOrderRevenueReprocess(fixture({ loadEvents: async () => [{ ...events[0], attribution_id: '70000000-0000-4000-8000-000000000007' }, events[1]] })), /ATTRIBUTION_EVIDENCE_INVALID/);
  await assert.rejects(() => runSingleOrderRevenueReprocess(fixture({ loadEvents: async () => [{ ...events[0], occurred_at: new Date(Date.now() + 60000).toISOString() }, events[1]] })), /ATTRIBUTION_EVIDENCE_INVALID/);
  await assert.rejects(() => runSingleOrderRevenueReprocess(fixture({ fetchRevenueEvidence: async () => ({ ok: false, reason: 'order_not_found' }) })), /UNAS_ORDER_NOT_FOUND/);
  await assert.rejects(() => runSingleOrderRevenueReprocess(fixture({ fetchRevenueEvidence: async () => ({ ok: false, reason: 'multiple_orders' }) })), /UNAS_MULTIPLE_ORDERS/);
  await assert.rejects(() => runSingleOrderRevenueReprocess(fixture({ fetchRevenueEvidence: async () => ({ ok: true, order: { ...order, currency: null } }) })), /MONETARY_EVIDENCE_REQUIRED/);
  await assert.rejects(() => runSingleOrderRevenueReprocess(fixture({ fetchRevenueEvidence: async () => ({ ok: true, order: { ...order, items: [{ ...order.items[0], sku: 'OTHER' }] } }) })), /SKU_MISMATCH/);
  await assert.rejects(() => runSingleOrderRevenueReprocess(fixture({ loadOutcome: async () => ({ outcome_id: '80000000-0000-4000-8000-000000000008', order_key: TARGET_ORDER_KEY, attribution_id: '70000000-0000-4000-8000-000000000007', matched_skus: ['SKU-1'] }) })), /OUTCOME_EVIDENCE_MISMATCH/);
  await assert.rejects(() => runSingleOrderRevenueReprocess(fixture({ phase4: { persistVerified: async () => { throw Object.assign(new Error('rpc'), { code: 'revenue_rpc_request_failed' }); } } })), /rpc/);
  await assert.rejects(() => runSingleOrderRevenueReprocess(fixture({ phase4: { persistVerified: async () => ({ duplicate: false, code: 'created', revenueOrderId: 'x' }) } })), /IDEMPOTENCY_FAILED/);

  const xml = '<Orders><Order><Key>99212-459544</Key><Id>123</Id><Date>2026.08.14 12:00:00</Date><Currency>HUF</Currency><Status>Feldolgozásra vár</Status><StatusID>283137</StatusID><StatusType>open_normal</StatusType><Items><Item><Id>item-1</Id><Sku>SKU-1</Sku><Quantity>1</Quantity><PriceGross>1000</PriceGross></Item></Items><Customer><Email>secret@example.com</Email><Phone>secret</Phone><Address>secret</Address><Comment>secret</Comment></Customer></Order></Orders>';
  const parsed = parseRevenueOrderResponse(xml);
  assert.deepEqual(parsed, [order]);
  assert.equal(/secret|customer|email|phone|address|comment/i.test(JSON.stringify(parsed)), false);
  assert.equal((await fetchUnasRevenueEvidence(TARGET_ORDER_KEY, { loginFn: async () => ({ token: 't' }), requestFn: async () => ({ body: xml }) })).ok, true);
  assert.equal((await fetchUnasRevenueEvidence(TARGET_ORDER_KEY, { loginFn: async () => ({ token: 't' }), requestFn: async () => ({ body: '<Orders />' }) })).reason, 'order_not_found');
  assert.equal((await fetchUnasRevenueEvidence(TARGET_ORDER_KEY, { loginFn: async () => ({ token: 't' }), requestFn: async () => ({ body: '<Orders><Order/><Order/></Orders>' }) })).reason, 'multiple_orders');
  await assert.rejects(() => fetchUnasRevenueEvidence(TARGET_ORDER_KEY, { loginFn: async () => ({ token: 't' }), requestFn: async () => { throw new Error('HTTP body secret@example.com'); } }), (error) => error.code === 'UNAS_REVENUE_FETCH_FAILED' && !/secret|email/i.test(error.message));

  const rpcPayloads = [];
  const rpcId = '60000000-0000-4000-8000-000000000006';
  const realPhase4 = createRevenuePhase4Service({ request: async (call) => {
    rpcPayloads.push(call.body.p_payload);
    return { body: JSON.stringify({ ok: true, duplicate: rpcPayloads.length > 1, code: rpcPayloads.length > 1 ? 'duplicate' : 'created', revenueOrderId: rpcId, lifecycleState: 'verified_pending' }) };
  } });
  const realResult = await runSingleOrderRevenueReprocess(fixture({ phase4: realPhase4 }));
  assert.equal(realResult.second, 'duplicate');
  assert.equal(rpcPayloads.length, 2);
  assert.equal(rpcPayloads[0].evidenceCapturedAt, rpcPayloads[1].evidenceCapturedAt);
  assert.deepEqual(rpcPayloads[0], rpcPayloads[1]);
  await assert.rejects(() => realPhase4.persistVerified({
    proof: { orderKey: TARGET_ORDER_KEY, attributionId },
    proofRow: proof,
    order,
    priorEvents: events,
    outcome: { outcomeId: null, matchedSkus: ['SKU-1'] },
    evidenceCapturedAt: '2020-01-01T00:00:00.000Z'
  }), /invalid_evidence_captured_at/);

  console.log('Single-order revenue reprocess regresszio: PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });
