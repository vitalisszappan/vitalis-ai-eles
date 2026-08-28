'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const knowledge = require('./data/knowledge.json');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { composeCommunication } = require('./engine/communication-engine.cjs');

const ruleEngine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
const ask = (question, history = []) => createAnswer({
  question, history, knowledge, ruleEngine, conversationState: structuredState(history), logGap() {}
});

let cases = 0;
function check(question, intent, verify) {
  const result = ask(question);
  assert.equal(result.route, 'business_info', question);
  assert.equal(result.intent, intent, question);
  assert.equal(result.contextUsed, false, question);
  assert.equal(result.contextTarget, null, question);
  assert.deepEqual(result.links, [], question);
  assert.equal(result.source, 'business-info', question);
  verify?.(result);
  cases += 1;
}

for (const question of [
  'Hogyan léphetek kapcsolatba veletek?', 'Mi az ügyfélszolgálati e-mail?',
  'Hol érlek el benneteket?', 'Kapcsolat', 'Elérhetőség?'
]) check(question, 'contact', ({ answer }) => {
  assert.match(answer, /ugyfelszolgalat@vitalis-szappan\.hu/);
  assert.doesNotMatch(answer, /\+36|telefon|telefonszám/i);
});

let catalogAnswer = null;
for (const question of [
  'Milyen termékeitek vannak?', 'Milyen más termékeitek vannak?',
  'Milyen termékeket árultok?', 'Mit lehet nálatok kapni?', 'Mik a termékkategóriáitok?'
]) check(question, 'general_catalog', (result) => {
  assert.match(result.answer, /kategóri/i);
  if (catalogAnswer == null) catalogAnswer = result.answer;
  else assert.equal(result.answer, catalogAnswer, 'catalog summary must be deterministic');
});

for (const question of [
  'Mennyibe kerül a szállítás?', 'Mi a kiszállítás díja?',
  'Mekkora a szállítási költség?', 'A szállítás mennyibe kerül?', 'Mennyit fizetek a postázásért?',
  'Mennyi a szállítás?', 'Hol látom a szállítási díjat?'
]) check(question, 'shipping_cost', ({ answer }) => {
  assert.match(answer, /pénztár/i);
  assert.doesNotMatch(answer, /melyik termékre/i);
});

for (const question of [
  'Mennyi idő a kiszállítás?', 'Hány nap a szállítás?',
  'Mikor érkezik meg?', 'Hány nap alatt ér ide?', 'Mi a szállítási idő?', 'Mennyire gyorsan szállítotok?'
]) check(question, 'shipping_time', ({ answer }) => assert.match(answer, /körülbelül 2 munkanap/i));

for (const question of ['GLS-sel szállítotok?', 'MPL-lel külditek?', 'DPD hozza ki?', 'Melyik futárszolgálat szállít?']) {
  check(question, 'shipping_carrier_unknown', ({ answer }) => {
    assert.match(answer, /nem tudom biztosan/i);
    assert.doesNotMatch(answer, /\b(GLS|MPL|DPD)\b/i);
  });
}
for (const question of ['Van ingyenes kiszállítás?', 'Mikortól díjmentes a szállítás?', 'Ingyenes a szállítás?']) {
  check(question, 'shipping_free_unknown', ({ answer }) => {
    assert.match(answer, /nem tudom biztosan/i);
    assert.doesNotMatch(answer, /\b\d{4,}\s*(?:Ft|forint)/i);
  });
}

for (const question of [
  'Hogyan kérhetek visszatérítést?', 'Mi a visszaküldési szabályzat?',
  'Kicserélitek a hibás terméket?', 'Mennyi a garancia?',
  'Van személyes üzletetek?', 'Mikor vagytok nyitva?',
  'Mi a mostani promóció?', 'Milyen akció fut jelenleg?'
]) {
  const result = ask(question);
  assert.notEqual(result.route, 'business_info', question);
  cases += 1;
}

for (const question of ['Van kuponkód?', 'Milyen kedvezménykód van?']) {
  const result = ask(question);
  assert.notEqual(result.route, 'business_info', question);
  assert.match(result.answer, /kupon|kedvezmény|hírlevél/i, question);
  cases += 1;
}

const prior = ask('Mit ajánlasz ekcémára?');
const contextHistory = [
  { role: 'user', content: 'Mit ajánlasz ekcémára?' },
  { role: 'assistant', content: prior.answer, route: prior.route, intent: prior.intent, links: prior.links, contextTarget: prior.contextTarget }
];
for (const question of ['Milyen más termékeitek vannak?', 'Mennyibe kerül a szállítás?']) {
  const result = ask(question, contextHistory);
  assert.equal(result.route, 'business_info', question);
  assert.equal(result.contextUsed, false, question);
  assert.equal(result.contextTarget, null, question);
  assert.deepEqual(result.links, [], question);
  cases += 1;
}

const communication = composeCommunication({
  decision: { route: 'business_info', answerMode: 'direct', intent: 'contact', goal: 'business_information' },
  draft: { answer: 'Írj az ugyfelszolgalat@vitalis-szappan.hu címre. Segítünk.', links: [] },
  question: 'Mi az e-mail címetek?', history: []
});
assert.match(communication.answer, /ugyfelszolgalat@vitalis-szappan\.hu/);
cases += 1;

assert(cases >= 40, `expected at least 40 cases, got ${cases}`);
console.log(`PASS — BUSINESS INFO C1 (${cases}/${cases})`);
