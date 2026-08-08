'use strict';
const EVENT_RETENTION_DAYS=90,PROOF_RETENTION_DAYS=180,DAY_MS=24*60*60*1000;
function cutoffIso(nowMs,days){return new Date(nowMs-days*DAY_MS).toISOString();}
function isExpired(timestamp,cutoff){const value=Date.parse(timestamp),limit=Date.parse(cutoff);return Number.isFinite(value)&&Number.isFinite(limit)&&value<limit;}
function markRetentionCandidates({events=[],proofs=[],now=Date.now()}={}){const eventCutoff=cutoffIso(now,EVENT_RETENTION_DAYS),proofCutoff=cutoffIso(now,PROOF_RETENTION_DAYS);return{eventCutoff,proofCutoff,eventIds:events.filter(row=>isExpired(row.received_at,eventCutoff)).map(row=>row.event_id),proofIds:proofs.filter(row=>isExpired(row.created_at,proofCutoff)).map(row=>row.proof_id)};}
module.exports={EVENT_RETENTION_DAYS,PROOF_RETENTION_DAYS,DAY_MS,cutoffIso,isExpired,markRetentionCandidates};
