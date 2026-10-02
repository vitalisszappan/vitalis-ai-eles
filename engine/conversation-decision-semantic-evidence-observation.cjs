'use strict';

// R4A2I — pure, dormant validation of canonical semantic observations.
// Validity is transport/contract validity only; it grants no semantic,
// product, recommendation, transition, reducer, or state authority.
const { validateDecisionCorrelation } = require('./conversation-decision-correlation-contract.cjs');

const OBSERVATION_VERSION = 1;
const OBSERVATION_STATUSES = Object.freeze(['VALID', 'REJECTED']);
const OBSERVATION_REASON_CODES = Object.freeze([
  'INVALID_INPUT', 'RESOURCE_LIMIT_EXCEEDED', 'UNKNOWN_PROPERTY',
  'INVALID_VERSION', 'INVALID_REFERENCE', 'INVALID_CORRELATION',
  'INVALID_PRODUCER', 'INVALID_KIND_PREDICATE', 'INVALID_VALUE',
  'INVALID_LINEAGE', 'INVALID_SOURCE', 'INVALID_LOCATOR',
  'MISSING_TRUSTED_CONTEXT', 'INVALID_TRUSTED_CONTEXT',
  'INVALID_DEPENDENCY', 'INVALID_GRAPH'
]);
const FAILURE_PRECEDENCE = Object.freeze([
  'RESOURCE_LIMIT_EXCEEDED', 'INVALID_INPUT', 'UNKNOWN_PROPERTY',
  'INVALID_VERSION', 'INVALID_REFERENCE', 'INVALID_CORRELATION',
  'INVALID_PRODUCER', 'INVALID_KIND_PREDICATE', 'INVALID_VALUE',
  'INVALID_LINEAGE', 'INVALID_SOURCE', 'INVALID_LOCATOR',
  'MISSING_TRUSTED_CONTEXT', 'INVALID_TRUSTED_CONTEXT',
  'INVALID_DEPENDENCY', 'INVALID_GRAPH'
]);

const PRODUCER_NAMESPACES = Object.freeze([
  'COMMERCE_INTENT_CLASSIFIER', 'PROBLEM_DOMAIN_CLASSIFIER',
  'CUSTOMER_GOAL_INTERPRETER', 'SAFETY_CLASSIFIER',
  'COMPLAINT_INTERPRETER', 'PRODUCT_ALIAS_MATCHER',
  'PRODUCT_REFERENCE_RESOLVER', 'PERSISTED_PRODUCT_RECOVERY'
]);
const PRODUCER_VERSIONS = Object.freeze(Object.fromEntries(PRODUCER_NAMESPACES.map((name) => [name, 1])));
const EVIDENCE_KINDS = Object.freeze([
  'SEMANTIC_CLASSIFICATION', 'PRODUCT_CANDIDATE',
  'REFERENCE_RESOLUTION', 'QUANTITATIVE_MEASUREMENT'
]);
const LINEAGE_VALUES = Object.freeze(['DIRECT', 'DERIVED', 'RECOVERY']);
const SOURCE_TYPES = Object.freeze([
  'CURRENT_TURN_TEXT', 'HISTORICAL_TURN_TEXT',
  'PERSISTED_TURN_REPRESENTATION', 'PERSISTED_UNATTRIBUTED_REPRESENTATION',
  'STRUCTURED_CONVERSATION_CONTEXT', 'EXTERNAL_REFERENCE_DATA'
]);
const REPRESENTATION_KINDS = Object.freeze([
  'CONVERSATION_QUESTION', 'CONVERSATION_ANSWER', 'HISTORY_EVENT'
]);
const CONTEXT_KINDS = Object.freeze([
  'PRODUCT_FOCUS_CONTEXT', 'PRODUCT_SELECTION_CONTEXT', 'PRODUCT_CONTEXT_STATUS',
  'DISPLAYED_PRODUCT_SEQUENCE', 'PRODUCT_CANDIDATE_COLLECTION'
]);
const REFERENCE_KINDS = Object.freeze(['PRODUCT_RELATION_REGISTRY']);
const LOCATOR_TYPES = Object.freeze([
  'WHOLE_SOURCE', 'TEXT_RANGE', 'PRODUCT_ID', 'CONTEXT_STATUS',
  'SEQUENCE_ITEM', 'COLLECTION_ITEM', 'PRODUCT_RELATION'
]);
const RELATION_TYPES = Object.freeze(['soap', 'cream', 'shampoo', 'companion']);

