'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');
const ask = (question, history = []) => createAnswer({ question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {} });
const context = (id, name) => [{ role: 'user', content: `A ${name} érdekel.` }, { role: 'assistant', content: `${name}.`, route: 'exact_product', intent: 'product_detail', links: [{ id, name }] }];
const turn = (question, result) => [{ role: 'user', content: question }, { role: 'assistant', content: result.answer, route: result.route, intent: result.intent, domain: result.domain, links: result.links }];

const dermavital = context('dermavital_sampon', 'Dermavital sampon');
const psori = context('psorivital_csomag', 'PsoriVital csomag');
const lavender = context('kecsketejes_levendulas_szappan', 'Kecsketejes levendulás szappan');
const solidOily = context('solid_shampoo_oily_rosemary_caffeine', 'Rozmaringos-koffeines szilárd sampon');

const initialRecommendation = ask('Zsíros hajra mit ajánlasz?');
const recommendedHistory = turn('Zsíros hajra mit ajánlasz?', initialRecommendation);
const itchyRecommendation = ask('Viszket a fejbőröm.');
const dermavitalFollowups = turn('Viszket a fejbőröm.', itchyRecommendation);
const availability = ask('Van szilárd samponotok?');
const availabilityHistory = turn('Van szilárd samponotok?', availability);

const cases = [
  ['Van szilárd samponotok?', []],
  ['Van tusfürdőtök?', []],
  ['Mennyibe kerül?', dermavital],
  ['Hogyan használjam?', psori],
  ['Hogyan használjam?', []],
  ['Mit tud ez?', dermavital],
  ['Mire való?', dermavital],
  ['Melyiket ajánlod?', []],
  ['Zsíros hajra mit ajánlasz?', []],
  ['Viszket a fejbőröm.', []],
  ['Pikkelysömörre mit ajánlasz?', []],
  ['Normál bőrre melyik szappan jó?', []],
  ['Érzékeny bőrre keresek szappant.', []],
  ['Van levendulás?', []],
  ['Melyik a legjobb?', []],
  ['Ezt lehet arcra használni?', lavender],
  ['Milyen illata van?', lavender],
  ['Mekkora a kiszerelés?', lavender],
  ['Van belőle másik?', lavender],
  ['Ez szappan vagy sampon?', solidOily],
  ['Mit vegyek mellé?', dermavital],
  ['Melyiket ajánlod?', availabilityHistory],
  ['És hogyan használjam?', dermavitalFollowups],
  ['Mennyibe kerül?', dermavitalFollowups],
  ['Van belőle más illat?', dermavitalFollowups],
  ['Akkor ezt kérem.', dermavitalFollowups],
  ['Van folyékony samponotok?', []],
  ['Mi a különbség a szilárd sampon és a samponszappan között?', []],
  ['Korpás fejbőrre mit ajánlasz?', []],
  ['A Dermavital sampon mire való?', []]
];

assert.equal(cases.length, 30);
const forbidden = /Nézzük meg|Maradjunk az előzőleg|Azért ezt, mert|Erre elsőként|A Vitalis megoldások közül|Segítek megtalálni a számodra|Érdemes figyelembe venni|Fontos megjegyezni/i;

const results = cases.map(([question, history], index) => {
  const result = ask(question, history);
  assert.ok(result.answer && result.answer.trim(), `${index + 1}: empty answer`);
  assert.doesNotMatch(result.answer, forbidden, `${index + 1}: boilerplate`);
  assert.ok(result.communication.wordCount <= result.communication.maximumWords, `${index + 1}: word limit`);
  return { number: index + 1, question, intent: result.intent, mode: result.answerMode, context: result.contextTarget || null, answer: result.answer };
});

for (const item of results) console.log(JSON.stringify(item));
console.log('Minimal answer policy golden conversations: PASS (30)');
