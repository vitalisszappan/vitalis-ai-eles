const path = require('path');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const engine = new ExpertRuleEngine(path.join(__dirname,'data','rules','expert-rules.json'));
const cases = [
  ['Mit ajánlasz zsíros, pattanásos bőrre?','Aktív szenes szappan'],
  ['Korpás a fejbőröm.','Dermavital sampon'],
  ['Pikkelysömörös a fejbőröm.','Dermavital sampon'],
  ['Mit ajánlasz ekcémára?','Dermavital krém'],
  ['Mit ajánlasz száraz bőrre?','Shea vajas szappan']
];
let failed = 0;
for (const [q, expected] of cases) {
  const result = engine.resolve(q, []);
  const names = (result?.links || []).map((x) => x.name);
  const noUndefined = names.every((x) => typeof x === 'string' && x.trim() && x !== 'undefined');
  const ok = result && names.includes(expected) && noUndefined;
  console.log(ok ? 'OK  ' : 'HIBA', q, '=>', names.join(', '));
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log(`Minden termékkártya-adat teszt sikeres (${cases.length}/${cases.length}).`);
