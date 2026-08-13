'use strict';

const {createRevenueOrchestrator}=require('./revenue-orchestrator.cjs');
const {createSupabaseRevenueRpcAdapter}=require('./revenue-rpc-persistence.cjs');

function unasDateToIso(value){
 const match=String(value||'').match(/^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);if(!match)throw Object.assign(new Error('invalid_authoritative_ordered_at'),{code:'invalid_authoritative_ordered_at'});
 const parts=match.slice(1).map(Number),guess=Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]);
 const formatted=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
 const represented=Date.UTC(formatted.year,formatted.month-1,formatted.day,formatted.hour,formatted.minute,formatted.second),utc=guess-(represented-guess);return new Date(utc).toISOString();
}

function createRevenuePhase4Service({request}={}){
 const persistence=createSupabaseRevenueRpcAdapter({request});
 async function persistVerified({proof,proofRow,order,priorEvents,outcome}={}){
  if(!proofRow?.proof_id||proofRow.verified!==true)throw Object.assign(new Error('verified_proof_required'),{code:'verified_proof_required'});
  if(!proof?.attributionId||order?.key!==proof.orderKey)throw Object.assign(new Error('exact_order_match_required'),{code:'exact_order_match_required'});
  const matched=new Set(outcome?.matchedSkus||[]),recommendations=priorEvents.filter(e=>e.event_type==='product_recommended'&&matched.has(String(e.sku||''))),clicks=priorEvents.filter(e=>e.event_type==='product_clicked'&&matched.has(String(e.sku||'')));
  if(!recommendations.length||!clicks.length)throw Object.assign(new Error('exact_attribution_match_required'),{code:'exact_attribution_match_required'});
  if(!order.currency||!order.date||!order.status||!order.statusId||!order.statusType||!Array.isArray(order.items)||order.items.some(i=>!i.id||!i.quantity||!i.priceGross))throw Object.assign(new Error('authoritative_monetary_evidence_required'),{code:'authoritative_monetary_evidence_required'});
  const attributionEvidence={recommendationEvidence:recommendations.map(e=>({eventId:e.event_id,sku:e.sku,canonicalProductId:e.canonical_product_id})),clickEvidence:clicks.map(e=>({eventId:e.event_id,sku:e.sku,canonicalProductId:e.canonical_product_id}))};
  const lifecycleObservation={kind:'status',status:order.status,statusId:order.statusId,statusType:order.statusType};
  const orchestrator=createRevenueOrchestrator({persistence,fetchOrderEvidence:async()=>({readOnly:true,order:{orderKey:order.key,orderId:order.id,currency:order.currency,items:order.items},attributionEvidence,lifecycleObservation,orderedAt:unasDateToIso(order.date),capturedAt:new Date().toISOString()})});
  return orchestrator.buildAndPersistRevenueSnapshot({orderKey:proof.orderKey,attributionId:proof.attributionId,proofId:proofRow.proof_id,outcomeId:outcome?.outcomeId||null});
 }
 return {persistence,persistVerified};
}

module.exports={unasDateToIso,createRevenuePhase4Service};
