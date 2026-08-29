'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');
const ask = (question, history = []) => createAnswer({
  question,
  history,
  conversationState: structuredState(history),
  knowledge,
  ruleEngine,
  logGap() {},
  logDiagnostic() {}
});

const rosemary = ask('Mi a különbség a Dermavital sampon és a rozmaringos samponszappan között?');
assert.equal(rosemary.route, 'product_comparison');
assert.equal(rosemary.intent, 'compare_products');
assert.deepEqual(rosemary.routing.matchedProductIds, ['dermavital_sampon', 'rozmaringos_samponszappan']);
assert.equal(rosemary.groundingStatus, 'unavailable');
assert.equal(rosemary.links.length, 2);
assert.deepEqual(rosemary.links.map((item) => item.id), ['dermavital_sampon', 'rozmaringos_samponszappan']);
assert.equal(rosemary.answer, 'Erről a két termékről jelenleg nincs elég biztos információm ahhoz, hogy megbízhatóan összehasonlítsam őket.');
assert.doesNotMatch(rosemary.answer, /nincs elérhető bizonyított cél- vagy előnyleírás|bizonyított cél- vagy előnyleírás|cél- és előnyleírás|grounding|evidence|fact unavailable/i);
assert.doesNotMatch(rosemary.answer, /\.\./);

const acnePair = ask('Kátrány szappan vs Aktív szenes szappan');
assert.equal(acnePair.route, 'product_comparison');
assert.equal(acnePair.intent, 'compare_products');
assert.equal(acnePair.groundingStatus, 'grounded');
assert.deepEqual(acnePair.links.map((item) => item.id), ['katrany_szappan', 'aktiv_szenes_szappan']);
assert.deepEqual(acnePair.links.map((item) => item.name), ['Kátrány szappan', 'Aktív szenes szappan']);
assert.match(acnePair.answer, /Kátrány szappan/i);
assert.match(acnePair.answer, /Aktív szenes szappan/i);
assert.doesNotMatch(acnePair.answer, /gyógyászati kátrány/i);

const sparse = ask('Mi a különbség a Dermavital sampon és a Holt-tengeri só balzsam között?');
assert.equal(sparse.answerIntent, 'comparison');
assert.equal(sparse.answer, 'Erről a két termékről jelenleg nincs elég biztos információm ahhoz, hogy megbízhatóan összehasonlítsam őket.');
assert.doesNotMatch(sparse.answer, /nincs elérhető bizonyított cél- vagy előnyleírás|bizonyított cél- vagy előnyleírás|cél- és előnyleírás|\.\./i);

const partial = ask('Mi a különbség a Dermavital sampon és a rozmaringos samponszappan összetevői között?');
assert.equal(partial.answerIntent, 'comparison');
assert.equal(partial.answer, 'Erről a két termékről jelenleg nincs elég biztos információm ahhoz, hogy megbízhatóan összehasonlítsam őket.');
assert.doesNotMatch(partial.answer, /bizonyított összetevőlistája|cél- és előnyleírás|grounding|evidence/i);

const partialBenefits = ask('Mi a különbség a Dermavital sampon és az Aktív szenes szappan között?');
assert.equal(partialBenefits.groundingStatus, 'partial');
assert.equal(partialBenefits.answer, 'Aktív szenes szappan: Az Aktív szenes szappant kombinált, enyhén zsíros és mitesszeres bőrre ajánljuk. Dermavital sampon esetében jelenleg nincs elég biztos információm ahhoz, hogy a két terméket megbízhatóan összehasonlítsam.');
assert.doesNotMatch(partialBenefits.answer, /grounding|evidence|fact|teljes körűen összehasonlítani/i);

for (const question of ['vs', 'vscode', 'vst']) {
  const result = ask(question);
  assert.notEqual(result.route, 'product_comparison');
  assert.doesNotMatch(result.answer, /Dermavital|Rozmaringos|Kátrány|Aktív szenes/i);
}

console.log('Product Comparison Quality Phase 1: PASS');
