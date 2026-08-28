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
const {detectExcludedProductTypes,detectProductTypeConstraint,inferredHairType,HAIR_WASH_TYPES}=require('./product-type-constraint.cjs');
const {isTypeComparison}=require('./hair-wash-products.cjs');
const {determineAnswerMode}=require('./answer-mode.cjs');
const {detectProductQuestionIntent}=require('./product-question-intent.cjs');

const catalog = createCatalogSearch();

function decision(overrides = {}) {
  return {
    route: 'hard_fallback', intent: null, goal: 'unknown', domain: null, safetyClass: 'safe',
    contextUsed: false, contextTarget: null, matchedCanonicalIds: [], matchedProductIds: [], primaryProductId: null,
    matchedRuleId: null, matchedKnowledgeIds: [], evidence: [], confidence: 0,
    threshold: 1, rejectionReasons: [], responseSource: 'hard-fallback', candidateCount: 0, ...overrides
  };
}

function routeAnswerCore({ question, history = [], knowledge = [], ruleEngine, conversationState = null }) {
  const goal = detectCustomerGoal(question);
  const productQuestionIntent = detectProductQuestionIntent(question);
  const problem = detectProblemIntent(question);
  const safety = evaluateSafety(question, problem);
  const derivedContext = buildConversationContext(history, normalize);
  const context = conversationState ? {...derivedContext,lastRecommendedProducts:conversationState.lastOrdinalProductList||conversationState.lastRecommendedProducts||[],lastSelectedProduct:conversationState.selectedProductId??derivedContext.lastSelectedProduct,lastFocusProduct:Object.hasOwn(conversationState,'focusedProductId')?conversationState.focusedProductId:conversationState.lastMentionedProduct,lastProduct:Object.hasOwn(conversationState,'focusedProductId')?conversationState.focusedProductId:conversationState.lastMentionedProduct,purchaseProductId:Object.hasOwn(conversationState,'purchaseProductId')?conversationState.purchaseProductId:derivedContext.lastFocusProduct,productContextStatus:conversationState.productContextStatus||derivedContext.productContextStatus,lastProblemDomain:conversationState.activeProblemDomains?.at(-1)||derivedContext.lastProblemDomain} : {...derivedContext,purchaseProductId:derivedContext.productContextStatus==='ambiguous'?null:derivedContext.lastFocusProduct};
  const excludedProductTypes=detectExcludedProductTypes(question);
  let productTypeConstraint=detectProductTypeConstraint(question);
  if (!productTypeConstraint && productQuestionIntent === 'recommendation' && /\b(zsiros\w* haj\w*|gyorsan zsiros\w*)\b/.test(normalize(question))) productTypeConstraint = 'solid_shampoo';
  if (!productTypeConstraint && /\b(ajanl\w*|javasol\w*|melyiket|mit valassz\w*)\b/.test(normalize(question))) {
    const rememberedTypes = [...new Set((context.lastRecommendedProducts || []).map((id) => inferredHairType({ id })).filter(Boolean))];
    const allowedRememberedTypes=rememberedTypes.filter((type)=>!excludedProductTypes.includes(type)&&!excludedProductTypes.includes('shampoo'));
    if (allowedRememberedTypes.length === 1 && HAIR_WASH_TYPES.includes(allowedRememberedTypes[0])) productTypeConstraint = allowedRememberedTypes[0];
  }
  const base = { goal: goal.goal, intent: goal.intent, domain: goal.domain || problem?.domain || null, safetyClass: safety.safetyClass, evidence: [...goal.evidence, ...(problem?.evidence || []), ...safety.evidence], excludedProductTypes, productTypeConstraint, productQuestionIntent };

  const meta = resolveMetaIntent(question);
  if (meta) return decision({ ...base, route: 'meta', intent: meta.intent, goal: 'unknown', domain: 'meta', matchedRuleId: meta.ruleId, confidence: 1, threshold: 1, responseSource: 'meta-intent' });
  if(isTypeComparison(question))return decision({...base,route:'hair_type_knowledge',intent:'product_type_comparison',goal:'compare_products',domain:'hair_wash',matchedRuleId:'solid-shampoo-vs-shampoo-soap',confidence:1,threshold:1,responseSource:'approved-knowledge'});

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
    const purchaseReference = commerce.intent === 'order_start' ? resolveProductReference(question, context) : null;
    if (commerce.intent === 'order_start' && !directCanonical && (purchaseReference?.ambiguous || (context.productContextStatus === 'ambiguous' && purchaseReference?.resolvedFrom !== 'ordered_list'))) {
      return decision({ ...base, route: 'clarification', intent: commerce.intent, contextUsed: true, contextTarget: 'product', confidence: 1, threshold: 1, rejectionReasons: ['ambiguous_product_reference'], responseSource: 'conversation-context' });
    }
    const purchaseScoped = ['order_start', 'checkout_problem'].includes(commerce.intent);
    const commerceTarget = directCanonical || purchaseReference?.productId || (purchaseScoped ? context.purchaseProductId : context.lastFocusProduct);
    if (needsProduct && !commerceTarget) {
      return decision({ ...base, route: 'clarification', contextUsed: history.length > 0, contextTarget: 'product', confidence: 1, threshold: 1, rejectionReasons: ['missing_product_argument'], responseSource: 'commerce-clarification' });
    }
    const usesOptionalTarget = ['order_start', 'checkout_problem'].includes(commerce.intent) && Boolean(commerceTarget);
    return decision({ ...base, route: 'commerce', contextUsed: (needsProduct || usesOptionalTarget) && !directCanonical, contextTarget: (needsProduct || usesOptionalTarget) ? commerceTarget : null, matchedProductIds: (needsProduct || usesOptionalTarget) ? [commerceTarget] : [], confidence: 1, threshold: 1, responseSource: 'commerce-intent' });
  }

  if (/\b(sls|sles|sodium lauryl sulfate|sodium laureth sulfate)\b/.test(normalize(question))) {
    return decision({ ...base, route: 'expert_rule', intent: 'ingredient-question', matchedRuleId: 'sls-sles-free', confidence: 1, threshold: 1, responseSource: 'expert-sls-sles' });
  }

  const attributeIntent=/\b(osszetevo\w*|inci)\b/.test(normalize(question))?'ingredients':/\b(illat\w*)\b/.test(normalize(question))?'scent':null;
  if(attributeIntent&&(directCanonical||catalog.findExactProduct(question))){const matches=searchKnowledge(knowledge,question),assessed=evaluateKnowledgeConfidence(question,matches,{domain:'product',intent:attributeIntent,context});if(assessed.accepted)return decision({...base,route:'knowledge',intent:attributeIntent,domain:'product',matchedKnowledgeIds:[matches[0].item.id],confidence:assessed.confidence,threshold:assessed.threshold,evidence:[...base.evidence,`attribute:${attributeIntent}`],responseSource:'knowledge-fallback'});return decision({...base,route:'hard_fallback',intent:attributeIntent,domain:'product',candidateCount:matches.length,confidence:assessed.confidence,threshold:assessed.threshold,rejectionReasons:['knowledge_missing'],evidence:[...base.evidence,`attribute:${attributeIntent}`],responseSource:'hard-fallback'});}

  const genericShampooAvailability=!productTypeConstraint&&productQuestionIntent==='availability'&&/\bsampon\w*/.test(normalize(question));
  const explicitHairProductRequest=HAIR_WASH_TYPES.includes(productTypeConstraint)&&/\b(keres\w*|szeretn\w*)\b/.test(normalize(question));
  if((HAIR_WASH_TYPES.includes(productTypeConstraint)&&(['availability','recommendation'].includes(productQuestionIntent)||problem))||explicitHairProductRequest||genericShampooAvailability)return decision({...base,route:'hair_product_type',intent:productQuestionIntent==='availability'?'product_type_availability':'product_recommendation',goal:'find_product',domain:'shampoo',confidence:1,threshold:1,responseSource:'approved-product-type-rule'});

  const reference = resolveProductReference(question, context);
  if (reference?.productId) {
    return decision({ ...base, route: 'context_followup', contextUsed: true, contextTarget: reference.productId, matchedCanonicalIds: [reference.productId], matchedProductIds: [reference.productId], confidence: 1, threshold: 1, responseSource: 'conversation-context' });
  }
  if (reference?.ambiguous) {
    if (goal.goal === 'ask_variant' && context.lastFocusProduct) {
      return decision({ ...base, route: 'context_followup', contextUsed: true, contextTarget: context.lastFocusProduct, matchedCanonicalIds: [context.lastFocusProduct], matchedProductIds: [context.lastFocusProduct], confidence: 1, threshold: 1, responseSource: 'conversation-context' });
    }
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
  if (['clarify_previous_answer', 'compare_products', 'ask_usage', 'ask_product_information', 'ask_child_usage', 'ask_variant'].includes(goal.goal)) {
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
    return decision({ ...base, route: 'expert_rule', intent: expert.intent, matchedRuleId: expert.ruleId, primaryProductId: expert.primaryProductId || null, matchedProductIds: (expert.links || []).map((item) => item.id).filter(Boolean), confidence: 1, threshold: 1, responseSource: expert.source });
  }
  if (directCanonical) {
    return decision({ ...base, route: 'exact_product', goal: 'find_product', intent: 'product_detail', domain: 'product', matchedCanonicalIds: [directCanonical], matchedProductIds: [directCanonical], confidence: 1, threshold: 1, responseSource: 'product-context' });
  }
  let category = catalog.detectCategory(question);
  const categoryExcluded=category?.id==='shampoo'&&(excludedProductTypes.includes('shampoo')||excludedProductTypes.includes('shampoo_soap'));
  if(categoryExcluded){
    const positiveCategory={tusfurdo:'shower_gel',szappan:'soap',krem:'cream',balzsam:'cream'}[productTypeConstraint];
    category=positiveCategory?{id:positiveCategory}:null;
  }
  const exactCatalogProduct = category ? null : catalog.findExactProduct(question);
  if (exactCatalogProduct) {
    return decision({ ...base, route: 'exact_product', goal: 'find_product', intent: 'product_detail', domain: 'product', matchedProductIds: [exactCatalogProduct.id], evidence: [...base.evidence, `catalog-product:${exactCatalogProduct.sku}`], confidence: 1, threshold: 1, responseSource: 'unas-catalog' });
  }

  if (category && goal.goal !== 'solve_problem') {
    const found = catalog.searchCategory(category.id);
    const categoryIntent = productQuestionIntent === 'recommendation' ? 'product_recommendation' : found.products.length ? 'catalog_category_found' : 'catalog_category_absent';
    return decision({ ...base, route: 'product_category', intent: categoryIntent, goal: 'find_product', domain: category.id, matchedProductIds: found.products.map((item) => item.id), evidence: [...base.evidence, `catalog-category:${category.id}`], confidence: 1, threshold: 1, rejectionReasons: found.products.length ? [] : ['catalog_category_absent'], responseSource: found.products.length ? 'unas-catalog' : 'catalog-absent' });
  }

  if (problem) {
    return decision({ ...base, route: 'problem_domain', intent: 'problem_recommendation', confidence: 1, threshold: 1, responseSource: 'problem-domain' });
  }

  if (excludedProductTypes.length && !productTypeConstraint) {
    return decision({ ...base, route: 'clarification', intent: 'product_type_exclusion', goal: 'find_product', contextTarget: 'excluded_product_type', confidence: 1, threshold: 1, rejectionReasons: ['missing_positive_product_type'], responseSource: 'product-type-negation' });
  }

  if (productQuestionIntent === 'recommendation' && !productTypeConstraint && !directCanonical && !context.lastFocusProduct) {
    return decision({ ...base, route: 'clarification', contextTarget: 'product', confidence: 1, threshold: 1, rejectionReasons: ['missing_recommendation_goal'], responseSource: 'conversation-context' });
  }

  const matches = searchKnowledge(knowledge, question);
  const assessed = evaluateKnowledgeConfidence(question, matches, { domain: base.domain, intent: base.intent, context });
  if (assessed.accepted) {
    return decision({ ...base, route: 'knowledge', matchedKnowledgeIds: [matches[0].item.id], confidence: assessed.confidence, threshold: assessed.threshold, evidence: [...base.evidence, `knowledge-score:${matches[0].score}`], responseSource: 'knowledge-fallback' });
  }
  const aliasSuspected = matches.length === 0 && /\b(szappan|sampon|krem|balzsam|dezodor|termek)\b/.test(current);
  return decision({ ...base, route: 'hard_fallback', candidateCount: matches.length, confidence: assessed.confidence, threshold: assessed.threshold, evidence: aliasSuspected ? [...base.evidence, 'alias-suspected'] : base.evidence, rejectionReasons: aliasSuspected ? ['alias_missing'] : assessed.rejectionReasons.length ? assessed.rejectionReasons : ['knowledge_gap'], responseSource: 'hard-fallback' });
}

function routeAnswer(args) {
  const routing = routeAnswerCore(args);
  return { ...routing, answerMode: determineAnswerMode(args.question, routing) };
}

module.exports = { routeAnswer, createRoutingDecision: decision };
