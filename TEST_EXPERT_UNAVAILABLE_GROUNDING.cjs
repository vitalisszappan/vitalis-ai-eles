'use strict';

const assert = require('node:assert/strict');
const { planAnswer } = require('./engine/answer-planner.cjs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const knowledge = require('./data/knowledge.json');

const noFacts = { getProductFacts: () => null, normalizeIngredient: (value) => value };
const expert = planAnswer({
  question: 'Mit ajánlasz pattanásos bőrre?',
  routing: { route: 'expert_rule', intent: 'acne', matchedRuleId: 'acne', primaryProductId: 'aktiv_szenes_szappan', matchedProductIds: ['aktiv_szenes_szappan', 'katrany_szappan'] },
  conversationState: {},
  factsApi: noFacts
});
assert.equal(expert.groundingStatus, 'unavailable');
assert.equal(expert.responseStrategy, 'expert_relationship');
assert.equal(expert.cardStrategy, 'expert_products');

const result = createAnswer({ question: 'Mit ajánlasz pattanásos bőrre?', history: [], conversationState: {}, knowledge, ruleEngine: new ExpertRuleEngine('./data/rules/expert-rules.json'), logGap() {} });
assert.equal(result.intent, 'acne');
assert.equal(result.answerIntent, 'product_recommendation');
assert.equal(result.groundingStatus, 'unavailable');
assert.deepEqual(result.links.map((link) => link.id), ['aktiv_szenes_szappan', 'katrany_szappan']);
assert.match(result.answer, /Aktív szenes szappan/);
assert.match(result.answer, /Gyógyászati kátrány szappan/i);
assert.doesNotMatch(result.answer, /segít|hatásos|kezelésére|azért ajánlom/i);
assert(result.links.every((link) => link.reasonSource === 'expert_relationship' && link.reason));

const generic = planAnswer({
  question: 'Mit ajánlasz?',
  routing: { route: 'product_category', intent: 'product_recommendation', matchedProductIds: ['unknown'] },
  conversationState: {},
  factsApi: noFacts
});
assert.equal(generic, null);

const ambiguous = planAnswer({
  question: 'Mit ajánlasz?',
  routing: { route: 'clarification', intent: 'product_recommendation', matchedProductIds: ['a', 'b'] },
  conversationState: { productContextStatus: 'ambiguous' },
  factsApi: noFacts
});
assert.equal(ambiguous, null);

console.log('Unavailable expert grounding policy: PASS');
