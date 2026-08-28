'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');
const restore = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restore);
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');

const parsed = JSON.parse(fs.readFileSync('./data/knowledge.json', 'utf8'));
const knowledge = Array.isArray(parsed) ? parsed : parsed.items || parsed.knowledge || [];
const ruleEngine = new ExpertRuleEngine('./data/rules/expert-rules.json');
const ask = (question, history = []) => createAnswer({ question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {} });
const append = (history, question, result) => [...history, { role: 'user', content: question }, { role: 'assistant', content: result.answer, ...result }];
const turn = (history, question) => { const result = ask(question, history); return { result, history: append(history, question, result) }; };
const noCards = (result) => assert.deepEqual(result.links, []);

for (const query of ['Csak körülnéznék.', 'Nem tudom mit keresek, csak körülnéznék.']) {
  const result = ask(query);
  assert.equal(result.route, 'business_info');
  assert.equal(result.intent, 'general_catalog');
  assert.match(result.answer, /kategóri/i);
  noCards(result);
}
let run = turn([], 'Csak körülnéznék.');
run = turn(run.history, 'Mutass szappanokat.');
assert.equal(run.result.route, 'product_category');
assert.ok(run.result.links.length > 0);

const needOnly = [
  ['Érzékeny a bőröm, mit ajánlasz?', 'sensitive_skin', /szappant vagy krémet/i],
  ['Nagyon száraz a kezem.', 'dry_hands', /kézkrémet vagy szappant/i],
  ['Ráncos bőrre keresek valamit.', 'wrinkles_or_mature_skin', /krémet vagy balzsamot/i]
];
for (const [query, need, wording] of needOnly) {
  const result = ask(query);
  assert.equal(result.route, 'clarification');
  assert.equal(result.routing.guidedDiscovery.needState.value, need);
  assert.match(result.answer, wording);
  noCards(result);
}

for (const [query, type] of [['Valami jó krémet keresek.', 'krem'], ['Szappant keresek.', 'szappan'], ['Sampon érdekel.', 'shampoo']]) {
  const result = ask(query);
  assert.equal(result.route, 'clarification');
  assert.equal(result.routing.guidedDiscovery.productType.value, type);
  assert.match(result.answer, /Milyen bőrigényre/i);
  noCards(result);
}

let result = ask('Milyen szappant ajánlasz érzékeny bőrre?');
assert.equal(result.route, 'product_category');
assert.ok(result.links.some((link) => /kecsketejes/i.test(link.name)));

for (const sequence of [
  ['Nagyon száraz a kezem.', 'Inkább szappant keresek.', 'dry_hands'],
  ['Ráncos bőrre keresek valamit.', 'Van krémetek?', 'wrinkles_or_mature_skin']
]) {
  run = turn([], sequence[0]);
  run = turn(run.history, sequence[1]);
  assert.equal(run.result.route, 'clarification');
  assert.equal(run.result.routing.guidedDiscovery.needState.value, sequence[2]);
  noCards(run.result);
}

run = turn([], 'Mit ajánlasz pattanásos bőrre?');
run = turn(run.history, 'És érzékeny bőrre?');
assert.equal(run.result.routing.guidedDiscovery.needState.value, 'sensitive_skin');
assert.notEqual(run.result.intent, 'acne');
noCards(run.result);
run = turn(run.history, 'Inkább krémet keresek.');
assert.equal(run.result.routing.guidedDiscovery.needState.value, 'sensitive_skin');
assert.equal(run.result.routing.guidedDiscovery.productType.value, 'krem');
assert.notEqual(run.result.intent, 'acne');
noCards(run.result);

run = turn([], 'Krém érdekel.');
run = turn(run.history, 'Száraz bőrre.');
assert.equal(run.result.route, 'clarification');
assert.notEqual(run.result.routing.primaryProductId, 'shea_vajas_szappan');
noCards(run.result);

for (const query of ['Van valami száraz bőrre?', 'Mit ajánlotok pikkelysömörre?', 'Mit ajánlasz ekcémára?', 'Viszket és hámlik a fejbőröm.']) {
  const expert = ask(query);
  assert.equal(expert.route, 'expert_rule');
}
const genericAcne = ask('Mit ajánlasz pattanásos bőrre?');
assert.equal(genericAcne.route, 'clarification');
assert.equal(genericAcne.intent, 'acne');
noCards(genericAcne);

for (const query of ['Érzékeny vagyok erre a témára.', 'Száraz a humorom.', 'Ráncos lett a pólóm.', 'Öreg a telefonom.', 'Kezet mostam.', 'Sarkon fordultam.']) {
  const control = ask(query);
  assert.notEqual(control.routing.guidedDiscovery?.needState?.value, 'sensitive_skin');
  assert.notEqual(control.routing.guidedDiscovery?.needState?.value, 'dry_hands');
  assert.notEqual(control.routing.guidedDiscovery?.needState?.value, 'wrinkles_or_mature_skin');
  noCards(control);
}

run = turn([], 'Érzékeny a bőröm, mit ajánlasz?');
const reconstructed = structuredState(run.history);
assert.equal(reconstructed.guidedDiscovery.needState.value, 'sensitive_skin');
result = createAnswer({ question: 'Inkább krémet keresek.', history: run.history, conversationState: reconstructed, knowledge, ruleEngine, logGap() {} });
assert.equal(result.routing.guidedDiscovery.needState.value, 'sensitive_skin');
assert.equal(result.routing.guidedDiscovery.productType.value, 'krem');
noCards(result);

console.log('Guided discovery Phase 1: PASS');
