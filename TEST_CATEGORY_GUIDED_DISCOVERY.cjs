'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState, rehydrateSessionHistory } = require('./engine/conversation-memory.cjs');
const { buildConversationHistoryEvent, validateConversationHistoryRows } = require('./server.cjs');

const knowledge = JSON.parse(fs.readFileSync('./data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('./data/rules/expert-rules.json');
const ask = (question, history = []) => createAnswer({ question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });
const turn = (history, question) => { const result=ask(question,history); return {result,history:[...history,{role:'user',content:question},{role:'assistant',content:result.answer,...result}]}; };

for (const query of ['szappan','szappant keresek','valami szappan','samponotok van?','krémet szeretnék','ajakápoló']) {
  const result=ask(query);
  assert.equal(result.route,'clarification',query);
  assert.deepEqual(result.links,[],query);
  assert.equal(result.routing.contextTarget,'guided_discovery',query);
}

for (const [first,second,productPattern] of [
  ['szappan','száraz és érzékeny',/szappan/i],
  ['szappan','zsíros, pattanásos',/szappan/i],
  ['sampon','viszket és korpás',/sampon/i],
  ['krém','nagyon száraz bőrre',/krém|balzsam/i],
  ['ajakbalzsam','inkább semlegeset szeretnék',/ajakbalzsam|ajakápoló/i]
]) {
  let run=turn([],first);
  run=turn(run.history,second);
  assert.notEqual(run.result.route,'clarification',`${first} -> ${second}`);
  assert.ok(run.result.links.length,`${first} -> ${second}`);
  assert.ok(run.result.links.every(link=>productPattern.test(link.name)),`${first} -> ${second}`);
  if(first==='szappan'&&/száraz/.test(second)){
    assert.ok(run.result.links.every(link=>!/aktív szenes|zsíros bőrre/i.test(link.name)));
    assert.match(run.result.answer,/érzékeny.*száraz|száraz.*érzékeny/i);
    assert.equal(run.result.routing.productQuestionIntent,'recommendation');
    assert.equal(run.result.routing.productTypeConstraint,'szappan');
  }
  if(first==='szappan'&&/zsíros/.test(second)){
    assert.ok(run.result.links.every(link=>/aktív szenes|kátrány/i.test(link.name)));
    assert.ok(run.result.links.every(link=>!/natúr kecsketejes/i.test(link.name)));
  }
  if(first==='sampon')assert.ok(run.result.links.some(link=>/Dermavital sampon/i.test(link.name)));
  if(first==='ajakbalzsam')assert.ok(run.result.links.every(link=>/Natúr|Illatmentes/i.test(link.name)));
}

const direct=ask('szappant keresek száraz érzékeny bőrre');
assert.notEqual(direct.route,'clarification');
assert.ok(direct.links.length);
const absent=ask('illóolaj');
assert.equal(absent.source,'catalog-absent');
assert.deepEqual(absent.links,[]);
const freshMore=ask('ennyi?');
assert.equal(freshMore.route,'clarification');
assert.notEqual(freshMore.source,'catalog-absent');
const freshScent=ask('illat');
assert.notEqual(freshScent.routing.guidedDiscovery?.productType?.value,'szappan');
const freshUnscented=ask('illatmentes');
assert.notEqual(freshUnscented.routing.guidedDiscovery?.productType?.value,'szappan');

for(const [preference,pattern] of [['levendulás',/levendul/i],['levendula',/levendul/i],
  ['illatmentes',/illatmentes|natúr/i],['inkább illatmentes',/illatmentes|natúr/i],['natúr',/illatmentes|natúr/i]]){
  let scentRun=turn([],'szappan');
  scentRun=turn(scentRun.history,'illat');
  assert.equal(scentRun.result.route,'clarification',preference);
  assert.equal(scentRun.result.routing.guidedDiscovery.preferenceAxis.value,'scent',preference);
  assert.match(scentRun.result.answer,/friss\/citrusos.*illatmentes/i,preference);
  assert.deepEqual(scentRun.result.links,[],preference);
  scentRun=turn(scentRun.history,preference);
  assert.equal(scentRun.result.routing.domain,'soap',preference);
  assert.ok(scentRun.result.links.length,preference);
  assert.ok(scentRun.result.links.every(link=>pattern.test(link.name)),`${preference}: ${scentRun.result.links.map(link=>link.name).join(' | ')}`);
}

let soapContext=turn([],'szappan');
for(const followUp of ['ennyi?','csak ennyi?','más nincs?','van még?','milyen van még?']){
  const result=ask(followUp,soapContext.history);
  assert.equal(result.route,'clarification',followUp);
  assert.equal(result.routing.domain,'soap',followUp);
  assert.notEqual(result.source,'catalog-absent',followUp);
  assert.match(result.answer,/többféle szappanunk/i,followUp);
  assert.deepEqual(result.links,[],followUp);
}
let moreSoap=turn(soapContext.history,'mutass még');
assert.equal(moreSoap.result.route,'product_category');
assert.ok(moreSoap.result.links.length);
assert.ok(moreSoap.result.links.every(link=>/szappan/i.test(link.name)));
const firstShown=new Set(moreSoap.result.links.map(link=>link.id));
moreSoap=turn(moreSoap.history,'mutass még');
assert.ok(moreSoap.result.links.every(link=>!firstShown.has(link.id)));

(async()=>{
  const scentSession='category-scent-discovery-session-123456';
  const scentFirst=ask('szappan');
  const scentFirstRow={id:crypto.randomUUID(),created_at:'2026-10-20T07:59:00.000Z',session_id:scentSession,
    question:'szappan',answer:scentFirst.answer,source:scentFirst.source,routing_trace:scentFirst.routing,
    history_event:buildConversationHistoryEvent(scentFirst,crypto.randomUUID())};
  const scentFirstMemory=await rehydrateSessionHistory({sessionId:scentSession,
    loadRows:async()=>validateConversationHistoryRows([scentFirstRow])});
  const axis=ask('illat',scentFirstMemory.history,scentFirstMemory.state);
  assert.equal(axis.route,'clarification');
  assert.equal(axis.routing.guidedDiscovery.preferenceAxis.value,'scent');
  const axisRow={id:crypto.randomUUID(),created_at:'2026-10-20T07:59:01.000Z',session_id:scentSession,
    question:'illat',answer:axis.answer,source:axis.source,routing_trace:axis.routing,
    history_event:buildConversationHistoryEvent(axis,crypto.randomUUID())};
  assert.equal(axisRow.history_event.version,4);
  assert.equal(axisRow.history_event.selectedAxis,'scent');
  const scentMemory=await rehydrateSessionHistory({sessionId:scentSession,
    loadRows:async()=>validateConversationHistoryRows([scentFirstRow,axisRow])});
  assert.equal(scentMemory.state.guidedDiscovery.productType.value,'szappan');
  assert.equal(scentMemory.state.guidedDiscovery.preferenceAxis.value,'scent');
  for(const [preference,pattern] of [['illatmentes',/illatmentes|natúr/i],['inkább illatmentes',/illatmentes|natúr/i],
    ['levendulás',/levendul/i],['levendula',/levendul/i]]){
    const result=ask(preference,scentMemory.history,scentMemory.state);
    assert.equal(result.routing.domain,'soap',preference);
    assert.equal(result.routing.guidedDiscovery.preferenceAxis.value,'scent',preference);
    assert.ok(result.links.length,preference);
    assert.ok(result.links.every(link=>pattern.test(link.name)),preference);
  }

  for(const [category,preference,pattern] of [
    ['szappan','száraz és érzékeny',/szappan/i],
    ['sampon','viszket és korpás',/sampon/i]
  ]){
    const first=ask(category);
    const turnId=crypto.randomUUID();
    const rows=validateConversationHistoryRows([{
      id:crypto.randomUUID(),created_at:'2026-10-20T08:00:00.000Z',session_id:'category-guided-discovery-session-123456',
      question:category,answer:first.answer,source:first.source,routing_trace:first.routing,
      history_event:buildConversationHistoryEvent(first,turnId)
    }]);
    assert.equal(rows[0].history_event.version,3,category);
    assert.equal(rows[0].history_event.productType,first.routing.guidedDiscovery.productType.value,category);
    const memory=await rehydrateSessionHistory({
      sessionId:'category-guided-discovery-session-123456',loadRows:async()=>rows
    });
    assert.equal(memory.state.guidedDiscovery.productType.value,first.routing.guidedDiscovery.productType.value,category);
    const persistedMore=ask('ennyi?',memory.history,memory.state);
    assert.equal(persistedMore.route,'clarification',`${category} persisted category follow-up`);
    assert.equal(persistedMore.routing.domain,category==='szappan'?'soap':'shampoo',`${category} persisted category follow-up`);
    assert.notEqual(persistedMore.source,'catalog-absent',`${category} persisted category follow-up`);
    const second=ask(preference,memory.history,memory.state);
    assert.notEqual(second.route,'clarification',`${category} persisted follow-up`);
    assert.ok(second.links.length,`${category} persisted follow-up`);
    assert.ok(second.links.every(link=>pattern.test(link.name)),`${category} persisted follow-up`);
    if(category==='szappan'){
      assert.ok(second.links.every(link=>!/aktív szenes|zsíros bőrre/i.test(link.name)));
      assert.match(second.answer,/érzékeny.*száraz|száraz.*érzékeny/i);
      assert.equal(second.routing.productQuestionIntent,'recommendation');
      assert.equal(second.routing.productTypeConstraint,'szappan');
    }
  }
  console.log('CATEGORY_GUIDED_DISCOVERY_OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
