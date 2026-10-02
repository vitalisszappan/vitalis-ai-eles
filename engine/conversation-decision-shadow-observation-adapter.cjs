'use strict';

// First-shadow adapter: translate only two already-computed live routing facts
// into authority-neutral R4A2I observations. No recognizer runs here.
const {
  validateDecisionCorrelation
} = require('./conversation-decision-correlation-contract.cjs');
const {
  validateSemanticEvidenceObservation,
  PRODUCER_VERSIONS,
  RESOURCE_LIMITS: OBSERVATION_RESOURCE_LIMITS
} = require('./conversation-decision-semantic-evidence-observation.cjs');

const SHADOW_OBSERVATION_ADAPTER_VERSION = 1;
const SHADOW_OBSERVATION_STATUSES = Object.freeze(['PRODUCED', 'NO_OBSERVATION', 'REJECTED']);
const SHADOW_OBSERVATION_REASON_CODES = Object.freeze([
  'RESOURCE_LIMIT_EXCEEDED', 'INVALID_INPUT', 'INVALID_CORRELATION',
  'INVALID_ROUTING', 'INVALID_OBSERVATION_REFERENCE', 'OBSERVATION_VALIDATION_FAILED'
]);
const SHADOW_OBSERVATION_RESOURCE_LIMITS = Object.freeze({
  MAX_ROUTING_EVIDENCE: 64,
  MAX_NESTING_DEPTH: OBSERVATION_RESOURCE_LIMITS.MAX_NESTING_DEPTH,
  MAX_OWN_KEYS: OBSERVATION_RESOURCE_LIMITS.MAX_OWN_KEYS,
  MAX_CAPTURED_NODES: OBSERVATION_RESOURCE_LIMITS.MAX_CAPTURED_NODES,
  MAX_CAPTURED_STRING_UTF16: OBSERVATION_RESOURCE_LIMITS.MAX_CAPTURED_STRING_UTF16,
  MAX_RAW_TEXT_UTF16: OBSERVATION_RESOURCE_LIMITS.MAX_RAW_TEXT_UTF16
});

