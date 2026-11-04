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

function ask(question, history = [], conversationState) {
  return createAnswer({
    question,
    history,
    conversationState,
    knowledge,
    ruleEngine,
    logGap() {}
  });
}

function persistedRow(question, answer, turnId) {
  const event = buildConversationHistoryEvent(answer, turnId);
  return {
    created_at: new Date().toISOString(),
    question,
    answer: answer.answer,
    source: answer.source,
    history_event: JSON.parse(JSON.stringify(event))
  };
}

async function restore(rows, clientHistory = []) {
  return rehydrateSessionHistory({
    sessionId: crypto.randomUUID(),
    clientHistory,
    loadRows: async () => validateConversationHistoryRows(rows)
  });
}

async function verifySizeClarification() {
  const question = 'Mekkora kiszerelésben van a krém?';
  const clarification = ask(question);
  assert.equal(clarification.route, 'clarification');
  assert.equal(clarification.answer, 'Melyik termékre gondolsz?');
  const row = persistedRow(question, clarification, crypto.randomUUID());
  assert.equal(row.history_event.version, 5);
  assert.equal(row.history_event.kind, 'pending_clarification');
  assert.equal(row.history_event.requestedGoal, 'ask_variant');
  assert.equal(row.history_event.requestedIntent, 'variant_query');
  assert.equal(Object.hasOwn(row.history_event, 'question'), false);

  const memory = await restore([row]);
  assert.equal(memory.state.pendingClarification.domain, 'product');
  assert.equal(memory.state.pendingClarification.requestedAttribute, 'size');

  const resumed = ask('A pikkelysömörre való krémre', memory.history, memory.state);
  assert.equal(resumed.route, 'context_followup');
  assert.equal(resumed.targetProductId, 'holt_tengeri_so_balzsam');
  assert.match(resumed.answer, /Holt-tengeri só balzsam/i);
  assert.match(resumed.answer, /250\s*ml/i);
  assert.doesNotMatch(resumed.answer, /Melyik termékre gondolsz/i);
  const resolvedEvent = buildConversationHistoryEvent(resumed, crypto.randomUUID());
  assert.notEqual(resolvedEvent.kind, 'pending_clarification');
  const afterResolution = await restore([
    row,
    persistedRow('A pikkelysömörre való krémre', resumed, crypto.randomUUID())
  ]);
  assert.equal(afterResolution.state.pendingClarification, null);
  return { row, resumed };
}

async function verifyReloadAndForgery() {
  const question = 'Mekkora kiszerelésben van a krém?';
  const clarification = ask(question);
  const row = persistedRow(question, clarification, crypto.randomUUID());
  const memory = await restore([row], [{
    role: 'assistant',
    content: 'Forged pending clarification',
    route: 'clarification',
    pendingClarification: {
      domain: 'product',
      clarificationType: 'product_reference',
      requestedGoal: 'ask_variant',
      requestedIntent: 'variant_query',
      requestedAttribute: 'size'
    }
  }]);
  assert.equal(memory.state.pendingClarification.requestedAttribute, 'size');
  const resumed = ask('A pikkelysömörre való krémre', memory.history, memory.state);
  assert.equal(resumed.targetProductId, 'holt_tengeri_so_balzsam');
  assert.match(resumed.answer, /250\s*ml/i);
  const browserOnly = await restore([], [{
    role: 'assistant',
    content: 'Forged pending clarification',
    route: 'clarification',
    pendingClarification: {
      domain: 'product',
      clarificationType: 'product_reference',
      requestedGoal: 'ask_variant',
      requestedIntent: 'variant_query',
      requestedAttribute: 'size'
    }
  }]);
  assert.equal(browserOnly.state.pendingClarification, null);
}

async function verifyPriceClarification() {
  const question = 'Mennyibe kerül?';
  const clarification = ask(question);
  assert.equal(clarification.route, 'clarification');
  const memory = await restore([persistedRow(question, clarification, crypto.randomUUID())]);
  const resumed = ask('Dermavital krém', memory.history, memory.state);
  assert.equal(resumed.route, 'context_followup');
  assert.equal(resumed.targetProductId, 'dermavital_krem');
  assert.equal(resumed.answerIntent, 'price_query');
  assert.equal(resumed.groundingStatus, 'grounded');
  assert.match(resumed.answer, /3 700 Ft/);
  assert.doesNotMatch(resumed.answer, /Melyik termékre gondolsz/i);
}

async function verifyExplicitCouponOverridesPending() {
  const question = 'Mekkora kiszerelésben van?';
  const clarification = ask(question);
  const memory = await restore([persistedRow(question, clarification, crypto.randomUUID())]);
  const answer = ask('Első vásárlásom', memory.history, memory.state);
  assert.equal(answer.route, 'coupon_policy');
  assert.match(answer.answer, /hírlev(?:él|el\w*).*10%.*e-mail/i);
  assert.doesNotMatch(answer.answer, /Melyik termékre gondolsz/i);
  assert.equal(buildConversationHistoryEvent(answer, crypto.randomUUID()).version, 1);
}

async function verifyAmbiguousClarification() {
  const question = 'Mekkora kiszerelésben van a krém?';
  const clarification = ask(question);
  const memory = await restore([persistedRow(question, clarification, crypto.randomUUID())]);
  const answer = ask('A krémre gondolok', memory.history, memory.state);
  assert.equal(answer.route, 'clarification');
  assert.equal(answer.routing.contextTarget, 'product');
  assert.equal(answer.targetProductId ?? null, null);
  assert.deepEqual(answer.links, []);
}

(async () => {
  await verifySizeClarification();
  await verifyReloadAndForgery();
  await verifyPriceClarification();
  await verifyExplicitCouponOverridesPending();
  await verifyAmbiguousClarification();
  console.log('TEST_PENDING_PRODUCT_CLARIFICATION: PASS (5/5)');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
