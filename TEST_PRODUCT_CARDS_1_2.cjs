const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');
const restoreCatalogFixture = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restoreCatalogFixture);
const { PRODUCTS, productCards } = require('./engine/product-catalog.cjs');
const { createProductRegistry } = require('./engine/product-registry.cjs');
const { buildConversationContext, resolveProductReference } = require('./engine/conversation-context.cjs');
const { normalize } = require('./engine/normalizer.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const engine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
const mapping = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'canonical-unas-mapping.json'), 'utf8'));
const approvedNames = new Map((mapping.mappings || []).filter(item => item.mappingStatus === 'approved').map(item => [item.canonicalId, item.verifiedName]));
const tests = [
  ['Mit ajánlasz ekcémára?', ['dermavital_krem', 'dermavital_szappan']],
  ['Mit ajánlasz zsíros, pattanásos bőrre?', ['aktiv_szenes_szappan', 'katrany_szappan']],
  ['Korpás a fejbőröm.', ['dermavital_sampon']]
];
let failed = 0;
for (const [q, expected] of tests) {
  const result = engine.resolve(q, []);
  const cards = result?.links || [];
  const ids = cards.map(x => x.id);
  const valid = cards.every(x => x && typeof x.name === 'string' && x.name.trim() && !/undefined|null/i.test(x.name));
  // fda757f: an explicit safe display name takes precedence over commerce prose.
  const authoritativeNames = cards.every(card => !approvedNames.has(card.id) || card.name === (PRODUCTS[card.id]?.displayName || approvedNames.get(card.id)));
  const ok = valid && authoritativeNames && expected.every(id => ids.includes(id));
  console.log(ok ? 'OK' : 'HIBA', q, '=>', JSON.stringify(cards));
  if (!ok) failed++;
}
if (failed) process.exit(1);
const identity = mapping.mappings.find(item => item.canonicalId === 'katrany_szappan');
assert.equal(identity.mappingStatus, 'approved');
assert.equal(identity.unasId, '111374984');
assert.equal(identity.sku, 'VSZ002');
const registry = createProductRegistry();
const resolved = registry.resolve('katrany_szappan', PRODUCTS.katrany_szappan);
assert.equal(resolved.id, 'katrany_szappan');
assert.equal(resolved.commerceName, identity.verifiedName);
const card = productCards(['katrany_szappan'], { registry })[0];
assert.equal(card.id, 'katrany_szappan');
for (const field of ['name', 'title', 'label']) assert.equal(card[field], 'Kátrány szappan');
assert.deepEqual(card.commerce, { source: 'unas', mappingStatus: 'approved', unasId: '111374984', sku: 'VSZ002' });
const context = buildConversationContext([{ role: 'assistant', content: card.name, links: [card] }], normalize);
assert.equal(resolveProductReference('az elsőt', context).productId, 'katrany_szappan');
console.log('Termékkártya regressziós teszt: 3/3 sikeres.');
