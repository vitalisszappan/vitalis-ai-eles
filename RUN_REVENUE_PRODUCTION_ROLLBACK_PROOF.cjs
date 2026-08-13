'use strict';

const { Client } = require('pg');
const { buildRevenueSnapshot } = require('./engine/revenue-domain.cjs');
const { createRefreshFingerprint } = require('./engine/revenue-refresh-fingerprint.cjs');
const { createRevenuePersistenceAdapter } = require('./engine/revenue-persistence.cjs');
const { runRevenueRollbackProof } = require('./engine/revenue-transaction-proof-harness.cjs');
const { buildVerifiedClientConfig, CONNECTION_ENV, CERT_ENV } = require('./engine/revenue-production-db-preflight.cjs');

const ORDER_KEY = '99212-298722';
const observation = { kind:'status', status:'Feldolgozásra vár', statusId:'283137', statusType:'open_normal' };
const order = { orderKey:ORDER_KEY, orderId:'365905971', currency:'HUF', items:[
  { id:'1462570616', sku:'VDVSZ', quantity:'1', priceGross:'2700' },
  { id:'shipping-cost', sku:'shipping-cost', quantity:'1', priceGross:'1850' },
  { id:'handel-cost', sku:'handel-cost', quantity:'1', priceGross:'400' }
] };
const evidence = {
  recommendationEvidence:[{ eventId:'16ff6e76-5bb9-4850-be91-06baa15df6fc', sku:'VDVSZ', canonicalProductId:'dermavital_szappan' }],
  clickEvidence:[
    { eventId:'7dab4907-bc54-4e49-bcc8-c636b239d2af', sku:'VDVSZ', canonicalProductId:'dermavital_szappan' },
    { eventId:'3b98d904-7733-4095-a508-582343e804d1', sku:'VDVSZ', canonicalProductId:'dermavital_szappan' },
    { eventId:'360e4eba-8efa-406a-a961-637591837c26', sku:'VDVSZ', canonicalProductId:'dermavital_szappan' }
  ]
};

function buildInput() {
  const snapshot = buildRevenueSnapshot({ order, evidence, lifecycleObservation:observation });
  const refreshFingerprint = createRefreshFingerprint({ schemaVersion:snapshot.schemaVersion, orderKey:snapshot.orderKey, orderId:snapshot.orderId, status:observation.status, statusId:observation.statusId, statusType:observation.statusType, currency:snapshot.currency });
  return { snapshot, attributionId:'ad6b5200-fb23-43c1-8065-a0508a4540bc', proofId:'8a5a7c8f-acbb-48ed-98e9-750f7304e598', outcomeId:null, orderedAt:'2026-08-12T16:06:25+02:00', evidenceCapturedAt:'2026-08-12T16:10:00+02:00', initialObservation:observation, refreshFingerprint };
}

function canonicalNumeric(value) {
  const text=String(value??'');
  if(!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text))return null;
  return text.includes('.')?text.replace(/0+$/,'').replace(/\.$/,''):text;
}

