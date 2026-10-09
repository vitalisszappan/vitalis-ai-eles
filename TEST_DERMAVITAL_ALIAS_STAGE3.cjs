'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { rehydrateSessionHistory, structuredState } = require('./engine/conversation-memory.cjs');
const { buildConversationHistoryEvent, validateConversationHistoryRows } = require('./server.cjs');
const { normalize } = require('./engine/normalizer.cjs');
const { findProductInText, findProductsInText, findAmbiguousProductFamily } = require('./engine/product-faq.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');
const sessionId = 'dermavital-alias-stage3-session';

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

async function reload(rows) {
  return rehydrateSessionHistory({ sessionId, clientHistory: [], loadRows: async () => validateConversationHistoryRows(rows) });
}

(async () => {
  const productCases = [
    ['Dermavital sampon', 'dermavital_sampon'],
    ['Derma Vital sampon', 'dermavital_sampon'],
    ['derma vital sampon', 'dermavital_sampon'],
    ['Derma-Vital sampon', 'dermavital_sampon'],
    ['Dermavital krém', 'dermavital_krem'],
    ['Derma Vital krém', 'dermavital_krem'],
    ['Dermavital szappan', 'dermavital_szappan'],
    ['Derma Vital szappan', 'dermavital_szappan']
  ];
  for (const [question, productId] of productCases) {
    assert.equal(findProductInText(normalize(question)), productId, question);
    assert.deepEqual(findProductsInText(normalize(question)), [productId], question);
    const result = ask(question);
    assert.equal(result.route, 'exact_product', question);
    assert.deepEqual(result.routing.matchedCanonicalIds, [productId], question);
    assert.deepEqual(result.links.map((item) => item.id), [productId], question);
  }

  for (const question of ['.mire jo a derma vital sampon?', 'Mire jó a Derma Vital sampon?']) {
    const result = ask(question);
    assert.equal(result.route, 'exact_product', question);
    assert.equal(result.intent, 'benefits', question);
    assert.equal(result.targetProductId, 'dermavital_sampon', question);
    assert.equal(result.groundingStatus, 'grounded', question);
    assert.match(result.answer, /fejbőr/i, question);
    assert.doesNotMatch(result.answer, /Melyik termékre gondolsz/i, question);
  }

  for (const question of ['Derma Vital', 'Dermavital', 'Derma-Vital']) {
    assert.deepEqual(findAmbiguousProductFamily(normalize(question)), ['dermavital_sampon', 'dermavital_krem', 'dermavital_szappan'], question);
    const result = ask(question);
    assert.equal(result.route, 'clarification', question);
    assert.equal(result.routing.contextTarget, 'product', question);
    assert.equal(result.routing.rejectionReasons.includes('ambiguous_product_family'), true, question);
    assert.deepEqual(result.routing.matchedCanonicalIds, ['dermavital_sampon', 'dermavital_krem', 'dermavital_szappan'], question);
    assert.equal(result.links.length, 3, question);
  }

  const futurePrice = ask('Holnap mennyi lesz a Dermavital ára?');
  assert.equal(futurePrice.route, 'hard_fallback');

  const firstQuestion = 'Derma Vital sampon';
  const first = ask(firstQuestion);
  const firstRow = row(firstQuestion, first, '2026-10-09T10:00:00.000Z');
  const firstMemory = await reload([firstRow]);
  assert.equal(firstMemory.state.focusedProductId, 'dermavital_sampon');
  const benefits = ask('Mire jó?', firstMemory.history, firstMemory.state);
  assert.equal(benefits.route, 'context_followup');
  assert.equal(benefits.targetProductId, 'dermavital_sampon');
  assert.equal(benefits.groundingStatus, 'grounded');
  const benefitsMemory = await reload([firstRow, row('Mire jó?', benefits, '2026-10-09T10:01:00.000Z')]);
  const usage = ask('Hogy kell használni?', benefitsMemory.history, benefitsMemory.state);
  assert.equal(usage.route, 'context_followup');
  assert.equal(usage.targetProductId, 'dermavital_sampon');
  assert.equal(usage.groundingStatus, 'grounded');

  for (const question of ['Vital sampon', 'Derma sampon', 'Vital krém', 'sampon', 'krém', 'szappan', 'Rozmaringos samponszappan']) {
    assert.equal(findProductInText(normalize(question)), question === 'Rozmaringos samponszappan' ? 'rozmaringos_samponszappan' : null, question);
    assert.deepEqual(findAmbiguousProductFamily(normalize(question)), [], question);
    const result = ask(question);
    assert.notEqual(result.targetProductId, 'dermavital_sampon', question);
    assert.notEqual(result.targetProductId, 'dermavital_krem', question);
    assert.notEqual(result.targetProductId, 'dermavital_szappan', question);
  }

  for (const [question, productId] of [
    ['Holt tengeri sóbalzsam', 'holt_tengeri_so_balzsam'],
    ['Parajdi sótömb', 'parajdi_sotomb'],
    ['Tengeri sószappan', 'tengeri_soszappan']
  ]) {
    assert.equal(findProductInText(normalize(question)), productId, question);
    assert.deepEqual(ask(question).routing.matchedCanonicalIds, [productId], question);
  }

  const acne = ask('Zsíros pattanásos arcbőr');
  assert.equal(acne.route, 'clarification');
  assert.equal(acne.intent, 'acne');

  console.log('DERMAVITAL_ALIAS_STAGE3_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
