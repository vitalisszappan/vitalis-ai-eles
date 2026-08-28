'use strict';

const productFacts = require('./product-facts.cjs');
const { normalize } = require('./normalizer.cjs');

const SUPPORTED_INTENTS = Object.freeze(['product_recommendation', 'product_benefits', 'ingredients', 'ingredient_benefit', 'usage', 'price_query', 'order_start', 'comparison']);

function detectAnswerIntent(question, routing) {
  const text = normalize(question);
  if (routing?.route === 'expert_rule' && routing.intent === 'product_companion') return null;
  if (routing?.route === 'product_comparison' || routing?.intent === 'compare_products') return 'comparison';
  if (routing?.route === 'commerce' && routing.intent === 'order_start') return 'order_start';
  if (/\b(mire jo benne|mit csinal benne|miert van benne)\b/.test(text)) return 'ingredient_benefit';
  if (/\b(miert ezt ajanlod|miert ajanlod|miert jo ez|mire jo|mire valo|mit tud ez(?: a krem)?|miben segit)\b/.test(text)) return 'product_benefits';
  if (routing?.route === 'expert_rule' && /\b(mit ajanl|mit javasol|melyiket ajanl|milyen termeket ajanl|mit hasznaljak)\w*/.test(text)) return 'product_recommendation';
  if (['ingredients', 'ingredient_existence'].includes(routing?.productQuestionIntent)) return 'ingredients';
  if (routing?.productQuestionIntent === 'benefits') return 'product_benefits';
  if (/\b(mi van benne|mi van\b.*\b\w+(?:ban|ben)|mik az?\b.*\bosszetevoi|mi az inci|milyen az incije|milyen osszetevoket tartalmaz|mit tartalmaz|van benne|van\b.*\b\w+(?:ban|ben)|tartalmaz)\b/.test(text)) return 'ingredients';
  if (/\b(hogyan hasznaljam|hogy kell hasznalni|milyen gyakran hasznaljam)\b/.test(text)) return 'usage';
  if (/\b(mennyibe kerul|mi az ara)\b/.test(text)) return 'price_query';
  return null;
}

function requestedIngredient(question, intent, factsApi) {
  if (!['ingredients', 'ingredient_benefit'].includes(intent)) return null;
  const text = normalize(question);
  if (/^(mi van|mik az?|mit tartalmaz|milyen (?:osszetevok|az inci)|mi az inci)\b/.test(text)) return null;
  const match = /\b(?:az?\s+)?([a-z0-9-]+)\s*\??$/.exec(text);
  if (!match || ['benne', 'tartalmaz', 'osszetevoi', 'inci'].includes(match[1])) return null;
  return factsApi.normalizeIngredient(match[1]);
}

function targetFrom({ routing, conversationState }) {
  const explicit = routing?.matchedCanonicalIds?.length === 1 ? routing.matchedCanonicalIds[0] : null;
  if (explicit) return explicit;
  if (routing?.contextTarget && routing.contextTarget !== 'product' && routing.matchedProductIds?.length <= 1) return routing.contextTarget;
  if (conversationState?.productContextStatus === 'resolved' && conversationState.focusedProductId) return conversationState.focusedProductId;
  return null;
}

function recommendationTarget(routing) {
  if (routing?.route !== 'expert_rule' || !routing.matchedRuleId || !routing.primaryProductId) return null;
  return routing.matchedProductIds?.includes(routing.primaryProductId) ? routing.primaryProductId : null;
}

function factSummary(type, fact) {
  return {
    factType: type,
    status: fact?.status || 'unavailable',
    value: fact?.status === 'grounded' ? fact.value : null,
    provenance: Array.isArray(fact?.provenance) ? fact.provenance : []
  };
}

