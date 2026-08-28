'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { structuredState, rowsToHistory } = require('./engine/conversation-memory.cjs');

const parsed = JSON.parse(fs.readFileSync('./data/knowledge.json', 'utf8'));
const knowledge = Array.isArray(parsed) ? parsed : parsed.items || parsed.knowledge || [];
const ruleEngine = new ExpertRuleEngine('./data/rules/expert-rules.json');
const originalFlag = process.env.SEMANTIC_GUARD_ENFORCEMENT;
const ask = (question, history = []) => createAnswer({
  question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {}
});
const assistant = (answer) => ({
  role: 'assistant', content: answer.answer, route: answer.route, intent: answer.intent,
  domain: answer.domain, targetProductId: answer.targetProductId, links: answer.links, routing: answer.routing
});
const append = (history, question, answer) => [...history, { role: 'user', content: question }, assistant(answer)];
const cleared = (state) => {
  assert.equal(state.focusedProductId, null);
  assert.equal(state.purchaseProductId, null);
  assert.equal(state.selectedProductId, null);
  assert.deepEqual(state.lastRecommendedProducts, []);
  assert.deepEqual(state.lastOrdinalProductList, []);
  assert.deepEqual(state.activeProductIds, []);
  assert.equal(state.productContextStatus, 'unresolved');
};
const assertResolved = (answer, fromHistory) => {
  assert.equal(answer.route, 'complaint');
  assert.equal(answer.intent, 'complaint_resolved');
  assert.equal(answer.routing.semanticGuard.resolutionOwner, 'complaint');
  assert.equal(answer.routing.semanticGuard.ownershipClass, 'resolved_complaint');
  assert.equal(answer.routing.semanticGuard.complaintState, 'resolved');
  assert.equal(answer.resolvedTransitionApplied, true);
  assert.equal(answer.resolvedFromHistory, fromHistory);
  assert.equal(answer.recommendationAllowed, false);
  assert.equal(answer.purchaseAllowed, false);
  assert.equal(answer.productLinksAllowed, false);
  assert.equal(answer.targetProductId, null);
  assert.deepEqual(answer.recommendedProductIds, []);
  assert.deepEqual(answer.links, []);
  assert.match(answer.answer, /^Örülök, hogy elmúlt\.$/);
};

const falsePositiveControls = [
  'elmúlt nyolc óra', 'elmúlt a nyár', 'már nincs készleten?', 'nem piros szappant keresek',
  'nem csípős illatot szeretnék', 'jól vagyok, milyen szappant ajánlasz?', 'rendben, mutass másikat',
  'már nem ezt kérem', 'tegnap vettem egy krémet', 'nem irritáló krémet keresek',
  'nem irritál', 'nem pirosodtam ki', 'egyáltalán nem csíp', 'irritálhat?',
  'okozhat kipirosodást?', 'mi van, ha kipirosodok?', 'irritált bőrre keresek krémet',
  'érzékeny a bőröm', 'kipirosodásra keresek valamit', 'csípős illatot keresek',
  'égetően szükségem van szappanra', 'furcsa szaga van', 'megolvadt', 'törött',
  'rossz az állaga', 'tegnap irritált, még most is piros'
];

