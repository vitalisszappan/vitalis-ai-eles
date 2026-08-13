'use strict';

const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {buildRevenueSnapshot,FINAL_STATUS,PENDING_STATUS}=require('./engine/revenue-domain.cjs');
const {payloadFromCreate,createSupabaseRevenueRpcAdapter}=require('./engine/revenue-rpc-persistence.cjs');
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8'),phase2=read('SUPABASE_REVENUE_ATTRIBUTION_PHASE2_APPLY.sql'),review=read('SUPABASE_REVENUE_ATTRIBUTION_PHASE3_5_RPC_REVIEW.sql'),apply=read('SUPABASE_REVENUE_ATTRIBUTION_PHASE3_5_RPC_APPLY.sql'),pre=read('SUPABASE_REVENUE_ATTRIBUTION_PHASE3_5_RPC_PRECHECK.sql'),post=read('SUPABASE_REVENUE_ATTRIBUTION_PHASE3_5_RPC_POSTCHECK.sql');
const aid='20000000-0000-4000-8000-000000000001',fp=n=>n.toString(16).padStart(64,'0');
const item=(id,sku,q,p,extra={})=>({id,sku,quantity:q,priceGross:p,...extra});
function createInput(key,status=FINAL_STATUS,items=[item('p1','SKU-A','2','10.123456789012'),item('shipping-cost','SHIP','1','2',{isTechnical:true}),item('handel-cost','FEE','1','1',{isTechnical:true}),item('other-tech','TECH','1','3',{isTechnical:true})]){const observation={kind:'status',...status},snapshot=buildRevenueSnapshot({order:{orderKey:key,orderId:`ID-${key}`,currency:'HUF',items},evidence:{recommended:[{sku:'SKU-A'}],clicked:[]},lifecycleObservation:observation});return{snapshot,attributionId:aid,proofId:null,outcomeId:null,orderedAt:'2026-08-10T10:00:00Z',evidenceCapturedAt:'2026-08-10T10:01:00Z',initialObservation:observation,refreshFingerprint:fp(key.charCodeAt(0))};}
async function invoke(db,payload,role){await db.exec('begin');try{if(role)await db.exec(`set local role ${role}`);const value=(await db.query('select public.create_commerce_revenue_snapshot_v1($1::jsonb) as result',[JSON.stringify(payload)])).rows[0].result;await db.exec('commit');return value;}catch(e){await db.exec('rollback');throw e;}}
async function count(db,table){return Number((await db.query(`select count(*)::int count from public.${table}`)).rows[0].count);}
async function denied(fn){let ok=false;try{await fn();}catch{ok=true;}assert.equal(ok,true);}

