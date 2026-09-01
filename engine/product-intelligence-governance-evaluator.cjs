'use strict';

const { CONCERNS } = require('./product-intelligence-schema.cjs');
const {
  validateProductClassification,
  validateRegulatoryStatus,
  validateClaimPolicy,
  validateClaimAuthorization,
  validateConcernBoundary,
  validateRecommendationScope
} = require('./product-intelligence-validator.cjs');

const REQUIRED_APPROVALS = Object.freeze(['ownerApproved', 'complianceApproved']);
const CUSTOMER_ANSWER_APPROVALS = Object.freeze([...REQUIRED_APPROVALS, 'customerAnswerApproved']);

function denied(claimCategory, reasonCode, overrides = {}) {
  return { authorized: false, status: 'prohibited', reasonCode, claimCategory, supportingRecordIds: [], allowedWording: null, limitations: [], enforcement: 'block', ...overrides };
}

function approved(record, approvals = REQUIRED_APPROVALS) {
  return approvals.every((field) => record?.[field] === 'approved');
}

function usable(record, validate, approvals = REQUIRED_APPROVALS) {
  const validation = validate(record);
  return { validation, usable: validation.usable && approved(record, approvals) };
}

function selectSingle(records, matches, validate, approvals) {
  const candidates = (Array.isArray(records) ? records : []).filter(matches);
  if (candidates.some((record) => record?.conflictStatus === 'conflicted' || record?.conflictStatus === 'unresolved')) return { record: null, reasonCode: 'CONFLICT' };
  const usableRecords = candidates.filter((record) => usable(record, validate, approvals).usable);
  if (usableRecords.length > 1) return { record: null, reasonCode: 'CONFLICT' };
  if (usableRecords.length === 1) return { record: usableRecords[0], reasonCode: null };
  return { record: null, reasonCode: candidates.length ? 'UNUSABLE_RECORD' : 'MISSING_RECORD' };
}

function resolveProductClassification({ productId, productClassScope = null, records = [] } = {}) {
  const product = selectSingle(records, (record) => record?.scopeType === 'product' && record.productId === productId, validateProductClassification, REQUIRED_APPROVALS);
  if (product.record) return { classification: product.record.classification, status: 'usable', reasonCode: null, supportingRecordIds: [product.record.recordId], authorizationUsable: true };
  if (product.reasonCode === 'CONFLICT') return { classification: 'unknown', status: 'conflicted', reasonCode: 'CONFLICT', supportingRecordIds: [], authorizationUsable: false };
  const productClass = selectSingle(records, (record) => record?.scopeType === 'product_class' && record.productClassScope === productClassScope, validateProductClassification, REQUIRED_APPROVALS);
  if (productClass.record) return { classification: productClass.record.classification, status: 'usable', reasonCode: null, supportingRecordIds: [productClass.record.recordId], authorizationUsable: true };
  return { classification: 'unknown', status: productClass.reasonCode === 'CONFLICT' ? 'conflicted' : 'unknown', reasonCode: productClass.reasonCode === 'CONFLICT' ? 'CONFLICT' : 'UNKNOWN', supportingRecordIds: [], authorizationUsable: false };
}

function resolveRegulatoryStatus({ productId, scopeType = 'product', jurisdiction, authority, records = [] } = {}) {
  const selected = selectSingle(records, (record) => record?.scopeType === scopeType && record.productId === productId && record.jurisdiction === jurisdiction && record.authority === authority, validateRegulatoryStatus, CUSTOMER_ANSWER_APPROVALS);
  if (!selected.record) return { evidenceState: 'unknown', publicClaimAuthorized: false, reasonCode: selected.reasonCode === 'CONFLICT' ? 'CONFLICT' : 'REGULATORY_STATUS_UNAVAILABLE', supportingRecordIds: [], allowedWording: null, enforcement: 'block' };
  return { evidenceState: selected.record.evidenceState, publicClaimAuthorized: selected.record.publicClaimKind === 'authority_status', reasonCode: null, supportingRecordIds: [selected.record.recordId], allowedWording: selected.record.allowedPublicWording || null, enforcement: 'allow' };
}

