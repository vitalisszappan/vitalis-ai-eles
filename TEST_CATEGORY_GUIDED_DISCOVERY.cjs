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
  }
  console.log('CATEGORY_GUIDED_DISCOVERY_OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
