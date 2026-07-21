'use strict';

const assert = require('assert');
const path = require('path');
const knowledge = require('./data/knowledge.json');
const { PRODUCTS, productCards, validProductUrl } = require('./engine/product-catalog.cjs');
const { createProductRegistry } = require('./engine/product-registry.cjs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

function mapping(canonicalId, unasId, sku, mappingStatus = 'approved') {
  return { canonicalId, unasId, sku, verifiedName: `Verified ${canonicalId}`, mappingStatus };
}

function snapshotProduct(overrides = {}) {
  return {
    unasId: '1001',
    sku: 'SKU-1001',
    name: 'UNAS hivatalos terméknév',
    url: 'https://www.vitalis-szappan.hu/unas-termek',
    image: { url: 'https://cdn.example.invalid/product.jpg' },
    priceGross: 3990,
    actualPriceGross: 3490,
    currency: 'HUF',
    public: true,
    orderable: true,
    active: null,
    status: { state: 'live' },
    ...overrides
  };
}

function registry(mappingItems, products) {
  return createProductRegistry({
    mappingData: { mappings: mappingItems },
    snapshotData: { products }
  });
}

const approvedRegistry = registry(
  [mapping('dermavital_sampon', '1001', 'SKU-1001')],
  [snapshotProduct()]
);
const approvedCard = productCards(['dermavital_sampon'], { registry: approvedRegistry })[0];
assert.equal(approvedCard.url, 'https://www.vitalis-szappan.hu/unas-termek');
assert.equal(approvedCard.image, 'https://cdn.example.invalid/product.jpg');
assert.equal(approvedCard.price, 3490);
assert.equal(approvedCard.priceGross, 3990);
assert.equal(approvedCard.actualPriceGross, 3490);
assert.equal(approvedCard.currency, 'HUF');
assert.deepEqual(approvedCard.availability, { public: true, orderable: true, state: 'live' });
assert.equal(approvedCard.description, PRODUCTS.dermavital_sampon.description);

const missingCommerceFields = registry(
  [mapping('dermavital_krem', '1001', 'SKU-1001')],
  [snapshotProduct({ url: null, image: null, priceGross: null, actualPriceGross: null })]
);
const localUrlCard = productCards(['dermavital_krem'], { registry: missingCommerceFields })[0];
assert.equal(localUrlCard.url, PRODUCTS.dermavital_krem.url);
assert.equal(localUrlCard.image, '');
assert.equal(Object.hasOwn(localUrlCard, 'price'), false);

const noSnapshotRegistry = createProductRegistry({
  mappingData: { mappings: [mapping('dermavital_sampon', '1001', 'SKU-1001')] },
  snapshotData: null
});
const allIds = Object.keys(PRODUCTS);
const fallbackCards = productCards(allIds, { registry: noSnapshotRegistry });
assert.deepEqual(
  fallbackCards,
  allIds.map((id, index) => ({
    id,
    name: PRODUCTS[id].name,
    title: PRODUCTS[id].name,
    label: PRODUCTS[id].name,
    description: PRODUCTS[id].description,
    url: validProductUrl(PRODUCTS[id].url),
    image: '',
    rank: index + 1,
    recommendationType: index === 0 ? 'primary' : 'secondary'
  }))
);

const missingSnapshotFileRegistry = createProductRegistry({
  mappingPath: path.join(__dirname, 'data', 'canonical-unas-mapping.json'),
  snapshotPath: path.join(__dirname, 'data', 'definitely-missing-unas-snapshot.json')
});
assert.deepEqual(
  productCards(allIds, { registry: missingSnapshotFileRegistry }),
  fallbackCards
);

const needsReviewRegistry = registry(
  [mapping('aktiv_szenes_szappan', undefined, undefined, 'needs_review')],
  [snapshotProduct({
    unasId: '2001',
    sku: 'SHAMPOO-CHARCOAL',
    name: 'Samponszappan – Teafa & Aktív szén 110 g',
    url: 'https://www.vitalis-szappan.hu/samponszappan'
  })]
);
const charcoalCard = productCards(['aktiv_szenes_szappan'], { registry: needsReviewRegistry })[0];
assert.equal(charcoalCard.name, PRODUCTS.aktiv_szenes_szappan.name);
assert.equal(charcoalCard.url, '');
assert.equal(Object.hasOwn(charcoalCard, 'commerce'), false);

const missingRecordRegistry = registry(
  [mapping('dermavital_sampon', '404', 'MISSING')],
  [snapshotProduct()]
);
assert.equal(
  productCards(['dermavital_sampon'], { registry: missingRecordRegistry })[0].url,
  ''
);

const wrongSkuRegistry = registry(
  [mapping('dermavital_sampon', '1001', 'WRONG-SKU')],
  [snapshotProduct()]
);
assert.equal(
  productCards(['dermavital_sampon'], { registry: wrongSkuRegistry })[0].name,
  PRODUCTS.dermavital_sampon.name
);

const notApprovedRegistry = registry(
  [mapping('dermavital_sampon', '1001', 'SKU-1001', 'needs_review')],
  [snapshotProduct()]
);
assert.equal(
  productCards(['dermavital_sampon'], { registry: notApprovedRegistry })[0].url,
  ''
);

const invalidUrlRegistry = registry(
  [mapping('dermavital_krem', '1001', 'SKU-1001')],
  [snapshotProduct({ url: 'javascript:alert(1)', image: { url: 'javascript:alert(2)' } })]
);
const invalidUrlCard = productCards(['dermavital_krem'], { registry: invalidUrlRegistry })[0];
assert.equal(invalidUrlCard.url, PRODUCTS.dermavital_krem.url);
assert.equal(invalidUrlCard.image, '');
assert.equal(validProductUrl('javascript:alert(1)'), '');

const sefImageRegistry = registry(
  [mapping('dermavital_sampon', '1001', 'SKU-1001')],
  [snapshotProduct({ image: { url: null, sefUrl: 'https://cdn.example.invalid/sef-image.jpg' } })]
);
assert.equal(
  productCards(['dermavital_sampon'], { registry: sefImageRegistry })[0].image,
  'https://cdn.example.invalid/sef-image.jpg'
);

const ruleEngine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
function ask(question, history = []) {
  return createAnswer({ question, history, knowledge, ruleEngine, logGap: () => {} });
}
function ids(result) {
  return (result.links || []).map((card) => card.id);
}

const recommendationBaselines = [
  ['Mit ajánlasz pikkelysömörre?', ['psorivital_csomag', 'holt_tengeri_so_balzsam']],
  ['Mit ajánlasz ekcémára?', ['dermavital_krem', 'dermavital_szappan']],
  ['Mit ajánlasz aknéra?', ['aktiv_szenes_szappan', 'katrany_szappan']],
  ['Mit ajánlasz száraz bőrre?', ['shea_vajas_szappan']],
  ['Mit ajánlasz pikkelysömörös fejbőrre?', ['dermavital_sampon', 'rozmaringos_samponszappan']],
  ['Mit ajánlasz hajhullásra?', ['rozmaringos_samponszappan']]
];
for (const [question, expectedIds] of recommendationBaselines) {
  assert.deepEqual(ids(ask(question)), expectedIds, question);
}

const history = [
  { role: 'user', content: 'Mit ajánlasz pikkelysömörre?' },
  { role: 'assistant', content: ask('Mit ajánlasz pikkelysömörre?').answer }
];
assert.deepEqual(ids(ask('az elsőt', history)), ['psorivital_csomag']);

console.log('TEST_PRODUCT_REGISTRY: minden ellenőrzés sikeres');
