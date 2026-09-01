'use strict';

const { evaluateRecommendationScope } = require('./product-intelligence-governance-evaluator.cjs');

const REQUIRED_DIMENSIONS = ['productId', 'concernContext', 'applicationArea', 'recommendationRole'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeInput(input = {}) {
  const normalized = {};
  for (const key of REQUIRED_DIMENSIONS) {
    const value = input && input[key];
    normalized[key] = value === undefined || value === null ? '' : String(value).trim();
  }
  return normalized;
}

function buildScopeKey(scope) {
  return REQUIRED_DIMENSIONS.map((key) => scope[key] || '').join('|');
}

function createAdapterResult({
  status,
  authorized,
  reasonCode,
  scopeKey,
  productId,
  concernContext,
  applicationArea,
  recommendationRole,
  repositoryStatus,
  evaluatorStatus,
  records,
  record,
  allowedWording,
  limitations,
  exclusions,
  safetyInteraction,
  provenance,
  repositoryResult,
  evaluatorResult
}) {
  return {
    status,
    authorized,
    reasonCode,
    scopeKey,
    productId,
    concernContext,
    applicationArea,
    recommendationRole,
    repositoryStatus,
    evaluatorStatus,
    records: Array.isArray(records) ? records.slice() : [],
    record: record || null,
    allowedWording: allowedWording || null,
    limitations: Array.isArray(limitations) ? limitations.slice() : [],
    exclusions: Array.isArray(exclusions) ? exclusions.slice() : [],
    safetyInteraction: safetyInteraction || null,
    provenance: provenance || null,
    repositoryResult: repositoryResult || null,
    evaluatorResult: evaluatorResult || null
  };
}

function resolveRecommendationAuthorization(input = {}, repository = null) {
  const payload = input && typeof input === 'object' ? input : {};
  const repoInstance = repository || payload.repository || null;
  const normalized = normalizeInput(payload);
  const scopeKey = buildScopeKey(normalized);

  if (!REQUIRED_DIMENSIONS.every((key) => isNonEmptyString(normalized[key]))) {
    return createAdapterResult({
      status: 'INVALID',
      authorized: false,
      reasonCode: 'MISSING_REQUIRED_DIMENSION',
      scopeKey,
      productId: normalized.productId,
      concernContext: normalized.concernContext,
      applicationArea: normalized.applicationArea,
      recommendationRole: normalized.recommendationRole,
      repositoryStatus: 'invalid',
      evaluatorStatus: 'not_run',
      records: [],
      record: null,
      allowedWording: null,
      limitations: [],
      exclusions: [],
      safetyInteraction: null,
      provenance: null,
      repositoryResult: null,
      evaluatorResult: null
    });
  }

  const repositoryResult = repoInstance && typeof repoInstance.resolveExactScope === 'function'
    ? repoInstance.resolveExactScope(normalized)
    : null;

  if (!repositoryResult) {
    return createAdapterResult({
      status: 'MISSING',
      authorized: false,
      reasonCode: 'REPOSITORY_MISSING',
      scopeKey,
      productId: normalized.productId,
      concernContext: normalized.concernContext,
      applicationArea: normalized.applicationArea,
      recommendationRole: normalized.recommendationRole,
      repositoryStatus: 'missing',
      evaluatorStatus: 'not_run',
      records: [],
      record: null,
      allowedWording: null,
      limitations: [],
      exclusions: [],
      safetyInteraction: null,
      provenance: null,
      repositoryResult: null,
      evaluatorResult: null
    });
  }

  const exactMatches = Array.isArray(repositoryResult.records) ? repositoryResult.records : [];
  const matchedRecord = repositoryResult.record || null;

  if (repositoryResult.status === 'prohibited' || repositoryResult.status === 'unavailable') {
    return createAdapterResult({
      status: 'DENIED',
      authorized: false,
      reasonCode: repositoryResult.status,
      scopeKey,
      productId: normalized.productId,
      concernContext: normalized.concernContext,
      applicationArea: normalized.applicationArea,
      recommendationRole: normalized.recommendationRole,
      repositoryStatus: repositoryResult.status,
      evaluatorStatus: 'not_run',
      records: exactMatches,
      record: matchedRecord,
      allowedWording: matchedRecord && matchedRecord.allowedWording ? matchedRecord.allowedWording : null,
      limitations: matchedRecord && Array.isArray(matchedRecord.limitations) ? matchedRecord.limitations : [],
      exclusions: matchedRecord && Array.isArray(matchedRecord.exclusions) ? matchedRecord.exclusions : [],
      safetyInteraction: matchedRecord && matchedRecord.safetyInteraction ? matchedRecord.safetyInteraction : null,
      provenance: matchedRecord && matchedRecord.provenance ? matchedRecord.provenance : null,
      repositoryResult,
      evaluatorResult: null
    });
  }

  if (repositoryResult.status === 'invalid' || repositoryResult.status === 'conflicted' || repositoryResult.status === 'missing') {
    return createAdapterResult({
      status: repositoryResult.status === 'conflicted' ? 'CONFLICT' : repositoryResult.status === 'missing' ? 'MISSING' : 'INVALID',
      authorized: false,
      reasonCode: repositoryResult.reasonCode || repositoryResult.status,
      scopeKey,
      productId: normalized.productId,
      concernContext: normalized.concernContext,
      applicationArea: normalized.applicationArea,
      recommendationRole: normalized.recommendationRole,
      repositoryStatus: repositoryResult.status,
      evaluatorStatus: 'not_run',
      records: exactMatches,
      record: matchedRecord,
      allowedWording: matchedRecord && matchedRecord.allowedWording ? matchedRecord.allowedWording : null,
      limitations: matchedRecord && Array.isArray(matchedRecord.limitations) ? matchedRecord.limitations : [],
      exclusions: matchedRecord && Array.isArray(matchedRecord.exclusions) ? matchedRecord.exclusions : [],
      safetyInteraction: matchedRecord && matchedRecord.safetyInteraction ? matchedRecord.safetyInteraction : null,
      provenance: matchedRecord && matchedRecord.provenance ? matchedRecord.provenance : null,
      repositoryResult,
      evaluatorResult: null
    });
  }

  if (repositoryResult.status === 'medical_escalation') {
    return createAdapterResult({
      status: 'MEDICAL_ESCALATION',
      authorized: false,
      reasonCode: 'MEDICAL_ESCALATION',
      scopeKey,
      productId: normalized.productId,
      concernContext: normalized.concernContext,
      applicationArea: normalized.applicationArea,
      recommendationRole: normalized.recommendationRole,
      repositoryStatus: 'medical_escalation',
      evaluatorStatus: 'not_run',
      records: exactMatches,
      record: matchedRecord,
      allowedWording: matchedRecord && matchedRecord.allowedWording ? matchedRecord.allowedWording : null,
      limitations: matchedRecord && Array.isArray(matchedRecord.limitations) ? matchedRecord.limitations : [],
      exclusions: matchedRecord && Array.isArray(matchedRecord.exclusions) ? matchedRecord.exclusions : [],
      safetyInteraction: matchedRecord && matchedRecord.safetyInteraction ? matchedRecord.safetyInteraction : 'medical_escalation',
      provenance: matchedRecord && matchedRecord.provenance ? matchedRecord.provenance : null,
      repositoryResult,
      evaluatorResult: null
    });
  }

  const scopeRecords = Array.isArray(exactMatches) ? exactMatches : [];
  const evaluatorInput = { productId: normalized.productId, concernContext: normalized.concernContext, applicationArea: normalized.applicationArea, recommendationRole: normalized.recommendationRole, records: scopeRecords, safetyInteraction: input.safetyInteraction || (matchedRecord ? matchedRecord.safetyInteraction : 'none') };
  const evaluatorResult = evaluateRecommendationScope(evaluatorInput);

  if (evaluatorResult.eligible && evaluatorResult.status === 'approved') {
    return createAdapterResult({
      status: 'AUTHORIZED',
      authorized: true,
      reasonCode: null,
      scopeKey,
      productId: normalized.productId,
      concernContext: normalized.concernContext,
      applicationArea: normalized.applicationArea,
      recommendationRole: normalized.recommendationRole,
      repositoryStatus: repositoryResult.status,
      evaluatorStatus: evaluatorResult.status,
      records: scopeRecords,
      record: matchedRecord,
      allowedWording: matchedRecord && matchedRecord.allowedWording ? matchedRecord.allowedWording : (evaluatorResult.allowedWording || null),
      limitations: matchedRecord && Array.isArray(matchedRecord.limitations) ? matchedRecord.limitations : [],
      exclusions: matchedRecord && Array.isArray(matchedRecord.exclusions) ? matchedRecord.exclusions : [],
      safetyInteraction: matchedRecord && matchedRecord.safetyInteraction ? matchedRecord.safetyInteraction : (input.safetyInteraction || null),
      provenance: matchedRecord && matchedRecord.provenance ? matchedRecord.provenance : null,
      repositoryResult,
      evaluatorResult
    });
  }

  const escalationDetected = (evaluatorResult && evaluatorResult.reasonCode === 'MEDICAL_ESCALATION') ||
    (matchedRecord && matchedRecord.safetyInteraction === 'medical_escalation') ||
    (input && input.safetyInteraction === 'medical_escalation');

  return createAdapterResult({
    status: escalationDetected ? 'MEDICAL_ESCALATION' : 'DENIED',
    authorized: false,
    reasonCode: escalationDetected ? 'MEDICAL_ESCALATION' : (evaluatorResult && evaluatorResult.reasonCode ? evaluatorResult.reasonCode : 'EVALUATOR_DENIED'),
    scopeKey,
    productId: normalized.productId,
    concernContext: normalized.concernContext,
    applicationArea: normalized.applicationArea,
    recommendationRole: normalized.recommendationRole,
    repositoryStatus: repositoryResult.status,
    evaluatorStatus: evaluatorResult && evaluatorResult.status ? evaluatorResult.status : 'denied',
    records: scopeRecords,
    record: matchedRecord,
    allowedWording: matchedRecord && matchedRecord.allowedWording ? matchedRecord.allowedWording : null,
    limitations: matchedRecord && Array.isArray(matchedRecord.limitations) ? matchedRecord.limitations : [],
    exclusions: matchedRecord && Array.isArray(matchedRecord.exclusions) ? matchedRecord.exclusions : [],
    safetyInteraction: matchedRecord && matchedRecord.safetyInteraction ? matchedRecord.safetyInteraction : (input.safetyInteraction || null),
    provenance: matchedRecord && matchedRecord.provenance ? matchedRecord.provenance : null,
    repositoryResult,
    evaluatorResult
  });
}

module.exports = {
  REQUIRED_DIMENSIONS,
  normalizeInput,
  buildScopeKey,
  resolveRecommendationAuthorization
};
