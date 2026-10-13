'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { rehydrateSessionHistory } = require('./engine/conversation-memory.cjs');
const { buildConversationHistoryEvent, validateConversationHistoryRows } = require('./server.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');

function row(sessionId, question, result, index) {
  return {
    id: crypto.randomUUID(), created_at: new Date(Date.UTC(2026, 9, 13, 14, 0, index)).toISOString(), session_id: sessionId,
    question, answer: result.answer, source: result.source, routing_trace: result.routing,
    history_event: buildConversationHistoryEvent(result, crypto.randomUUID())
  };
}

async function conversation(questions) {
  const sessionId = crypto.randomUUID();
  const rows = [];
  const results = [];
  for (const [index, question] of questions.entries()) {
    const memory = await rehydrateSessionHistory({ sessionId, clientHistory: [], loadRows: async () => validateConversationHistoryRows(rows) });
    const result = createAnswer({ question, history: memory.history, conversationState: memory.state, knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });
    results.push(result);
    rows.push(row(sessionId, question, result, index));
  }
  return results;
}

function groundedChoice(result, chosenId, alternativeId) {
  assert.equal(result.route, 'recommendation_alternative');
  assert.equal(result.intent, 'recommendation_choice');
  assert.equal(result.targetProductId, chosenId);
  assert.deepEqual(result.links.map((link) => link.id), [chosenId, alternativeId]);
  assert.equal(result.groundingStatus, 'grounded');
  assert.ok(result.factsUsed.filter((fact) => fact.factType === 'productBenefits').every((fact) => fact.status === 'grounded'));
  assert.doesNotMatch(result.answer, /nincs elég biztos|gyógyít|kezel/i);
}

(async () => {
  const eczema = await conversation(['Ekcémás, nagyon száraz a bőröm. Mit ajánlasz?', 'Van másik?', 'Melyiket választanád?']);
  groundedChoice(eczema[2], 'dermavital_krem', 'dermavital_szappan');
  assert.match(eczema[2].answer, /Dermavital krémet.*száraz.*ekcémára hajlamos.*Dermavital szappan.*tisztálkodás/i);

  const scalp = await conversation(['Pikkelysömörös a fejbőröm.', 'Van másik?', 'Melyiket ajánlod inkább?']);
  groundedChoice(scalp[2], 'dermavital_sampon', 'rozmaringos_samponszappan');
  assert.match(scalp[2].answer, /Dermavital sampont.*fejbőr.*Rozmaringos samponszappan.*kiegészítő/i);

  const problemSkin = await conversation(['Mit ajánlasz pikkelysömörre?', 'Van másik?', 'A kettő közül melyik lenne jobb?']);
  groundedChoice(problemSkin[2], 'psorivital_csomag', 'dermavital_szappan');
  assert.match(problemSkin[2].answer, /PsoriVital csomagot.*száraz.*hámló.*Dermavital szappan.*tisztálkodás/i);

  const priceAware = await conversation(['Ekcémás, nagyon száraz a bőröm. Mit ajánlasz?', 'Van másik?', 'Melyik jobb és olcsóbb?']);
  groundedChoice(priceAware[2], 'dermavital_krem', 'dermavital_szappan');
  assert.match(priceAware[2].answer, /3 700 Ft.*2 700 Ft.*olcsóbb.*Dermavital szappan/i);
  assert.equal(priceAware[2].factsUsed.filter((fact) => fact.factType === 'price').length, 2);

  for (const variant of ['Melyiket választanád?', 'Melyik jobb nekem?', 'A kettő közül melyiket?', 'Te melyiket vennéd?', 'Melyiket ajánlod inkább?']) {
    const results = await conversation(['Mit ajánlasz ekcémára?', 'Van másik?', variant]);
    groundedChoice(results[2], 'dermavital_krem', 'dermavital_szappan');
  }

  const standalone = await conversation(['Dermavital sampon', 'Melyiket választanád?']);
  assert.equal(standalone[1].route, 'clarification');
  assert.match(standalone[1].answer, /Melyik másik termékkel/i);

  const single = await conversation(['Hajhullásra mit ajánlasz?', 'Melyiket választanád?']);
  assert.equal(single[1].route, 'clarification');
  assert.match(single[1].answer, /Melyik másik termékkel/i);
  assert.equal(single[1].links.length, 0);

  console.log('RECOMMENDATION_CHOICE_ADVICE_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
