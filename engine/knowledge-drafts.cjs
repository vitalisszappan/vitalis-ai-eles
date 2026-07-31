'use strict';
const crypto = require('crypto');
const { normalize } = require('./normalizer.cjs');

const DRAFT_TYPES = Object.freeze(['faq','knowledge','admin_intent','expert_rule_proposal','canonical_proposal','manual_required']);
const AUTO_DRAFT_TYPES = Object.freeze(['faq','knowledge','admin_intent','manual_required']);
const GENERATION_STATUSES = Object.freeze(['generated','needs_manual_input','in_review','approved_for_import','rejected','exported']);
const SAFETY_STATUSES = Object.freeze(['safe','caution','manual_required']);
const CATEGORIES = Object.freeze(['fizetés','rendelés','szállítás','kupon','gyermekhasználat','biztonság','pikkelysömör','ekcéma','fejbőr','száraz bőr','akné','rosacea','termékhasználat','termékinformáció','dezodor','szappan','sampon','krém','egyéb']);
const STOP_WORDS = new Set(['a','az','egy','es','és','hogy','van','vagy','mit','milyen','hogyan','lehet','szeretnem','szeretnék','kapcsolatban','kerdeznek','kérdeznék','errol','erről']);

function clean(value, max=12000) { return String(value || '').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max); }
function redactPersonalData(value) { return clean(value).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[e-mail]'); }
function keywordsFor(question) {
  return [...new Set(normalize(question).split(/[^a-z0-9]+/).filter(word=>word.length>2&&!STOP_WORDS.has(word)))].slice(0,10);
}
function categoryFor(task) {
  const text=normalize(`${task.topic||''} ${task.question||''}`);
  const rules=[['fizetés',/fizet|bankkart/],['rendelés',/rendel/],['szállítás',/szallit/],['kupon',/kupon/],['gyermekhasználat',/gyerek|gyermek|eves/],['pikkelysömör',/pikkelysomor/],['ekcéma',/ekcema/],['fejbőr',/fejbor|korpa/],['száraz bőr',/szaraz bor/],['akné',/akne|pattanas/],['rosacea',/rosacea/],['dezodor',/dezodor|izzadasgatlo/],['sampon',/sampon/],['szappan',/szappan/],['krém',/krem/],['termékhasználat',/hasznal|alkalmaz/],['termékinformáció',/termek/]];
  return (rules.find(([,pattern])=>pattern.test(text))||['egyéb'])[0];
}
function contentHash(draft) {
  const selected={draftType:draft.draftType,question:draft.question,answer:draft.answer,keywords:draft.keywords,category:draft.category,canonicalIds:draft.canonicalIds,sourceKnowledgeIds:draft.sourceKnowledgeIds,sourceRuleIds:draft.sourceRuleIds,safetyStatus:draft.safetyStatus};
  return crypto.createHash('sha256').update(JSON.stringify(selected)).digest('hex');
}
function exactKnowledge(task, sources) {
  const q=normalize(task.question);
  return (sources.approvedKnowledge||[]).filter(item=>item&&item.source!=='unas'&&!/fallback/.test(item.source||'')&&item.approvalStatus!=='needs_review'&&[item.canonicalQuestion,...(item.questionVariants||[])].filter(Boolean).some(value=>normalize(value)===q));
}
function approvedCanonicalIds(task, sources) {
  const statuses=sources.productStatuses||{};
  return [...new Set(task.canonicalIds||[])].filter(id=>statuses[id]==='approved').sort();
}
function manualReason(task) {
  if (task.rootCause==='unsafe_or_medical_guidance_missing'||/gyermekhasználat|bőrprobléma/.test(task.topic||'')) return 'A biztonságos válaszhoz jóváhagyott szakmai információ szükséges.';
  if (task.rootCause==='canonical_not_approved') return 'A feladat nem approved canonical terméket érint; automatikus tartalmi draft nem készíthető.';
  if (task.rootCause==='ambiguous_question') return 'A kérdés termékkontextus nélkül többértelmű; kézi pontosítás szükséges.';
  return 'A biztonságos válaszhoz megfelelő approved forrás vagy kézi kiegészítés szükséges.';
}
function generateKnowledgeDraft(task, sources={}, options={}) {
  if (!task||!task.id) throw new Error('Érvénytelen Knowledge Task.');
  if (['solved','irrelevant'].includes(task.classification)) return null;
  const now=options.now||new Date().toISOString(), admin=sources.adminIntent||null, expert=sources.expertRule||null, knowledge=exactKnowledge(task,sources), canonicalIds=approvedCanonicalIds(task,sources);
  const unsafe=['unsafe_or_medical_guidance_missing','ambiguous_question','unknown','canonical_not_approved','canonical_mapping_missing','expert_rule_bypassed'].includes(task.rootCause)||(/bőrprobléma/.test(task.topic||'')&&task.classification!=='solved');
  let draftType='manual_required',generationStatus='needs_manual_input',safetyStatus='manual_required',answer='Kiegészítés szükséges.',generationReason=manualReason(task),confidenceScore=0,sourceKnowledgeIds=[],sourceRuleIds=[];
  if (!unsafe&&admin&&admin.source==='admin-intent') {
    draftType='admin_intent';generationStatus='generated';safetyStatus='safe';answer=clean(admin.answer);generationReason='Pontos approved admin intent alapján generálva.';confidenceScore=95;sourceRuleIds=[admin.ruleId].filter(Boolean);
  } else if (!unsafe&&task.classification==='outdated_knowledge'&&expert&&expert.source==='expert-rule') {
    draftType='knowledge';generationStatus='generated';safetyStatus='caution';answer=clean(expert.answer);generationReason='Pontos, meglévő expert szabály alapján készített javítási draft.';confidenceScore=90;sourceRuleIds=[expert.ruleId].filter(Boolean);
  } else if (!unsafe&&knowledge.length) {
    draftType=task.classification==='faq_candidate'?'faq':'knowledge';generationStatus='generated';safetyStatus='safe';answer=clean(knowledge[0].fullAnswer||knowledge[0].shortAnswer||knowledge[0].answer);generationReason='Pontos kérdésegyezésű approved knowledge elem alapján generálva.';confidenceScore=Math.min(92,80+(knowledge.length-1)*5);sourceKnowledgeIds=knowledge.map(item=>item.id).filter(Boolean).sort();
  } else if (task.classification==='product_missing') {
    generationReason='A hiányzó canonical termék kézi katalógus-ellenőrzést igényel.';
  } else if (task.classification==='wrong_answer'&&!admin) {
    generationReason='A helyes válaszhoz nem található pontos approved admin forrás.';
  }
  const draft={id:crypto.createHash('sha256').update(`draft:${task.id}`).digest('hex').slice(0,32),taskId:task.id,draftType,question:redactPersonalData(task.question),answer,keywords:keywordsFor(task.question),category:categoryFor(task),canonicalIds,sourceConversationIds:[...(task.conversationIds||[])].sort(),sourceKnowledgeIds,sourceRuleIds,generationStatus,confidenceScore,safetyStatus,generationReason,sourceSummary:[sourceRuleIds.length?`Szabály: ${sourceRuleIds.join(', ')}`:'',sourceKnowledgeIds.length?`Tudás: ${sourceKnowledgeIds.join(', ')}`:'',canonicalIds.length?`Approved canonical: ${canonicalIds.join(', ')}`:''].filter(Boolean).join('; ')||'Nincs felhasználható approved tartalmi forrás.',reviewerNote:'',reviewedAt:null,approvedAt:null,createdAt:now,updatedAt:now,manuallyEdited:false};
  draft.generatedContentHash=contentHash(draft); return draft;
}
function validateDraft(draft) {
  if (!DRAFT_TYPES.includes(draft.draftType)||!GENERATION_STATUSES.includes(draft.generationStatus)||!SAFETY_STATUSES.includes(draft.safetyStatus)||!CATEGORIES.includes(draft.category)) return false;
  return Number.isInteger(Number(draft.confidenceScore))&&Number(draft.confidenceScore)>=0&&Number(draft.confidenceScore)<=100&&Array.isArray(draft.keywords)&&draft.keywords.length<=10&&Array.isArray(draft.canonicalIds);
}
function buildKnowledgeExport(drafts, now=new Date().toISOString()) {
  const approved=drafts.filter(draft=>draft.generationStatus==='approved_for_import').sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  return {schema:'vitalis-knowledge-import/v1',generatedAt:now,drafts:approved.map(draft=>({draftId:draft.id,taskId:draft.taskId,question:redactPersonalData(draft.question),answer:redactPersonalData(draft.answer),keywords:draft.keywords,category:draft.category,canonicalIds:draft.canonicalIds,sourceConversationIds:draft.sourceConversationIds,sourceKnowledgeIds:draft.sourceKnowledgeIds,sourceRuleIds:draft.sourceRuleIds,confidenceScore:draft.confidenceScore,approvedAt:draft.approvedAt}))};
}
module.exports={DRAFT_TYPES,AUTO_DRAFT_TYPES,GENERATION_STATUSES,SAFETY_STATUSES,CATEGORIES,keywordsFor,categoryFor,contentHash,generateKnowledgeDraft,validateDraft,buildKnowledgeExport};
