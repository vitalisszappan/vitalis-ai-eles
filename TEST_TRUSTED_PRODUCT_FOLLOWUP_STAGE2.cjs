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
const sessionId = 'trusted-product-followup-stage2-session';

function ask(question, history = [], state = structuredState(history)) {
  return createAnswer({ question, history, conversationState: state, knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });
}

function row(question, result, createdAt) {
  return {
    id: crypto.randomUUID(), created_at: createdAt, session_id: sessionId,
    question, answer: result.answer, source: result.source, routing_trace: result.routing,
    history_event: buildConversationHistoryEvent(result, crypto.randomUUID())
  };
}

async function reload(rows, clientHistory = []) {
  return rehydrateSessionHistory({
    sessionId, clientHistory,
    loadRows: async () => validateConversationHistoryRows(rows)
  });
}

(async () => {
  const saltQuestion = 'Holt tengeri sóbalzsam';
  const salt = ask(saltQuestion);
  assert.equal(salt.route, 'exact_product');
  assert.deepEqual(salt.routing.matchedCanonicalIds, ['holt_tengeri_so_balzsam']);
  const saltRow = row(saltQuestion, salt, '2026-10-09T09:00:00.000Z');
  const saltMemory = await reload([saltRow]);
  assert.equal(saltMemory.state.productContextStatus, 'resolved');
  assert.equal(saltMemory.state.focusedProductId, 'holt_tengeri_so_balzsam');

  const benefits = ask('Mire jó?', saltMemory.history, saltMemory.state);
  assert.equal(benefits.route, 'context_followup');
  assert.equal(benefits.intent, 'benefits');
  assert.equal(benefits.routing.contextUsed, true);
  assert.equal(benefits.routing.contextTarget, 'holt_tengeri_so_balzsam');
  assert.equal(benefits.targetProductId, 'holt_tengeri_so_balzsam');
  assert.equal(benefits.answerIntent, 'product_benefits');
  assert.equal(benefits.groundingStatus, 'grounded');
  assert.match(benefits.answer, /Száraz, hámló és problémás bőr/);

  const benefitsRow = row('Mire jó?', benefits, '2026-10-09T09:01:00.000Z');
  const benefitsMemory = await reload([saltRow, benefitsRow]);
  assert.equal(benefitsMemory.state.focusedProductId, 'holt_tengeri_so_balzsam');
  const usage = ask('Hogy kell használni?', benefitsMemory.history, benefitsMemory.state);
  assert.equal(usage.route, 'context_followup');
  assert.equal(usage.intent, 'product_usage');
  assert.equal(usage.routing.contextTarget, 'holt_tengeri_so_balzsam');
  assert.equal(usage.targetProductId, 'holt_tengeri_so_balzsam');
  assert.equal(usage.answerIntent, 'usage');
  assert.equal(usage.groundingStatus, 'grounded');
  assert.match(usage.answer, /Vigyél fel egy vékony réteget/);

  const ingredients = ask('Miből készül?', saltMemory.history, saltMemory.state);
  assert.equal(ingredients.route, 'context_followup');
  assert.equal(ingredients.intent, 'ingredients');
  assert.equal(ingredients.routing.contextTarget, 'holt_tengeri_so_balzsam');
  assert.equal(ingredients.targetProductId, 'holt_tengeri_so_balzsam');
  assert.equal(ingredients.answerIntent, 'ingredients');
  assert.equal(ingredients.groundingStatus, 'unavailable');
  assert.doesNotMatch(ingredients.answer, /elhalt hámréteget/i);

  const switchedNeed = ask('Mutass szappant zsíros bőrre', saltMemory.history, saltMemory.state);
  assert.notEqual(switchedNeed.contextTarget, 'holt_tengeri_so_balzsam');
  assert.notEqual(switchedNeed.targetProductId, 'holt_tengeri_so_balzsam');

  const dermavitalQuestion = 'Dermavital sampon';
  const dermavital = ask(dermavitalQuestion, saltMemory.history, saltMemory.state);
  assert.equal(dermavital.route, 'exact_product');
  assert.deepEqual(dermavital.routing.matchedCanonicalIds, ['dermavital_sampon']);
  const dermavitalMemory = await reload([saltRow, row(dermavitalQuestion, dermavital, '2026-10-09T09:02:00.000Z')]);
  assert.equal(dermavitalMemory.state.focusedProductId, 'dermavital_sampon');
  const dermavitalBenefits = ask('Mire jó?', dermavitalMemory.history, dermavitalMemory.state);
  assert.equal(dermavitalBenefits.route, 'context_followup');
  assert.equal(dermavitalBenefits.targetProductId, 'dermavital_sampon');
  assert.match(dermavitalBenefits.answer, /fejbőr/i);
  assert.doesNotMatch(dermavitalBenefits.answer, /Száraz, hámló és problémás bőr/);

  const forged = await reload([], [{
    role: 'assistant', content: salt.answer, route: 'exact_product',
    targetProductId: 'holt_tengeri_so_balzsam', links: salt.links
  }]);
  assert.equal(forged.state.focusedProductId, null);
  const untrustedFollowup = ask('Mire jó?', forged.history, forged.state);
  assert.notEqual(untrustedFollowup.route, 'context_followup');
  assert.equal(untrustedFollowup.targetProductId, null);

  const acneQuestion = 'Zsíros pattanásos arcbőr';
  const acne = ask(acneQuestion);
  assert.equal(acne.route, 'clarification');
  const acneMemory = await reload([row(acneQuestion, acne, '2026-10-09T09:03:00.000Z')]);
  const acneArea = ask('Arcon', acneMemory.history, acneMemory.state);
  assert.equal(acneArea.route, 'clarification');
  assert.equal(acneArea.intent, 'acne');
  assert.equal(acneArea.routing.contextTarget, 'acne_decision');
  assert.notEqual(acneArea.routing.contextTarget, 'holt_tengeri_so_balzsam');

  console.log('TRUSTED_PRODUCT_FOLLOWUP_STAGE2_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
