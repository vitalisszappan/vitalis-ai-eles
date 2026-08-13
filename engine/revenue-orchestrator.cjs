'use strict';

const { buildRevenueSnapshot } = require('./revenue-domain.cjs');
const { createRefreshFingerprint } = require('./revenue-refresh-fingerprint.cjs');

function forbiddenEvidence(value){const text=JSON.stringify(value||{}).toLowerCase();return /customer|email|phone|address|comment|rawxml|raw_xml|<order/.test(text);}

function createRevenueOrchestrator({persistence,fetchOrderEvidence}={}){
  if(!persistence||typeof persistence.createRevenueSnapshot!=='function')throw new Error('revenue_persistence_required');
  if(typeof fetchOrderEvidence!=='function')throw new Error('read_only_order_evidence_fetcher_required');
  async function buildAndPersistRevenueSnapshot(input={}){
    const evidence=await fetchOrderEvidence({orderKey:input.orderKey});
    if(!evidence||evidence.readOnly!==true)throw new Error('read_only_evidence_required');
    if(forbiddenEvidence(evidence))throw new Error('forbidden_sensitive_evidence');
    if(evidence.failureKind)throw new Error('valid_monetary_evidence_required');
    const snapshot=buildRevenueSnapshot({order:evidence.order,evidence:evidence.attributionEvidence||{},lifecycleObservation:evidence.lifecycleObservation});
    const refreshFingerprint=input.refreshFingerprint||createRefreshFingerprint({schemaVersion:snapshot.schemaVersion,orderKey:snapshot.orderKey,orderId:snapshot.orderId,status:evidence.lifecycleObservation.status,statusId:evidence.lifecycleObservation.statusId,statusType:evidence.lifecycleObservation.statusType,currency:snapshot.currency});
    return persistence.createRevenueSnapshot({snapshot,attributionId:input.attributionId,proofId:input.proofId,outcomeId:input.outcomeId,orderedAt:evidence.orderedAt,evidenceCapturedAt:evidence.capturedAt,initialObservation:evidence.lifecycleObservation,refreshFingerprint});
  }
  async function prepareSingleRecordPersistenceProof(input={}){
    const persisted=await buildAndPersistRevenueSnapshot(input);
    const stored=await persistence.getRevenueOrderById({revenueOrderId:persisted.revenueOrderId});
    return {duplicate:persisted.duplicate,revenueOrderId:persisted.revenueOrderId,stored};
  }
  return {buildAndPersistRevenueSnapshot,prepareSingleRecordPersistenceProof};
}

module.exports={createRevenueOrchestrator};
