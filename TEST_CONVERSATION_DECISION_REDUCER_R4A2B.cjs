'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateEnvelope: validateEnvelopeContract, AUTHORIZATION_STATUSES } = require('./engine/conversation-decision-envelope-schema.cjs');
const { validateTransitionEvent } = require('./engine/conversation-decision-transition-validator.cjs');
const policy = require('./engine/conversation-decision-field-policy.cjs');
const { reduceDecisionEnvelope, REDUCER_RESULTS, AUTHORIZATION_EXECUTION_GROUP } = require('./engine/conversation-decision-reducer.cjs');

const AUTH_GROUP = policy.AUTHORIZATION_EXECUTION_GROUP;
assert.equal(AUTH_GROUP.length, 14);

function minimal(overrides = {}) {
  return {
    envelopeVersion: 1, stateVersion: 0, conversationId: 'session-1', turnId: 'turn-1', parentTurnId: null, createdAt: '2026-09-06T00:00:00.000Z',
    input: { rawText: 'Mit keresel?', normalizedText: 'mit keresel', source: 'user', locale: 'hu-HU' },
    explicit: { concerns: [], applicationAreas: [], products: [], goal: null, qualifiers: [], complaintState: null, safetySignals: [] },
    resolved: { productFocus: null, referencedProducts: [], problemDomain: null, concernContext: null, applicationArea: null, requestedProductType: null, commerceIntent: null, complaintIntent: null, safetyClass: null },
    derived: { answerIntent: null, route: null, answerTarget: null, fallbackType: null, ownershipState: 'UNRESOLVED', isolationBoundary: null, ambiguity: null, evidenceIds: [] },
    governance: { scopeId: null, scopeVersion: null, criterionSetId: null, criterionSetVersion: null, bindingId: null, bindingVersion: null, reviewRecordId: null, wordingArtifactId: null, wordingArtifactVersion: null, wordingLocale: null, authorizationStatus: null, authorizationReason: null, authorizedProductIds: [], authorizationEvidenceIds: [] },
    provenance: [], fieldClears: [], fieldConflicts: [], fieldInvalidations: [],
    invalidation: { invalidatesTurnIds: [], invalidatesFields: [], reason: null, boundaryType: null }, ...overrides
  };
}

function authorizedGovernance() {
  return { scopeId: 'scope-1', scopeVersion: 'sv-1', criterionSetId: 'cs-1', criterionSetVersion: 'csv-1', bindingId: 'b-1', bindingVersion: 'bv-1', reviewRecordId: 'rr-1', wordingArtifactId: 'wa-1', wordingArtifactVersion: 'wav-1', wordingLocale: 'hu-HU', authorizationStatus: 'AUTHORIZED', authorizationReason: 'ok', authorizedProductIds: ['p1'], authorizationEvidenceIds: ['e1'] };
}

function event(overrides = {}) {
  return { contractVersion: 1, eventId: 'event-1', conversationId: 'session-1', turnId: 'turn-2', fieldPath: 'resolved.applicationArea', operation: 'SET', eventType: 'FIELD_TRANSITION', eventVersion: 1, stateVersion: 0, baseEnvelopeVersion: 1, baseStateVersion: 0, provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'e-1' }, payload: 'neck', evidenceIds: ['e-1'], reasonCode: 'CURRENT_TURN_REPLACEMENT', ...overrides };
}

function splitPath(p) { const i = p.indexOf('.'); return [p.slice(0, i), p.slice(i + 1)]; }
function getField(env, p) { const [s, k] = splitPath(p); return env[s] ? env[s][k] : undefined; }
// AUTHORIZATION_EXECUTION_GROUP holds bare governance member names; prefix for path access.
function govField(env, f) { return env.governance[f]; }
function authExecutable(env) { return AUTH_GROUP.some((f) => { const v = govField(env, f); return Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined; }); }

