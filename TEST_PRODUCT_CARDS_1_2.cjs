const path = require('path');
const fs = require('fs');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');
const restoreCatalogFixture = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restoreCatalogFixture);
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
  const authoritativeNames = cards.every(card => !approvedNames.has(card.id) || card.name === approvedNames.get(card.id));
  const ok = valid && authoritativeNames && expected.every(id => ids.includes(id));
  console.log(ok ? 'OK' : 'HIBA', q, '=>', JSON.stringify(cards));
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log('Termékkártya regressziós teszt: 3/3 sikeres.');
