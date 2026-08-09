'use strict';

function sanitizeTechnicalErrorText(value, maxLength = 500) {
  let text = String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
  text = text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\bsb_secret_[A-Za-z0-9_-]+\b/g, '[redacted-secret]')
    .replace(/\beyJ[A-Za-z0-9._-]{20,}\b/g, '[redacted-token]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted-token]')
    .replace(/\b(?:apikey|authorization|service[_ -]?role[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted-secret]')
    .replace(/\+?\d[\d ()-]{7,}\d/g, '[redacted-phone]');
  return text.slice(0, Math.max(0, maxLength));
}

function formatSanitizedRequestError(error, metadata = {}) {
  const fields = [
    ['operation', metadata.operation || error?.operation || 'unknown', 80],
    ['table', metadata.table || error?.table || 'unknown', 80],
    ['name', error?.name || 'Error', 80],
    ['status', error?.status || 'n/a', 20],
    ['code', error?.supabaseCode || error?.code || 'n/a', 40],
    ['method', error?.method || 'n/a', 12],
    ['pathname', error?.pathname || 'n/a', 300],
    ['message', error?.supabaseMessage || '', 300],
    ['details', error?.supabaseDetails || '', 500]
  ];
  return fields.filter(([, value]) => value !== '').map(([key, value, limit]) => `${key}=${sanitizeTechnicalErrorText(value, limit)}`).join(' ');
}

function formatCommerceOutcomeDiagnostic(event = {}) {
  const allowedPhases=new Set(['outcome_build_failed','outcome_validation_failed','outcome_mapping_failed','supabase_insert_failed','supabase_insert_succeeded']);
  const fields=[['phase',allowedPhases.has(event.phase)?event.phase:'unknown',40],['outcomeId',event.outcomeId||'n/a',50],['attributionId',event.attributionId||'n/a',50],['orderKey',event.orderKey||'n/a',100],['schemaVersion',event.schemaVersion??'n/a',10],['timestamp',event.timestamp||'n/a',40]];
  const base=fields.map(([key,value,limit])=>`${key}=${sanitizeTechnicalErrorText(value,limit)}`).join(' ');
  return event.error?`${base} ${formatSanitizedRequestError(event.error,{operation:'commerce_outcome_insert',table:'commerce_outcomes'})}`:base;
}

module.exports = { sanitizeTechnicalErrorText, formatSanitizedRequestError, formatCommerceOutcomeDiagnostic };
