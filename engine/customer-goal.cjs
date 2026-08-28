'use strict';

const { normalize } = require('./normalizer.cjs');
const { detectCommerceIntent } = require('./commerce-intents.cjs');
const { detectProblemIntent } = require('./problem-intents.cjs');
const { detectProductQuestionIntent } = require('./product-question-intent.cjs');

const COMMERCE_GOALS = Object.freeze({
  order_start: 'start_order', purchase_location: 'start_order', price_query: 'ask_price',
  availability_query: 'ask_availability', shipping_general: 'ask_shipping',
  shipping_cost: 'ask_shipping', shipping_time: 'ask_shipping', payment: 'ask_payment', order_status: 'start_order'
});

function detectCustomerGoal(question) {
  const text = normalize(question);
  const commerce = detectCommerceIntent(question);
  if (commerce) return { goal: COMMERCE_GOALS[commerce.intent], intent: commerce.intent, domain: 'commerce', evidence: commerce.evidence };
  const productQuestion = detectProductQuestionIntent(question);
  if (productQuestion === 'comparison') return { goal: 'compare_products', intent: 'compare_products', domain: 'product', evidence: ['goal:compare'] };
  if (/^(micsoda|mit jelent|ezt nem ertem)$/.test(text)) return { goal: 'clarify_previous_answer', intent: 'clarify_previous_answer', domain: 'conversation', evidence: ['followup:clarify'] };
  if (/^(melyik|melyiket|az elsot|az elso|a masodikat|a masodik)$/.test(text)) return { goal: 'compare_products', intent: 'select_recommendation', domain: 'conversation', evidence: ['followup:selection'] };
  if (productQuestion === 'usage' || /^(es )?(hogyan|hogy) hasznaljam/.test(text)) return { goal: 'ask_usage', intent: 'product_usage', domain: 'product', evidence: ['followup:usage'] };
  if (['product_information', 'benefits', 'suitability', 'ingredients', 'ingredient_existence', 'scent'].includes(productQuestion)) return { goal: 'ask_product_information', intent: productQuestion, domain: 'product', evidence: [`followup:${productQuestion}`] };
  if (/\b(gyereknek|gyermeknek|babanak|[0-9]{1,2} eves)\b/.test(text)) return { goal: 'ask_child_usage', intent: 'child_usage', domain: 'child_usage', evidence: ['goal:child_usage'] };
  if (productQuestion === 'variant' || /\b(nagyobb|kisebb|kiszereles|meret|valtozat)\b/.test(text)) return { goal: 'ask_variant', intent: 'variant_query', domain: 'product', evidence: ['followup:variant'] };
  const problem = detectProblemIntent(question);
  if (problem) return { goal: problem.domain.includes('medical') || problem.domain === 'circulation_claim' ? 'medical_boundary' : 'solve_problem', intent: 'problem_recommendation', domain: problem.domain, evidence: problem.evidence };
  if (productQuestion === 'recommendation') return { goal: 'find_product', intent: 'product_recommendation', domain: 'product', evidence: ['goal:explicit-recommendation'] };
  if (productQuestion === 'availability' || /\b(van|keresek|kaphato|termek)\b/.test(text)) return { goal: 'find_product', intent: 'product_availability', domain: null, evidence: ['goal:find_product'] };
  if (/\b(osszehasonlit|kulonbseg|melyik jobb)\b/.test(text)) return { goal: 'compare_products', intent: 'compare_products', domain: 'product', evidence: ['goal:compare'] };
  return { goal: 'unknown', intent: null, domain: null, evidence: [] };
}

module.exports = { detectCustomerGoal };
