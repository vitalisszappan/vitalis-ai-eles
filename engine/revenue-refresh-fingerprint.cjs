'use strict';

const { createHash } = require('node:crypto');

function required(value, code) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(code);
  return text;
}

// capturedAt is deliberately excluded: repeated reads of the same authoritative
// lifecycle state must be an idempotent no-op, regardless of observation time.
function canonicalRefreshIdentity(evidence = {}) {
  return JSON.stringify({
    schemaVersion: Number(evidence.schemaVersion),
    orderKey: required(evidence.orderKey, 'invalid_order_key'),
    orderId: required(evidence.orderId, 'invalid_order_id'),
    status: required(evidence.status, 'invalid_status'),
    statusId: required(evidence.statusId, 'invalid_status_id'),
    statusType: required(evidence.statusType, 'invalid_status_type'),
    currency: required(evidence.currency, 'invalid_currency')
  });
}

function createRefreshFingerprint(evidence) {
  const canonicalInput = canonicalRefreshIdentity(evidence);
  return createHash('sha256').update(canonicalInput, 'utf8').digest('hex');
}

module.exports = { canonicalRefreshIdentity, createRefreshFingerprint };
