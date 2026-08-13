'use strict';

const assert = require('node:assert/strict');
const { buildRevenueSnapshot } = require('./engine/revenue-domain.cjs');
const { canonicalRefreshIdentity, createRefreshFingerprint } = require('./engine/revenue-refresh-fingerprint.cjs');
const { payloadFromCreate } = require('./engine/revenue-rpc-persistence.cjs');
const { createRevenueOrchestrator } = require('./engine/revenue-orchestrator.cjs');
const { runRevenueRollbackProof } = require('./engine/revenue-transaction-proof-harness.cjs');

const lifecycleObservation = { kind:'status', status:'Feldolgozásra vár', statusId:'283137', statusType:'open_normal' };
const attributionEvidence = {
  recommendationEvidence:[{ eventId:'16ff6e76-5bb9-4850-be91-06baa15df6fc', sku:'VDVSZ', canonicalProductId:'dermavital_szappan' }],
  clickEvidence:[
    { eventId:'7dab4907-bc54-4e49-bcc8-c636b239d2af', sku:'VDVSZ', canonicalProductId:'dermavital_szappan' },
    { eventId:'3b98d904-7733-4095-a508-582343e804d1', sku:'VDVSZ', canonicalProductId:'dermavital_szappan' },
    { eventId:'360e4eba-8efa-406a-a961-637591837c26', sku:'VDVSZ', canonicalProductId:'dermavital_szappan' }
  ]
};
const order = { orderKey:'99212-298722', orderId:'365905971', currency:'HUF', items:[
  { id:'1462570616', sku:'VDVSZ', quantity:'1', priceGross:'2700' },
  { id:'shipping-cost', sku:'shipping-cost', quantity:'1', priceGross:'1850' },
  { id:'handel-cost', sku:'handel-cost', quantity:'1', priceGross:'400' }
] };
const snapshot = buildRevenueSnapshot({ order, evidence:attributionEvidence, lifecycleObservation });
const product = snapshot.items[0];
assert.deepEqual(product.canonicalProductIds,['dermavital_szappan']);
assert.deepEqual(product.recommendationEventIds,['16ff6e76-5bb9-4850-be91-06baa15df6fc']);
assert.deepEqual(product.clickEventIds,['7dab4907-bc54-4e49-bcc8-c636b239d2af','3b98d904-7733-4095-a508-582343e804d1','360e4eba-8efa-406a-a961-637591837c26']);
assert.equal(product.lineGross,'2700');
assert.equal(snapshot.aiAssistedProductRevenue,'2700');
assert.deepEqual([snapshot.productOrderValue,snapshot.shippingValue,snapshot.paymentFeeValue,snapshot.otherValue,snapshot.fullOrderValue],['2700','1850','400','0','4950']);

const identity = { schemaVersion:1, orderKey:order.orderKey, orderId:order.orderId, ...lifecycleObservation, currency:'HUF' };
const fingerprint = createRefreshFingerprint(identity);
assert.match(fingerprint,/^[0-9a-f]{64}$/);
assert.equal(fingerprint,createRefreshFingerprint({ currency:'HUF', statusType:'open_normal', statusId:'283137', status:'Feldolgozásra vár', orderId:'365905971', orderKey:'99212-298722', schemaVersion:1 }));
assert.equal(fingerprint,createRefreshFingerprint({ ...identity, evidenceCapturedAt:'2099-01-01', customer:{email:'ignored@example.test'},token:'ignored' }));
for (const changed of [{status:'Más'},{statusId:'9'},{statusType:'close_ok'}]) assert.notEqual(fingerprint,createRefreshFingerprint({ ...identity, ...changed }));
assert.equal(canonicalRefreshIdentity(identity).includes('customer'),false);

const createInput = { snapshot, attributionId:'ad6b5200-fb23-43c1-8065-a0508a4540bc', proofId:'8a5a7c8f-acbb-48ed-98e9-750f7304e598', outcomeId:null, orderedAt:'2026-08-12T16:06:25+02:00', evidenceCapturedAt:'2026-08-12T16:10:00+02:00', initialObservation:lifecycleObservation, refreshFingerprint:fingerprint };
const payload = payloadFromCreate(createInput);
assert.equal(payload.lifecycle.finalizedAt,null);
assert.deepEqual(payload.items[0].canonicalProductIds,product.canonicalProductIds);
assert.deepEqual(payload.items[0].recommendationEventIds,product.recommendationEventIds);
assert.deepEqual(payload.items[0].clickEventIds,product.clickEventIds);
assert.deepEqual(Object.keys(payload).sort(),['schemaVersion','orderKey','orderId','attributionId','proofId','outcomeId','orderedAt','currency','hasRecommendedMatch','hasClickedMatch','aiAssistedOrder','aiAssistedProductValue','productOrderValue','shippingValue','paymentFeeValue','otherValue','fullOrderValue','evidenceCapturedAt','refreshFingerprint','lifecycle','items'].sort());
assert.deepEqual(Object.keys(payload.items[0]).sort(),['lineOrdinal','itemId','sku','lineType','quantity','unitGross','lineGross','recommendedMatch','clickedMatch','canonicalProductIds','recommendationEventIds','clickEventIds'].sort());

let capturedInput;
const orchestrator=createRevenueOrchestrator({persistence:{createRevenueSnapshot:async value=>(capturedInput=value,{duplicate:false})},fetchOrderEvidence:async()=>({readOnly:true,order,attributionEvidence,lifecycleObservation,orderedAt:createInput.orderedAt,capturedAt:createInput.evidenceCapturedAt})});
(async()=>{
 await orchestrator.buildAndPersistRevenueSnapshot({orderKey:order.orderKey,attributionId:createInput.attributionId,proofId:createInput.proofId});
 assert.equal(capturedInput.refreshFingerprint,fingerprint);
 assert.deepEqual(capturedInput.snapshot.items[0].clickEventIds,product.clickEventIds);

 const commands=[];
 const transactionClient={query:async sql=>(commands.push(sql),{rows:[]})};
 const verificationClient={query:async()=>({rows:[]})};
 let stored=null;
 const persistence={
  getRevenueOrderByOrderKeyInTransaction:async()=>stored,
  createRevenueSnapshotInTransaction:async()=>stored?( {duplicate:true,revenueOrderId:'local-id',snapshot:stored} ):(stored={order:{order_key:order.orderKey},items:snapshot.items},{duplicate:false,revenueOrderId:'local-id',snapshot:stored})
 };
 const proof=await runRevenueRollbackProof({persistence,transactionClient,verificationClient,input:createInput});
 assert.equal(proof.first.duplicate,false);assert.equal(proof.second.duplicate,true);assert.equal(proof.absentAfterRollback,true);
 assert.equal(commands[0],'BEGIN');assert.equal(commands.at(-1),'ROLLBACK');
 assert.equal(commands.slice(1,-1).length,4);assert.equal(commands.slice(1,-1).every(sql=>/^select\b/i.test(sql)),true);
 console.log(`Revenue Phase 3 contract: PASS ${fingerprint}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
