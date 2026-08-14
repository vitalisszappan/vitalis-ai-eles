'use strict';

const crypto = require('node:crypto');

const CHECK_DELAYS_MS = Object.freeze([2000, 10000]);
const DEFAULT_LOOKUP_TIMEOUT_MS = 1500;

function originBucket(origin) {
  try {
    const hostname = new URL(String(origin || '')).hostname.toLowerCase();
    if (hostname === 'vitalis-szappan.hu') return 'apex';
    if (hostname === 'www.vitalis-szappan.hu') return 'www';
  } catch (_) {}
  return 'other_allowed';
}

function boundedLookup(run, timeoutMs, setTimer, clearTimer) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimer(() => {
      if (settled) return;
      settled = true;
      reject(new Error('diagnostic_lookup_timeout'));
    }, timeoutMs);
    Promise.resolve().then(run).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        reject(error);
      }
    );
  });
}

function createAttributionNotFoundDiagnostics(options = {}) {
  if (typeof options.lookupEvents !== 'function') throw new Error('diagnostic_event_lookup_required');
  const logger = typeof options.logger === 'function' ? options.logger : () => {};
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const now = options.now || Date.now;
  const schedule = options.schedule || setTimeout;
  const cancelSchedule = options.cancelSchedule || clearTimeout;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const lookupTimeoutMs = Number.isFinite(options.lookupTimeoutMs) && options.lookupTimeoutMs > 0
    ? options.lookupTimeoutMs : DEFAULT_LOOKUP_TIMEOUT_MS;
  const lookupWithTimeout = options.lookupWithTimeout || ((run) => boundedLookup(run, lookupTimeoutMs, setTimer, clearTimer));
  const scheduled = new Set();
  let closed = false;

  function safeLog(event) {
    try { logger(event); } catch (_) {}
  }

  async function followUp(diagnosticId, attributionId, proofTime, checkDelayMs) {
    if (closed) return;
    try {
      const rows = await lookupWithTimeout(() => options.lookupEvents(attributionId));
      if (closed || !Array.isArray(rows)) return;
      const receivedAfter = rows.map((row) => Date.parse(row?.received_at))
        .filter((value) => Number.isFinite(value) && value >= proofTime)
        .sort((left, right) => left - right)[0];
      safeLog({
        diagnosticId,
        check_delay_ms: checkDelayMs,
        event_count: rows.length,
        recommended_count: rows.filter((row) => row?.event_type === 'product_recommended').length,
        clicked_count: rows.filter((row) => row?.event_type === 'product_clicked').length,
        first_received_after_proof_ms: Number.isFinite(receivedAfter) ? receivedAfter - proofTime : null
      });
    } catch (_) {}
  }

  function observeAttributionNotFound({ attributionId, proofTimestamp, origin } = {}) {
    if (closed) return null;
    const proofTime = Date.parse(proofTimestamp);
    if (!Number.isFinite(proofTime) || typeof attributionId !== 'string' || !attributionId) return null;
    const diagnosticId = randomUUID();
    safeLog({
      diagnosticId,
      failure: 'attribution_not_found',
      origin_bucket: originBucket(origin),
      initial_event_count: 0,
      proof_age_ms: Math.max(0, now() - proofTime)
    });
    for (const delay of CHECK_DELAYS_MS) {
      const timer = schedule(() => {
        scheduled.delete(timer);
        void followUp(diagnosticId, attributionId, proofTime, delay);
      }, delay);
      scheduled.add(timer);
    }
    return diagnosticId;
  }

  function observeFailure(failure, context) {
    if (failure !== 'attribution_not_found') return null;
    return observeAttributionNotFound(context);
  }

  function close() {
    closed = true;
    for (const timer of scheduled) cancelSchedule(timer);
    scheduled.clear();
  }

  return { close, observeFailure };
}

module.exports = {
  CHECK_DELAYS_MS,
  DEFAULT_LOOKUP_TIMEOUT_MS,
  boundedLookup,
  createAttributionNotFoundDiagnostics,
  originBucket
};
