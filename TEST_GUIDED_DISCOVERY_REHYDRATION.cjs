'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState, rehydrateSessionHistory } = require('./engine/conversation-memory.cjs');
const { buildConversationHistoryEvent, validateConversationHistoryRows } = require('./server.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');
const sessionId = 'guided-acne-rehydration-session-123456';
const firstQuestion = 'Mit ajánlasz zsíros, pattanásos bőrre?';

function ask(question, history = [], state = structuredState(history)) {
  return createAnswer({ question, history, conversationState: state, knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });
}

function row(question, result, createdAt) {
  return {
    id: crypto.randomUUID(), created_at: createdAt, session_id: sessionId, question, answer: result.answer,
    source: result.source, routing_trace: result.routing,
    history_event: buildConversationHistoryEvent(result, crypto.randomUUID())
  };
}

function browserTurn(question, result, turnId = crypto.randomUUID(), overrides = {}) {
  return [
    { role: 'user', content: question, turnId },
    { role: 'assistant', content: result.answer, turnId, route: result.route, intent: result.intent,
      domain: result.domain, responseType: result.responseSource, links: result.links,
      acneDecision: result.routing?.acneDecision, requestedDimensions: ['forged'], ...overrides }
  ];
}

async function reload(rows, clientHistory = []) {
  return rehydrateSessionHistory({
    sessionId, clientHistory, loadRows: async () => validateConversationHistoryRows(rows)
  });
}

