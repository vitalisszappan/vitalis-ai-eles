'use strict';
const assert=require('node:assert/strict');
const {processOrderProof,orderProofHttpStatus}=require('./engine/order-proof.cjs');
const {formatSanitizedRequestError}=require('./engine/technical-error-sanitizer.cjs');

(async()=>{
 const internal=Object.assign(new Error('duplicate key for private@example.invalid sb_secret_SUPERSECRET'),{name:'SupabaseRequestError',status:409,supabaseCode:'23505',supabaseMessage:'email private@example.invalid apikey=sb_secret_SUPERSECRET',supabaseDetails:'Bearer eyJabcdefghijklmnopqrstuvwxyz0123456789 phone +36 30 123 4567',method:'POST',pathname:'/rest/v1/commerce_outcomes?on_conflict=schema_version,order_key&select=*'});
 let received=null;
 const now=new Date(),attributionId='11111111-1111-4111-8111-111111111111';
 const result=await processOrderProof({schemaVersion:1,attributionId,orderKey:'ORDER-DIAG',timestamp:now.toISOString()},{
  proofStore:{get:()=>null,append:row=>({duplicate:false,row})},
  findEvents:()=>[{event_type:'product_clicked',sku:'SKU-1',occurred_at:new Date(now-1000).toISOString()}],
  verifyOrder:async key=>({ok:true,order:{key,id:'1',items:[{id:'1',sku:'SKU-1'}]}}),
  outcomeStore:{insertOutcome:async()=>{throw internal;}},onOutcomeError:error=>{received=error;}
 });
 assert.equal(received,internal);assert.equal(orderProofHttpStatus(result),503);
 assert.deepEqual(result,{ok:false,verified:true,duplicate:false,error:'commerce_outcome_storage_failed'});
 const client=JSON.stringify(result);for(const forbidden of ['23505','private@example.invalid','SUPERSECRET','supabaseMessage'])assert.equal(client.includes(forbidden),false);
 const log=formatSanitizedRequestError(internal,{operation:'commerce_outcome_insert',table:'commerce_outcomes'});
 assert.match(log,/POST/);assert.match(log,/commerce_outcomes/);assert.match(log,/\[redacted-email\]/);assert.match(log,/\[redacted-secret\]/);assert.match(log,/\[redacted-token\]/);assert.match(log,/\[redacted-phone\]/);
 for(const forbidden of ['private@example.invalid','SUPERSECRET','eyJabcdefghijklmnopqrstuvwxyz0123456789','+36 30 123 4567'])assert.equal(log.includes(forbidden),false);
 console.log('Commerce outcome diagnostic logging es client isolation: OK');
})().catch(error=>{console.error(error);process.exitCode=1});
