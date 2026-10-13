'use strict';

const { normalize } = require('./normalizer.cjs');
const { detectCustomerGoal } = require('./customer-goal.cjs');
const { hasCommerceDomainEvidence } = require('./commerce-intents.cjs');
const { detectProblemIntent } = require('./problem-intents.cjs');
const { evaluateSafety } = require('./safety-gate.cjs');
const { createCatalogSearch } = require('./catalog-search.cjs');
const { evaluateKnowledgeConfidence } = require('./routing-confidence.cjs');
const { buildConversationContext, resolveProductReference } = require('./conversation-context.cjs');
const { findProductInText, findProductsInText, findAmbiguousProductFamily } = require('./product-faq.cjs');
const { resolveMetaIntent } = require('./meta-intents.cjs');
const { searchKnowledge } = require('./knowledge-fallback.cjs');
const {detectExcludedProductTypes,detectProductTypeConstraint,inferredHairType,HAIR_WASH_TYPES}=require('./product-type-constraint.cjs');
const {isTypeComparison}=require('./hair-wash-products.cjs');
const {determineAnswerMode}=require('./answer-mode.cjs');
const { resolveGuidedDiscovery } = require('./guided-discovery.cjs');
const { resolveAcneDecision } = require('./acne-decision.cjs');
const { buildProblemDomainDecision } = require('./problem-domain-decision.cjs');
const { extractSubtypeRequest, compatibleSubtypeExpert, subtypeCardIdentity } = require('./product-type-constraint.cjs');
const productFacts = require('./product-facts.cjs');
const { PRODUCTS } = require('./product-catalog.cjs');

const catalog = createCatalogSearch();

const PRODUCT_TYPE_WORD = /^(?:szappan|sampon|krem|balzsam|dezodor|termek)\w*$/;
const NON_NAME_WORDS = new Set([
  'a', 'az', 'egy', 'es', 'ez', 'ezt', 'kerlek', 'legyszi', 'pls', 'van', 'vannak',
  'milyen', 'melyik', 'mutass', 'keresek', 'szeretnek', 'erdekel', 'ajanlj', 'ajanlasz'
]);

function hasUnresolvedNamedProduct(question, category, productQuestionIntent, goal) {
  if (!category || goal === 'solve_problem' || ['recommendation', 'availability'].includes(productQuestionIntent)) return false;
  if (['description', 'benefits', 'usage', 'price', 'ingredients', 'ingredient_existence', 'suitability'].includes(productQuestionIntent)) return true;
  const tokens = normalize(question).split(/\s+/).filter(Boolean);
  const typeIndex = tokens.findIndex((token) => PRODUCT_TYPE_WORD.test(token));
  if (typeIndex < 0) return false;
  return tokens.slice(0, typeIndex).some((token) => token.length >= 3 && !NON_NAME_WORDS.has(token));
}

function activeRecommendationContext(history, context) {
  const assistants = [...history].reverse().filter((item) => item?.role === 'assistant');
  const recommendationRoutes = ['expert_rule', 'product_category', 'problem_domain', 'hair_product_type'];
  const latestAssistant = assistants[0];
  const lastAssistant = recommendationRoutes.includes(latestAssistant?.route)
    ? latestAssistant
    : latestAssistant?.route === 'recommendation_alternative'
      ? assistants.find((item) => recommendationRoutes.includes(item?.route))
      : null;
  const products = [...new Set(context.lastRecommendedProducts || [])];
  if (!lastAssistant || !products.length) return null;
  const primary = lastAssistant.targetProductId || lastAssistant.routing?.primaryProductId || context.lastFocusProduct || products[0];
  return { products, primary, sourceRoute: lastAssistant.route };
}

function recommendationChoiceRequest(text) {
  const asksChoice = /\b(melyiket valasztanad|melyik(?: lenne)? jobb(?: nekem)?|(?:a )?ketto kozul melyiket|te melyiket venned|melyiket ajanlod inkabb)\b/.test(text);
  return asksChoice ? { priceAware: /\bolcsobb\b/.test(text) } : null;
}

function recommendationRefinementRequest(text) {
  if (/\b(csak egy termeket szeretnek|csak egyet (?:szeretnek|vennek))\b/.test(text)) return 'one_product';
  if (/\b(?:nekem )?(?:az )?ar is (?:szamit|fontos)\b|\bolcsobb megoldast szeretnek\b/.test(text)) return 'price';
  if (/\binkabb ne szappan(?: legyen)?\b|\bszappant inkabb nem\b/.test(text)) return 'exclude_soap';
  if (/\b(?:nagyon )?erzekeny (?:a )?borom\b/.test(text)) return 'sensitive_skin';
  return null;
}

