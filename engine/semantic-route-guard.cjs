'use strict';

const { isP0ComplaintEligible } = require('./complaint-intents.cjs');

const DECISIONS = new Set(['ACCEPT', 'REJECT', 'UNCERTAIN']);

function result({ decision, enforcement = 'ALLOW', resolutionOwner = 'router', strength, hardConflict = false, reasonCodes = [], contextUsed = false, trust, routing, suggestedCapability = null, complaint = null, timingMs = 0 }) {
  if (!DECISIONS.has(decision)) throw new TypeError('invalid semantic guard decision');
  return {
    decision, enforcement, resolutionOwner,
    evidenceStrength: strength,
    hardConflict,
    reasonCodes: [...new Set(reasonCodes)],
    semantic: { decision, evidenceStrength: strength, hardConflict, reasonCodes: [...new Set(reasonCodes)] },
    contextUsed,
    contextTrustRecommendation: trust || (decision === 'ACCEPT' ? 'TRUST' : decision === 'REJECT' ? 'DO_NOT_TRUST' : 'CONDITIONAL'),
    originalRoute: { route: routing.route || null, goal: routing.goal || null, intent: routing.intent || null, domain: routing.domain || null, source: routing.responseSource || null },
    suggestedCapability,
    complaint,
    timingMs
  };
}

