'use strict';
const assert=require('node:assert/strict');
const {processOrderProof,orderProofHttpStatus}=require('./engine/order-proof.cjs');
const {buildVerifiedOrderOutcome}=require('./engine/commerce-outcomes.cjs');
const {createSupabaseCommerceOutcomeStore,rowFromOutcome}=require('./engine/commerce-outcome-store.cjs');
const {formatCommerceOutcomeDiagnostic}=require('./engine/technical-error-sanitizer.cjs');

const attributionId='11111111-1111-4111-8111-111111111111';
function fixture(orderKey='ORDER-DIAG'){
 const now=new Date(),proof={schemaVersion:1,attributionId,orderKey,timestamp:now.toISOString()};
 const events=[{event_type:'product_clicked',sku:'SKU-1',occurred_at:new Date(now-1000).toISOString()}];
 return{proof,events,base:{proofStore:{get:()=>null,append:row=>({duplicate:false,row})},findEvents:()=>events,verifyOrder:async key=>({ok:true,order:{key,id:'1',items:[{id:'1',sku:'SKU-1'}]}})}};
}
async function processFailure(extra,orderKey){const value=fixture(orderKey),diagnostics=[];const result=await processOrderProof(value.proof,{...value.base,...extra,onOutcomeDiagnostic:event=>diagnostics.push(event)});return{result,diagnostics,value};}

(async()=>{
 const built=await processFailure({outcomeStore:{insertOutcome:async()=>assert.fail('not reached')},buildOutcome:()=>{throw Error('builder exploded');}},'BUILD');
 assert.equal(built.diagnostics[0].phase,'outcome_build_failed');

 const invalid=await processFailure({outcomeStore:{insertOutcome:async()=>assert.fail('not reached')},buildOutcome:input=>({...buildVerifiedOrderOutcome(input),outcomeId:'bad'})},'VALIDATE');
 assert.equal(invalid.diagnostics[0].phase,'outcome_validation_failed');

 const mappingStore=createSupabaseCommerceOutcomeStore({request:async()=>assert.fail('not reached'),mapOutcome:()=>{throw Error('mapping exploded');}});
 await assert.rejects(mappingStore.insertOutcome({}),error=>error.outcomePhase==='outcome_mapping_failed');

 const returnedInternal={code:'42501',message:'permission denied private@example.invalid apikey=sb_secret_SUPERSECRET',details:'Bearer eyJabcdefghijklmnopqrstuvwxyz0123456789 phone +36 30 123 4567'};
 const returnedStore=createSupabaseCommerceOutcomeStore({request:async()=>({status:403,error:returnedInternal})});
 const returned=await processFailure({outcomeStore:returnedStore},'RETURNED');assert.equal(returned.diagnostics[0].phase,'supabase_insert_failed');assert.equal(returned.diagnostics[0].error.supabaseCode,'42501');

 const thrownInternal=Object.assign(new Error('PostgREST failed'),{name:'SupabaseRequestError',status:400,supabaseCode:'PGRST204',supabaseMessage:'column missing',method:'POST',pathname:'/rest/v1/commerce_outcomes'});
 const thrown=await processFailure({outcomeStore:{insertOutcome:async()=>{throw thrownInternal;}}},'THROWN');assert.equal(thrown.diagnostics[0].phase,'supabase_insert_failed');assert.equal(thrown.diagnostics[0].error,thrownInternal);

 const successFixture=fixture('SUCCESS'),successEvents=[];
 const success=await processOrderProof(successFixture.proof,{...successFixture.base,outcomeStore:{insertOutcome:async outcome=>({duplicate:false,outcome})},onOutcomeDiagnostic:event=>successEvents.push(event)});
 assert.deepEqual(success,{ok:true,verified:true,duplicate:false});assert.equal(successEvents[0].phase,'supabase_insert_succeeded');

 const duplicateFixture=fixture('DUPLICATE'),duplicateEvents=[];
 const duplicate=await processOrderProof(duplicateFixture.proof,{...duplicateFixture.base,proofStore:{get:()=>({verified:true})},outcomeStore:{insertOutcome:async outcome=>({duplicate:true,outcome})},onOutcomeDiagnostic:event=>duplicateEvents.push(event)});
 assert.deepEqual(duplicate,{ok:true,verified:true,duplicate:true});assert.equal(duplicateEvents[0].phase,'supabase_insert_succeeded');

 assert.equal(orderProofHttpStatus(thrown.result),503);assert.deepEqual(thrown.result,{ok:false,verified:true,duplicate:false,error:'commerce_outcome_storage_failed'});
 const client=JSON.stringify(thrown.result);for(const forbidden of ['PGRST204','column missing','SupabaseRequestError'])assert.equal(client.includes(forbidden),false);
 const log=formatCommerceOutcomeDiagnostic(returned.diagnostics[0]);
 for(const required of ['phase=supabase_insert_failed','outcomeId=','attributionId=','orderKey=RETURNED','schemaVersion=1','timestamp=','code=42501'])assert.match(log,new RegExp(required));
 for(const forbidden of ['private@example.invalid','SUPERSECRET','eyJabcdefghijklmnopqrstuvwxyz0123456789','+36 30 123 4567'])assert.equal(log.includes(forbidden),false);
 assert.match(log,/\[redacted-email\]/);assert.match(log,/\[redacted-secret\]/);assert.match(log,/\[redacted-token\]/);assert.match(log,/\[redacted-phone\]/);

 const direct=fixture('DIRECT'),outcome=buildVerifiedOrderOutcome({proof:direct.proof,order:{id:'1',items:[{id:'1',sku:'SKU-1'}]},priorEvents:direct.events,clickedEvents:direct.events});
 const row=rowFromOutcome(outcome),successfulStore=createSupabaseCommerceOutcomeStore({request:async()=>({status:201,body:JSON.stringify([row])})});
 assert.equal((await successfulStore.insertOutcome(outcome)).duplicate,false);
 console.log('Commerce outcome phased diagnostics, Supabase errors es client isolation: OK');
})().catch(error=>{console.error(error);process.exitCode=1});
