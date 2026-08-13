'use strict';
const crypto = require('crypto');

const CLASSIFICATIONS = Object.freeze(['solved','missing_knowledge','wrong_answer','outdated_knowledge','needs_review','product_missing','faq_candidate','blog_candidate','irrelevant']);
const STATUSES = Object.freeze(['open','in_review','approved','rejected','resolved','ignored']);
const PRIORITIES = Object.freeze(['critical','high','medium','low']);
const ROOT_CAUSES = Object.freeze(['knowledge_missing','knowledge_outdated','intent_routing_error','expert_rule_missing','expert_rule_bypassed','canonical_product_missing','canonical_mapping_missing','canonical_not_approved','alias_missing','conversation_context_missing','ambiguous_question','admin_flow_missing','unsafe_or_medical_guidance_missing','product_data_missing','irrelevant_or_spam','unknown']);
const REPAIR_TARGETS = Object.freeze(['knowledge','admin_intent','expert_rule','canonical_catalog','canonical_mapping','alias_registry','conversation_context','product_registry','safety_policy','admin_ui','none','manual_review']);
const PRIORITY_POINTS = Object.freeze({ critical:45, high:32, medium:20, low:8 });
const CLASSIFICATION_POINTS = Object.freeze({ wrong_answer:12, outdated_knowledge:9, missing_knowledge:6, product_missing:6, needs_review:2 });

