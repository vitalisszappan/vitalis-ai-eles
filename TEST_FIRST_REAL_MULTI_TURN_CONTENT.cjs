'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { resolveProductReference } = require('./engine/conversation-context.cjs');
const { RELATIONS } = require('./engine/product-relations.cjs');
const { createProductFactsResolver } = require('./engine/product-facts.cjs');

const snapshot = JSON.parse(fs.readFileSync('data/unas-catalog-snapshot.json', 'utf8'));
const mappingData = JSON.parse(fs.readFileSync('data/canonical-unas-mapping.json', 'utf8'));
const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');
const history = [];
const ask = (question) => createAnswer({
  question, history, conversationState: structuredState(history), knowledge, ruleEngine,
  logGap() {}, logDiagnostic() {}
});
const remember = (question, answer) => history.push(
  { role: 'user', content: question },
  { role: 'assistant', content: answer.answer, route: answer.route, intent: answer.intent,
    domain: answer.domain, responseType: answer.responseSource, links: answer.links,
    targetProductId: answer.targetProductId || null, routing: answer.routing }
);

const soapQuestion = 'Hogyan használjam a Dermavital szappant?';
const soap = ask(soapQuestion);
assert.equal(soap.targetProductId, 'dermavital_szappan');
assert.equal(soap.answerIntent, 'usage');
assert.equal(soap.groundingStatus, 'grounded');
assert.equal(soap.factsUsed[0].provenance[0].sourceType, 'unas_snapshot');
assert.equal(soap.factsUsed[0].provenance[0].productId, 'dermavital_szappan');
remember(soapQuestion, soap);

const creamQuestion = 'És a krémet?';
const cream = ask(creamQuestion);
assert.equal(cream.route, 'context_followup');
assert.equal(cream.routing.referenceType, 'companion');
assert.equal(cream.targetProductId, 'dermavital_krem');
assert.equal(cream.answerIntent, 'usage');
assert.equal(cream.groundingStatus, 'grounded');
assert.equal(cream.factsUsed[0].factType, 'usageInstructions');
assert.equal(cream.factsUsed[0].provenance[0].sourceType, 'unas_snapshot');
assert.equal(cream.factsUsed[0].provenance[0].productId, 'dermavital_krem');
assert.doesNotMatch(cream.answer, /Kecsketejes testápoló/i);
remember(creamQuestion, cream);

const creamMapping = mappingData.mappings.find((item) => item.canonicalId === 'dermavital_krem');
const withoutCreamUsage = {
  ...snapshot,
  products: snapshot.products.map((item) => String(item.unasId) === String(creamMapping.unasId)
    ? { ...item, longDescription: 'Összetevők: Aqua, Urea' } : item)
};
const missingResolver = createProductFactsResolver({ mappingData, snapshotData: withoutCreamUsage });
assert.equal(missingResolver.getFact('dermavital_krem', 'usageInstructions').status, 'unavailable');

const unrelated = resolveProductReference('És a krémet?', {
  lastFocusProduct: 'aktiv_szenes_szappan', lastRecommendedProducts: ['aktiv_szenes_szappan']
});
assert.equal(unrelated.productId, null);
assert.equal(unrelated.ambiguous, true);

RELATIONS.ambiguous_fixture = { cream: ['cream_a', 'cream_b'], companion: null, answers: { cream: 'fixture' } };
try {
  const ambiguous = resolveProductReference('És a krémet?', {
    lastFocusProduct: 'ambiguous_fixture', lastRecommendedProducts: ['ambiguous_fixture']
  });
  assert.equal(ambiguous.productId, null);
  assert.equal(ambiguous.ambiguous, true);
} finally {
  delete RELATIONS.ambiguous_fixture;
}

const explicit = ask('Hogyan használjam a PsoriVital csomagot?');
assert.equal(explicit.targetProductId, 'psorivital_csomag');
assert.equal(explicit.answerIntent, 'usage');

const soapAgain = ask('És a szappant?');
assert.equal(soapAgain.targetProductId, 'dermavital_szappan');
assert.equal(soapAgain.answerIntent, 'usage');

console.log('FIRST_REAL_MULTI_TURN_CONTENT_OK');
