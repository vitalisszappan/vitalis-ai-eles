'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { createCatalogSearch } = require('./engine/catalog-search.cjs');
const { createProductFactsResolver } = require('./engine/product-facts.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');

const knowledge = JSON.parse(fs.readFileSync('./data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('./data/rules/expert-rules.json');
const ask = (question) => createAnswer({ question, history: [], conversationState: structuredState([]),
  knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });
const catalog = createCatalogSearch();
const resolver = createProductFactsResolver();
const soaps = catalog.searchCategory('soap', 100).products;
const mappedSoaps = soaps.filter((item) => item.canonicalProductId);

assert.equal(soaps.length, 23);
assert.equal(mappedSoaps.length, 22);
for (const item of mappedSoaps) {
  const fact = resolver.getFact(item.canonicalProductId, 'scentProfile');
  assert.equal(fact.status, 'grounded', item.canonicalProductId);
  assert.deepEqual(fact.value, item.scentProfile, item.canonicalProductId);
  assert.equal(fact.provenance[0].sourceType, 'unas_snapshot', item.canonicalProductId);
}

const byId = new Map(soaps.map((item) => [item.canonicalProductId || `unas:${item.unasId}`, item]));
const expectedProfiles = {
  natur_kecsketejes_szappan: { fragranceFree: true, scent: null },
  dermavital_szappan: { fragranceFree: true, scent: null },
  oliva_szappan: { fragranceFree: true, scent: null },
  kecsketejes_levendulas_szappan: { fragranceFree: false, scent: 'lavender' },
  citromfuves_szappan: { fragranceFree: false, scent: 'citrus' },
  'unas:1609257181': { fragranceFree: false, scent: 'lavender' },
  mentas_kave_szappan: { fragranceFree: false, scent: 'mint' }
};
for (const [id, expected] of Object.entries(expectedProfiles)) {
  const profile = byId.get(id)?.scentProfile;
  assert.ok(profile, id);
  assert.equal(profile.fragranceFree, expected.fragranceFree, id);
  if (expected.scent) assert.ok(profile.scents.includes(expected.scent), id);
}
assert.equal(byId.get('hevizi_gyogyiszapos_termal_szappan').scentProfile.fragranceFree, null);

const authoritativeUnscented = soaps.filter((item) => item.scentProfile.fragranceFree === true);
assert.deepEqual(authoritativeUnscented.map((item) => item.canonicalProductId).sort(),
  ['dermavital_szappan', 'natur_kecsketejes_szappan', 'oliva_szappan']);
const unscented = ask('illatmentes szappan');
assert.equal(unscented.routing.productQuestionIntent, 'filtered_catalog');
assert.deepEqual(unscented.links.map((item) => item.id).sort(), authoritativeUnscented.map((item) => item.id).sort());
assert.doesNotMatch(unscented.answer, /ajánlom/i);

for (const [query, scent] of [['levendulás szappan', 'lavender'], ['citrusos szappan', 'citrus'], ['mentás szappan', 'mint']]) {
  const result = ask(query);
  const supported = soaps.filter((item) => item.scentProfile.scents.includes(scent));
  assert.equal(result.routing.productQuestionIntent, 'filtered_catalog', query);
  assert.ok(result.links.length, query);
  assert.ok(result.links.every((link) => supported.some((item) => item.id === link.id)), query);
  if (supported.length <= 3) assert.deepEqual(result.links.map((item) => item.id).sort(), supported.map((item) => item.id).sort(), query);
  else assert.match(result.answer, new RegExp(`\\b${supported.length} terméket találtam\\b`), query);
}

const recommendation = ask('melyik illatmentes szappant ajánlod érzékeny bőrre?');
assert.equal(recommendation.routing.productQuestionIntent, 'recommendation');
assert.equal(recommendation.intent, 'product_recommendation');
assert.match(recommendation.answer, /ajánlom/i);
assert.ok(recommendation.links.length);
assert.ok(recommendation.links.every((link) => authoritativeUnscented.some((item) => item.id === link.id)));

const freshUnscented = ask('illatmentes');
assert.equal(freshUnscented.routing.guidedDiscovery?.productType?.value ?? null, null);
const essentialOil = ask('illóolaj');
assert.equal(essentialOil.source, 'catalog-absent');
assert.deepEqual(essentialOil.links, []);
const unsupported = ask('levendulás sampon');
assert.deepEqual(unsupported.links, []);
assert.match(unsupported.answer, /nem találok/i);

console.log('SOAP_SCENT_ATTRIBUTE_COVERAGE_OK');
