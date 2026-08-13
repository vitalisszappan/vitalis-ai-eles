'use strict';

const {deterministicOutcomeId}=require('./commerce-outcomes.cjs');

const ORDER_KEY='99212-298722';
function stop(code){const error=new Error(code);error.code=code;throw error;}
function canonical(value){const text=String(value??'');return text.includes('.')?text.replace(/0+$/,'').replace(/\.$/,''):text;}
function rows(result){return Array.isArray(result?.rows)?result.rows:[];}

async function runPhase4ProductionPersist({db,phase4,verifyOrder,orderKey=ORDER_KEY}={}){
 if(!db||typeof db.query!=='function'||!phase4||typeof phase4.persistVerified!=='function'||typeof verifyOrder!=='function')stop('runner_dependencies_required');
 const existing=rows(await db.query('select 1 from public.commerce_revenue_orders where order_key=$1 limit 1',[orderKey]));
 if(existing.length)stop('PREEXISTING_REVENUE_RECORD');
 const proof=rows(await db.query('select proof_id,attribution_id,verified,verified_at from public.commerce_order_proofs where schema_version=1 and order_key=$1 and verified=true limit 1',[orderKey]))[0];
 if(!proof?.proof_id||proof.verified!==true)stop('VERIFIED_PROOF_REQUIRED');
 const events=rows(await db.query("select event_id,event_type,sku,canonical_product_id from public.commerce_events where attribution_id=$1 and event_type in ('product_recommended','product_clicked') order by occurred_at",[proof.attribution_id]));
 if(!events.some(e=>e.event_type==='product_recommended')||!events.some(e=>e.event_type==='product_clicked'))stop('ATTRIBUTION_EVIDENCE_REQUIRED');
 const outcome=rows(await db.query('select outcome_id,matched_skus from public.commerce_outcomes where schema_version=1 and order_key=$1 limit 1',[orderKey]))[0];
 if(!outcome?.outcome_id||!Array.isArray(outcome.matched_skus)||!outcome.matched_skus.length)stop('VERIFIED_OUTCOME_REQUIRED');
 const verification=await verifyOrder(orderKey);if(!verification?.ok||verification.order?.key!==orderKey)stop('AUTHORITATIVE_UNAS_EVIDENCE_REQUIRED');
 const order=verification.order,product=order.items?.find(i=>i.sku==='VDVSZ');
 if(!product||canonical(product.quantity)!=='1'||canonical(product.priceGross)!=='2700')stop('AUTHORITATIVE_MONETARY_MISMATCH');
 const context={proof:{orderKey,attributionId:proof.attribution_id},proofRow:proof,order,priorEvents:events,clickedEvents:events.filter(e=>e.event_type==='product_clicked'),outcome:{outcomeId:outcome.outcome_id||deterministicOutcomeId(orderKey),matchedSkus:outcome.matched_skus}};
 const first=await phase4.persistVerified(context);if(first?.duplicate!==false||first?.code!=='created')stop('FIRST_PERSISTENCE_FAILED');
 const readBack=await readRevenueAggregate(db,orderKey);validateAggregate(readBack);
 const second=await phase4.persistVerified(context);if(second?.duplicate!==true||second?.code!=='duplicate')stop('IDEMPOTENCY_FAILED');
 const afterSecond=await readRevenueAggregate(db,orderKey);validateAggregate(afterSecond);
 if(afterSecond.items.length!==readBack.items.length||afterSecond.events.length!==readBack.events.length)stop('IDEMPOTENCY_COUNT_MISMATCH');
 return{ok:true,first:'created',second:'duplicate',orderKey};
}

async function readRevenueAggregate(db,orderKey){
 const order=rows(await db.query('select * from public.commerce_revenue_orders where order_key=$1 limit 1',[orderKey]))[0];if(!order)stop('READBACK_ORDER_MISSING');
 const items=rows(await db.query('select * from public.commerce_revenue_items where revenue_order_id=$1 order by line_ordinal',[order.revenue_order_id]));
 const lifecycle=rows(await db.query('select * from public.commerce_order_lifecycle where revenue_order_id=$1',[order.revenue_order_id]))[0];
 const events=rows(await db.query('select transition_id from public.commerce_order_lifecycle_events where revenue_order_id=$1',[order.revenue_order_id]));return{order,items,lifecycle,events};
}
function validateAggregate(value){const o=value.order,p=value.items.find(i=>i.sku==='VDVSZ'),ship=value.items.find(i=>i.item_id==='shipping-cost'),fee=value.items.find(i=>i.item_id==='handel-cost');if(value.items.length!==3||!p||!ship||!fee)stop('READBACK_ITEM_MISMATCH');if(canonical(o.ai_assisted_product_value)!=='2700'||canonical(o.product_order_value)!=='2700'||canonical(o.shipping_value)!=='1850'||canonical(o.payment_fee_value)!=='400'||canonical(o.other_value)!=='0'||canonical(o.full_order_value)!=='4950')stop('READBACK_MONETARY_MISMATCH');if(!o.ai_assisted_order||!o.has_clicked_match||!o.has_recommended_match||!p.clicked_match||!p.recommended_match||!p.canonical_product_ids?.includes('dermavital_szappan'))stop('READBACK_ATTRIBUTION_MISMATCH');if(value.lifecycle?.lifecycle_state!=='verified_pending')stop('READBACK_LIFECYCLE_MISMATCH');}
module.exports={ORDER_KEY,runPhase4ProductionPersist,readRevenueAggregate,validateAggregate};
