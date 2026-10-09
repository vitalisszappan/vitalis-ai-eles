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
const sessionId = 'authoritative-conversation-focus-session';

function ask(question, history = [], state = structuredState(history)) {
  return createAnswer({ question, history, conversationState: state, knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });
}

function row(question, result, index) {
  return {
    id: crypto.randomUUID(), created_at: new Date(Date.UTC(2026, 9, 9, 18, 0, index)).toISOString(), session_id: sessionId,
    question, answer: result.answer, source: result.source, routing_trace: result.routing,
    history_event: buildConversationHistoryEvent(result, crypto.randomUUID())
  };
}

async function reload(rows) {
  return rehydrateSessionHistory({ sessionId, clientHistory: [], loadRows: async () => validateConversationHistoryRows(rows) });
}

(async () => {
  const rows = [];
  const soap = ask('Dermavital szappan');
  rows.push(row('Dermavital szappan', soap, 0));
  assert.equal(rows[0].history_event.kind, 'selection');
  assert.equal(rows[0].history_event.route, 'exact_product');
  let memory = await reload(rows);
  assert.equal(memory.state.focusedProductId, 'dermavital_szappan');
  assert.equal(memory.state.productContextStatus, 'resolved');

  const purpose = ask('Mire jó?', memory.history, memory.state);
  assert.equal(purpose.targetProductId, 'dermavital_szappan');
  rows.push(row('Mire jó?', purpose, 1));
  memory = await reload(rows);
  assert.equal(memory.state.focusedProductId, 'dermavital_szappan');

  const cream = ask('Inkább a Dermavital krém érdekel', memory.history, memory.state);
  rows.push(row('Inkább a Dermavital krém érdekel', cream, 2));
  memory = await reload(rows);
  assert.equal(memory.state.focusedProductId, 'dermavital_krem');
  assert.equal(ask('Mire jó?', memory.history, memory.state).targetProductId, 'dermavital_krem');

  const dry = ask('Mit ajánlasz száraz bőrre?', memory.history, memory.state);
  assert.equal(dry.targetProductId, 'shea_vajas_szappan');
  rows.push(row('Mit ajánlasz száraz bőrre?', dry, 3));
  memory = await reload(rows);
  assert.equal(memory.state.focusedProductId, 'shea_vajas_szappan');
  assert.deepEqual(memory.state.lastOrdinalProductList, ['shea_vajas_szappan']);

  const shipping = ask('És a szállítás?', memory.history, memory.state);
  rows.push(row('És a szállítás?', shipping, 4));
  memory = await reload(rows);
  assert.equal(memory.state.focusedProductId, 'shea_vajas_szappan');
  assert.equal(ask('És ezt hogy kell használni?', memory.history, memory.state).targetProductId, 'shea_vajas_szappan');

  const acneRows = [];
  const acne = ask('Zsíros pattanásos arcbőr');
  acneRows.push(row('Zsíros pattanásos arcbőr', acne, 5));
  let acneMemory = await reload(acneRows);
  assert.equal(acneMemory.state.focusedProductId, null);
  assert.equal(acneMemory.state.pendingClarification.domain, 'acne');
  const acneArea = ask('Az államon, elég zsíros.', acneMemory.history, acneMemory.state);
  acneRows.push(row('Az államon, elég zsíros.', acneArea, 6));
  acneMemory = await reload(acneRows);
  assert.equal(acneMemory.state.pendingClarification.factors.affectedArea, 'face');
  assert.equal(acneMemory.state.pendingClarification.factors.skinOiliness, 'oily');

  const scalp = ask('Viszkető fejbőrre mit ajánlasz?');
  const scalpMemory = await reload([row('Viszkető fejbőrre mit ajánlasz?', scalp, 7)]);
  assert.equal(scalpMemory.state.focusedProductId, 'dermavital_sampon');
  assert.deepEqual(scalpMemory.state.lastOrdinalProductList, ['dermavital_sampon', 'rozmaringos_samponszappan']);
  const second = ask('A másodikat választanám', scalpMemory.history, scalpMemory.state);
  const selectedMemory = await reload([
    row('Viszkető fejbőrre mit ajánlasz?', scalp, 7),
    row('A másodikat választanám', second, 8)
  ]);
  assert.equal(selectedMemory.state.focusedProductId, 'rozmaringos_samponszappan');
  assert.equal(ask('Mennyi az ára ennek?', selectedMemory.history, selectedMemory.state).targetProductId, 'rozmaringos_samponszappan');
  const ambiguous = ask('A másikat', scalpMemory.history, {
    ...scalpMemory.state, focusedProductId: null, selectedProductId: null, productContextStatus: 'ambiguous',
    lastRecommendedProducts: ['dermavital_sampon', 'rozmaringos_samponszappan', 'dermavital_krem'],
    lastOrdinalProductList: ['dermavital_sampon', 'rozmaringos_samponszappan', 'dermavital_krem']
  });
  assert.equal(ambiguous.route, 'clarification');

  console.log('AUTHORITATIVE_CONVERSATION_FOCUS_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
