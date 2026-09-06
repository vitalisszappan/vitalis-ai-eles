'use strict';

const { REVIEW_SCOPES, REVIEW_DECISIONS } = require('./product-intelligence-governance-review-schema.cjs');

function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function version(value) { return Number.isInteger(value) && value > 0; }
function timestamp(value) { return text(value) && !Number.isNaN(Date.parse(value)); }

function validateGovernanceReviewRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { valid: false, errors: ['review record must be an object'], usable: false };
  for (const field of ['reviewRecordId', 'targetRecordType', 'targetRecordId', 'reviewerId']) if (!text(record[field])) errors.push(`${field} is required`);
  if (!version(record.targetVersion)) errors.push('targetVersion must be a positive integer');
  if (!REVIEW_SCOPES.includes(record.reviewScope)) errors.push('reviewScope is invalid');
  if (!REVIEW_DECISIONS.includes(record.decision)) errors.push('decision is invalid');
  if (!timestamp(record.reviewedAt)) errors.push('reviewedAt is invalid');
  if (/^(?:ai|codex|copilot|bot|assistant)(?:$|[:_-])/i.test(String(record.reviewerId || ''))) errors.push('AI reviewer is not permitted');
  if (record.evidenceRefs !== undefined && (!Array.isArray(record.evidenceRefs) || record.evidenceRefs.some((value) => !text(value)))) errors.push('evidenceRefs is invalid');
  if (record.supersedesReviewRecordId === record.reviewRecordId || record.revokesReviewRecordId === record.reviewRecordId) errors.push('review cannot reference itself');
  return { valid: errors.length === 0, errors, usable: errors.length === 0 && record.decision === 'approved' };
}

function resolveGovernanceReviews(records, target) {
  const matches = (Array.isArray(records) ? records : []).filter((record) => record.targetRecordType === target?.targetRecordType && record.targetRecordId === target?.targetRecordId && record.targetVersion === target?.targetVersion && record.reviewScope === target?.reviewScope && validateGovernanceReviewRecord(record).usable);
  if (matches.length > 1) return { status: 'REVIEW_CONFLICT', records: matches };
  if (matches.length === 0) return { status: 'REVIEW_UNAVAILABLE', records: [] };
  return { status: 'APPROVED', record: matches[0], records: matches };
}

module.exports = { validateGovernanceReviewRecord, resolveGovernanceReviews };