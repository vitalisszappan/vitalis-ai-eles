'use strict';

const https = require('node:https');
const { createRevenuePhase4Service } = require('./engine/revenue-phase4.cjs');
const { fetchUnasRevenueEvidence } = require('./engine/unas-revenue-evidence.cjs');
const {
  TARGET_ORDER_KEY,
  runSingleOrderRevenueReprocess
} = require('./engine/single-order-revenue-reprocess.cjs');
const { createSingleOrderRevenueRuntime, rows } = require('./engine/single-order-revenue-runtime.cjs');

const SAFE_CODES = new Set([
  'EXACT_ORDER_KEY_REQUIRED', 'REPROCESS_DEPENDENCIES_REQUIRED', 'VERIFIED_PROOF_REQUIRED',
  'ATTRIBUTION_EVIDENCE_REQUIRED', 'UNAS_ORDER_NOT_FOUND', 'UNAS_MULTIPLE_ORDERS',
  'UNAS_REVENUE_VERIFICATION_FAILED', 'MONETARY_EVIDENCE_REQUIRED', 'SKU_MISMATCH',
  'UNAS_REVENUE_FETCH_FAILED', 'ATTRIBUTION_EVIDENCE_INVALID', 'OUTCOME_EVIDENCE_MISMATCH',
  'FIRST_PERSISTENCE_FAILED', 'IDEMPOTENCY_FAILED', 'SUPABASE_RUNTIME_REQUIRED',
  'SUPABASE_REQUEST_FAILED', 'REVENUE_RPC_REQUEST_FAILED', 'SANITIZED_REPROCESS_FAILURE'
]);

function authHeaders(key) {
  const value = String(key || '');
  if (!value) throw Object.assign(new Error('supabase_runtime_required'), { code: 'SUPABASE_RUNTIME_REQUIRED' });
  return value.startsWith('sb_secret_') ? { apikey: value } : { apikey: value, Authorization: `Bearer ${value}` };
}

function request({ method = 'GET', pathname, body, headers = {} }) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!base || !key) throw Object.assign(new Error('supabase_runtime_required'), { code: 'SUPABASE_RUNTIME_REQUIRED' });
  const url = new URL(pathname, `${base}/`);
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: {
        ...authHeaders(key),
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, headers: res.headers, body: responseBody });
        } else {
          reject(Object.assign(new Error('supabase_request_failed'), { code: 'SUPABASE_REQUEST_FAILED' }));
        }
      });
    });
    req.on('error', () => reject(Object.assign(new Error('supabase_request_failed'), { code: 'SUPABASE_REQUEST_FAILED' })));
    if (payload) req.write(payload);
    req.end();
  });
}

const runtime = createSingleOrderRevenueRuntime({ request, fetchRevenueEvidence: fetchUnasRevenueEvidence });
const { loadEvents, loadOutcome, loadProof } = runtime;

async function main() {
  try {
    if (process.argv.length !== 2) throw Object.assign(new Error('exact_order_key_required'), { code: 'EXACT_ORDER_KEY_REQUIRED' });
    const phase4 = createRevenuePhase4Service({ request });
    const result = await runSingleOrderRevenueReprocess({
      orderKey: TARGET_ORDER_KEY,
      loadProof,
      loadEvents,
      loadOutcome,
      fetchRevenueEvidence: fetchUnasRevenueEvidence,
      phase4
    });
    console.log('SINGLE_ORDER_REVENUE_REPROCESS: PASS');
    console.log(`ORDER_KEY: ${result.orderKey}`);
    console.log(`FIRST_WRITE: ${result.first}`);
    console.log(`SECOND_WRITE: ${result.second}`);
  } catch (error) {
    const raw = String(error?.code || '').toUpperCase();
    const code = SAFE_CODES.has(raw) ? raw : 'SANITIZED_REPROCESS_FAILURE';
    console.log(`STOP: ${code}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { authHeaders, loadEvents, loadOutcome, loadProof, main, request, rows };