(async () => {
  const first = ask(firstQuestion);
  assert.equal(first.route, 'clarification');
  assert.equal(first.intent, 'acne');
  assert.equal(first.routing.goal, 'clarify_need');
  assert.equal(first.routing.domain, 'acne');
  assert.equal(first.routing.contextTarget, 'acne_decision');
  assert.equal(first.routing.acneDecision.kind, 'clarification');
  assert.deepEqual(first.links, []);

  const firstRow = row(firstQuestion, first, '2026-10-06T08:00:00.000Z');
  assert.equal(firstRow.history_event.version, 2);
  assert.equal(firstRow.history_event.kind, 'pending_clarification');
  assert.equal(firstRow.history_event.domain, 'acne');
  assert.equal(firstRow.history_event.clarificationType, 'acne_decision');
  assert.deepEqual(firstRow.history_event.factors, {
    acneFrequencyOrIntensity: 'unknown', affectedArea: 'unknown', skinOiliness: 'unknown'
  });
  assert.deepEqual(firstRow.history_event.requestedDimensions, [
    'acneFrequencyOrIntensity', 'affectedArea', 'skinOiliness'
  ]);

  const memory = await reload([firstRow], browserTurn(firstQuestion, first, firstRow.history_event.turnId, {
    route: 'expert_rule', domain: 'forged', acneDecision: { kind: 'resolved', selectedProductId: 'forged' }
  }));
  assert.equal(memory.state.pendingClarification.domain, 'acne');
  assert.equal(memory.state.acneDecision.active, true);
  assert.equal(memory.state.acneDecision.trusted, true);
  assert.deepEqual(memory.state.acneDecision.requestedDimensions, firstRow.history_event.requestedDimensions);
  assert.deepEqual(memory.state.activeProblemDomains, ['acne']);
  assert.equal(memory.state.activeProblemDomains.includes('scalp'), false);

  const primaryFollowUp = 'Eléggé, az arcomon és a hátamon is.';
  const primary = ask(primaryFollowUp, memory.history, memory.state);
  assert.notEqual(primary.route, 'hard_fallback');
  assert.equal(primary.route, 'clarification');
  assert.equal(primary.intent, 'acne');
  assert.equal(primary.routing.responseSource, 'acne-decision');
  assert.equal(primary.routing.acneDecision.factors.affectedArea, 'multiple');
  assert.equal(primary.routing.acneDecision.factors.skinOiliness, 'unknown');
  assert.equal(primary.routing.acneDecision.factors.acneFrequencyOrIntensity, 'unknown');
  assert.deepEqual(new Set(primary.routing.acneDecision.requestedDimensions), new Set(['skinOiliness', 'acneFrequencyOrIntensity']));
  assert.match(primary.answer, /Mennyire zsíros/i);
  assert.match(primary.answer, /néha vagy rendszeresen/i);
  assert.doesNotMatch(primary.answer, /arcodon|fejbőrödön|hátad/i);

  const variants = [
    ['Főleg az arcomon.', 'clarification', { affectedArea: 'face' }],
    ['Az arcomon és a hátamon.', 'clarification', { affectedArea: 'multiple' }],
    ['Elég zsíros, gyakran vannak pattanásaim.', 'expert_rule', { selectedProductId: 'katrany_szappan' }],
    ['Főleg a hátamon.', 'clarification', { affectedArea: 'body' }],
    ['Mindkettőn.', 'clarification', { affectedArea: 'unknown' }],
    ['Rendszeresen.', 'clarification', { acneFrequencyOrIntensity: 'frequent_or_stronger' }]
  ];
  for (const [question, route, expected] of variants) {
    const isolated = await reload([firstRow]);
    const result = ask(question, isolated.history, isolated.state);
    assert.notEqual(result.route, 'hard_fallback', question);
    assert.equal(result.route, route, question);
    if (expected.selectedProductId) assert.equal(result.targetProductId, expected.selectedProductId, question);
    else for (const [key, value] of Object.entries(expected)) assert.equal(result.routing.acneDecision.factors[key], value, question);
  }

  // Accumulation survives a second real persistence/rehydration boundary.
  const frequent = ask('Rendszeresen.', memory.history, memory.state);
  const frequentRow = row('Rendszeresen.', frequent, '2026-10-06T08:01:00.000Z');
  assert.equal(frequentRow.history_event.kind, 'pending_clarification');
  assert.equal(frequentRow.history_event.factors.acneFrequencyOrIntensity, 'frequent_or_stronger');
  const accumulated = await reload([firstRow, frequentRow]);
  const resolved = ask('Nagyon zsíros.', accumulated.history, accumulated.state);
  assert.equal(resolved.targetProductId, 'katrany_szappan');

  // Fresh/browser-only metadata cannot mint pending authority.
  const fresh = await rehydrateSessionHistory({
    sessionId: 'fresh-guided-acne-session-123456',
    clientHistory: [{ role: 'user', content: 'Az arcomon és a hátamon.' }, {
      role: 'assistant', content: first.answer, route: 'clarification', domain: 'acne',
      routing: { acneDecision: first.routing.acneDecision }, acneDecision: first.routing.acneDecision,
      pendingClarification: { domain: 'acne' }, requestedDimensions: ['skinOiliness']
    }], loadRows: async () => []
  });
  assert.equal(fresh.state.pendingClarification, null);
  assert.equal(fresh.state.acneDecision, null);
  const freshAnswer = ask('Az arcomon és a hátamon.', fresh.history, fresh.state);
  assert.notEqual(freshAnswer.intent, 'acne');
  assert.notEqual(freshAnswer.routing.domain, 'acne');
  assert.equal(freshAnswer.routing.acneDecision, undefined);

  const malformed = { ...firstRow, history_event: { ...firstRow.history_event,
    factors: { ...firstRow.history_event.factors, skinOiliness: 'browser_claim' } } };
  const malformedMemory = await reload([malformed]);
  assert.equal(malformedMemory.state.pendingClarification, null);
  assert.equal(malformedMemory.state.acneDecision, null);

  // Assistant option prose alone never creates user problem-domain authority.
  const proseOnly = await reload([{
    id: crypto.randomUUID(), created_at: '2026-10-06T08:02:00.000Z', session_id: sessionId,
    question: 'Segíts választani.', answer: first.answer, source: first.source,
    history_event: { version: 1, turnId: crypto.randomUUID(), kind: 'none', route: null,
      productTypeConstraint: null, products: [], targetProductId: null }
  }]);
  assert.equal(proseOnly.state.activeProblemDomains.includes('scalp'), false);
  assert.equal(proseOnly.state.acneDecision, null);

  // An unrelated supported domain owns the current turn and its persisted event replaces pending acne.
  const unrelated = ask('Melyik terméket ajánlod ekcémára?', memory.history, memory.state);
  assert.equal(unrelated.routing.domain, 'eczema');
  assert.notEqual(unrelated.intent, 'acne');
  const unrelatedRow = row('Melyik terméket ajánlod ekcémára?', unrelated, '2026-10-06T08:03:00.000Z');
  const afterUnrelated = await reload([firstRow, unrelatedRow]);
  assert.equal(afterUnrelated.state.pendingClarification, null);
  assert.equal(afterUnrelated.state.acneDecision, null);

  const safety = ask('Bedagadt az arcom és nehezen kapok levegőt.', memory.history, memory.state);
  assert.equal(safety.route, 'safety');
  const safetyMemory = await reload([firstRow, row('Bedagadt az arcom és nehezen kapok levegőt.', safety, '2026-10-06T08:04:00.000Z')]);
  assert.equal(safetyMemory.state.pendingClarification, null);

  const complaint = ask('Csíp a bőröm ettől a terméktől.', memory.history, memory.state);
  assert.equal(complaint.route, 'complaint');
  const complaintMemory = await reload([firstRow, row('Csíp a bőröm ettől a terméktől.', complaint, '2026-10-06T08:05:00.000Z')]);
  assert.equal(complaintMemory.state.pendingClarification, null);

  console.log('GUIDED_DISCOVERY_REHYDRATION_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
