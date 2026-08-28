'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { applySemanticGuardEnforcement } = require('./engine/semantic-guard-enforcement.cjs');

const parsed = JSON.parse(fs.readFileSync('./data/knowledge.json', 'utf8'));
const knowledge = Array.isArray(parsed) ? parsed : parsed.items || parsed.knowledge || [];
const ruleEngine = new ExpertRuleEngine('./data/rules/expert-rules.json');
const originalFlag = process.env.SEMANTIC_GUARD_ENFORCEMENT;
const ask = (question, history = []) => createAnswer({
  question,
  history,
  conversationState: structuredState(history),
  knowledge,
  ruleEngine,
  logGap() {}
});

const roleMismatchCases = [
  ['kifingottam egy ekcemat', 'expert_rule'],
  ['tegnap vacsoraztam egy szappant', 'product_category'],
  ['tegnap leugrottam egy 3 emeletes szallitasrol', 'commerce']
];

function responseContract(answer) {
  return {
    route: answer.route,
    intent: answer.intent,
    answer: answer.answer,
    links: (answer.links || []).map((link) => link.id),
    contextTarget: answer.contextTarget,
    targetProductId: answer.targetProductId
  };
}

function assertNoAuthoritativeTarget(value, label) {
  assert.equal(value == null, true, `${label}: expected no authoritative target`);
}

function historyAfter(question, answer) {
  return [
    { role: 'user', content: question },
    {
      role: 'assistant',
      content: answer.answer,
      route: answer.route,
      intent: answer.intent,
      contextTarget: answer.contextTarget,
      targetProductId: answer.targetProductId,
      links: answer.links
    }
  ];
}

function restoreFlag() {
  if (originalFlag === undefined) delete process.env.SEMANTIC_GUARD_ENFORCEMENT;
  else process.env.SEMANTIC_GUARD_ENFORCEMENT = originalFlag;
}

