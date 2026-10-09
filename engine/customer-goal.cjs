'use strict';

const { normalize } = require('./normalizer.cjs');
const { detectCommerceIntent } = require('./commerce-intents.cjs');
const { detectProblemIntent } = require('./problem-intents.cjs');
const { detectProductQuestionIntent } = require('./product-question-intent.cjs');
const { detectBusinessInfo } = require('./business-info.cjs');
const { detectCouponIntent } = require('./coupon-policy.cjs');

const COMMERCE_GOALS = Object.freeze({
  order_start: 'start_order', purchase_location: 'start_order', price_query: 'ask_price',
  availability_query: 'ask_availability', shipping_general: 'ask_shipping',
  shipping_cost: 'ask_shipping', shipping_time: 'ask_shipping', payment: 'ask_payment', order_status: 'start_order',
  ordering_help: 'start_order', order_confirmation_problem: 'start_order', checkout_problem: 'start_order',
  shipping_cheapest: 'ask_shipping', parcel_locker: 'ask_shipping', shipping_carrier: 'ask_shipping',
  personal_pickup: 'ask_shipping', cash_on_delivery: 'ask_payment'
});

const PRODUCT_ANSWER_INTENTS = Object.freeze({
  description: 'product_description', benefits: 'product_benefits', suitability: 'product_suitability',
  usage: 'usage', ingredients: 'ingredients', ingredient_existence: 'ingredients', price: 'price_query',
  comparison: 'comparison', recommendation: 'product_recommendation'
});

function detectTurnIntent(question, history = []) {
  const couponIntent = detectCouponIntent(question, history);
  if (couponIntent) return { category: 'coupon', intent: couponIntent, answerIntent: 'coupon_information', productQuestionIntent: null, source: 'coupon-policy' };
  const business = detectBusinessInfo(question);
  if (business) return { category: 'commerce', intent: business.intent, answerIntent: null, productQuestionIntent: null, source: 'business-info' };
  const commerce = detectCommerceIntent(question);
  if (commerce) {
    const intent = commerce.intent === 'cash_on_delivery' ? 'payment' : commerce.intent;
    return { category: 'commerce', intent, detail: commerce.intent, answerIntent: intent === 'price_query' ? 'price_query' : intent === 'order_start' ? 'order_start' : null, productQuestionIntent: null, source: 'commerce-intents' };
  }
  const productQuestionIntent = detectProductQuestionIntent(question);
  if (productQuestionIntent) return {
    category: 'product', intent: productQuestionIntent, answerIntent: PRODUCT_ANSWER_INTENTS[productQuestionIntent] || null,
    productQuestionIntent, source: 'product-question-intent'
  };
  return { category: 'unknown', intent: null, answerIntent: null, productQuestionIntent: null, source: 'none' };
}

function detectCustomerGoal(question, history = []) {
  const text = normalize(question);
  const turnIntent = detectTurnIntent(question, history);
  const result = (value) => ({ ...value, turnIntent });
  if (turnIntent.category === 'coupon') return { goal: 'coupon_information', intent: turnIntent.intent, domain: 'coupon', evidence: [`coupon:${turnIntent.intent}`], turnIntent };
  if (turnIntent.category === 'commerce') return { goal: COMMERCE_GOALS[turnIntent.intent] || 'business_information', intent: turnIntent.intent, domain: 'commerce', evidence: [`commerce:${turnIntent.intent}`], turnIntent };
  const productQuestion = turnIntent.productQuestionIntent;
  if (productQuestion === 'comparison') return result({ goal: 'compare_products', intent: 'compare_products', domain: 'product', evidence: ['goal:compare'] });
  if (/^(micsoda|mit jelent|ezt nem ertem)$/.test(text)) return result({ goal: 'clarify_previous_answer', intent: 'clarify_previous_answer', domain: 'conversation', evidence: ['followup:clarify'] });
  if (/^(melyik|melyiket|az elsot|az elso|a masodikat|a masodik)$/.test(text)) return result({ goal: 'compare_products', intent: 'select_recommendation', domain: 'conversation', evidence: ['followup:selection'] });
  if (productQuestion === 'usage') return result({ goal: 'ask_usage', intent: 'product_usage', domain: 'product', evidence: ['followup:usage'] });
  if (['product_information', 'description', 'benefits', 'suitability', 'ingredients', 'ingredient_existence', 'scent'].includes(productQuestion)) return result({ goal: 'ask_product_information', intent: productQuestion, domain: 'product', evidence: [`followup:${productQuestion}`] });
  if (/\b(gyereknek|gyermeknek|babanak|[0-9]{1,2} eves)\b/.test(text)) return result({ goal: 'ask_child_usage', intent: 'child_usage', domain: 'child_usage', evidence: ['goal:child_usage'] });
  if (productQuestion === 'variant' || productQuestion === 'alternative' || /\b(nagyobb|kisebb|kiszereles|meret|valtozat)\b/.test(text)) return { goal: 'ask_variant', intent: productQuestion === 'alternative' ? 'alternative_reference' : 'variant_query', domain: 'product', evidence: [`followup:${productQuestion || 'variant'}`], turnIntent };
  const problem = detectProblemIntent(question);
  if (problem) return result({ goal: problem.domain.includes('medical') || problem.domain === 'circulation_claim' ? 'medical_boundary' : 'solve_problem', intent: 'problem_recommendation', domain: problem.domain, evidence: problem.evidence });
  if (productQuestion === 'recommendation') return result({ goal: 'find_product', intent: 'product_recommendation', domain: 'product', evidence: ['goal:explicit-recommendation'] });
  if (productQuestion === 'availability' || /\b(van|keresek|kaphato|termek)\b/.test(text)) return result({ goal: 'find_product', intent: 'product_availability', domain: null, evidence: ['goal:find_product'] });
  return { goal: 'unknown', intent: null, domain: null, evidence: [], turnIntent };
}

module.exports = { PRODUCT_ANSWER_INTENTS, detectTurnIntent, detectCustomerGoal };
