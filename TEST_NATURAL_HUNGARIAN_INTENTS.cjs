'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');

const restore = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restore);

const { createAnswer } = require('./engine/answer-service.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const knowledge = require('./data/knowledge.json');
const ruleEngine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
const ask = (question, history = []) => createAnswer({
  question,
  history,
  conversationState: structuredState(history),
  knowledge,
  ruleEngine,
  logGap() {},
  logDiagnostic() {}
});

const psoriasisQuestion = 'Hol találok pikkelysömörre megoldást?';
const psoriasisRecommendation = ask(psoriasisQuestion);
const psoriasisHistory = [
  { role: 'user', content: psoriasisQuestion },
  { role: 'assistant', content: psoriasisRecommendation.answer, ...psoriasisRecommendation }
];
const skinHistory = [
  { role: 'user', content: 'Száraz a bőröm' },
  { role: 'assistant', content: 'A Dermavital krémet javaslom.', route: 'expert_rule', intent: 'dry_skin',
    links: [{ id: 'dermavital_krem', name: 'Dermavital krém' }] }
];
const guidedHistory = [
  { role: 'user', content: 'Milyen szappant ajánlasz?' },
  { role: 'assistant', content: 'Milyen bőrre keresed?', route: 'clarification', intent: 'product_recommendation' }
];
let assertions = 0;
const equal = (actual, expected, message) => { assertions += 1; assert.equal(actual, expected, message); };
const notEqual = (actual, expected, message) => { assertions += 1; assert.notEqual(actual, expected, message); };
const match = (actual, expected, message) => { assertions += 1; assert.match(actual, expected, message); };
const doesNotMatch = (actual, expected, message) => { assertions += 1; assert.doesNotMatch(actual, expected, message); };
const deepEqual = (actual, expected, message) => { assertions += 1; assert.deepEqual(actual, expected, message); };

const couponCases = [
  ['Add a kupon kódot', 'code_request'],
  ['Adj kuponkódot', 'code_request'],
  ['Adj egy kuponkódot', 'code_request'],
  ['Kérek egy kuponkódot', 'code_request'],
  ['Kérem a kuponkódot', 'code_request'],
  ['Kérem a kupont', 'acquisition'],
  ['Hol kapom meg a kupont?', 'acquisition'],
  ['Első vásárló vagyok', 'coupon_exists'],
  ['Hol a 10 százalék?', 'acquisition'],
  ['Nem kaptam meg a kupont', 'delivery_missing'],
  ['Kaphatok kedvezményt?', 'coupon_exists'],
  ['Milyen kupon jár első rendelésre?', 'coupon_exists']
];

for (const [question, intent] of couponCases) {
  const result = ask(question);
  equal(result.route, 'coupon_policy', `coupon route: ${question}`);
  equal(result.intent, intent, `coupon intent: ${question}`);
  if (['code_request', 'acquisition'].includes(intent)) {
    match(result.answer, /Iratkozz fel a hírlevelünkre.*10%-os kupont.*e-mailben/i, `approved coupon response: ${question}`);
    doesNotMatch(result.answer, /\b[A-Z0-9]{6,}\b/, `do not disclose coupon code: ${question}`);
  }
}

for (const question of ['10% niacinamide', '10 százalék urea', 'Add a terméket a kosárhoz', 'Adj egy szappant', 'Kérek egy krémet']) {
  const result = ask(question);
  notEqual(result.route, 'coupon_policy', `not coupon: ${question}`);
  notEqual(result.intent, 'coupon', `not legacy coupon intent: ${question}`);
}

const freeShippingCases = [
  'ingyenes szállítás érdekelne',
  'hogyan lehet ingyenes a szállítás?',
  'nem akarok szállítási költséget fizetni',
  'mikortól ingyenes a szállítás?',
  'mennyit kell rendelni az ingyenes szállításhoz?',
  'díjmentes szállítás érdekelne',
  'ingyenes kiszállítás',
  'ingyenes szallitas erdekelne',
  'mikor nem kell szállítási díjat fizetni?',
  'hogy kapok ingyenes kiszállítást?'
];

for (const question of freeShippingCases) {
  for (const [contextName, history] of [['fresh', []], ['product', skinHistory], ['guided', guidedHistory]]) {
    const result = ask(question, history);
    equal(result.route, 'business_info', `${contextName} free shipping route: ${question}`);
    equal(result.intent, 'shipping_free', `${contextName} free shipping intent: ${question}`);
    equal(result.answer, '20 000 Ft feletti rendelésnél ingyenes a szállítás.', `${contextName} approved free shipping fact: ${question}`);
  }
}

for (const [contextName, history] of [['fresh', []], ['product', skinHistory], ['guided', guidedHistory]]) {
  const result = ask('szállítás érdekelne', history);
  equal(result.route, 'commerce', `${contextName} generic shipping route`);
  equal(result.intent, 'shipping_general', `${contextName} generic shipping intent`);
  doesNotMatch(result.answer, /ingyenes/i, `${contextName} generic shipping answer`);
}

const pickupCases = [
  'hol tudom megvenni személyesen?',
  'személyesen hol lehet kapni?',
  'van üzletetek?',
  'személyesen átvehetem?',
  'be lehet menni érte?',
  'hol vehetem át személyesen a rendelésem?',
  'át tudom venni nálatok?',
  'kérek személyes átvételt',
  'van bolt ahol átvehetem?',
  'személyesen meg tudom venni?'
];

for (const question of pickupCases) {
  for (const [contextName, history] of [['fresh', []], ['product', skinHistory]]) {
    const result = ask(question, history);
    equal(result.route, 'commerce', `${contextName} pickup route: ${question}`);
    equal(result.intent, 'personal_pickup', `${contextName} pickup intent: ${question}`);
    equal(result.answer, 'Nem, személyes átvétel jelenleg nem elérhető.', `${contextName} approved pickup answer: ${question}`);
  }
}

for (const question of ['Van termékünk ehhez?', 'Milyen termék érhető el?']) {
  notEqual(ask(question).intent, 'personal_pickup', `generic availability is not pickup: ${question}`);
}

const checkoutCases = [
  'csak a balzsamot akarom, de csomagot rak a kosárba',
  'mást is hozzáad a kosárhoz',
  'nem azt teszi a kosárba, amit választottam',
  'a kosárban más termék jelenik meg',
  'nem külön a balzsam kerül a kosárba',
  'csak a balzsamot kérem, mégis csomagba teszi',
  'miért ad hozzá más terméket a kosárhoz?',
  'nem azt kapom a kosárban, amit kiválasztottam',
  'csomagot tesz a kosárba a termék helyett',
  'Más termék kerül a kosárba, mint amit választottam',
  'nem azt rakja a kosárba, amit kérek'
];

for (const question of checkoutCases) {
  for (const [contextName, history] of [['fresh', []], ['product', skinHistory], ['guided', guidedHistory]]) {
    const result = ask(question, history);
    equal(result.route, 'commerce', `${contextName} checkout route: ${question}`);
    equal(result.intent, 'checkout_problem', `${contextName} checkout intent: ${question}`);
  }
}

for (const question of ['Add a terméket a kosárhoz', 'Mi van a PsoriVital csomagban?']) {
  const result = ask(question, skinHistory);
  notEqual(result.intent, 'checkout_problem', `not checkout problem: ${question}`);
}

const recommendationChoiceCases = [
  'Melyik a jobb?',
  'Melyik jobb?',
  'Melyiket ajánlod inkább?',
  'Ha csak egyet választanál?',
  'Te melyiket vennéd?',
  'Melyikkel kezdjek?',
  'Ha egyet kéne választani?',
  'Melyikkel érdemes kezdeni?'
];

for (const question of recommendationChoiceCases) {
  const result = ask(question, psoriasisHistory);
  equal(result.route, 'recommendation_alternative', `trusted choice route: ${question}`);
  equal(result.intent, 'recommendation_choice', `trusted choice intent: ${question}`);
  equal(result.targetProductId, 'psorivital_csomag', `trusted primary target: ${question}`);
  equal(result.routing.primaryProductId, 'psorivital_csomag', `trusted primary routing: ${question}`);
  match(result.answer, /PsoriVital/i, `chosen product mentioned: ${question}`);
  match(result.answer, /(elsőként|elsődleges|inkább|választanám|javaslom)/i, `need-scoped preference phrasing: ${question}`);
  doesNotMatch(result.answer, /\b(univerzálisan|mindenkinek|mindig)\s+jobb\b/i, `no universal superiority: ${question}`);
  match(result.answer, /Dermavital szappan.*Tengeri sószappan|Tengeri sószappan.*Dermavital szappan/i, `alternatives retained: ${question}`);
}

for (const question of ['Melyik a jobb?', 'Melyikkel kezdjek?']) {
  const result = ask(question);
  notEqual(result.targetProductId, 'psorivital_csomag', `fresh choice has no invented target: ${question}`);
  notEqual(result.routing?.primaryProductId, 'psorivital_csomag', `fresh choice has no invented primary: ${question}`);
  deepEqual(result.links, [], `fresh choice has no invented product links: ${question}`);
}

restore();
console.log(`TEST_NATURAL_HUNGARIAN_INTENTS: PASS (${assertions} assertions)`);
