'use strict';

const PHASES = new Set(['login', 'products', 'categories', 'normalize', 'validate', 'snapshot_write']);
const CATEGORIES = new Set(['timeout', 'http_auth', 'rate_limit', 'upstream', 'invalid_xml', 'empty_products', 'repeated_page', 'filesystem', 'unknown']);
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

function safeSyncFailure(error, fallbackPhase = 'validate') {
  const phase = PHASES.has(error?.unasSyncPhase) ? error.unasSyncPhase : (PHASES.has(fallbackPhase) ? fallbackPhase : 'validate');
  const httpStatus = boundedInteger(error?.unasHttpStatus, 599);
  let category = CATEGORIES.has(error?.unasSyncCategory) ? error.unasSyncCategory : 'unknown';
  if (category === 'unknown' && httpStatus !== null) category = classifyHttpStatus(httpStatus);
  const page = phase === 'products' ? boundedInteger(error?.unasPage) : null;
  return { phase, category, http_status: httpStatus, page, retryable: ['timeout', 'rate_limit', 'upstream'].includes(category) };
}

function tagSyncError(error, fields = {}) {
  const target = error instanceof Error ? error : new Error('UNAS sync failure');
  const safe = safeSyncFailure({ unasSyncPhase: fields.phase, unasSyncCategory: fields.category, unasHttpStatus: fields.http_status, unasPage: fields.page }, fields.phase);
  Object.defineProperties(target, {
    unasSyncPhase: { value: safe.phase, configurable: true },
    unasSyncCategory: { value: safe.category, configurable: true },
    unasHttpStatus: { value: safe.http_status, configurable: true },
    unasPage: { value: safe.page, configurable: true }
  });
  return target;
}

function buildSafeDiagnostic({ trigger, error, durationMs }) {
  return {
    trigger: ['startup', 'manual', 'admin', 'interval'].includes(trigger) ? trigger : 'manual',
    ...safeSyncFailure(error),
    duration_ms: boundedInteger(durationMs, MAX_DURATION_MS) ?? 0
  };
}

module.exports = { PHASES, CATEGORIES, MAX_DURATION_MS, buildSafeDiagnostic, classifyHttpStatus, safeSyncFailure, tagSyncError };
