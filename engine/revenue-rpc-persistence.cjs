'use strict';

const { mapLifecycle } = require('./revenue-domain.cjs');

const RPC_PATH='/rest/v1/rpc/create_commerce_revenue_snapshot_v1';
const FAILURE_KINDS=new Set(['transport_failure','login_failure','timeout','malformed_xml','upstream_failure','generic_502']);
function error(code){const value=new Error(code);value.code=code;return value;}
function text(value,code){const result=String(value??'').trim();if(!result)throw error(code);return result;}
function numeric(value){const result=String(value??'');if(!/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(result))throw error('invalid_numeric_string');return result;}
function nullable(value){return value==null?'':String(value);}
function parseResult(response){let body;try{body=JSON.parse(response?.body||'null');}catch{throw error('invalid_revenue_rpc_response');}if(Array.isArray(body))body=body[0];if(!body||typeof body!=='object'||typeof body.ok!=='boolean')throw error('invalid_revenue_rpc_response');return body;}
function payloadFromCreate(input={}){
 const s=input.snapshot,o=input.initialObservation;if(!s||s.schemaVersion!==1||!Array.isArray(s.items)||s.items.some(i=>!i.moneyValid))throw error('invalid_revenue_snapshot');
 if(!o||o.kind!=='status'||FAILURE_KINDS.has(o.kind))throw error('valid_status_evidence_required');
 const mapped=mapLifecycle('verified_pending',o),captured=text(input.evidenceCapturedAt,'invalid_evidence_captured_at');
 return {schemaVersion:1,orderKey:text(s.orderKey,'invalid_order_key'),orderId:text(s.orderId,'invalid_order_id'),attributionId:text(input.attributionId,'invalid_attribution_id'),proofId:nullable(input.proofId),outcomeId:nullable(input.outcomeId),orderedAt:text(input.orderedAt,'invalid_ordered_at'),currency:text(s.currency,'invalid_currency'),hasRecommendedMatch:s.hasRecommendedMatch===true,hasClickedMatch:s.hasClickedMatch===true,aiAssistedOrder:s.aiAssistedOrder===true,aiAssistedProductValue:numeric(s.aiAssistedProductRevenue),productOrderValue:numeric(s.productOrderValue),shippingValue:numeric(s.shippingValue),paymentFeeValue:numeric(s.paymentFeeValue),otherValue:numeric(s.otherValue),fullOrderValue:numeric(s.fullOrderValue),evidenceCapturedAt:captured,refreshFingerprint:text(input.refreshFingerprint,'invalid_refresh_fingerprint'),lifecycle:{state:mapped.state,status:text(o.status,'invalid_status'),statusId:String(o.statusId??''),statusType:text(o.statusType,'invalid_status_type'),lastRefreshResult:'success',reasonCode:mapped.reason,finalizedAt:mapped.state==='finalized'?captured:null},items:s.items.map((i,index)=>({lineOrdinal:Number(i.lineOrdinal??index),itemId:text(i.itemId,'invalid_item_id'),sku:nullable(i.sku),lineType:text(i.lineType,'invalid_line_type'),quantity:numeric(i.quantity),unitGross:numeric(i.unitGross),lineGross:numeric(i.lineGross),recommendedMatch:i.recommendedMatch===true,clickedMatch:i.clickedMatch===true,canonicalProductIds:Array.isArray(i.canonicalProductIds)?i.canonicalProductIds:[],recommendationEventIds:Array.isArray(i.recommendationEventIds)?i.recommendationEventIds:[],clickEventIds:Array.isArray(i.clickEventIds)?i.clickEventIds:[]}))};
}
function createSupabaseRevenueRpcAdapter({request,readAdapter}={}){
 if(typeof request!=='function')throw error('supabase_request_required');
 async function createRevenueSnapshot(input){const p_payload=payloadFromCreate(input);let response;try{response=await request({method:'POST',pathname:RPC_PATH,body:{p_payload},headers:{Prefer:'return=representation'},operation:'commerce_revenue_snapshot_rpc',table:'create_commerce_revenue_snapshot_v1'});}catch(cause){const e=error('revenue_rpc_request_failed');e.cause=cause;throw e;}const result=parseResult(response);if(!result.ok)throw error(result.code||'revenue_rpc_failed');return {duplicate:result.duplicate===true,revenueOrderId:result.revenueOrderId,lifecycleState:result.lifecycleState,code:result.code};}
 return {kind:'supabase_atomic_rpc',productionDurable:true,atomicityScope:'single_postgresql_function_transaction',createRevenueSnapshot,
  getRevenueOrderByOrderKey:readAdapter?.getRevenueOrderByOrderKey?.bind(readAdapter),getRevenueOrderById:readAdapter?.getRevenueOrderById?.bind(readAdapter),upsertLifecycleState:readAdapter?.upsertLifecycleState?.bind(readAdapter),appendLifecycleEvent:readAdapter?.appendLifecycleEvent?.bind(readAdapter),getRevenueSummary:readAdapter?.getRevenueSummary?.bind(readAdapter),listRevenueOrders:readAdapter?.listRevenueOrders?.bind(readAdapter),listRevenueByProduct:readAdapter?.listRevenueByProduct?.bind(readAdapter)};
}
module.exports={RPC_PATH,payloadFromCreate,createSupabaseRevenueRpcAdapter};
