'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { normalize } = require('./engine/normalizer.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');

function ask(question, history = []) {
  let gaps = 0;
  const result = createAnswer({
    question,
    history,
    conversationState: structuredState(history),
    knowledge,
    ruleEngine,
    logGap() { gaps += 1; }
  });
  return { ...result, gaps };
}

function turn(question, result) {
  return [
    { role: 'user', content: question },
    { role: 'assistant', content: result.answer, route: result.route, intent: result.intent, domain: result.domain, links: result.links }
  ];
}

const scenarios = [];

const solidQuestion = 'Van szilárd samponotok?';
const solid = ask(solidQuestion);
assert.equal(solid.answerMode, 'DIRECT');
assert.ok(solid.communication.wordCount <= 55);
assert.deepEqual(solid.links.map((item) => item.id), ['solid_shampoo_normal_green_tea', 'solid_shampoo_oily_rosemary_caffeine']);
assert.ok(solid.links.every((item) => item.recommendationType === 'available'));
assert.doesNotMatch(solid.answer, /Nézzük meg|elsőként/i);
scenarios.push(true);

const oily = ask('Melyiket ajánlod zsíros hajra?', turn(solidQuestion, solid));
assert.equal(oily.answerMode, 'RECOMMENDATION');
assert.equal(oily.route, 'hair_product_type');
assert.equal(oily.links[0].id, 'solid_shampoo_oily_rosemary_caffeine');
assert.doesNotMatch(oily.answer, /Nézzük meg/i);
scenarios.push(true);

const comparison = ask('Mi a különbség a szilárd sampon és a samponszappan között?');
assert.equal(comparison.answerMode, 'EXPLANATORY');
assert.equal(comparison.route, 'hair_type_knowledge');
scenarios.push(true);

const price = ask('Mennyibe kerül a Dermavital sampon?');
assert.equal(price.answerMode, 'DIRECT');
assert.equal(price.route, 'commerce');
assert.ok(price.communication.wordCount <= 55);
assert.doesNotMatch(price.answer, /Nézzük meg|kosárba helyezés/i);
scenarios.push(true);

const recommendationQuestion = 'Mit ajánlasz viszkető fejbőrre?';
const recommendation = ask(recommendationQuestion);
const usage = ask('Hogyan használjam?', turn(recommendationQuestion, recommendation));
assert.equal(recommendation.answerMode, 'RECOMMENDATION');
assert.equal(usage.answerMode, 'EXPLANATORY');
assert.equal(usage.route, 'context_followup');
assert.equal(usage.contextTarget, 'dermavital_sampon');
assert.doesNotMatch(usage.answer, /Maradjunk|Korábban már|nem ismétlem meg/i);
scenarios.push(true);

const thanks = ask('Köszönöm.', turn(recommendationQuestion, recommendation));
assert.equal(thanks.answerMode, 'SOCIAL_META');
assert.equal(thanks.route, 'meta');
assert.equal(thanks.gaps, 0);
assert.ok(thanks.communication.wordCount <= 35);
scenarios.push(true);

const absent = ask('Van teafa-levendula samponszappan?');
assert.equal(absent.answerMode, 'DIRECT');
assert.match(normalize(absent.answer), /nincs/);
assert.equal(absent.links.length, 0);
assert.equal(absent.gaps, 0);
scenarios.push(true);

const itchy = ask(recommendationQuestion);
assert.equal(itchy.answerMode, 'RECOMMENDATION');
assert.equal(itchy.links[0].id, 'dermavital_sampon');
scenarios.push(true);

assert.equal(scenarios.length, 8);
console.log('Knowledge Builder answer-mode acceptance: PASS (8/8)');
