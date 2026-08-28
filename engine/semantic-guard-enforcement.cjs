'use strict';

const B0_REASON = 'EXACT_MATCH_SUBSTRING_ONLY';
const B1_REASON = 'SEMANTIC_ROLE_MISMATCH';
const B1_ROUTE_ALLOWLIST = new Set(['expert_rule', 'product_category', 'commerce']);
const ENFORCEMENT_CLASSES = Object.freeze({
  B0: 'exact_product_substring',
  B1: 'semantic_role_mismatch'
});

function enforcementEnabled(value = process.env.SEMANTIC_GUARD_ENFORCEMENT) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function phaseB0Eligible(routing = {}, guard = {}) {
  return routing.route === 'exact_product'
    && guard.decision === 'REJECT'
    && guard.hardConflict === true
    && Array.isArray(guard.reasonCodes)
    && guard.reasonCodes.includes(B0_REASON);
}

function phaseB1Eligible(routing = {}, guard = {}) {
  const ownershipExcluded = ['safety', 'complaint', 'customer_service', 'context'].includes(guard.resolutionOwner)
    || guard.suggestedCapability != null;
  return B1_ROUTE_ALLOWLIST.has(routing.route)
    && guard.decision === 'REJECT'
    && guard.hardConflict === true
    && Array.isArray(guard.reasonCodes)
    && guard.reasonCodes.includes(B1_REASON)
    && !ownershipExcluded;
}

function safetyProtected(routing = {}, guard = {}) {
  return routing.route === 'safety'
    || routing.safetyClass === 'medical_escalation'
    || guard.enforcement === 'MANDATORY_ESCALATION'
    || guard.resolutionOwner === 'safety';
}

function clarificationResolution(routing, enforcementClass) {
  const b1 = enforcementClass === ENFORCEMENT_CLASSES.B1;
  return {
    ...routing,
    route: 'clarification',
    intent: b1 ? 'conversation_clarification' : 'product_detail',
    goal: b1 ? 'clarify_request' : 'find_product',
    domain: b1 ? 'general' : 'product',
    contextUsed: false,
    contextTarget: b1 ? 'semantic_role_mismatch' : 'semantic_product_match',
    matchedCanonicalIds: [],
    matchedProductIds: [],
    primaryProductId: null,
    targetProductId: null,
    focusedProductId: null,
    purchaseProductId: null,
    recommendedProductIds: [],
    matchedRuleId: null,
    matchedKnowledgeIds: [],
    confidence: 1,
    threshold: 1,
    rejectionReasons: [...new Set([...(routing.rejectionReasons || []), b1 ? B1_REASON : B0_REASON])],
    responseSource: 'semantic-guard-enforcement',
    candidateCount: 0
  };
}

function applySemanticGuardEnforcement({ routing = {}, guard = {}, enabled } = {}) {
  const active = enabled === undefined ? enforcementEnabled() : enabled === true;
  // Enforcement classes are deliberately enumerated. A new Guard reason code
  // remains shadow-only until it receives its own explicit policy entry here.
  const enforcementClass = phaseB0Eligible(routing, guard)
    ? ENFORCEMENT_CLASSES.B0
    : phaseB1Eligible(routing, guard)
      ? ENFORCEMENT_CLASSES.B1
      : null;
  const eligible = enforcementClass !== null;
  const protectedBySafety = safetyProtected(routing, guard);
  const applied = active && eligible && !protectedBySafety;
  const resolvedRouting = applied ? clarificationResolution(routing, enforcementClass) : routing;
  const telemetry = {
    ...guard,
    enforcementClass,
    enforcementEnabled: active,
    enforcementEligible: eligible,
    enforcementApplied: applied,
    resolvedRoute: {
      route: resolvedRouting.route || null,
      goal: resolvedRouting.goal || null,
      intent: resolvedRouting.intent || null,
      domain: resolvedRouting.domain || null,
      source: resolvedRouting.responseSource || null
    }
  };
  return { routing: { ...resolvedRouting, semanticGuard: telemetry }, telemetry };
}

module.exports = {
  B0_REASON,
  B1_REASON,
  B1_ROUTE_ALLOWLIST,
  ENFORCEMENT_CLASSES,
  enforcementEnabled,
  phaseB0Eligible,
  phaseB1Eligible,
  safetyProtected,
  applySemanticGuardEnforcement
};