// ---------- BASE SEMANTICS ----------
assert.equal(reduceDecisionEnvelope(minimal(), event()).result, 'APPLIED');
assert.equal(reduceDecisionEnvelope(minimal(), event({ baseStateVersion: -1 })).result, 'REJECTED');
assert.equal(reduceDecisionEnvelope(minimal(), event({ baseStateVersion: -1 })).reasonCode, 'INVALID_BASE');
assert.equal(reduceDecisionEnvelope(minimal({ stateVersion: 2 }), event({ baseStateVersion: 1 })).reasonCode, 'STALE_BASE');
assert.equal(reduceDecisionEnvelope(minimal(), event({ baseStateVersion: 1 })).reasonCode, 'FUTURE_BASE');
// malformed current envelope / event -> defensive INVALID_BASE, unchanged
assert.equal(reduceDecisionEnvelope({ bad: true }, event()).reasonCode, 'INVALID_BASE');
assert.equal(reduceDecisionEnvelope(minimal(), { contractVersion: 1 }).reasonCode, 'INVALID_BASE');
{
  const env = minimal({ stateVersion: 3 });
  const r = reduceDecisionEnvelope(env, event({ baseStateVersion: 1 }));
  assert.equal(r.nextEnvelope.stateVersion, 3); // REJECTED unchanged
}

// ---------- UNSET ----------
{
  const env = minimal();
  const r = reduceDecisionEnvelope(env, event({ operation: 'UNSET', payload: null }));
  assert.equal(r.result, 'NO_OP');
  assert.equal(r.nextEnvelope.stateVersion, 0);
  assert.equal(r.nextEnvelope.fieldClears.length, 0);
  assert.equal(r.nextEnvelope.provenance.length, 0);
  assert.equal(r.nextEnvelope.fieldInvalidations.length, 0);
  assert.deepEqual(r.nextEnvelope.resolved, env.resolved);
}

// ---------- SET ----------
{
  const env = minimal();
  const r = reduceDecisionEnvelope(env, event());
  assert.equal(r.result, 'APPLIED');
  assert.equal(r.nextEnvelope.stateVersion, 1); // max +1
  assert.equal(r.nextEnvelope.resolved.applicationArea, 'neck');
  assert.equal(r.nextEnvelope.provenance.length, 1);
  assert.equal(r.nextEnvelope.provenance[0].sourceType, 'USER_EXPLICIT');
  assert.equal(r.nextEnvelope.provenance[0].fieldPath, 'resolved.applicationArea');
  // applicationArea -> full 14 auth teardown
  assert.equal(r.nextEnvelope.fieldInvalidations.length, 14);
  // identical SET -> NO_OP, unchanged
  const r2 = reduceDecisionEnvelope(r.nextEnvelope, event({ baseStateVersion: 1 }));
  assert.equal(r2.result, 'NO_OP');
  assert.equal(r2.nextEnvelope.stateVersion, 1);
}

// ---------- CLEAR ----------
{
  const env = minimal({ resolved: { ...minimal().resolved, applicationArea: 'scalp' }, stateVersion: 1 });
  const r = reduceDecisionEnvelope(env, event({ operation: 'CLEAR', payload: null, baseStateVersion: 1, reasonCode: 'EXPLICIT_CLEAR' }));
  assert.equal(r.result, 'APPLIED');
  assert.equal(r.nextEnvelope.resolved.applicationArea, null);
  assert.equal(r.nextEnvelope.fieldClears.length, 1);
  assert.equal(r.nextEnvelope.fieldClears[0].status, 'EXPLICIT_CLEAR');
  assert.equal(r.nextEnvelope.stateVersion, 2);
  // repeated CLEAR with same eventId + already neutral -> NO_OP
  const r2 = reduceDecisionEnvelope(r.nextEnvelope, event({ operation: 'CLEAR', payload: null, baseStateVersion: 2, reasonCode: 'EXPLICIT_CLEAR' }));
  assert.equal(r2.result, 'NO_OP');
  assert.equal(r2.nextEnvelope.stateVersion, 2);
}