function productIsSoap(productId) {
  const product = PRODUCTS[productId];
  return /szappan/.test(normalize(`${productId} ${product?.name || ''} ${product?.productType || ''}`));
}

function groundedBenefit(productId) {
  const fact = productFacts.getFact(productId, 'productBenefits');
  return fact.status === 'grounded' ? fact : null;
}

function recommendationRefinement(question, history, context) {
  const type = recommendationRefinementRequest(normalize(question));
  if (!type) return null;
  const active = activeRecommendationContext(history, context);
  if (!active) return { type, products: [], primary: null, justified: false };
  const products = active.products.filter((id) => PRODUCTS[id]);
  const primary = products.includes(active.primary) ? active.primary : products[0] || null;
  if (type === 'one_product') {
    return { type, products, primary, selected: primary, justified: Boolean(primary && groundedBenefit(primary) && active.sourceRoute === 'expert_rule') };
  }
  if (type === 'price') {
    const prices = products.map((id) => ({ id, fact: productFacts.getFact(id, 'price') }));
    const grounded = prices.filter((item) => item.fact.status === 'grounded' && Number.isFinite(item.fact.value));
    return { type, products, primary, selected: primary, prices, cheaper: grounded.length === products.length && grounded.length > 1
      ? [...grounded].sort((left, right) => left.fact.value - right.fact.value)[0].id : null,
      justified: Boolean(primary && groundedBenefit(primary) && grounded.length === products.length && products.length > 1) };
  }
  if (type === 'exclude_soap') {
    const eligible = products.filter((id) => !productIsSoap(id));
    const selected = eligible.includes(primary) ? primary : eligible[0] || null;
    return { type, products, primary, eligible, selected, justified: Boolean(products.length && (!selected || groundedBenefit(selected))) };
  }
  const sensitive = products.filter((id) => {
    const fact = groundedBenefit(id);
    const claims = normalize(fact?.value?.map((item) => item.claim).join(' ') || '');
    return fact && /\berzekeny\w*\b/.test(claims) && /\bbor\w*\b/.test(claims);
  });
  const selected = sensitive.includes(primary) ? primary : sensitive.length === 1 ? sensitive[0] : null;
  return { type, products, primary, sensitive, selected,
    justified: Boolean(selected && active.sourceRoute === 'expert_rule' && groundedBenefit(selected)) };
}

function recommendationAlternative(question, history, context) {
  const text = normalize(question);
  const choice = recommendationChoiceRequest(text);
  const asksCheaper = /\bolcsobb(?:\s+is)?\s+van\b|\bvan\s+(?:is\s+)?olcsobb\b/.test(text);
  const asksAnother = /\bvan\s+masik(?:\s+lehetoseg)?\b|\bmutass\w*\s+masikat\b/.test(text);
  if (!choice && !asksCheaper && !asksAnother) return null;
  const active = activeRecommendationContext(history, context);
  if (!active) return choice ? { choice: true, priceAware: choice.priceAware, products: [...new Set(context.lastRecommendedProducts || [])], primary: null, justified: false } : null;
  if (choice) {
    const products = active.products.slice(0, 2);
    const groundedRoles = products.length === 2 && products.every((id) => productFacts.getFact(id, 'productBenefits').status === 'grounded');
    return { choice: true, priceAware: choice.priceAware, products, primary: active.primary, justified: active.sourceRoute === 'expert_rule' && groundedRoles };
  }
  const alternatives = active.products.filter((id) => id !== active.primary);
  if (!asksCheaper) return { cheaper: false, primary: active.primary, productId: alternatives[0] || null };
  const price = (id) => {
    const fact = productFacts.getFact(id, 'price');
    return fact.status === 'grounded' && Number.isFinite(fact.value) ? fact.value : null;
  };
  const primaryPrice = price(active.primary);
  const priced = alternatives.map((id) => ({ id, price: price(id) })).filter((item) => item.price !== null)
    .sort((left, right) => left.price - right.price);
  const productId = primaryPrice === null ? null : priced.find((item) => item.price < primaryPrice)?.id || null;
  return { cheaper: true, primary: active.primary, productId };
}

function decision(overrides = {}) {
  return {
    route: 'hard_fallback', intent: null, goal: 'unknown', domain: null, safetyClass: 'safe',
    contextUsed: false, contextTarget: null, matchedCanonicalIds: [], matchedProductIds: [], primaryProductId: null,
    matchedRuleId: null, matchedKnowledgeIds: [], evidence: [], confidence: 0,
    threshold: 1, rejectionReasons: [], responseSource: 'hard-fallback', candidateCount: 0, ...overrides
  };
}

