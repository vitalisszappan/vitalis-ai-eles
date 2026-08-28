'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { routeAnswer } = require('./engine/answer-router.cjs');
const { buildSemanticEvidence } = require('./engine/semantic-evidence.cjs');
const { validateSemanticRoute } = require('./engine/semantic-route-guard.cjs');
const { applySemanticGuardEnforcement } = require('./engine/semantic-guard-enforcement.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');

const parsed = JSON.parse(fs.readFileSync('./data/knowledge.json', 'utf8'));
const knowledge = Array.isArray(parsed) ? parsed : parsed.items || parsed.knowledge || [];
const ruleEngine = new ExpertRuleEngine('./data/rules/expert-rules.json');
const originalFlag = process.env.SEMANTIC_GUARD_ENFORCEMENT;
const ask = (question, history = []) => createAnswer({ question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {} });

function restoreFlag() {
  if (originalFlag === undefined) delete process.env.SEMANTIC_GUARD_ENFORCEMENT;
  else process.env.SEMANTIC_GUARD_ENFORCEMENT = originalFlag;
}

try {
  delete process.env.SEMANTIC_GUARD_ENFORCEMENT;
  const shadow = ask('ránc');
  assert.equal(shadow.route, 'exact_product');
  assert.equal(shadow.routing.semanticGuard.enforcementEnabled, false);
  assert.equal(shadow.routing.semanticGuard.enforcementEligible, true);
  assert.equal(shadow.routing.semanticGuard.enforcementApplied, false);
  assert.equal(shadow.links.length, 1);

  process.env.SEMANTIC_GUARD_ENFORCEMENT = 'true';
  const blocked = ask('ránc');
  assert.equal(blocked.routing.semanticGuard.originalRoute.route, 'exact_product');
  assert.equal(blocked.routing.semanticGuard.decision, 'REJECT');
  assert.equal(blocked.routing.semanticGuard.hardConflict, true);
  assert(blocked.routing.semanticGuard.reasonCodes.includes('EXACT_MATCH_SUBSTRING_ONLY'));
  assert.equal(blocked.routing.semanticGuard.enforcementEligible, true);
  assert.equal(blocked.routing.semanticGuard.enforcementApplied, true);
  assert.equal(blocked.route, 'clarification');
  assert.equal(blocked.routing.semanticGuard.resolvedRoute.route, 'clarification');
  assert.match(blocked.answer, /Nem találtam biztos termékegyezést/);
  assert.deepEqual(blocked.links, []);
  assert.equal(blocked.targetProductId, undefined);

  const history = [
    { role: 'user', content: 'ránc' },
    { role: 'assistant', content: blocked.answer, route: blocked.route, intent: blocked.intent, targetProductId: blocked.targetProductId, links: blocked.links }
  ];
  const state = structuredState(history);
  assert.equal(state.focusedProductId, null);
  assert.equal(state.purchaseProductId, null);
  assert.equal(state.productContextStatus, 'unresolved');
  const followup = ask('mit tud?', history);
  assert.notEqual(followup.contextTarget, '111374977');
  assert.equal((followup.links || []).some((link) => link.id === '111374977'), false);

  const valid = ask('Dermavital krém');
  assert.equal(valid.route, 'exact_product');
  assert.equal(valid.routing.semanticGuard.decision, 'ACCEPT');
  assert.equal(valid.routing.semanticGuard.enforcementApplied, false);
  assert(valid.links.some((link) => link.id === 'dermavital_krem'));

  const safetyRouting = { route: 'safety', intent: 'medical_escalation', safetyClass: 'medical_escalation', responseSource: 'safety-gate' };
  const forcedConflict = { decision: 'REJECT', enforcement: 'MANDATORY_ESCALATION', resolutionOwner: 'safety', hardConflict: true, reasonCodes: ['EXACT_MATCH_SUBSTRING_ONLY'] };
  const safety = applySemanticGuardEnforcement({ routing: safetyRouting, guard: forcedConflict, enabled: true });
  assert.equal(safety.routing.route, 'safety');
  assert.equal(safety.telemetry.enforcementApplied, false);

  for (const question of ['kifingottam egy ekcemat', 'tegnap vacsoraztam egy szappant', 'tegnap leugrottam egy 3 emeletes szallitasrol']) {
    const result = ask(question);
    assert.equal(result.routing.semanticGuard.decision, 'REJECT', question);
    assert.equal(result.routing.semanticGuard.enforcementEligible, false, question);
    assert.equal(result.routing.semanticGuard.enforcementApplied, false, question);
    assert.equal(result.route, result.routing.semanticGuard.originalRoute.route, question);
  }

  const matrix = ['ránc', 'ráncos bőr', 'ránctalanítás', 'rác', 'rácok', 'narancs', 'narancsos'];
  for (const question of matrix) {
    const selected = routeAnswer({ question, history: [], knowledge, ruleEngine });
    const evidence = buildSemanticEvidence({ question, routing: selected, history: [] });
    const guard = validateSemanticRoute({ routing: selected, evidence });
    const resolved = applySemanticGuardEnforcement({ routing: selected, guard, enabled: true });
    const expected = selected.route === 'exact_product' && guard.decision === 'REJECT' && guard.hardConflict && guard.reasonCodes.includes('EXACT_MATCH_SUBSTRING_ONLY');
    assert.equal(resolved.telemetry.enforcementApplied, expected, question);
    if (!expected) assert.equal(resolved.routing.route, selected.route, question);
  }
} finally {
  restoreFlag();
}

console.log('Semantic Guard Phase B0 controlled enforcement: PASS');
