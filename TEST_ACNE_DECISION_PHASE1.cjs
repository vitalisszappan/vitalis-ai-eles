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
const productFacts = require('./engine/product-facts.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');
const ask = (question, history = []) => createAnswer({ question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });
const add = (history, question, result) => [...history, { role: 'user', content: question }, { role: 'assistant', content: result.answer, ...result }];
const ids = (result) => result.links.map((item) => item.id);
const noMedicalClaims = (result) => assert.doesNotMatch(result.answer, /gyógyít|kezel(?:i|es)|eltüntet|antibakteri|gyulladáscsökkent|detox|pórustiszt|faggyúszabály|sebgyógy/i);

let result = ask('Mit ajánlasz pattanásos bőrre?');
assert.equal(result.route, 'clarification');
assert.equal(result.intent, 'acne');
assert.equal(result.routing.primaryProductId, null);
assert.deepEqual(result.links, []);
assert.match(result.answer, /zsíros/i);
assert.match(result.answer, /néha vagy rendszeresen/i);
assert.match(result.answer, /fejbőr/i);
assert.equal(result.ctaStrategy, 'clarify_need');

result = ask('Mit ajánlasz mitesszeres, kombinált bőrre?');
assert.equal(result.targetProductId, 'aktiv_szenes_szappan');
assert.deepEqual(ids(result), ['aktiv_szenes_szappan']);
assert.equal(result.links[0].url, '');
assert.equal(result.links[0].price, undefined);
assert.equal(result.groundingStatus, 'grounded');
assert.equal(result.factsUsed[0].provenance[0].sourceType, 'owner_approved');
assert.match(result.answer, /kombinált.*mitesszeres/i);
noMedicalClaims(result);

result = ask('Enyhén zsíros a bőröm, és csak néha jön ki egy-két pattanás.');
assert.equal(result.targetProductId, 'aktiv_szenes_szappan');
assert.deepEqual(ids(result), ['aktiv_szenes_szappan']);

result = ask('Nagyon zsíros a bőröm és rendszeresen pattanásos.');
assert.equal(result.targetProductId, 'katrany_szappan');
assert.deepEqual(ids(result), ['katrany_szappan']);
assert.equal(result.groundingStatus, 'grounded');
noMedicalClaims(result);

result = ask('Pattanások vannak a fejbőrömön.');
assert.equal(result.targetProductId, 'katrany_szappan');
assert.deepEqual(ids(result), ['katrany_szappan']);
assert.match(result.answer, /hajmosásra is használható/i);

result = ask('Kátrány szappannal lehet hajat mosni?');
assert.equal(result.targetProductId, 'katrany_szappan');
assert.match(result.answer, /^Igen|hajmosásra is használható/i);
assert.equal(result.factsUsed[0].provenance[0].sourceType, 'owner_approved');

let history = [];
result = ask('Mit ajánlasz pattanásos bőrre?'); history = add(history, 'Mit ajánlasz pattanásos bőrre?', result);
result = ask('Inkább kombinált, mitesszeres, és csak néha jön ki egy-két pattanás.', history);
assert.equal(result.targetProductId, 'aktiv_szenes_szappan'); assert.deepEqual(ids(result), ['aktiv_szenes_szappan']);

history = add([], 'Mit ajánlasz pattanásos bőrre?', ask('Mit ajánlasz pattanásos bőrre?'));
result = ask('Nagyon zsíros, és gyakran kijönnek.', history);
assert.equal(result.targetProductId, 'katrany_szappan');
history = add([], 'Mit ajánlasz pattanásos bőrre?', ask('Mit ajánlasz pattanásos bőrre?'));
result = ask('A fejbőrömön is.', history);
assert.equal(result.targetProductId, 'katrany_szappan');

history = add([], 'Mit ajánlasz mitesszeres, kombinált bőrre?', ask('Mit ajánlasz mitesszeres, kombinált bőrre?'));
result = ask('Viszont nagyon zsíros és gyakran pattanásos.', history);
assert.equal(result.targetProductId, 'katrany_szappan');
history = add([], 'Nagyon zsíros a bőröm és rendszeresen pattanásos.', ask('Nagyon zsíros a bőröm és rendszeresen pattanásos.'));
result = ask('Nekem inkább kombinált, mitesszeres és csak néha pattanásos.', history);
assert.equal(result.targetProductId, 'aktiv_szenes_szappan');

