'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ENVELOPE_VERSION,
  PROVENANCE_SOURCE_TYPES,
  OWNERSHIP_STATES,
  SOURCE_KINDS,
  CONCERNS,
  APPLICATION_AREA_VALUES,
  PRODUCT_TYPE_VALUES,
  GOAL_VALUES,
  QUALIFIER_KEYS,
  AUTHORIZATION_STATUSES,
  validateEnvelope: validateEnvelopeContract
} = require('./engine/conversation-decision-envelope-schema.cjs');

const requiredSections = ['input', 'explicit', 'resolved', 'derived', 'governance', 'provenance', 'invalidation'];
const requiredExplicit = ['concerns', 'applicationAreas', 'products', 'goal', 'qualifiers', 'complaintState', 'safetySignals'];
const requiredResolved = ['productFocus', 'referencedProducts', 'problemDomain', 'concernContext', 'applicationArea', 'requestedProductType', 'commerceIntent', 'complaintIntent', 'safetyClass'];
const requiredDerived = ['answerIntent', 'route', 'answerTarget', 'fallbackType', 'ownershipState', 'isolationBoundary', 'ambiguity', 'evidenceIds'];
const requiredGovernance = ['scopeId', 'scopeVersion', 'criterionSetId', 'criterionSetVersion', 'bindingId', 'bindingVersion', 'reviewRecordId', 'wordingArtifactId', 'wordingArtifactVersion', 'wordingLocale', 'authorizationStatus', 'authorizationReason', 'authorizedProductIds', 'authorizationEvidenceIds'];