function validateSemanticRoute({ routing = {}, evidence } = {}) {
  const started = process.hrtime.bigint();
  const done = (value) => result({ ...value, routing, complaint: evidence?.complaint || null, timingMs: Number(process.hrtime.bigint() - started) / 1e6 });
  if (!evidence) return done({ decision: 'UNCERTAIN', strength: 'none', reasonCodes: ['INSUFFICIENT_EVIDENCE'], resolutionOwner: 'fallback' });
  const { utterance, signals, context } = evidence;

  if (signals.safety.strong) return done({ decision: 'ACCEPT', enforcement: 'MANDATORY_ESCALATION', resolutionOwner: 'safety', strength: 'strong', reasonCodes: ['STRONG_SAFETY_NON_DOWNGRADE'], trust: 'TRUST' });
  if (routing.route === 'safety') return done({ decision: 'ACCEPT', enforcement: 'ALLOW', resolutionOwner: 'safety', strength: 'sufficient', reasonCodes: ['SAFETY_ROUTE_PRESERVED'], trust: 'TRUST' });

  if (signals.generalCatalogGap && routing.route === 'hard_fallback') return done({ decision: 'REJECT', enforcement: 'BLOCK', resolutionOwner: 'router', strength: 'strong', hardConflict: true, reasonCodes: ['ROUTER_CAPABILITY_MISSING'], suggestedCapability: 'general_catalog' });
  if (signals.customerServiceGap && routing.route === 'hard_fallback') return done({ decision: 'REJECT', enforcement: 'BLOCK', resolutionOwner: 'customer_service', strength: 'strong', hardConflict: true, reasonCodes: ['ROUTER_CAPABILITY_MISSING'], suggestedCapability: signals.customerServiceGap });
  if (signals.informationalQuery && ['expert_rule', 'problem_domain'].includes(routing.route)) return done({ decision: 'REJECT', enforcement: 'BLOCK', resolutionOwner: 'router', strength: 'strong', hardConflict: true, reasonCodes: ['ROUTER_CAPABILITY_MISSING', 'INFORMATIONAL_QUERY_MISMATCH'], suggestedCapability: 'informational_problem' });

  if (evidence.complaint && evidence.complaint.polarity !== 'negative') {
    if (evidence.complaint.severity === 'critical' || evidence.complaint.severity === 'high') return done({ decision: 'REJECT', enforcement: 'MANDATORY_ESCALATION', resolutionOwner: 'safety', strength: 'strong', hardConflict: true, reasonCodes: ['SAFETY_OVERRIDE', 'COMPLAINT_DETECTED'], trust: 'DO_NOT_TRUST' });
    if (isP0ComplaintEligible(evidence.complaint, routing)) return done({ decision: 'REJECT', enforcement: 'BLOCK', resolutionOwner: 'complaint', strength: 'strong', hardConflict: true, reasonCodes: ['COMPLAINT_OVERRIDES_RECOMMENDATION'], trust: 'DO_NOT_TRUST' });
  }

  if (routing.route === 'exact_product') {
    if (routing.matchedCanonicalIds?.length) return done({ decision: 'ACCEPT', strength: 'strong', reasonCodes: ['ROUTE_SUPPORTED_BY_APPROVED_ALIAS'], resolutionOwner: 'router' });
    if (utterance.tokenCount === 1 && utterance.tokens[0].length <= 4) return done({ decision: 'REJECT', enforcement: 'BLOCK', resolutionOwner: 'router', strength: 'strong', hardConflict: true, reasonCodes: ['EXACT_MATCH_SUBSTRING_ONLY'], trust: 'DO_NOT_TRUST' });
    if (signals.unsupportedAssertion) return done({ decision: 'REJECT', enforcement: 'BLOCK', resolutionOwner: 'router', strength: 'strong', hardConflict: true, reasonCodes: ['SEMANTIC_ROLE_MISMATCH'], trust: 'DO_NOT_TRUST' });
    return done({ decision: 'UNCERTAIN', strength: 'weak', reasonCodes: ['EXACT_MATCH_EVIDENCE_INCOMPLETE'], resolutionOwner: 'router' });
  }

  if (routing.route === 'commerce') {
    if (signals.unsupportedAssertion || (signals.exclusion && /nem (a )?szallitas|nem akarok rendelni/.test(utterance.normalized))) return done({ decision: 'REJECT', enforcement: 'BLOCK', resolutionOwner: 'router', strength: 'strong', hardConflict: true, reasonCodes: [signals.exclusion ? 'NEGATED_DOMAIN' : 'SEMANTIC_ROLE_MISMATCH'] });
    if (utterance.minimalDomain || signals.commerceInformation || signals.purchase) return done({ decision: 'ACCEPT', strength: 'strong', reasonCodes: [utterance.minimalDomain ? 'ROUTE_SUPPORTED_BY_MINIMAL_QUERY' : 'ROUTE_SUPPORTED_BY_QUERY_STRUCTURE'], resolutionOwner: 'router' });
    return done({ decision: 'UNCERTAIN', strength: 'weak', reasonCodes: ['DOMAIN_TOKEN_ONLY'], resolutionOwner: 'router' });
  }

  if (routing.route === 'product_category') {
    if (signals.unsupportedAssertion) return done({ decision: 'REJECT', enforcement: 'BLOCK', resolutionOwner: 'router', strength: 'strong', hardConflict: true, reasonCodes: ['SEMANTIC_ROLE_MISMATCH'] });
    if (signals.exclusion && /\bnem\b.*\b(szappan|sampon|krem|balzsam)\w*/.test(utterance.normalized)) return done({ decision: 'REJECT', enforcement: 'BLOCK', resolutionOwner: 'router', strength: 'strong', hardConflict: true, reasonCodes: ['EXCLUDED_PRODUCT_TYPE'] });
    if (utterance.minimalDomain || signals.catalogLookup) return done({ decision: 'ACCEPT', strength: 'strong', reasonCodes: [utterance.minimalDomain ? 'ROUTE_SUPPORTED_BY_MINIMAL_QUERY' : 'ROUTE_SUPPORTED_BY_QUERY_STRUCTURE'], resolutionOwner: 'router' });
    return done({ decision: 'UNCERTAIN', strength: 'weak', reasonCodes: ['DOMAIN_TOKEN_ONLY'], resolutionOwner: 'router' });
  }

  if (['expert_rule', 'problem_domain'].includes(routing.route)) {
    if (signals.unsupportedAssertion || (signals.exclusion && /\b(nem|nincs)\b.*\b(ekcema\w*|pikkelysomor\w*|akne\w*|rosacea\w*)/.test(utterance.normalized))) return done({ decision: 'REJECT', enforcement: 'BLOCK', resolutionOwner: 'router', strength: 'strong', hardConflict: true, reasonCodes: [signals.exclusion ? 'NEGATED_DOMAIN' : 'SEMANTIC_ROLE_MISMATCH'] });
    if (utterance.minimalDomain || signals.problemRequest) return done({ decision: 'ACCEPT', strength: 'strong', reasonCodes: [utterance.minimalDomain ? 'ROUTE_SUPPORTED_BY_MINIMAL_QUERY' : 'ROUTE_SUPPORTED_BY_QUERY_STRUCTURE'], resolutionOwner: 'router' });
    return done({ decision: 'UNCERTAIN', strength: 'weak', reasonCodes: ['DOMAIN_TOKEN_ONLY'], resolutionOwner: 'router' });
  }

  if (signals.topicSwitch && routing.contextUsed) return done({ decision: 'REJECT', enforcement: 'BLOCK', resolutionOwner: 'context', strength: 'strong', hardConflict: true, reasonCodes: ['TOPIC_SWITCH'], trust: 'DO_NOT_TRUST' });
  if (routing.contextUsed && context.available) return done({ decision: 'ACCEPT', strength: 'sufficient', reasonCodes: ['ROUTE_SUPPORTED_BY_CONTEXT'], resolutionOwner: 'context', contextUsed: true });
  if (routing.route === 'hard_fallback') return done({ decision: 'ACCEPT', strength: 'sufficient', reasonCodes: ['CURRENT_ROUTE_ALREADY_SAFE'], resolutionOwner: 'fallback', trust: 'CONDITIONAL' });
  if (routing.route === 'knowledge') return done({ decision: 'ACCEPT', strength: 'sufficient', reasonCodes: ['ROUTE_SUPPORTED_BY_RETRIEVAL'], resolutionOwner: 'knowledge' });
  return done({ decision: 'ACCEPT', strength: 'sufficient', reasonCodes: ['NO_SEMANTIC_CONFLICT'], resolutionOwner: 'router' });
}

module.exports = { validateSemanticRoute };