// ---------- CONFLICT (fail closed) ----------
{
  const env = minimal();
  const r = reduceDecisionEnvelope(env, event({ operation: 'CONFLICT', payload: { candidates: ['scalp', 'neck'] }, reasonCode: 'EVIDENCE_CONFLICT' }));
  assert.equal(r.result, 'APPLIED'); // valid conflict is APPLIED, not failure
  assert.equal(r.nextEnvelope.resolved.applicationArea, null); // candidates NOT promoted
  assert.equal(r.nextEnvelope.fieldConflicts.length, 1);
  assert.equal(r.nextEnvelope.fieldConflicts[0].status, 'UNRESOLVED');
  assert.equal(r.nextEnvelope.stateVersion, 1);
  // repeated equivalent CONFLICT (order-insensitive) -> NO_OP
  const r2 = reduceDecisionEnvelope(r.nextEnvelope, event({ operation: 'CONFLICT', payload: { candidates: ['neck', 'scalp'] }, baseStateVersion: 1, reasonCode: 'EVIDENCE_CONFLICT' }));
  assert.equal(r2.result, 'NO_OP');
  assert.equal(r2.nextEnvelope.stateVersion, 1);
}

// ---------- INVALIDATE ----------
{
  const env = minimal({ stateVersion: 1, governance: authorizedGovernance() });
  const r = reduceDecisionEnvelope(env, event({ operation: 'INVALIDATE', fieldPath: 'resolved.applicationArea', payload: { invalidatesFields: ['governance.authorizationStatus', 'governance.authorizedProductIds'] }, reasonCode: 'DEPENDENCY_INVALIDATED', baseStateVersion: 1 }));
  assert.equal(r.result, 'APPLIED');
  assert.equal(r.nextEnvelope.governance.authorizationStatus, null);
  assert.deepEqual(r.nextEnvelope.governance.authorizedProductIds, []);
  assert.equal(r.nextEnvelope.fieldInvalidations.length, 2); // one entry per concrete target
  assert.equal(r.nextEnvelope.fieldInvalidations.every((x) => x.invalidationStatus === 'NON_EXECUTABLE'), true);
  assert.equal(r.nextEnvelope.stateVersion, 2);
}

// ---------- ATOMIC 14-FIELD AUTH TEARDOWN (one reduction, one increment) ----------
{
  const env = minimal({ stateVersion: 0, governance: authorizedGovernance(), resolved: { ...minimal().resolved, applicationArea: 'scalp' } });
  assert.equal(authExecutable(env), true);
  const r = reduceDecisionEnvelope(env, event()); // SET applicationArea=neck
  assert.equal(r.result, 'APPLIED');
  assert.equal(r.nextEnvelope.stateVersion, 1); // exactly one increment for the whole reduction
  assert.equal(authExecutable(r.nextEnvelope), false); // no partial executable authorization
  for (const f of AUTH_GROUP) {
    const v = govField(r.nextEnvelope, f);
    assert.equal(Array.isArray(v) ? v.length === 0 : v === null, true, f);
  }
}

// ---------- PARTIAL TARGET SETS (12 and 4) ----------
{
  // requestedProductType -> 12 (excludes scopeId, scopeVersion)
  const env = minimal({ governance: authorizedGovernance(), resolved: { ...minimal().resolved, requestedProductType: 'shampoo' } });
  const r = reduceDecisionEnvelope(env, event({ fieldPath: 'resolved.requestedProductType', payload: 'cream' }));
  assert.equal(r.result, 'APPLIED');
  assert.equal(r.nextEnvelope.governance.authorizationStatus, null);
  assert.equal(r.nextEnvelope.governance.scopeId, 'scope-1'); // not in 12-target set -> untouched
  assert.equal(r.nextEnvelope.governance.scopeVersion, 'sv-1');
  assert.equal(r.nextEnvelope.fieldInvalidations.length, 12);
}
{
  // ownershipState -> 4 executable auth fields only
  const env = minimal({ governance: authorizedGovernance(), derived: { ...minimal().derived, ownershipState: 'RECOMMENDATION' } });
  const r = reduceDecisionEnvelope(env, event({ fieldPath: 'derived.ownershipState', payload: 'NEUTRAL_PRODUCT_FACT', provenance: { sourceType: 'PROBLEM_DOMAIN_DECISION', evidenceId: 'e-o' } }));
  assert.equal(r.result, 'APPLIED');
  assert.equal(r.nextEnvelope.fieldInvalidations.length, 4);
  assert.equal(r.nextEnvelope.governance.authorizationStatus, null);
  assert.equal(r.nextEnvelope.governance.scopeId, 'scope-1'); // untouched
}

