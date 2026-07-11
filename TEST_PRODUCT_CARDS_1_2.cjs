const path = require('path');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const engine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
const tests = [
  ['Mit ajánlasz ekcémára?', ['Dermavital krém', 'Dermavital szappan']],
  ['Mit ajánlasz zsíros, pattanásos bőrre?', ['Aktív szenes szappan', 'Gyógyászati kátrány szappan']],
  ['Korpás a fejbőröm.', ['Dermavital sampon']]
];
let failed = 0;
for (const [q, expected] of tests) {
  const result = engine.resolve(q, []);
  const cards = result?.links || [];
  const names = cards.map(x => x.name);
  const valid = cards.every(x => x && typeof x.name === 'string' && x.name.trim() && !/undefined|null/i.test(x.name));
  const ok = valid && expected.every(name => names.includes(name));
  console.log(ok ? 'OK' : 'HIBA', q, '=>', JSON.stringify(cards));
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log('Termékkártya regressziós teszt: 3/3 sikeres.');