try {
  process.env.SEMANTIC_GUARD_ENFORCEMENT = 'true';

  // PR1 #39: same-turn complaint evidence plus explicit resolution.
  let result = ask('A balzsamtól irritált lett a bőröm, de már elmúlt.');
  assertResolved(result, false);
  assert.equal(result.complaintSubjectProductId, null);
  cleared(structuredState(append([], 'A balzsamtól irritált lett a bőröm, de már elmúlt.', result)));

  // Active complaint -> resolved complaint, with no product/card/purchase leakage.
  let history = [];
  result = ask('Dermavital krémtől kipirosodtam.');
  assert.equal(result.routing.semanticGuard.ownershipClass, 'complaint');
  history = append(history, 'Dermavital krémtől kipirosodtam.', result);
  result = ask('már elmúlt', history);
  assertResolved(result, true);
  history = append(history, 'már elmúlt', result);
  cleared(structuredState(history));

  // The complaint boundary remains durable after another non-complaint turn.
  result = ask('másik', history);
  assert.equal(result.targetProductId == null, true);
  assert.deepEqual(result.links, []);
  history = append(history, 'másik', result);
  cleared(structuredState(history));

  // A pre-complaint recommendation set never resurrects.
  history = [];
  let recommendation = ask('Mit ajánlasz ekcémára?');
  const preComplaintIds = recommendation.links.map((link) => link.id);
  assert(preComplaintIds.length > 0);
  history = append(history, 'Mit ajánlasz ekcémára?', recommendation);
  let complaint = ask('ettől kipirosodtam', history);
  history = append(history, 'ettől kipirosodtam', complaint);
  let resolved = ask('már elmúlt', history);
  history = append(history, 'már elmúlt', resolved);
  cleared(structuredState(history));
  const another = ask('másik', history);
  assert.equal(another.targetProductId == null, true);
  assert.equal(another.links.some((link) => preComplaintIds.includes(link.id)), false);
  history = append(history, 'másik', another);
  cleared(structuredState(history));

  // A later explicit goal routes normally from a clean state.
  const laterRecommendation = ask('Milyen szappant ajánlasz száraz bőrre?', history);
  assert.notEqual(laterRecommendation.route, 'complaint');
  assert.equal(laterRecommendation.routing.semanticGuard.ownershipClass === 'resolved_complaint', false);
  const postBoundaryHistory = append(history, 'Milyen szappant ajánlasz száraz bőrre?', laterRecommendation);
  assert.notEqual(structuredState(postBoundaryHistory).focusedProductId, null);
  const postBoundaryPrice = ask('Mennyibe kerül?', postBoundaryHistory);
  assert.notEqual(postBoundaryPrice.route, 'complaint');
  assert.notEqual(postBoundaryPrice.contextTarget, null);
  const business = ask('Mi az email címetek?', history);
  assert.equal(business.route, 'business_info');
  assert.deepEqual(business.links, []);

  // Same-turn resolution plus explicit current goal uses no pre-boundary target.
  history = append([], 'Dermavital krémtől kipirosodtam.', ask('Dermavital krémtől kipirosodtam.'));
  const mixedRecommendation = ask('Elmúlt, mit ajánlasz helyette?', history);
  assert.equal(mixedRecommendation.resolvedTransitionApplied, true);
  assert.equal(mixedRecommendation.routing.semanticGuard.ownershipClass, 'resolved_complaint');
  assert.equal(mixedRecommendation.targetProductId == null, true);
  assert.deepEqual(mixedRecommendation.links, []);
  assert.match(mixedRecommendation.answer, /^Örülök, hogy elmúlt\./);
  const mixedCategory = ask('Elmúlt. Van másik szappan?', history);
  assert.equal(mixedCategory.resolvedTransitionApplied, true);
  assert.notEqual(mixedCategory.route, 'complaint');
  const mixedCommerce = ask('Elmúlt, hogyan tudok rendelni?', history);
  assert.equal(mixedCommerce.resolvedTransitionApplied, true);
  assert.equal(mixedCommerce.targetProductId == null, true);
  const mixedPrice = ask('Már nem csíp, mennyibe kerül a másik?', history);
  assert.equal(mixedPrice.resolvedTransitionApplied, true);
  assert.equal(mixedPrice.targetProductId == null, true);
  assert.deepEqual(mixedPrice.links, []);

  // Safety remains strictly above resolved ownership.
  for (const question of ['már elmúlt, de most nehezen kapok levegőt', 'már nem piros, de bedagadt a nyelvem']) {
    const safety = ask(question, history);
    assert.equal(safety.route, 'safety', question);
    assert.equal(safety.intent, 'medical_escalation', question);
    assert.equal(safety.routing.semanticGuard.resolutionOwner, 'safety', question);
    assert.notEqual(safety.routing.semanticGuard.ownershipClass, 'resolved_complaint', question);
  }

  // Active wording (#38) remains active complaint-owned.
  const active = ask('A balzsamtól irritált lett a bőröm, és még most is irritált.');
  assert.equal(active.route, 'complaint');
  assert.equal(active.routing.semanticGuard.ownershipClass, 'complaint');
  assert.equal(active.resolutionFamily, 'complaint_status_unclear');

  // No global resolution keyword route.
  for (const question of falsePositiveControls) {
    const control = ask(question);
    assert.notEqual(control.routing.semanticGuard.ownershipClass, 'resolved_complaint', question);
    assert.notEqual(control.resolvedTransitionApplied, true, question);
  }

  // Session/reload retains the route boundary without a schema change.
  const reloadedHistory = rowsToHistory([{
    created_at: '2026-08-28T12:00:00Z', question: 'már elmúlt', answer: 'Örülök, hogy elmúlt.',
    source: 'complaint-resolution', routing_trace: { route: 'complaint', intent: 'complaint_resolved', domain: 'complaint' }
  }]);
  cleared(structuredState(reloadedHistory));
  const afterReload = ask('másik', reloadedHistory);
  assert.equal(afterReload.targetProductId == null, true);
  assert.deepEqual(afterReload.links, []);

  // The explicit false kill switch preserves the old non-owned behavior.
  process.env.SEMANTIC_GUARD_ENFORCEMENT = 'false';
  const disabled = ask('A balzsamtól irritált lett a bőröm, de már elmúlt.');
  assert.notEqual(disabled.routing.semanticGuard.ownershipClass, 'resolved_complaint');
  assert.equal(disabled.routing.semanticGuard.enforcementEnabled, false);
} finally {
  if (originalFlag === undefined) delete process.env.SEMANTIC_GUARD_ENFORCEMENT;
  else process.env.SEMANTIC_GUARD_ENFORCEMENT = originalFlag;
}

console.log(`Resolved Complaint B2R: PASS (${falsePositiveControls.length} false-positive controls + lifecycle/state/safety/reload)`);
