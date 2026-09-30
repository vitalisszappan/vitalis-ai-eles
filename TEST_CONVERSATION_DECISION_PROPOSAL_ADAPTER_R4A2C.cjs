'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validateEnvelope } = require('./engine/conversation-decision-envelope-schema.cjs');
const adapterPath = path.join(__dirname, 'engine', 'conversation-decision-proposal-adapter.cjs');
const { admitSemanticProposal: admit, ADMISSION_STATUSES, ADMISSION_REASON_CODES } = require(adapterPath);

let count = 0;
function test(name, fn) { try { fn(); count++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
function envelope(overrides = {}) {
  return {
    envelopeVersion: 1, stateVersion: 0, conversationId: 'conversation-1', turnId: 'prior-turn', createdAt: '2026-01-01T00:00:00.000Z',
    input: { rawText: '', normalizedText: '' },
    explicit: { concerns: [], applicationAreas: [], products: [], goal: null, qualifiers: [], complaintState: null, safetySignals: [] },
    resolved: { productFocus: null, referencedProducts: [], problemDomain: null, concernContext: null, applicationArea: null, requestedProductType: null, commerceIntent: null, complaintIntent: null, safetyClass: null },
    derived: { answerIntent: null, route: null, answerTarget: null, fallbackType: null, ownershipState: 'UNRESOLVED', isolationBoundary: null, ambiguity: null, evidenceIds: [] },
    governance: { scopeId: null, scopeVersion: null, criterionSetId: null, criterionSetVersion: null, bindingId: null, bindingVersion: null, reviewRecordId: null, wordingArtifactId: null, wordingArtifactVersion: null, wordingLocale: null, authorizationStatus: null, authorizationReason: null, authorizedProductIds: [], authorizationEvidenceIds: [] },
    provenance: [], fieldClears: [], fieldConflicts: [], fieldInvalidations: [],
    invalidation: { invalidatesTurnIds: [], invalidatesFields: [], reason: null, boundaryType: null }, ...overrides
  };
}
function proposal(fieldPath = 'resolved.applicationArea', value = 'neck') {
  return {
    proposalVersion: 1, proposalId: 'proposal-1', conversationId: 'conversation-1', turnId: 'current-turn',
    producerId: 'fixture:producer', fieldPath, disposition: 'SET', value,
    provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'user-1', sourceTurnId: 'current-turn' },
    evidenceIds: ['user-1'], evidence: [{ evidenceId: 'user-1', sourceType: 'USER_EXPLICIT', fieldPath,
      sourceTurnId: 'current-turn', sourceReference: 'fixture:conversation-1/current-turn/input' }]
  };
}
function input(p = proposal(), env = envelope(), overrides = {}) {
  return { currentEnvelope: env, proposal: p, eventId: 'event-1', eventVersion: 1,
    baseEnvelopeVersion: env.envelopeVersion, baseStateVersion: env.stateVersion, ...overrides };
}
function clear() { const p = proposal(); delete p.value; p.disposition = 'CLEAR'; p.evidence[0].disposition = 'CLEAR'; return p; }
function conflict() {
  const p = proposal(); delete p.value; p.disposition = 'CONFLICT';
  p.evidence.push({ ...p.evidence[0], evidenceId: 'user-2', sourceReference: 'fixture:second' });
  p.candidates = [{ value: 'scalp', evidenceIds: ['user-1'] }, { value: 'neck', evidenceIds: ['user-2'] }];
  return p;
}
function unresolved(withCandidate = false) {
  const p = proposal('resolved.productFocus'); delete p.value; p.disposition = 'UNRESOLVED';
  p.referenceResolutionStatus = 'unresolved';
  if (withCandidate) p.candidates = [{ value: 'unverified-product', evidenceIds: ['user-1'] }];
  return p;
}
function product(field = 'resolved.productFocus') {
  const p = proposal(field, field === 'resolved.productFocus' ? 'fixture-product-A' : [{ value: 'fixture-product-A', evidenceIds: ['resolution-1'] }]);
  p.evidence.push(
    { evidenceId: 'identity-1', sourceType: 'APPROVED_PRODUCT_FACT', fieldPath: field, sourceTurnId: null, sourceReference: 'fixture:product/A', productId: 'fixture-product-A' },
    { evidenceId: 'resolution-1', sourceType: 'CANONICAL_RESOLUTION', fieldPath: field, sourceTurnId: 'current-turn', sourceReference: 'fixture:resolution/A', productId: 'fixture-product-A', producerId: 'fixture:resolver', resolverId: 'resolver-1', supportEvidenceIds: ['user-1', 'identity-1'] }
  );
  p.evidenceIds = ['resolution-1'];
  p.provenance = { sourceType: 'CANONICAL_RESOLUTION', evidenceId: 'resolution-1', sourceTurnId: 'current-turn' };
  p.referenceResolutionStatus = 'resolved';
  p.productResolutions = [{ productId: 'fixture-product-A', status: 'resolved', resolverId: 'resolver-1', sourceReference: 'fixture:resolution/A', evidenceIds: ['resolution-1'], identityEvidenceId: 'identity-1' }];
  return p;
}
function authorized() { return { scopeId: 's', scopeVersion: 'sv', criterionSetId: 'c', criterionSetVersion: 'cv', bindingId: 'b', bindingVersion: 'bv', reviewRecordId: 'r', wordingArtifactId: 'w', wordingArtifactVersion: 'wv', wordingLocale: 'hu-HU', authorizationStatus: 'AUTHORIZED', authorizationReason: 'ok', authorizedProductIds: ['p'], authorizationEvidenceIds: ['e'] }; }
function isolatedAdapter(reduce) {
  const source = fs.readFileSync(adapterPath, 'utf8');
  const modules = {
    './conversation-decision-envelope-schema.cjs': require('./engine/conversation-decision-envelope-schema.cjs'),
    './conversation-decision-transition-schema.cjs': require('./engine/conversation-decision-transition-schema.cjs'),
    './conversation-decision-transition-validator.cjs': require('./engine/conversation-decision-transition-validator.cjs'),
    './conversation-decision-semantic-proposal-contract.cjs': require('./engine/conversation-decision-semantic-proposal-contract.cjs'),
    './conversation-decision-reducer.cjs': { reduceDecisionEnvelope: reduce }
  };
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`,
    { filename: adapterPath })((id) => modules[id], module, module.exports);
  return module.exports.admitSemanticProposal;
}

test('exact exports and frozen vocabularies', () => {
  assert.deepEqual(Object.keys(require(adapterPath)).sort(), ['ADMISSION_REASON_CODES', 'ADMISSION_STATUSES', 'admitSemanticProposal'].sort());
  assert.deepEqual(ADMISSION_STATUSES, ['ADMITTED', 'UNRESOLVED', 'REJECTED', 'REDUCER_REJECTED']);
  assert.ok(Object.isFrozen(ADMISSION_STATUSES) && Object.isFrozen(ADMISSION_REASON_CODES));
});
test('scalar SET compiles exactly and applies', () => {
  const r = admit(input());
  assert.equal(r.status, 'ADMITTED'); assert.equal(r.reducerResult, 'APPLIED');
  assert.deepEqual(Object.keys(r.transitionEvent), ['contractVersion','eventId','conversationId','turnId','fieldPath','operation','eventType','eventVersion','baseEnvelopeVersion','baseStateVersion','provenance','payload','evidenceIds','reasonCode']);
  assert.equal(r.transitionEvent.turnId, 'current-turn'); assert.equal(r.transitionEvent.payload, 'neck');
  assert.equal(r.transitionEvent.reasonCode, 'CURRENT_TURN_REPLACEMENT'); assert.equal(r.nextEnvelope.resolved.applicationArea, 'neck');
  assert.equal(validateEnvelope(r.nextEnvelope).valid, true);
});
test('requested product type SET', () => assert.equal(admit(input(proposal('resolved.requestedProductType', 'shampoo'))).nextEnvelope.resolved.requestedProductType, 'shampoo'));
test('concern SET', () => assert.equal(admit(input(proposal('resolved.concernContext', 'psoriasis'))).nextEnvelope.resolved.concernContext, 'psoriasis'));
test('explicit list SET', () => assert.deepEqual(admit(input(proposal('explicit.concerns', [{ value: 'psoriasis', evidenceIds: ['user-1'] }]))).nextEnvelope.explicit.concerns[0].value, 'psoriasis'));
test('qualifier SET', () => assert.equal(admit(input(proposal('explicit.qualifiers', [{ key: 'dry', value: true, evidenceIds: ['user-1'] }]))).nextEnvelope.explicit.qualifiers[0].value, true));
test('ownership uses ownership event', () => {
  const p = proposal('derived.ownershipState', 'NEUTRAL_PRODUCT_FACT');
  p.provenance.sourceType = 'PROBLEM_DOMAIN_DECISION';
  p.evidence.push({ ...p.evidence[0], evidenceId: 'problem-1', sourceType: 'PROBLEM_DOMAIN_DECISION',
    sourceReference: 'fixture:problem', producerId: 'fixture:problem', supportEvidenceIds: ['user-1'] });
  p.evidenceIds = ['problem-1']; p.provenance.evidenceId = 'problem-1';
  const r = admit(input(p)); assert.equal(r.transitionEvent.eventType, 'OWNERSHIP_TRANSITION');
});
test('proved scalar product SET', () => assert.equal(admit(input(product())).nextEnvelope.resolved.productFocus, 'fixture-product-A'));
test('proved product list SET', () => assert.equal(admit(input(product('explicit.products'))).nextEnvelope.explicit.products[0].value, 'fixture-product-A'));
test('identical SET with neutral dependents is NO_OP', () => {
  const env = envelope({ resolved: { ...envelope().resolved, applicationArea: 'neck' } });
  const r = admit(input(proposal(), env)); assert.equal(r.reducerResult, 'NO_OP'); assert.equal(r.nextEnvelope.stateVersion, 0);
});
test('identical SET tears down live dependents', () => {
  const env = envelope({ resolved: { ...envelope().resolved, applicationArea: 'neck' }, governance: authorized() });
  const r = admit(input(proposal(), env)); assert.equal(r.reducerResult, 'APPLIED'); assert.equal(r.nextEnvelope.stateVersion, 1); assert.equal(r.nextEnvelope.governance.authorizationStatus, null);
});
test('CLEAR compiles and applies', () => {
  const env = envelope({ stateVersion: 1, resolved: { ...envelope().resolved, applicationArea: 'scalp' } });
  const r = admit(input(clear(), env)); assert.equal(r.transitionEvent.operation, 'CLEAR'); assert.equal(r.transitionEvent.payload, null);
  assert.equal(r.transitionEvent.reasonCode, 'EXPLICIT_CLEAR'); assert.equal(r.nextEnvelope.resolved.applicationArea, null); assert.equal(r.nextEnvelope.fieldClears.length, 1);
});
test('CONFLICT compiles without promotion', () => {
  const r = admit(input(conflict())); assert.deepEqual(r.transitionEvent.payload, { candidates: ['scalp', 'neck'] });
  assert.equal(r.nextEnvelope.resolved.applicationArea, null); assert.equal(r.nextEnvelope.fieldConflicts.length, 1);
});
test('UNRESOLVED without candidates is diagnostic', () => {
  const r = admit(input(unresolved())); assert.equal(r.status, 'UNRESOLVED'); assert.equal(r.transitionEvent, null); assert.deepEqual(r.diagnostic.candidateValues, []);
});
test('UNRESOLVED candidates copied without execution', () => {
  const p = unresolved(true), r = admit(input(p)); assert.deepEqual(r.diagnostic.candidateValues, ['unverified-product']);
  p.candidates[0].value = 'changed'; assert.deepEqual(r.diagnostic.candidateValues, ['unverified-product']);
});

for (const value of [null, [], 1, 'x']) test(`invalid adapter input ${String(value)}`, () => assert.equal(admit(value).reasonCode, 'INVALID_INPUT'));
for (const key of ['currentEnvelope','proposal','eventId','eventVersion','baseEnvelopeVersion','baseStateVersion']) test(`missing ${key}`, () => { const x = input(); delete x[key]; assert.equal(admit(x).reasonCode, 'INVALID_INPUT'); });
test('unknown input property rejected', () => assert.equal(admit({ ...input(), extra: true }).reasonCode, 'INVALID_INPUT'));
test('inherited input rejected', () => assert.equal(admit(Object.assign(Object.create({ hidden: true }), input())).reasonCode, 'INVALID_INPUT'));
test('accessor input rejected without execution', () => { const x = input(); let called = false; Object.defineProperty(x, 'eventId', { enumerable: true, get() { called = true; return 'x'; } }); assert.equal(admit(x).reasonCode, 'INVALID_INPUT'); assert.equal(called, false); });
test('symbol input rejected', () => { const x = input(); x[Symbol('x')] = true; assert.equal(admit(x).reasonCode, 'INVALID_INPUT'); });
test('validated nested envelope accessor cannot throw on later read', () => {
  const env = envelope(); let reads = 0;
  Object.defineProperty(env, 'conversationId', { enumerable: true, get() { if (++reads === 1) return 'conversation-1'; throw new Error('must not escape'); } });
  assert.doesNotThrow(() => admit(input(proposal(), env)));
  const r = admit(input(proposal(), env)); assert.equal(r.status, 'REJECTED'); assert.equal(r.reasonCode, 'INVALID_ENVELOPE');
});
test('nested proposal accessor cannot escape', () => {
  const p = proposal(); let reads = 0;
  Object.defineProperty(p.evidence[0], 'sourceReference', { enumerable: true, get() { if (++reads === 1) return 'fixture:first'; throw new Error('must not escape'); } });
  let result; assert.doesNotThrow(() => { result = admit(input(p)); });
  assert.equal(result.status, 'REJECTED'); assert.equal(result.reasonCode, 'INVALID_PROPOSAL');
});
test('plain objects retain normal admission behavior after safe capture', () => {
  const r = admit(input()); assert.equal(r.status, 'ADMITTED'); assert.equal(r.reducerResult, 'APPLIED'); assert.equal(r.nextEnvelope.resolved.applicationArea, 'neck');
});
test('invalid envelope rejected first', () => { const r = admit(input(proposal(), { bad: true })); assert.equal(r.reasonCode, 'INVALID_ENVELOPE'); });
test('invalid proposal rejected', () => { const p = proposal(); p.value = 'unknown'; assert.equal(admit(input(p)).reasonCode, 'INVALID_PROPOSAL'); });
test('conversation mismatch rejected', () => { const p = proposal(); p.conversationId = 'other'; assert.equal(admit(input(p)).reasonCode, 'CONVERSATION_MISMATCH'); });
test('different envelope and proposal turns allowed', () => assert.equal(admit(input()).transitionEvent.turnId, 'current-turn'));
for (const [name, patch] of [['empty event ID',{eventId:''}],['bad event version',{eventVersion:0}],['bad envelope version',{baseEnvelopeVersion:0}],['negative state',{baseStateVersion:-1}],['fractional state',{baseStateVersion:0.5}],['negative zero',{baseStateVersion:-0}],['string state',{baseStateVersion:'0'}]]) {
  test(name, () => assert.equal(admit(input(proposal(), envelope(), patch)).reasonCode, 'INVALID_TRANSITION'));
}
test('stale state reaches reducer', () => { const env = envelope({ stateVersion: 2 }); const r = admit(input(proposal(), env, { baseStateVersion: 1 })); assert.equal(r.status, 'REDUCER_REJECTED'); assert.equal(r.reasonCode, 'STALE_BASE'); });
test('future state reaches reducer', () => { const r = admit(input(proposal(), envelope(), { baseStateVersion: 1 })); assert.equal(r.status, 'REDUCER_REJECTED'); assert.equal(r.reasonCode, 'FUTURE_BASE'); });
test('future envelope version reaches reducer', () => { const r = admit(input(proposal(), envelope(), { baseEnvelopeVersion: 2 })); assert.equal(r.reasonCode, 'FUTURE_BASE'); });
test('rejected envelope output is unaliased', () => { const env = envelope({ stateVersion: 2 }); const r = admit(input(proposal(), env, { baseStateVersion: 1 })); r.nextEnvelope.explicit.concerns.push({ value: 'x' }); assert.equal(env.explicit.concerns.length, 0); });
test('provenance and roots preserved without proof leakage', () => {
  const p = product(), r = admit(input(p)), event = r.transitionEvent;
  assert.deepEqual(event.provenance, { sourceType: 'CANONICAL_RESOLUTION', evidenceId: 'resolution-1', sourceTurnId: 'current-turn', sourceReference: 'fixture:resolution/A' });
  assert.deepEqual(event.evidenceIds, ['resolution-1']); assert.equal('evidence' in event, false); assert.equal('productResolutions' in event, false);
});
test('event and proposal do not alias', () => {
  const p = proposal('explicit.qualifiers', [{ key: 'dry', value: true, evidenceIds: ['user-1'] }]), r = admit(input(p));
  p.value[0].key = 'changed'; p.evidenceIds.push('changed'); assert.equal(r.transitionEvent.payload[0].key, 'dry'); assert.deepEqual(r.transitionEvent.evidenceIds, ['user-1']);
  r.transitionEvent.payload[0].key = 'event-change'; assert.equal(p.value[0].key, 'changed');
});
test('bare product identity rejected', () => assert.equal(admit(input(proposal('resolved.productFocus', 'invented'))).reasonCode, 'INVALID_PROPOSAL'));
test('governance proposal rejected', () => { const p = proposal('governance.authorizationStatus', 'AUTHORIZED'); p.evidence[0].fieldPath = p.fieldPath; assert.equal(admit(input(p)).reasonCode, 'INVALID_PROPOSAL'); });
test('recovery SET rejected', () => { const p = proposal(); p.provenance.sourceType = p.evidence[0].sourceType = 'LEGACY_TEXT_RECOVERY'; p.provenance.sourceTurnId = p.evidence[0].sourceTurnId = null; assert.equal(admit(input(p)).reasonCode, 'INVALID_PROPOSAL'); });
test('invalid CLEAR authority rejected', () => { const p = clear(); p.provenance.sourceType = p.evidence[0].sourceType = 'CANONICAL_RESOLUTION'; assert.equal(admit(input(p)).reasonCode, 'INVALID_PROPOSAL'); });
test('input immutability and deterministic result', () => {
  const x = input(), before = JSON.stringify(x), a = admit(x), b = admit(x); assert.equal(JSON.stringify(x), before); assert.deepEqual(a, b);
});
test('executable proposal invokes reducer exactly once', () => {
  let calls = 0;
  const real = require('./engine/conversation-decision-reducer.cjs').reduceDecisionEnvelope;
  const isolated = isolatedAdapter((...args) => { calls++; return real(...args); });
  assert.equal(isolated(input()).status, 'ADMITTED'); assert.equal(calls, 1);
});
test('UNRESOLVED and pre-admission rejection invoke reducer zero times', () => {
  let calls = 0;
  const isolated = isolatedAdapter(() => { calls++; throw new Error('must not execute'); });
  assert.equal(isolated(input(unresolved())).status, 'UNRESOLVED');
  const bad = proposal(); bad.value = 'not-canonical'; assert.equal(isolated(input(bad)).status, 'REJECTED');
  assert.equal(calls, 0);
});
test('repository isolation and purity', () => {
  const source = fs.readFileSync(adapterPath, 'utf8');
  assert.doesNotMatch(source, /Date\.now|new Date|Math\.random|randomUUID|node:fs|readFileSync|fetch\(|process\.env|eval\s*\(|new Function/);
  assert.doesNotMatch(source, /answer-router|answer-planner|answer-service|conversation-context|conversation-memory|server\.cjs|widget\.js|product-registry|catalog-search|page-context|recommendation-authorization|governance-evaluator/);
  for (const file of ['answer-router.cjs','answer-planner.cjs','answer-service.cjs','conversation-context.cjs','conversation-memory.cjs']) assert.equal(fs.readFileSync(path.join(__dirname, 'engine', file), 'utf8').includes('conversation-decision-proposal-adapter'), false, file);
  assert.equal(fs.readFileSync(path.join(__dirname, 'server.cjs'), 'utf8').includes('conversation-decision-proposal-adapter'), false);
  assert.equal(fs.readFileSync(path.join(__dirname, 'public/widget.js'), 'utf8').includes('conversation-decision-proposal-adapter'), false);
});

console.log(`PASS: ${count} R4A2C semantic proposal admission tests`);