const SEMANTIC_PREDICATES = Object.freeze([
  'COMMERCE_INTENT', 'PROBLEM_DOMAIN', 'CUSTOMER_GOAL', 'INTERPRETED_INTENT',
  'SEMANTIC_DOMAIN', 'SAFETY_CLASS', 'ADVERSE_REACTION_SUBTYPE',
  'COMPLAINT_INTENT', 'COMPLAINT_SUBJECT', 'COMPLAINT_TEMPORALITY',
  'COMPLAINT_POLARITY', 'COMPLAINT_CAUSALITY', 'COMPLAINT_SEVERITY',
  'PRODUCT_PRESENCE', 'PRODUCT_CATEGORY', 'REPLACEMENT_REQUEST',
  'CUSTOMER_SERVICE_INTERSECTION', 'ORDINAL_INTERPRETATION_STATUS',
  'PRODUCT_RECOVERY_STATUS'
]);
const PRODUCT_CANDIDATE_PREDICATES = Object.freeze([
  'PRODUCT_CANDIDATE_MEMBERSHIP', 'PREFERRED_PRODUCT_CANDIDATE'
]);
const REFERENCE_PREDICATES = Object.freeze(['PRODUCT_REFERENCE_RESOLUTION']);
const QUANTITATIVE_PREDICATES = Object.freeze(['PRODUCT_MENTION_COUNT']);
const PREDICATES = Object.freeze([
  ...SEMANTIC_PREDICATES, ...PRODUCT_CANDIDATE_PREDICATES,
  ...REFERENCE_PREDICATES, ...QUANTITATIVE_PREDICATES
]);
const EVIDENCE_KIND_PREDICATES = deepFreeze({
  SEMANTIC_CLASSIFICATION: [...SEMANTIC_PREDICATES],
  PRODUCT_CANDIDATE: [...PRODUCT_CANDIDATE_PREDICATES],
  REFERENCE_RESOLUTION: [...REFERENCE_PREDICATES],
  QUANTITATIVE_MEASUREMENT: [...QUANTITATIVE_PREDICATES]
});
const PRODUCER_PREDICATES = deepFreeze({
  COMMERCE_INTENT_CLASSIFIER: ['COMMERCE_INTENT'],
  PROBLEM_DOMAIN_CLASSIFIER: ['PROBLEM_DOMAIN'],
  CUSTOMER_GOAL_INTERPRETER: ['CUSTOMER_GOAL', 'INTERPRETED_INTENT', 'SEMANTIC_DOMAIN'],
  SAFETY_CLASSIFIER: ['SAFETY_CLASS', 'ADVERSE_REACTION_SUBTYPE'],
  COMPLAINT_INTERPRETER: [
    'COMPLAINT_INTENT', 'COMPLAINT_SUBJECT', 'COMPLAINT_TEMPORALITY',
    'COMPLAINT_POLARITY', 'COMPLAINT_CAUSALITY', 'COMPLAINT_SEVERITY',
    'PRODUCT_PRESENCE', 'PRODUCT_CATEGORY', 'REPLACEMENT_REQUEST',
    'CUSTOMER_SERVICE_INTERSECTION'
  ],
  PRODUCT_ALIAS_MATCHER: ['PRODUCT_CANDIDATE_MEMBERSHIP', 'PREFERRED_PRODUCT_CANDIDATE'],
  PRODUCT_REFERENCE_RESOLVER: ['PRODUCT_REFERENCE_RESOLUTION', 'ORDINAL_INTERPRETATION_STATUS'],
  PERSISTED_PRODUCT_RECOVERY: ['PRODUCT_CANDIDATE_MEMBERSHIP', 'PRODUCT_RECOVERY_STATUS', 'PRODUCT_MENTION_COUNT']
});

const RESOURCE_LIMITS = Object.freeze({
  MAX_GRAPH_OBSERVATIONS: 64,
  MAX_SOURCES_PER_OBSERVATION: 8,
  MAX_LOCATORS_PER_SOURCE: 32,
  MAX_DEPENDENCIES_PER_OBSERVATION: 32,
  MAX_HISTORICAL_OBSERVATIONS: 256,
  MAX_RAW_TEXT_UTF16: 16384,
  MAX_DISPLAYED_PRODUCT_SEQUENCE: 64,
  MAX_PRODUCT_CANDIDATE_COLLECTION: 64,
  MAX_EXTERNAL_RELATIONS: 256,
  MAX_EXTERNAL_BINDINGS: 8,
  MAX_STRUCTURED_CONTEXT_BINDINGS: 256,
  MAX_REPRESENTATION_BINDINGS: 256,
  MAX_RAW_TEXT_BINDINGS: 512,
  MAX_NESTING_DEPTH: 16,
  MAX_OWN_KEYS: 32,
  MAX_CAPTURED_NODES: 200000,
  MAX_CAPTURED_STRING_UTF16: 1048576
});

