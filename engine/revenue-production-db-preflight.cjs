'use strict';

const fs = require('node:fs');

const CONNECTION_ENV = 'DATABASE_URL';
const CERT_ENV = 'SUPABASE_CA_CERT_PATH';
const TARGET_ORDER_KEY = '99212-298722';
const REVENUE_TABLES = Object.freeze([
  'commerce_revenue_orders',
  'commerce_revenue_items',
  'commerce_order_lifecycle',
  'commerce_order_lifecycle_events'
]);
const PREFLIGHT_STEPS = Object.freeze(['CONNECT','SELECT_1','TABLE_EXISTENCE','TARGET_ORDER_LOOKUP']);

const DIAGNOSTIC_CATEGORIES = Object.freeze(new Set([
  'DATABASE_URL_MISSING','SSL_CONFIGURATION_FAILURE','DNS_NOT_FOUND','DNS_TEMPORARY_FAILURE',
  'TLS_HOSTNAME_MISMATCH','TLS_CHAIN_UNVERIFIED','TLS_SELF_SIGNED_CHAIN','TLS_SELF_SIGNED_CERT',
  'TLS_CERT_EXPIRED','TLS_ISSUER_CERT_MISSING','TLS_FAILURE','AUTHENTICATION_FAILED',
  'INVALID_DATABASE','CONNECTION_REFUSED','NETWORK_UNREACHABLE','HOST_UNREACHABLE',
  'CONNECTION_TIMEOUT','CONNECTION_RESET','POSTGRES_CONNECTION_FAILURE','POSTGRES_RESOURCE_LIMIT',
  'POSTGRES_SERVER_SHUTDOWN','POSTGRES_SYSTEM_ERROR','POSTGRES_INTERNAL_ERROR','POSTGRES_ERROR',
  'QUERY_FAILED','UNKNOWN_CONNECTION_FAILURE'
]));

const TLS_CODE_CATEGORIES = Object.freeze({
  ERR_TLS_CERT_ALTNAME_INVALID: 'TLS_HOSTNAME_MISMATCH',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS_CHAIN_UNVERIFIED',
  SELF_SIGNED_CERT_IN_CHAIN: 'TLS_SELF_SIGNED_CHAIN',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS_SELF_SIGNED_CERT',
  CERT_HAS_EXPIRED: 'TLS_CERT_EXPIRED',
  UNABLE_TO_GET_ISSUER_CERT: 'TLS_ISSUER_CERT_MISSING',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'TLS_ISSUER_CERT_MISSING'
});

function withPhase(error, phase) {
  if (error && typeof error === 'object') error.preflightPhase = phase;
  throw error;
}

async function runStep(step, operation, onStep) {
  try {
    const result = await operation();
    if (typeof onStep === 'function') onStep(step, 'PASS');
    return result;
  } catch (error) {
    if (typeof onStep === 'function') onStep(step, 'FAIL', error);
    return withPhase(error, `step:${step}`);
  }
}

const CONNECT_INTERNAL_CATEGORIES = Object.freeze(new Set([
  'TENANT_OR_USER_NOT_FOUND','DATABASE_USER_NOT_FOUND','INVALID_POOLER_USER',
  'POOLER_INTERNAL_ERROR','MAX_CLIENT_CONNECTIONS','OTHER_POSTGRES_INTERNAL_ERROR'
]));
const CODELESS_CONNECT_CATEGORIES = Object.freeze(new Set([
  'CA_CERT_FILE_ERROR','TLS_CERTIFICATE_VERIFY_ERROR','TLS_HOSTNAME_MISMATCH',
  'SSL_MODE_CONFIGURATION_ERROR','CONNECTION_STRING_PARSE_ERROR','PASSWORD_ENCODING_ERROR',
  'CLIENT_CONFIGURATION_ERROR','CONNECTION_TIMEOUT','UNKNOWN_CODELESS_CONNECT_ERROR'
]));

function classifyPostgresInternalConnectError(error) {
  if (String(error?.code || '').toUpperCase() !== 'XX000') return undefined;
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  if (/tenant\s+or\s+user\s+not\s+found/.test(message)) return 'TENANT_OR_USER_NOT_FOUND';
  if (/max(?:imum)?\s+client\s+connections(?:\s+reached)?/.test(message)) return 'MAX_CLIENT_CONNECTIONS';
  if (/database\s+user.*(?:not\s+found|does\s+not\s+exist)|role\s+.+\s+does\s+not\s+exist/.test(message)) return 'DATABASE_USER_NOT_FOUND';
  if (/invalid\s+(?:pooler\s+)?user|invalid\s+username|malformed\s+(?:pooler\s+)?user/.test(message)) return 'INVALID_POOLER_USER';
  if (/(?:pooler|supavisor).*(?:internal\s+error|unavailable)|internal\s+(?:pooler|supavisor)\s+error/.test(message)) return 'POOLER_INTERNAL_ERROR';
  return 'OTHER_POSTGRES_INTERNAL_ERROR';
}

