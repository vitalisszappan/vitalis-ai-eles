'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schema = require('./engine/conversation-decision-transition-schema.cjs');
const policy = require('./engine/conversation-decision-field-policy.cjs');
const { validateTransitionEvent, validateTransitionBatch } = require('./engine/conversation-decision-transition-validator.cjs');

function event(overrides = {}) {
  return { contractVersion: 1, eventId: 'event-1', conversationId: 'conversation-1', turnId: 'turn-2', fieldPath: 'resolved.applicationArea', operation: 'SET', eventType: 'FIELD_TRANSITION', eventVersion: 1, baseEnvelopeVersion: 1, provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'e-1' }, payload: 'neck', evidenceIds: ['e-1'], reasonCode: 'CURRENT_TURN_REPLACEMENT', ...overrides };
}
assert.equal(validateTransitionEvent(event()).valid, true);
assert.equal(validateTransitionEvent(event({ operation: 'UNSET', payload: null })).valid, true);
assert.equal(validateTransitionEvent(event({ operation: 'CLEAR', payload: null })).valid, true);
assert.equal(validateTransitionEvent(event({ operation: 'CONFLICT', payload: { candidates: ['scalp', 'neck'] } })).valid, true);
assert.equal(validateTransitionEvent(event({ operation: 'INVALIDATE', payload: { invalidatesFields: ['governance.authorizationStatus'] }, reasonCode: 'DEPENDENCY_INVALIDATED' })).valid, true);
assert.equal(validateTransitionEvent(event({ operation: 'SET', provenance: { sourceType: 'ASSISTANT_OUTPUT_RECOVERY', evidenceId: 'e-1' } })).valid, false);
assert.equal(validateTransitionEvent(event({ operation: 'SET', fieldPath: 'resolved.productFocus', payload: 'product_A', provenance: { sourceType: 'ASSISTANT_OUTPUT_RECOVERY', evidenceId: 'e-1' } })).valid, false);
assert.equal(validateTransitionEvent(event({ operation: 'SET', fieldPath: 'governance.authorizationStatus', payload: 'AUTHORIZED', provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'e-1' } })).valid, false);
assert.equal(validateTransitionEvent(event({ fieldPath: 'resolved.requestedProductType', payload: 'cream' })).valid, true);
assert.equal(validateTransitionEvent(event({ fieldPath: 'resolved.productFocus', payload: 'product_A', provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'e-1' } })).valid, true);
assert.equal(validateTransitionEvent(event({ fieldPath: 'resolved.productFocus', payload: 'product_A', provenance: { sourceType: 'UNKNOWN', evidenceId: 'e-1' } })).valid, false);
assert.equal(validateTransitionEvent(event({ fieldPath: 'resolved.applicationArea', payload: 'scalp' })).valid, true);
assert.notEqual('neck', 'scalp');
assert.equal(validateTransitionEvent(event({ fieldPath: 'resolved.applicationArea', payload: 'neck', reasonCode: 'CURRENT_TURN_REPLACEMENT' })).valid, true);
assert.equal(validateTransitionEvent(event({ fieldPath: 'resolved.requestedProductType', payload: 'cream' })).valid, true);
assert.equal(validateTransitionEvent(event({ fieldPath: 'resolved.productFocus', payload: 'product_A', provenance: { sourceType: 'CANONICAL_RESOLUTION', evidenceId: 'e-canonical' } })).valid, true);
assert.equal(validateTransitionEvent(event({ fieldPath: 'resolved.concernContext', payload: 'psoriasis', provenance: { sourceType: 'PROBLEM_DOMAIN_DECISION', evidenceId: 'e-domain' } })).valid, true);
assert.equal(validateTransitionEvent(event({ fieldPath: 'explicit.qualifiers', payload: [{ key: 'dry', value: true }], provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'e-dry' } })).valid, true);
assert.equal(validateTransitionEvent(event({ fieldPath: 'derived.ownershipState', payload: 'SAFETY', provenance: { sourceType: 'PROBLEM_DOMAIN_DECISION', evidenceId: 'e-safety' } })).valid, true);
assert.equal(validateTransitionEvent(event({ fieldPath: 'derived.ownershipState', payload: 'MEDICAL', provenance: { sourceType: 'PROBLEM_DOMAIN_DECISION', evidenceId: 'e-medical' } })).valid, true);
assert.equal(validateTransitionEvent(event({ fieldPath: 'governance.authorizationStatus', operation: 'INVALIDATE', payload: { invalidatesFields: ['governance.authorizationStatus'] }, reasonCode: 'DEPENDENCY_INVALIDATED' })).valid, true);
assert.equal(policy.FIELD_PROVENANCE_POLICY['resolved.requestedProductType'].USER_EXPLICIT, 'ADMISSIBLE_CANDIDATE');
assert.equal(policy.FIELD_PROVENANCE_POLICY['governance.authorizationStatus'].USER_EXPLICIT, 'FORBIDDEN');
assert.equal(policy.isRecoveryOnly('LEGACY_TEXT_RECOVERY'), true);
assert.equal(policy.isAuthorizationCapableSource('LEGACY_TEXT_RECOVERY'), false);
assert.equal(policy.isAuthorizationCapableSource('APPROVED_PRODUCT_FACT'), true);
assert.deepEqual(policy.getFieldDependents('resolved.applicationArea'), ['governance']);
assert.equal(schema.TRANSITION_FIELD_PATHS.includes('resolved.requestedProductType'), true);
assert.equal(schema.TRANSITION_OPERATIONS.includes('INVALIDATE'), true);
assert.equal(schema.TRANSITION_OPERATIONS.includes('NOT_A_REAL_OPERATION'), false);
assert.equal(validateTransitionEvent(event({ fieldPath: 'resolved.notAField' })).valid, false);
assert.equal(validateTransitionEvent(event({ contractVersion: 2 })).valid, false);
assert.equal(validateTransitionEvent(event({ eventVersion: 0 })).valid, false);
assert.equal(validateTransitionEvent(event({ operation: 'SET', payload: undefined })).valid, false);
assert.equal(validateTransitionEvent(event({ operation: 'CONFLICT', payload: { candidates: ['one'] } })).valid, false);
assert.equal(validateTransitionBatch([event(), event({ eventId: 'event-2' })]).valid, true);
assert.equal(validateTransitionBatch([event(), event()]).valid, false);
const previous = event(); const before = JSON.stringify(previous); validateTransitionEvent(previous); assert.equal(JSON.stringify(previous), before);
const schemaFiles = ['engine/conversation-decision-transition-schema.cjs', 'engine/conversation-decision-transition-validator.cjs', 'engine/conversation-decision-field-policy.cjs'];
for (const file of schemaFiles) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  assert.equal(/Date\.now|Math\.random|node:fs|readFileSync|fetch\(|eval\s*\(|new Function|answer-service|answer-router|server\.cjs|product-intelligence-recommendation-scope-repository|authorization-adapter/.test(source), false, file);
}
for (const file of ['answer-service.cjs', 'answer-router.cjs', 'answer-planner.cjs', 'conversation-context.cjs', 'conversation-memory.cjs']) assert.equal(fs.readFileSync(path.join(__dirname, 'engine', file), 'utf8').includes('conversation-decision-transition'), false, file);
assert.equal(fs.readFileSync(path.join(__dirname, 'server.cjs'), 'utf8').includes('conversation-decision-transition'), false);
console.log('Conversation Decision Transition R4A2A: PASS');