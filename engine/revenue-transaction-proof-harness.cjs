'use strict';

async function runRevenueRollbackProof({ persistence, transactionClient, verificationClient, input } = {}) {
  if (!persistence || typeof persistence.createRevenueSnapshotInTransaction !== 'function' || typeof persistence.getRevenueOrderByOrderKeyInTransaction !== 'function') throw new Error('transaction_scoped_persistence_required');
  if (!transactionClient || typeof transactionClient.query !== 'function') throw new Error('transaction_client_required');
  if (!verificationClient || typeof verificationClient.query !== 'function') throw new Error('verification_client_required');
  let began = false;
  let proof;
  try {
    const before = await persistence.getRevenueOrderByOrderKeyInTransaction({ schemaVersion: input.snapshot.schemaVersion, orderKey: input.snapshot.orderKey }, transactionClient);
    if (before) throw new Error('PREEXISTING_REVENUE_RECORD');
    await transactionClient.query('BEGIN');
    began = true;
    const first = await persistence.createRevenueSnapshotInTransaction(input, transactionClient);
    const firstEvidence = await loadProofEvidence(transactionClient, first.revenueOrderId);
    const second = await persistence.createRevenueSnapshotInTransaction(input, transactionClient);
    const readBack = await persistence.getRevenueOrderByOrderKeyInTransaction({ schemaVersion: input.snapshot.schemaVersion, orderKey: input.snapshot.orderKey }, transactionClient);
    const secondEvidence = await loadProofEvidence(transactionClient, first.revenueOrderId);
    proof = { first, firstEvidence, second, secondEvidence, readBack };
  } finally {
    if (began) await transactionClient.query('ROLLBACK');
  }
  const absentAfterRollback = await provePostRollbackAbsence({ persistence, verificationClient, schemaVersion: input.snapshot.schemaVersion, orderKey: input.snapshot.orderKey });
  return { ...proof, absentAfterRollback };
}

async function loadProofEvidence(client, revenueOrderId) {
  const counts = await client.query(`select
    (select count(*)::int from public.commerce_revenue_orders where revenue_order_id=$1) as order_count,
    (select count(*)::int from public.commerce_revenue_items where revenue_order_id=$1) as item_count,
    (select count(*)::int from public.commerce_order_lifecycle where revenue_order_id=$1) as lifecycle_count,
    (select count(*)::int from public.commerce_order_lifecycle_events where revenue_order_id=$1) as event_count`, [revenueOrderId]);
  const events = await client.query('select current_state,current_status,current_status_id,current_status_type,reason_code,refresh_fingerprint from public.commerce_order_lifecycle_events where revenue_order_id=$1 order by observed_at,transition_id', [revenueOrderId]);
  return { counts: counts.rows?.[0] || null, events: Array.isArray(events.rows) ? events.rows : [] };
}

async function provePostRollbackAbsence({ persistence, verificationClient, schemaVersion = 1, orderKey } = {}) {
  if (!verificationClient || typeof verificationClient.query !== 'function') throw new Error('verification_client_required');
  const rows = await verificationClient.query('select revenue_order_id from public.commerce_revenue_orders where schema_version=$1 and order_key=$2', [schemaVersion, orderKey]);
  return Array.isArray(rows?.rows) && rows.rows.length === 0;
}

module.exports = { runRevenueRollbackProof, loadProofEvidence, provePostRollbackAbsence };
