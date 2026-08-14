'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');
const ask = (question, history = []) => createAnswer({ question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {} });
const turn = (question, result) => [
  { role: 'user', content: question },
  { role: 'assistant', content: result.answer, route: result.route, intent: result.intent, domain: result.domain, links: result.links }
];

const cases = [
  ['Van szilárd samponotok?', 'DIRECT', 55],
  ['van tusfürdőtök?', 'DIRECT', 55],
  ['Mennyibe kerül a Dermavital sampon?', 'DIRECT', 55],
  ['Mit ajánlasz ekcémára?', 'RECOMMENDATION', 90],
  ['viszkető fejbőrre mit használjak?', 'RECOMMENDATION', 90],
  ['Mi a különbség a szilárd sampon és a samponszappan között?', 'EXPLANATORY', 120],
  ['Köszönöm szépen.', 'SOCIAL_META', 35]
];

for (const [question, mode, maximum] of cases) {
  const result = ask(question);
  assert.equal(result.communication?.engine, 'vitalis-communication/v2', `${question}: communication engine`);
  assert.equal(result.answerMode, mode, `${question}: answer mode`);
  assert.equal(result.communication.answerMode, mode, `${question}: communication mode`);
  assert.ok(result.communication.wordCount <= maximum, `${question}: mode maximum`);
  assert.doesNotMatch(result.answer, /Nézzük meg|Maradjunk|Korábban már|nem ismétlem meg/i, `${question}: filler`);
  for (const link of result.links || []) {
    if (mode === 'RECOMMENDATION') assert.ok(link.reason, `${question}: recommendation reason`);
    else assert.equal(link.reason, '', `${question}: no unsolicited recommendation reason`);
  }
  if (mode === 'DIRECT') {
    for (const link of result.links || []) assert.equal(link.recommendationLabel, 'Elérhető termék', `${question}: neutral card label`);
  }
}

const initialQuestion = 'Mit ajánlasz viszkető fejbőrre?';
const initial = ask(initialQuestion);
const usage = ask('Hogyan használjam?', turn(initialQuestion, initial));
assert.equal(usage.answerMode, 'EXPLANATORY');
assert.equal(usage.contextTarget, 'dermavital_sampon');
assert.notEqual(usage.answer, initial.answer);
assert.doesNotMatch(usage.answer, /Nézzük meg|Maradjunk|Korábban már|nem ismétlem meg/i);

console.log(`Communication Engine regresszió: PASS (${cases.length} mód + follow-up)`);
