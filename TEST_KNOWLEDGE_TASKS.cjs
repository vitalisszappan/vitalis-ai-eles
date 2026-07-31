'use strict';
const assert = require('assert');
const fs = require('fs');
const { CLASSIFICATIONS, ROOT_CAUSES, REPAIR_TARGETS, classifyConversation, calculateEstimatedImpact, mergeTasks, normalizedQuestionKey, sortKnowledgeTasks, taskFromConversation } = require('./engine/knowledge-tasks.cjs');
const check = (input, expected, options) => { const result=taskFromConversation({id:Math.random(),created_at:'2026-01-01T00:00:00Z',...input},options); assert.equal(result.classification,expected); return result; };
const samples=[
  check({question:'Izzadásgátlóról',answer:'Nincs jóváhagyott információ.',source:'gap'},'missing_knowledge'),
  check({question:'8 éves gyerek használhatja?',answer:'',source:'gap'},'missing_knowledge'),
  check({question:'Van egy megrendelésem, online bankkártyás fizetéssel szerettem volna kifizetni, de nem történt meg. Hogy tudom újra?',answer:'Vannak viszonteladóink...',source:'knowledge-fallback'},'wrong_answer'),
  check({question:'Gyulladt pikkelysömör',answer:'Kátrány-, teafa- és aktív szenes szappant ajánlok.',source:'knowledge-fallback',matched_knowledge_ids:['aktiv_szenes_szappan']},'outdated_knowledge',{productStatuses:{aktiv_szenes_szappan:'needs_review'}}),
  check({question:'Pikkelysömörrel kapcsolatban kérdeznék.',answer:'PsoriVital csomag és Holt-tengeri só balzsam.',source:'expert-rule'},'solved')
];
assert.deepEqual([samples[0].rootCause,samples[0].repairTarget],['knowledge_missing','knowledge']); assert(samples[0].estimatedImpact>=50);
assert.deepEqual([samples[1].rootCause,samples[1].repairTarget],['unsafe_or_medical_guidance_missing','safety_policy']); assert(samples[1].estimatedImpact>=70);
assert.deepEqual([samples[2].rootCause,samples[2].repairTarget],['intent_routing_error','admin_intent']); assert(samples[2].estimatedImpact>=85);
assert.equal(samples[3].rootCause,'canonical_not_approved'); assert.match(samples[3].rootCauseReason,/aktiv_szenes_szappan.*needs_review/); assert(samples[3].estimatedImpact>=75);
assert.equal(samples[4].repairTarget,'none'); assert(samples[4].estimatedImpact<50);

const bypass=check({question:'Pikkelysömörre mit ajánlasz?',answer:'Régi válasz',source:'knowledge-fallback'},'outdated_knowledge'); assert.equal(bypass.rootCause,'expert_rule_bypassed'); assert.equal(bypass.repairTarget,'expert_rule');
const uncertain=check({question:'Pontosan ez mit jelent?',answer:'Talán ezt.',source:'unknown'},'needs_review'); assert.deepEqual([uncertain.rootCause,uncertain.repairTarget],['unknown','manual_review']);
assert.equal(classifyConversation({question:'Ismert név',answer:'',source:'alias-missing'}).rootCause,'alias_missing');
assert.equal(classifyConversation({question:'Ismert termék',answer:'',source:'canonical-product-missing'}).rootCause,'canonical_product_missing');
assert.equal(ROOT_CAUSES.length,16); assert.equal(new Set(ROOT_CAUSES).size,16); assert.equal(REPAIR_TARGETS.length,12); assert.equal(new Set(REPAIR_TARGETS).size,12); assert.equal(CLASSIFICATIONS.length,9);

assert.equal(calculateEstimatedImpact({priority:'x',businessValue:0,occurrenceCount:1,classification:'solved',topic:'egyéb'}).total,7);
assert.equal(calculateEstimatedImpact({priority:'critical',businessValue:5,occurrenceCount:25,classification:'wrong_answer',topic:'fizetés'}).total,100);
const one=calculateEstimatedImpact({priority:'medium',businessValue:3,occurrenceCount:1,classification:'needs_review',topic:'egyéb'}).total;
const repeated=calculateEstimatedImpact({priority:'medium',businessValue:3,occurrenceCount:10,classification:'needs_review',topic:'egyéb'}).total; assert.equal(repeated-one,15);
assert.equal(normalizedQuestionKey('8 éves gyerek használhatja?'),normalizedQuestionKey('Használhatja 8 éves gyermek?'));
const merged=mergeTasks([{id:'a',created_at:'2026-01-01T00:00:00Z',question:'8 éves gyerek használhatja?',answer:'',source:'gap'},{id:'b',created_at:'2026-02-01T00:00:00Z',question:'Gyerek használhatja?',answer:'',source:'gap'}]);
assert.equal(merged.length,1); assert.equal(merged[0].occurrenceCount,2); assert.equal(merged[0].impactBreakdown.occurrenceCount,5);
const again=mergeTasks([{id:'a',created_at:'2026-01-01T00:00:00Z',question:'8 éves gyerek használhatja?',answer:'',source:'gap'},{id:'a',created_at:'2026-01-01T00:00:00Z',question:'8 éves gyerek használhatja?',answer:'',source:'gap'}]); assert.equal(again[0].occurrenceCount,1);
const sorted=sortKnowledgeTasks([{id:'closed',status:'resolved',estimatedImpact:100,priority:'critical',lastSeenAt:'2026-03-01'},{id:'low',status:'open',estimatedImpact:60,priority:'high',lastSeenAt:'2026-01-01'},{id:'high',status:'in_review',estimatedImpact:90,priority:'critical',lastSeenAt:'2026-02-01'}]); assert.deepEqual(sorted.map(x=>x.id),['high','low','closed']);
const adminHtml=fs.readFileSync('./public/admin.html','utf8'), adminJs=fs.readFileSync('./public/admin.js','utf8'), migration=fs.readFileSync('./SUPABASE_KNOWLEDGE_TASKS_1_1.sql','utf8');
for(const marker of ['root:knowledge_missing','root:intent_routing_error','root:expert','root:canonical','root:alias_missing','root:unsafe_or_medical_guidance_missing','root:unknown','impact:high']) assert(adminHtml.includes(marker));
for(const marker of ['estimatedImpact','rootCauseReason','repairTarget','impactBreakdown']) assert(adminJs.includes(marker));
for(const column of ['root_cause','root_cause_reason','repair_target','estimated_impact','impact_breakdown']) assert(migration.includes(column));
console.log('Knowledge Task 1.1 regressziótesztek: OK');