function classifyCodelessConnectError(error) {
  if (error?.code !== undefined && error?.code !== null && String(error.code).length > 0) return undefined;
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  if (/supabase_ca_cert_|ca cert(?:ificate)? (?:file|path).*(?:missing|unreadable|invalid)|(?:read|open).*(?:ca|certificate).*(?:file|path)/.test(message)) return 'CA_CERT_FILE_ERROR';
  if (/hostname.*(?:does not match|mismatch)|(?:host|ip).*not in the cert|cert(?:ificate)? altname|subject alternative name/.test(message)) return 'TLS_HOSTNAME_MISMATCH';
  if (/unable to verify|certificate verify|self[- ]signed|unable to get issuer|certificate has expired|cert_has_expired|unable_to_verify_leaf_signature/.test(message)) return 'TLS_CERTIFICATE_VERIFY_ERROR';
  if (/sslmode_verify_full_required|ssl mode.*(?:invalid|required)|sslmode.*(?:invalid|required)|invalid ssl configuration/.test(message)) return 'SSL_MODE_CONFIGURATION_ERROR';
  if (/uri malformed|invalid percent[- ]encoding|malformed percent|decodeuricomponent|password.*(?:encode|encoding)/.test(message)) return 'PASSWORD_ENCODING_ERROR';
  if (/invalid_database_url|invalid (?:database|postgres(?:ql)?) (?:url|uri)|invalid connection string|invalid url|unsupported (?:url )?protocol/.test(message)) return 'CONNECTION_STRING_PARSE_ERROR';
  if (/pg_client_required|client password must be a string|invalid port|invalid sslnegotiation|client configuration|invalid client config/.test(message)) return 'CLIENT_CONFIGURATION_ERROR';
  if (/connection timeout|connect timeout|timed out|timeout expired/.test(message)) return 'CONNECTION_TIMEOUT';
  return 'UNKNOWN_CODELESS_CONNECT_ERROR';
}

function buildSafeConnectDiagnostic(error) {
  const code = safeIdentifier(error?.code, /^(?:[A-Z0-9_]+|[0-9A-Z]{5})$/) || 'NONE';
  const name = safeIdentifier(error?.name, /^[A-Za-z][A-Za-z0-9_.-]*$/) || 'NONE';
  const diagnostic = { code, name };
  const category = classifyPostgresInternalConnectError(error);
  if (category && CONNECT_INTERNAL_CATEGORIES.has(category)) diagnostic.category = category;
  else if (code === 'NONE') {
    const codelessCategory = classifyCodelessConnectError(error);
    diagnostic.category = CODELESS_CONNECT_CATEGORIES.has(codelessCategory)
      ? codelessCategory
      : 'UNKNOWN_CODELESS_CONNECT_ERROR';
  }
  return diagnostic;
}

function categorizePreflightError(error) {
  const code = String(error?.code || '').toUpperCase();
  const phase = String(error?.preflightPhase || '');
  if (code === 'DATABASE_URL_MISSING') return 'DATABASE_URL_MISSING';
  if (['SUPABASE_CA_CERT_PATH_MISSING','SUPABASE_CA_CERT_UNREADABLE','SUPABASE_CA_CERT_INVALID'].includes(code)) return 'SSL_CONFIGURATION_FAILURE';
  if (TLS_CODE_CATEGORIES[code]) return TLS_CODE_CATEGORIES[code];
  if (/^(ERR_)?TLS_|^(ERR_)?SSL_|CERT_|_CERT$/.test(code)) return 'TLS_FAILURE';
  if (code === 'ENOTFOUND') return 'DNS_NOT_FOUND';
  if (code === 'EAI_AGAIN') return 'DNS_TEMPORARY_FAILURE';
  if (code === '28P01' || code === '28000') return 'AUTHENTICATION_FAILED';
  if (code === '3D000') return 'INVALID_DATABASE';
  if (code === 'ECONNREFUSED') return 'CONNECTION_REFUSED';
  if (code === 'ENETUNREACH') return 'NETWORK_UNREACHABLE';
  if (code === 'EHOSTUNREACH') return 'HOST_UNREACHABLE';
  if (['ETIMEDOUT','ESOCKETTIMEDOUT'].includes(code)) return 'CONNECTION_TIMEOUT';
  if (['ECONNRESET','EPIPE'].includes(code)) return 'CONNECTION_RESET';
  if (phase.startsWith('query:') || (phase.startsWith('step:') && phase !== 'step:CONNECT')) return 'QUERY_FAILED';
  if (/^08[A-Z0-9]{3}$/.test(code)) return 'POSTGRES_CONNECTION_FAILURE';
  if (/^53[A-Z0-9]{3}$/.test(code)) return 'POSTGRES_RESOURCE_LIMIT';
  if (['57P01','57P02','57P03'].includes(code)) return 'POSTGRES_SERVER_SHUTDOWN';
  if (/^58[A-Z0-9]{3}$/.test(code)) return 'POSTGRES_SYSTEM_ERROR';
  if (/^XX[A-Z0-9]{3}$/.test(code)) return 'POSTGRES_INTERNAL_ERROR';
  if (/^[0-9A-Z]{5}$/.test(code)) return 'POSTGRES_ERROR';
  return 'UNKNOWN_CONNECTION_FAILURE';
}

