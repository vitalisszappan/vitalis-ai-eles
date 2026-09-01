'use strict';

const { validateRecommendationScope } = require('./product-intelligence-validator.cjs');

const EXACT_SCOPE_PARTS = ['productId', 'concernContext', 'applicationArea', 'recommendationRole'];

function normalizeScopeInput(input = {}) {
  const scope = {};
  for (const key of EXACT_SCOPE_PARTS) {
    const value = input && input[key];
    scope[key] = value === undefined || value === null ? '' : String(value).trim();
  }
  return scope;
}

function buildRecommendationScopeKey(input = {}) {
  const scope = normalizeScopeInput(input);
  const key = EXACT_SCOPE_PARTS.map((part) => scope[part]).join('|');
  return key;
}

function recordHasRequiredApprovals(record) {
  if (!record || typeof record !== 'object') return false;
  return ['ownerApproved', 'complianceApproved', 'customerAnswerApproved'].every((field) => record[field] === 'approved');
}

function recordMatchesExactScope(record, query) {
  const scopeKey = buildRecommendationScopeKey(query);
  const candidateKey = buildRecommendationScopeKey({
    productId: record && record.productId,
    concernContext: record && record.concernContext,
    applicationArea: record && record.applicationArea,
    recommendationRole: record && record.recommendationRole
  });
  return candidateKey === scopeKey;
}

function isUseableApprovedRecord(record) {
  if (!record || typeof record !== 'object') return false;
  if (record.lifecycle !== 'active') return false;
  if (record.conflictStatus === 'conflicted' || record.conflictStatus === 'unresolved') return false;
  if (record.eligibilityState !== 'approved') return false;
  const validation = validateRecommendationScope(record);
  if (!validation.valid || !validation.usable) return false;
  if (!recordHasRequiredApprovals(record)) return false;
  if (record.comparisonUse === true && record.comparisonApproved !== 'approved') return false;
  if (record.decisionSupportUse === true && record.decisionSupportApproved !== 'approved') return false;
  return true;
}

function isMatchingInvalidRecord(record) {
  if (!record || typeof record !== 'object') return true;
  const validation = validateRecommendationScope(record);
  if (!validation.valid || !validation.usable) return true;
  return false;
}

function classifyScopeRecord(record) {
  if (!record || typeof record !== 'object') {
    return { status: 'invalid', eligible: false, record: record || null, reasonCode: 'INVALID_RECORD' };
  }

  if (record.lifecycle === 'deprecated' || record.lifecycle === 'rejected') {
    return { status: 'invalid', eligible: false, record, reasonCode: 'REJECTED_RECORD' };
  }

  if (record.conflictStatus === 'conflicted' || record.conflictStatus === 'unresolved') {
    return { status: 'conflicted', eligible: false, record, reasonCode: 'CONFLICT' };
  }

  if (record.safetyInteraction === 'medical_escalation') {
    return { status: 'medical_escalation', eligible: false, record, reasonCode: 'MEDICAL_ESCALATION' };
  }

  const validation = validateRecommendationScope(record);
  if (!validation.valid || !validation.usable) {
    return { status: 'invalid', eligible: false, record, reasonCode: 'INVALID_RECORD' };
  }

  if (record.eligibilityState === 'prohibited') {
    return { status: 'prohibited', eligible: false, record, reasonCode: 'PROHIBITED' };
  }

  if (record.eligibilityState === 'unavailable') {
    return { status: 'unavailable', eligible: false, record, reasonCode: 'UNAVAILABLE' };
  }

  if (record.eligibilityState === 'approved') {
    if (!recordHasRequiredApprovals(record)) {
      return { status: 'invalid', eligible: false, record, reasonCode: 'INVALID_RECORD' };
    }
    if (record.comparisonUse === true && record.comparisonApproved !== 'approved') {
      return { status: 'invalid', eligible: false, record, reasonCode: 'INVALID_RECORD' };
    }
    if (record.decisionSupportUse === true && record.decisionSupportApproved !== 'approved') {
      return { status: 'invalid', eligible: false, record, reasonCode: 'INVALID_RECORD' };
    }
    if (record.safetyInteraction === 'medical_escalation') {
      return { status: 'medical_escalation', eligible: false, record, reasonCode: 'MEDICAL_ESCALATION' };
    }
    return { status: 'approved', eligible: true, record, reasonCode: null };
  }

  return { status: 'missing', eligible: false, record, reasonCode: 'MISSING' };
}

