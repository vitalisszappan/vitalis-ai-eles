'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const knowledge = require('./data/knowledge.json');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');

const ruleEngine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
const ask = (question, history = [], conversationState = structuredState(history)) => createAnswer({
  question, history, knowledge, ruleEngine, conversationState, logGap() {}
});

const shipping = ask('Mennyi a szállítás?');
assert.equal(shipping.route, 'business_info');
assert.equal(shipping.intent, 'shipping_cost');
for (const expected of ['GLS házhozszállítás: 1 850 Ft', 'GLS CsomagPont: 1 390 Ft', 'Csomagautomata: 1 500 Ft', 'MPL: 4 500 Ft']) {
  assert.match(shipping.answer, new RegExp(expected), expected);
}
assert.equal(shipping.businessFactStatus, 'OWNER_APPROVED');

const history = [
  { role: 'user', content: 'Mennyi a szállítás?' },
  { role: 'assistant', content: shipping.answer, route: shipping.route, intent: shipping.intent, routing: shipping.routing }
];
const cheapest = ask('melyik a legolcsóbb?', history);
assert.equal(cheapest.route, 'commerce');
assert.equal(cheapest.intent, 'shipping_cheapest');
assert.equal(cheapest.businessFactStatus, 'OWNER_APPROVED');
assert.match(cheapest.answer, /GLS CsomagPont.*1 390 Ft/i);

const directCheapest = ask('Mi a legolcsóbb szállítás?');
assert.equal(directCheapest.intent, 'shipping_cheapest');
assert.match(directCheapest.answer, /GLS CsomagPont.*1 390 Ft/i);

const persistedCheapest = ask('Melyik a legolcsóbb?', [], { ...structuredState([]), lastUserIntent: 'shipping_cost' });
assert.equal(persistedCheapest.route, 'commerce');
assert.equal(persistedCheapest.intent, 'shipping_cheapest');
assert.match(persistedCheapest.answer, /GLS CsomagPont.*1 390 Ft/i);

for (const question of ['Mennyi idő?', 'Mennyi idő a szállítás?', 'Mikor érkezik meg?', 'Hány nap a kiszállítás?']) {
  const result = ask(question);
  assert.equal(result.intent, 'shipping_time', question);
  assert.match(result.answer, /pontos kiszállítási idő.*szállítási módtól.*aktuális teljesítéstől/i, question);
  assert.match(result.answer, /nincs jóváhagyott.*fix kiszállítási idő/i, question);
  assert.doesNotMatch(result.answer, /2 munkanap|48 óra/i, question);
}

for (const question of ['Mikortól ingyenes a szállítás?', 'Van ingyenes szállítás?']) {
  const result = ask(question);
  assert.equal(result.route, 'business_info', question);
  assert.equal(result.intent, 'shipping_free', question);
  assert.equal(result.businessFactStatus, 'OWNER_APPROVED', question);
  assert.match(result.answer, /20 000 Ft feletti.*ingyenes a szállítás/i, question);
}

for (const [question, intent, phrase] of [
  ['Csomagautomatába lehet kérni?', 'parcel_locker', '1 500 Ft'],
  ['Automatába mennyi?', 'parcel_locker', '1 500 Ft'],
  ['Foxpost van?', 'shipping_carrier', 'Nem, Foxpost'],
  ['foxpost?', 'shipping_carrier', 'Nem, Foxpost'],
  ['Személyesen átvehetem?', 'personal_pickup', 'Nem, személyes átvétel'],
  ['személyes átvétel van?', 'personal_pickup', 'Nem, személyes átvétel'],
  ['Regisztrációnál milyen formátumban adjam meg a telefonszámot?', 'registration_phone_format', '06301234567']
]) {
  const result = ask(question);
  assert.equal(result.route, 'commerce', question);
  assert.equal(result.intent, intent, question);
  assert.equal(result.businessFactStatus, 'OWNER_APPROVED', question);
  assert.match(result.answer, new RegExp(phrase, 'i'), question);
}

for (const question of ['Utánvéttel lehet fizetni?', 'utánvét?']) {
  const result = ask(question);
  assert.equal(result.route, 'commerce', question);
  assert.equal(result.intent, 'payment', question);
  assert.match(result.answer, /450 Ft/i, question);
  assert.equal(result.businessFactStatus, 'OWNER_APPROVED', question);
  assert.equal(result.provenance[0].sourceType, 'owner_approved_business_info');
}

for (const question of ['Bankkártyával lehet fizetni?', 'kártyával fizethetek?']) {
  const result = ask(question);
  assert.equal(result.route, 'commerce', question);
  assert.equal(result.intent, 'payment', question);
  assert.equal(result.businessFactStatus, 'CURRENT_VERIFIED', question);
  assert.match(result.answer, /Barion/i, question);
}

const coupon = ask('Hol kell beírni a kupont?');
assert.equal(coupon.route, 'coupon_policy');
assert.equal(coupon.intent, 'entry_location');
assert.match(coupon.answer, /kosár.*KUPON.*Kuponkód.*Ellenőrzés/i);

console.log('WEBSHOP_BUSINESS_INFO_OK');
