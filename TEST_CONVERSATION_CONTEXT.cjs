'use strict';

const assert = require('assert');
const { normalize } = require('./engine/normalizer.cjs');
const {
  buildConversationContext,
  resolveProductReference
} = require('./engine/conversation-context.cjs');
const { createAnswer } = require('./engine/answer-service.cjs');

const noRule = { resolve: () => null };
const noGap = () => {};
const knowledge = [{
  id: 'approved-holt-tengeri-balzsam',
  title: 'Holt-tengeri só balzsam',
  canonicalQuestion: 'Holt-tengeri só balzsam',
  questionVariants: ['Holt tengeri só balzsam'],
  products: ['holt-tengeri-so-balzsam'],
  shortAnswer: 'A jóváhagyott, részletes termékválasz.',
  fullAnswer: 'A jóváhagyott, részletes termékválasz.',
  source: 'approved-knowledge'
}];

const history = [
  { role: 'user', content: 'Mit ajánlasz pikkelysömörre?' },
  {
    role: 'assistant',
    content: 'Elsőként a PsoriVital csomagot ajánlom. Mellette a Holt-tengeri só balzsamot, a Shea vajas szappant és a Holt-tengeri iszapos szappant javaslom.'
  }
];

const context = buildConversationContext(history, normalize);
assert.strictEqual(context.lastProblem, 'psoriasis');
assert.deepStrictEqual(context.lastRecommendedProducts, [
  'psorivital_csomag',
  'holt_tengeri_so_balzsam',
  'shea_vajas_szappan',
  'holt_tengeri_iszapos_szappan'
]);
assert.strictEqual(resolveProductReference('az elsőt', context).productId, 'psorivital_csomag');
assert.strictEqual(resolveProductReference('a másodikat', context).productId, 'holt_tengeri_so_balzsam');
assert.strictEqual(resolveProductReference('a másikat', context).ambiguous, true);
assert.strictEqual(resolveProductReference('ebből', context).ambiguous, true);

let answer = createAnswer({
  question: 'Holt-tengeri só balzsam', history: [], knowledge,
  ruleEngine: noRule, logGap: noGap
});
assert.strictEqual(answer.source, 'knowledge-fallback');
assert(answer.answer.includes('jóváhagyott'));
assert.deepStrictEqual(answer.matchedKnowledgeIds, ['approved-holt-tengeri-balzsam']);

answer = createAnswer({
  question: 'és szappant?', history, knowledge: [],
  ruleEngine: noRule, logGap: noGap
});
assert.strictEqual(answer.intent, 'conversation-clarification');
assert(answer.answer.includes('Shea vajas szappan'));
assert(answer.answer.includes('Holt-tengeri iszapos szappan'));

answer = createAnswer({
  question: 'az elsőt', history, knowledge: [],
  ruleEngine: noRule, logGap: noGap
});
assert.strictEqual(answer.intent, 'product-detail');
assert(answer.answer.includes('PsoriVital'));

const selectedHistory = [
  ...history,
  { role: 'user', content: 'az elsőt' },
  { role: 'assistant', content: answer.answer }
];
const selectedContext = buildConversationContext(selectedHistory, normalize);
assert.strictEqual(selectedContext.lastSelectedProduct, 'psorivital_csomag');
assert.strictEqual(
  resolveProductReference('ebből', selectedContext).productId,
  'psorivital_csomag'
);

answer = createAnswer({
  question: 'ebből', history: selectedHistory, knowledge: [],
  ruleEngine: noRule, logGap: noGap
});
assert.strictEqual(answer.intent, 'product-detail');
assert(answer.answer.includes('PsoriVital'));
assert(!answer.answer.includes('Nem egyértelmű'));

console.log('TEST_CONVERSATION_CONTEXT: 17/17 sikeres');
