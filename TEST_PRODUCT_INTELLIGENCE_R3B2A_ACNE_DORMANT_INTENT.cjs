'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { PRODUCTS } = require('./engine/product-catalog.cjs');

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

console.log('=== TEST_PRODUCT_INTELLIGENCE_R3B2A_ACNE_DORMANT_INTENT ===');

// Case A: Resolved acne + face
const faceRes = ask('Pattanasok vannak az enyhen zsiros arcomon neha');
assert.ok(faceRes.recommendationIntent, 'recommendationIntent must be present for face acne');
assert.equal(faceRes.recommendationIntent.kind, 'RECOMMENDATION');
assert.equal(faceRes.recommendationIntent.productId, 'aktiv_szenes_szappan');
assert.equal(faceRes.recommendationIntent.concernContext, 'acne');
assert.equal(faceRes.recommendationIntent.applicationArea, 'face');
assert.equal(faceRes.recommendationRole, undefined, 'recommendationRole must not leak to public output properties');
assert.equal(faceRes.recommendationIntent.recommendationRole, 'primary');
assert.equal(faceRes.recommendationIntent.materializationFamily, null, 'materializationFamily must remain null when not structurally present');
assert.equal(faceRes.recommendationIntent.sourceRoute, 'expert_rule');
assert.equal(faceRes.recommendationIntent.sourceIntent, 'acne');
assert.equal(faceRes.recommendationIntent.completenessStatus, 'COMPLETE');
assert.deepEqual(faceRes.recommendationIntent.missingDimensions, []);
assert.equal(faceRes.recommendationIntent.reasonCode, null);

// Case B: Resolved acne + scalp
const scalpRes = ask('Gyorsan zsirosodik a hajam es pattanasaok vannak a fejboromon');
assert.ok(scalpRes.recommendationIntent, 'recommendationIntent must be present for scalp acne');
assert.equal(scalpRes.recommendationIntent.kind, 'RECOMMENDATION');
assert.equal(scalpRes.recommendationIntent.productId, 'katrany_szappan');
assert.equal(scalpRes.recommendationIntent.concernContext, 'acne');
assert.equal(scalpRes.recommendationIntent.applicationArea, 'scalp');
assert.equal(scalpRes.recommendationIntent.recommendationRole, 'primary');
assert.equal(scalpRes.recommendationIntent.completenessStatus, 'COMPLETE');
assert.deepEqual(scalpRes.recommendationIntent.missingDimensions, []);
assert.equal(scalpRes.recommendationIntent.reasonCode, null);

// Case C: Resolved acne + body
const bodyRes = ask('Pattanasos a hatam es rendszeresen zsiros a borom');
assert.ok(bodyRes.recommendationIntent, 'recommendationIntent must be present for body acne');
assert.equal(bodyRes.recommendationIntent.kind, 'RECOMMENDATION');
assert.equal(bodyRes.recommendationIntent.productId, 'katrany_szappan');
assert.equal(bodyRes.recommendationIntent.concernContext, 'acne');
assert.equal(bodyRes.recommendationIntent.applicationArea, 'body');
assert.equal(bodyRes.recommendationIntent.recommendationRole, 'primary');
assert.equal(bodyRes.recommendationIntent.completenessStatus, 'COMPLETE');
assert.deepEqual(bodyRes.recommendationIntent.missingDimensions, []);
assert.equal(bodyRes.recommendationIntent.reasonCode, null);

// Case D: Resolved acne + multiple/unknown area (incomplete)
const multiRes = ask('Nagyon zsiros a borom es gyakran vannak pattanasaok');
assert.ok(multiRes.recommendationIntent, 'recommendationIntent must be present even when incomplete');
assert.equal(multiRes.recommendationIntent.kind, 'RECOMMENDATION');
assert.equal(multiRes.recommendationIntent.productId, 'katrany_szappan');
assert.equal(multiRes.recommendationIntent.concernContext, 'acne');
assert.equal(multiRes.recommendationIntent.applicationArea, null);
assert.equal(multiRes.recommendationIntent.recommendationRole, 'primary');
assert.equal(multiRes.recommendationIntent.completenessStatus, 'INCOMPLETE');
assert.deepEqual(multiRes.recommendationIntent.missingDimensions, ['applicationArea']);
assert.equal(multiRes.recommendationIntent.reasonCode, 'MISSING_APPLICATION_AREA');

