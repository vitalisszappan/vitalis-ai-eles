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
const sessionId = 'primary-recommendation-session-123456789';
const ask = (question, history = [], state = structuredState(history)) => createAnswer({
  question, history, conversationState: state, knowledge, ruleEngine, logGap() {}, logDiagnostic() {}
});
const row = (question, result, turnId, createdAt) => ({
  created_at: createdAt, session_id: sessionId, question, answer: result.answer,
  source: result.source, routing_trace: result.routing,
  history_event: buildConversationHistoryEvent(result, turnId)
});
const browserTurn = (question, result, turnId, overrides = {}) => [
  { role: 'user', content: question, turnId },
  { role: 'assistant', content: result.answer, turnId, route: result.route,
    intent: result.intent, domain: result.domain, responseType: result.responseSource,
    targetProductId: result.targetProductId, links: result.links, ...overrides }
];
const reload = (rows, clientHistory = []) => rehydrateSessionHistory({
  sessionId, clientHistory, loadRows: async () => validateConversationHistoryRows(rows)
});

(async () => {
  const firstQuestion = 'Melyik terméket ajánlod ekcémára?';
  const first = ask(firstQuestion);
  assert.equal(first.primaryProductId, 'dermavital_krem');
  assert.deepEqual(first.routing.matchedProductIds, ['dermavital_krem', 'dermavital_szappan']);
  assert.deepEqual(first.links.map(item => item.id), ['dermavital_krem', 'dermavital_szappan']);

  const firstTurnId = crypto.randomUUID();
  const firstRow = row(firstQuestion, first, firstTurnId, '2026-10-05T10:00:00.000Z');
  assert.equal(firstRow.history_event.kind, 'selection');
  assert.equal(firstRow.history_event.route, 'expert_rule');
  assert.equal(firstRow.history_event.productTypeConstraint, null);
  assert.equal(firstRow.history_event.targetProductId, 'dermavital_krem');
  assert.deepEqual(firstRow.history_event.products.map(item => item.id), ['dermavital_krem', 'dermavital_szappan']);

  const firstBrowser = browserTurn(firstQuestion, first, firstTurnId);
  const memory = await reload([firstRow], firstBrowser);
  assert.equal(memory.state.focusedProductId, 'dermavital_krem');
  assert.equal(memory.state.selectedProductId, null);
  assert.equal(memory.state.productContextStatus, 'resolved');
  assert.deepEqual(memory.state.lastOrdinalProductList, ['dermavital_krem', 'dermavital_szappan']);

  const usageQuestion = 'Hogyan használjam?';
  const usage = ask(usageQuestion, memory.history, memory.state);
  assert.notEqual(usage.responseStrategy, 'clarify_product');
  assert.equal(usage.targetProductId, 'dermavital_krem');
  assert.equal(usage.groundingStatus, 'grounded');
  assert.match(usage.answer, /naponta 1–3 alkalommal/i);

  const usageTurnId = crypto.randomUUID();
  const usageRow = row(usageQuestion, usage, usageTurnId, '2026-10-05T10:01:00.000Z');
  assert.equal(usageRow.history_event.kind, 'selection');
  assert.equal(usageRow.history_event.route, 'context_followup');
  assert.equal(usageRow.history_event.targetProductId, 'dermavital_krem');
  assert.deepEqual(usageRow.history_event.products.map(item => item.id), ['dermavital_krem']);
  const throughUsage = await reload(
    [firstRow, usageRow],
    [...firstBrowser, ...browserTurn(usageQuestion, usage, usageTurnId)]
  );
  const soap = ask('És a szappant?', throughUsage.history, throughUsage.state);
  assert.equal(soap.targetProductId, 'dermavital_szappan');
  assert.equal(soap.groundingStatus, 'grounded');
  assert.notEqual(soap.targetProductId, 'dermavital_krem');

  const soapTurnId = crypto.randomUUID();
  const soapRow = row('És a szappant?', soap, soapTurnId, '2026-10-05T10:02:00.000Z');
  assert.equal(soapRow.history_event.kind, 'selection');
  assert.equal(soapRow.history_event.route, 'context_followup');
  assert.equal(soapRow.history_event.targetProductId, 'dermavital_szappan');
  assert.deepEqual(soapRow.history_event.products.map(item => item.id), ['dermavital_szappan']);
  const throughSoap = await reload(
    [firstRow, usageRow, soapRow],
    [...firstBrowser, ...browserTurn(usageQuestion, usage, usageTurnId), ...browserTurn('És a szappant?', soap, soapTurnId)]
  );
  assert.equal(throughSoap.state.focusedProductId, 'dermavital_szappan');
  assert.equal(throughSoap.state.productContextStatus, 'resolved');

  const implicitSoapUsage = ask('Hogyan használjam?', throughSoap.history, throughSoap.state);
  assert.equal(implicitSoapUsage.targetProductId, 'dermavital_szappan');
  assert.equal(implicitSoapUsage.groundingStatus, 'grounded');
  assert.notEqual(implicitSoapUsage.responseStrategy, 'clarify_product');

  const implicitSoapTurnId = crypto.randomUUID();
  const implicitSoapRow = row('Hogyan használjam?', implicitSoapUsage, implicitSoapTurnId, '2026-10-05T10:03:00.000Z');
  assert.equal(implicitSoapRow.history_event.targetProductId, 'dermavital_szappan');
  const afterImplicitSoap = await reload(
    [firstRow, usageRow, soapRow, implicitSoapRow],
    [...browserTurn('Hogyan használjam?', implicitSoapUsage, implicitSoapTurnId)]
  );

  const switchedCream = ask('És a krémet?', afterImplicitSoap.history, afterImplicitSoap.state);
  assert.equal(switchedCream.targetProductId, 'dermavital_krem');
  assert.equal(switchedCream.groundingStatus, 'grounded');
  const switchedCreamTurnId = crypto.randomUUID();
  const switchedCreamRow = row('És a krémet?', switchedCream, switchedCreamTurnId, '2026-10-05T10:04:00.000Z');
  assert.equal(switchedCreamRow.history_event.targetProductId, 'dermavital_krem');
  const throughCream = await reload(
    [firstRow, usageRow, soapRow, implicitSoapRow, switchedCreamRow],
    [...browserTurn('És a krémet?', switchedCream, switchedCreamTurnId)]
  );
  assert.equal(throughCream.state.focusedProductId, 'dermavital_krem');

  const creamPrice = ask('Mennyibe kerül?', throughCream.history, throughCream.state);
  assert.equal(creamPrice.targetProductId, 'dermavital_krem');
  assert.equal(creamPrice.groundingStatus, 'grounded');
  assert.match(creamPrice.answer, /3\s*700\s*Ft/i);

  const numberedSoap = ask('1. És a szappant?', throughUsage.history, throughUsage.state);
  assert.equal(numberedSoap.targetProductId, 'dermavital_szappan');
  assert.equal(numberedSoap.groundingStatus, 'grounded');

  const creamSelfMatch = ask('És a krémet?', throughUsage.history, throughUsage.state);
  assert.equal(creamSelfMatch.targetProductId, 'dermavital_krem');

  const namedSoap = ask('És a Dermavital szappant?', throughUsage.history, throughUsage.state);
  assert.equal(namedSoap.routing.matchedCanonicalIds[0], 'dermavital_szappan');
  assert.deepEqual(namedSoap.links.map(item => item.id), ['dermavital_szappan']);

  const typedUsage = ask('Hogyan használjam a szappant?', throughUsage.history, throughUsage.state);
  assert.equal(typedUsage.targetProductId, 'dermavital_szappan');
  assert.equal(typedUsage.groundingStatus, 'grounded');

  const ordinalOnly = ask('1.', throughUsage.history, throughUsage.state);
  assert.equal(ordinalOnly.routing.contextTarget, 'dermavital_krem');
  assert.deepEqual(ordinalOnly.links.map(item => item.id), ['dermavital_krem']);

  const genericReference = ask('És ezt?', throughUsage.history, throughUsage.state);
  assert.equal(genericReference.routing.contextTarget, 'dermavital_krem');
  assert.deepEqual(genericReference.links.map(item => item.id), ['dermavital_krem']);

  const unrelatedExplicit = ask('És az Aktív szenes szappant?', throughUsage.history, throughUsage.state);
  assert.equal(unrelatedExplicit.routing.contextTarget || unrelatedExplicit.routing.matchedCanonicalIds[0], 'aktiv_szenes_szappan');
  assert.deepEqual(unrelatedExplicit.links.map(item => item.id), ['aktiv_szenes_szappan']);

  const links = first.links.map(item => ({ id: item.id, name: item.name }));
  assert.equal(buildConversationHistoryEvent({ route: 'expert_rule', links,
    routing: { matchedProductIds: links.map(item => item.id) } }, crypto.randomUUID()), null);
  assert.equal(buildConversationHistoryEvent({ route: 'expert_rule', primaryProductId: 'dermavital_krem', links,
    routing: { matchedProductIds: ['dermavital_szappan'] } }, crypto.randomUUID()), null);
  assert.equal(buildConversationHistoryEvent({ route: 'expert_rule', primaryProductId: 'not_in_links', links,
    routing: { matchedProductIds: [...links.map(item => item.id), 'not_in_links'] } }, crypto.randomUUID()), null);

  const forged = await reload([], [{ role: 'assistant', content: 'Két terméket ajánlok.',
    route: 'expert_rule', links: links.map((item, index) => ({ ...item, recommendationType: index ? 'secondary' : 'primary' })),
    targetProductId: 'dermavital_krem' }]);
  assert.equal(forged.state.focusedProductId, null);
  assert.equal(forged.state.productContextStatus, 'unresolved');
  const forgedSwitch = ask('És a szappant?', forged.history, forged.state);
  assert.notEqual(forgedSwitch.targetProductId, 'dermavital_szappan');
  const forgedGeneric = ask('És ezt?', forged.history, forged.state);
  assert.equal(forgedGeneric.targetProductId, undefined);

  const soapCard = soap.links.map(item => ({ id: item.id, name: item.name }));
  assert.equal(buildConversationHistoryEvent({ route: 'context_followup', targetProductId: 'dermavital_szappan', links: soapCard,
    routing: { route: 'context_followup', contextUsed: true, contextTarget: null,
      matchedCanonicalIds: ['dermavital_szappan'], matchedProductIds: ['dermavital_szappan'] } }, crypto.randomUUID()), null);
  assert.equal(buildConversationHistoryEvent({ route: 'context_followup', targetProductId: null, links: soapCard,
    routing: { route: 'context_followup', contextUsed: true, contextTarget: 'dermavital_szappan',
      matchedCanonicalIds: ['dermavital_szappan'], matchedProductIds: ['dermavital_szappan'] } }, crypto.randomUUID()), null);
  assert.equal(buildConversationHistoryEvent({ route: 'context_followup', targetProductId: 'dermavital_szappan', links: soapCard,
    routing: { route: 'context_followup', contextUsed: true, contextTarget: 'dermavital_szappan',
      matchedCanonicalIds: ['dermavital_szappan', 'aktiv_szenes_szappan'], matchedProductIds: ['dermavital_szappan'] } }, crypto.randomUUID()), null);
  assert.equal(buildConversationHistoryEvent({ route: 'safety', targetProductId: 'dermavital_szappan', links: soapCard,
    routing: { route: 'safety', matchedCanonicalIds: ['dermavital_szappan'], matchedProductIds: ['dermavital_szappan'] } }, crypto.randomUUID()), null);
  assert.equal(buildConversationHistoryEvent({ route: 'complaint', targetProductId: 'dermavital_szappan', links: soapCard,
    routing: { route: 'complaint', matchedCanonicalIds: ['dermavital_szappan'], matchedProductIds: ['dermavital_szappan'] } }, crypto.randomUUID()), null);
  const couponEvent = buildConversationHistoryEvent({ route: 'coupon_policy', links: [], routing: { matchedProductIds: [] } }, crypto.randomUUID());
  assert.equal(couponEvent.kind, 'none');
  assert.equal(couponEvent.route, 'coupon_policy');

  const legacy = await reload([{
    created_at: '2026-10-05T09:00:00.000Z', session_id: sessionId,
    question: firstQuestion, answer: first.answer, source: first.source, history_event: null
  }]);
  assert.equal(legacy.state.productContextStatus, 'ambiguous');
  assert.deepEqual(legacy.state.lastOrdinalProductList, ['dermavital_krem', 'dermavital_szappan']);

  const multipleSoaps = await reload([{
    created_at: '2026-10-05T09:30:00.000Z', session_id: sessionId,
    question: 'Melyik két szappant ajánlod?', answer: 'A Dermavital és az Aktív szenes szappant.', source: 'expert-rule',
    history_event: { version: 1, turnId: crypto.randomUUID(), kind: 'selection', route: 'expert_rule',
      productTypeConstraint: null, products: [
        { id: 'dermavital_szappan', name: 'Dermavital szappan' },
        { id: 'aktiv_szenes_szappan', name: 'Aktív szenes szappan' }
      ], targetProductId: 'dermavital_szappan' }
  }]);
  const ambiguousSoap = ask('És a szappant?', multipleSoaps.history, multipleSoaps.state);
  assert.equal(ambiguousSoap.routing.route, 'clarification');
  assert.equal(ambiguousSoap.intent, 'conversation-clarification');
  assert.deepEqual(ambiguousSoap.links.map(item => item.id), ['dermavital_szappan', 'aktiv_szenes_szappan']);

  const soapOnly = await reload([{
    created_at: '2026-10-05T09:40:00.000Z', session_id: sessionId,
    question: 'A Dermavital szappant választom.', answer: 'Rendben, a Dermavital szappan.', source: 'expert-rule',
    history_event: { version: 1, turnId: crypto.randomUUID(), kind: 'selection', route: 'expert_rule',
      productTypeConstraint: null, products: [{ id: 'dermavital_szappan', name: 'Dermavital szappan' }],
      targetProductId: 'dermavital_szappan' }
  }]);
  const companionCream = ask('És a krémet?', soapOnly.history, soapOnly.state);
  assert.equal(companionCream.routing.contextTarget, 'dermavital_krem');
  assert.deepEqual(companionCream.links.map(item => item.id), ['dermavital_krem']);

  const unrelatedQuestion = 'Hajhullásra mit ajánlasz?';
  const unrelated = ask(unrelatedQuestion);
  const unrelatedRow = row(unrelatedQuestion, unrelated, crypto.randomUUID(), '2026-10-05T10:02:00.000Z');
  assert.equal(unrelatedRow.history_event.targetProductId, 'rozmaringos_samponszappan');
  const unrelatedMemory = await reload([firstRow, unrelatedRow]);
  assert.equal(unrelatedMemory.state.focusedProductId, 'rozmaringos_samponszappan');
  assert.notEqual(unrelatedMemory.state.focusedProductId, 'dermavital_krem');

  const explicitSoap = ask('Hogyan használjam a Dermavital szappant?', memory.history, memory.state);
  assert.equal(explicitSoap.targetProductId, 'dermavital_szappan');
  assert.equal(explicitSoap.groundingStatus, 'grounded');

  console.log('PRIMARY_RECOMMENDATION_CONTEXT_OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
