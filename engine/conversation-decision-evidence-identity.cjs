'use strict';

// R4A2J — pure, dormant admission of server-owned evidence identity for an
// already valid R4A2I observation. Admission establishes identity only.
const {
  validateSemanticEvidenceObservation,
  RESOURCE_LIMITS: OBSERVATION_RESOURCE_LIMITS
} = require('./conversation-decision-semantic-evidence-observation.cjs');

const ADMISSION_VERSION = 1;
const EVIDENCE_VERSION = 1;
const ADMISSION_STATUSES = Object.freeze(['ADMITTED', 'EXACT_REPLAY', 'REJECTED']);
const ADMISSION_REASON_CODES = Object.freeze([
  'RESOURCE_LIMIT_EXCEEDED', 'INVALID_INPUT', 'INVALID_OBSERVATION',
  'INVALID_EVIDENCE_ID', 'INVALID_ADMISSION_CONTEXT',
  'MISSING_DEPENDENCY_BINDING', 'CONFLICTING_DEPENDENCY_BINDING',
  'OBSERVATION_IDENTITY_COLLISION', 'EVIDENCE_IDENTITY_COLLISION',
  'CROSS_CONVERSATION_BINDING', 'REPLAY_MISMATCH'
]);
const FAILURE_PRECEDENCE = ADMISSION_REASON_CODES;
const ADMISSION_RESOURCE_LIMITS = Object.freeze({
  MAX_DEPENDENCY_BINDINGS: OBSERVATION_RESOURCE_LIMITS.MAX_DEPENDENCIES_PER_OBSERVATION,
  MAX_EXISTING_ADMISSIONS: OBSERVATION_RESOURCE_LIMITS.MAX_HISTORICAL_OBSERVATIONS,
  MAX_NESTING_DEPTH: OBSERVATION_RESOURCE_LIMITS.MAX_NESTING_DEPTH,
  MAX_OWN_KEYS: OBSERVATION_RESOURCE_LIMITS.MAX_OWN_KEYS,
  MAX_CAPTURED_NODES: OBSERVATION_RESOURCE_LIMITS.MAX_CAPTURED_NODES,
  MAX_CAPTURED_STRING_UTF16: OBSERVATION_RESOURCE_LIMITS.MAX_CAPTURED_STRING_UTF16
});

