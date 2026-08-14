'use strict';

const crypto = require('node:crypto');
const { TARGET_ORDER_KEY } = require('./single-order-revenue-reprocess.cjs');

const MAX_BODY_BYTES = 1024;
const OPERATION = 'temporary_single_order_revenue_execution';

function safeEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left || '')).digest();
  const rightDigest = crypto.createHash('sha256').update(String(right || '')).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest) && String(left || '').length === String(right || '').length;
}

function readEmptyJsonBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers?.['content-length'] || 0);
    if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY_BYTES) {
      reject(new Error('invalid_request'));
      return;
    }
    let body = '';
    let bytes = 0;
    req.setEncoding?.('utf8');
    req.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > MAX_BODY_BYTES) reject(new Error('invalid_request'));
      else body += chunk;
    });
    req.on('end', () => {
      if (bytes > MAX_BODY_BYTES) return;
      if (!body.trim()) return resolve();
      if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) {
        reject(new Error('invalid_request'));
        return;
      }
      try {
        const parsed = JSON.parse(body);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.keys(parsed).length !== 0) {
          throw new Error('invalid_request');
        }
        resolve();
      } catch (_) {
        reject(new Error('invalid_request'));
      }
    });
    req.on('error', () => reject(new Error('invalid_request')));
  });
}

function createTemporaryRevenueExecutionEndpoint(options = {}) {
  const sendJson = options.sendJson;
  const logger = options.logger || (() => {});
  let inFlight = false;
  let consumed = false;

  function reply(res, startedAt, httpStatus, safeStatus, body) {
    logger({
      operation: OPERATION,
      safe_status: safeStatus,
      http_status: httpStatus,
      duration_ms: Math.max(0, Date.now() - startedAt),
      target: 'fixed_poc_order'
    });
    return sendJson(res, httpStatus, body);
  }

  return async function handleTemporaryRevenueExecution(req, res, url) {
    const startedAt = Date.now();
    if (req.method !== 'POST') {
      return reply(res, startedAt, 405, 'method_not_allowed', { ok: false, status: 'method_not_allowed' });
    }
    if (!options.executionToken) {
      return reply(res, startedAt, 503, 'execution_unavailable', { ok: false, status: 'execution_unavailable' });
    }
    const suppliedAdmin = String(req.headers?.['x-admin-token'] || '');
    const suppliedExecution = String(req.headers?.['x-revenue-execution-token'] || '');
    if (!options.adminToken || !suppliedAdmin || !suppliedExecution ||
        !safeEqual(suppliedAdmin, options.adminToken) || !safeEqual(suppliedExecution, options.executionToken)) {
      return reply(res, startedAt, 401, 'unauthorized', { ok: false, status: 'unauthorized' });
    }
    if (url.searchParams.size !== 0) {
      return reply(res, startedAt, 400, 'invalid_request', { ok: false, status: 'invalid_request' });
    }
    try {
      await readEmptyJsonBody(req);
    } catch (_) {
      return reply(res, startedAt, 400, 'invalid_request', { ok: false, status: 'invalid_request' });
    }
    if (consumed) {
      return reply(res, startedAt, 409, 'already_processed', { ok: false, status: 'already_processed' });
    }
    if (inFlight) {
      return reply(res, startedAt, 409, 'execution_in_progress', { ok: false, status: 'execution_in_progress' });
    }
    if (typeof options.revenueOrderExists !== 'function' || typeof options.execute !== 'function') {
      return reply(res, startedAt, 503, 'execution_unavailable', { ok: false, status: 'execution_unavailable' });
    }

    inFlight = true;
    try {
      if (await options.revenueOrderExists(TARGET_ORDER_KEY)) {
        consumed = true;
        return reply(res, startedAt, 409, 'already_processed', { ok: false, status: 'already_processed' });
      }
      const result = await options.execute();
      if (result?.orderKey !== TARGET_ORDER_KEY || result?.first !== 'created' ||
          result?.second !== 'duplicate' || !result?.revenueOrderId) {
        throw new Error('unsafe_execution_result');
      }
      consumed = true;
      return reply(res, startedAt, 200, 'completed', {
        ok: true,
        status: 'completed',
        first: 'created',
        second: 'duplicate'
      });
    } catch (_) {
      return reply(res, startedAt, 500, 'execution_failed', { ok: false, status: 'execution_failed' });
    } finally {
      inFlight = false;
    }
  };
}

module.exports = {
  MAX_BODY_BYTES,
  OPERATION,
  createTemporaryRevenueExecutionEndpoint,
  readEmptyJsonBody,
  safeEqual
};
