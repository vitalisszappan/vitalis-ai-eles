'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');
const restoreCatalogFixture = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restoreCatalogFixture);
const { createAnswer } = require('./engine/answer-service.cjs');
const { planAnswer } = require('./engine/answer-planner.cjs');
const { createProductFactsResolver } = require('./engine/product-facts.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');
const ask = (question, history = []) => createAnswer({ question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });
const addTurn = (history, question, result) => history.push({ role: 'user', content: question }, { role: 'assistant', content: result.answer, route: result.route, intent: result.intent, domain: result.domain, responseType: result.responseSource, targetProductId: result.targetProductId, links: result.links });
const assertGrounded = (result) => result.factsUsed.filter((fact) => fact.status === 'grounded').forEach((fact) => assert.ok(fact.provenance.length, fact.factType));

// Acceptance A: recommendation -> benefit -> ingredients -> usage -> price -> purchase.
let history = [];
let result = ask('Ekcémára hajlamos, száraz és irritált bőrre mit ajánlasz?', history);
assert.equal(result.answerIntent, 'product_recommendation');
assert.equal(result.targetProductId, 'dermavital_krem');
assert.equal(result.groundingStatus, 'grounded');
assert.equal(result.ctaStrategy, 'view_product');
assert.deepEqual(result.links.map((item) => item.id), ['dermavital_krem', 'dermavital_szappan']);
assert.equal(result.links[0].reason, 'Száraz, érzékeny, irritált és ekcémára hajlamos bőr ápolására.');
assert.equal(result.links[0].reasonSource, 'grounded_product_fact');
assert.equal(result.links[1].reason, 'Kapcsolódó termék az ajánláshoz.');
assert.equal(result.links[1].reasonSource, 'expert_relationship');
assert.doesNotMatch(result.links[0].reason, /puhaság|komfortérzet|táplálóbb/i);
assertGrounded(result); addTurn(history, 'Ekcémára hajlamos, száraz és irritált bőrre mit ajánlasz?', result);

result = ask('Miért ezt ajánlod?', history);
assert.equal(result.answerIntent, 'product_benefits'); assert.equal(result.targetProductId, 'dermavital_krem');
assert.equal(result.ctaStrategy, 'learn_more'); assert.match(result.answer, /Száraz, érzékeny, irritált/); assertGrounded(result);
addTurn(history, 'Miért ezt ajánlod?', result);

for (const [question, intent] of [['Mi van benne?', 'ingredients'], ['Hogyan használjam?', 'usage'], ['Mennyibe kerül?', 'price_query']]) {
  result = ask(question, history); assert.equal(result.answerIntent, intent); assert.equal(result.targetProductId, 'dermavital_krem'); assertGrounded(result); addTurn(history, question, result);
}
result = ask('Akkor ezt kérem.', history);
assert.equal(result.answerIntent, 'order_start'); assert.equal(result.targetProductId, 'dermavital_krem'); assert.equal(result.ctaStrategy, 'purchase');

// Acceptance B: exact product benefit and ingredient claims stay separate.
history = [];
result = ask('Ekcémára mit ajánlasz?', history); addTurn(history, 'Ekcémára mit ajánlasz?', result);
result = ask('Miért ajánlod?', history); assert.equal(result.answerIntent, 'product_benefits'); addTurn(history, 'Miért ajánlod?', result);
result = ask('Mire jó?', history); assert.equal(result.answerIntent, 'product_benefits'); assert.doesNotMatch(result.answer, /urea|karbamid/i); addTurn(history, 'Mire jó?', result);
result = ask('Van benne urea?', history); assert.equal(result.answerIntent, 'ingredients'); assert.match(result.answer, /szerepel az urea/i); addTurn(history, 'Van benne urea?', result);
result = ask('Mire jó benne az urea?', history); assert.equal(result.answerIntent, 'ingredient_benefit'); assert.equal(result.groundingStatus, 'partial'); assert.match(result.answer, /nincs külön bizonyított leírás/i); assert.doesNotMatch(result.answer, /hidrat|puh|nedvesség/i);

// No rule-selected primary, multiple candidates, or missing facts cannot become a recommendation.
const ambiguousPlan = planAnswer({ question: 'Mit ajánlasz?', routing: { route: 'expert_rule', matchedRuleId: 'x', matchedProductIds: ['dermavital_krem', 'dermavital_szappan'] }, conversationState: {} });
assert.equal(ambiguousPlan.targetProductId, null); assert.equal(ambiguousPlan.ctaStrategy, 'clarify_need');
const noBenefitEvidenceFacts = createProductFactsResolver({
  mappingData: { mappings: [{ canonicalId: 'x', unasId: '1', sku: 'X', mappingStatus: 'approved' }] },
  snapshotData: { products: [{ unasId: '1', sku: 'X', name: 'X' }] }, deterministicProducts: { x: { id: 'x', name: 'X' } }
});
const unavailableExpert = planAnswer({ question: 'Mit ajánlasz?', routing: { route: 'expert_rule', matchedRuleId: 'x-rule', primaryProductId: 'x', matchedProductIds: ['x'] }, conversationState: {}, factsApi: noBenefitEvidenceFacts });
assert.equal(unavailableExpert.groundingStatus, 'unavailable'); assert.notEqual(unavailableExpert.groundingStatus, 'grounded');
assert.equal(unavailableExpert.responseStrategy, 'expert_relationship'); assert.equal(unavailableExpert.cardStrategy, 'expert_products'); assert.equal(unavailableExpert.ctaStrategy, 'clarify_need');
assert.equal(unavailableExpert.factsUsed.find((fact) => fact.factType === 'productBenefits')?.status, 'unavailable');
assert.equal(unavailableExpert.factsUsed.some((fact) => fact.factType === 'productBenefits' && fact.status === 'grounded'), false);
const missingRule = planAnswer({ question: 'Mit ajánlasz?', routing: { route: 'expert_rule', matchedRuleId: null, primaryProductId: 'x', matchedProductIds: ['x'] }, conversationState: {}, factsApi: noBenefitEvidenceFacts });
assert.equal(missingRule.targetProductId, null); assert.equal(missingRule.groundingStatus, 'unavailable'); assert.equal(missingRule.responseStrategy, 'clarify_product'); assert.equal(missingRule.cardStrategy, 'none'); assert.equal(missingRule.ctaStrategy, 'clarify_need');
const primaryNotMatched = planAnswer({ question: 'Mit ajánlasz?', routing: { route: 'expert_rule', matchedRuleId: 'x-rule', primaryProductId: 'x', matchedProductIds: ['y'] }, conversationState: {}, factsApi: noBenefitEvidenceFacts });
assert.equal(primaryNotMatched.targetProductId, null); assert.equal(primaryNotMatched.responseStrategy, 'clarify_product'); assert.equal(primaryNotMatched.cardStrategy, 'none'); assert.equal(primaryNotMatched.ctaStrategy, 'clarify_need');
const missingBenefit = planAnswer({ question: 'Mire jó?', routing: { route: 'context_followup', contextTarget: 'x', matchedProductIds: ['x'] }, conversationState: {}, factsApi: noBenefitEvidenceFacts });
assert.equal(missingBenefit.groundingStatus, 'unavailable'); assert.equal(missingBenefit.ctaStrategy, 'none');

console.log('Answer Planner Phase 1C: PASS (recommendation + benefits + safety negatives)');
