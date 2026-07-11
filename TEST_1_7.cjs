const assert = require('assert');
const path = require('path');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const engine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
const productHistory = [
  { role: 'user', content: 'Mit ajánlasz ekcémára?' },
  { role: 'assistant', content: 'Ekcémára a Dermavital krémet és a Dermavital szappant javaslom.' }
];

function ask(q, history = productHistory) { return engine.resolve(q, history); }

let r = ask('Szállítás mennyibe kerül?');
assert(r, 'Nincs válasz a szállítási díj kérdésre.');
assert.strictEqual(r.intent, 'shipping_cost');
assert(!/Dermavital|ekcéma/i.test(r.answer));
assert(/pénztárban/i.test(r.answer));

r = ask('Mennyibe kerül a szállítás?');
assert.strictEqual(r.intent, 'shipping_cost');
assert(!/Dermavital|ekcéma/i.test(r.answer));

r = ask('Mennyi a szállítási idő?');
assert.strictEqual(r.intent, 'shipping_time');
assert(/2 munkanap/i.test(r.answer));

r = ask('Szállítás érdekelne.');
assert.strictEqual(r.intent, 'shipping_general');
assert(r.suggestions.some((x) => /díj/i.test(x.label)));

r = ask('Lehet utánvéttel fizetni?');
assert.strictEqual(r.intent, 'cash_on_delivery');

r = ask('Milyen szappant használjak mellé?', productHistory);
assert.strictEqual(r.source, 'product-relation');
assert(/Dermavital szappant/i.test(r.answer));

console.log('TEST_1_7: 6/6 sikeres');
