'use strict';

const {processOrderProof}=require('./order-proof.cjs');
const ORDER_KEY='99212-298722';
const ATTRIBUTION_ID='ad6b5200-fb23-43c1-8065-a0508a4540bc';
function stop(code){const error=new Error(code);error.code=code;throw error;}

async function reprocessVerifiedOrder({proofStore,eventStore,outcomeStore,verifyOrder,onUnasDiagnostic,orderKey=ORDER_KEY,attributionId=ATTRIBUTION_ID}={}){
 if(!proofStore?.findProof||!eventStore?.findAttribution||!eventStore?.findProductClickedByAttribution||!outcomeStore?.insertOutcome||typeof verifyOrder!=='function')stop('REPROCESS_DEPENDENCIES_REQUIRED');
 if(orderKey!==ORDER_KEY||attributionId!==ATTRIBUTION_ID)stop('EXACT_REPROCESS_TARGET_REQUIRED');
 const existing=await proofStore.findProof({schemaVersion:1,attributionId,orderKey});
 if(!existing?.proof_id||existing.verified!==true||!existing.verified_at)stop('VERIFIED_PROOF_REQUIRED');
 const proof={schemaVersion:1,orderKey,attributionId,timestamp:new Date(existing.verified_at).toISOString()};
 const result=await processOrderProof(proof,{proofStore,eventStore,outcomeStore,verifyOrder,onUnasDiagnostic});
 if(!result.ok||result.verified!==true)stop(result.error==='unas_verification_failed'?'UNAS_REVERIFICATION_FAILED':'VERIFIED_OUTCOME_REPROCESS_FAILED');
 return{ok:true,verified:true,duplicate:result.duplicate===true};
}
module.exports={ORDER_KEY,ATTRIBUTION_ID,reprocessVerifiedOrder};
