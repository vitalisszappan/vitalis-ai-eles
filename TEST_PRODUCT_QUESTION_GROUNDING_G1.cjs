'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');
const restoreCatalogFixture = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restoreCatalogFixture);
const { createAnswer } = require('./engine/answer-service.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');
const ask = (question, history = []) => createAnswer({ question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });
const add = (history, question, result) => history.push(
  { role: 'user', content: question },
  { role: 'assistant', content: result.answer, route: result.route, intent: result.intent, domain: result.domain, responseType: result.responseSource, targetProductId: result.targetProductId, links: result.links }
);

let result = ask('Mi van a Dermavital krémben?');
assert.equal(result.answerIntent, 'ingredients'); assert.equal(result.targetProductId, 'dermavital_krem'); assert.equal(result.groundingStatus, 'grounded'); assert.match(result.answer, /Urea \(Karbamid\)/); // 1

let history = []; let seed = ask('Mit tudsz a Dermavital krémről?'); add(history, 'Mit tudsz a Dermavital krémről?', seed);
result = ask('Mi van benne?', history); assert.equal(result.answerIntent, 'ingredients'); assert.equal(result.targetProductId, 'dermavital_krem'); assert.match(result.answer, /Urea \(Karbamid\)/); // 2
result = ask('Van a Dermavital krémben urea?'); assert.equal(result.answerIntent, 'ingredients'); assert.match(result.answer, /^Igen/); // 3
result = ask('Van benne urea?', history); assert.equal(result.targetProductId, 'dermavital_krem'); assert.match(result.answer, /^Igen/); // 4
result = ask('Van a Dermavital krémben ceramid?'); assert.equal(result.groundingStatus, 'grounded'); assert.match(result.answer, /nem szerepel ceramid/i); // 5
result = ask('Van a rozmaringos samponszappanban rozmaring?'); assert.match(result.answer, /^Igen/);
result = ask('Mi van a Holt-tengeri só balzsamban?'); assert.equal(result.answerIntent, 'ingredients'); assert.equal(result.groundingStatus, 'unavailable'); assert.match(result.answer, /nincs elérhető, bizonyított összetevőlistánk/i); // 6
result = ask('Van a Dermavital samponban rozmaring?'); assert.equal(result.groundingStatus, 'unavailable'); assert.doesNotMatch(result.answer, /^Nem|nincs a jelenlegi Vitalis kínálatban/i); // 7

result = ask('Mire jó a Dermavital krém?'); assert.equal(result.answerIntent, 'product_benefits'); assert.equal(result.targetProductId, 'dermavital_krem'); // 8
result = ask('Mire jó?', history); assert.equal(result.answerIntent, 'product_benefits'); assert.equal(result.targetProductId, 'dermavital_krem'); // 9
result = ask('Hogyan használjam a Dermavital krémet?'); assert.equal(result.answerIntent, 'usage'); assert.match(result.answer, /naponta 1–3 alkalommal/); // 10
result = ask('Hogyan használjam?', history); assert.equal(result.answerIntent, 'usage'); assert.equal(result.targetProductId, 'dermavital_krem'); // 11
result = ask('Mennyibe kerül a Dermavital krém?'); assert.equal(result.answerIntent, 'price_query'); assert.match(result.answer, /3 700 Ft/); // 12
result = ask('Mennyibe kerül?', history); assert.equal(result.answerIntent, 'price_query'); assert.equal(result.targetProductId, 'dermavital_krem'); // 13

result = ask('Mi a különbség a Dermavital sampon és a rozmaringos samponszappan között?');
assert.equal(result.answerIntent, 'comparison'); assert.deepEqual(result.links.map((item) => item.id), ['dermavital_sampon', 'rozmaringos_samponszappan']); assert.match(result.answer, /Dermavital/); assert.match(result.answer, /Samponszappan/); // 14
result = ask('Hasonlítsd össze a Dermavital sampont és a rozmaringos samponszappant.'); assert.equal(result.answerIntent, 'comparison'); assert.equal(result.links.length, 2);
result = ask('Melyik olcsóbb: Dermavital krém vagy Holt-tengeri só balzsam?'); assert.equal(result.answerIntent, 'comparison'); assert.match(result.answer, /3 700 Ft/); assert.match(result.answer, /4 290 Ft/); // 15
result = ask('Mi a különbség a Dermavital sampon és a Holt-tengeri só balzsam összetevői között?'); assert.equal(result.groundingStatus, 'unavailable'); assert.match(result.answer, /nem tudom teljes körűen összehasonlítani/i); // 16

history = [{ role: 'assistant', content: 'Két lehetőség.', links: [{ id: 'dermavital_krem', name: 'Dermavital krém' }, { id: 'holt_tengeri_so_balzsam', name: 'Holt-tengeri só balzsam' }] }];
result = ask('Mi a különbség köztük?', history); assert.equal(result.answerIntent, 'comparison'); assert.deepEqual(result.links.map((item) => item.id), ['dermavital_krem', 'holt_tengeri_so_balzsam']); // 17
result = ask('Melyik jobb: Dermavital krém vagy Holt-tengeri só balzsam?'); assert.match(result.answer, /attól függ/i); assert.doesNotMatch(result.answer, /Dermavital[^.]* a jobb|balzsam[^.]* a jobb/i); // 18
result = ask('Mi a különbség a Holt-tengeri só balzsam és a Dermavital krém között?'); assert.deepEqual(result.links.map((item) => item.id), ['holt_tengeri_so_balzsam', 'dermavital_krem']); // 19

history = [{ role: 'assistant', content: 'A Holt-tengeri só balzsamot választottad a két lehetőség közül.', route: 'context_followup', intent: 'select_recommendation', targetProductId: 'holt_tengeri_so_balzsam', links: [{ id: 'dermavital_krem', name: 'Dermavital krém' }, { id: 'holt_tengeri_so_balzsam', name: 'Holt-tengeri só balzsam' }] }];
result = ask('Mennyibe kerül?', history); assert.equal(result.targetProductId, 'holt_tengeri_so_balzsam'); // 20
result = ask('A másikban mi van?', history); assert.equal(result.answerIntent, 'ingredients'); assert.equal(result.targetProductId, 'dermavital_krem'); // 21

result = ask('Mi a különbség a Dermavital krém és a Holt-tengeri só balzsam között?'); assert.equal(result.routing.semanticGuard.enforcementApplied, false); // 22
result = ask('Dermavital szappan csíp'); assert.equal(result.route, 'complaint'); assert.equal(result.routing.semanticGuard.resolutionOwner, 'complaint'); // 23
result = ask('Dermavital krémtől nehezen kapok levegőt'); assert.equal(result.route, 'safety'); // 24
result = ask('Mi van a Holt-tengeri só balzsamban?'); assert.deepEqual(result.links.map((item) => item.id), ['holt_tengeri_so_balzsam']); // 25

result = ask('Keresek valami jó krémet.'); assert.equal(result.intent, 'conversation-clarification'); assert.deepEqual(result.links, []); assert.match(result.answer, /Milyen bőrigényre/);

console.log('Product Question Grounding G1: PASS (25 contracts + generic cream)');