function validId(value) { return typeof value === 'string' && value.trim().length > 0; }
function validVersion(value) { return Number.isInteger(value) && value > 0; }
function validDate(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function hasAll(object, fields) { return fields.every((field) => Object.prototype.hasOwnProperty.call(object, field)); }
function validEvidence(value) {
  return value && validId(value.evidenceId)
    && PROVENANCE_SOURCE_TYPES.includes(value.sourceType)
    && (value.sourceTurnId === undefined || value.sourceTurnId === null || validId(value.sourceTurnId))
    && (value.fieldPath === undefined || value.fieldPath === null || validId(value.fieldPath))
    && (value.sourceReference === undefined || value.sourceReference === null || validId(value.sourceReference));
}
function validValueEvidenceList(value) { return Array.isArray(value) && value.length > 0 && value.every((item) => item && validId(item.value) && Array.isArray(item.evidenceIds) && item.evidenceIds.length > 0 && item.evidenceIds.every(validId)); }

function validateEnvelope(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return { valid: false, errors: ['envelope must be an object'] };
  if (envelope.envelopeVersion !== ENVELOPE_VERSION) errors.push('envelopeVersion is invalid');
  for (const field of ['conversationId', 'turnId']) if (!validId(envelope[field])) errors.push(`${field} is required`);
  if (envelope.parentTurnId !== null && envelope.parentTurnId !== undefined && !validId(envelope.parentTurnId)) errors.push('parentTurnId is invalid');
  if (!validDate(envelope.createdAt)) errors.push('createdAt is invalid');
  for (const section of requiredSections) if (!envelope[section] || typeof envelope[section] !== 'object') errors.push(`${section} section is required`);
  if (envelope.input && (!validId(envelope.input.rawText) || !validId(envelope.input.normalizedText) || envelope.input.source !== 'user' || (envelope.input.locale !== undefined && !validId(envelope.input.locale)))) errors.push('input is invalid');
  if (envelope.explicit && !hasAll(envelope.explicit, requiredExplicit)) errors.push('explicit shape is invalid');
  if (envelope.resolved && !hasAll(envelope.resolved, requiredResolved)) errors.push('resolved shape is invalid');
  if (envelope.derived && (!hasAll(envelope.derived, requiredDerived) || !OWNERSHIP_STATES.includes(envelope.derived.ownershipState) || (envelope.derived.answerTarget !== null && typeof envelope.derived.answerTarget === 'object'))) errors.push('derived shape is invalid');
  if (envelope.governance && (!hasAll(envelope.governance, requiredGovernance) || !AUTHORIZATION_STATUSES.includes(envelope.governance.authorizationStatus))) errors.push('governance shape is invalid');
  if (!Array.isArray(envelope.provenance) || envelope.provenance.some((item) => !validEvidence(item))) errors.push('provenance is invalid');
  if (envelope.invalidation && (!Array.isArray(envelope.invalidation.invalidatesTurnIds) || !Array.isArray(envelope.invalidation.invalidatesFields) || (envelope.invalidation.reason !== null && !validId(envelope.invalidation.reason)) || (envelope.invalidation.boundaryType !== null && !validId(envelope.invalidation.boundaryType)))) errors.push('invalidation is invalid');
  if (envelope.explicit) {
    if (!Array.isArray(envelope.explicit.concerns) || (!validValueEvidenceList(envelope.explicit.concerns) && envelope.explicit.concerns.length > 0)) errors.push('explicit concerns are invalid');
    if (!Array.isArray(envelope.explicit.applicationAreas) || (!validValueEvidenceList(envelope.explicit.applicationAreas) && envelope.explicit.applicationAreas.length > 0)) errors.push('explicit applicationAreas are invalid');
    if (Array.isArray(envelope.explicit.applicationAreas) && envelope.explicit.applicationAreas.some((item) => !APPLICATION_AREA_VALUES.includes(item.value))) errors.push('explicit applicationArea value is invalid');
    if (Array.isArray(envelope.explicit.concerns) && envelope.explicit.concerns.some((item) => !CONCERNS.includes(item.value))) errors.push('explicit concern value is invalid');
    if (envelope.explicit.goal !== null && (!envelope.explicit.goal || !validId(envelope.explicit.goal.value) || !GOAL_VALUES.includes(envelope.explicit.goal.value))) errors.push('explicit goal is invalid');
    if (!Array.isArray(envelope.explicit.qualifiers) || envelope.explicit.qualifiers.some((item) => !item || !QUALIFIER_KEYS.includes(item.key) || !Array.isArray(item.evidenceIds) || item.evidenceIds.length === 0)) errors.push('explicit qualifiers are invalid');
  }
  if (envelope.resolved) {
    if (envelope.resolved.concernContext !== null && !CONCERNS.includes(envelope.resolved.concernContext)) errors.push('resolved concernContext is invalid');
    if (envelope.resolved.applicationArea !== null && !APPLICATION_AREA_VALUES.includes(envelope.resolved.applicationArea)) errors.push('resolved applicationArea is invalid');
    if (envelope.resolved.requestedProductType !== null && !PRODUCT_TYPE_VALUES.includes(envelope.resolved.requestedProductType)) errors.push('resolved requestedProductType is invalid');
  }
  return { valid: errors.length === 0, errors };
}

function minimal(overrides = {}) {
  return {
    envelopeVersion: ENVELOPE_VERSION, conversationId: 'session-1', turnId: 'turn-1', parentTurnId: null, createdAt: '2026-09-06T00:00:00.000Z',
    input: { rawText: 'Mit keresel?', normalizedText: 'mit keresel', source: 'user', locale: 'hu-HU' },
    explicit: { concerns: [], applicationAreas: [], products: [], goal: null, qualifiers: [], complaintState: null, safetySignals: [] },
    resolved: { productFocus: null, referencedProducts: [], problemDomain: null, concernContext: null, applicationArea: null, requestedProductType: null, commerceIntent: null, complaintIntent: null, safetyClass: null },
    derived: { answerIntent: null, route: null, answerTarget: null, fallbackType: null, ownershipState: 'UNRESOLVED', isolationBoundary: null, ambiguity: null, evidenceIds: [] },
    governance: { scopeId: null, scopeVersion: null, criterionSetId: null, criterionSetVersion: null, bindingId: null, bindingVersion: null, reviewRecordId: null, wordingArtifactId: null, wordingArtifactVersion: null, wordingLocale: null, authorizationStatus: null, authorizationReason: null, authorizedProductIds: [], authorizationEvidenceIds: [] },
    provenance: [], invalidation: { invalidatesTurnIds: [], invalidatesFields: [], reason: null, boundaryType: null }, ...overrides
  };
}

assert.equal(validateEnvelope(minimal()).valid, true);
assert.equal(validateEnvelopeContract(minimal()).valid, true);
const full = minimal({
  explicit: { concerns: [{ value: 'acne', evidenceIds: ['e1'] }], applicationAreas: [{ value: 'face', evidenceIds: ['e2'] }], products: [{ value: 'synthetic_acne_soap', evidenceIds: ['e3'] }], goal: { value: 'selection', evidenceIds: ['e4'] }, qualifiers: [{ key: 'skinOiliness', value: 'combination', evidenceIds: ['e5'] }], complaintState: null, safetySignals: [] },
  resolved: { productFocus: { productId: 'synthetic_acne_soap', resolutionType: 'explicit', sourceTurnId: 'turn-1', evidenceIds: ['e3'], confidence: 1 }, referencedProducts: [], problemDomain: 'acne', concernContext: 'acne', applicationArea: 'face', requestedProductType: 'szappan', commerceIntent: null, complaintIntent: null, safetyClass: null },
  derived: { answerIntent: 'product_recommendation', route: 'expert_rule', answerTarget: 'synthetic_acne_soap', fallbackType: null, ownershipState: 'RECOMMENDATION', isolationBoundary: null, ambiguity: null, evidenceIds: ['e1', 'e2', 'e3'] },
  provenance: [{ evidenceId: 'e1', sourceType: 'USER_EXPLICIT', sourceTurnId: 'turn-1', fieldPath: 'explicit.concerns', sourceReference: 'message' }]
});
assert.equal(validateEnvelope(full).valid, true);
assert.equal(validateEnvelopeContract(full).valid, true);
assert.notEqual(full.explicit.concerns, full.resolved.concernContext);
assert.notEqual(full.resolved.requestedProductType, full.resolved.productFocus.productId);
assert.equal(APPLICATION_AREA_VALUES.includes('neck'), true);
assert.equal(APPLICATION_AREA_VALUES.includes('scalp'), true);
assert.notEqual('neck', 'scalp');
assert.equal(validateEnvelope(minimal({ resolved: { ...minimal().resolved, requestedProductType: 'sampon', productFocus: null } })).valid, false);
const psoriasisScalpShampoo = minimal({
  explicit: { concerns: [{ value: 'psoriasis', evidenceIds: ['p1'] }], applicationAreas: [{ value: 'scalp', evidenceIds: ['p2'] }], products: [], goal: { value: 'selection', evidenceIds: ['p3'] }, qualifiers: [], complaintState: null, safetySignals: [] },
  resolved: { ...minimal().resolved, problemDomain: 'psoriasis', concernContext: 'psoriasis', applicationArea: 'scalp', requestedProductType: 'shampoo', productFocus: null },
  derived: { ...minimal().derived, ownershipState: 'SELECTION', evidenceIds: ['p1', 'p2', 'p3'] },
  provenance: [{ evidenceId: 'p1', sourceType: 'USER_EXPLICIT', sourceTurnId: 'turn-1', fieldPath: 'explicit.concerns' }, { evidenceId: 'p2', sourceType: 'USER_EXPLICIT', sourceTurnId: 'turn-1', fieldPath: 'explicit.applicationAreas' }]
});
assert.equal(validateEnvelopeContract(psoriasisScalpShampoo).valid, true);
assert.equal(psoriasisScalpShampoo.resolved.concernContext, 'psoriasis');
assert.equal(psoriasisScalpShampoo.resolved.applicationArea, 'scalp');
assert.equal(psoriasisScalpShampoo.resolved.requestedProductType, 'shampoo');
assert.equal(psoriasisScalpShampoo.resolved.productFocus, null);
assert.equal(psoriasisScalpShampoo.governance.authorizationStatus, null);
const safetyEnvelope = minimal({
  explicit: { concerns: [], applicationAreas: [], products: [], goal: { value: 'safety_escalation', evidenceIds: ['s1'] }, qualifiers: [], complaintState: null, safetySignals: [{ value: 'medical_escalation', evidenceIds: ['s1'] }] },
  derived: { ...minimal().derived, ownershipState: 'SAFETY', route: 'safety', evidenceIds: ['s1'] },
  resolved: { ...minimal().resolved, safetyClass: 'medical_escalation' },
  provenance: [{ evidenceId: 's1', sourceType: 'USER_EXPLICIT', sourceTurnId: 'turn-1', fieldPath: 'explicit.safetySignals' }]
});
const medicalEnvelope = minimal({
  explicit: { concerns: [], applicationAreas: [], products: [], goal: { value: 'safety_escalation', evidenceIds: ['m1'] }, qualifiers: [], complaintState: null, safetySignals: [{ value: 'medical_condition', evidenceIds: ['m1'] }] },
  derived: { ...minimal().derived, ownershipState: 'MEDICAL', route: 'safety', evidenceIds: ['m1'] },
  resolved: { ...minimal().resolved, safetyClass: 'medical_escalation' },
  provenance: [{ evidenceId: 'm1', sourceType: 'USER_EXPLICIT', sourceTurnId: 'turn-1', fieldPath: 'explicit.safetySignals' }]
});
assert.equal(validateEnvelopeContract(safetyEnvelope).valid, true);
assert.equal(validateEnvelopeContract(medicalEnvelope).valid, true);
for (const envelope of [safetyEnvelope, medicalEnvelope]) {
  assert.equal(envelope.governance.authorizationStatus, null);
  assert.deepEqual(envelope.governance.authorizedProductIds, []);
}
const neutralProductFact = minimal({
  explicit: { concerns: [], applicationAreas: [], products: [{ value: 'synthetic_neutral_product', evidenceIds: ['n1'] }], goal: { value: 'usage_question', evidenceIds: ['n1'] }, qualifiers: [], complaintState: null, safetySignals: [] },
  resolved: { ...minimal().resolved, productFocus: { productId: 'synthetic_neutral_product', resolutionType: 'explicit', sourceTurnId: 'turn-1', evidenceIds: ['n1'], confidence: 1 }, requestedProductType: 'szappan' },
  derived: { ...minimal().derived, ownershipState: 'NEUTRAL_PRODUCT_FACT', answerIntent: 'usage', route: 'exact_product', answerTarget: 'synthetic_neutral_product', evidenceIds: ['n1'] },
  provenance: [{ evidenceId: 'n1', sourceType: 'USER_EXPLICIT', sourceTurnId: 'turn-1', fieldPath: 'explicit.products' }]
});
assert.equal(validateEnvelopeContract(neutralProductFact).valid, true);
assert.equal(neutralProductFact.governance.authorizationStatus, null);
assert.deepEqual(neutralProductFact.governance.authorizationEvidenceIds, []);
assert.equal(validateEnvelope(minimal({ explicit: { ...minimal().explicit, concerns: [{ value: 'acne', evidenceIds: ['e1'] }], applicationAreas: [{ value: 'face', evidenceIds: ['e2'] }], products: [{ value: 'synthetic_acne_soap', evidenceIds: ['e3'] }], goal: { value: 'selection', evidenceIds: ['e4'] }, qualifiers: [{ key: 'dry', value: true, evidenceIds: ['e5'] }], complaintState: null, safetySignals: [] }, resolved: { ...minimal().resolved, concernContext: null } })).valid, true);
const recovery = { evidenceId: 'e-recovery', sourceType: 'ASSISTANT_OUTPUT_RECOVERY', fieldPath: 'resolved.productFocus', sourceTurnId: 'turn-0', sourceReference: 'assistant-answer' };
const approved = { ...recovery, evidenceId: 'e-approved', sourceType: 'APPROVED_PRODUCT_FACT', sourceReference: 'fact-1' };
assert.notEqual(recovery.sourceType, approved.sourceType);
assert.equal(SOURCE_KINDS.ASSISTANT_OUTPUT_RECOVERY.authorizationCapable, false);
assert.equal(SOURCE_KINDS.LEGACY_TEXT_RECOVERY.authorizationCapable, false);
assert.equal(SOURCE_KINDS.USER_EXPLICIT.authorizationCapable, true);
assert.equal(validateEnvelope(minimal({ provenance: [{ evidenceId: 'bad', sourceType: 'NOT_A_SOURCE' }] })).valid, false);
assert.equal(validateEnvelope(minimal({ envelopeVersion: 2 })).valid, false);
assert.equal(validateEnvelopeContract(minimal({ envelopeVersion: 2 })).valid, false);
assert.equal(validateEnvelope(minimal({ explicit: { concerns: {} } })).valid, false);
assert.equal(validateEnvelope(minimal({ derived: { ...minimal().derived, answerTarget: { executable: 'x' } } })).valid, false);
const mutable = JSON.parse(JSON.stringify(full)); const before = JSON.stringify(full); validateEnvelope(full); assert.equal(JSON.stringify(full), before); assert.deepEqual(full, mutable);
assert.equal(typeof Date.now, 'function');
const schemaSource = fs.readFileSync(path.join(__dirname, 'engine', 'conversation-decision-envelope-schema.cjs'), 'utf8');
assert.equal(/Date\.now|Math\.random|readFileSync|fetch\(/.test(schemaSource), false);
const runtimeFiles = ['answer-router.cjs', 'answer-service.cjs', 'answer-planner.cjs', 'conversation-context.cjs', 'conversation-memory.cjs'];
for (const file of runtimeFiles) assert.equal(fs.readFileSync(path.join(__dirname, 'engine', file), 'utf8').includes('conversation-decision-envelope-schema'), false, file);
assert.equal(fs.readFileSync(path.join(__dirname, 'server.cjs'), 'utf8').includes('conversation-decision-envelope-schema'), false, 'server.cjs');
const forbidden = ['product-intelligence-recommendation-scope-repository.cjs', 'product-intelligence-recommendation-authorization-adapter.cjs', 'product-intelligence-governance-review-validator.cjs'];
for (const file of forbidden) assert.equal(fs.readFileSync(path.join(__dirname, 'engine', file), 'utf8').includes('conversation-decision-envelope-schema'), false, file);
assert.equal(PROVENANCE_SOURCE_TYPES.includes('LEGACY_TEXT_RECOVERY'), true);
assert.equal(AUTHORIZATION_STATUSES.includes(null), true);
assert.equal(OWNERSHIP_STATES.includes('SAFETY'), true);
assert.equal(OWNERSHIP_STATES.includes('MEDICAL'), true);
assert.equal(OWNERSHIP_STATES.includes('ACTIVE_COMPLAINT'), true);
for (const file of ['engine/conversation-decision-envelope-schema.cjs', 'TEST_CONVERSATION_DECISION_ENVELOPE_R4A1.cjs']) assert.equal(fs.readFileSync(path.join(__dirname, file), 'utf8').includes('require(\'./server.cjs\')'), false);

console.log('Conversation Decision Envelope R4A1: PASS');