function evaluateClaimAuthorization({ claimCategory, policies = [], authorizations = [], regulatoryStatus = null } = {}) {
  if (['diagnosis', 'treatment_cure', 'therapeutic'].includes(claimCategory)) return denied(claimCategory, 'PROHIBITED_CLAIM_CATEGORY');
  const policy = selectSingle(policies, (record) => record?.claimCategory === claimCategory, validateClaimPolicy, REQUIRED_APPROVALS);
  if (!policy.record) return denied(claimCategory, policy.reasonCode === 'CONFLICT' ? 'CONFLICT' : 'MISSING_POLICY');
  if (policy.record.defaultDisposition !== 'allowed_with_authorization') return denied(claimCategory, 'PROHIBITED_CLAIM_CATEGORY', { supportingRecordIds: [policy.record.recordId] });
  const authorization = selectSingle(authorizations, (record) => record?.claimCategory === claimCategory && record.authorizationStatus === 'authorized', (record) => validateClaimAuthorization(record, regulatoryStatus, policy.record), CUSTOMER_ANSWER_APPROVALS);
  if (!authorization.record) return denied(claimCategory, authorization.reasonCode === 'CONFLICT' ? 'CONFLICT' : 'MISSING_AUTHORIZATION', { supportingRecordIds: [policy.record.recordId] });
  if (claimCategory === 'regulatory_authority' && !validateRegulatoryStatus(regulatoryStatus).usable) return denied(claimCategory, 'REGULATORY_STATUS_UNAVAILABLE', { supportingRecordIds: [policy.record.recordId] });
  return { authorized: true, status: 'authorized', reasonCode: null, claimCategory, supportingRecordIds: [policy.record.recordId, authorization.record.recordId, ...(claimCategory === 'regulatory_authority' ? [regulatoryStatus.recordId] : [])], allowedWording: claimCategory === 'regulatory_authority' ? regulatoryStatus.allowedPublicWording : authorization.record.allowedWordingId, limitations: [], enforcement: 'allow' };
}

function evaluateConcernBoundary({ concern, safetyInteraction = 'none', records = [] } = {}) {
  const recognized = CONCERNS.includes(concern);
  if (!recognized) return { recognized: false, cosmeticDiscussionPermitted: false, recommendationScopeRequired: true, medicalEscalationRequired: false, prohibitedClaimCategories: ['diagnosis', 'treatment_cure', 'therapeutic'], reasonCode: 'UNKNOWN_CONCERN' };
  if (safetyInteraction === 'medical_escalation') return { recognized: true, cosmeticDiscussionPermitted: false, recommendationScopeRequired: true, medicalEscalationRequired: true, prohibitedClaimCategories: ['diagnosis', 'treatment_cure', 'therapeutic'], reasonCode: 'MEDICAL_ESCALATION' };
  const selected = selectSingle(records, (record) => record?.concern === concern, validateConcernBoundary, REQUIRED_APPROVALS);
  if (!selected.record) return { recognized: true, cosmeticDiscussionPermitted: false, recommendationScopeRequired: true, medicalEscalationRequired: false, prohibitedClaimCategories: ['diagnosis', 'treatment_cure', 'therapeutic'], reasonCode: selected.reasonCode === 'CONFLICT' ? 'CONFLICT' : 'BOUNDARY_UNAVAILABLE' };
  const escalation = selected.record.defaultSafetyInteraction === 'medical_escalation';
  return { recognized: true, cosmeticDiscussionPermitted: selected.record.cosmeticDiscussionPermitted === true && !escalation, recommendationScopeRequired: true, medicalEscalationRequired: escalation, prohibitedClaimCategories: ['diagnosis', 'treatment_cure', 'therapeutic'], reasonCode: escalation ? 'MEDICAL_ESCALATION' : null, supportingRecordIds: [selected.record.recordId] };
}

function evaluateRecommendationScope({ productId, concernContext, applicationArea, recommendationRole, safetyInteraction = 'none', records = [] } = {}) {
  if (safetyInteraction === 'medical_escalation') return { eligible: false, status: 'prohibited', reasonCode: 'MEDICAL_ESCALATION', supportingRecordIds: [], allowedWording: null };
  const selected = selectSingle(records, (record) => record?.productId === productId && record.concernContext === concernContext && record.applicationArea === applicationArea && record.recommendationRole === recommendationRole, validateRecommendationScope, CUSTOMER_ANSWER_APPROVALS);
  if (!selected.record) return { eligible: false, status: 'unavailable', reasonCode: selected.reasonCode === 'CONFLICT' ? 'CONFLICT' : 'RECOMMENDATION_SCOPE_UNAVAILABLE', supportingRecordIds: [], allowedWording: null };
  if (selected.record.eligibilityState !== 'approved' || selected.record.safetyInteraction === 'medical_escalation') return { eligible: false, status: selected.record.eligibilityState, reasonCode: selected.record.safetyInteraction === 'medical_escalation' ? 'MEDICAL_ESCALATION' : 'RECOMMENDATION_SCOPE_NOT_APPROVED', supportingRecordIds: [selected.record.recordId], allowedWording: null };
  return { eligible: true, status: 'approved', reasonCode: null, supportingRecordIds: [selected.record.recordId], allowedWording: selected.record.allowedWordingId };
}

module.exports = { resolveProductClassification, resolveRegulatoryStatus, evaluateClaimAuthorization, evaluateConcernBoundary, evaluateRecommendationScope };