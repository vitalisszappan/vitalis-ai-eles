'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');
const restore = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restore);

const knowledge = require('./data/knowledge.json');
const { createAnswer } = require('./engine/answer-service.cjs');
const { createCatalogSearch } = require('./engine/catalog-search.cjs');
const { PRODUCTS, productCards } = require('./engine/product-catalog.cjs');
const { createProductRegistry } = require('./engine/product-registry.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { validateStructuredOutput } = require('./engine/structured-output-safety.cjs');

const FORBIDDEN = /gyógyászati\s+kátrány/i;
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
const add = (history, question, result) => [...history,
  { role: 'user', content: question },
  { role: 'assistant', content: result.answer, ...result }
];
const assertSafe = (result, label) => {
  assert.doesNotMatch(result.answer || '', FORBIDDEN, `${label}: answer`);
  for (const link of result.links || []) {
    for (const field of ['name', 'title', 'label', 'description', 'reason']) {
      assert.doesNotMatch(link[field] || '', FORBIDDEN, `${label}: links.${field}`);
    }
  }
};

assert.equal(PRODUCTS.katrany_szappan.displayName, 'Kátrány szappan');

let result = ask('Pattanásos a bőröm. Melyik szappant ajánlod?');
assert.equal(result.route, 'clarification');
assert.equal(result.links.length, 0);

result = ask('Mit ajánlasz mitesszeres, kombinált bőrre?');
assert.equal(result.targetProductId, 'aktiv_szenes_szappan');
assert.deepEqual(result.links.map((item) => item.id), ['aktiv_szenes_szappan']);

result = ask('Nagyon zsíros a bőröm és rendszeresen pattanásos. Melyiket ajánlod?');
assert.equal(result.targetProductId, 'katrany_szappan');
assert.equal(result.groundingStatus, 'grounded');
assert.equal(result.factsUsed[0].provenance[0].sourceType, 'owner_approved');
assert.equal(result.links.length, 1);
assert.equal(result.links[0].name, 'Kátrány szappan');
assert.equal(result.links[0].title, 'Kátrány szappan');
assert.equal(result.links[0].label, 'Kátrány szappan');
assertSafe(result, 'Contract C');

for (const [label, question] of [
  ['exact product', 'Mit tudsz a Kátrány szappanról?'],
  ['scalp', 'Pattanások vannak a fejbőrömön.'],
  ['comparison', 'Kátrány szappan vs Aktív szenes szappan']
]) {
  result = ask(question);
  assertSafe(result, label);
  assert(result.links.some((item) => item.id === 'katrany_szappan'), label);
}

let history = [];
let selected = ask('Nagyon zsíros a bőröm és rendszeresen pattanásos.');
history = add(history, 'Nagyon zsíros a bőröm és rendszeresen pattanásos.', selected);
for (const [label, question] of [['price', 'Mennyibe kerül?'], ['purchase', 'Ezt szeretném megvenni.']]) {
  result = ask(question, history);
  assertSafe(result, label);
  assert(result.links.some((item) => item.id === 'katrany_szappan'), label);
  history = add(history, question, result);
}

const catalog = createCatalogSearch();
const exactCatalogProduct = catalog.findExactProduct('Gyógyászati Kátrány Szappan - Ichtiol Hatóanyaggal');
assert(exactCatalogProduct);
assert.equal(exactCatalogProduct.canonicalProductId, 'katrany_szappan');
assert.equal(exactCatalogProduct.name, 'Kátrány szappan');
assert.equal(exactCatalogProduct.commerceName, 'Gyógyászati Kátrány Szappan - Ichtiol Hatóanyaggal a Zsíros és Problémás Bőrért 100 g');
assert(catalog.searchCategory('soap', 50).products.some((item) => item.canonicalProductId === 'katrany_szappan' && item.name === 'Kátrány szappan'));

history = [{ role: 'assistant', content: 'Ezt ajánlom.', links: [productCards(['katrany_szappan'])[0]], targetProductId: 'katrany_szappan', routing: { targetProductId: 'katrany_szappan', matchedProductIds: ['katrany_szappan'] } }];
result = ask('az elsőt', history);
assertSafe(result, 'ordinal');
assert(result.links.some((item) => item.id === 'katrany_szappan'));

const commerceRegistry = createProductRegistry({
  mappingData: { mappings: [{ canonicalId: 'katrany_szappan', unasId: '111374984', sku: 'VSZ002', mappingStatus: 'approved' }] },
  snapshotData: { products: [{
    unasId: '111374984', sku: 'VSZ002',
    name: 'Gyógyászati Kátrány Szappan - Ichtiol Hatóanyaggal a Zsíros és Problémás Bőrért 100 g',
    url: 'https://www.vitalis-szappan.hu/termek/gyogyaszati-katrany-szappan-ichtyol',
    image: { url: 'https://www.vitalis-szappan.hu/img/99212/VSZ002/VSZ002.jpg' },
    actualPriceGross: 1490, priceGross: 1490, currency: 'HUF',
    public: true, orderable: true, active: true, status: { state: 'live' }
  }] }
});
const resolved = commerceRegistry.resolve('katrany_szappan', PRODUCTS.katrany_szappan);
const commerceCard = productCards(['katrany_szappan'], { registry: commerceRegistry })[0];
assert.equal(resolved.commerceName, 'Gyógyászati Kátrány Szappan - Ichtiol Hatóanyaggal a Zsíros és Problémás Bőrért 100 g');
assert.equal(commerceCard.id, 'katrany_szappan');
assert.equal(commerceCard.name, 'Kátrány szappan');
assert.equal(commerceCard.commerce.unasId, '111374984');
assert.equal(commerceCard.commerce.sku, 'VSZ002');
assert.equal(commerceCard.url, 'https://www.vitalis-szappan.hu/termek/gyogyaszati-katrany-szappan-ichtyol');
assert.equal(commerceCard.price, 1490);
assert.equal(commerceCard.image, 'https://www.vitalis-szappan.hu/img/99212/VSZ002/VSZ002.jpg');
assert.deepEqual(commerceCard.availability, { public: true, orderable: true, active: true, state: 'live' });

const sanitized = validateStructuredOutput({
  answer: 'A Gyógyászati Kátrány terméket ajánlom.',
  links: [{ id: 'katrany_szappan', name: 'Gyógyászati Kátrány', title: 'Gyógyászati Kátrány', label: 'Gyógyászati Kátrány', description: 'Gyógyászati Kátrány leírás', reason: 'Gyógyászati Kátrány ok', url: 'https://example.test', price: 1490 }]
});
assertSafe(sanitized, 'structured output validator');
assert.equal(sanitized.links[0].name, 'Kátrány szappan');
assert.equal(sanitized.links[0].url, 'https://example.test');
assert.equal(sanitized.links[0].price, 1490);

result = ask('Dermavital sampon vs rozmaringos samponszappan');
assert.equal(result.route, 'product_comparison');
assert.equal(result.intent, 'compare_products');
assert.deepEqual(result.links.map((item) => item.id), ['dermavital_sampon', 'rozmaringos_samponszappan']);
assert.equal(result.links.length, 2);

console.log('Safe Product Display Name Phase 1: PASS');
