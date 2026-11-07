'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');
const restore = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restore);
const knowledge = require('./data/knowledge.json');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState, rehydrateSessionHistory } = require('./engine/conversation-memory.cjs');
const { detectCommerceIntent } = require('./engine/commerce-intents.cjs');
const { detectBusinessInfo } = require('./engine/business-info.cjs');
const { buildConversationHistoryEvent, validateConversationHistoryRows } = require('./server.cjs');

const ruleEngine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
const ask = (question, history = [], state = structuredState(history)) => createAnswer({
  question, history, conversationState: state, knowledge, ruleEngine, logGap() {}, logDiagnostic() {}
});
const append = (history, question, result) => [
  ...history, { role: 'user', content: question }, { role: 'assistant', content: result.answer, ...result }
];
const assertPickup = (result, question) => {
  assert.equal(result.route, 'commerce', question);
  assert.equal(result.intent, 'personal_pickup', question);
  assert.equal(result.businessFactStatus, 'OWNER_APPROVED', question);
  assert.equal(result.answer, 'Nem, személyes átvétel jelenleg nem elérhető.', question);
  assert.deepEqual(result.links, [], question);
};

for (const question of [
  'hol tudom megvenni személyesen is',
  'személyesen hol lehet kapni',
  'hol lehet kapni személyesen',
  'személyesen hol kapható',
  'személyesen meg lehet venni?',
  'van személyes üzletetek?'
]) {
  assert.equal(detectCommerceIntent(question)?.intent, 'personal_pickup', question);
  assertPickup(ask(question), question);
}

for (const question of [
  'nem akarok szállítási költséget fizetni',
  'hogyan lehet ingyenes a szállítás?',
  'hogy ne kelljen szállítási díjat fizetnem?',
  'nem szeretnék szállítási díjat fizetni',
  'mikor nem kell szállításért fizetni?'
]) {
  assert.equal(detectBusinessInfo(question)?.intent, 'shipping_free', question);
  const result = ask(question);
  assert.equal(result.route, 'business_info', question);
  assert.equal(result.intent, 'shipping_free', question);
  assert.equal(result.businessFactStatus, 'OWNER_APPROVED', question);
  assert.equal(result.answer, '20 000 Ft feletti rendelésnél ingyenes a szállítás.', question);
  assert.deepEqual(result.links, [], question);
}
assert.equal(detectBusinessInfo('Mennyi a szállítási díj?')?.intent, 'shipping_cost');

for (const question of [
  'Holt-tengeri só balzsamot szeretnék venni, de csak más termékekkel együtt csomagban hozza, amikor a kosárba teszem',
  'csak ezt a terméket akarom, de csomagot tesz a kosárba',
  'kosárba teszem és más termékeket is hozzáad',
  'a balzsam helyett csomagot rak a kosárba',
  'nem külön a terméket teszi a kosárba'
]) {
  assert.equal(detectCommerceIntent(question)?.intent, 'checkout_problem', question);
  const result = ask(question);
  assert.equal(result.route, 'commerce', question);
  assert.equal(result.intent, 'checkout_problem', question);
  assert.equal(result.source, 'commerce-assistance', question);
  assert.match(result.answer, /kosárnál.*adatok megadásánál.*fizetésnél/i, question);
  assert.match(result.answer, /hibaüzenet/i, question);
  assert.match(result.answer, /bankkártyaadatot.*jelszót/i, question);
  assert.doesNotMatch(result.answer, /megoldottam|kijavítottam|kosárba tettem/i, question);
}
for (const question of ['Mi van a PsoriVital csomagban?', 'Milyen termékek vannak a csomagban?', 'A csomagot teszem a kosárba.']) {
  assert.notEqual(detectCommerceIntent(question)?.intent, 'checkout_problem', question);
  assert.notEqual(ask(question).intent, 'checkout_problem', question);
}

const firstQuestion = 'Milyen krémet ajánlasz?';
const first = ask(firstQuestion);
assert.equal(first.route, 'clarification');
assert.equal(first.routing.contextTarget, 'guided_discovery');
assert.match(first.answer, /bőrigényre/i);
const creamHistory = append([], firstQuestion, first);
assert.equal(structuredState(creamHistory).guidedDiscovery.productType.value, 'krem');
assertPickup(ask('hol tudom megvenni személyesen is', creamHistory), 'pickup after cream');

for (const question of ['látom nem érti', 'nem érti', 'nem ezt kérdeztem', 'félreértette', 'félreértett']) {
  const result = ask(question, creamHistory);
  assert.equal(result.route, 'meta', question);
  assert.equal(result.intent, 'conversation-repair', question);
  assert.equal(result.answer, 'Értem, írd meg még egyszer röviden, mire vagy kíváncsi, és arra válaszolok.', question);
  assert.deepEqual(result.links, [], question);
  assert.equal(result.targetProductId == null, true, question);
}
const repair = ask('látom nem érti', creamHistory);
const repairedHistory = append(creamHistory, 'látom nem érti', repair);
assertPickup(ask('Még egyszer kérdezem, személyesen hol lehet kapni', repairedHistory), 'pickup after repair');

const productQuestion = 'Mire javaslod a Dermavital krémet?';
const productHistory = append([], productQuestion, ask(productQuestion));
assert.equal(structuredState(productHistory).focusedProductId, 'dermavital_krem');
const productRepair = ask('látom nem érti', productHistory);
assert.equal(productRepair.route, 'meta');
assert.equal(productRepair.intent, 'conversation-repair');
assert.equal(productRepair.answer, 'Értem, írd meg még egyszer röviden, mire vagy kíváncsi, és arra válaszolok.');
assert.deepEqual(productRepair.links, []);
assert.equal(productRepair.targetProductId == null, true);
assertPickup(ask('Még egyszer kérdezem, személyesen hol lehet kapni', append(productHistory, 'látom nem érti', productRepair)), 'pickup after product repair');

(async () => {
  const rows = validateConversationHistoryRows([{
    id: crypto.randomUUID(), created_at: '2026-10-20T08:00:00.000Z',
    question: firstQuestion, answer: first.answer, source: first.source,
    routing_trace: first.routing, history_event: buildConversationHistoryEvent(first, crypto.randomUUID())
  }]);
  const memory = await rehydrateSessionHistory({
    sessionId: 'natural-commerce-repair-session', clientHistory: [], loadRows: async () => rows
  });
  assert.equal(memory.state.guidedDiscovery.productType.value, 'krem');
  assertPickup(ask('hol tudom megvenni személyesen is', memory.history, memory.state), 'pickup after reload');
  const persistedRepair = ask('látom nem érti', memory.history, memory.state);
  assert.equal(persistedRepair.intent, 'conversation-repair');
  assert.deepEqual(persistedRepair.links, []);
  const history = append(memory.history, 'látom nem érti', persistedRepair);
  assertPickup(ask('Még egyszer kérdezem, személyesen hol lehet kapni', history), 'pickup after reload and repair');
  restore();
  console.log('TEST_NATURAL_COMMERCE_REPAIR: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