const INPUT_KEYS = Object.freeze([
  'adapterVersion', 'correlation', 'rawText', 'routing', 'observationReferences'
]);
const REFERENCE_KEYS = Object.freeze(['COMMERCE_INTENT', 'PROBLEM_DOMAIN']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// These are the deliberately tiny runtime mapping allowlists. R4A2I remains
// authoritative and validates every constructed observation.
const COMMERCE_INTENT_VALUES = Object.freeze([
  'order_confirmation_problem', 'checkout_problem', 'order_status', 'shipping_cost',
  'shipping_time', 'shipping_general', 'payment', 'availability_query', 'price_query',
  'purchase_location', 'ordering_help', 'order_start'
]);
const PROBLEM_DOMAIN_VALUES = Object.freeze([
  'edema_medical_boundary', 'varicose_cosmetic', 'circulation_claim', 'cracked_heel',
  'dry_heel', 'itchy_scalp', 'psoriasis', 'eczema', 'acne', 'rosacea', 'couperose',
  'dry_skin', 'child_usage'
]);

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
    if (++budget.nodes > SHADOW_OBSERVATION_RESOURCE_LIMITS.MAX_CAPTURED_NODES
      || depth > SHADOW_OBSERVATION_RESOURCE_LIMITS.MAX_NESTING_DEPTH) throw new CaptureFailure(true);
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      if (typeof value === 'string'
        && (budget.strings += value.length) > SHADOW_OBSERVATION_RESOURCE_LIMITS.MAX_CAPTURED_STRING_UTF16) throw new CaptureFailure(true);
      if (typeof value === 'number' && !Number.isFinite(value)) throw new CaptureFailure(false);
      return value;
    }
    if (typeof value !== 'object' || budget.ancestors.has(value)) throw new CaptureFailure(false);
    let proto, keys, descriptors;
    try {
      proto = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
      if (!Array.isArray(value) && keys.length > SHADOW_OBSERVATION_RESOURCE_LIMITS.MAX_OWN_KEYS) throw new CaptureFailure(true);
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

function result(status, reasonCode, observations = null) {
  return { status, reasonCode, observations, errors: reasonCode ? [reasonCode] : [] };
}
function rejected(reasonCode) { return result('REJECTED', reasonCode); }
function candidate({ reference, correlation, producer, predicate, value }) {
  return {
    observationVersion: 1,
    observationReference: reference,
    correlation,
    producer: { namespace: producer, version: PRODUCER_VERSIONS[producer] },
    evidenceKind: 'SEMANTIC_CLASSIFICATION',
    predicate,
    value,
    lineage: 'DIRECT',
    sources: [{ sourceType: 'CURRENT_TURN_TEXT', sourceTurnId: correlation.turnId, locators: [{ locatorType: 'WHOLE_SOURCE' }] }],
    dependencies: []
  };
}

function adaptLiveRoutingToSemanticObservations(rawInput) {
  let input;
  try { input = capture(rawInput); } catch (error) {
    return rejected(error instanceof CaptureFailure && error.resource ? 'RESOURCE_LIMIT_EXCEEDED' : 'INVALID_INPUT');
  }
  if (!exactKeys(input, INPUT_KEYS) || input.adapterVersion !== SHADOW_OBSERVATION_ADAPTER_VERSION
    || typeof input.rawText !== 'string' || !exactKeys(input.observationReferences, REFERENCE_KEYS)) {
    return rejected('INVALID_INPUT');
  }
  if (input.rawText.length > SHADOW_OBSERVATION_RESOURCE_LIMITS.MAX_RAW_TEXT_UTF16) {
    return rejected('RESOURCE_LIMIT_EXCEEDED');
  }
  let correlationResult;
  try { correlationResult = validateDecisionCorrelation(input.correlation); } catch { correlationResult = null; }
  if (!correlationResult || correlationResult.status !== 'VALID') return rejected('INVALID_CORRELATION');
  if (!plainObject(input.routing) || !Array.isArray(input.routing.evidence)
    || input.routing.evidence.length > SHADOW_OBSERVATION_RESOURCE_LIMITS.MAX_ROUTING_EVIDENCE
    || input.routing.evidence.some((marker) => typeof marker !== 'string')) {
    return rejected(input.routing?.evidence?.length > SHADOW_OBSERVATION_RESOURCE_LIMITS.MAX_ROUTING_EVIDENCE
      ? 'RESOURCE_LIMIT_EXCEEDED' : 'INVALID_ROUTING');
  }
  const evidence = new Set(input.routing.evidence);
  const mappings = [];
  if (COMMERCE_INTENT_VALUES.includes(input.routing.intent)
    && evidence.has(`commerce:${input.routing.intent}`)) {
    mappings.push({ key: 'COMMERCE_INTENT', producer: 'COMMERCE_INTENT_CLASSIFIER', value: input.routing.intent });
  }
  if (PROBLEM_DOMAIN_VALUES.includes(input.routing.domain)
    && evidence.has(`problem:${input.routing.domain}`)) {
    mappings.push({ key: 'PROBLEM_DOMAIN', producer: 'PROBLEM_DOMAIN_CLASSIFIER', value: input.routing.domain });
  }
  if (!mappings.length) return result('NO_OBSERVATION', null, []);

  const observations = [];
  const validationContext = {
    rawTextBindings: [{ sourceType: 'CURRENT_TURN_TEXT', sourceTurnId: correlationResult.correlation.turnId, rawText: input.rawText }],
    structuredContextBindings: [], representationBindings: [], externalReferenceBindings: [], historicalObservations: []
  };
  for (const mapping of mappings) {
    const reference = input.observationReferences[mapping.key];
    if (!uuid(reference)) return rejected('INVALID_OBSERVATION_REFERENCE');
    let checked;
    try {
      checked = validateSemanticEvidenceObservation({
        observation: candidate({
          reference,
          correlation: correlationResult.correlation,
          producer: mapping.producer,
          predicate: mapping.key,
          value: mapping.value
        }),
        validationContext
      });
    } catch { checked = null; }
    if (!checked || checked.status !== 'VALID') {
      return rejected(checked?.reasonCode === 'RESOURCE_LIMIT_EXCEEDED'
        ? 'RESOURCE_LIMIT_EXCEEDED' : 'OBSERVATION_VALIDATION_FAILED');
    }
    observations.push(checked.observation);
  }
  return result('PRODUCED', null, capture(observations));
}

module.exports = {
  adaptLiveRoutingToSemanticObservations,
  SHADOW_OBSERVATION_ADAPTER_VERSION,
  SHADOW_OBSERVATION_STATUSES,
  SHADOW_OBSERVATION_REASON_CODES,
  SHADOW_OBSERVATION_RESOURCE_LIMITS
};