try {
  process.env.SEMANTIC_GUARD_ENFORCEMENT = 'false';
  const shadow = roleMismatchCases.map(([question, originalRoute]) => {
    const result = ask(question);
    assert.equal(result.route, originalRoute, `${question}: flag-off route`);
    assert.equal(result.routing.semanticGuard.enforcementClass, 'semantic_role_mismatch');
    assert.equal(result.routing.semanticGuard.enforcementEnabled, false);
    assert.equal(result.routing.semanticGuard.enforcementEligible, true);
    assert.equal(result.routing.semanticGuard.enforcementApplied, false);
    return responseContract(result);
  });

  process.env.SEMANTIC_GUARD_ENFORCEMENT = 'true';
  for (const [index, [question, originalRoute]] of roleMismatchCases.entries()) {
    const result = ask(question);
    const guard = result.routing.semanticGuard;
    assert.equal(guard.originalRoute.route, originalRoute, question);
    assert.equal(guard.decision, 'REJECT', question);
    assert.equal(guard.hardConflict, true, question);
    assert(guard.reasonCodes.includes('SEMANTIC_ROLE_MISMATCH'), question);
    assert.equal(guard.enforcementClass, 'semantic_role_mismatch', question);
    assert.equal(guard.enforcementEligible, true, question);
    assert.equal(guard.enforcementApplied, true, question);
    assert.equal(result.route, 'clarification', question);
    assert.equal(result.answer, 'Mire gondolsz pontosan?', question);
    assert.deepEqual(result.links, [], question);
    assertNoAuthoritativeTarget(result.targetProductId, question);
    assert.notDeepEqual(responseContract(result), shadow[index], `${question}: flag-on must safely resolve`);
  }

  const validQueries = [
    'Mit ajanlasz ekcemara?',
    'Milyen szappanok vannak?',
    'Mennyibe kerul a szallitas?',
    'Dermavital krem'
  ];
  process.env.SEMANTIC_GUARD_ENFORCEMENT = 'false';
  const validShadow = validQueries.map((question) => responseContract(ask(question)));
  process.env.SEMANTIC_GUARD_ENFORCEMENT = 'true';
  validQueries.forEach((question, index) => {
    const result = ask(question);
    assert.equal(result.routing.semanticGuard.enforcementClass, null, question);
    assert.equal(result.routing.semanticGuard.enforcementEligible, false, question);
    assert.equal(result.routing.semanticGuard.enforcementApplied, false, question);
    assert.deepEqual(responseContract(result), validShadow[index], `${question}: valid route changed`);
  });

  const complaint = ask('mit tegyek, ha a szappan irritalja a borom?');
  assert.equal(complaint.routing.semanticGuard.resolutionOwner, 'complaint');
  assert(complaint.routing.semanticGuard.reasonCodes.includes('COMPLAINT_OVERRIDES_RECOMMENDATION'));
  assert.equal(complaint.routing.semanticGuard.enforcementEligible, false);
  assert.equal(complaint.routing.semanticGuard.enforcementApplied, false);

  for (const question of ['milyen termekeitek vannak?', 'van garancia?', 'hogyan erlek el?']) {
    const result = ask(question);
    assert.equal(result.routing.semanticGuard.enforcementEligible, false, question);
    assert.equal(result.routing.semanticGuard.enforcementApplied, false, question);
  }

  const forcedMismatch = {
    decision: 'REJECT', enforcement: 'MANDATORY_ESCALATION', resolutionOwner: 'safety',
    hardConflict: true, reasonCodes: ['SEMANTIC_ROLE_MISMATCH']
  };
  const safety = applySemanticGuardEnforcement({
    routing: { route: 'safety', intent: 'medical_escalation', safetyClass: 'medical_escalation' },
    guard: forcedMismatch,
    enabled: true
  });
  assert.equal(safety.routing.route, 'safety');
  assert.equal(safety.telemetry.enforcementEligible, false);
  assert.equal(safety.telemetry.enforcementApplied, false);

  const unknownRoute = applySemanticGuardEnforcement({
    routing: { route: 'knowledge', intent: 'product_information' },
    guard: { decision: 'REJECT', resolutionOwner: 'router', hardConflict: true, reasonCodes: ['SEMANTIC_ROLE_MISMATCH'] },
    enabled: true
  });
  assert.equal(unknownRoute.telemetry.enforcementClass, null);
  assert.equal(unknownRoute.telemetry.enforcementEligible, false);
  assert.equal(unknownRoute.telemetry.enforcementApplied, false);
  assert.equal(unknownRoute.routing.route, 'knowledge');

  const capabilityOwned = applySemanticGuardEnforcement({
    routing: { route: 'commerce', intent: 'shipping_general' },
    guard: {
      decision: 'REJECT', resolutionOwner: 'router', hardConflict: true,
      reasonCodes: ['SEMANTIC_ROLE_MISMATCH'], suggestedCapability: 'shipping_support'
    },
    enabled: true
  });
  assert.equal(capabilityOwned.telemetry.enforcementEligible, false);
  assert.equal(capabilityOwned.telemetry.enforcementApplied, false);

  const b0 = ask('r\u00e1nc');
  assert.equal(b0.routing.semanticGuard.enforcementClass, 'exact_product_substring');
  assert.equal(b0.routing.semanticGuard.enforcementApplied, true);
  assert.equal(b0.route, 'clarification');

  const productMismatchQuestion = roleMismatchCases[1][0];
  const productMismatch = ask(productMismatchQuestion);
  assert.equal(productMismatch.routing.semanticGuard.enforcementApplied, true);
  assert.equal(productMismatch.route, 'clarification');
  assert.deepEqual(productMismatch.links, []);
  assertNoAuthoritativeTarget(productMismatch.targetProductId, 'product mismatch first turn');
  const productHistory = historyAfter(productMismatchQuestion, productMismatch);
  const productState = structuredState(productHistory);
  assertNoAuthoritativeTarget(productState.focusedProductId, 'product mismatch focused product');
  assertNoAuthoritativeTarget(productState.purchaseProductId, 'product mismatch purchase product');
  assert.equal(productState.productContextStatus, 'unresolved');
  const productFollowup = ask('mit tud?', productHistory);
  assert.notEqual(productFollowup.route, 'product_category');
  assert.equal((productFollowup.links || []).length, 0);
  assertNoAuthoritativeTarget(productFollowup.contextTarget, 'product mismatch follow-up context');
  assertNoAuthoritativeTarget(productFollowup.targetProductId, 'product mismatch follow-up target');

  const commerceMismatchQuestion = roleMismatchCases[2][0];
  const commerceMismatch = ask(commerceMismatchQuestion);
  assert.equal(commerceMismatch.routing.semanticGuard.enforcementApplied, true);
  assert.equal(commerceMismatch.route, 'clarification');
  assert.deepEqual(commerceMismatch.links, []);
  assertNoAuthoritativeTarget(commerceMismatch.targetProductId, 'commerce mismatch first turn');
  const commerceHistory = historyAfter(commerceMismatchQuestion, commerceMismatch);
  const commerceState = structuredState(commerceHistory);
  assertNoAuthoritativeTarget(commerceState.focusedProductId, 'commerce mismatch focused product');
  assertNoAuthoritativeTarget(commerceState.purchaseProductId, 'commerce mismatch purchase product');
  assertNoAuthoritativeTarget(commerceState.lastCommerceFocus, 'commerce mismatch trusted commerce focus');
  const commerceFollowup = ask('mennyibe kerul?', commerceHistory);
  assert.equal(commerceFollowup.route, 'clarification');
  assert.equal(commerceFollowup.intent, 'price_query');
  // contextTarget is overloaded: here "product" names the missing argument
  // type for clarification. Authoritative product state lives in the separate
  // target/focus/purchase/link and matched-product fields asserted below.
  assert.equal(commerceFollowup.contextTarget, 'product');
  assert(commerceFollowup.routing.rejectionReasons.includes('missing_product_argument'));
  assertNoAuthoritativeTarget(commerceFollowup.targetProductId, 'commerce mismatch follow-up target');
  assertNoAuthoritativeTarget(commerceFollowup.focusedProductId, 'commerce mismatch follow-up focus');
  assertNoAuthoritativeTarget(commerceFollowup.purchaseProductId, 'commerce mismatch follow-up purchase target');
  assert.deepEqual(commerceFollowup.routing.matchedProductIds, []);
  assert.equal((commerceFollowup.links || []).length, 0);
} finally {
  restoreFlag();
}

console.log('Semantic Guard Phase B1 controlled semantic role mismatch enforcement: PASS');
