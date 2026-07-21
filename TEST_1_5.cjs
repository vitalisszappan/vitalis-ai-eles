const assert = require('assert');
const path = require('path');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const engine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));

function answer(question, history=[]) {
  return engine.resolve(question, history);
}

let r = answer('Gyermeknek is használható?', [
  {role:'user', content:'Mit ajánlasz ekcémára?'},
  {role:'assistant', content:'Erre elsőként a Dermavital krémet javaslom, mellé pedig a Dermavital szappant.'}
]);
assert(r && r.links[0]?.id === 'dermavital_krem');
assert(/gyermekek/.test(r.answer));

r = answer('Gyereknek is jó?', [
  {role:'assistant', content:'Problémás fejbőrre elsőként a Dermavital sampont javaslom.'}
]);
assert(r && r.links[0]?.id === 'dermavital_sampon');
assert(/gyermekeknél/.test(r.answer));

r = answer('Gyermeknek is használható?', []);
assert(r && /Melyik termékre/.test(r.answer));
assert(Array.isArray(r.suggestions) && r.suggestions.length === 3);

r = answer('Hogyan használjam?', [
  {role:'assistant', content:'Elsőként az Aktív szenes szappant ajánlom.'}
]);
assert(r && /Aktív szenes szappant/.test(r.answer));

console.log('TEST_1_5: 4/4 sikeres');