const ROOT_KEYS = Object.freeze([
  'observationVersion', 'observationReference', 'correlation', 'producer',
  'evidenceKind', 'predicate', 'value', 'lineage', 'sources', 'dependencies'
]);
const CONTEXT_KEYS = Object.freeze([
  'rawTextBindings', 'structuredContextBindings', 'representationBindings',
  'externalReferenceBindings', 'historicalObservations'
]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SOURCE_REFERENCE = /^product-relations:v[1-9][0-9]{0,9}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const ENUM_VALUES = deepFreeze({
  COMMERCE_INTENT: [
    'order_confirmation_problem', 'checkout_problem', 'order_status', 'shipping_cost',
    'shipping_time', 'shipping_general', 'payment', 'availability_query', 'price_query',
    'purchase_location', 'ordering_help', 'order_start'
  ],
  PROBLEM_DOMAIN: [
    'edema_medical_boundary', 'varicose_cosmetic', 'circulation_claim', 'cracked_heel',
    'dry_heel', 'itchy_scalp', 'psoriasis', 'eczema', 'acne', 'rosacea', 'couperose',
    'dry_skin', 'child_usage'
  ],
  CUSTOMER_GOAL: [
    'start_order', 'ask_price', 'ask_availability', 'ask_shipping', 'ask_payment',
    'compare_products', 'clarify_previous_answer', 'ask_usage', 'ask_product_information',
    'ask_child_usage', 'ask_variant', 'medical_boundary', 'solve_problem', 'find_product', 'unknown'
  ],
  INTERPRETED_INTENT: [
    'order_confirmation_problem', 'checkout_problem', 'order_status', 'shipping_cost',
    'shipping_time', 'shipping_general', 'payment', 'availability_query', 'price_query',
    'purchase_location', 'ordering_help', 'order_start', 'compare_products',
    'clarify_previous_answer', 'select_recommendation', 'product_usage', 'product_information',
    'benefits', 'suitability', 'ingredients', 'ingredient_existence', 'scent', 'child_usage',
    'variant_query', 'problem_recommendation', 'product_recommendation', 'product_availability'
  ],
  SEMANTIC_DOMAIN: [
    'commerce', 'product', 'conversation', 'child_usage', 'edema_medical_boundary',
    'varicose_cosmetic', 'circulation_claim', 'cracked_heel', 'dry_heel', 'itchy_scalp',
    'psoriasis', 'eczema', 'acne', 'rosacea', 'couperose', 'dry_skin'
  ],
  SAFETY_CLASS: ['medical_escalation', 'caution_with_boundary', 'safe_cosmetic_answer', 'safe'],
  ADVERSE_REACTION_SUBTYPE: ['breathing_difficulty', 'severe_swelling', 'blistering'],
  COMPLAINT_INTENT: [
    'product_quality_complaint', 'stop_use_question', 'allergic_reaction_concern',
    'burning_after_use', 'redness_after_use', 'product_irritation'
  ],
  COMPLAINT_SUBJECT: ['child', 'third_party', 'user', 'generic'],
  COMPLAINT_TEMPORALITY: ['hypothetical', 'resolved_past', 'still_relevant_past', 'past', 'current', 'unknown'],
  COMPLAINT_POLARITY: ['negative', 'uncertain', 'positive'],
  COMPLAINT_CAUSALITY: ['asserted', 'sufficient', 'suspected', 'generic'],
  COMPLAINT_SEVERITY: ['critical', 'high', 'moderate', 'low', 'unknown'],
  PRODUCT_CATEGORY: ['szappan', 'krem', 'balzsam', 'sampon', 'dezodor', 'tusfurdo'],
  ORDINAL_INTERPRETATION_STATUS: ['VALID_DISPLAYED_ORDINAL', 'EXPLICIT_INVALID_OR_OUT_OF_RANGE_ORDINAL'],
  PRODUCT_RECOVERY_STATUS: ['resolved', 'ambiguous', 'unresolved']
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function has(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function uuid(value) { return typeof value === 'string' && value.length === 36 && UUID_V4.test(value); }
function productId(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 256
    && value.trim() === value && !CONTROL.test(value);
}
function safeNonNegative(value) {
  return Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}
function exactKeys(value, keys) {
  return plainObject(value) && Object.keys(value).length === keys.length
    && keys.every((key) => has(value, key));
}
function requiredKeys(value, keys) {
  return plainObject(value) && keys.every((key) => has(value, key));
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function duplicate(values, key = canonical) {
  const seen = new Set();
  for (const value of values) { const token = key(value); if (seen.has(token)) return true; seen.add(token); }
  return false;
}
function sourceKey(source) {
  return canonical({ ...source, locators: [...source.locators].map(canonical).sort() });
}

class CaptureFailure extends Error {
  constructor(resource = false) { super(resource ? 'resource' : 'invalid'); this.resource = resource; }
}
function capture(raw) {
  const budget = { nodes: 0, strings: 0, ancestors: new Set() };
  function visit(value, depth) {
    if (++budget.nodes > RESOURCE_LIMITS.MAX_CAPTURED_NODES || depth > RESOURCE_LIMITS.MAX_NESTING_DEPTH) throw new CaptureFailure(true);
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      if (typeof value === 'string' && (budget.strings += value.length) > RESOURCE_LIMITS.MAX_CAPTURED_STRING_UTF16) throw new CaptureFailure(true);
      if (typeof value === 'number' && !Number.isFinite(value)) throw new CaptureFailure(false);
      return value;
    }
    if (typeof value !== 'object' || budget.ancestors.has(value)) throw new CaptureFailure(false);
    let proto, keys, descriptors;
    try {
      proto = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
      if (keys.length > RESOURCE_LIMITS.MAX_OWN_KEYS && !Array.isArray(value)) throw new CaptureFailure(true);
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
          || lengthDescriptor.value < 0 || lengthDescriptor.value > RESOURCE_LIMITS.MAX_RAW_TEXT_BINDINGS) throw new CaptureFailure(true);
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

function singleResult(status, reasonCode, observation = null) {
  return { status, reasonCode, observation, errors: reasonCode ? [reasonCode] : [] };
}
function graphResult(status, reasonCode, observations = null) {
  return { status, reasonCode, observations, errors: reasonCode ? [reasonCode] : [] };
}
function firstFailure(failures) { return FAILURE_PRECEDENCE.find((reason) => failures.has(reason)) || null; }
function missingContext(failures) {
  if (!failures.has('INVALID_TRUSTED_CONTEXT')) failures.add('MISSING_TRUSTED_CONTEXT');
}
function markUnknown(value, allowed, failures) {
  if (!plainObject(value)) return false;
  if (Object.keys(value).some((key) => !allowed.includes(key))) failures.add('UNKNOWN_PROPERTY');
  return true;
}

function resourceScan(input, graph) {
  const observations = graph
    ? Array.isArray(input?.observations) ? input.observations : []
    : input?.observation ? [input.observation] : [];
  if (graph && Array.isArray(input?.observations) && input.observations.length > RESOURCE_LIMITS.MAX_GRAPH_OBSERVATIONS) return true;
  for (const observation of observations || []) {
    if (Array.isArray(observation?.sources) && observation.sources.length > RESOURCE_LIMITS.MAX_SOURCES_PER_OBSERVATION) return true;
    if (Array.isArray(observation?.dependencies) && observation.dependencies.length > RESOURCE_LIMITS.MAX_DEPENDENCIES_PER_OBSERVATION) return true;
    if (Array.isArray(observation?.sources)) for (const source of observation.sources) {
      if (Array.isArray(source?.locators) && source.locators.length > RESOURCE_LIMITS.MAX_LOCATORS_PER_SOURCE) return true;
    }
  }
  const context = input?.validationContext;
  const limits = [
    ['rawTextBindings', 'MAX_RAW_TEXT_BINDINGS'],
    ['structuredContextBindings', 'MAX_STRUCTURED_CONTEXT_BINDINGS'],
    ['representationBindings', 'MAX_REPRESENTATION_BINDINGS'],
    ['externalReferenceBindings', 'MAX_EXTERNAL_BINDINGS'],
    ['historicalObservations', 'MAX_HISTORICAL_OBSERVATIONS']
  ];
  for (const [key, limit] of limits) if (Array.isArray(context?.[key]) && context[key].length > RESOURCE_LIMITS[limit]) return true;
  if (Array.isArray(context?.rawTextBindings) && context.rawTextBindings.some((entry) => typeof entry?.rawText === 'string' && entry.rawText.length > RESOURCE_LIMITS.MAX_RAW_TEXT_UTF16)) return true;
  if (Array.isArray(context?.structuredContextBindings)) for (const entry of context.structuredContextBindings) {
    if (entry?.contextKind === 'DISPLAYED_PRODUCT_SEQUENCE' && Array.isArray(entry.value) && entry.value.length > RESOURCE_LIMITS.MAX_DISPLAYED_PRODUCT_SEQUENCE) return true;
    if (entry?.contextKind === 'PRODUCT_CANDIDATE_COLLECTION' && Array.isArray(entry.value) && entry.value.length > RESOURCE_LIMITS.MAX_PRODUCT_CANDIDATE_COLLECTION) return true;
  }
  if (Array.isArray(context?.externalReferenceBindings) && context.externalReferenceBindings.some((entry) => Array.isArray(entry?.relations) && entry.relations.length > RESOURCE_LIMITS.MAX_EXTERNAL_RELATIONS)) return true;
  if (Array.isArray(context?.historicalObservations) && context.historicalObservations.some((entry) => Array.isArray(entry?.dependencies) && entry.dependencies.length > RESOURCE_LIMITS.MAX_DEPENDENCIES_PER_OBSERVATION)) return true;
  return false;
}

function validateContext(context, failures) {
  if (context === undefined || context === null) { failures.add('MISSING_TRUSTED_CONTEXT'); return null; }
  if (!markUnknown(context, CONTEXT_KEYS, failures) || !exactKeys(context, CONTEXT_KEYS)
    || CONTEXT_KEYS.some((key) => !Array.isArray(context[key]))) {
    failures.add('INVALID_TRUSTED_CONTEXT'); return null;
  }
  const indexes = {
    raw: new Map(), structured: new Map(), representations: new Map(), external: new Map(), historical: new Map()
  };
  for (const binding of context.rawTextBindings) {
    const common = ['sourceType', 'rawText'];
    const type = binding?.sourceType;
    const keys = ['CURRENT_TURN_TEXT', 'HISTORICAL_TURN_TEXT'].includes(type)
      ? [...common, 'sourceTurnId']
      : type === 'PERSISTED_TURN_REPRESENTATION' ? [...common, 'sourceTurnId', 'representationReference']
        : type === 'PERSISTED_UNATTRIBUTED_REPRESENTATION' ? [...common, 'representationReference'] : [];
    if (!keys.length || !exactKeys(binding, keys) || typeof binding.rawText !== 'string'
      || (has(binding, 'sourceTurnId') && !uuid(binding.sourceTurnId))
      || (has(binding, 'representationReference') && !uuid(binding.representationReference))) {
      failures.add('INVALID_TRUSTED_CONTEXT'); continue;
    }
    const key = rawBindingKey(binding);
    if (indexes.raw.has(key)) failures.add('INVALID_TRUSTED_CONTEXT'); else indexes.raw.set(key, binding.rawText);
  }
  for (const binding of context.structuredContextBindings) {
    if (!exactKeys(binding, ['sourceTurnId', 'contextKind', 'value']) || !uuid(binding.sourceTurnId)
      || !CONTEXT_KINDS.includes(binding.contextKind) || !structuredValue(binding.contextKind, binding.value)) {
      failures.add('INVALID_TRUSTED_CONTEXT'); continue;
    }
    const key = `${binding.sourceTurnId}|${binding.contextKind}`;
    if (indexes.structured.has(key)) failures.add('INVALID_TRUSTED_CONTEXT'); else indexes.structured.set(key, binding.value);
  }
  for (const binding of context.representationBindings) {
    if (!exactKeys(binding, ['representationReference', 'representationKind', 'sourceTurnId'])
      || !uuid(binding.representationReference) || !REPRESENTATION_KINDS.includes(binding.representationKind)
      || binding.sourceTurnId !== null && !uuid(binding.sourceTurnId)) {
      failures.add('INVALID_TRUSTED_CONTEXT'); continue;
    }
    if (indexes.representations.has(binding.representationReference)) failures.add('INVALID_TRUSTED_CONTEXT');
    else indexes.representations.set(binding.representationReference, binding);
  }
  for (const binding of context.externalReferenceBindings) {
    if (!exactKeys(binding, ['referenceKind', 'sourceReference', 'relations'])
      || binding.referenceKind !== 'PRODUCT_RELATION_REGISTRY' || typeof binding.sourceReference !== 'string'
      || !SOURCE_REFERENCE.test(binding.sourceReference) || !Array.isArray(binding.relations)) {
      failures.add('INVALID_TRUSTED_CONTEXT'); continue;
    }
    const relationKeys = new Set();
    for (const relation of binding.relations) {
      if (!exactKeys(relation, ['sourceProductId', 'relationType', 'targetProductId'])
        || !productId(relation.sourceProductId) || !RELATION_TYPES.includes(relation.relationType)
        || !productId(relation.targetProductId)) failures.add('INVALID_TRUSTED_CONTEXT');
      else {
        const key = relationKey(relation);
        if (relationKeys.has(key)) failures.add('INVALID_TRUSTED_CONTEXT');
        relationKeys.add(key);
      }
    }
    const key = `${binding.referenceKind}|${binding.sourceReference}`;
    if (indexes.external.has(key)) failures.add('INVALID_TRUSTED_CONTEXT');
    else indexes.external.set(key, { binding, relationKeys });
  }
  for (const entry of context.historicalObservations) {
    if (!exactKeys(entry, ['observationReference', 'conversationId', 'dependencies'])
      || !uuid(entry.observationReference) || typeof entry.conversationId !== 'string' || !entry.conversationId
      || !Array.isArray(entry.dependencies) || entry.dependencies.some((id) => !uuid(id))
      || duplicate(entry.dependencies, (id) => id) || entry.dependencies.includes(entry.observationReference)) {
      failures.add('INVALID_TRUSTED_CONTEXT'); continue;
    }
    if (indexes.historical.has(entry.observationReference)) failures.add('INVALID_TRUSTED_CONTEXT');
    else indexes.historical.set(entry.observationReference, entry);
  }
  return indexes;
}

function rawBindingKey(value) {
  return [value.sourceType, value.sourceTurnId || '', value.representationReference || ''].join('|');
}
function relationKey(value) { return `${value.sourceProductId}\u0000${value.relationType}\u0000${value.targetProductId}`; }
function structuredValue(kind, value) {
  if (['PRODUCT_FOCUS_CONTEXT', 'PRODUCT_SELECTION_CONTEXT'].includes(kind)) return productId(value);
  if (kind === 'PRODUCT_CONTEXT_STATUS') return ['resolved', 'ambiguous', 'unresolved'].includes(value);
  if (kind === 'DISPLAYED_PRODUCT_SEQUENCE') return Array.isArray(value) && value.every(productId);
  return kind === 'PRODUCT_CANDIDATE_COLLECTION' && Array.isArray(value) && value.every(productId) && !duplicate(value, (id) => id);
}

function validateValue(predicate, value) {
  if (value === null || value === undefined) return false;
  if (ENUM_VALUES[predicate]) return ENUM_VALUES[predicate].includes(value);
  if (['PRODUCT_PRESENCE', 'REPLACEMENT_REQUEST', 'CUSTOMER_SERVICE_INTERSECTION'].includes(predicate)) return value === true;
  if (predicate === 'PRODUCT_CANDIDATE_MEMBERSHIP') return productId(value);
  if (predicate === 'PREFERRED_PRODUCT_CANDIDATE') return exactKeys(value, ['productId', 'preferenceMode'])
    && productId(value.productId) && ['EARLIEST_SOURCE_MATCH', 'LATEST_SOURCE_MATCH'].includes(value.preferenceMode);
  if (predicate === 'PRODUCT_MENTION_COUNT') return safeNonNegative(value);
  if (predicate === 'PRODUCT_REFERENCE_RESOLUTION') return referenceResolution(value);
  return false;
}
function referenceResolution(value) {
  if (!plainObject(value)) return false;
  const outcomes = ['UNIQUE_CANDIDATE', 'AMBIGUOUS', 'UNRESOLVED'];
  const types = ['ordinal', 'variant', 'alternative', 'companion', 'category', 'focus'];
  if (!outcomes.includes(value.outcome) || !types.includes(value.referenceType)) return false;
  let keys = ['outcome', 'referenceType'];
  if (value.outcome === 'UNIQUE_CANDIDATE') {
    keys = [...keys, 'productId'];
    if (value.referenceType === 'companion') keys.push('relationType');
    if (value.referenceType === 'focus') keys.push('focusBasis');
  }
  if (!exactKeys(value, keys)) return false;
  if (value.outcome !== 'UNIQUE_CANDIDATE') return true;
  if (!productId(value.productId)) return false;
  if (value.referenceType === 'companion' && !RELATION_TYPES.includes(value.relationType)) return false;
  return value.referenceType !== 'focus' || ['explicit_focus', 'focus', 'single_product'].includes(value.focusBasis);
}

function allowedLineage(namespace, predicate, lineage) {
  if (namespace === 'PERSISTED_PRODUCT_RECOVERY') return lineage === 'RECOVERY';
  if (namespace === 'COMMERCE_INTENT_CLASSIFIER' || namespace === 'PROBLEM_DOMAIN_CLASSIFIER') return lineage === 'DIRECT';
  if (namespace === 'PRODUCT_ALIAS_MATCHER') return lineage === (predicate === 'PREFERRED_PRODUCT_CANDIDATE' ? 'DERIVED' : 'DIRECT');
  if (namespace === 'PRODUCT_REFERENCE_RESOLVER') return lineage === 'DERIVED';
  if (namespace === 'SAFETY_CLASSIFIER' && predicate === 'ADVERSE_REACTION_SUBTYPE') return lineage === 'DIRECT';
  return ['DIRECT', 'DERIVED'].includes(lineage);
}

function validateObservationData(observation, indexes, failures) {
  if (!markUnknown(observation, ROOT_KEYS, failures) || !requiredKeys(observation, ROOT_KEYS)) { failures.add('INVALID_INPUT'); return; }
  if (observation.observationVersion !== OBSERVATION_VERSION) failures.add('INVALID_VERSION');
  if (!uuid(observation.observationReference)) failures.add('INVALID_REFERENCE');
  let correlation = null;
  try {
    const checked = validateDecisionCorrelation(observation.correlation);
    if (checked?.status === 'VALID') correlation = checked.correlation; else failures.add('INVALID_CORRELATION');
  } catch { failures.add('INVALID_CORRELATION'); }
  const producer = observation.producer;
  if (!exactKeys(producer, ['namespace', 'version']) || !PRODUCER_NAMESPACES.includes(producer.namespace)
    || producer.version !== PRODUCER_VERSIONS[producer.namespace]) failures.add('INVALID_PRODUCER');
  if (!EVIDENCE_KINDS.includes(observation.evidenceKind) || !PREDICATES.includes(observation.predicate)
    || !EVIDENCE_KIND_PREDICATES[observation.evidenceKind]?.includes(observation.predicate)
    || !PRODUCER_PREDICATES[producer?.namespace]?.includes(observation.predicate)) failures.add('INVALID_KIND_PREDICATE');
  if (!validateValue(observation.predicate, observation.value)) failures.add('INVALID_VALUE');
  if (!LINEAGE_VALUES.includes(observation.lineage) || !allowedLineage(producer?.namespace, observation.predicate, observation.lineage)) failures.add('INVALID_LINEAGE');
  if (!Array.isArray(observation.sources) || observation.sources.length === 0) failures.add('INVALID_SOURCE');
  else {
    for (const source of observation.sources) validateSource(source, correlation, indexes, failures);
    if (observation.sources.every((source) => plainObject(source) && Array.isArray(source.locators))
      && duplicate(observation.sources, sourceKey)) failures.add('INVALID_SOURCE');
  }
  if (!Array.isArray(observation.dependencies) || observation.dependencies.some((id) => !uuid(id))
    || duplicate(Array.isArray(observation.dependencies) ? observation.dependencies : [], (id) => id)
    || observation.dependencies?.includes(observation.observationReference)) failures.add('INVALID_DEPENDENCY');
  if (observation.lineage === 'DIRECT' && observation.dependencies?.length) failures.add('INVALID_DEPENDENCY');
  if (observation.lineage === 'DERIVED' && observation.dependencies?.length === 0
    && (!Array.isArray(observation.sources)
      || !observation.sources.some((source) => ['STRUCTURED_CONVERSATION_CONTEXT', 'EXTERNAL_REFERENCE_DATA'].includes(source?.sourceType)))) failures.add('INVALID_LINEAGE');
  if (observation.lineage === 'RECOVERY'
    && (!Array.isArray(observation.sources)
      || !observation.sources.some((source) => ['PERSISTED_TURN_REPRESENTATION', 'PERSISTED_UNATTRIBUTED_REPRESENTATION'].includes(source?.sourceType)))) failures.add('INVALID_LINEAGE');
}

function validateSource(source, correlation, indexes, failures) {
  if (!plainObject(source) || !SOURCE_TYPES.includes(source.sourceType)) { failures.add('INVALID_SOURCE'); return; }
  const schemas = {
    CURRENT_TURN_TEXT: ['sourceType', 'sourceTurnId', 'locators'],
    HISTORICAL_TURN_TEXT: ['sourceType', 'sourceTurnId', 'locators'],
    PERSISTED_TURN_REPRESENTATION: ['sourceType', 'sourceTurnId', 'representationKind', 'representationReference', 'locators'],
    PERSISTED_UNATTRIBUTED_REPRESENTATION: ['sourceType', 'representationKind', 'representationReference', 'locators'],
    STRUCTURED_CONVERSATION_CONTEXT: ['sourceType', 'sourceTurnId', 'contextKind', 'locators'],
    EXTERNAL_REFERENCE_DATA: ['sourceType', 'referenceKind', 'sourceReference', 'locators']
  };
  markUnknown(source, schemas[source.sourceType], failures);
  if (!exactKeys(source, schemas[source.sourceType])) { failures.add('INVALID_SOURCE'); return; }
  if (!Array.isArray(source.locators) || source.locators.length === 0) { failures.add('INVALID_LOCATOR'); return; }
  if (duplicate(source.locators)) failures.add('INVALID_LOCATOR');
  const whole = source.locators.filter((locator) => locator?.locatorType === 'WHOLE_SOURCE');
  if (whole.length && source.locators.length !== 1) failures.add('INVALID_LOCATOR');
  let support = null;
  if (source.sourceType === 'CURRENT_TURN_TEXT' || source.sourceType === 'HISTORICAL_TURN_TEXT') {
    if (!uuid(source.sourceTurnId) || !correlation
      || source.sourceType === 'CURRENT_TURN_TEXT' && source.sourceTurnId !== correlation.turnId
      || source.sourceType === 'HISTORICAL_TURN_TEXT' && source.sourceTurnId === correlation.turnId) failures.add('INVALID_SOURCE');
    support = indexes?.raw.get(rawBindingKey(source));
    if (support === undefined) missingContext(failures);
  } else if (source.sourceType.startsWith('PERSISTED_')) {
    if (!REPRESENTATION_KINDS.includes(source.representationKind) || !uuid(source.representationReference)
      || source.sourceType === 'PERSISTED_TURN_REPRESENTATION' && !uuid(source.sourceTurnId)) failures.add('INVALID_SOURCE');
    const binding = indexes?.representations.get(source.representationReference);
    const expectedTurn = source.sourceType === 'PERSISTED_TURN_REPRESENTATION' ? source.sourceTurnId : null;
    if (!binding) missingContext(failures);
    else if (binding.representationKind !== source.representationKind || binding.sourceTurnId !== expectedTurn) failures.add('INVALID_TRUSTED_CONTEXT');
    support = indexes?.raw.get(rawBindingKey(source));
  } else if (source.sourceType === 'STRUCTURED_CONVERSATION_CONTEXT') {
    if (!uuid(source.sourceTurnId) || !CONTEXT_KINDS.includes(source.contextKind)) failures.add('INVALID_SOURCE');
    support = indexes?.structured.get(`${source.sourceTurnId}|${source.contextKind}`);
    if (support === undefined) missingContext(failures);
  } else {
    if (source.referenceKind !== 'PRODUCT_RELATION_REGISTRY' || typeof source.sourceReference !== 'string'
      || !SOURCE_REFERENCE.test(source.sourceReference)) failures.add('INVALID_SOURCE');
    support = indexes?.external.get(`${source.referenceKind}|${source.sourceReference}`);
    if (!support) missingContext(failures);
  }
  for (const locator of source.locators) validateLocator(locator, source, support, failures);
}

function validateLocator(locator, source, support, failures) {
  if (!plainObject(locator) || !LOCATOR_TYPES.includes(locator.locatorType)) { failures.add('INVALID_LOCATOR'); return; }
  const schemas = {
    WHOLE_SOURCE: ['locatorType'],
    TEXT_RANGE: ['locatorType', 'coordinateSpace', 'start', 'end'],
    PRODUCT_ID: ['locatorType', 'productId'],
    CONTEXT_STATUS: ['locatorType'],
    SEQUENCE_ITEM: ['locatorType', 'position', 'productId'],
    COLLECTION_ITEM: ['locatorType', 'productId'],
    PRODUCT_RELATION: ['locatorType', 'sourceProductId', 'relationType', 'targetProductId']
  };
  markUnknown(locator, schemas[locator.locatorType], failures);
  if (!exactKeys(locator, schemas[locator.locatorType])) { failures.add('INVALID_LOCATOR'); return; }
  const type = source.sourceType;
  const textSource = ['CURRENT_TURN_TEXT', 'HISTORICAL_TURN_TEXT', 'PERSISTED_TURN_REPRESENTATION', 'PERSISTED_UNATTRIBUTED_REPRESENTATION'].includes(type);
  if (locator.locatorType === 'WHOLE_SOURCE') return;
  if (locator.locatorType === 'TEXT_RANGE') {
    if (!textSource || locator.coordinateSpace !== 'RAW_SOURCE_TEXT' || !safeNonNegative(locator.start)
      || !safeNonNegative(locator.end) || locator.end <= locator.start) failures.add('INVALID_LOCATOR');
    else if (support === undefined) missingContext(failures);
    else if (locator.end > support.length) failures.add('INVALID_LOCATOR');
    return;
  }
  if (type === 'STRUCTURED_CONVERSATION_CONTEXT') {
    const allowed = {
      PRODUCT_FOCUS_CONTEXT: 'PRODUCT_ID', PRODUCT_SELECTION_CONTEXT: 'PRODUCT_ID',
      PRODUCT_CONTEXT_STATUS: 'CONTEXT_STATUS', DISPLAYED_PRODUCT_SEQUENCE: 'SEQUENCE_ITEM',
      PRODUCT_CANDIDATE_COLLECTION: 'COLLECTION_ITEM'
    };
    if (allowed[source.contextKind] !== locator.locatorType) { failures.add('INVALID_LOCATOR'); return; }
    if (locator.locatorType === 'PRODUCT_ID' && (!productId(locator.productId) || support !== locator.productId)) failures.add('INVALID_LOCATOR');
    if (locator.locatorType === 'SEQUENCE_ITEM' && (!safeNonNegative(locator.position) || !productId(locator.productId)
      || !Array.isArray(support) || locator.position >= support.length || support[locator.position] !== locator.productId)) failures.add('INVALID_LOCATOR');
    if (locator.locatorType === 'COLLECTION_ITEM' && (!productId(locator.productId) || !Array.isArray(support) || !support.includes(locator.productId))) failures.add('INVALID_LOCATOR');
    return;
  }
  if (type === 'EXTERNAL_REFERENCE_DATA' && locator.locatorType === 'PRODUCT_RELATION') {
    if (!productId(locator.sourceProductId) || !RELATION_TYPES.includes(locator.relationType)
      || !productId(locator.targetProductId) || !support?.relationKeys.has(relationKey(locator))) failures.add('INVALID_LOCATOR');
    return;
  }
  failures.add('INVALID_LOCATOR');
}

function validateGraphData(observations, indexes, failures) {
  if (!Array.isArray(observations) || observations.length === 0) { failures.add('INVALID_GRAPH'); return; }
  const nodes = new Map(indexes?.historical || []);
  let conversationId = null;
  for (const observation of observations) {
    const id = observation?.observationReference;
    if (uuid(id) && nodes.has(id)) failures.add('INVALID_GRAPH');
    else if (uuid(id)) nodes.set(id, observation);
    const idConversation = observation?.correlation?.conversationId;
    if (typeof idConversation === 'string') {
      if (conversationId === null) conversationId = idConversation;
      else if (conversationId !== idConversation) failures.add('INVALID_GRAPH');
    }
  }
  if (duplicate(observations.filter(plainObject).map((item) => item.observationReference), (id) => id)) failures.add('INVALID_GRAPH');
  for (const [id, node] of nodes) {
    const nodeConversation = has(node, 'correlation') ? node.correlation?.conversationId : node.conversationId;
    if (conversationId !== null && nodeConversation !== conversationId) failures.add('INVALID_GRAPH');
    if (!Array.isArray(node.dependencies)) continue;
    for (const dependency of node.dependencies) if (!nodes.has(dependency)) failures.add('INVALID_GRAPH');
    if (node.dependencies.includes(id)) failures.add('INVALID_GRAPH');
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { failures.add('INVALID_GRAPH'); return; }
    if (visited.has(id) || !nodes.has(id)) return;
    visiting.add(id);
    const dependencies = nodes.get(id).dependencies;
    if (Array.isArray(dependencies)) for (const next of dependencies) visit(next);
    visiting.delete(id); visited.add(id);
  }
  for (const id of nodes.keys()) visit(id);
}

function run(rawInput, graph) {
  let input;
  try { input = capture(rawInput); }
  catch (error) {
    const reason = error instanceof CaptureFailure && error.resource ? 'RESOURCE_LIMIT_EXCEEDED' : 'INVALID_INPUT';
    return graph ? graphResult('REJECTED', reason) : singleResult('REJECTED', reason);
  }
  if (resourceScan(input, graph)) return graph ? graphResult('REJECTED', 'RESOURCE_LIMIT_EXCEEDED') : singleResult('REJECTED', 'RESOURCE_LIMIT_EXCEEDED');
  const failures = new Set();
  const wrapperKeys = graph ? ['observations', 'validationContext'] : ['observation', 'validationContext'];
  markUnknown(input, wrapperKeys, failures);
  if (!requiredKeys(input, wrapperKeys)) failures.add('INVALID_INPUT');
  const indexes = validateContext(input?.validationContext, failures);
  const observations = graph ? input?.observations : [input?.observation];
  if (graph && !Array.isArray(observations)) failures.add('INVALID_INPUT');
  if (Array.isArray(observations)) for (const observation of observations) validateObservationData(observation, indexes, failures);
  if (Array.isArray(observations)) validateGraphData(observations, indexes, failures);
  const reason = firstFailure(failures);
  if (reason) return graph ? graphResult('REJECTED', reason) : singleResult('REJECTED', reason);
  return graph ? graphResult('VALID', null, observations) : singleResult('VALID', null, observations[0]);
}

function validateSemanticEvidenceObservation(input) { return run(input, false); }
function validateSemanticEvidenceObservationGraph(input) { return run(input, true); }

module.exports = {
  validateSemanticEvidenceObservation,
  validateSemanticEvidenceObservationGraph,
  OBSERVATION_VERSION,
  OBSERVATION_STATUSES,
  OBSERVATION_REASON_CODES,
  PRODUCER_NAMESPACES,
  PRODUCER_VERSIONS,
  PRODUCER_PREDICATES,
  EVIDENCE_KINDS,
  EVIDENCE_KIND_PREDICATES,
  PREDICATES,
  LINEAGE_VALUES,
  SOURCE_TYPES,
  REPRESENTATION_KINDS,
  CONTEXT_KINDS,
  REFERENCE_KINDS,
  LOCATOR_TYPES,
  RELATION_TYPES,
  RESOURCE_LIMITS
};