function determineRecommendationScopeResolution(records = []) {
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) {
    return { status: 'missing', eligible: false, record: null, reasonCode: 'MISSING', records: [] };
  }

  const prohibited = list.filter((record) => classifyScopeRecord(record).status === 'prohibited');
  if (prohibited.length > 0) {
    return { status: 'prohibited', eligible: false, record: prohibited[0], reasonCode: 'PROHIBITED', records: prohibited };
  }

  const unavailable = list.filter((record) => classifyScopeRecord(record).status === 'unavailable');
  if (unavailable.length > 0) {
    return { status: 'unavailable', eligible: false, record: unavailable[0], reasonCode: 'UNAVAILABLE', records: unavailable };
  }

  const invalid = list.filter((record) => classifyScopeRecord(record).status === 'invalid');
  if (invalid.length > 0) {
    return { status: 'invalid', eligible: false, record: invalid[0], reasonCode: 'INVALID_RECORD', records: invalid };
  }

  const conflicted = list.filter((record) => classifyScopeRecord(record).status === 'conflicted');
  if (conflicted.length > 0) {
    return { status: 'conflicted', eligible: false, record: conflicted[0], reasonCode: 'CONFLICT', records: conflicted };
  }

  const medicalEscalation = list.filter((record) => classifyScopeRecord(record).status === 'medical_escalation');
  if (medicalEscalation.length > 0) {
    return { status: 'medical_escalation', eligible: false, record: medicalEscalation[0], reasonCode: 'MEDICAL_ESCALATION', records: medicalEscalation };
  }

  const approved = list.filter((record) => classifyScopeRecord(record).status === 'approved');
  if (approved.length > 1) {
    return { status: 'conflicted', eligible: false, record: null, reasonCode: 'CONFLICT', records: approved };
  }
  if (approved.length === 1) {
    return { status: 'approved', eligible: true, record: approved[0], reasonCode: null, records: approved };
  }

  return { status: 'missing', eligible: false, record: null, reasonCode: 'MISSING', records: [] };
}

function resolveExactScopeRecords(matches, input) {
  const exactMatches = Array.isArray(matches) ? matches : [];
  if (exactMatches.length === 0) {
    return { status: 'missing', eligible: false, reasonCode: 'MISSING', record: null, scopeKey: buildRecommendationScopeKey(input), records: [] };
  }

  const prohibited = exactMatches.filter((record) => classifyScopeRecord(record).status === 'prohibited');
  if (prohibited.length > 0) {
    return { status: 'prohibited', eligible: false, reasonCode: 'PROHIBITED', record: prohibited[0], scopeKey: buildRecommendationScopeKey(input), records: prohibited };
  }

  const unavailable = exactMatches.filter((record) => classifyScopeRecord(record).status === 'unavailable');
  if (unavailable.length > 0) {
    return { status: 'unavailable', eligible: false, reasonCode: 'UNAVAILABLE', record: unavailable[0], scopeKey: buildRecommendationScopeKey(input), records: unavailable };
  }

  const invalid = exactMatches.filter((record) => classifyScopeRecord(record).status === 'invalid');
  if (invalid.length > 0) {
    return { status: 'invalid', eligible: false, reasonCode: 'INVALID_RECORD', record: invalid[0], scopeKey: buildRecommendationScopeKey(input), records: invalid };
  }

  const conflicted = exactMatches.filter((record) => classifyScopeRecord(record).status === 'conflicted');
  if (conflicted.length > 0) {
    return { status: 'conflicted', eligible: false, reasonCode: 'CONFLICT', record: conflicted[0], scopeKey: buildRecommendationScopeKey(input), records: conflicted };
  }

  const medicalEscalation = exactMatches.filter((record) => classifyScopeRecord(record).status === 'medical_escalation');
  if (medicalEscalation.length > 0) {
    return { status: 'medical_escalation', eligible: false, reasonCode: 'MEDICAL_ESCALATION', record: medicalEscalation[0], scopeKey: buildRecommendationScopeKey(input), records: medicalEscalation };
  }

  const approved = exactMatches.filter((record) => classifyScopeRecord(record).status === 'approved');
  if (approved.length > 1) {
    return { status: 'conflicted', eligible: false, reasonCode: 'CONFLICT', record: null, scopeKey: buildRecommendationScopeKey(input), records: approved };
  }
  if (approved.length === 1) {
    const record = approved[0];
    return { status: 'approved', eligible: true, reasonCode: null, record, scopeKey: buildRecommendationScopeKey(input), records: approved, allowedWording: record.allowedWording || record.allowedWordingId || null, limitations: Array.isArray(record.limitations) ? record.limitations : [], exclusions: Array.isArray(record.exclusions) ? record.exclusions : [] };
  }

  return { status: 'missing', eligible: false, reasonCode: 'MISSING', record: null, scopeKey: buildRecommendationScopeKey(input), records: [] };
}

class RecommendationScopeRepository {
  constructor(records = []) {
    this.records = Array.isArray(records) ? records.slice() : [];
    this.index = new Map();
    for (const record of this.records) {
      const key = buildRecommendationScopeKey({
        productId: record && record.productId,
        concernContext: record && record.concernContext,
        applicationArea: record && record.applicationArea,
        recommendationRole: record && record.recommendationRole
      });
      if (!key) continue;
      if (!this.index.has(key)) {
        this.index.set(key, []);
      }
      this.index.get(key).push(record);
    }
  }

  resolveExactScope(input = {}) {
    const scopeKey = buildRecommendationScopeKey(input);
    const matches = this.index.get(scopeKey) || [];
    return resolveExactScopeRecords(matches, input);
  }
}

function createRecommendationScopeRepository(records = []) {
  return new RecommendationScopeRepository(records);
}

module.exports = {
  EXACT_SCOPE_PARTS,
  buildRecommendationScopeKey,
  determineRecommendationScopeResolution,
  RecommendationScopeRepository,
  createRecommendationScopeRepository,
  resolveExactScopeRecords,
  recordMatchesExactScope,
  recordHasRequiredApprovals,
  isUseableApprovedRecord,
  isMatchingInvalidRecord
};
