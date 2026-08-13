'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');
const {unasDateToIso,createRevenuePhase4Service}=require('./engine/revenue-phase4.cjs');
const {createRevenueAdminReader}=require('./engine/revenue-admin-read.cjs');

const events=[{event_type:'product_recommended',event_id:'16ff6e76-5bb9-4850-be91-06baa15df6fc',sku:'VDVSZ',canonical_product_id:'dermavital_szappan'},{event_type:'product_clicked',event_id:'7dab4907-bc54-4e49-bcc8-c636b239d2af',sku:'VDVSZ',canonical_product_id:'dermavital_szappan'}];
const base={proof:{orderKey:'99212-298722',attributionId:'ad6b5200-fb23-43c1-8065-a0508a4540bc'},proofRow:{proof_id:'8a5a7c8f-acbb-48ed-98e9-750f7304e598',verified:true},order:{key:'99212-298722',id:'365905971',date:'2026.08.12 16:06:25',currency:'HUF',status:'Feldolgozásra vár',statusId:'283137',statusType:'open_normal',items:[{id:'1462570616',sku:'VDVSZ',quantity:'1',priceGross:'2700'},{id:'shipping-cost',sku:'shipping-cost',quantity:'1',priceGross:'1850'},{id:'handel-cost',sku:'handel-cost',quantity:'1',priceGross:'400'}]},priorEvents:events,outcome:{outcomeId:'10000000-0000-4000-8000-000000000001',matchedSkus:['VDVSZ']}};
(async()=>{
 let payload;const service=createRevenuePhase4Service({request:async req=>(payload=req.body.p_payload,{body:JSON.stringify({ok:true,duplicate:false,revenueOrderId:'10000000-0000-4000-8000-000000000002',lifecycleState:'verified_pending',code:'created'})})});
 assert.equal(unasDateToIso('2026.08.12 16:06:25'),'2026-08-12T14:06:25.000Z');assert.throws(()=>unasDateToIso('bad'),/invalid_authoritative_ordered_at/);
 const created=await service.persistVerified(base);assert.equal(created.duplicate,false);assert.deepEqual([payload.productOrderValue,payload.aiAssistedProductValue,payload.shippingValue,payload.paymentFeeValue,payload.otherValue,payload.fullOrderValue],['2700','2700','1850','400','0','4950']);assert.equal(payload.items.length,3);assert.equal(payload.items[0].clickEventIds.length,1);
 await assert.rejects(()=>service.persistVerified({...base,proofRow:{verified:true}}),/verified_proof_required/);
 await assert.rejects(()=>service.persistVerified({...base,priorEvents:events.filter(e=>e.event_type!=='product_recommended')}),/exact_attribution_match_required/);
 await assert.rejects(()=>service.persistVerified({...base,order:{...base.order,items:[{id:'1462570616',sku:'VDVSZ'}]}}),/authoritative_monetary_evidence_required/);
 const dbRows=[{ai_assisted_order:true,ai_assisted_product_value:'2700',product_order_value:'2700',shipping_value:'1850',payment_fee_value:'400',other_value:'0',full_order_value:'4950'}];
 const reader=createRevenueAdminReader({request:async req=>({body:JSON.stringify(req.pathname.includes('order=')?[{order_key:'99212-298722',order_id:'365905971',ordered_at:'2026-08-12',currency:'HUF',lifecycle:[{lifecycle_state:'verified_pending'}],ai_assisted_order:true,ai_assisted_product_value:'2700',product_order_value:'2700',shipping_value:'1850',payment_fee_value:'400',other_value:'0',full_order_value:'4950',attribution_id:base.proof.attributionId,items:[{sku:'VDVSZ',line_type:'product',quantity:'1',line_gross:'2700',recommended_match:true,clicked_match:true,canonical_product_ids:['dermavital_szappan']}]}]:dbRows)})});
 const summary=await reader.summary();assert.deepEqual([summary.orders,summary.aiAssistedOrders,summary.aiAssistedProductRevenue,summary.fullOrderRevenue],[1,1,2700,4950]);
 const orders=await reader.orders(50);assert.equal(orders.items.length,1);assert.equal(orders.items[0].items.length,1);assert.equal(/customer|email|phone|address|comment/i.test(JSON.stringify(orders)),false);
 const server=fs.readFileSync('server.cjs','utf8'),html=fs.readFileSync('public/admin.html','utf8'),js=fs.readFileSync('public/admin.js','utf8');
 assert.match(server,/allowQueryToken:false/);assert.match(server,/revenue\/summary/);assert.match(server,/revenue\/orders/);assert.match(html,/AI bevétel/);assert.match(html,/AI-asszisztált rendelések/);assert.match(js,/loadRevenue/);assert.equal(/customer|email|phone|address|comment/i.test(fs.readFileSync('engine/revenue-admin-read.cjs','utf8')),false);
 console.log('Revenue Phase 4 wiring, admin API and UI contract: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
