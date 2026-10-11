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
    id: crypto.randomUUID(), created_at: new Date(Date.UTC(2026, 9, 11, 18, 0, index)).toISOString(), session_id: sessionId,
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

(async () => {
  const cases = [
    {
      questions: ['Zsíros pattanásos az arcbőröm.', 'Főleg homlokon és állon, elég zsíros.', 'Rendszeresen, szinte minden nap.', 'Van másik?'],
      primary: 'katrany_szappan', alternative: null
    },
    { questions: ['Mit ajánlasz ekcémára?', 'Mutass másikat.'], primary: 'dermavital_krem', alternative: 'dermavital_szappan' },
    { questions: ['Pikkelysömörös a fejbőröm.', 'Van másik lehetőség?'], primary: 'dermavital_sampon', alternative: 'rozmaringos_samponszappan' },
    { questions: ['Mit ajánlasz pikkelysömörre?', 'Van másik?'], primary: 'psorivital_csomag', alternative: 'dermavital_szappan' }
  ];

  for (const item of cases) {
    const results = await conversation(item.questions);
    const recommendation = results.at(-2);
    const alternative = results.at(-1);
    assert.ok(recommendation.links.some((link) => link.id === item.primary), item.questions[0]);
    assert.equal(alternative.route, 'recommendation_alternative', item.questions.at(-1));
    assert.ok(!alternative.links.some((link) => link.id === item.primary), item.questions.at(-1));
    assert.deepEqual(alternative.links.map((link) => link.id), item.alternative ? [item.alternative] : [], item.questions.at(-1));
    if (!item.alternative) assert.doesNotMatch(alternative.answer, /Melyik termékre gondolsz/i);
  }

  const cheaper = await conversation(['Mit ajánlasz pikkelysömörre?', 'Olcsóbb is van?']);
  assert.equal(cheaper[1].route, 'recommendation_alternative');
  assert.equal(cheaper[1].links[0]?.id, 'tengeri_soszappan');
  assert.match(cheaper[1].answer, /1 990 Ft/);

  const explicit = await conversation(['Dermavital sampon', 'Van másik?']);
  assert.notEqual(explicit[1].route, 'recommendation_alternative');
  assert.equal(explicit[1].route, 'clarification');

  console.log('RECOMMENDATION_ALTERNATIVES_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