result = ask('Csíp a Kátrány szappan.'); assert.equal(result.route, 'complaint'); assert.deepEqual(result.links, []);
result = ask('Bedagadt az arcom és nehezen kapok levegőt.'); assert.equal(result.route, 'safety'); assert.deepEqual(result.links, []);

for (const query of ['pattanásig feszült a helyzet', 'kátrányos az út', 'aktív vagyok', 'szenes lett a grill', 'zsíros lett a serpenyő', 'ráncos lett a pólóm', 'száraz a humorom', 'érzékeny vagyok erre a témára']) {
  result = ask(query); assert.notEqual(result.intent, 'acne'); assert.notEqual(result.route, 'problem_domain'); assert.notEqual(result.domain, 'acne'); assert.deepEqual(result.links, []);
}
result = ask('pattanásig feszült a helyzet');
assert.doesNotMatch(result.answer, /pattanás|akné|bőr/i);
let cleanHistory = add([], 'pattanásig feszült a helyzet', result);
let cleanState = structuredState(cleanHistory);
assert.equal(cleanState.acneDecision, null);
assert.equal(cleanState.activeProblemDomains.includes('acne'), false);
assert.equal(cleanState.focusedProductId, null);
assert.deepEqual(cleanState.lastRecommendedProducts, []);
assert.equal(cleanState.purchaseProductId, null);
result = ask('Mit ajánlasz érzékeny bőrre?', cleanHistory);
assert.equal(result.routing.guidedDiscovery.needState.value, 'sensitive_skin');
assert.notEqual(result.intent, 'acne');
assert.deepEqual(result.links, []);

for (const query of ['Mit ajánlasz pattanásos bőrre?', 'Pattanásos a bőröm.', 'Gyakran vannak pattanásaim.', 'Pattanások vannak az arcomon.', 'Pattanások vannak a hátamon.', 'Pattanások vannak a vállamon.']) {
  result = ask(query); assert.equal(result.intent, 'acne'); assert.ok(result.routing.acneDecision);
}
result = ask('Pattanások vannak a fejbőrömön.'); assert.equal(result.targetProductId, 'katrany_szappan');
result = ask('Mitesszeres, kombinált a bőröm.'); assert.equal(result.targetProductId, 'aktiv_szenes_szappan');
result = ask('Nagyon zsíros és rendszeresen pattanásos.'); assert.equal(result.targetProductId, 'katrany_szappan');
result = ask('mitesszer'); assert.deepEqual(result.links, []); assert.equal(result.route, 'clarification');
result = ask('Néha enyhe, máskor rendszeresen erős pattanásaim vannak, a bőröm kombinált és nagyon zsíros is.');
assert.equal(result.route, 'clarification'); assert.equal(result.routing.acneDecision.reasonCode, 'contradictory_evidence'); assert.deepEqual(result.links, []);

const reconstructed = structuredState(add([], 'Mit ajánlasz pattanásos bőrre?', ask('Mit ajánlasz pattanásos bőrre?')));
assert.equal(reconstructed.acneDecision.active, true);
result = createAnswer({ question: 'Nagyon zsíros, és gyakran kijönnek.', history: [], conversationState: reconstructed, knowledge, ruleEngine, logGap() {} });
assert.equal(result.targetProductId, 'katrany_szappan');

for (const query of ['Viszket és hámlik a fejbőröm.', 'Korpás a fejbőröm.']) {
  result = ask(query); assert.equal(result.routing.primaryProductId, 'dermavital_sampon'); assert.equal(ids(result)[0], 'dermavital_sampon');
}

assert.equal(productFacts.getFact('aktiv_szenes_szappan', 'productBenefits').status, 'grounded');
assert.deepEqual(productFacts.getProductFacts('aktiv_szenes_szappan').identityProvenance, []);
assert.equal(productFacts.getFact('aktiv_szenes_szappan', 'price').status, 'unavailable');
assert.equal(productFacts.getFact('aktiv_szenes_szappan', 'url').status, 'unavailable');

console.log('Acne Decision Phase 1: PASS');