function safeIdentifier(value, pattern, maxLength = 64) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) return undefined;
  return pattern.test(value) ? value : undefined;
}

function buildSafePreflightDiagnostic(error) {
  const diagnostic = {};
  const name = safeIdentifier(error?.name, /^[A-Za-z][A-Za-z0-9_.-]*$/);
  const code = safeIdentifier(error?.code, /^(?:[A-Z0-9_]+|[0-9A-Z]{5})$/);
  const syscall = safeIdentifier(error?.syscall, /^[A-Za-z][A-Za-z0-9_.-]*$/);
  if (name) diagnostic.name = name;
  if (code) diagnostic.code = code;
  const errno = error?.errno;
  if (typeof errno === 'number' && Number.isFinite(errno)) diagnostic.errno = errno;
  else if (typeof errno === 'string' && errno.length <= 32 && /^(?:-?\d+|[A-Z][A-Z0-9_]*)$/.test(errno)) diagnostic.errno = errno;
  if (syscall) diagnostic.syscall = syscall;
  diagnostic.CATEGORY = categorizePreflightError(error);
  return diagnostic;
}

function validateConnectionString(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch { throw new Error('invalid_database_url'); }
  if (!['postgres:','postgresql:'].includes(parsed.protocol)) throw new Error('invalid_database_url');
  if (parsed.searchParams.get('sslmode') !== 'verify-full') throw new Error('sslmode_verify_full_required');
  return String(value);
}

function buildVerifiedClientConfig(connectionString, caCertPath) {
  const safeConnectionString = validateConnectionString(connectionString);
  if (!caCertPath) {
    const error = new Error('supabase_ca_cert_path_required');
    error.code = 'SUPABASE_CA_CERT_PATH_MISSING';
    throw error;
  }
  let ca;
  try {
    ca = fs.readFileSync(caCertPath, 'utf8');
  } catch {
    const error = new Error('supabase_ca_cert_unreadable');
    error.code = 'SUPABASE_CA_CERT_UNREADABLE';
    throw error;
  }
  if (!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(ca)) {
    const error = new Error('supabase_ca_cert_invalid');
    error.code = 'SUPABASE_CA_CERT_INVALID';
    throw error;
  }

  // pg parses connectionString after the surrounding config and would replace
  // ssl.ca when sslmode is present. TLS policy was validated above; remove only
  // the parser-owned SSL fields and supply the verified TLS config explicitly.
  const parsed = new URL(safeConnectionString);
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl']) {
    parsed.searchParams.delete(key);
  }
  return {
    connectionString: parsed.toString(),
    ssl: { ca, rejectUnauthorized: true }
  };
}

async function runProductionDbPreflight({ connectionString, caCertPath, Client, targetOrderKey = TARGET_ORDER_KEY, onStep } = {}) {
  let client;
  try {
    await runStep('CONNECT', async () => {
      const clientConfig = buildVerifiedClientConfig(connectionString, caCertPath);
      if (typeof Client !== 'function') throw new Error('pg_client_required');
      client = new Client(clientConfig);
      await client.connect();
    }, onStep);
    await runStep('SELECT_1', () => client.query('select 1 as connection_ok'), onStep);
    const tables = [];
    await runStep('TABLE_EXISTENCE', async () => {
      for (const table of REVENUE_TABLES) {
        await client.query(`select 1 from public.${table} limit 0`);
        tables.push({ table, accessible: true });
      }
    }, onStep);
    const existing = await runStep('TARGET_ORDER_LOOKUP', () => client.query(
      'select 1 from public.commerce_revenue_orders where order_key = $1 limit 1',
      [targetOrderKey]
    ), onStep);
    return { connected:true, tables, targetOrderPreexists:Array.isArray(existing.rows) && existing.rows.length > 0 };
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

module.exports = { CONNECTION_ENV, CERT_ENV, TARGET_ORDER_KEY, REVENUE_TABLES, PREFLIGHT_STEPS, DIAGNOSTIC_CATEGORIES, CONNECT_INTERNAL_CATEGORIES, CODELESS_CONNECT_CATEGORIES, validateConnectionString, buildVerifiedClientConfig, categorizePreflightError, buildSafePreflightDiagnostic, classifyPostgresInternalConnectError, classifyCodelessConnectError, buildSafeConnectDiagnostic, runProductionDbPreflight };
