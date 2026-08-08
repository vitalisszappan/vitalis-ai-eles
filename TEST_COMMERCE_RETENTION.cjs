'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {DAY_MS,markRetentionCandidates}=require('./engine/commerce-retention.cjs');
const now=Date.parse('2026-08-08T16:00:00Z');
const result=markRetentionCandidates({now,events:[
 {event_id:'expired-event',received_at:new Date(now-90*DAY_MS-1).toISOString()},
 {event_id:'boundary-event',received_at:new Date(now-90*DAY_MS).toISOString()},
 {event_id:'recent-event',received_at:new Date(now-89*DAY_MS).toISOString()}
],proofs:[
 {proof_id:'expired-proof',created_at:new Date(now-180*DAY_MS-1).toISOString()},
 {proof_id:'boundary-proof',created_at:new Date(now-180*DAY_MS).toISOString()},
 {proof_id:'recent-proof',created_at:new Date(now-179*DAY_MS).toISOString()}
]});
assert.deepEqual(result.eventIds,['expired-event']);assert.deepEqual(result.proofIds,['expired-proof']);
const sql=fs.readFileSync('SUPABASE_COMMERCE_RETENTION_PLAN.sql','utf8');
const executable=sql.split(/\r?\n/).filter(line=>!/^\s*--/.test(line)).join('\n');
assert.doesNotMatch(executable,/\bdelete\b|\bdrop\b|\btruncate\b|\bupdate\b/i);
assert.doesNotMatch(executable,/knowledge_|chat_|conversations/i);
assert.match(executable,/commerce_events[\s\S]*received_at\s*</i);assert.match(executable,/commerce_order_proofs[\s\S]*created_at\s*</i);assert.match(executable,/rollback\s*;/i);
console.log('Commerce retention boundary, scope es read-only SQL terv: OK');
