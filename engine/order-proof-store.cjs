'use strict';
const { createLocalPocProofStore } = require('./order-proof.cjs');
const TABLE = 'commerce_order_proofs';
function parseRows(response) { const rows = JSON.parse(response?.body || '[]'); if (!Array.isArray(rows)) throw new Error('invalid_order_proof_store_response'); return rows; }
function createSupabaseOrderProofStore({ request } = {}) {
  if (typeof request !== 'function') throw new Error('supabase_request_required');
  return {
    kind:'supabase', productionDurable:true, idempotencyScope:'schema_version_attribution_id_order_key_unique_constraint',
    async findProof(key) {
      const response=await request({pathname:`/rest/v1/${TABLE}?select=verified&schema_version=eq.${encodeURIComponent(key.schemaVersion)}&attribution_id=eq.${encodeURIComponent(key.attributionId)}&order_key=eq.${encodeURIComponent(key.orderKey)}&limit=1`,operation:'commerce_order_proof_lookup',table:TABLE});
      return parseRows(response)[0]||null;
    },
    async insertProof(proof) {
      const response=await request({method:'POST',pathname:`/rest/v1/${TABLE}?on_conflict=schema_version,attribution_id,order_key&select=verified`,body:proof,headers:{Prefer:'resolution=ignore-duplicates,return=representation'},operation:'commerce_order_proof_insert',table:TABLE});
      const inserted=parseRows(response); if(inserted.length)return {duplicate:false,row:inserted[0]};
      return {duplicate:true,row:await this.findProof({schemaVersion:proof.schema_version,attributionId:proof.attribution_id,orderKey:proof.order_key})};
    }
  };
}
function createLocalOrderProofStore(filePath) {
  const local=createLocalPocProofStore(filePath);
  return {...local,
    async findProof(key){return local.get(`${key.schemaVersion}:${key.attributionId}:${key.orderKey}`);},
    async insertProof(proof){return local.append({...proof,idempotency_key:`${proof.schema_version}:${proof.attribution_id}:${proof.order_key}`});}
  };
}
function createUnavailableProductionProofStore(){const unavailable=async()=>{throw new Error('production_order_proof_store_unavailable');};return {kind:'unavailable',productionDurable:false,idempotencyScope:'none',findProof:unavailable,insertProof:unavailable};}
function createOrderProofStore(options={}){if(options.supabaseConfigured)return createSupabaseOrderProofStore({request:options.request});if(options.productionRuntime)return createUnavailableProductionProofStore();return createLocalOrderProofStore(options.filePath);}
module.exports={TABLE,createOrderProofStore,createSupabaseOrderProofStore,createLocalOrderProofStore,createUnavailableProductionProofStore};
