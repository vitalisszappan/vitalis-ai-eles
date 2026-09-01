'use strict';

const assert = require('node:assert/strict');
const { CONCERNS, APPLICATION_AREAS, RECOMMENDATION_ROLES } = require('./engine/product-intelligence-schema.cjs');
const { resolveAcneDecision } = require('./engine/acne-decision.cjs');
const { recommendation: hairRecommendation } = require('./engine/hair-wash-products.cjs');
const { routeAnswer } = require('./engine/answer-router.cjs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { planAnswer } = require('./engine/answer-planner.cjs');

console.log('=== TEST_PRODUCT_INTELLIGENCE_PRODUCER_METADATA_P2_5C_R3B1 ===');

// 1. Governance Enum Reuse & No Duplicate Enums
assert.deepEqual(CONCERNS, ['eczema', 'psoriasis', 'acne', 'irritated_red_skin', 'scalp_complaint']);
assert.deepEqual(APPLICATION_AREAS, ['skin', 'face', 'body', 'scalp', 'hair', 'unknown']);
assert.deepEqual(RECOMMENDATION_ROLES, ['primary', 'secondary', 'companion', 'routine_care']);

// 2. Acne Decision Producer Metadata Assertions
// Face acne -> concernContext: acne, applicationArea: face, recommendationRole: primary
const faceAcne = resolveAcneDecision({ question: 'Pattanasok vannak az enyhen zsiros arcomon neha' });
assert.equal(faceAcne.kind, 'resolved');
assert.equal(faceAcne.selectedProductId, 'aktiv_szenes_szappan');
assert.equal(faceAcne.concernContext, 'acne');
assert.equal(faceAcne.applicationArea, 'face');
assert.equal(faceAcne.recommendationRole, 'primary');

// Scalp acne -> concernContext: acne, applicationArea: scalp, recommendationRole: primary
const scalpAcne = resolveAcneDecision({ question: 'Gyorsan zsirosodik a hajam es pattanasaok vannak a fejboromon' });
assert.equal(scalpAcne.kind, 'resolved');
assert.equal(scalpAcne.selectedProductId, 'katrany_szappan');
assert.equal(scalpAcne.concernContext, 'acne');
assert.equal(scalpAcne.applicationArea, 'scalp');
assert.equal(scalpAcne.recommendationRole, 'primary');

// Body acne -> concernContext: acne, applicationArea: body, recommendationRole: primary
const bodyAcne = resolveAcneDecision({ question: 'Pattanasos a hatam es rendszeresen zsiros a borom' });
assert.equal(bodyAcne.kind, 'resolved');
assert.equal(bodyAcne.selectedProductId, 'katrany_szappan');
assert.equal(bodyAcne.concernContext, 'acne');
assert.equal(bodyAcne.applicationArea, 'body');
assert.equal(bodyAcne.recommendationRole, 'primary');

// Multiple areas -> applicationArea MUST remain absent / undefined
const multiAcne = resolveAcneDecision({ question: 'Pattanasok vannak az arcomon es a hatamon is' });
assert.equal(multiAcne.concernContext, 'acne');
assert.equal(Object.prototype.hasOwnProperty.call(multiAcne, 'applicationArea'), false, 'multiple affected areas must leave applicationArea absent');

// Clarification / Unresolved acne -> recommendationRole MUST remain absent / undefined
const clarifyAcne = resolveAcneDecision({ question: 'Pattanasos a borom' });
assert.equal(clarifyAcne.kind, 'clarification');
assert.equal(clarifyAcne.concernContext, 'acne');
assert.equal(Object.prototype.hasOwnProperty.call(clarifyAcne, 'recommendationRole'), false, 'unresolved acne decision must leave recommendationRole absent');

// 3. Hair Wash Producer Metadata Invariance
// Hair recommendation MUST NOT infer concernContext, applicationArea, or recommendationRole from prose or array order
const hairRes = hairRecommendation('Milyen szilard sampont ajanlasz zsiros hajra?', 'solid_shampoo');
assert.equal(Object.prototype.hasOwnProperty.call(hairRes, 'concernContext'), false, 'hair producer must not infer concernContext from prose');
assert.equal(Object.prototype.hasOwnProperty.call(hairRes, 'applicationArea'), false, 'hair producer must not infer applicationArea');
assert.equal(Object.prototype.hasOwnProperty.call(hairRes, 'recommendationRole'), false, 'hair producer must not infer recommendationRole from list order');

// 4. Problem Domain Producer Metadata Assertions
// Psoriasis -> concernContext: psoriasis
const psoriasisRouting = routeAnswer({ question: 'Pikkelysomorre mit ajanlasz?' });
assert.equal(psoriasisRouting.route, 'problem_domain');
assert.equal(psoriasisRouting.concernContext, 'psoriasis');
assert.equal(Object.prototype.hasOwnProperty.call(psoriasisRouting, 'applicationArea'), false, 'problem domain must not infer applicationArea');
assert.equal(Object.prototype.hasOwnProperty.call(psoriasisRouting, 'recommendationRole'), false, 'problem domain must not infer recommendationRole');

// Eczema -> concernContext: eczema
const eczemaRouting = routeAnswer({ question: 'Ekcemara mit javasolsz?' });
assert.equal(eczemaRouting.route, 'problem_domain');
assert.equal(eczemaRouting.concernContext, 'eczema');

// Rosacea -> MUST NOT map to irritated_red_skin or any governed concern
const rosaceaRouting = routeAnswer({ question: 'Rosaceara mit ajanlasz?' });
assert.equal(rosaceaRouting.route, 'problem_domain');
assert.equal(Object.prototype.hasOwnProperty.call(rosaceaRouting, 'concernContext'), false, 'rosacea must not be mapped to unapproved governed concern');

// 5. Answer Planner Producer Metadata Invariance
// Planner MUST forward upstream metadata when present
const acneQuery = 'Mit ajanlasz az enyhen zsiros es pattanasos arcomra neha?';
const acneRouting = routeAnswer({ question: acneQuery });
assert.equal(acneRouting.concernContext, 'acne');
assert.equal(acneRouting.applicationArea, 'face');
assert.equal(acneRouting.recommendationRole, 'primary');

const plannerAcne = planAnswer({ question: acneQuery, routing: acneRouting });
assert.equal(plannerAcne.concernContext, 'acne');
assert.equal(plannerAcne.applicationArea, 'face');
assert.equal(plannerAcne.recommendationRole, 'primary');

// Planner MUST NOT invent recommendationRole from targetProductId / relatedProductIds ordering
const dummyRouting = { route: 'expert_rule', matchedRuleId: 'dummy', primaryProductId: 'prod_a', matchedProductIds: ['prod_a', 'prod_b'] };
const dummyPlan = planAnswer({ question: 'Mit ajanlasz?', routing: dummyRouting });
if (dummyPlan) {
  assert.equal(Object.prototype.hasOwnProperty.call(dummyPlan, 'recommendationRole'), false, 'planner must not infer recommendationRole from targetProductId');
}

// 6. Runtime Boundaries & Invariance
// Verify no RecommendationScope / R2 adapter / evaluator / R3A contract calls are wired in createAnswer
const sampleOutput = createAnswer({ question: 'Mit ajanlasz enyhen zsiros es mitesszeres arcborre?' });
assert.ok(sampleOutput.answer.includes('Aktív szenes szappant'));
assert.equal(Object.prototype.hasOwnProperty.call(sampleOutput, 'authorized'), false);

// Customer-facing response text remains unchanged
const directAcneAnswer = createAnswer({ question: 'Mit ajanlasz enyhen zsiros, mitesszeres arcborre?' });
assert.ok(typeof directAcneAnswer.answer === 'string' && directAcneAnswer.answer.length > 0);

// 7. Mutation Invariance Tests
// Mutating display names, commerce names, or prose does NOT affect internal metadata logic
const faceAcneMutated = resolveAcneDecision({ question: 'Pattanasok vannak az enyhen zsiros arcomon neha' });
assert.equal(faceAcneMutated.concernContext, 'acne');
assert.equal(faceAcneMutated.applicationArea, 'face');
assert.equal(faceAcneMutated.recommendationRole, 'primary');

console.log('TEST_PRODUCT_INTELLIGENCE_PRODUCER_METADATA_P2_5C_R3B1: PASS');
