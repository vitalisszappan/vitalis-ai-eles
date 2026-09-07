'use strict';

// R4A-2B — Pure Conversation Decision Reducer.
// Single-event, pure, deterministic, immutable, in-memory, non-persistent, non-authorizing.
// Receives an already-validated current envelope plus one already-validated transition event
// and applies mechanical state mutation only. No routing, lookup, interpretation, ledger,
// replay ownership, batch reduction, persistence, network, or authorization calculation.

const {
  validateEnvelope,
  CLOSED_FIELD_PATHS,
  FIELD_CLEAR_STATUSES,
  FIELD_INVALIDATION_STATUSES
} = require('./conversation-decision-envelope-schema.cjs');
const {
  REDUCER_RESULTS,
  BASE_STATE_RESULTS,
  SINGLE_EVENT,
  REPLAY_UPSTREAM,
  DEPENDENT_INVALIDATION_ATOMIC
} = require('./conversation-decision-transition-schema.cjs');
const {
  validateTransitionEvent,
  validateTransitionBase
} = require('./conversation-decision-transition-validator.cjs');
const {
  FIELD_INVALIDATION_POLICY,
  AUTHORIZATION_EXECUTION_GROUP,
  getInvalidationTargets
} = require('./conversation-decision-field-policy.cjs');

const [APPLIED, NO_OP, REJECTED] = REDUCER_RESULTS;

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

// Deep structured clone (JSON-safe contract data only). No shared references between in/out.
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isObject(value)) {
    const out = {};
    for (const key of Object.keys(value)) out[key] = clone(value[key]);
    return out;
  }
  return value;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ak = Object.keys(a), bk = Object.keys(b);
    return ak.length === bk.length && ak.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

function splitPath(fieldPath) {
  const idx = fieldPath.indexOf('.');
  return [fieldPath.slice(0, idx), fieldPath.slice(idx + 1)];
}

// Contract-defined neutral representation per field payload kind.
function neutralValue(fieldPath) {
  if (fieldPath === 'governance.authorizedProductIds' || fieldPath === 'governance.authorizationEvidenceIds') return [];
  if (fieldPath === 'explicit.concerns' || fieldPath === 'explicit.applicationAreas' || fieldPath === 'explicit.products'
    || fieldPath === 'explicit.qualifiers' || fieldPath === 'explicit.safetySignals' || fieldPath === 'resolved.referencedProducts') return [];
  return null;
}

function setField(envelope, fieldPath, value) {
  const [section, key] = splitPath(fieldPath);
  envelope[section][key] = value;
}

function getField(envelope, fieldPath) {
  const [section, key] = splitPath(fieldPath);
  return envelope[section]?.[key];
}

function makeProvenance(event) {
  const entry = { evidenceId: event.provenance.evidenceId, sourceType: event.provenance.sourceType };
  if (event.provenance.sourceTurnId !== undefined) entry.sourceTurnId = event.provenance.sourceTurnId;
  if (event.provenance.sourceReference !== undefined) entry.sourceReference = event.provenance.sourceReference;
  entry.sourceTurnId = event.turnId;
  entry.fieldPath = event.fieldPath;
  return entry;
}

function makeClearDiagnostic(event, status) {
  return { fieldPath: event.fieldPath, status, reasonCode: event.reasonCode || 'EXPLICIT_CLEAR', sourceEventId: event.eventId, sourceFieldPath: event.fieldPath };
}

function makeConflictDiagnostic(event) {
  return { fieldPath: event.fieldPath, status: 'UNRESOLVED', candidateValues: clone(event.payload.candidates), reasonCode: event.reasonCode || 'EVIDENCE_CONFLICT', sourceEventId: event.eventId };
}

function makeInvalidationDiagnostic(targetFieldPath, event) {
  return { targetFieldPath, sourceFieldPath: event.fieldPath, sourceEventId: event.eventId, reasonCode: event.reasonCode || 'DEPENDENCY_INVALIDATED', invalidationStatus: 'NON_EXECUTABLE' };
}

function isNonExecutable(envelope, targetFieldPath) {
  const value = getField(envelope, targetFieldPath);
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === undefined;
}

function hasEquivalentInvalidation(envelope, targetFieldPath, event) {
  return envelope.fieldInvalidations.some((entry) => entry.targetFieldPath === targetFieldPath
    && entry.sourceFieldPath === event.fieldPath && entry.sourceEventId === event.eventId);
}

// Neutralize one concrete target and append exactly one concrete invalidation diagnostic.
function invalidateTarget(next, targetFieldPath, event) {
  setField(next, targetFieldPath, neutralValue(targetFieldPath));
  next.fieldInvalidations.push(makeInvalidationDiagnostic(targetFieldPath, event));
}

// Direct single lookup into FIELD_INVALIDATION_POLICY. No recursion/transitive/wildcard/prefix.
function applyDependentInvalidation(next, event) {
  const targets = FIELD_INVALIDATION_POLICY[event.fieldPath] || [];
  for (const target of targets) {
    if (!CLOSED_FIELD_PATHS.includes(target)) continue; // defensive: only concrete closed paths
    invalidateTarget(next, target, event);
  }
}

function baseResultToReason(result) {
  return BASE_STATE_RESULTS.includes(result) ? result : 'INVALID_BASE';
}

function reject(currentEnvelope, reasonCode) {
  return { result: REJECTED, reasonCode, nextEnvelope: clone(currentEnvelope) };
}