// ---------- NO OVER-INVALIDATION / NO TRANSITIVE ----------
{
  // requestedProductType invalidation must NOT cascade into productFocus or concernContext
  const env = minimal({ resolved: { ...minimal().resolved, requestedProductType: 'shampoo', concernContext: 'psoriasis', productFocus: { productId: 'x' } } });
  const r = reduceDecisionEnvelope(env, event({ fieldPath: 'resolved.requestedProductType', payload: 'balzsam' }));
  assert.equal(r.nextEnvelope.resolved.requestedProductType, 'balzsam');
  assert.equal(r.nextEnvelope.resolved.concernContext, 'psoriasis'); // independent, untouched
  assert.deepEqual(r.nextEnvelope.resolved.productFocus, { productId: 'x' }); // untouched
  // every invalidation target is a concrete governance path, none recursive
  assert.equal(r.nextEnvelope.fieldInvalidations.every((x) => x.targetFieldPath.startsWith('governance.')), true);
}

// ---------- 8 ACCEPTANCE CASES ----------
// 1. psoriasis + scalp + shampoo -> neck
{
  const env = minimal({ stateVersion: 1, governance: authorizedGovernance(), explicit: { ...minimal().explicit, concerns: [{ value: 'psoriasis', evidenceIds: ['p1'] }] }, resolved: { ...minimal().resolved, concernContext: 'psoriasis', applicationArea: 'scalp', requestedProductType: 'shampoo' } });
  const r = reduceDecisionEnvelope(env, event({ baseStateVersion: 1 }));
  assert.equal(r.nextEnvelope.resolved.applicationArea, 'neck');
  assert.equal(r.nextEnvelope.resolved.concernContext, 'psoriasis'); // unchanged
  assert.equal(r.nextEnvelope.resolved.requestedProductType, 'shampoo'); // unchanged
  assert.equal(authExecutable(r.nextEnvelope), false); // auth invalidated
}
// 2. shampoo -> cream (no productFocus invention)
{
  const env = minimal({ resolved: { ...minimal().resolved, requestedProductType: 'shampoo', productFocus: null } });
  const r = reduceDecisionEnvelope(env, event({ fieldPath: 'resolved.requestedProductType', payload: 'cream' }));
  assert.equal(r.nextEnvelope.resolved.requestedProductType, 'cream');
  assert.equal(r.nextEnvelope.resolved.productFocus, null); // not invented
}
// 3. unresolved vs canonical "the other" (reducer does NOT interpret; applies supplied resolved field)
{
  const env = minimal({ resolved: { ...minimal().resolved, productFocus: null } });
  const r = reduceDecisionEnvelope(env, event({ fieldPath: 'resolved.productFocus', payload: 'product_A', provenance: { sourceType: 'CANONICAL_RESOLUTION', evidenceId: 'e-c' } }));
  assert.equal(r.nextEnvelope.resolved.productFocus, 'product_A'); // only supplied field changes
  assert.equal(r.nextEnvelope.resolved.requestedProductType, null); // untouched
}
// 5. legacy recovery -> explicit current user value
{
  // recovery provenance cannot author a SET (validator rejects); only USER_EXPLICIT applies
  assert.equal(validateTransitionEvent(event({ provenance: { sourceType: 'LEGACY_TEXT_RECOVERY', evidenceId: 'e-l' } })).valid, false);
  const env = minimal();
  const r = reduceDecisionEnvelope(env, event({ payload: 'neck', provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'e-u' } }));
  assert.equal(r.nextEnvelope.provenance[0].sourceType, 'USER_EXPLICIT'); // current user value, not recovery
}
// 6. historical MEDICAL/SAFETY -> neutral product fact
{
  const env = minimal({ governance: authorizedGovernance(), derived: { ...minimal().derived, ownershipState: 'MEDICAL' }, resolved: { ...minimal().resolved, safetyClass: 'medical_escalation' } });
  const r = reduceDecisionEnvelope(env, event({ fieldPath: 'derived.ownershipState', payload: 'NEUTRAL_PRODUCT_FACT', provenance: { sourceType: 'PROBLEM_DOMAIN_DECISION', evidenceId: 'e-m' } }));
  assert.equal(r.nextEnvelope.derived.ownershipState, 'NEUTRAL_PRODUCT_FACT');
  assert.equal(r.nextEnvelope.resolved.safetyClass, 'medical_escalation'); // historical evidence retained, not converted to permission
  assert.equal(r.nextEnvelope.governance.authorizationStatus, null); // executable auth invalidated
}
// 7. psoriasis + dry qualifier (qualifier != concern)
{
  const env = minimal({ resolved: { ...minimal().resolved, concernContext: 'psoriasis' } });
  const r = reduceDecisionEnvelope(env, event({ fieldPath: 'explicit.qualifiers', payload: [{ key: 'dry', value: true, evidenceIds: ['e-d'] }] }));
  assert.equal(r.nextEnvelope.explicit.qualifiers[0].key, 'dry');
  assert.equal(r.nextEnvelope.resolved.concernContext, 'psoriasis'); // unchanged
  assert.equal(r.nextEnvelope.explicit.concerns.some((c) => c.value === 'dry_skin'), false); // no dry_skin synthesized
}
// 8. shampoo -> balm (productFocus untouched)
{
  const env = minimal({ resolved: { ...minimal().resolved, requestedProductType: 'shampoo', productFocus: null } });
  const r = reduceDecisionEnvelope(env, event({ fieldPath: 'resolved.requestedProductType', payload: 'balzsam' }));
  assert.equal(r.nextEnvelope.resolved.requestedProductType, 'balzsam');
  assert.equal(r.nextEnvelope.resolved.productFocus, null); // no product identity invented
}

