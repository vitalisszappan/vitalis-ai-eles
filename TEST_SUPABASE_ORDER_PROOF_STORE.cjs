'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createSupabaseCommerceEventStore}=require('./engine/commerce-event-store.cjs');
const {createSupabaseOrderProofStore,createOrderProofStore}=require('./engine/order-proof-store.cjs');
const {processOrderProof}=require('./engine/order-proof.cjs');

function database(){
 const events=new Map(),proofs=new Map();
 return {events,proofs,request:async({method='GET',pathname,body})=>{
  const url=new URL(`https://mock.invalid${pathname}`),isProof=url.pathname.endsWith('/commerce_order_proofs');
  if(method==='POST'){
   if(isProof){const key=`${body.schema_version}:${body.attribution_id}:${body.order_key}`;if(proofs.has(key))return{body:'[]'};proofs.set(key,{...body,proof_id:crypto.randomUUID(),created_at:new Date().toISOString()});return{body:JSON.stringify([{verified:body.verified}])};}
   if(events.has(body.event_id))return{body:'[]'};events.set(body.event_id,{...body,received_at:new Date().toISOString()});return{body:JSON.stringify([{event_id:body.event_id}])};
  }
  let rows=[...(isProof?proofs:events).values()];
  for(const [name,prefix] of [['schema_version','eq.'],['attribution_id','eq.'],['order_key','eq.'],['event_type','eq.']]){const value=url.searchParams.get(name);if(value?.startsWith(prefix))rows=rows.filter(row=>String(row[name])===value.slice(prefix.length));}
  if(url.searchParams.get('sku')==='not.is.null')rows=rows.filter(row=>row.sku!=null);
  const before=url.searchParams.get('occurred_at')?.replace(/^lte\./,'');if(before)rows=rows.filter(row=>row.occurred_at<=before);
  return{body:JSON.stringify(rows)};
 }};
}

(async()=>{const db=database(),attributionId=crypto.randomUUID(),now=new Date();
 const eventStore=createSupabaseCommerceEventStore({request:db.request});
 await eventStore.insertEvent({event_id:crypto.randomUUID(),attribution_id:attributionId,chat_session_id:crypto.randomUUID(),event_type:'product_clicked',canonical_product_id:'dermavital_sampon',unas_product_id:'123',sku:'SKU-1',recommendation_type:'primary',recommendation_rank:1,route:'product',intent:'recommendation',occurred_at:new Date(now-1000).toISOString(),schema_version:1});
 const proof={orderKey:'970185',attributionId,schemaVersion:1,timestamp:now.toISOString()};
 const verifyOrder=async key=>({ok:true,order:{key,id:'99212-970185',date:'2026.08.08',items:[{id:'1',sku:'SKU-1'}]}});
 const outcomeStore={insertOutcome:async outcome=>({duplicate:false,outcome})};
 const first=await processOrderProof(proof,{eventStore,proofStore:createSupabaseOrderProofStore({request:db.request}),outcomeStore,verifyOrder});
 assert.deepEqual(first,{ok:true,verified:true,duplicate:false});assert.equal(db.proofs.size,1);
 // Fresh adapters simulate deploy/restart while the remote database remains.
 const duplicate=await processOrderProof(proof,{eventStore:createSupabaseCommerceEventStore({request:db.request}),proofStore:createSupabaseOrderProofStore({request:db.request}),outcomeStore,verifyOrder});
 assert.deepEqual(duplicate,{ok:true,verified:true,duplicate:true});assert.equal(db.events.size,1);assert.equal(db.proofs.size,1);
 assert.equal(createOrderProofStore({productionRuntime:true,supabaseConfigured:false}).kind,'unavailable');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vitalis-proof-fallback-'));try{const local=createOrderProofStore({productionRuntime:false,supabaseConfigured:false,filePath:path.join(temp,'proofs.jsonl')});assert.equal(local.kind,'local_poc_jsonl');assert.equal(local.productionDurable,false);}finally{fs.rmSync(temp,{recursive:true,force:true});}
 console.log('Supabase order proof restart es database idempotency: OK');
})().catch(error=>{console.error(error);process.exitCode=1});
