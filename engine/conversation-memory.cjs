'use strict';
const {buildConversationContext}=require('./conversation-context.cjs');
const {normalize}=require('./normalizer.cjs');
const {PRODUCTS}=require('./product-catalog.cjs');
const {detectCustomerGoal}=require('./customer-goal.cjs');
const {reconstructGuidedDiscovery}=require('./guided-discovery.cjs');
const {createCatalogSearch}=require('./catalog-search.cjs');
const fs=require('fs');
const {resolvePersistedProductEvidence}=require('./persisted-product-evidence.cjs');
const SESSION_RE=/^[a-zA-Z0-9-]{16,100}$/;const MAX_HISTORY_MESSAGES=20;
const catalog=createCatalogSearch();
let canonicalByUnasId={};
let skuByProductId={};
try{const mapping=JSON.parse(fs.readFileSync(require('path').join(__dirname,'..','data','canonical-unas-mapping.json'),'utf8'));const approved=(mapping.mappings||[]).filter(item=>item.mappingStatus==='approved');canonicalByUnasId=Object.fromEntries(approved.filter(item=>item.unasId).map(item=>[String(item.unasId),item.canonicalId]));skuByProductId=Object.fromEntries(approved.flatMap(item=>[[item.canonicalId,item.sku],[String(item.unasId||''),item.sku]]).filter(([,sku])=>sku));}catch{}
// Provenance is process-local; browser JSON cannot mint trusted server rows.
const serverEvents=new WeakMap();
const TURN_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function validSessionId(value){return SESSION_RE.test(String(value||''));}
function historyProductId(value) {
  const id = String(value || '');
  // URI encoding can expand a short commerce identity beyond the legacy cap.
  // Cutting a namespaced reference can change its identity or break decoding.
  return /^catalog:(?:unas|sku):/.test(id) ? id : id.slice(0,80);
}
function normalizeMessage(value) {
  if (!value || !['user','assistant'].includes(value.role) || typeof value.content !== 'string') return null;
  const content = value.content.trim().slice(0,5000);
  if (!content) return null;
  const constrainedExpert = value.route === 'expert_rule' && ['body_lotion','facial_cream'].includes(value.productTypeConstraint);
  const selectionLimit = value.route === 'subtype_catalog' || constrainedExpert ? 6 : 3;
  const links = (Array.isArray(value.links) ? value.links : []).slice(0,selectionLimit)
    .map(item=>({id:historyProductId(item?.id),name:String(item?.name||item?.title||'').slice(0,300)})).filter(item=>item.id);
  const result = { role:value.role, content, ...(links.length?{links}:{}),
    ...(typeof value.turnId==='string' && TURN_RE.test(value.turnId)?{turnId:value.turnId}:{}),
    ...(value.route?{route:String(value.route).slice(0,40)}:{}),
    ...(value.route==='subtype_catalog' && value.catalogStatus==='CATALOG_AVAILABLE_NO_MATCH'?{catalogStatus:value.catalogStatus}:{}),
    ...(['body_lotion','facial_cream'].includes(value.productTypeConstraint)?{productTypeConstraint:value.productTypeConstraint}:{}),
    ...(value.intent?{intent:String(value.intent).slice(0,80)}:{}),
    ...(value.domain?{domain:String(value.domain).slice(0,80)}:{}),
    ...(value.responseType?{responseType:String(value.responseType).slice(0,80)}:{}),
    ...(value.targetProductId?{targetProductId:historyProductId(value.targetProductId)}:{}) };
  if(serverEvents.has(value)){serverEvents.set(result,serverEvents.get(value));if(value.historyEventInvalid)result.historyEventInvalid=true;if(value.historyEventUncorrelated)result.historyEventUncorrelated=true;if(value.historySelectionAuthority)result.historySelectionAuthority=true;if(value.historySelectionSuperseded)result.historySelectionSuperseded=true;}
  return result;
}
function rowsToHistory(rows) {
  // loadRows is the server reader, never a browser-provided history object.
  return [...(Array.isArray(rows)?rows:[])].sort((a,b)=>Number.isSafeInteger(a.history_order)&&Number.isSafeInteger(b.history_order)?a.history_order-b.history_order:String(a.created_at||'').localeCompare(String(b.created_at||'')) || String(a.id||'').length-String(b.id||'').length || String(a.id||'').localeCompare(String(b.id||''))).flatMap((row,index)=>{
    const validated=row.history_event_status==='valid',invalid=row.history_event_status==='invalid';
    const event=validated?row.history_event:null;
    const user=normalizeMessage({role:'user',content:row.question,turnId:event?.turnId});
    let assistant=normalizeMessage({role:'assistant',content:row.answer,route:row.routing_trace?.route,catalogStatus:row.routing_trace?.catalogStatus,intent:row.routing_trace?.intent,domain:row.routing_trace?.domain,responseType:row.routing_trace?.responseSource||row.source});
    if(event && assistant){
      // Reconstruct only the validated bounded event, never arbitrary runtime JSON.
      assistant=normalizeMessage({role:'assistant',content:row.answer,responseType:row.source,turnId:event.turnId,
        route:event.route,productTypeConstraint:event.productTypeConstraint,links:event.products,targetProductId:event.targetProductId,
        ...(event.kind==='empty'?{catalogStatus:'CATALOG_AVAILABLE_NO_MATCH'}:{})});
    }
    if(event && assistant){if(event.kind==='selection')assistant.historySelectionAuthority=true;if(event.kind==='empty')assistant.historySelectionSuperseded=true;}
    if(invalid && assistant){assistant=normalizeMessage({role:'assistant',content:row.answer,responseType:row.source});assistant.historyEventInvalid=true;}
    // Legacy rows stay on the existing merge path. A validated event or rejected
    // event is a known server turn; its position cannot be forged by browser data.
    if(validated||invalid)for(const item of [user,assistant].filter(Boolean))serverEvents.set(item,{index,turnId:event?.turnId||null,kind:event?.kind||'invalid'});
    return [user,assistant].filter(Boolean);
  });
}
function reconcileServerEvents(serverHistory, clientHistory, requireServerProvenance=false) {
  if(!serverHistory.some(row=>serverEvents.has(row))){
    if(!requireServerProvenance)return [...serverHistory,...clientHistory];
    // Legacy rows have no signed event envelope. Preserve their compatibility
    // only when one normalized browser row has one exact server transcript
    // counterpart; an unrelated server row must not bless browser metadata.
    const rawClient=(Array.isArray(clientHistory)?clientHistory:[]).map(normalizeMessage).filter(Boolean),semanticKey=item=>JSON.stringify([item.role,item.content,(item.links||[]).map(link=>link.id),item.targetProductId||null,item.route||null,item.intent||null,item.domain||null,item.productTypeConstraint||null,item.catalogStatus||null]),client=[...new Map(rawClient.map(item=>[semanticKey(item),item])).values()],matches=new Map(),matchedClient=new Set(),serverGroups=new Map(),clientGroups=new Map();
    serverHistory.forEach((row,index)=>{const key=row.role+'|'+row.content;if(!serverGroups.has(key))serverGroups.set(key,[]);serverGroups.get(key).push(index);});
    client.forEach(item=>{const key=item.role+'|'+item.content;if(!clientGroups.has(key))clientGroups.set(key,[]);clientGroups.get(key).push(item);});
    for(const [key,indexes] of serverGroups){const items=clientGroups.get(key)||[];if(items.length===indexes.length)indexes.forEach((index,offset)=>{matches.set(index,items[offset]);matchedClient.add(items[offset]);});}
    const prefix=client.filter(item=>!matchedClient.has(item)).map(item=>{item.historyEventUncorrelated=true;serverEvents.set(item,{kind:'unverified'});return item;});
    // Transcript correlation only identifies browser rows already represented
    // by legacy server prose. The server copy preserves continuity; browser
    // metadata is never copied onto a row accepted by semantic consumers.
    const correlated=serverHistory.map((row,index)=>{
      const browser=matches.get(index);
      return browser?.responseType?normalizeMessage({...row,responseType:browser.responseType}):row;
    });
    return [...prefix,...correlated];
  }
  const turns=new Map();
  for(const row of serverHistory){const meta=serverEvents.get(row);if(meta?.turnId){const key=meta.turnId+'|'+row.role;if(!turns.has(key))turns.set(key,[]);turns.get(key).push(row);}}
  const prefix=[];
  for(const raw of clientHistory){
    const item=normalizeMessage(raw);if(!item)continue;
    const matches=item.turnId?turns.get(item.turnId+'|'+item.role):null;
    const same=matches?.length===1 && matches[0].content===item.content?matches[0]:null;
    if(same){
      // Only optional presentation enrichment is interchangeable. Structured
      // selection/empty/none authority for this turn is owned by the server.
      if(!same.responseType && item.responseType)same.responseType=item.responseType;
      continue;
    }
    // Uncorrelated client metadata has no trustworthy recency. Retain its
    // transcript, but do not infer product authority outside the server window.
    item.historyEventUncorrelated=true;
    serverEvents.set(item,{kind:'unverified'});
    prefix.push(item);
  }
  return [...prefix,...serverHistory];
}
function mergeHistory(serverHistory=[],clientHistory=[],limit=MAX_HISTORY_MESSAGES,requireServerProvenance=false) {
  const out=[], seen=new Map();
  for (const raw of reconcileServerEvents(serverHistory,clientHistory,requireServerProvenance)) {
    const item=normalizeMessage(raw);
    if (!item) continue;
    // responseType describes the response; it does not change selection authority.
    const key=JSON.stringify([item.role,item.content,(item.links||[]).map(link=>link.id),item.targetProductId||null,item.route||null,item.intent||null,item.domain||null,item.productTypeConstraint||null,item.catalogStatus||null]);
    const identityKey = item.turnId ? item.turnId+'|'+key : key;
    if (seen.has(identityKey)) {
      const previous=out[seen.get(identityKey)];
      // Keep the newest supplied label, or retain the richer earlier metadata.
      if (!item.responseType && previous.responseType) item.responseType=previous.responseType;
      // Keep the latest occurrence in chronological position (including A/B/A).
      // Server prose without selection evidence has a different authority key.
      out[seen.get(identityKey)]=null;
    }
    seen.set(identityKey,out.length); out.push(item);
  }
  return out.filter(Boolean).slice(-Math.max(1,Math.min(Number(limit)||MAX_HISTORY_MESSAGES,MAX_HISTORY_MESSAGES)));
}
function renderedProductList(message){if(!message||message.historyEventInvalid||message.historyEventUncorrelated)return[];if(Array.isArray(message.links)&&message.links.length)return message.links.map(item=>canonicalByUnasId[String(item.id)]||String(item.id)).filter(Boolean);const evidence=resolvePersistedProductEvidence(message.content||'');if(evidence.status==='resolved'||evidence.orderedProductIds.length>1)return evidence.orderedProductIds;return[];}
function structuredStateBase(history=[]){const authoritativeHistory=history.flatMap(item=>item?.historyEventInvalid||item?.historyEventUncorrelated?[]:[item]),context=buildConversationContext(authoritativeHistory,normalize),last=[...authoritativeHistory].reverse(),lastUser=last.find(x=>x.role==='user'),lastAssistantIndex=[...authoritativeHistory].map((x,index)=>({x,index})).reverse().find(entry=>entry.x.role==='assistant')?.index,lastAssistant=lastAssistantIndex==null?null:authoritativeHistory[lastAssistantIndex],precedingUser=lastAssistantIndex==null?null:[...authoritativeHistory.slice(0,lastAssistantIndex)].reverse().find(x=>x.role==='user'),rendered=renderedProductList(lastAssistant),ordinal=rendered.length?rendered:context.lastRecommendedProducts||[],authoritativeTarget=lastAssistant?.targetProductId||null,assistantFocus=authoritativeTarget||lastAssistant?.focusedProduct||(rendered.length?rendered[0]:null),productContextStatus=authoritativeTarget?'resolved':context.productContextStatus==='ambiguous'?'ambiguous':ordinal.length>1&&context.productContextStatus!=='resolved'?'ambiguous':assistantFocus||context.lastFocusProduct?'resolved':context.productContextStatus||'unresolved',focusedProductId=assistantFocus||context.lastFocusProduct||null,purchaseProductId=productContextStatus==='resolved'&&!authoritativeTarget?focusedProductId:null,lastMentionedProduct=focusedProductId,activeProductIds=[...new Set([...(context.mentionedProducts||[]),...ordinal])],activeSkus=[...new Set(activeProductIds.map(id=>skuByProductId[id]||PRODUCTS[id]?.sku).filter(Boolean))],activeProblemDomains=[...new Set([context.lastProblemDomain].filter(Boolean))],guidedDiscovery=reconstructGuidedDiscovery(authoritativeHistory),lastAcne=[...authoritativeHistory].reverse().find(x=>x?.role==='assistant'&&x?.routing?.acneDecision),acneDecision=lastAcne?.routing?.acneDecision?{active:true,factors:{...lastAcne.routing.acneDecision.factors}}:null;return{activeProductIds,activeSkus,activeProblemDomains,lastRecommendedProducts:[...ordinal],lastOrdinalProductList:[...ordinal],selectedProductId:context.lastSelectedProduct||null,focusedProductId,purchaseProductId,productContextStatus,lastMentionedProduct,guidedDiscovery,acneDecision,lastUserIntent:lastUser?.intent||detectCustomerGoal(lastUser?.content||'').intent||null,lastAssistantIntent:lastAssistant?.intent||detectCustomerGoal(precedingUser?.content||'').intent||null,lastCommerceFocus:context.lastCommerceIntent||null};}
function latestIsolationBoundary(history=[]){return[...history].map((item,index)=>({item,index})).reverse().find(({item})=>!item?.historyEventInvalid&&!item?.historyEventUncorrelated&&item?.role==='assistant'&&(item.route==='safety'||item.intent==='medical_escalation'||item.route==='complaint'||item.routing?.semanticGuard?.ownershipClass==='complaint'||item.routing?.semanticGuard?.ownershipClass==='resolved_complaint'||item.routing?.semanticGuard?.enforcementApplied===true))||null;}
function historyAfterIsolationBoundary(history=[]){const boundary=latestIsolationBoundary(history);return boundary?history.slice(boundary.index+1):history;}
function structuredState(history=[]){return structuredStateBase(historyAfterIsolationBoundary(history));}
async function rehydrateSessionHistory({sessionId,clientHistory=[],loadRows,limit=10}={}){if(!validSessionId(sessionId)){const history=mergeHistory([],clientHistory,MAX_HISTORY_MESSAGES,true);return{history,state:structuredState(history),technicalFailure:false};}let rows=[];try{rows=await loadRows(sessionId,Math.max(1,Math.min(Number(limit)||10,10)));}catch{const history=mergeHistory([],clientHistory,MAX_HISTORY_MESSAGES,true);return{history,state:structuredState(history),technicalFailure:true};}const serverHistory=rowsToHistory(rows),history=mergeHistory(serverHistory,clientHistory,MAX_HISTORY_MESSAGES,true);return{history,state:structuredState(history),technicalFailure:false};}
module.exports={MAX_HISTORY_MESSAGES,validSessionId,normalizeMessage,rowsToHistory,mergeHistory,renderedProductList,latestIsolationBoundary,historyAfterIsolationBoundary,structuredState,rehydrateSessionHistory};
