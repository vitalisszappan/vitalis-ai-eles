'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');

const restore = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restore);
const { createAnswer } = require('./engine/answer-service.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { createCommerceAssistance } = require('./engine/commerce-assistance.cjs');
const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'knowledge.json'), 'utf8'));
const knowledge = Array.isArray(parsed) ? parsed : parsed.items || parsed.knowledge || [];
const ruleEngine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
const ask = (question, history = []) => createAnswer({ question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });
const assistant = (a) => ({ role: 'assistant', content: a.answer, route: a.route, intent: a.intent, domain: a.domain, targetProductId: a.targetProductId, links: a.links, routing: a.routing });
const append = (history, question, answer) => [...history, { role: 'user', content: question }, assistant(answer)];
const assertNoMutationClaim = (answer) => assert.doesNotMatch(answer, /kosárba tettem|megrendelted|leadtam a rendelést|félretettük/i);

let history = [];
const list = ask('Mutass két szappant.', history);
history = append(history, 'Mutass két szappant.', list);
assert(list.links.length >= 3);

for (const [question, expected] of [['Az elsőt kérem.', 'test-orange-soap'], ['Inkább a másodikat.', 'dermavital_szappan'], ['A harmadikat kérem.', 'natur_kecsketejes_szappan']]) {
  const result = ask(question, history);
  assert.equal(result.route, 'commerce', question);
  assert.equal(result.intent, 'order_start', question);
  assert.equal(result.targetProductId, expected, question);
  assert.deepEqual(result.links.map((item) => item.id), [expected], question);
  assert.match(result.links[0].url, /^https:\/\/www\.vitalis-szappan\.hu\//, question);
  assert.match(result.answer, new RegExp(result.links[0].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), question);
  assertNoMutationClaim(result.answer);
}

for (const question of ['Ezt kérem.', 'Megveszem.']) {
  const result = ask(question, history);
  assert.equal(result.route, 'clarification', question);
  assert.deepEqual(result.links, [], question);
}
let result = ask('Ezt szeretném megvenni.');
assert.equal(result.route, 'commerce'); assert.equal(result.intent, 'order_start'); assert.equal(result.targetProductId, null); assert.deepEqual(result.links, []);

for (const question of ['Hogyan tudom megrendelni?', 'Hogyan rendelhetek?', 'Hogyan rendeljek?', 'Hogyan vásárolhatok?']) {
  result = ask(question);
  assert.equal(result.route, 'commerce', question); assert.equal(result.intent, 'ordering_help', question);
  assert.match(result.answer, /termékkártyán/i, question); assert.deepEqual(result.links, [], question);
  const state = structuredState(append([], question, result));
  assert.equal(state.purchaseProductId, null, question); assert.equal(state.selectedProductId, null, question); assert.equal(state.focusedProductId, null, question);
}

let singleHistory = [{ role: 'user', content: 'A Dermavital krém érdekel.' }, { role: 'assistant', content: 'A Dermavital krém.', route: 'exact_product', intent: 'product_detail', targetProductId: 'dermavital_krem', links: [{ id: 'dermavital_krem', name: 'Dermavital krém' }] }];
result = ask('Hogyan rendelhetem meg?', singleHistory);
assert.equal(result.intent, 'ordering_help'); assert.equal(result.targetProductId, 'dermavital_krem'); assert.deepEqual(result.links.map((x) => x.id), ['dermavital_krem']);

for (const question of ['Nem enged tovább a pénztár.', 'Nem tudok fizetni.', 'Hibát ír ki a rendelésnél.', 'Nem enged kosárba tenni.']) {
  result = ask(question);
  assert.equal(result.route, 'commerce', question); assert.equal(result.intent, 'checkout_problem', question);
  assert.match(result.answer, /kosárnál.*adatok megadásánál.*fizetésnél/i, question);
  assert.match(result.answer, /hibaüzenet/i, question); assert.match(result.answer, /bankkártyaadatot.*jelszót/i, question);
  assert.doesNotMatch(result.answer, /biztosan|valószínűleg|böngésző|cookie|cache/i, question);
  assert.deepEqual(result.links, [], question);
}
result = ask('Mivel tudok fizetni?'); assert.equal(result.intent, 'payment');
result = ask('Van bankkártyás fizetés?'); assert.equal(result.intent, 'payment');

result = ask('Nem kaptam visszaigazolást.');
assert.equal(result.route, 'commerce'); assert.equal(result.intent, 'order_confirmation_problem');
assert.notEqual(result.intent, 'discount_question'); assert.match(result.answer, /ugyfelszolgalat@vitalis-szappan\.hu/i); assert.deepEqual(result.links, []);

for (const question of ['nem enged tovább az élet', 'megrendeltem a vacsorát', 'megveszem ezt az ötletet', 'kosármeccset nézek', 'fizetek érte egy kávét']) {
  result = ask(question);
  assert.notEqual(result.route, 'commerce', question); assert.equal(result.targetProductId == null, true, question); assert.deepEqual(result.links, [], question);
  const state = structuredState(append([], question, result)); assert.equal(state.purchaseProductId, null, question); assert.equal(state.selectedProductId, null, question);
}

const stub = (product) => ({ all: () => product ? [product] : [] });
for (const product of [
  { id: 'x', unasId: 'x', name: 'X', url: '', public: true, active: true, orderable: true },
  { id: 'x', unasId: 'x', name: 'X', url: 'javascript:alert(1)', public: true, active: true, orderable: true },
  { id: 'x', unasId: 'x', name: 'X', url: 'https://example.com/x', public: true, active: true, orderable: true },
  { id: 'x', unasId: 'x', name: 'X', url: 'https://www.vitalis-szappan.hu/x', public: false, active: true, orderable: true },
  { id: 'x', unasId: 'x', name: 'X', url: 'https://www.vitalis-szappan.hu/x', public: true, active: false, orderable: true },
  { id: 'x', unasId: 'x', name: 'X', url: 'https://www.vitalis-szappan.hu/x', public: true, active: true, orderable: false }
]) {
  const resolved = createCommerceAssistance({ catalog: stub(product) }).resolve({ routing: { route: 'commerce', intent: 'order_start', contextTarget: 'x' } });
  assert.deepEqual(resolved.links, []); assert.doesNotMatch(resolved.answer, /kosárba teheted/i);
}

restore();
console.log('Commerce Assistance Phase 1: PASS');
