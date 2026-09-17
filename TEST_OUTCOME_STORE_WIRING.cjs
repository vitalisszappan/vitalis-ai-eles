'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');const {processOrderProof}=require('./engine/order-proof.cjs');
const {reprocessVerifiedOrder,ORDER_KEY,ATTRIBUTION_ID}=require('./engine/verified-order-reprocess.cjs');
const attributionId=crypto.randomUUID(),proof={schemaVersion:1,attributionId,orderKey:'99212-298722',timestamp:new Date().toISOString()};
const events=[{event_id:crypto.randomUUID(),attribution_id:attributionId,event_type:'product_recommended',sku:'VDVSZ',canonical_product_id:'dermavital_szappan',occurred_at:new Date(Date.now()-2000).toISOString()},{event_id:crypto.randomUUID(),attribution_id:attributionId,event_type:'product_clicked',sku:'VDVSZ',canonical_product_id:'dermavital_szappan',occurred_at:new Date(Date.now()-1000).toISOString()}];
function stores(){let proofRow=null,outcome=null,writes=0;return{proofStore:{findProof:async()=>proofRow,insertProof:async row=>(proofRow={...row,proof_id:crypto.randomUUID()},{duplicate:false,row:proofRow})},outcomeStore:{insertOutcome:async value=>{if(outcome)return{duplicate:true,outcome};outcome=value;writes++;return{duplicate:false,outcome};}},get outcome(){return outcome;},get writes(){return writes;}};}
const verifyOrder=async key=>({ok:true,order:{key,id:'365905971',customer:{email:'private@example.test'},items:[{id:'1462570616',sku:'VDVSZ'}]}});
(async()=>{const s=stores(),options={proofStore:s.proofStore,outcomeStore:s.outcomeStore,findEvents:()=>events,verifyOrder};let result=await processOrderProof(proof,options);assert.deepEqual(result,{ok:true,verified:true,duplicate:false});assert.equal(s.writes,1);assert.equal(s.outcome.orderKey,proof.orderKey);assert.equal(s.outcome.attributionId,proof.attributionId);assert.equal(s.outcome.orderId,'365905971');assert.equal(/customer|email|phone|address|comment|private@example/i.test(JSON.stringify(s.outcome)),false);result=await processOrderProof(proof,options);assert.deepEqual(result,{ok:true,verified:true,duplicate:true});assert.equal(s.writes,1);
 const failed=stores();result=await processOrderProof({...proof,orderKey:'FAIL'},{proofStore:failed.proofStore,outcomeStore:failed.outcomeStore,findEvents:()=>events,verifyOrder:async()=>({ok:false})});assert.equal(result.error,'unas_verification_failed');assert.equal(failed.writes,0);
 const mismatch=stores();result=await processOrderProof({...proof,orderKey:'MISMATCH'},{proofStore:mismatch.proofStore,outcomeStore:mismatch.outcomeStore,findEvents:()=>events,verifyOrder:async key=>({ok:true,order:{key,id:'1',items:[{id:'x',sku:'OTHER'}]}})});assert.equal(result.verified,false);assert.equal(mismatch.writes,0);
 // 70b5118 separates browser verification from outcome persistence (8847d16).
 const missing=stores();let revenueCalls=0;
 const browserOptions={proofStore:missing.proofStore,findEvents:()=>events,verifyOrder,onVerifiedRevenue:()=>{revenueCalls++;}};
 assert.deepEqual(await processOrderProof({...proof,orderKey:'NO-STORE'},browserOptions),{ok:true,verified:true,duplicate:false});
 result=await processOrderProof({...proof,orderKey:'NO-STORE'},browserOptions);
 assert.deepEqual(result,{ok:true,verified:true,duplicate:true}); // No persistence claim or extra output.
 assert.equal(missing.writes,0);assert.equal(missing.outcome,null);assert.equal(revenueCalls,0);
 const requested=stores();let persistenceAttempts=0;
 const requiredOptions={proofStore:requested.proofStore,findEvents:()=>events,verifyOrder,
   outcomeStore:{insertOutcome:async()=>{persistenceAttempts++;throw Error('fixture persistence unavailable');}}};
 for(const duplicate of [false,true]){
   assert.deepEqual(await processOrderProof({...proof,orderKey:'STORE-FAIL'},requiredOptions),
     {ok:false,verified:true,duplicate,error:'commerce_outcome_storage_failed'});
 }
 assert.equal(persistenceAttempts,2);
 const reprocessOptions={proofStore:{findProof:async()=>({proof_id:'fixture-proof',verified:true,verified_at:proof.timestamp})},
   eventStore:{findAttribution:async()=>events,findProductClickedByAttribution:async()=>events.filter(e=>e.event_type==='product_clicked')},
   verifyOrder,orderKey:ORDER_KEY,attributionId:ATTRIBUTION_ID};
 await assert.rejects(()=>reprocessVerifiedOrder(reprocessOptions),{code:'REPROCESS_DEPENDENCIES_REQUIRED'});
 await assert.rejects(()=>reprocessVerifiedOrder({...reprocessOptions,outcomeStore:requiredOptions.outcomeStore}),{code:'VERIFIED_OUTCOME_REPROCESS_FAILED'});
 assert.equal(persistenceAttempts,3);
 console.log('Verified proof outcomeStore production wiring contract: PASS');})().catch(e=>{console.error(e);process.exitCode=1;});
