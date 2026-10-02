'use strict';

// First production shadow runner. Its process-local identity registry is
// deliberately bounded and is not durable across restart, deploy, or routing
// to another instance. The live answer path never consumes its output.
const { randomUUID } = require('node:crypto');
const {
  validateDecisionCorrelation
} = require('./conversation-decision-correlation-contract.cjs');
const {
  adaptLiveRoutingToSemanticObservations,
  SHADOW_OBSERVATION_ADAPTER_VERSION,
  SHADOW_OBSERVATION_RESOURCE_LIMITS
} = require('./conversation-decision-shadow-observation-adapter.cjs');
const {
  admitSemanticEvidence,
  ADMISSION_VERSION,
  ADMISSION_RESOURCE_LIMITS
} = require('./conversation-decision-evidence-identity.cjs');

const SHADOW_RUNNER_VERSION = 1;
const DEFAULT_REGISTRY_MAX_ENTRIES = Math.min(128, ADMISSION_RESOURCE_LIMITS.MAX_EXISTING_ADMISSIONS);
const DEFAULT_SOFT_BUDGET_MS = 25;
const RUNNER_STATUSES = Object.freeze(['COMPLETED', 'SUPPRESSED']);
const RUNNER_REASON_CODES = Object.freeze([
  'INVALID_INPUT', 'INVALID_CORRELATION', 'ADAPTER_REJECTED',
  'ADMISSION_REJECTED', 'REGISTRY_CAPACITY', 'EXECUTION_FAILED',
  'SOFT_BUDGET_EXCEEDED'
]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ALLOWED_PREDICATES = Object.freeze(['COMMERCE_INTENT', 'PROBLEM_DOMAIN']);
const PRODUCER_BY_PREDICATE = Object.freeze({
  COMMERCE_INTENT: 'COMMERCE_INTENT_CLASSIFIER',
  PROBLEM_DOMAIN: 'PROBLEM_DOMAIN_CLASSIFIER'
});

function has(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function uuid(value) { return typeof value === 'string' && UUID_V4.test(value); }
function safeUuid(allocate) {
  try {
    const value = allocate();
    return uuid(value) ? value : null;
  } catch { return null; }
}
function elapsed(now, started) {
  try {
    const value = now() - started;
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch { return 0; }
}
function diagnostic(status, reasonCode, observationCount, admittedCount, predicates, elapsedMs, size, max) {
  return {
    status,
    reasonCode,
    observationCount,
    admittedCount,
    predicates: [...predicates],
    elapsedMs,
    registryCapacity: { size, max, atCapacity: size >= max },
    processLocalIdentity: true
  };
}

function safeRouting(raw) {
  if (!plainObject(raw)) return null;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(raw); } catch { return null; }
  if (Reflect.ownKeys(descriptors).length !== 3
    || !['intent', 'domain', 'evidence'].every((key) => has(descriptors, key))) return null;
  for (const key of ['intent', 'domain', 'evidence']) {
    if (!descriptors[key] || !has(descriptors[key], 'value')) return null;
  }
  const intent = descriptors.intent.value;
  const domain = descriptors.domain.value;
  const evidence = descriptors.evidence.value;
  if (!(intent === null || typeof intent === 'string')
    || !(domain === null || typeof domain === 'string') || !Array.isArray(evidence)
    || evidence.length > SHADOW_OBSERVATION_RESOURCE_LIMITS.MAX_ROUTING_EVIDENCE) return null;
  let evidenceDescriptors;
  try { evidenceDescriptors = Object.getOwnPropertyDescriptors(evidence); } catch { return null; }
  const copied = [];
  for (let index = 0; index < evidence.length; index++) {
    const descriptor = evidenceDescriptors[String(index)];
    if (!descriptor || !has(descriptor, 'value') || typeof descriptor.value !== 'string') return null;
    copied.push(descriptor.value);
  }
  return { intent, domain, evidence: copied };
}

function buildShadowPayload(rawInput, options = {}) {
  try {
    if (!plainObject(rawInput)) return { status: 'SUPPRESSED', reasonCode: 'INVALID_INPUT', payload: null };
    const descriptors = Object.getOwnPropertyDescriptors(rawInput);
    if (Reflect.ownKeys(descriptors).length !== 4
      || !['clientConversationId', 'clientTurnId', 'rawText', 'routing'].every((key) => has(descriptors, key))) {
      return { status: 'SUPPRESSED', reasonCode: 'INVALID_INPUT', payload: null };
    }
    const read = (key) => descriptors[key] && has(descriptors[key], 'value') ? descriptors[key].value : undefined;
    const allocate = typeof options.randomUUID === 'function' ? options.randomUUID : randomUUID;
    const clientConversationId = read('clientConversationId');
    const clientTurnId = read('clientTurnId');
    const rawText = read('rawText');
    const routing = safeRouting(read('routing'));
    if (typeof rawText !== 'string'
      || rawText.length > SHADOW_OBSERVATION_RESOURCE_LIMITS.MAX_RAW_TEXT_UTF16 || !routing) {
      return { status: 'SUPPRESSED', reasonCode: 'INVALID_INPUT', payload: null };
    }
    const adoptedConversation = typeof clientConversationId === 'string' ? clientConversationId : null;
    const adoptedTurn = uuid(clientTurnId) ? clientTurnId : null;
    const conversationId = adoptedConversation || safeUuid(allocate);
    const turnId = adoptedTurn || safeUuid(allocate);
    if (!conversationId || !turnId) return { status: 'SUPPRESSED', reasonCode: 'INVALID_CORRELATION', payload: null };
    const candidate = {
      correlationVersion: 1,
      conversationId,
      turnId,
      correlationSource: adoptedConversation && adoptedTurn ? 'VALIDATED_CLIENT' : 'SERVER_ASSIGNED',
      requestReference: `request:chat/${turnId}`
    };
    const checked = validateDecisionCorrelation(candidate);
    if (!checked || checked.status !== 'VALID') {
      return { status: 'SUPPRESSED', reasonCode: 'INVALID_CORRELATION', payload: null };
    }
    return {
      status: 'READY', reasonCode: null,
      payload: { runnerVersion: SHADOW_RUNNER_VERSION, correlation: checked.correlation, rawText, routing }
    };
  } catch {
    return { status: 'SUPPRESSED', reasonCode: 'INVALID_INPUT', payload: null };
  }
}

function createShadowRunner(options = {}) {
  const adapter = typeof options.adapter === 'function' ? options.adapter : adaptLiveRoutingToSemanticObservations;
  const admit = typeof options.admit === 'function' ? options.admit : admitSemanticEvidence;
  const allocate = typeof options.randomUUID === 'function' ? options.randomUUID : randomUUID;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const configuredMax = Number.isSafeInteger(options.maxRegistryEntries) ? options.maxRegistryEntries : DEFAULT_REGISTRY_MAX_ENTRIES;
  const max = Math.max(1, Math.min(configuredMax, ADMISSION_RESOURCE_LIMITS.MAX_EXISTING_ADMISSIONS));
  const softBudgetMs = Number.isFinite(options.softBudgetMs) && options.softBudgetMs >= 0
    ? options.softBudgetMs : DEFAULT_SOFT_BUDGET_MS;
  const registry = new Map();

  function closed(reasonCode, started, observationCount = 0, admittedCount = 0, predicates = []) {
    const measured = elapsed(now, started);
    return diagnostic('SUPPRESSED', reasonCode, observationCount, admittedCount, predicates, measured, registry.size, max);
  }
  function identityKey(correlation, producer, predicate) {
    return `${correlation.conversationId}\u0000${correlation.turnId}\u0000${producer}\u0000${predicate}`;
  }

  function run(rawPayload) {
    let started;
    try { started = now(); } catch { started = 0; }
    try {
      if (!plainObject(rawPayload)) return closed('INVALID_INPUT', started);
      const descriptors = Object.getOwnPropertyDescriptors(rawPayload);
      const read = (key) => descriptors[key] && has(descriptors[key], 'value') ? descriptors[key].value : undefined;
      if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string')
        || Reflect.ownKeys(descriptors).length !== 4
        || !['runnerVersion', 'correlation', 'rawText', 'routing'].every((key) => has(descriptors, key))
        || read('runnerVersion') !== SHADOW_RUNNER_VERSION) return closed('INVALID_INPUT', started);
      const correlationCheck = validateDecisionCorrelation(read('correlation'));
      if (!correlationCheck || correlationCheck.status !== 'VALID') return closed('INVALID_CORRELATION', started);
      const rawText = read('rawText');
      const routing = safeRouting(read('routing'));
      if (typeof rawText !== 'string' || rawText.length > SHADOW_OBSERVATION_RESOURCE_LIMITS.MAX_RAW_TEXT_UTF16 || !routing) {
        return closed('INVALID_INPUT', started);
      }
      const correlation = correlationCheck.correlation;
      const references = {};
      const provisional = new Map();
      for (const predicate of ALLOWED_PREDICATES) {
        const producer = PRODUCER_BY_PREDICATE[predicate];
        const key = identityKey(correlation, producer, predicate);
        const prior = registry.get(key);
        const observationReference = prior?.observationReference || safeUuid(allocate);
        const evidenceId = prior?.evidenceId || safeUuid(allocate);
        if (!observationReference || !evidenceId) return closed('EXECUTION_FAILED', started);
        references[predicate] = observationReference;
        provisional.set(predicate, { key, producer, predicate, observationReference, evidenceId, prior });
      }
      const adapted = adapter({
        adapterVersion: SHADOW_OBSERVATION_ADAPTER_VERSION,
        correlation, rawText, routing, observationReferences: references
      });
      if (!adapted || adapted.status === 'REJECTED') return closed('ADAPTER_REJECTED', started);
      if (adapted.status === 'NO_OBSERVATION') {
        const measured = elapsed(now, started);
        const reason = measured > softBudgetMs ? 'SOFT_BUDGET_EXCEEDED' : null;
        return diagnostic(reason ? 'SUPPRESSED' : 'COMPLETED', reason, 0, 0, [], measured, registry.size, max);
      }
      if (adapted.status !== 'PRODUCED' || !Array.isArray(adapted.observations)) return closed('ADAPTER_REJECTED', started);
      const predicates = adapted.observations.map((item) => item?.predicate).filter((item) => ALLOWED_PREDICATES.includes(item));
      if (predicates.length !== adapted.observations.length || new Set(predicates).size !== predicates.length) {
        return closed('ADAPTER_REJECTED', started);
      }
      const newCount = predicates.filter((predicate) => !provisional.get(predicate).prior).length;
      if (registry.size + newCount > max) return closed('REGISTRY_CAPACITY', started, adapted.observations.length, 0, predicates);

      const pending = [];
      const existing = [...registry.values()].map((entry) => entry.admission);
      for (const observation of adapted.observations) {
        const identity = provisional.get(observation.predicate);
        const validationContext = {
          rawTextBindings: [{ sourceType: 'CURRENT_TURN_TEXT', sourceTurnId: correlation.turnId, rawText }],
          structuredContextBindings: [], representationBindings: [], externalReferenceBindings: [], historicalObservations: []
        };
        const admitted = admit({
          admissionVersion: ADMISSION_VERSION,
          observation,
          validationContext,
          evidenceId: identity.evidenceId,
          dependencyBindings: [],
          existingAdmissions: [...existing, ...pending.map((entry) => entry.admission)]
        });
        if (!admitted || !['ADMITTED', 'EXACT_REPLAY'].includes(admitted.status) || !admitted.evidence) {
          return closed('ADMISSION_REJECTED', started, adapted.observations.length, pending.length, predicates);
        }
        pending.push({ ...identity, admission: admitted.evidence });
      }
      for (const entry of pending) registry.set(entry.key, entry);
      const measured = elapsed(now, started);
      const reason = measured > softBudgetMs ? 'SOFT_BUDGET_EXCEEDED' : null;
      return diagnostic(reason ? 'SUPPRESSED' : 'COMPLETED', reason, adapted.observations.length, pending.length, predicates, measured, registry.size, max);
    } catch {
      return closed('EXECUTION_FAILED', started);
    }
  }

  function inspectIdentity({ conversationId, turnId, producer, predicate } = {}) {
    const entry = registry.get(`${conversationId}\u0000${turnId}\u0000${producer}\u0000${predicate}`);
    return entry ? { observationReference: entry.observationReference, evidenceId: entry.evidenceId } : null;
  }
  return Object.freeze({ run, inspectIdentity });
}

function scheduleShadowExecution({ enabled, payload, runner, schedule = setImmediate, logger = () => {} }) {
  if (enabled !== true) return { status: 'DISABLED', reasonCode: null };
  const safeLog = (value) => {
    try { logger(value); } catch {}
  };
  try {
    schedule(() => {
      try {
        Promise.resolve().then(() => runner.run(payload)).then(
          (value) => safeLog(value),
          () => safeLog(diagnostic('SUPPRESSED', 'EXECUTION_FAILED', 0, 0, [], 0, 0, 0))
        );
      } catch {
        safeLog(diagnostic('SUPPRESSED', 'EXECUTION_FAILED', 0, 0, [], 0, 0, 0));
      }
    });
    return { status: 'SCHEDULED', reasonCode: null };
  } catch {
    safeLog(diagnostic('SUPPRESSED', 'EXECUTION_FAILED', 0, 0, [], 0, 0, 0));
    return { status: 'SUPPRESSED', reasonCode: 'EXECUTION_FAILED' };
  }
}

module.exports = {
  buildShadowPayload,
  createShadowRunner,
  scheduleShadowExecution,
  SHADOW_RUNNER_VERSION,
  DEFAULT_REGISTRY_MAX_ENTRIES,
  DEFAULT_SOFT_BUDGET_MS,
  RUNNER_STATUSES,
  RUNNER_REASON_CODES
};
