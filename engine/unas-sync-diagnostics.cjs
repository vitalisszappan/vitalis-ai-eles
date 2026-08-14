'use strict';

const PHASES = new Set(['login', 'products', 'categories', 'normalize', 'validate', 'snapshot_write']);
const CATEGORIES = new Set(['timeout', 'transport', 'http_auth', 'rate_limit', 'upstream', 'invalid_xml', 'empty_products', 'repeated_page', 'filesystem', 'unknown']);
const TRANSPORT_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'TLS_ERROR', 'OTHER']);
const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
]);
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

function boundedInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(maximum, Math.trunc(number))) : null;
}

function classifyHttpStatus(status) {
  if (status === 401 || status === 403) return 'http_auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500 && status <= 599) return 'upstream';
  return 'unknown';
}

function mapTransportCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'].includes(code)) return code;
  if (TLS_CODES.has(code) || code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_')) return 'TLS_ERROR';
  return 'OTHER';
}

function safeSyncFailure(error, fallbackPhase = 'validate') {
  const phase = PHASES.has(error?.unasSyncPhase) ? error.unasSyncPhase : (PHASES.has(fallbackPhase) ? fallbackPhase : 'validate');
  const httpStatus = boundedInteger(error?.unasHttpStatus, 599);
  let category = CATEGORIES.has(error?.unasSyncCategory) ? error.unasSyncCategory : 'unknown';
  if (category === 'unknown' && httpStatus !== null) category = classifyHttpStatus(httpStatus);
  const page = phase === 'products' ? boundedInteger(error?.unasPage) : null;
  const transportCode = category === 'transport' && TRANSPORT_CODES.has(error?.unasTransportCode)
    ? error.unasTransportCode
    : null;
  return { phase, category, http_status: httpStatus, page, transport_code: transportCode, retryable: ['timeout', 'rate_limit', 'upstream'].includes(category) };
}

function tagSyncError(error, fields = {}) {
  const target = error instanceof Error ? error : new Error('UNAS sync failure');
  const safe = safeSyncFailure({ unasSyncPhase: fields.phase, unasSyncCategory: fields.category, unasHttpStatus: fields.http_status, unasPage: fields.page, unasTransportCode: fields.transport_code }, fields.phase);
  Object.defineProperties(target, {
    unasSyncPhase: { value: safe.phase, configurable: true },
    unasSyncCategory: { value: safe.category, configurable: true },
    unasHttpStatus: { value: safe.http_status, configurable: true },
    unasPage: { value: safe.page, configurable: true },
    unasTransportCode: { value: safe.transport_code, configurable: true }
  });
  return target;
}

function tagTransportError(error, phase) {
  if (error?.unasSyncCategory) return error;
  return tagSyncError(error, { phase, category: 'transport', transport_code: mapTransportCode(error?.code) });
}

function buildSafeDiagnostic({ trigger, error, durationMs }) {
  return {
    trigger: ['startup', 'manual', 'admin', 'interval'].includes(trigger) ? trigger : 'manual',
    ...safeSyncFailure(error),
    duration_ms: boundedInteger(durationMs, MAX_DURATION_MS) ?? 0
  };
}

module.exports = { PHASES, CATEGORIES, TRANSPORT_CODES, MAX_DURATION_MS, buildSafeDiagnostic, classifyHttpStatus, mapTransportCode, safeSyncFailure, tagSyncError, tagTransportError };