function planAnswer({ question, routing, conversationState, factsApi = productFacts }) {
  const answerIntent = detectAnswerIntent(question, routing);
  if (!answerIntent || !SUPPORTED_INTENTS.includes(answerIntent)) return null;
  if (answerIntent === 'comparison') {
    const productIds = [...new Set(routing?.matchedCanonicalIds || routing?.matchedProductIds || [])].slice(0, 2);
    const text = normalize(question);
    const comparisonFactType = /\b(olcsobb|ar|ara|mennyibe)\b/.test(text) ? 'price'
      : /\b(osszetevo\w*|inci\w*|mi van benn)\b/.test(text) ? 'ingredients'
        : /\b(hasznalat|hasznal)\b/.test(text) ? 'usageInstructions' : 'productBenefits';
    if (productIds.length !== 2) return { answerIntent, targetProductId: null, relatedProductIds: [], comparisonProductIds: productIds, comparisonFactType, requiredFacts: [comparisonFactType], factsUsed: [], groundingStatus: 'ambiguous', responseStrategy: 'clarify_comparison', cardStrategy: 'none', ctaStrategy: 'clarify_need', requestedIngredientId: null };
    const factsUsed = productIds.map((productId) => factSummary(comparisonFactType, factsApi.getFact(productId, comparisonFactType))).map((fact, index) => ({ ...fact, productId: productIds[index] }));
    const groundedCount = factsUsed.filter((fact) => fact.status === 'grounded').length;
    return { answerIntent, targetProductId: productIds[0], relatedProductIds: [productIds[1]], comparisonProductIds: productIds, comparisonFactType, comparisonRequiresChoice: /\bmelyik jobb\b/.test(text), requiredFacts: [comparisonFactType], factsUsed, groundingStatus: groundedCount === 2 ? 'grounded' : groundedCount ? 'partial' : 'unavailable', responseStrategy: 'compare_products', cardStrategy: 'comparison_products', ctaStrategy: 'none', requestedIngredientId: null };
  }
  const targetProductId = answerIntent === 'product_recommendation'
    ? recommendationTarget(routing)
    : targetFrom({ routing, conversationState });
  const authoritativeReference = Boolean(routing?.referenceAuthoritative && targetProductId);
  const ambiguous = (routing?.route === 'clarification' && routing?.rejectionReasons?.includes('ambiguous_product_reference')) || (conversationState?.productContextStatus === 'ambiguous' && !authoritativeReference);
  const requiredByIntent = {
    product_recommendation: ['productBenefits'], product_benefits: ['productBenefits'],
    ingredients: ['ingredients'], ingredient_benefit: ['ingredients', 'ingredientBenefits'],
    usage: ['usageInstructions'], price_query: ['price', 'currency'], order_start: []
  };
  const requiredFacts = requiredByIntent[answerIntent];
  const relatedProductIds = routing?.route === 'expert_rule' && answerIntent === 'product_recommendation'
    ? [...new Set(routing.matchedProductIds || [])].filter((id) => id !== targetProductId)
    : [];
  const hasExpertRecommendationEvidence = routing?.route === 'expert_rule'
    && Boolean(routing.matchedRuleId)
    && Boolean(targetProductId)
    && routing.matchedProductIds?.includes(targetProductId);
  if (ambiguous || !targetProductId) return {
    answerIntent, targetProductId: null, relatedProductIds: [], requiredFacts, factsUsed: [], groundingStatus: ambiguous ? 'ambiguous' : 'unavailable',
    responseStrategy: 'clarify_product', cardStrategy: 'none', ctaStrategy: 'clarify_need', requestedIngredientId: requestedIngredient(question, answerIntent, factsApi)
  };
  if (answerIntent === 'order_start') return {
    answerIntent, targetProductId, relatedProductIds, requiredFacts, factsUsed: [], groundingStatus: 'grounded',
    responseStrategy: 'existing_commerce', cardStrategy: 'target_product', ctaStrategy: 'purchase', requestedIngredientId: null
  };
  const record = factsApi.getProductFacts(targetProductId);
  if (!record) return {
    answerIntent, targetProductId, relatedProductIds, requiredFacts, factsUsed: [], groundingStatus: 'unavailable',
    responseStrategy: hasExpertRecommendationEvidence ? 'expert_relationship' : 'unknown', cardStrategy: hasExpertRecommendationEvidence ? 'expert_products' : answerIntent === 'product_recommendation' ? 'none' : 'target_product', ctaStrategy: answerIntent === 'product_recommendation' ? 'clarify_need' : 'none', requestedIngredientId: requestedIngredient(question, answerIntent, factsApi)
  };
  const factsUsed = requiredFacts.map((type) => factSummary(type, factsApi.getFact(targetProductId, type)));
  const ingredientId = requestedIngredient(question, answerIntent, factsApi);
  if (ingredientId) {
    const existence = factsApi.hasIngredient(targetProductId, ingredientId);
    factsUsed.push({ factType: 'ingredientExistence', status: existence.status, value: existence.exists, ingredientId, provenance: existence.provenance || [] });
  }
  const allGrounded = factsUsed.every((fact) => fact.status === 'grounded');
  const anyGrounded = factsUsed.some((fact) => fact.status === 'grounded');
  return {
    answerIntent, targetProductId, relatedProductIds, requiredFacts, factsUsed,
    groundingStatus: allGrounded ? 'grounded' : anyGrounded ? 'partial' : 'unavailable',
    responseStrategy: allGrounded ? 'grounded_facts' : hasExpertRecommendationEvidence ? 'expert_relationship' : anyGrounded ? 'grounded_partial_unknown' : 'unknown',
    cardStrategy: answerIntent === 'product_recommendation' && !allGrounded ? (hasExpertRecommendationEvidence ? 'expert_products' : 'none') : 'target_product',
    ctaStrategy: answerIntent === 'product_recommendation' ? (allGrounded ? 'view_product' : 'clarify_need') : answerIntent === 'product_benefits' && anyGrounded ? 'learn_more' : 'none',
    requestedIngredientId: ingredientId
  };
}

module.exports = { SUPPORTED_INTENTS, detectAnswerIntent, planAnswer };
