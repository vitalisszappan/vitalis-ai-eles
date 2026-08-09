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

module.exports = { sanitizeTechnicalErrorText, formatSanitizedRequestError };