// Case E: Generic acne clarification (unresolved)
const clarifyRes = ask('Pattanasos a borom');
assert.equal(clarifyRes.recommendationIntent, undefined, 'unresolved clarification acne must not carry a fake recommendation contract');

// Case F: Product identity mutation invariance
const originalName = PRODUCTS.aktiv_szenes_szappan.name;
try {
  PRODUCTS.aktiv_szenes_szappan.name = 'Aktív szenes szappan Különleges Kiadás';
  const mutatedRes = ask('Pattanasok vannak az enyhen zsiros arcomon neha');
  assert.equal(mutatedRes.recommendationIntent.productId, 'aktiv_szenes_szappan');
} finally {
  PRODUCTS.aktiv_szenes_szappan.name = originalName;
}

// Case G: Final answer prose mutation invariance
const testRes = ask('Pattanasok vannak az enyhen zsiros arcomon neha');
assert.equal(testRes.recommendationIntent.concernContext, 'acne');
assert.equal(testRes.recommendationIntent.applicationArea, 'face');

// Case H: No authorization (adapter / scope repo / evaluator not called)
// Verify modules are not imported into production runtime
const serviceCode = fs.readFileSync('engine/answer-service.cjs', 'utf8');
assert.doesNotMatch(serviceCode, /product-intelligence-recommendation-authorization-adapter/);
assert.doesNotMatch(serviceCode, /product-intelligence-recommendation-scope-repository/);
assert.doesNotMatch(serviceCode, /product-intelligence-governance-evaluator/);

// Case I & J: Customer answer & card invariance
assert.ok(faceRes.answer.includes('Aktív szenes szappant'));
assert.equal(faceRes.links.length, 1);
assert.equal(faceRes.links[0].id, 'aktiv_szenes_szappan');
assert.ok(scalpRes.answer.includes('Kátrány szappant'));
assert.equal(scalpRes.links.length, 1);
assert.equal(scalpRes.links[0].id, 'katrany_szappan');

// Case K: Public response non-leakage
assert.equal(Object.keys(faceRes).includes('recommendationIntent'), false, 'recommendationIntent must not be an enumerable property key');
const serialized = JSON.stringify(faceRes);
assert.equal(serialized.includes('recommendationIntent'), false, 'recommendationIntent must not leak into JSON serialization');
assert.equal(serialized.includes('completenessStatus'), false, 'completenessStatus must not leak into JSON serialization');

// Case L: Persistence non-leakage
const serverCode = fs.readFileSync('server.cjs', 'utf8');
assert.doesNotMatch(serverCode, /recommendationIntent/);

// Case M: Provenance Fallback Absence Tests
// 1) Removing concernContext from structured acne metadata must yield INCOMPLETE (no fallback 'acne')
const { buildRecommendationIntentContract } = require('./engine/product-intelligence-recommendation-intent-contract.cjs');
const noConcernContract = buildRecommendationIntentContract({
  route: 'expert_rule',
  intent: 'acne',
  plannerAnswerIntent: 'product_recommendation',
  productId: 'aktiv_szenes_szappan',
  concernContext: null,
  applicationArea: 'face',
  recommendationRole: 'primary'
});
assert.equal(noConcernContract.concernContext, null);
assert.equal(noConcernContract.completenessStatus, 'INCOMPLETE');
assert.deepEqual(noConcernContract.missingDimensions, ['concernContext']);
assert.equal(noConcernContract.reasonCode, 'MISSING_CONCERN_CONTEXT');

// 2) Removing recommendationRole from structured acne metadata must yield INCOMPLETE (no fallback 'primary')
const noRoleContract = buildRecommendationIntentContract({
  route: 'expert_rule',
  intent: 'acne',
  plannerAnswerIntent: 'product_recommendation',
  productId: 'aktiv_szenes_szappan',
  concernContext: 'acne',
  applicationArea: 'face',
  recommendationRole: null
});
assert.equal(noRoleContract.recommendationRole, null);
assert.equal(noRoleContract.completenessStatus, 'INCOMPLETE');
assert.deepEqual(noRoleContract.missingDimensions, ['recommendationRole']);
assert.equal(noRoleContract.reasonCode, 'MISSING_RECOMMENDATION_ROLE');

// 3) Materialization family is not invented
assert.equal(noConcernContract.materializationFamily, null);
assert.equal(noRoleContract.materializationFamily, null);

console.log('TEST_PRODUCT_INTELLIGENCE_R3B2A_ACNE_DORMANT_INTENT: PASS');
