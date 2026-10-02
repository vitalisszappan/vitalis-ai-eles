'use strict';

// R4A2H — pure, dormant validation and transport of correlation coordinates
// already assigned or explicitly adopted by an outer server-owned boundary.
// This module performs no allocation, adoption, retry detection, or semantics.
const DECISION_CORRELATION_VERSION = 1;
const CORRELATION_SOURCES = Object.freeze(['VALIDATED_CLIENT', 'SERVER_ASSIGNED']);
const CORRELATION_STATUSES = Object.freeze(['VALID', 'REJECTED']);
const CORRELATION_REASON_CODES = Object.freeze([
  'INVALID_INPUT', 'INVALID_VERSION', 'INVALID_CONVERSATION_ID',
  'INVALID_TURN_ID', 'INVALID_CORRELATION_SOURCE',
  'INVALID_REQUEST_REFERENCE', 'UNKNOWN_PROPERTY'
]);
const INPUT_KEYS = Object.freeze([
  'correlationVersion', 'conversationId', 'turnId', 'correlationSource', 'requestReference'
]);
const CONVERSATION_ID = /^[A-Za-z0-9-]{16,100}$/;
const TURN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REQUEST_REFERENCE_MAX = 200;

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function captureData(value, seen = new Set()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite contract number');
    return value;
  }
  if (typeof value !== 'object') throw new Error('unsupported contract value');
  if (seen.has(value)) throw new Error('cyclic contract data');
  seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string')) throw new Error('symbol contract key');
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || descriptors.length?.value !== value.length) {
        throw new Error('invalid contract array');
      }
      const keys = Object.keys(descriptors).filter((key) => key !== 'length');
      if (keys.length !== value.length) throw new Error('sparse contract array');
      return keys.map((key, index) => {
        const descriptor = descriptors[String(index)];
        if (key !== String(index) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new Error('invalid contract array entry');
        }
        return captureData(descriptor.value, seen);
      });
    }
    if (!plainObject(value)) throw new Error('non-plain contract object');
    const output = {};
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('accessor contract value');
      output[key] = captureData(descriptor.value, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function output(status, reasonCode, correlation = null, errors = []) {
  return { status, reasonCode, correlation, errors: Array.isArray(errors) ? [...errors] : [] };
}
function reject(reasonCode, detail) { return output('REJECTED', reasonCode, null, [detail]); }
function validRequestReference(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= REQUEST_REFERENCE_MAX
    && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function validateDecisionCorrelation(rawInput) {
  let input;
  try { input = captureData(rawInput); } catch {
    return reject('INVALID_INPUT', 'input must contain only closed plain data');
  }
  if (!plainObject(input)) return reject('INVALID_INPUT', 'input must be an object');
  const keys = Object.keys(input);
  const unknown = keys.filter((key) => !INPUT_KEYS.includes(key));
  if (unknown.length) return reject('UNKNOWN_PROPERTY', `unknown property: ${unknown.sort()[0]}`);
  if (keys.length !== INPUT_KEYS.length || INPUT_KEYS.some((key) => !Object.hasOwn(input, key))) {
    return reject('INVALID_INPUT', 'all correlation properties are required');
  }
  if (input.correlationVersion !== DECISION_CORRELATION_VERSION) {
    return reject('INVALID_VERSION', 'correlationVersion must equal 1');
  }
  if (typeof input.conversationId !== 'string' || !CONVERSATION_ID.test(input.conversationId)) {
    return reject('INVALID_CONVERSATION_ID', 'conversationId is invalid');
  }
  if (typeof input.turnId !== 'string' || !TURN_ID.test(input.turnId)) {
    return reject('INVALID_TURN_ID', 'turnId must be a lowercase UUIDv4');
  }
  if (!CORRELATION_SOURCES.includes(input.correlationSource)) {
    return reject('INVALID_CORRELATION_SOURCE', 'correlationSource is invalid');
  }
  if (!validRequestReference(input.requestReference)) {
    return reject('INVALID_REQUEST_REFERENCE', 'requestReference is invalid');
  }
  return output('VALID', null, {
    correlationVersion: input.correlationVersion,
    conversationId: input.conversationId,
    turnId: input.turnId,
    correlationSource: input.correlationSource,
    requestReference: input.requestReference
  });
}

module.exports = {
  validateDecisionCorrelation,
  DECISION_CORRELATION_VERSION,
  CORRELATION_SOURCES,
  CORRELATION_STATUSES,
  CORRELATION_REASON_CODES
};
