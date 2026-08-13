'use strict';
const { createLocalPocProofStore } = require('./order-proof.cjs');
const TABLE = 'commerce_order_proofs';
function parseRows(response) { const rows = JSON.parse(response?.body || '[]'); if (!Array.isArray(rows)) throw new Error('invalid_order_proof_store_response'); return rows; }
function parseCount(response){const value=String(response?.headers?.['content-range']||'').split('/').pop(),count=Number(value);if(!Number.isInteger(count)||count<0)throw new Error('invalid_order_proof_count');return count;}
function createSupabaseOrderProofStore({ request } = {}) {
  if (typeof request !== 'function') throw new Error('supabase_request_required');
  return {
    kind:'supabase', productionDurable:true, idempotencyScope:'schema_version_attribution_id_order_key_unique_constraint',
    async findProof(key) {
      const response=await request({pathname:`/rest/v1/${TABLE}?select=proof_id,verified,verified_at&schema_version=eq.${encodeURIComponent(key.schemaVersion)}&attribution_id=eq.${encodeURIComponent(key.attributionId)}&order_key=eq.${encodeURIComponent(key.orderKey)}&limit=1`,operation:'commerce_order_proof_lookup',table:TABLE});
      return parseRows(response)[0]||null;
    },
    async insertProof(proof) {
      const response=await request({method:'POST',pathname:`/rest/v1/${TABLE}?on_conflict=schema_version,attribution_id,order_key&select=proof_id,verified,verified_at`,body:proof,headers:{Prefer:'resolution=ignore-duplicates,return=representation'},operation:'commerce_order_proof_insert',table:TABLE});
      const inserted=parseRows(response); if(inserted.length)return {duplicate:false,row:inserted[0]};
      return {duplicate:true,row:await this.findProof({schemaVersion:proof.schema_version,attributionId:proof.attribution_id,orderKey:proof.order_key})};
    },
    async getHealthSnapshot(sinceIso){const since=encodeURIComponent(sinceIso),headers={Prefer:'count=exact',Range:'0-0'};const[count,latest]=await Promise.all([request({method:'HEAD',pathname:`/rest/v1/${TABLE}?select=proof_id&verified=eq.true&verified_at=gte.${since}`,headers,operation:'commerce_health_verified_count',table:TABLE}),request({pathname:`/rest/v1/${TABLE}?select=verified_at&verified=eq.true&order=verified_at.desc&limit=1`,operation:'commerce_health_latest_verified',table:TABLE})]);return{verifiedProofCount:parseCount(count),lastVerifiedProofAt:parseRows(latest)[0]?.verified_at||null};
    }
  };
}
function createLocalOrderProofStore(filePath) {
  const local=createLocalPocProofStore(filePath);
  return {...local,
    async findProof(key){return local.get(`${key.schemaVersion}:${key.attributionId}:${key.orderKey}`);},
    async insertProof(proof){return local.append({...proof,idempotency_key:`${proof.schema_version}:${proof.attribution_id}:${proof.order_key}`});},
    async getHealthSnapshot(sinceIso){let rows=[];try{rows=require('node:fs').readFileSync(filePath,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);}catch{}const verified=rows.filter(row=>row.verified===true&&row.verified_at>=sinceIso);return{verifiedProofCount:verified.length,lastVerifiedProofAt:rows.filter(row=>row.verified===true).map(row=>row.verified_at).filter(Boolean).sort().at(-1)||null};}
  };
}
function createUnavailableProductionProofStore(){const unavailable=async()=>{throw new Error('production_order_proof_store_unavailable');};return {kind:'unavailable',productionDurable:false,idempotencyScope:'none',findProof:unavailable,insertProof:unavailable,getHealthSnapshot:unavailable};}
function createOrderProofStore(options={}){if(options.supabaseConfigured)return createSupabaseOrderProofStore({request:options.request});if(options.productionRuntime)return createUnavailableProductionProofStore();return createLocalOrderProofStore(options.filePath);}
module.exports={TABLE,createOrderProofStore,createSupabaseOrderProofStore,createLocalOrderProofStore,createUnavailableProductionProofStore};
