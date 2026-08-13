'use strict';

const { normalize } = require('./normalizer.cjs');

const ANSWER_MODES = Object.freeze({
  DIRECT: 'DIRECT',
  RECOMMENDATION: 'RECOMMENDATION',
  EXPLANATORY: 'EXPLANATORY',
  SOCIAL_META: 'SOCIAL_META'
});

function determineAnswerMode(question, routing) {
  const text = normalize(question);
  const social = routing.route === 'meta' && /^social-/.test(routing.intent || '');
  if (social) return ANSWER_MODES.SOCIAL_META;

  const explanatory = routing.route === 'hair_type_knowledge' ||
    ['ask_usage', 'ask_child_usage', 'clarify_previous_answer'].includes(routing.goal) ||
    ['product_usage', 'ingredients', 'compare_products', 'product_type_comparison'].includes(routing.intent) ||
    /\b(kulonbseg|miben mas|hogyan|hogy hasznal|miert)\b/.test(text);
  if (explanatory) return ANSWER_MODES.EXPLANATORY;

  const asksRecommendation = /\b(ajanl\w*|javasol\w*|mit valassz\w*|melyiket valassz\w*|melyiket|melyik jobb|mit hasznalj\w*)\b/.test(text);
  if (asksRecommendation || ['problem_domain', 'expert_rule'].includes(routing.route) || routing.goal === 'solve_problem') {
    return ANSWER_MODES.RECOMMENDATION;
  }

  return ANSWER_MODES.DIRECT;
}

module.exports = { ANSWER_MODES, determineAnswerMode };
