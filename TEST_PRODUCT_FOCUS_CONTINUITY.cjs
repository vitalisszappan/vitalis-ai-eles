'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { rehydrateSessionHistory, structuredState } = require('./engine/conversation-memory.cjs');
const { buildConversationHistoryEvent, validateConversationHistoryRows } = require('./server.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');

function ask(question, history = [], state = structuredState(history)) {
  return createAnswer({ question, history, conversationState: state, knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });
}

function row(sessionId, question, result, index) {
  return {
    id: crypto.randomUUID(), created_at: new Date(Date.UTC(2026, 9, 9, 22, 0, index)).toISOString(), session_id: sessionId,
    question, answer: result.answer, source: result.source, routing_trace: result.routing,
    history_event: buildConversationHistoryEvent(result, crypto.randomUUID())
  };
}

async function runConversation(name, productId, questions) {
  const sessionId = `product-focus-continuity-${name}`;
  const rows = [];
  const results = [];
  for (let index = 0; index < questions.length; index += 1) {
    const memory = await rehydrateSessionHistory({
      sessionId, clientHistory: [], loadRows: async () => validateConversationHistoryRows(rows)
    });
    const result = ask(questions[index], memory.history, memory.state);
    results.push(result);
    rows.push(row(sessionId, questions[index], result, index));
    if (index > 0) assert.equal(result.targetProductId, productId, `${name}: ${questions[index]}`);
  }
  const finalMemory = await rehydrateSessionHistory({
    sessionId, clientHistory: [], loadRows: async () => validateConversationHistoryRows(rows)
  });
  assert.equal(finalMemory.state.focusedProductId, productId, name);
  return results;
}

(async () => {
  await runConversation('salt', 'holt_tengeri_so_balzsam', [
    'Holt tengeri sóbalzsam', 'Mire jó?', 'Hogy használjam?', 'Mennyibe kerül?'
  ]);
  await runConversation('shampoo', 'dermavital_sampon', [
    'Dermavital sampon', 'Mire jó?', 'Hogyan használjam?', 'mennyi az ára?'
  ]);

  const switchSession = 'product-focus-continuity-switch';
  const switchRows = [];
  for (const [index, question] of ['Holt tengeri sóbalzsam', 'Dermavital sampon'].entries()) {
    const memory = await rehydrateSessionHistory({ sessionId: switchSession, clientHistory: [], loadRows: async () => validateConversationHistoryRows(switchRows) });
    const result = ask(question, memory.history, memory.state);
    switchRows.push(row(switchSession, question, result, index));
  }
  const switchedMemory = await rehydrateSessionHistory({ sessionId: switchSession, clientHistory: [], loadRows: async () => validateConversationHistoryRows(switchRows) });
  assert.equal(switchedMemory.state.focusedProductId, 'dermavital_sampon');
  const switchedPurpose = ask('Mire jó?', switchedMemory.history, switchedMemory.state);
  assert.equal(switchedPurpose.targetProductId, 'dermavital_sampon');
  assert.doesNotMatch(switchedPurpose.answer, /száraz, hámló és problémás bőr/i);

  await runConversation('shea', 'shea_vajas_szappan', [
    'Shea vajas szappan', 'Mire való?', 'Hogyan használjam?', 'Ez mennyi?'
  ]);
  await runConversation('cream', 'dermavital_krem', [
    'Dermavital krém', 'Mit csinál?', 'Hogy kenjem?', 'Hány forint?'
  ]);

  console.log('PRODUCT_FOCUS_CONTINUITY_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
