'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');
const restore = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restore);
const knowledge = require('./data/knowledge.json');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');

const ruleEngine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
const ask = (question, history = []) => createAnswer({
  question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {}, logDiagnostic() {}
});

const FREE_ANSWER = '20 000 Ft feletti rendelésnél ingyenes a szállítás.';
const freeQuestions = [
  'ingyenes szállítás érdekelne',
  'Ingyenes szállítás érdekelne.',
  'ingyenes szallitas erdekelne',
  'ingyenes szállítás',
  'díjmentes szállítás érdekelne',
  'hogyan lehet ingyenes a szállítás?',
  'nem akarok szállítási költséget fizetni'
];

const contexts = {
  none: [],
  skin: [
    { role: 'user', content: 'Száraz a bőröm' },
    { role: 'assistant', content: 'A Dermavital krémet javaslom.', route: 'expert_rule', intent: 'dry_skin', links: [{ id: 'dermavital_krem', name: 'Dermavital krém' }] }
  ],
  product: [
    { role: 'user', content: 'Mire javaslod a Dermavital krémet?' },
    { role: 'assistant', content: 'Száraz bőrre.', route: 'exact_product', intent: 'product_detail', links: [{ id: 'dermavital_krem', name: 'Dermavital krém' }] }
  ],
  psoriasis: (() => {
    const first = ask('Hol találok pikkelysömörre megoldást?');
    return [{ role: 'user', content: 'Hol találok pikkelysömörre megoldást?' }, { role: 'assistant', content: first.answer, ...first }];
  })()
};

for (const [name, history] of Object.entries(contexts)) {
  for (const question of freeQuestions) {
    const label = `${name}: ${question}`;
    const result = ask(question, history);
    assert.equal(result.route, 'business_info', label);
    assert.equal(result.intent, 'shipping_free', label);
    assert.equal(result.answer, FREE_ANSWER, label);
    assert.deepEqual(result.links, [], label);
  }

  const generic = ask('szállítás érdekelne', history);
  assert.equal(generic.route, 'commerce', `${name}: generic`);
  assert.equal(generic.intent, 'shipping_general', `${name}: generic`);
  assert.notEqual(generic.answer, FREE_ANSWER, `${name}: generic`);
  assert.doesNotMatch(generic.answer, /ingyenes/i, `${name}: generic`);
}

restore();
console.log('TEST_SHIPPING_FREE_PRIORITY: PASS');
