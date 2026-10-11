'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const knowledge = require('./data/knowledge.json');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');

const ruleEngine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
const ask = (question, history = []) => createAnswer({
  question, history, knowledge, ruleEngine, conversationState: structuredState(history), logGap() {}
});

const shipping = ask('Mennyi a szállítás?');
assert.equal(shipping.route, 'business_info');
assert.equal(shipping.intent, 'shipping_cost');
assert.match(shipping.answer, /nincs jóváhagyott adatunk/i);
assert.doesNotMatch(shipping.answer, /\b\d[\d .]*\s*(?:Ft|forint)\b/i);

const history = [
  { role: 'user', content: 'Mennyi a szállítás?' },
  { role: 'assistant', content: shipping.answer, route: shipping.route, intent: shipping.intent, routing: shipping.routing }
];
const cheapest = ask('melyik a legolcsóbb?', history);
assert.equal(cheapest.route, 'commerce');
assert.equal(cheapest.intent, 'shipping_cheapest');
assert.equal(cheapest.businessFactStatus, 'BUSINESS_CONTENT_NEEDED');
assert.match(cheapest.answer, /nincs jóváhagyott, aktuális adatunk/i);

for (const [question, intent, phrase] of [
  ['Csomagautomatába lehet kérni?', 'parcel_locker', 'csomagautomatás'],
  ['automatába?', 'parcel_locker', 'csomagautomatás'],
  ['Foxpost van?', 'shipping_carrier', 'Foxpost'],
  ['foxpost?', 'shipping_carrier', 'Foxpost'],
  ['Személyesen átvehetem?', 'personal_pickup', 'személyes átvétel'],
  ['személyes átvétel van?', 'personal_pickup', 'személyes átvétel'],
  ['Regisztrációnál milyen formátumban adjam meg a telefonszámot?', 'registration_phone_format', 'telefonszám-formátum']
]) {
  const result = ask(question);
  assert.equal(result.route, 'commerce', question);
  assert.equal(result.intent, intent, question);
  assert.equal(result.businessFactStatus, 'BUSINESS_CONTENT_NEEDED', question);
  assert.match(result.answer, new RegExp(phrase, 'i'), question);
}

for (const question of ['Utánvéttel lehet fizetni?', 'utánvét?']) {
  const result = ask(question);
  assert.equal(result.route, 'commerce', question);
  assert.equal(result.intent, 'payment', question);
  assert.equal(result.businessFactStatus, 'CURRENT_VERIFIED', question);
  assert.match(result.answer, /futárnak.*készpénzben/i, question);
  assert.match(result.provenance[0].url, /vitalis-szappan\.hu\/shop_help\.php/);
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
