'use strict';

const B0_REASON = 'EXACT_MATCH_SUBSTRING_ONLY';

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

function safetyProtected(routing = {}, guard = {}) {
  return routing.route === 'safety'
    || routing.safetyClass === 'medical_escalation'
    || guard.enforcement === 'MANDATORY_ESCALATION'
    || guard.resolutionOwner === 'safety';
}

function clarificationResolution(routing) {
  return {
    ...routing,
    route: 'clarification',
    intent: 'product_detail',
    goal: 'find_product',
    domain: 'product',
    contextUsed: false,
    contextTarget: 'semantic_product_match',
    matchedCanonicalIds: [],
    matchedProductIds: [],
    primaryProductId: null,
    matchedRuleId: null,
    matchedKnowledgeIds: [],
    confidence: 1,
    threshold: 1,
    rejectionReasons: [...new Set([...(routing.rejectionReasons || []), B0_REASON])],
    responseSource: 'semantic-guard-enforcement',
    candidateCount: 0
  };
}

function applySemanticGuardEnforcement({ routing = {}, guard = {}, enabled } = {}) {
  const active = enabled === undefined ? enforcementEnabled() : enabled === true;
  const eligible = phaseB0Eligible(routing, guard);
  const protectedBySafety = safetyProtected(routing, guard);
  const applied = active && eligible && !protectedBySafety;
  const resolvedRouting = applied ? clarificationResolution(routing) : routing;
  const telemetry = {
    ...guard,
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

module.exports = { B0_REASON, enforcementEnabled, phaseB0Eligible, safetyProtected, applySemanticGuardEnforcement };