function fold(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function topicFor(question) {
  const q = fold(question);
  if (/bankkart|fizet|ujra.*fizet/.test(q)) return 'fizetés';
  if (/rendel|szallit|csomag.*erkez/.test(q)) return /szallit/.test(q) ? 'szállítás' : 'rendelés';
  if (/gyerek|gyermek|\d+\s*eves/.test(q)) return 'gyermekhasználat';
  if (/pikkelysomor|gyullad|borproblem|irrit|panasz/.test(q)) return 'bőrprobléma';
  if (/izzadasgatlo|dezodor/.test(q)) return 'izzadásgátló';
  if (/hogyan|hasznal|alkalmaz/.test(q)) return 'termékhasználat';
  if (/termek|szappan|balzsam|krem|sampon/.test(q)) return 'termékinformáció';
  return 'egyéb';
}
function normalizedQuestionKey(question) {
  const topic = topicFor(question); const q = fold(question).replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
  if (topic === 'gyermekhasználat') return 'topic:gyermekhasznalat';
  if (topic === 'fizetés' && /ujra|nem tortent|sikertelen/.test(q)) return 'topic:fizetes:ujraprobalkozas';
  return q.split(' ').filter(word => !['a','az','egy','es','hogy','lehet','kerdeznek','kapcsolatban'].includes(word)).sort().join(' ');
}

function isDiagnosticOnlyConversation(conversation) {
  return /hard-fallback:(technical_failure|context_missing|routing_error)/.test(
    fold(conversation?.source || conversation?.answerSource)
  );
}

function determineRootCause({ input, classification, topic, unsafeCanonical, productStatuses }) {
  const source = fold(input.source || input.answerSource); const question = fold(input.question);
  if (/hard-fallback:alias_missing/.test(source)) return {rootCause:'alias_missing',rootCauseReason:'A fallback classifier fel nem oldott alias evidence-et jelölt.',repairTarget:'alias_registry'};
  if (/hard-fallback:confidence_rejected/.test(source)) return {rootCause:'knowledge_missing',rootCauseReason:'Volt knowledge candidate, de a determinisztikus confidence gate elutasította.',repairTarget:'knowledge'};
  if (/hard-fallback:context_missing/.test(source)) return {rootCause:'conversation_context_missing',rootCauseReason:'Felismert follow-uphoz nem állt rendelkezésre elég session context.',repairTarget:'conversation_context'};
  if (/hard-fallback:routing_error/.test(source)) return {rootCause:'intent_routing_error',rootCauseReason:'A routing classifier downstream válaszút mellett routing hibát jelölt.',repairTarget:'expert_rule'};
  if (/hard-fallback:technical_failure/.test(source)) return {rootCause:'unknown',rootCauseReason:'Technikai hiba; nem knowledge gap.',repairTarget:'manual_review'};
  if (classification === 'irrelevant') return { rootCause:'irrelevant_or_spam', rootCauseReason:'A kérdés nem igényel tudás- vagy rendszerjavítást.', repairTarget:'none' };
  if (unsafeCanonical) return { rootCause:'canonical_not_approved', rootCauseReason:`A válasz a(z) ${unsafeCanonical} canonical ID-t ${productStatuses[unsafeCanonical]} állapotban ajánlotta.`, repairTarget:'canonical_mapping' };
  if (classification === 'wrong_answer' && topic === 'fizetés') return { rootCause:'intent_routing_error', rootCauseReason:'Az admin fizetési intent helyett más témájú válaszág futott.', repairTarget:'admin_intent' };
  if (/fallback/.test(source) && /pikkelysomor|ekcema|borproblem/.test(question)) return { rootCause:'expert_rule_bypassed', rootCauseReason:'Expert szabállyal lefedhető kérdésre történeti knowledge-fallback futott.', repairTarget:'expert_rule' };
  if (classification === 'missing_knowledge' && topic === 'gyermekhasználat') return { rootCause:'unsafe_or_medical_guidance_missing', rootCauseReason:'Életkorra vonatkozó kérdéshez nincs konkrét, jóváhagyott biztonsági útmutatás.', repairTarget:'safety_policy' };
  if (/alias-missing/.test(source)) return { rootCause:'alias_missing', rootCauseReason:'A napló bizonyítottan fel nem oldott termékaliaszt jelöl.', repairTarget:'alias_registry' };
  if (/canonical-product-missing|product-missing/.test(source)) return { rootCause:'canonical_product_missing', rootCauseReason:'A napló szerint a keresett termék hiányzik a canonical katalógusból.', repairTarget:'canonical_catalog' };
  if (/mapping-missing/.test(source)) return { rootCause:'canonical_mapping_missing', rootCauseReason:'A canonical termékhez nincs bizonyított webshop-mapping.', repairTarget:'canonical_mapping' };
  if (/product-data-missing/.test(source)) return { rootCause:'product_data_missing', rootCauseReason:'A szükséges termékadat hiányzik a napló jelzése szerint.', repairTarget:'product_registry' };
  if (classification === 'missing_knowledge' && /fizetés|rendelés|szállítás/.test(topic)) return { rootCause:'admin_flow_missing', rootCauseReason:'Az adminisztratív folyamathoz nincs megfelelő jóváhagyott válasz.', repairTarget:'admin_intent' };
  if (classification === 'missing_knowledge') return { rootCause:'knowledge_missing', rootCauseReason:'Gap forrás vagy jóváhagyott tudás hiánya bizonyítható.', repairTarget:'knowledge' };
  if (classification === 'outdated_knowledge') return { rootCause:'knowledge_outdated', rootCauseReason:'A válasz történeti vagy már nem jóváhagyott tudásból származik.', repairTarget:'knowledge' };
  if (classification === 'solved') return { rootCause:'unknown', rootCauseReason:'Megoldott válasz; javítandó gyökérok nem bizonyítható.', repairTarget:'none' };
  if (/^(ez|az|ezt|azt|hasznalhatja|jo ra)/.test(question.trim())) return { rootCause:'ambiguous_question', rootCauseReason:'A kérdés önmagában nem nevezi meg a hivatkozott terméket vagy témát.', repairTarget:'conversation_context' };
  return { rootCause:'unknown', rootCauseReason:'A rendelkezésre álló adatokból nem bizonyítható biztos gyökérok.', repairTarget:'manual_review' };
}

function calculateEstimatedImpact(task) {
  const priority = PRIORITY_POINTS[task.priority] || 0;
  const businessValue = Math.min(5,Math.max(1,Number(task.businessValue)||1))*7;
  const count = Math.max(1,Number(task.occurrenceCount)||1);
  const occurrenceCount = count >= 25 ? 20 : count >= 10 ? 15 : count >= 4 ? 10 : count >= 2 ? 5 : 0;
  const classification = CLASSIFICATION_POINTS[task.classification] || 0;
  const safety = /gyermekhasznalat|fizetes|rendeles|borproblema/.test(fold(task.topic)) ? 8 : 0;
  const total = Math.min(100,Math.max(0,priority+businessValue+occurrenceCount+classification+safety));
  return { total, breakdown:{ priority,businessValue,occurrenceCount,classification,safety } };
}

function classifyConversation(input, options={}) {
  const question=String(input.question||''), answer=String(input.answer||input.bot_answer||''), source=fold(input.source||input.answerSource), q=fold(question), a=fold(answer), topic=topicFor(question);
  const canonicalIds=input.canonicalIds||input.matched_knowledge_ids||[], productStatuses=options.productStatuses||{};
  const unsafeCanonical=canonicalIds.find(id=>productStatuses[id]&&productStatuses[id]!=='approved');
  let classification='needs_review', reason='Nincs elég biztos, determinisztikus jel a besoroláshoz.';
  if (!question.trim() || /^(teszt|hello|szia|koszi|koszonom)$/.test(q.trim())) { classification='irrelevant'; reason='Nem tudásfejlesztési célú kérdés.'; }
  else if (unsafeCanonical || (/fallback/.test(source)&&/aktiv.?szen/.test(a))) { classification='outdated_knowledge'; reason=unsafeCanonical?`Nem approved canonical termék ajánlása: ${unsafeCanonical}.`:'Történeti fallback needs_review terméket ajánl.'; }
  else if (/fallback/.test(source)&&/pikkelysomor|ekcema|borproblem/.test(q)) { classification='outdated_knowledge'; reason='Expert témára történeti knowledge-fallback futott.'; }
  else if (topic==='fizetés'&&/viszontelad|termek|szappan/.test(a)) { classification='wrong_answer'; reason='A fizetési kérdésre más témájú termék/viszonteladói válasz érkezett.'; }
  else if (source==='gap'||!answer.trim()||/nincs (eleg |jovahagyott)?.*(informacio|tudas)|nem talaltam.*informaci/.test(a)) { classification='missing_knowledge'; reason='Gap forrás vagy az érdemi, jóváhagyott válasz hiánya.'; }
  else if (/product-missing/.test(source)) { classification='product_missing'; reason='A keresett termék nem található az approved termékkörben.'; }
  else if (/faq-candidate/.test(source)) { classification='faq_candidate'; reason='Ismétlődő, röviden megválaszolható FAQ-jelölt.'; }
  else if (/blog-candidate/.test(source)) { classification='blog_candidate'; reason='Részletes edukációs tartalmat igénylő kérdés.'; }
  else if (/expert-rule|admin-intent|meta-intent|approved-knowledge|canonical/.test(source)) { classification='solved'; reason=`Jóváhagyott, magas prioritású válaszforrás: ${input.source||input.answerSource}.`; }
  const critical=/fizetés|rendelés|gyermekhasználat|bőrprobléma/.test(topic)||classification==='wrong_answer'||Boolean(unsafeCanonical);
  const high=topic==='termékhasználat'||classification==='missing_knowledge'||Number(input.occurrenceCount||1)>1;
  const priority=['solved','irrelevant'].includes(classification)?'low':critical?'critical':high?'high':topic==='egyéb'?'low':'medium';
  const businessValue=/fizetés|rendelés|szállítás/.test(topic)?5:/gyermekhasználat|termékhasználat|bőrprobléma/.test(topic)?4:topic==='egyéb'?1:3;
  const suggestedAction=classification==='solved'?'Nincs teendő; mintaként felülvizsgálható.':classification==='wrong_answer'?'Ellenőrizd az intent prioritását és a választ.':classification==='outdated_knowledge'?'Vizsgáld felül a forrást és a canonical termék státuszát.':'Készíts vagy rendelj hozzá jóváhagyható tudáselemet.';
  return { classification,classificationReason:reason,priority,businessValue,topic,suggestedAction,...determineRootCause({input,classification,topic,unsafeCanonical,productStatuses}) };
}

function sortKnowledgeTasks(tasks) {
  const statusRank=status=>['resolved','ignored'].includes(status)?1:0, priorityRank={critical:0,high:1,medium:2,low:3};
  return [...tasks].sort((a,b)=>statusRank(a.status)-statusRank(b.status)||(b.estimatedImpact||0)-(a.estimatedImpact||0)||(priorityRank[a.priority]??9)-(priorityRank[b.priority]??9)||String(b.lastSeenAt||'').localeCompare(String(a.lastSeenAt||'')));
}
function taskFromConversation(conversation,options={}) {
  const key=normalizedQuestionKey(conversation.question), occurredAt=conversation.created_at||conversation.occurredAt||new Date().toISOString();
  const conversationId=String(conversation.id||conversation.conversation_id||`${conversation.session_id||'local'}:${occurredAt}`), classification=classifyConversation(conversation,options), now=options.now||new Date().toISOString();
  const task={ id:crypto.createHash('sha256').update(key).digest('hex').slice(0,32),normalizedQuestionKey:key,conversationId,conversationIds:[conversationId],question:String(conversation.question||''),answer:String(conversation.answer||conversation.bot_answer||''),answerSource:String(conversation.source||''),confidenceScore:conversation.confidence==null?null:Number(conversation.confidence),detectedIntent:conversation.intent||null,canonicalIds:conversation.canonicalIds||conversation.matched_knowledge_ids||[],pageUrl:conversation.page_url||conversation.pageUrl||null,occurredAt,...classification,productFamily:conversation.productFamily||null,status:'open',occurrenceCount:1,firstSeenAt:occurredAt,lastSeenAt:occurredAt,reviewerNote:'',reviewedAt:null,resolvedAt:null,createdAt:now,updatedAt:now };
  const impact=calculateEstimatedImpact(task); return {...task,estimatedImpact:impact.total,impactBreakdown:impact.breakdown};
}
function mergeTasks(conversations,options={}) {
  const byKey=new Map(); [...conversations].filter(conversation=>!isDiagnosticOnlyConversation(conversation)).sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))).forEach(conversation=>{ const next=taskFromConversation(conversation,options),old=byKey.get(next.normalizedQuestionKey); if(!old){byKey.set(next.normalizedQuestionKey,next);return;} if(!old.conversationIds.includes(next.conversationId))old.conversationIds.push(next.conversationId); old.occurrenceCount=old.conversationIds.length; old.firstSeenAt=old.firstSeenAt<next.firstSeenAt?old.firstSeenAt:next.firstSeenAt; old.lastSeenAt=old.lastSeenAt>next.lastSeenAt?old.lastSeenAt:next.lastSeenAt; if(next.lastSeenAt>=old.occurredAt)Object.assign(old,{conversationId:next.conversationId,question:next.question,answer:next.answer,answerSource:next.answerSource,confidenceScore:next.confidenceScore,occurredAt:next.occurredAt}); });
  return sortKnowledgeTasks([...byKey.values()].map(task=>{const impact=calculateEstimatedImpact(task);return {...task,estimatedImpact:impact.total,impactBreakdown:impact.breakdown};}));
}
module.exports={CLASSIFICATIONS,STATUSES,PRIORITIES,ROOT_CAUSES,REPAIR_TARGETS,normalizedQuestionKey,classifyConversation,calculateEstimatedImpact,sortKnowledgeTasks,taskFromConversation,mergeTasks,isDiagnosticOnlyConversation};