// Validators are total for near-valid input but may throw on structurally malformed input;
// the defensive boundary treats any throw or invalid result as REJECTED/INVALID_BASE.
function safelyValid(validator, value) {
  try { return validator(value).valid === true; } catch { return false; }
}

function reduceDecisionEnvelope(currentEnvelope, transitionEvent) {
  // Defensive boundary: reuse exported validators; never duplicate validation logic.
  if (!safelyValid(validateEnvelope, currentEnvelope)) return reject(currentEnvelope, 'INVALID_BASE');
  if (!safelyValid(validateTransitionEvent, transitionEvent)) return reject(currentEnvelope, 'INVALID_BASE');

  const base = validateTransitionBase(transitionEvent, currentEnvelope.stateVersion, currentEnvelope.envelopeVersion);
  if (base.result !== 'ELIGIBLE') return reject(currentEnvelope, baseResultToReason(base.result));

  const event = transitionEvent;
  const currentValue = getField(currentEnvelope, event.fieldPath);

  // UNSET: event-only, no persistent effect whatsoever.
  if (event.operation === 'UNSET') {
    return { result: NO_OP, reasonCode: event.reasonCode || null, nextEnvelope: clone(currentEnvelope) };
  }

  if (event.operation === 'SET') {
    if (deepEqual(currentValue, event.payload)) {
      return { result: NO_OP, reasonCode: event.reasonCode || null, nextEnvelope: clone(currentEnvelope) };
    }
    const next = clone(currentEnvelope);
    setField(next, event.fieldPath, clone(event.payload));
    next.provenance.push(makeProvenance(event));
    next.fieldConflicts = next.fieldConflicts.filter((entry) => entry.fieldPath !== event.fieldPath);
    applyDependentInvalidation(next, event);
    next.stateVersion = currentEnvelope.stateVersion + 1;
    return { result: APPLIED, reasonCode: event.reasonCode || null, nextEnvelope: next };
  }

  if (event.operation === 'CLEAR') {
    const alreadyCleared = isNonExecutable(currentEnvelope, event.fieldPath)
      && currentEnvelope.fieldClears.some((entry) => entry.fieldPath === event.fieldPath && entry.status === 'EXPLICIT_CLEAR' && entry.sourceEventId === event.eventId);
    if (alreadyCleared) {
      return { result: NO_OP, reasonCode: event.reasonCode || null, nextEnvelope: clone(currentEnvelope) };
    }
    const next = clone(currentEnvelope);
    setField(next, event.fieldPath, neutralValue(event.fieldPath));
    next.provenance.push(makeProvenance(event));
    next.fieldClears.push(makeClearDiagnostic(event, FIELD_CLEAR_STATUSES[0])); // EXPLICIT_CLEAR
    next.fieldConflicts = next.fieldConflicts.filter((entry) => entry.fieldPath !== event.fieldPath);
    applyDependentInvalidation(next, event);
    next.stateVersion = currentEnvelope.stateVersion + 1;
    return { result: APPLIED, reasonCode: event.reasonCode || null, nextEnvelope: next };
  }

  if (event.operation === 'CONFLICT') {
    const candidates = event.payload.candidates;
    const existing = currentEnvelope.fieldConflicts.find((entry) => entry.fieldPath === event.fieldPath && entry.status === 'UNRESOLVED');
    const equivalent = existing && deepEqual([...existing.candidateValues].sort(), [...candidates].sort());
    if (equivalent) {
      return { result: NO_OP, reasonCode: event.reasonCode || null, nextEnvelope: clone(currentEnvelope) };
    }
    // Fail closed: do NOT promote candidates into the executable field value.
    const next = clone(currentEnvelope);
    next.fieldConflicts = next.fieldConflicts.filter((entry) => entry.fieldPath !== event.fieldPath);
    next.fieldConflicts.push(makeConflictDiagnostic(event));
    applyDependentInvalidation(next, event);
    next.stateVersion = currentEnvelope.stateVersion + 1;
    return { result: APPLIED, reasonCode: event.reasonCode || 'EVIDENCE_CONFLICT', nextEnvelope: next };
  }

  if (event.operation === 'INVALIDATE') {
    const targets = event.payload.invalidatesFields.filter((target) => getInvalidationTargets(event.fieldPath).includes(target));
    const allAlready = targets.every((target) => isNonExecutable(currentEnvelope, target) && hasEquivalentInvalidation(currentEnvelope, target, event));
    if (targets.length > 0 && allAlready) {
      return { result: NO_OP, reasonCode: event.reasonCode || null, nextEnvelope: clone(currentEnvelope) };
    }
    const next = clone(currentEnvelope);
    for (const target of targets) invalidateTarget(next, target, event);
    next.stateVersion = currentEnvelope.stateVersion + 1;
    return { result: APPLIED, reasonCode: event.reasonCode || 'DEPENDENCY_INVALIDATED', nextEnvelope: next };
  }

  // Unreachable for validated events; fail closed.
  return reject(currentEnvelope, 'INVALID_BASE');
}

module.exports = {
  reduceDecisionEnvelope,
  REDUCER_RESULTS,
  BASE_STATE_RESULTS,
  SINGLE_EVENT,
  REPLAY_UPSTREAM,
  DEPENDENT_INVALIDATION_ATOMIC,
  AUTHORIZATION_EXECUTION_GROUP,
  FIELD_INVALIDATION_STATUSES
};