function routeAnswerCore({ question, history = [], knowledge = [], ruleEngine, conversationState = null }) {
  const goal = detectCustomerGoal(question, history, conversationState);
  const turnIntent = goal.turnIntent;
  const productQuestionIntent = turnIntent.productQuestionIntent;
  const problem = detectProblemIntent(question);
  const normalizedCurrent = normalize(question);
  const currentExplicitNeed = Boolean(problem)
    || /\b\w+\s+(?:borre|fejborre|hajra|kezre|sarokra)\b/.test(normalizedCurrent)
    || /\b(?:bor|fejbor|haj|kez|sarok)\w*\b.*\b(?:keres\w*|erdekel\w*|ajanl\w*|van\s+valami)\b/.test(normalizedCurrent);
  const safety = evaluateSafety(question, problem);
  const context = conversationState ? {
    lastRecommendedProducts: conversationState.lastOrdinalProductList || conversationState.lastRecommendedProducts || [],
    lastSelectedProduct: conversationState.selectedProductId || null,
    lastUserProduct: conversationState.focusedProductId || null,
    lastFocusProduct: conversationState.focusedProductId || null,
    lastProduct: conversationState.focusedProductId || null,
    primaryRecommendedProduct: conversationState.focusedProductId || null,
    purchaseProductId: conversationState.purchaseProductId || null,
    productContextStatus: conversationState.productContextStatus || 'unresolved',
    lastProblemDomain: conversationState.activeProblemDomains?.at(-1) || null,
    mentionedProducts: conversationState.activeProductIds || []
  } : (()=>{const derived=buildConversationContext(history,normalize);return{...derived,purchaseProductId:derived.productContextStatus==='ambiguous'?null:derived.lastFocusProduct};})();
  const excludedProductTypes=detectExcludedProductTypes(question);
  let productTypeConstraint=detectProductTypeConstraint(question);
  if (!productTypeConstraint && productQuestionIntent === 'recommendation' && /\b(zsiros\w* haj\w*|gyorsan zsiros\w*)\b/.test(normalize(question))) productTypeConstraint = 'solid_shampoo';
  if (!productTypeConstraint && !currentExplicitNeed && /\b(ajanl\w*|javasol\w*|melyiket|mit valassz\w*)\b/.test(normalize(question))) {
    const rememberedTypes = [...new Set((context.lastRecommendedProducts || []).map((id) => inferredHairType({ id })).filter(Boolean))];
    const allowedRememberedTypes=rememberedTypes.filter((type)=>!excludedProductTypes.includes(type)&&!excludedProductTypes.includes('shampoo'));
    if (allowedRememberedTypes.length === 1 && HAIR_WASH_TYPES.includes(allowedRememberedTypes[0])) productTypeConstraint = allowedRememberedTypes[0];
  }
  const base = { goal: goal.goal, intent: goal.intent, domain: goal.domain || problem?.domain || null, safetyClass: safety.safetyClass, evidence: [...goal.evidence, ...(problem?.evidence || []), ...safety.evidence], excludedProductTypes, productTypeConstraint, productQuestionIntent, answerIntent: turnIntent.answerIntent, turnIntent };
  const guided = resolveGuidedDiscovery({ question, conversationState });

  const meta = resolveMetaIntent(question);
  if (meta) return decision({ ...base, route: 'meta', intent: meta.intent, goal: 'unknown', domain: 'meta', matchedRuleId: meta.ruleId, confidence: 1, threshold: 1, responseSource: 'meta-intent' });
  if(isTypeComparison(question))return decision({...base,route:'hair_type_knowledge',intent:'product_type_comparison',goal:'compare_products',domain:'hair_wash',matchedRuleId:'solid-shampoo-vs-shampoo-soap',confidence:1,threshold:1,responseSource:'approved-knowledge'});

  if (safety.safetyClass === 'medical_escalation') {
    return decision({ ...base, route: 'safety', goal: 'medical_boundary', intent: 'medical_escalation', confidence: 1, threshold: 1, responseSource: 'safety-gate' });
  }
  if (safety.safetyClass === 'caution_with_boundary') {
    return decision({ ...base, route: 'safety', goal: 'medical_boundary', intent: 'cosmetic_boundary', confidence: 1, threshold: 1, responseSource: 'safety-gate' });
  }

  const couponIntent = turnIntent.category === 'coupon' ? turnIntent.intent : null;
  if (couponIntent) {
    return decision({ ...base, route: 'coupon_policy', intent: couponIntent, goal: 'coupon_information',
      domain: 'coupon', contextUsed: !/\b(kupon\w*|kedvezmeny\w*)\b/.test(normalizedCurrent),
      contextTarget: 'approved_coupon_policy', confidence: 1, threshold: 1,
      responseSource: 'approved-coupon-policy' });
  }

  const refinement = recommendationRefinement(question, history, context);
  if (refinement) {
    const intent = `recommendation_refinement_${refinement.type}`;
    if (!refinement.justified) {
      return decision({ ...base, route: 'clarification', intent, goal: 'select_recommendation', domain: context.lastProblemDomain || 'product',
        contextUsed: refinement.products.length > 0, contextTarget: refinement.products.length ? 'products' : 'product',
        matchedProductIds: refinement.products, confidence: 1, threshold: 1,
        rejectionReasons: [refinement.products.length ? 'recommendation_refinement_not_grounded' : 'missing_recommendation_context'], responseSource: 'conversation-context' });
    }
    return decision({ ...base, route: 'recommendation_alternative', intent, goal: 'select_recommendation', domain: context.lastProblemDomain || 'product',
      contextUsed: true, contextTarget: refinement.selected, matchedCanonicalIds: refinement.products, matchedProductIds: refinement.products,
      primaryProductId: refinement.selected, refinement, confidence: 1, threshold: 1, responseSource: 'product-facts' });
  }

  const subtypeRequest = extractSubtypeRequest(question);
  if (subtypeRequest.status !== 'NONE') {
    const scoped = { ...base, productTypeConstraint: subtypeRequest.type, subtypeRequest, contextUsed: false, contextTarget: null };
    if (subtypeRequest.status !== 'RESOLVED') return decision({ ...scoped, route: 'clarification', intent: 'requested_type_clarification', responseSource: 'requested-product-type', rejectionReasons: [subtypeRequest.status.toLowerCase()] });
    if (subtypeRequest.mode === 'availability') {
      const found = catalog.searchSubtype(subtypeRequest.type, subtypeRequest.qualifiers);
      return decision({ ...scoped, route: 'subtype_catalog', intent: 'product_availability', goal: 'find_product', productQuestionIntent: 'availability',
        domain: subtypeRequest.type, catalogStatus: found.status, matchedProductIds: found.products.map(item => subtypeCardIdentity(item).id),
        confidence: 1, threshold: 1, responseSource: 'constrained-catalog' });
    }
    const expert = ruleEngine?.resolve(question, history) || null;
    if (!compatibleSubtypeExpert(expert, subtypeRequest, catalog.all())) return decision({ ...scoped, route: 'clarification', intent: 'subtype_suitability_unavailable', responseSource: 'requested-product-type', rejectionReasons: ['no_compatible_authorized_candidate'] });
    return decision({ ...scoped, route: 'expert_rule', intent: goal.intent, matchedRuleId: expert.ruleId, primaryProductId: expert.primaryProductId,
      matchedProductIds: expert.links.map(item => item.id), confidence: 1, threshold: 1, responseSource: expert.source });
  }

  const explicitOrdinal = resolveProductReference(question, context);
  const trustedPendingAcneAnswer = conversationState?.acneDecision?.trusted === true
    && conversationState?.pendingClarification?.domain === 'acne'
    && /^\s*\d+\s*(?:\.|\)|-)\s*\S.+$/u.test(String(question));
  if (explicitOrdinal?.ordinalStatus === 'EXPLICIT_INVALID_OR_OUT_OF_RANGE_ORDINAL' && !trustedPendingAcneAnswer) {
    return decision({ ...base, route: 'clarification', contextUsed: true, contextTarget: 'product',
      rejectionReasons: ['ambiguous_product_reference'], responseSource: 'conversation-context' });
  }

  const acneDecision = resolveAcneDecision({ question, history, conversationState });
  if (acneDecision) {
    const resolved = acneDecision.kind === 'resolved' || acneDecision.kind === 'usage';
    return decision({
      ...base,
      route: resolved ? 'expert_rule' : 'clarification',
      intent: acneDecision.kind === 'usage' ? 'product_usage' : 'acne',
      goal: acneDecision.kind === 'usage' ? 'ask_usage' : resolved ? 'find_product' : 'clarify_need',
      domain: 'acne',
      contextUsed: acneDecision.source === 'conversation-context',
      contextTarget: resolved ? acneDecision.selectedProductId : 'acne_decision',
      matchedRuleId: acneDecision.kind === 'usage' ? 'acne-katrany-hair-washing' : 'acne-decision',
      primaryProductId: acneDecision.selectedProductId,
      matchedProductIds: acneDecision.selectedProductId ? [acneDecision.selectedProductId] : [],
      confidence: 1,
      threshold: 1,
      responseSource: 'acne-decision',
      acneDecision,
      ...(acneDecision.concernContext ? { concernContext: acneDecision.concernContext } : {}),
      ...(acneDecision.applicationArea ? { applicationArea: acneDecision.applicationArea } : {}),
      ...(acneDecision.recommendationRole ? { recommendationRole: acneDecision.recommendationRole } : {})
    });
  }

  if (guided?.kind === 'browse') {
    return decision({ ...base, route: 'business_info', intent: 'general_catalog', goal: 'browse_catalog', domain: 'business_info', guidedDiscovery: guided.dimensions, confidence: 1, threshold: 1, responseSource: 'guided-discovery' });
  }

  const businessInfo = turnIntent.source === 'business-info' ? turnIntent : null;
  if (businessInfo) {
    return decision({ ...base, route: 'business_info', intent: businessInfo.intent, goal: 'business_information', domain: 'business_info', contextUsed: false, contextTarget: null, matchedCanonicalIds: [], matchedProductIds: [], primaryProductId: null, confidence: 1, threshold: 1, responseSource: 'business-info' });
  }

  const directCanonical = findProductInText(normalize(question));
  const directCanonicalIds = findProductsInText(normalize(question));
  const ambiguousFamilyIds = directCanonical ? [] : findAmbiguousProductFamily(normalizedCurrent);
  if (ambiguousFamilyIds.length > 1) {
    return decision({ ...base, route: 'clarification', intent: base.intent || 'product_detail', goal: base.goal === 'unknown' ? 'find_product' : base.goal,
      domain: 'product', contextUsed: false, contextTarget: 'product', matchedCanonicalIds: ambiguousFamilyIds,
      matchedProductIds: ambiguousFamilyIds, confidence: 1, threshold: 1,
      rejectionReasons: ['ambiguous_product_family'], responseSource: 'conversation-context' });
  }
  const alternative = recommendationAlternative(question, history, context);
  if (alternative) {
    if (alternative.choice && (!alternative.justified || alternative.products.length !== 2 || !alternative.products.includes(alternative.primary))) {
      return decision({ ...base, route: 'clarification', intent: 'recommendation_choice', goal: 'select_recommendation', domain: context.lastProblemDomain || 'product',
        contextUsed: alternative.products.length > 0, contextTarget: 'products', matchedCanonicalIds: [],
        matchedProductIds: alternative.products, confidence: 1, threshold: 1,
        rejectionReasons: [alternative.products.length < 2 ? 'missing_recommendation_choice_products' : 'recommendation_choice_priority_unclear'], responseSource: 'conversation-context' });
    }
    if (alternative.choice) {
      return decision({ ...base, route: 'recommendation_alternative', intent: 'recommendation_choice', goal: 'select_recommendation', domain: context.lastProblemDomain || 'product',
        contextUsed: true, contextTarget: alternative.primary, matchedCanonicalIds: alternative.products, matchedProductIds: alternative.products,
        primaryProductId: alternative.primary, choiceProductIds: alternative.products, priceAwareChoice: alternative.priceAware,
        confidence: 1, threshold: 1, responseSource: 'product-facts' });
    }
    return decision({ ...base, route: 'recommendation_alternative', intent: alternative.cheaper ? 'cheaper_recommendation' : 'alternative_reference',
      goal: 'select_recommendation', domain: 'product', contextUsed: true, contextTarget: alternative.productId,
      matchedCanonicalIds: alternative.productId ? [alternative.productId] : [], matchedProductIds: alternative.productId ? [alternative.productId] : [],
      primaryProductId: alternative.productId, alternativeToProductId: alternative.primary, cheaperAlternative: alternative.cheaper,
      confidence: 1, threshold: 1, rejectionReasons: alternative.productId ? [] : ['no_valid_recommendation_alternative'], responseSource: 'conversation-context' });
  }
  const contextualPairReference = /\b(koztuk|kettejuk|mindketto|a ketto|ketto)\b/.test(normalizedCurrent);
  const contextualPairPrice = productQuestionIntent === 'price' || turnIntent.intent === 'price_query';
  const contextualComparisonIds = (productQuestionIntent === 'comparison' || contextualPairPrice) && directCanonicalIds.length < 2 && contextualPairReference
    ? [...new Set(context.lastRecommendedProducts || [])].filter((id) => require('./product-catalog.cjs').PRODUCTS[id]).slice(0, 2)
    : [];
  const comparisonIds = directCanonicalIds.length === 2 ? directCanonicalIds : contextualComparisonIds.length === 2 ? contextualComparisonIds : [];
  if (contextualPairPrice && comparisonIds.length === 2) {
    return decision({ ...base, route: 'product_comparison', intent: 'compare_products', goal: 'compare_products', domain: 'product',
      productQuestionIntent: 'comparison', answerIntent: 'comparison', contextUsed: true, contextTarget: null,
      matchedCanonicalIds: comparisonIds, matchedProductIds: comparisonIds, confidence: 1, threshold: 1, responseSource: 'product-facts' });
  }
  if (productQuestionIntent === 'comparison') {
    if (comparisonIds.length === 2) return decision({ ...base, route: 'product_comparison', intent: 'compare_products', goal: 'compare_products', domain: 'product', contextUsed: directCanonicalIds.length < 2, contextTarget: null, matchedCanonicalIds: comparisonIds, matchedProductIds: comparisonIds, confidence: 1, threshold: 1, responseSource: 'product-facts' });
    if (directCanonicalIds.length !== 1) return decision({ ...base, route: 'clarification', intent: 'compare_products', goal: 'compare_products', contextTarget: 'products', confidence: 1, threshold: 1, rejectionReasons: ['missing_comparison_products'], responseSource: 'conversation-context' });
  }
  const commerce = turnIntent.source === 'commerce-intents' ? turnIntent : null;
  if (commerce) {
    const guardedCommerceIntent = ['order_start', 'checkout_problem'].includes(commerce.intent);
    if (guardedCommerceIntent && !hasCommerceDomainEvidence(question, {
      hasProductContext: context.productContextStatus === 'resolved' || Boolean(context.lastRecommendedProducts?.length),
      directProduct: Boolean(directCanonical)
    })) {
      return decision({ ...base, route: 'hard_fallback', intent: null, goal: 'unknown', domain: null, confidence: 0, threshold: 1, rejectionReasons: ['commerce_domain_evidence_missing'], responseSource: 'hard-fallback' });
    }
    const needsProduct = ['price_query', 'availability_query'].includes(commerce.intent);
    const referenceEligible = ['order_start', 'price_query', 'availability_query'].includes(commerce.intent);
    const purchaseReference = referenceEligible ? resolveProductReference(question, context) : null;
    if (referenceEligible && !directCanonical && (purchaseReference?.ambiguous || (context.productContextStatus === 'ambiguous' && !purchaseReference?.authoritative))) {
      return decision({ ...base, route: 'clarification', intent: commerce.intent, contextUsed: true, contextTarget: 'product', confidence: 1, threshold: 1, rejectionReasons: ['ambiguous_product_reference'], responseSource: 'conversation-context' });
    }
    const purchaseScoped = ['order_start', 'checkout_problem', 'ordering_help'].includes(commerce.intent);
    const preservedOrderingTarget = commerce.intent === 'ordering_help' && context.productContextStatus === 'resolved' ? context.lastFocusProduct : null;
    const commerceTarget = directCanonical || purchaseReference?.productId || preservedOrderingTarget || (purchaseScoped ? context.purchaseProductId : context.lastFocusProduct);
    if (needsProduct && !commerceTarget) {
      return decision({ ...base, route: 'clarification', contextUsed: history.length > 0, contextTarget: 'product', confidence: 1, threshold: 1, rejectionReasons: ['missing_product_argument'], responseSource: 'commerce-clarification' });
    }
    const usesOptionalTarget = ['order_start', 'checkout_problem', 'ordering_help'].includes(commerce.intent) && Boolean(commerceTarget);
    return decision({ ...base, route: 'commerce', contextUsed: (needsProduct || usesOptionalTarget) && !directCanonical, contextTarget: (needsProduct || usesOptionalTarget) ? commerceTarget : null, matchedProductIds: (needsProduct || usesOptionalTarget) ? [commerceTarget] : [], referenceType: purchaseReference?.type || null, referenceAuthoritative: Boolean(purchaseReference?.authoritative), confidence: 1, threshold: 1, responseSource: 'commerce-intent' });
  }

  const guidedDecision = () => {
    if (!guided || guided.kind === 'defer') return null;
    const reason = guided.kind === 'clarify_product_type' ? 'guided_missing_product_type'
      : guided.kind === 'clarify_need' ? 'guided_missing_need_state' : 'guided_suitability_unavailable';
    return decision({ ...base, route: 'clarification', intent: 'product_recommendation', goal: 'find_product', domain: guided.dimensions.needState?.value || 'product', contextTarget: 'guided_discovery', contextUsed: Boolean(conversationState?.guidedDiscovery), guidedDiscovery: guided.dimensions, confidence: 1, threshold: 1, rejectionReasons: [reason], responseSource: 'guided-discovery' });
  };

  // Unsupported current needs and completion of an earlier discovery turn own
  // the turn before stale product references can be resolved.
  const unsupportedGuidedNeed = ['sensitive_skin', 'dry_hands', 'wrinkles_or_mature_skin'].includes(guided?.dimensions?.needState?.value)
    && guided?.dimensions?.needState?.source === 'current-turn';
  const completesInheritedNeed = guided?.dimensions?.productType?.source === 'current-turn'
    && Boolean(guided?.dimensions?.needState)
    && guided?.dimensions?.needState?.source !== 'current-turn';
  const standaloneTypeOnly = guided?.dimensions?.productType?.source === 'current-turn'
    && !guided?.dimensions?.needState
    && !problem
    && excludedProductTypes.length === 0
    && productQuestionIntent !== 'availability'
    && !/\b(?:haj|fejbor)\w*/.test(normalizedCurrent)
    && /\b(?:keres\w*|erdekel\w*)\b/.test(normalizedCurrent)
    && !conversationState?.focusedProductId
    && !(conversationState?.lastRecommendedProducts || []).length;
  if (!directCanonical && guided && (unsupportedGuidedNeed || completesInheritedNeed || standaloneTypeOnly)) {
    const resolved = guidedDecision();
    if (resolved) return resolved;
  }

  if (/\b(sls|sles|sodium lauryl sulfate|sodium laureth sulfate)\b/.test(normalize(question))) {
    return decision({ ...base, route: 'expert_rule', intent: 'ingredient-question', matchedRuleId: 'sls-sles-free', confidence: 1, threshold: 1, responseSource: 'expert-sls-sles' });
  }

  if (directCanonical && ['ingredients', 'ingredient_existence', 'benefits', 'usage', 'price'].includes(productQuestionIntent)) {
    return decision({ ...base, route: 'exact_product', intent: productQuestionIntent === 'ingredient_existence' ? 'ingredients' : productQuestionIntent, goal: base.goal, domain: 'product', matchedCanonicalIds: [directCanonical], matchedProductIds: [directCanonical], confidence: 1, threshold: 1, responseSource: 'product-facts' });
  }

  const attributeIntent=/\b(osszetevo\w*|inci)\b/.test(normalize(question))?'ingredients':/\b(illat\w*)\b/.test(normalize(question))?'scent':null;
  if(attributeIntent&&(directCanonical||catalog.findExactProduct(question))){const matches=searchKnowledge(knowledge,question),assessed=evaluateKnowledgeConfidence(question,matches,{domain:'product',intent:attributeIntent,context});if(assessed.accepted)return decision({...base,route:'knowledge',intent:attributeIntent,domain:'product',matchedKnowledgeIds:[matches[0].item.id],confidence:assessed.confidence,threshold:assessed.threshold,evidence:[...base.evidence,`attribute:${attributeIntent}`],responseSource:'knowledge-fallback'});return decision({...base,route:'hard_fallback',intent:attributeIntent,domain:'product',candidateCount:matches.length,confidence:assessed.confidence,threshold:assessed.threshold,rejectionReasons:['knowledge_missing'],evidence:[...base.evidence,`attribute:${attributeIntent}`],responseSource:'hard-fallback'});}

  const genericShampooAvailability=!productTypeConstraint&&productQuestionIntent==='availability'&&/\bsampon\w*/.test(normalize(question));
  const explicitHairProductRequest=HAIR_WASH_TYPES.includes(productTypeConstraint)&&/\b(keres\w*|szeretn\w*)\b/.test(normalize(question));
  if((HAIR_WASH_TYPES.includes(productTypeConstraint)&&(['availability','recommendation'].includes(productQuestionIntent)||problem))||explicitHairProductRequest||genericShampooAvailability)return decision({...base,route:'hair_product_type',intent:productQuestionIntent==='availability'?'product_type_availability':'product_recommendation',goal:'find_product',domain:'shampoo',confidence:1,threshold:1,responseSource:'approved-product-type-rule'});

  const reference = resolveProductReference(question, context);
  if (reference?.explicitProductId && !['ask_child_usage', 'ask_usage', 'ask_product_information', 'ask_variant'].includes(goal.goal)) {
    return decision({ ...base, route: 'exact_product', goal: 'find_product', intent: 'product_detail', domain: 'product',
      matchedCanonicalIds: [reference.explicitProductId], matchedProductIds: [reference.explicitProductId],
      confidence: 1, threshold: 1, responseSource: 'product-context' });
  }
  if (reference?.productId) {
    const catalogOrdinal = reference.type === 'ordinal' && reference.productId.startsWith('catalog:');
    const referenceGoal = catalogOrdinal || reference.type === 'alternative' ? 'select_recommendation' : base.goal;
    const inheritsUsage = ['companion', 'category', 'explicit_product'].includes(reference.type)
      && ['usage', 'product_usage'].includes(conversationState?.lastAssistantIntent);
    const referenceIntent = catalogOrdinal ? 'select_recommendation'
      : reference.type === 'alternative' ? 'alternative_reference'
        : inheritsUsage ? 'product_usage' : base.intent;
    return decision({ ...base, goal: inheritsUsage ? 'ask_usage' : referenceGoal,
      intent: referenceIntent, productQuestionIntent: inheritsUsage ? 'usage' : base.productQuestionIntent,
      route: 'context_followup', contextUsed: true, contextTarget: reference.productId,
      matchedCanonicalIds: reference.productId.startsWith('catalog:') ? [] : [reference.productId],
      matchedProductIds: [reference.productId], referenceType: reference.type || null,
      referenceAuthoritative: Boolean(reference.authoritative), confidence: 1, threshold: 1,
      responseSource: 'conversation-context' });
  }
  if (reference?.ambiguous) {
    if (goal.goal === 'ask_variant' && reference.type !== 'alternative' && context.lastFocusProduct) {
      return decision({ ...base, route: 'context_followup', contextUsed: true, contextTarget: context.lastFocusProduct, matchedCanonicalIds: [context.lastFocusProduct], matchedProductIds: [context.lastFocusProduct], confidence: 1, threshold: 1, responseSource: 'conversation-context' });
    }
    return decision({ ...base, route: 'clarification',
      ...(reference.type === 'category' ? { intent: 'conversation-clarification', matchedCanonicalIds: reference.candidates || [], matchedProductIds: reference.candidates || [] } : {}),
      contextUsed: true, contextTarget: 'product', confidence: 1, threshold: 1,
      rejectionReasons: ['ambiguous_product_reference'], responseSource: 'conversation-context' });
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
  const effectiveProductTypeConstraint = productTypeConstraint || guided?.dimensions?.productType?.value || null;
  const expertMatchesConstraint = !effectiveProductTypeConstraint || (expert?.links || []).some((item) => effectiveProductTypeConstraint === 'shampoo'
    ? Boolean(inferredHairType(item))
    : require('./product-type-constraint.cjs').matchesProductType(item, effectiveProductTypeConstraint));
  if (expert && expertMatchesConstraint) {
    return decision({ ...base, route: 'expert_rule', intent: expert.intent, matchedRuleId: expert.ruleId, primaryProductId: expert.primaryProductId || null, matchedProductIds: (expert.links || []).map((item) => item.id).filter(Boolean), confidence: 1, threshold: 1, responseSource: expert.source });
  }
  if (directCanonical) {
    return decision({ ...base, route: 'exact_product', goal: 'find_product', intent: 'product_detail', domain: 'product', matchedCanonicalIds: [directCanonical], matchedProductIds: [directCanonical], confidence: 1, threshold: 1, responseSource: 'product-context' });
  }
  if (guided?.dimensions?.needState && (unsupportedGuidedNeed || guided?.dimensions?.productType)) {
    const resolved = guidedDecision();
    if (resolved) return resolved;
  }
  if (currentExplicitNeed && !problem && !productTypeConstraint) {
    return decision({ ...base, route: 'clarification', intent: 'product_recommendation', goal: 'find_product', domain: base.domain || 'product', contextUsed: false, contextTarget: 'product', confidence: 1, threshold: 1, rejectionReasons: ['unsupported_current_need'], responseSource: 'conversation-context' });
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

  if (hasUnresolvedNamedProduct(question, category, productQuestionIntent, goal.goal)) {
    return decision({ ...base, route: 'clarification', intent: 'product_identity_clarification', goal: 'find_product', domain: 'product',
      contextTarget: 'product', confidence: 1, threshold: 1, rejectionReasons: ['unsupported_product_identity'], responseSource: 'conversation-context' });
  }

  if (category && goal.goal !== 'solve_problem') {
    const found = catalog.searchCategory(category.id);
    const categoryIntent = productQuestionIntent === 'recommendation' ? 'product_recommendation' : found.products.length ? 'catalog_category_found' : 'catalog_category_absent';
    return decision({ ...base, route: 'product_category', intent: categoryIntent, goal: 'find_product', domain: category.id, matchedProductIds: found.products.map((item) => item.id), evidence: [...base.evidence, `catalog-category:${category.id}`], confidence: 1, threshold: 1, rejectionReasons: found.products.length ? [] : ['catalog_category_absent'], responseSource: found.products.length ? 'unas-catalog' : 'catalog-absent' });
  }

  if (problem) {
    const problemDomainDecision = buildProblemDomainDecision(problem);
    return decision({
      ...base,
      route: 'problem_domain',
      intent: 'problem_recommendation',
      confidence: 1,
      threshold: 1,
      responseSource: 'problem-domain',
      ...(problemDomainDecision.concernContext ? { concernContext: problemDomainDecision.concernContext } : {})
    });
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
