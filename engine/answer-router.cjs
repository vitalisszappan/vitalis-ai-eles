'use strict';

const { normalize } = require('./normalizer.cjs');
const { detectCustomerGoal } = require('./customer-goal.cjs');
const { detectCommerceIntent } = require('./commerce-intents.cjs');
const { detectProblemIntent } = require('./problem-intents.cjs');
const { evaluateSafety } = require('./safety-gate.cjs');
const { createCatalogSearch } = require('./catalog-search.cjs');
const { evaluateKnowledgeConfidence } = require('./routing-confidence.cjs');
const { buildConversationContext, resolveProductReference } = require('./conversation-context.cjs');
const { findProductInText } = require('./product-faq.cjs');
const { resolveMetaIntent } = require('./meta-intents.cjs');
const { searchKnowledge } = require('./knowledge-fallback.cjs');
const {detectProductTypeConstraint}=require('./product-type-constraint.cjs');

const catalog = createCatalogSearch();

function decision(overrides = {}) {
  return {
    route: 'hard_fallback', intent: null, goal: 'unknown', domain: null, safetyClass: 'safe',
    contextUsed: false, contextTarget: null, matchedCanonicalIds: [], matchedProductIds: [],
    matchedRuleId: null, matchedKnowledgeIds: [], evidence: [], confidence: 0,
    threshold: 1, rejectionReasons: [], responseSource: 'hard-fallback', candidateCount: 0, ...overrides
  };
}

