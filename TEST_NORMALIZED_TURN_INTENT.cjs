'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { detectTurnIntent, detectCustomerGoal } = require('./engine/customer-goal.cjs');
const { routeAnswer } = require('./engine/answer-router.cjs');
const { detectAnswerIntent } = require('./engine/answer-planner.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');
const route = (question) => routeAnswer({ question, history: [], knowledge, ruleEngine, conversationState: null });

const cases = [
  ['Mennyiert adjatok a Dermavital sampont?', 'commerce', 'price_query', 'price_query'],
  ['Mi az ara ennek?', 'commerce', 'price_query', 'price_query'],
  ['Hogy kenjem a Holt-tengeri balzsamot?', 'product', 'usage', 'usage'],
  ['Miként alkalmazzam a Dermavital krémet?', 'product', 'usage', 'usage'],
  ['Mit csinál a Dermavital sampon?', 'product', 'description', 'product_description'],
  ['Mire használható a Shea vajas szappan?', 'product', 'description', 'product_description'],
  ['Miket tartalmaz a Shea vajas szappan?', 'product', 'ingredients', 'ingredients'],
  ['Mikből áll a Dermavital szappan?', 'product', 'ingredients', 'ingredients'],
  ['Mennyibe kerül a kiszállítás?', 'commerce', 'shipping_cost', null],
  ['Automatába lehet kérni?', 'commerce', 'parcel_locker', null],
  ['Utánvéttel fizethetek?', 'commerce', 'payment', null],
  ['Hogyan jutok hozzá a hírleveles kedvezményhez?', 'coupon', 'acquisition', 'coupon_information'],
  ['Személyesen átvehető?', 'commerce', 'personal_pickup', null],
  ['Van Foxpost?', 'commerce', 'shipping_carrier', null]
];

for (const [question, category, intent, answerIntent] of cases) {
  const turn = detectTurnIntent(question);
  assert.equal(turn.category, category, question);
  assert.equal(turn.intent, intent, question);
  assert.equal(turn.answerIntent, answerIntent, question);
  const goal = detectCustomerGoal(question);
  assert.deepEqual(goal.turnIntent, turn, question);
  const routing = route(question);
  assert.deepEqual(routing.turnIntent, turn, question);
  assert.equal(routing.answerIntent, answerIntent, question);
}

assert.equal(detectTurnIntent('Utánvéttel fizethetek?').detail, 'cash_on_delivery');

assert.equal(detectAnswerIntent('Mennyibe kerül?', {
  answerIntent: 'usage', productQuestionIntent: 'usage', route: 'context_followup'
}), 'usage', 'planner must consume the authoritative structured intent');

assert.equal(detectAnswerIntent('Hogyan használjam?', {
  answerIntent: 'price_query', productQuestionIntent: 'price', route: 'commerce', intent: 'price_query'
}), 'price_query', 'planner must not reinterpret raw wording');

console.log('NORMALIZED_TURN_INTENT_OK');
