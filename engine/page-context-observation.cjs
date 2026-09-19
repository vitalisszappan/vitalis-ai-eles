'use strict';

// Request-local, untrusted observations only. No semantic or authorization output.
const DEFAULT_POLICY = Object.freeze({
  allowedOrigins: Object.freeze(['https://vitalis-szappan.hu', 'https://www.vitalis-szappan.hu']),
  allowedProtocols: Object.freeze(['https:']),
  maxAgeMs: 60000,
  maxFutureMs: 5000
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION = /^[a-zA-Z0-9-]{16,100}$/;
const KEYS = Object.freeze(['observationVersion', 'observationId', 'sessionId', 'turnId', 'observedAt', 'pageUrl', 'pageOrigin', 'sourceType', 'sourceFrame']);
const result = (status, reasonCode, observation = null) => Object.freeze({ status, reasonCode, observation });

function sanitizePageUrl(value, policy = DEFAULT_POLICY) {
  if (typeof value !== 'string' || !value || value.length > 2048 || value.trim() !== value || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || !policy.allowedProtocols?.includes(url.protocol)
      || !policy.allowedOrigins?.includes(url.origin) || url.origin === 'null') return null;
    url.search = '';
    url.hash = '';
    if (url.href.length > 2048) return null;
    return Object.freeze({ pageUrl: url.href, pageOrigin: url.origin });
  } catch { return null; }
}

function validatePageObservation(value, expectedCorrelation = {}, policy = DEFAULT_POLICY) {
  if (value === undefined || value === null) return result('MISSING', 'NOT_PROVIDED');
  // Inspect descriptors rather than executing getters on purported JSON input.
  if (typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return result('INVALID', 'OBJECT_SHAPE');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string'
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) return result('INVALID', 'OBJECT_SHAPE');
  if (!Number.isInteger(descriptors.observationVersion?.value)) return result('INVALID', 'VERSION_SHAPE');
  if (value.observationVersion !== 1) return result('UNSUPPORTED_VERSION', 'UNSUPPORTED_VERSION');
  if (Object.keys(descriptors).length !== KEYS.length || KEYS.some(key => !Object.hasOwn(descriptors, key))) return result('INVALID', 'KEY_SET');
  if (typeof value.observationId !== 'string' || !UUID.test(value.observationId)
    || typeof value.turnId !== 'string' || !UUID.test(value.turnId)
    || typeof value.sessionId !== 'string' || !SESSION.test(value.sessionId)) return result('INVALID', 'IDENTIFIERS');
  if (value.sessionId !== expectedCorrelation.sessionId || value.turnId !== expectedCorrelation.turnId) return result('INVALID', 'CORRELATION');
  if (!Number.isSafeInteger(value.observedAt) || value.observedAt < 0) return result('INVALID', 'TIMESTAMP');
  if (value.sourceType !== 'UNTRUSTED_PAGE_OBSERVATION' || value.sourceFrame !== 'PARENT_STOREFRONT') return result('INVALID', 'SOURCE');
  const url = sanitizePageUrl(value.pageUrl, policy);
  if (!url || value.pageOrigin !== url.pageOrigin) return result('INVALID', 'URL');
  return result('VALID', null, Object.freeze({ ...value, ...url }));
}

function assessPageObservationFreshness(validatedValue, receivedAt, policy = DEFAULT_POLICY) {
  if (!Number.isSafeInteger(receivedAt) || receivedAt < 0
    || !Number.isSafeInteger(validatedValue?.observedAt) || validatedValue.observedAt < 0
    || !Number.isSafeInteger(policy.maxAgeMs) || policy.maxAgeMs < 0
    || !Number.isSafeInteger(policy.maxFutureMs) || policy.maxFutureMs < 0) return result('INVALID', 'TIMESTAMP');
  const age = receivedAt - validatedValue.observedAt;
  if (age < -policy.maxFutureMs) return result('INVALID', 'CLOCK_SKEW');
  if (age > policy.maxAgeMs) return result('STALE', 'AGE_EXCEEDED');
  return result('VALID', null, Object.freeze({ ...validatedValue }));
}

module.exports = { DEFAULT_POLICY, validatePageObservation, assessPageObservationFreshness, sanitizePageUrl };