function validateProof(proof, input) {
  const stored=proof.readBack, o=stored?.order, items=stored?.items||[], life=stored?.lifecycle;
  const product=items.find(x=>x.item_id==='1462570616'), shipping=items.find(x=>x.item_id==='shipping-cost'), payment=items.find(x=>x.item_id==='handel-cost');
  const orderOk=o?.order_key===ORDER_KEY&&String(o?.order_id)==='365905971'&&o?.attribution_id===input.attributionId&&o?.proof_id===input.proofId&&o?.currency==='HUF'&&o?.has_recommended_match===true&&o?.has_clicked_match===true&&o?.ai_assisted_order===true&&canonicalNumeric(o?.ai_assisted_product_value)==='2700'&&canonicalNumeric(o?.product_order_value)==='2700'&&canonicalNumeric(o?.shipping_value)==='1850'&&canonicalNumeric(o?.payment_fee_value)==='400'&&canonicalNumeric(o?.other_value)==='0'&&canonicalNumeric(o?.full_order_value)==='4950';
  const productOk=product?.sku==='VDVSZ'&&canonicalNumeric(product.quantity)==='1'&&canonicalNumeric(product.unit_gross)==='2700'&&canonicalNumeric(product.line_gross)==='2700'&&product.recommended_match===true&&product.clicked_match===true&&product.canonical_product_ids?.includes('dermavital_szappan')&&product.recommendation_event_ids?.includes('16ff6e76-5bb9-4850-be91-06baa15df6fc')&&input.snapshot.items[0].clickEventIds.every(id=>product.click_event_ids?.includes(id));
  const feesOk=shipping?.line_type==='shipping'&&canonicalNumeric(shipping.quantity)==='1'&&canonicalNumeric(shipping.unit_gross)==='1850'&&canonicalNumeric(shipping.line_gross)==='1850'&&!shipping.recommended_match&&!shipping.clicked_match&&payment?.line_type==='payment_fee'&&canonicalNumeric(payment.quantity)==='1'&&canonicalNumeric(payment.unit_gross)==='400'&&canonicalNumeric(payment.line_gross)==='400'&&!payment.recommended_match&&!payment.clicked_match;
  const lifecycleOk=life?.lifecycle_state==='verified_pending'&&life?.current_status===observation.status&&String(life?.current_status_id)==='283137'&&life?.current_status_type==='open_normal'&&life?.last_refresh_result==='success'&&Number(life?.state_version)===1&&life?.finalized_at==null;
  const event=proof.firstEvidence?.events?.[0];
  const eventOk=proof.firstEvidence.events.length===1&&event.current_state==='verified_pending'&&event.reason_code==='proven_open_normal'&&event.current_status===observation.status&&String(event.current_status_id)==='283137'&&event.current_status_type==='open_normal'&&/^[0-9a-f]{64}$/.test(event.refresh_fingerprint);
  const firstCounts=proof.firstEvidence?.counts||{}, secondCounts=proof.secondEvidence?.counts||{};
  const countsOk=Number(firstCounts.order_count)===1&&Number(firstCounts.item_count)===3&&Number(firstCounts.lifecycle_count)===1&&Number(firstCounts.event_count)===1&&Number(secondCounts.order_count)===1&&Number(secondCounts.item_count)===3&&Number(secondCounts.lifecycle_count)===1&&Number(secondCounts.event_count)===1;
  return { orderOk, itemsOk:items.length===3&&productOk&&feesOk, lifecycleOk, eventOk, countsOk, firstOk:proof.first?.duplicate===false, secondOk:proof.second?.duplicate===true };
}

(async()=>{
  let txClient, verificationClient;
  const state={preexisting:false,boundary:false,first:false,second:false,items:false,lifecycle:false,idempotency:false,rollback:false,absence:false,rootCause:null};
  try {
    const config=buildVerifiedClientConfig(process.env[CONNECTION_ENV],process.env[CERT_ENV]);
    txClient=new Client(config); await txClient.connect();
    verificationClient=new Client(config);
    let verificationConnected=false;
    const verificationProxy={query:async(sql,params)=>{if(!verificationConnected){await verificationClient.connect();verificationConnected=true;}return verificationClient.query(sql,params);}};
    const db={query:(...args)=>txClient.query(...args),transaction:async()=>{throw new Error('TRANSACTION_BOUNDARY_NOT_PROVEN');}};
    const persistence=createRevenuePersistenceAdapter({db});
    const input=buildInput();
    let rollbackObserved=false;
    const guardedTx={query:async(sql,params)=>{const result=await txClient.query(sql,params);if(sql==='ROLLBACK')rollbackObserved=true;return result;}};
    const proof=await runRevenueRollbackProof({persistence,transactionClient:guardedTx,verificationClient:verificationProxy,input});
    const valid=validateProof(proof,input);
    state.boundary=true;state.first=valid.firstOk;state.second=valid.secondOk;state.items=valid.itemsOk&&valid.countsOk;state.lifecycle=valid.lifecycleOk&&valid.eventOk;state.idempotency=valid.secondOk&&valid.countsOk;state.rollback=rollbackObserved;state.absence=proof.absentAfterRollback===true;
    if(!valid.orderOk||!state.first||!state.second||!state.items||!state.lifecycle||!state.idempotency||!state.rollback||!state.absence)state.rootCause='EVIDENCE_CONTRACT_MISMATCH';
  } catch(error) {
    state.preexisting=error?.message==='PREEXISTING_REVENUE_RECORD';
    state.rootCause=state.preexisting?'PREEXISTING_REVENUE_RECORD':'SANITIZED_PROOF_FAILURE';
  } finally {
    if(txClient)await txClient.end().catch(()=>{});
    if(verificationClient)await verificationClient.end().catch(()=>{});
  }
  const pass=!state.rootCause;
  console.log(JSON.stringify({pass,...state}));
  if(!pass)process.exitCode=1;
})().catch(()=>{console.log(JSON.stringify({pass:false,rootCause:'SANITIZED_PROOF_FAILURE'}));process.exitCode=1;});

module.exports={canonicalNumeric,validateProof};
