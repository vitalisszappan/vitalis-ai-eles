const assert = require('assert');
const path = require('path');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const engine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));

function ask(question, history) {
  return engine.resolve(question, history || []);
}

const eczemaHistory = [
  { role: 'user', content: 'Mit ajánlasz ekcémára?' },
  { role: 'assistant', content: 'Ekcémára hajlamos, száraz és irritált bőr mindennapi ápolására elsőként a Dermavital krémet, mellé pedig a Dermavital szappant javaslom.' }
];

let result = ask('Milyen szappant használjak mellé?', eczemaHistory);
assert(result, 'Nincs válasz a kapcsolódó szappan kérdésre.');
assert.strictEqual(result.source, 'product-relation');
assert(result.answer.includes('Dermavital szappant'));
assert(result.links.some((x) => x.id === 'dermavital_szappan'));

result = ask('Mellé mit használjak?', eczemaHistory);
assert(result.answer.includes('Dermavital szappant'));

const soapHistory = [
  { role: 'assistant', content: 'A Dermavital szappant javaslom.' }
];
result = ask('Milyen krémet használjak mellé?', soapHistory);
assert(result.answer.includes('Dermavital krémet'));

const scalpHistory = [
  { role: 'assistant', content: 'Viszkető fejbőrre elsőként a Dermavital sampont javaslom.' }
];
result = ask('Mellé milyen szappant használjak?', scalpHistory);
assert(result.answer.includes('rozmaringos samponszappant'));

result = ask('Gyermeknek is használható?', eczemaHistory);
assert(result.answer.includes('Dermavital krém'));

console.log('TEST_1_6: 5/5 sikeres');