(async()=>{const db=new PGlite();await db.waitReady;try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create table public.commerce_order_proofs(proof_id uuid primary key);create table public.commerce_outcomes(outcome_id uuid primary key);');await db.exec(phase2);
 const prec=await db.exec(pre);assert.equal(prec[0].rows.every(r=>r.passed),true);
 await db.exec(review);assert.equal((await db.query("select to_regprocedure('public.create_commerce_revenue_snapshot_v1(jsonb)') is null absent")).rows[0].absent,true);
 await db.exec(apply);const postc=await db.exec(post);assert.equal(postc[0].rows.every(r=>r.passed),true,JSON.stringify(postc[0].rows));
 let secondApplyFailed=false;try{await db.exec(apply);}catch{secondApplyFailed=true;}assert.equal(secondApplyFailed,true);await db.exec('rollback');assert.equal((await db.query("select to_regprocedure('public.create_commerce_revenue_snapshot_v1(jsonb)') is not null present")).rows[0].present,true);
 // A, H, I, J, O: finalized, exact numeric, multiple line types, service-role execution.
 const a=payloadFromCreate(createInput('A')),created=await invoke(db,a,'service_role');assert.deepEqual(Object.keys(created).sort(),['code','duplicate','lifecycleState','ok','revenueOrderId'].sort());assert.equal(created.ok,true);assert.equal(created.duplicate,false);assert.equal(created.lifecycleState,'finalized');assert.equal(await count(db,'commerce_revenue_items'),4);assert.equal(String((await db.query('select product_order_value from public.commerce_revenue_orders')).rows[0].product_order_value),'20.246913578024');
 // B pending.
 const b=payloadFromCreate(createInput('B',PENDING_STATUS,[item('p1','SKU-A','1','5')])),pending=await invoke(db,b,'service_role');assert.equal(pending.lifecycleState,'verified_pending');
 // C, P, Q, R duplicate is an exact no-op.
 const before={orders:await count(db,'commerce_revenue_orders'),items:await count(db,'commerce_revenue_items'),events:await count(db,'commerce_order_lifecycle_events')};const duplicate=await invoke(db,a,'service_role');assert.equal(duplicate.duplicate,true);assert.equal(duplicate.revenueOrderId,created.revenueOrderId);assert.deepEqual({orders:await count(db,'commerce_revenue_orders'),items:await count(db,'commerce_revenue_items'),events:await count(db,'commerce_order_lifecycle_events')},before);
 // D incompatible immutable snapshot.
 const incompatible=structuredClone(a);incompatible.orderId='DIFFERENT';const conflict=await invoke(db,incompatible,'service_role');assert.equal(conflict.code,'immutable_evidence_conflict');assert.equal(await count(db,'commerce_revenue_orders'),before.orders);
 const incompatibleEvidence=structuredClone(a);incompatibleEvidence.items[0].clickEventIds=['30000000-0000-4000-8000-000000000001'];const evidenceConflict=await invoke(db,incompatibleEvidence,'service_role');assert.equal(evidenceConflict.code,'immutable_evidence_conflict');assert.equal(await count(db,'commerce_revenue_orders'),before.orders);
 // E invalid item rolls back the previously inserted order.
 const e=payloadFromCreate(createInput('E',FINAL_STATUS,[item('p1','SKU-A','1','2')]));e.items[0].lineGross='999';const itemFailure=await invoke(db,e,'service_role');assert.equal(itemFailure.ok,false);assert.equal(Number((await db.query("select count(*)::int count from public.commerce_revenue_orders where order_key='E'")).rows[0].count),0);
 // F invalid lifecycle rolls back order and items.
 const f=payloadFromCreate(createInput('F'));f.lifecycle.state='finalized';f.lifecycle.status='wrong';const lifecycleFailure=await invoke(db,f,'service_role');assert.equal(lifecycleFailure.ok,false);assert.equal(Number((await db.query("select count(*)::int count from public.commerce_revenue_orders where order_key='F'")).rows[0].count),0);
 // G concurrent identical logical calls converge (advisory-lock behavior; PGlite executes promises on one engine).
 const g=payloadFromCreate(createInput('G'));const concurrent=await Promise.all([invoke(db,g,'service_role'),invoke(db,g,'service_role')]);assert.equal(concurrent.filter(x=>x.duplicate===false).length,1);assert.equal(concurrent[0].revenueOrderId,concurrent[1].revenueOrderId);
 // K/L exact-key contract rejects PII and raw XML without writes.
 const pii=structuredClone(a);pii.orderKey='K';pii.customer={email:'secret@example.test'};const piiResult=await invoke(db,pii,'service_role');assert.equal(piiResult.code,'invalid_payload');
 const xml=structuredClone(a);xml.orderKey='L';xml.rawXml='<Order>secret</Order>';const xmlResult=await invoke(db,xml,'service_role');assert.equal(xmlResult.code,'invalid_payload');
 const nested=structuredClone(a);nested.orderKey='NESTED';nested.items[0].canonicalProductIds=[{email:'secret@example.test'}];const nestedResult=await invoke(db,nested,'service_role');assert.equal(nestedResult.code,'invalid_payload');
 // M/N execute denied before function body.
 await denied(()=>invoke(db,a,'anon'));await denied(()=>invoke(db,a,'authenticated'));
 // Adapter performs one RPC request with only p_payload and returns sanitized result.
 let call;const adapter=createSupabaseRevenueRpcAdapter({request:async args=>{call=args;return{body:JSON.stringify({ok:true,revenueOrderId:created.revenueOrderId,duplicate:true,lifecycleState:'finalized',code:'duplicate'})};}});const adapted=await adapter.createRevenueSnapshot(createInput('A'));assert.equal(call.pathname,'/rest/v1/rpc/create_commerce_revenue_snapshot_v1');assert.deepEqual(Object.keys(call.body),['p_payload']);assert.equal(adapted.duplicate,true);
 console.log('Revenue Phase 3.5 atomic RPC A-R: PASS');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