// ---------- FIELD INDEPENDENCE ----------
assert.notEqual('neck', 'scalp');
assert.notEqual('requestedProductType', 'productFocus');

// ---------- IMMUTABILITY ----------
{
  const env = minimal({ governance: authorizedGovernance() });
  const envSnapshot = JSON.stringify(env);
  const ev = event();
  const evSnapshot = JSON.stringify(ev);
  const r = reduceDecisionEnvelope(env, ev);
  assert.equal(JSON.stringify(env), envSnapshot); // input envelope unchanged
  assert.equal(JSON.stringify(ev), evSnapshot); // input event unchanged
  // mutate output; input must not change on touched mutable surfaces
  r.nextEnvelope.governance.authorizedProductIds.push('HACK');
  r.nextEnvelope.provenance.push({ evidenceId: 'HACK' });
  r.nextEnvelope.fieldInvalidations.push({});
  assert.equal(JSON.stringify(env), envSnapshot);
  assert.equal(env.governance.authorizedProductIds.length, 1); // original intact
}

// ---------- DETERMINISM ----------
{
  const env = minimal({ governance: authorizedGovernance() });
  const a = reduceDecisionEnvelope(env, event());
  const b = reduceDecisionEnvelope(env, event());
  assert.deepEqual(a, b);
}

// ---------- VALIDATED OUTPUT ----------
{
  const r = reduceDecisionEnvelope(minimal(), event());
  assert.equal(validateEnvelopeContract(r.nextEnvelope).valid, true);
}

// ---------- DORMANCY ----------
{
  const reducerSource = fs.readFileSync(path.join(__dirname, 'engine', 'conversation-decision-reducer.cjs'), 'utf8');
  assert.equal(/Date\.now|new Date|Math\.random|node:fs|readFileSync|fetch\(|require\(['"]net|answer-service|answer-router|server\.cjs/.test(reducerSource), false, 'reducer must be pure/no I/O');
  for (const file of ['answer-service.cjs', 'answer-router.cjs', 'answer-planner.cjs', 'conversation-context.cjs', 'conversation-memory.cjs']) {
    assert.equal(fs.readFileSync(path.join(__dirname, 'engine', file), 'utf8').includes('conversation-decision-reducer'), false, file);
  }
  assert.equal(fs.readFileSync(path.join(__dirname, 'server.cjs'), 'utf8').includes('conversation-decision-reducer'), false, 'server.cjs');
}

console.log('Conversation Decision Reducer R4A2B: PASS');
