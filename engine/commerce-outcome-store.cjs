'use strict';

const fs = require('node:fs');
const path = require('node:path');
const TABLE = 'commerce_outcomes';

function rowFromOutcome(value) {
  return { outcome_id:value.outcomeId, schema_version:value.schemaVersion, attribution_id:value.attributionId,
    order_key:value.orderKey, order_id:value.orderId, outcome_type:value.outcomeType, matched_skus:value.matchedSkus,
    clicked_skus:value.clickedSkus, conversation_session_ids:value.conversationSessionIds,
    recommendation_evidence:value.recommendationEvidence, click_evidence:value.clickEvidence,
    verified_at:value.verifiedAt, source:value.source };
}
function outcomeFromRow(row) {
  if (!row || typeof row !== 'object' || !row.outcome_id || !row.order_key || row.outcome_type !== 'verified_order') return null;
  return { outcomeId:row.outcome_id, schemaVersion:row.schema_version, attributionId:row.attribution_id, orderKey:row.order_key,
    orderId:row.order_id, outcomeType:row.outcome_type, matchedSkus:Array.isArray(row.matched_skus)?row.matched_skus:[],
    clickedSkus:Array.isArray(row.clicked_skus)?row.clicked_skus:[], conversationSessionIds:Array.isArray(row.conversation_session_ids)?row.conversation_session_ids:[],
    recommendationEvidence:Array.isArray(row.recommendation_evidence)?row.recommendation_evidence:[], clickEvidence:Array.isArray(row.click_evidence)?row.click_evidence:[],
    verifiedAt:row.verified_at, source:row.source };
}
function parseRows(response) { const rows=JSON.parse(response?.body||'[]'); if(!Array.isArray(rows))throw new Error('invalid_commerce_outcome_store_response'); return rows; }
function withPhase(error, phase) { const value=error instanceof Error?error:new Error(String(error?.message||error||phase));value.outcomePhase=value.outcomePhase||phase;return value; }
function returnedError(response, method, pathname) { if(!response?.error)return null;const source=response.error,error=source instanceof Error?source:new Error(String(source.message||'Supabase request failed'));error.status=error.status||response.status||null;error.supabaseCode=error.supabaseCode||source.code||null;error.supabaseMessage=error.supabaseMessage||source.message||'';error.supabaseDetails=error.supabaseDetails||source.details||'';error.method=error.method||method;error.pathname=error.pathname||pathname;return error; }

function createSupabaseCommerceOutcomeStore({request,mapOutcome=rowFromOutcome}={}) {
  if(typeof request!=='function')throw new Error('supabase_request_required');
  return {kind:'supabase',productionDurable:true,idempotencyScope:'schema_version_order_key_unique_constraint',
    async findByOrder(schemaVersion,orderKey){const response=await request({pathname:`/rest/v1/${TABLE}?select=*&schema_version=eq.${encodeURIComponent(schemaVersion)}&order_key=eq.${encodeURIComponent(orderKey)}&limit=1`,operation:'commerce_outcome_lookup',table:TABLE});return outcomeFromRow(parseRows(response)[0]);},
    async insertOutcome(outcome){let row;try{row=mapOutcome(outcome);}catch(error){throw withPhase(error,'outcome_mapping_failed');}const pathname=`/rest/v1/${TABLE}?on_conflict=schema_version,order_key&select=*`;let response;try{response=await request({method:'POST',pathname,body:row,headers:{Prefer:'resolution=ignore-duplicates,return=representation'},operation:'commerce_outcome_insert',table:TABLE});const returned=returnedError(response,'POST',pathname);if(returned)throw returned;}catch(error){throw withPhase(error,'supabase_insert_failed');}let inserted;try{inserted=parseRows(response);}catch(error){throw withPhase(error,'supabase_insert_failed');}if(inserted.length)return{duplicate:false,outcome:outcomeFromRow(inserted[0])};try{return{duplicate:true,outcome:await this.findByOrder(outcome.schemaVersion,outcome.orderKey)};}catch(error){throw withPhase(error,'supabase_insert_failed');}},
    async listOutcomes(limit=100){const safe=Math.min(Math.max(Number(limit)||100,1),500),response=await request({pathname:`/rest/v1/${TABLE}?select=*&order=verified_at.desc&limit=${safe}`,operation:'commerce_outcome_list',table:TABLE});return parseRows(response).map(outcomeFromRow).filter(Boolean);}
  };
}

// LOCAL/POC ONLY. Render ephemeral storage is not production persistence.
function createLocalCommerceOutcomeStore(filePath) {
  const rows=new Map();
  try{for(const line of fs.readFileSync(filePath,'utf8').split(/\r?\n/).filter(Boolean)){try{const outcome=outcomeFromRow(JSON.parse(line));if(outcome)rows.set(`${outcome.schemaVersion}:${outcome.orderKey}`,outcome);}catch{}}}catch{}
  return {kind:'local_poc_jsonl',productionDurable:false,idempotencyScope:'available_local_file',
    async findByOrder(schemaVersion,orderKey){return rows.get(`${schemaVersion}:${orderKey}`)||null;},
    async insertOutcome(outcome){const key=`${outcome.schemaVersion}:${outcome.orderKey}`,existing=rows.get(key);if(existing)return{duplicate:true,outcome:existing};fs.mkdirSync(path.dirname(filePath),{recursive:true});fs.appendFileSync(filePath,`${JSON.stringify(rowFromOutcome(outcome))}\n`,'utf8');rows.set(key,outcome);return{duplicate:false,outcome};},
    async listOutcomes(limit=100){return [...rows.values()].sort((a,b)=>String(b.verifiedAt).localeCompare(String(a.verifiedAt))).slice(0,Math.min(Math.max(Number(limit)||100,1),500));}
  };
}
function createUnavailableOutcomeStore(){const unavailable=async()=>{throw new Error('production_commerce_outcome_store_unavailable');};return{kind:'unavailable',productionDurable:false,idempotencyScope:'none',findByOrder:unavailable,insertOutcome:unavailable,listOutcomes:unavailable};}
function createCommerceOutcomeStore(options={}){if(options.supabaseConfigured)return createSupabaseCommerceOutcomeStore({request:options.request});if(options.productionRuntime)return createUnavailableOutcomeStore();return createLocalCommerceOutcomeStore(options.filePath);}
module.exports={TABLE,rowFromOutcome,outcomeFromRow,createCommerceOutcomeStore,createSupabaseCommerceOutcomeStore,createLocalCommerceOutcomeStore,createUnavailableOutcomeStore};