function routeAnswer({ question, history = [], knowledge = [], ruleEngine, conversationState = null }) {
  const goal = detectCustomerGoal(question);
  const problem = detectProblemIntent(question);
  const safety = evaluateSafety(question, problem);
  const derivedContext = buildConversationContext(history, normalize);
  const context = conversationState ? {...derivedContext,lastRecommendedProducts:conversationState.lastOrdinalProductList||conversationState.lastRecommendedProducts||[],lastFocusProduct:conversationState.lastMentionedProduct,lastProduct:conversationState.lastMentionedProduct,lastProblemDomain:conversationState.activeProblemDomains?.at(-1)||derivedContext.lastProblemDomain} : derivedContext;
  const productTypeConstraint=detectProductTypeConstraint(question);
  const base = { goal: goal.goal, intent: goal.intent, domain: goal.domain || problem?.domain || null, safetyClass: safety.safetyClass, evidence: [...goal.evidence, ...(problem?.evidence || []), ...safety.evidence], productTypeConstraint };

  const meta = resolveMetaIntent(question);
  if (meta) return decision({ ...base, route: 'meta', intent: meta.intent, goal: 'unknown', domain: 'meta', matchedRuleId: meta.ruleId, confidence: 1, threshold: 1, responseSource: 'meta-intent' });

  if (safety.safetyClass === 'medical_escalation') {
    return decision({ ...base, route: 'safety', goal: 'medical_boundary', intent: 'medical_escalation', confidence: 1, threshold: 1, responseSource: 'safety-gate' });
  }
  if (safety.safetyClass === 'caution_with_boundary') {
    return decision({ ...base, route: 'safety', goal: 'medical_boundary', intent: 'cosmetic_boundary', confidence: 1, threshold: 1, responseSource: 'safety-gate' });
  }

  const directCanonical = findProductInText(normalize(question));
  const commerce = detectCommerceIntent(question);
  if (commerce) {
    const needsProduct = ['price_query', 'availability_query'].includes(commerce.intent);
    const commerceTarget = directCanonical || context.lastFocusProduct;
    if (needsProduct && !commerceTarget) {
      return decision({ ...base, route: 'clarification', contextUsed: history.length > 0, contextTarget: 'product', confidence: 1, threshold: 1, rejectionReasons: ['missing_product_argument'], responseSource: 'commerce-clarification' });
    }
    return decision({ ...base, route: 'commerce', contextUsed: needsProduct && !directCanonical, contextTarget: needsProduct ? commerceTarget : null, matchedProductIds: needsProduct ? [commerceTarget] : [], confidence: 1, threshold: 1, responseSource: 'commerce-intent' });
  }

  if (/\b(sls|sles|sodium lauryl sulfate|sodium laureth sulfate)\b/.test(normalize(question))) {
    return decision({ ...base, route: 'expert_rule', intent: 'ingredient-question', matchedRuleId: 'sls-sles-free', confidence: 1, threshold: 1, responseSource: 'expert-sls-sles' });
  }

  const attributeIntent=/\b(osszetevo\w*|inci)\b/.test(normalize(question))?'ingredients':/\b(illat\w*)\b/.test(normalize(question))?'scent':null;
  if(attributeIntent&&(directCanonical||catalog.findExactProduct(question))){const matches=searchKnowledge(knowledge,question),assessed=evaluateKnowledgeConfidence(question,matches,{domain:'product',intent:attributeIntent,context});if(assessed.accepted)return decision({...base,route:'knowledge',intent:attributeIntent,domain:'product',matchedKnowledgeIds:[matches[0].item.id],confidence:assessed.confidence,threshold:assessed.threshold,evidence:[...base.evidence,`attribute:${attributeIntent}`],responseSource:'knowledge-fallback'});return decision({...base,route:'hard_fallback',intent:attributeIntent,domain:'product',candidateCount:matches.length,confidence:assessed.confidence,threshold:assessed.threshold,rejectionReasons:['knowledge_missing'],evidence:[...base.evidence,`attribute:${attributeIntent}`],responseSource:'hard-fallback'});}

  const reference = resolveProductReference(question, context);
  if (reference?.productId) {
    return decision({ ...base, route: 'context_followup', contextUsed: true, contextTarget: reference.productId, matchedCanonicalIds: [reference.productId], matchedProductIds: [reference.productId], confidence: 1, threshold: 1, responseSource: 'conversation-context' });
  }
  if (reference?.ambiguous) {
    return decision({ ...base, route: 'clarification', contextUsed: true, contextTarget: 'product', confidence: 1, threshold: 1, rejectionReasons: ['ambiguous_product_reference'], responseSource: 'conversation-context' });
  }
  const current = normalize(question);
  const typedFollowup = /^(es\s+)?(szappant?|kremet?|balzsamot?|sampont?)\b/.exec(current);
  if (typedFollowup && context.lastRecommendedProducts.length) {
    const rawType = typedFollowup[2];
    const type = rawType.startsWith('szappan') ? 'szappan' : rawType.startsWith('sampon') ? 'sampon' : rawType.startsWith('krem') ? 'krem' : 'balzsam';
    const candidates = context.lastRecommendedProducts.filter((id) => normalize(id).includes(type));
    if (candidates.length === 1) return decision({ ...base, route: 'context_followup', contextUsed: true, contextTarget: candidates[0], matchedCanonicalIds: candidates, matchedProductIds: candidates, confidence: 1, threshold: 1, responseSource: 'conversation-context' });
    if (candidates.length > 1) return decision({ ...base, route: 'clarification', intent: 'conversation-clarification', contextUsed: true, contextTarget: 'product', matchedCanonicalIds: candidates, matchedProductIds: candidates, confidence: 1, threshold: 1, rejectionReasons: ['ambiguous_product_type'], responseSource: 'conversation-context' });
  }
  if (['clarify_previous_answer', 'compare_products', 'ask_usage', 'ask_child_usage', 'ask_variant'].includes(goal.goal)) {
    const target = directCanonical || context.lastFocusProduct;
    if (goal.goal === 'clarify_previous_answer' && history.length) {
      return decision({ ...base, route: 'context_followup', contextUsed: true, contextTarget: target || context.lastProblemDomain || 'previous_answer', matchedProductIds: target ? [target] : [], confidence: 1, threshold: 1, responseSource: 'conversation-context' });
    }
    if (target) return decision({ ...base, route: 'context_followup', contextUsed: true, contextTarget: target, matchedCanonicalIds: [target], matchedProductIds: [target], confidence: 1, threshold: 1, responseSource: 'conversation-context' });
    return decision({ ...base, route: 'clarification', contextUsed: history.length > 0, contextTarget: 'product', confidence: 1, threshold: 1, rejectionReasons: ['missing_product_context'], responseSource: 'conversation-context' });
  }

  const expert = ruleEngine?.resolve(question, history) || null;
  if (expert?.source === 'admin-intent') {
    return decision({ ...base, route: 'commerce', intent: expert.intent, goal: goal.goal === 'unknown' ? 'ask_shipping' : goal.goal, matchedRuleId: expert.ruleId, confidence: 1, threshold: 1, responseSource: 'admin-intent' });
  }
  if (expert) {
    return decision({ ...base, route: 'expert_rule', intent: expert.intent, matchedRuleId: expert.ruleId, matchedProductIds: (expert.links || []).map((item) => item.id).filter(Boolean), confidence: 1, threshold: 1, responseSource: expert.source });
  }
  if (directCanonical) {
    return decision({ ...base, route: 'exact_product', goal: 'find_product', intent: 'product_detail', domain: 'product', matchedCanonicalIds: [directCanonical], matchedProductIds: [directCanonical], confidence: 1, threshold: 1, responseSource: 'product-context' });
  }
  const category = catalog.detectCategory(question);
  const exactCatalogProduct = category ? null : catalog.findExactProduct(question);
  if (exactCatalogProduct) {
    return decision({ ...base, route: 'exact_product', goal: 'find_product', intent: 'product_detail', domain: 'product', matchedProductIds: [exactCatalogProduct.id], evidence: [...base.evidence, `catalog-product:${exactCatalogProduct.sku}`], confidence: 1, threshold: 1, responseSource: 'unas-catalog' });
  }

  if (category && goal.goal !== 'solve_problem') {
    const found = catalog.searchCategory(category.id);
    return decision({ ...base, route: 'product_category', intent: found.products.length ? 'catalog_category_found' : 'catalog_category_absent', goal: 'find_product', domain: category.id, matchedProductIds: found.products.map((item) => item.id), evidence: [...base.evidence, `catalog-category:${category.id}`], confidence: 1, threshold: 1, rejectionReasons: found.products.length ? [] : ['catalog_category_absent'], responseSource: found.products.length ? 'unas-catalog' : 'catalog-absent' });
  }

  if (problem) {
    return decision({ ...base, route: 'problem_domain', intent: 'problem_recommendation', confidence: 1, threshold: 1, responseSource: 'problem-domain' });
  }

  const matches = searchKnowledge(knowledge, question);
  const assessed = evaluateKnowledgeConfidence(question, matches, { domain: base.domain, intent: base.intent, context });
  if (assessed.accepted) {
    return decision({ ...base, route: 'knowledge', matchedKnowledgeIds: [matches[0].item.id], confidence: assessed.confidence, threshold: assessed.threshold, evidence: [...base.evidence, `knowledge-score:${matches[0].score}`], responseSource: 'knowledge-fallback' });
  }
  const aliasSuspected = matches.length === 0 && /\b(szappan|sampon|krem|balzsam|dezodor|termek)\b/.test(current);
  return decision({ ...base, route: 'hard_fallback', candidateCount: matches.length, confidence: assessed.confidence, threshold: assessed.threshold, evidence: aliasSuspected ? [...base.evidence, 'alias-suspected'] : base.evidence, rejectionReasons: aliasSuspected ? ['alias_missing'] : assessed.rejectionReasons.length ? assessed.rejectionReasons : ['knowledge_gap'], responseSource: 'hard-fallback' });
}

module.exports = { routeAnswer, createRoutingDecision: decision };