const INPUT_KEYS = Object.freeze([
  'admissionVersion', 'observation', 'validationContext', 'evidenceId',
  'dependencyBindings', 'existingAdmissions'
]);
const BINDING_KEYS = Object.freeze(['observationReference', 'evidenceId']);
const NODE_KEYS = Object.freeze([
  'evidenceVersion', 'evidenceId', 'observationReference', 'conversationId',
  'turnId', 'supportEvidenceIds', 'observation'
]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function has(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exactKeys(value, keys) {
  return plainObject(value) && Object.keys(value).length === keys.length
    && keys.every((key) => has(value, key));
}
function uuid(value) { return typeof value === 'string' && value.length === 36 && UUID_V4.test(value); }

class CaptureFailure extends Error {
  constructor(resource = false) { super(resource ? 'resource' : 'invalid'); this.resource = resource; }
}
function capture(raw) {
  const budget = { nodes: 0, strings: 0, ancestors: new Set() };
  function visit(value, depth) {
    if (++budget.nodes > ADMISSION_RESOURCE_LIMITS.MAX_CAPTURED_NODES
      || depth > ADMISSION_RESOURCE_LIMITS.MAX_NESTING_DEPTH) throw new CaptureFailure(true);
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      if (typeof value === 'string'
        && (budget.strings += value.length) > ADMISSION_RESOURCE_LIMITS.MAX_CAPTURED_STRING_UTF16) throw new CaptureFailure(true);
      if (typeof value === 'number' && !Number.isFinite(value)) throw new CaptureFailure(false);
      return value;
    }
    if (typeof value !== 'object' || budget.ancestors.has(value)) throw new CaptureFailure(false);
    let proto, keys, descriptors;
    try {
      proto = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
      if (!Array.isArray(value) && keys.length > ADMISSION_RESOURCE_LIMITS.MAX_OWN_KEYS) throw new CaptureFailure(true);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch (error) {
      if (error instanceof CaptureFailure) throw error;
      throw new CaptureFailure(false);
    }
    if (keys.some((key) => typeof key !== 'string')) throw new CaptureFailure(false);
    budget.ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        if (proto !== Array.prototype) throw new CaptureFailure(false);
        const lengthDescriptor = descriptors.length;
        if (!lengthDescriptor || !has(lengthDescriptor, 'value') || !Number.isSafeInteger(lengthDescriptor.value)
          || lengthDescriptor.value < 0 || lengthDescriptor.value > OBSERVATION_RESOURCE_LIMITS.MAX_RAW_TEXT_BINDINGS) {
          throw new CaptureFailure(true);
        }
        const length = lengthDescriptor.value;
        const indexes = keys.filter((key) => key !== 'length');
        if (indexes.length !== length) throw new CaptureFailure(false);
        const output = new Array(length);
        for (let index = 0; index < length; index++) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !descriptor.enumerable || !has(descriptor, 'value')) throw new CaptureFailure(false);
          output[index] = visit(descriptor.value, depth + 1);
        }
        return output;
      }
      if (![Object.prototype, null].includes(proto)) throw new CaptureFailure(false);
      const output = {};
      for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !has(descriptor, 'value')) throw new CaptureFailure(false);
        output[key] = visit(descriptor.value, depth + 1);
      }
      return output;
    } finally { budget.ancestors.delete(value); }
  }
  return visit(raw, 1);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function lexical(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function observationToken(observation) {
  const normalized = { ...observation };
  normalized.dependencies = [...observation.dependencies].sort();
  normalized.sources = observation.sources.map((source) => ({
    ...source,
    locators: [...source.locators].sort((left, right) => lexical(canonical(left), canonical(right)))
  })).sort((left, right) => lexical(canonical(left), canonical(right)));
  return canonical(normalized);
}
function result(status, reasonCode, evidence = null) {
  return { status, reasonCode, evidence, errors: reasonCode ? [reasonCode] : [] };
}
function rejected(reasonCode) { return result('REJECTED', reasonCode); }
function firstFailure(failures) {
  return FAILURE_PRECEDENCE.find((reasonCode) => failures.has(reasonCode)) || null;
}

function structurallyValidNode(node) {
  return exactKeys(node, NODE_KEYS)
    && node.evidenceVersion === EVIDENCE_VERSION
    && uuid(node.evidenceId) && uuid(node.observationReference)
    && typeof node.conversationId === 'string' && node.conversationId.length > 0
    && uuid(node.turnId)
    && Array.isArray(node.supportEvidenceIds)
    && node.supportEvidenceIds.length <= ADMISSION_RESOURCE_LIMITS.MAX_DEPENDENCY_BINDINGS
    && node.supportEvidenceIds.every(uuid)
    && new Set(node.supportEvidenceIds).size === node.supportEvidenceIds.length
    && plainObject(node.observation)
    && node.observation.observationReference === node.observationReference
    && node.observation.correlation?.conversationId === node.conversationId
    && node.observation.correlation?.turnId === node.turnId;
}

function admitSemanticEvidence(rawInput) {
  let input;
  try { input = capture(rawInput); } catch (error) {
    return rejected(error instanceof CaptureFailure && error.resource ? 'RESOURCE_LIMIT_EXCEEDED' : 'INVALID_INPUT');
  }
  if (!exactKeys(input, INPUT_KEYS) || input.admissionVersion !== ADMISSION_VERSION) return rejected('INVALID_INPUT');
  if (!Array.isArray(input.dependencyBindings) || !Array.isArray(input.existingAdmissions)) {
    return rejected('INVALID_ADMISSION_CONTEXT');
  }
  if (input.dependencyBindings.length > ADMISSION_RESOURCE_LIMITS.MAX_DEPENDENCY_BINDINGS
    || input.existingAdmissions.length > ADMISSION_RESOURCE_LIMITS.MAX_EXISTING_ADMISSIONS) {
    return rejected('RESOURCE_LIMIT_EXCEEDED');
  }

  let checked;
  try {
    checked = validateSemanticEvidenceObservation({
      observation: input.observation,
      validationContext: input.validationContext
    });
  } catch { return rejected('INVALID_OBSERVATION'); }
  if (!checked || checked.status !== 'VALID') {
    return rejected(checked?.reasonCode === 'RESOURCE_LIMIT_EXCEEDED' ? 'RESOURCE_LIMIT_EXCEEDED' : 'INVALID_OBSERVATION');
  }
  const observation = checked.observation;
  if (!uuid(input.evidenceId)) return rejected('INVALID_EVIDENCE_ID');
  const conversationId = observation.correlation.conversationId;
  const turnId = observation.correlation.turnId;
  const failures = new Set();

  const admissionsByObservation = new Map();
  const admissionsByEvidence = new Map();
  for (const admission of input.existingAdmissions) {
    if (!structurallyValidNode(admission)) { failures.add('INVALID_ADMISSION_CONTEXT'); continue; }
    const priorObservation = admissionsByObservation.get(admission.observationReference);
    const priorEvidence = admissionsByEvidence.get(admission.evidenceId);
    if (priorObservation && priorObservation.evidenceId !== admission.evidenceId) failures.add('OBSERVATION_IDENTITY_COLLISION');
    if (priorEvidence && priorEvidence.observationReference !== admission.observationReference) failures.add('EVIDENCE_IDENTITY_COLLISION');
    if (priorObservation || priorEvidence) failures.add('INVALID_ADMISSION_CONTEXT');
    admissionsByObservation.set(admission.observationReference, admission);
    admissionsByEvidence.set(admission.evidenceId, admission);
  }

  const bindings = new Map();
  const evidenceBindings = new Map();
  for (const binding of input.dependencyBindings) {
    if (!exactKeys(binding, BINDING_KEYS) || !uuid(binding.observationReference) || !uuid(binding.evidenceId)) {
      failures.add('INVALID_ADMISSION_CONTEXT'); continue;
    }
    const priorEvidence = bindings.get(binding.observationReference);
    const priorObservation = evidenceBindings.get(binding.evidenceId);
    if (priorEvidence !== undefined || priorObservation !== undefined) {
      failures.add('CONFLICTING_DEPENDENCY_BINDING');
    }
    bindings.set(binding.observationReference, binding.evidenceId);
    evidenceBindings.set(binding.evidenceId, binding.observationReference);
  }

  const dependencySet = new Set(observation.dependencies);
  for (const dependency of observation.dependencies) {
    const boundEvidence = bindings.get(dependency);
    if (!boundEvidence) { failures.add('MISSING_DEPENDENCY_BINDING'); continue; }
    const admitted = admissionsByObservation.get(dependency);
    if (!admitted || admitted.evidenceId !== boundEvidence) {
      failures.add('CONFLICTING_DEPENDENCY_BINDING'); continue;
    }
    if (admitted.conversationId !== conversationId) failures.add('CROSS_CONVERSATION_BINDING');
  }
  for (const dependency of bindings.keys()) {
    if (!dependencySet.has(dependency)) failures.add('INVALID_ADMISSION_CONTEXT');
  }

  const sameObservation = admissionsByObservation.get(observation.observationReference);
  const sameEvidence = admissionsByEvidence.get(input.evidenceId);
  if (sameObservation && sameObservation.evidenceId !== input.evidenceId) failures.add('OBSERVATION_IDENTITY_COLLISION');
  if (sameEvidence && sameEvidence.observationReference !== observation.observationReference) failures.add('EVIDENCE_IDENTITY_COLLISION');
  if (sameObservation && sameObservation.conversationId !== conversationId) failures.add('CROSS_CONVERSATION_BINDING');

  const supportEvidenceIds = observation.dependencies.map((dependency) => bindings.get(dependency)).filter(Boolean).sort();
  const node = {
    evidenceVersion: EVIDENCE_VERSION,
    evidenceId: input.evidenceId,
    observationReference: observation.observationReference,
    conversationId,
    turnId,
    supportEvidenceIds,
    observation
  };
  if (sameObservation && sameObservation.evidenceId === input.evidenceId
    && sameObservation.conversationId === conversationId) {
    let replayObservation;
    try {
      replayObservation = validateSemanticEvidenceObservation({
        observation: sameObservation.observation,
        validationContext: input.validationContext
      });
    } catch { replayObservation = null; }
    if (!replayObservation || replayObservation.status !== 'VALID'
      || observationToken(replayObservation.observation) !== observationToken(observation)
      || canonical([...sameObservation.supportEvidenceIds].sort()) !== canonical(supportEvidenceIds)) {
      failures.add('REPLAY_MISMATCH');
    }
  }

  const reasonCode = firstFailure(failures);
  if (reasonCode) return rejected(reasonCode);
  const ownedNode = capture(node);
  return result(sameObservation ? 'EXACT_REPLAY' : 'ADMITTED', null, ownedNode);
}

module.exports = {
  admitSemanticEvidence,
  ADMISSION_VERSION,
  EVIDENCE_VERSION,
  ADMISSION_STATUSES,
  ADMISSION_REASON_CODES,
  ADMISSION_RESOURCE_LIMITS
};
