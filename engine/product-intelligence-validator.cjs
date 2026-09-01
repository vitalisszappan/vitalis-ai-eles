'use strict';

const { PRODUCTS } = require('./product-catalog.cjs');
const {
  APPROVAL_STATES, APPROVAL_SCOPES, FACT_STATUSES, CONFLICT_STATUSES, DIMENSIONS,
  PRODUCT_CLASSIFICATIONS, SCOPE_TYPES, JURISDICTIONS, REGULATORY_AUTHORITIES,
  REGULATORY_EVIDENCE_STATES, PUBLIC_CLAIM_KINDS, CLAIM_CATEGORIES,
  CLAIM_DISPOSITIONS, AUTHORIZATION_STATUSES, CONCERNS, APPLICATION_AREAS,
  RECOMMENDATION_ROLES, ELIGIBILITY_STATES, SAFETY_INTERACTIONS,
  STRUCTURED_OUTPUT_ENFORCEMENT
} = require('./product-intelligence-schema.cjs');

function isNonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
function isPlainObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function isPlaceholder(value) { return /^(?:unknown|n\/a|none|null|undefined|tbd)$/i.test(String(value || '').trim()); }

function matchesValueType(value, valueType) {
  if (valueType === 'money') return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (valueType === 'currency') return isNonEmptyString(value) && /^[A-Z]{3}$/.test(value);
  if (valueType === 'enum' || valueType === 'instruction') return isNonEmptyString(value);
  if (valueType === 'string_list' || valueType === 'enum_list') return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
  if (valueType === 'ingredient_list') return Array.isArray(value) && value.length > 0 && value.every((item) => isPlainObject(item) && isNonEmptyString(item.rawName) && isNonEmptyString(item.ingredientId));
  if (valueType === 'claim_list') return Array.isArray(value) && value.length > 0 && value.every((item) => isPlainObject(item) && isNonEmptyString(item.claim));
  return false;
}

function validTimestamp(value) { return isNonEmptyString(value) && !Number.isNaN(Date.parse(value)); }
function validRecordId(value) { return isNonEmptyString(value); }
function validApproval(value) { return APPROVAL_STATES.includes(value); }
function validEvidenceIds(value) { return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString); }

function validateGovernedBase(record, errors) {
  if (!validRecordId(record.recordId)) errors.push('recordId must be a non-empty string');
  if (!FACT_STATUSES.includes(record.lifecycle)) errors.push('lifecycle is invalid');
  if (!CONFLICT_STATUSES.includes(record.conflictStatus)) errors.push('conflictStatus is invalid');
  if (!isPlainObject(record.provenance) || !isNonEmptyString(record.provenance.sourceType) || !isNonEmptyString(record.provenance.sourceId)) errors.push('provenance identity is required');
  if (!validApproval(record.ownerApproved)) errors.push('ownerApproved is invalid');
  if (!validApproval(record.complianceApproved)) errors.push('complianceApproved is invalid');
  if (!validApproval(record.customerAnswerApproved)) errors.push('customerAnswerApproved is invalid');
  if (!validApproval(record.comparisonApproved)) errors.push('comparisonApproved is invalid');
  if (!validApproval(record.decisionSupportApproved)) errors.push('decisionSupportApproved is invalid');
  if (record.effectiveAt !== undefined && !validTimestamp(record.effectiveAt)) errors.push('effectiveAt is malformed');
  if (record.reviewedAt !== undefined && !validTimestamp(record.reviewedAt)) errors.push('reviewedAt is malformed');
  if (record.supersedes !== undefined && (!Array.isArray(record.supersedes) || record.supersedes.some((id) => !isNonEmptyString(id)))) errors.push('supersedes is malformed');
  if (record.supersedes?.includes(record.recordId)) errors.push('record cannot supersede itself');
  if (record.lifecycle === 'active' && !['none', 'duplicate'].includes(record.conflictStatus)) errors.push('active record cannot have unresolved conflict');
}

function governedResult(errors, record) {
  const usable = errors.length === 0 && record.lifecycle === 'active' && record.conflictStatus === 'none';
  return { valid: errors.length === 0, errors, usable };
}

function validateProductClassification(record) {
  const errors = [];
  if (!isPlainObject(record)) return { valid: false, errors: ['record must be an object'], usable: false };
  validateGovernedBase(record, errors);
  if (!SCOPE_TYPES.includes(record.scopeType) || !['product', 'product_class'].includes(record.scopeType)) errors.push('scopeType is invalid for product classification');
  if (!PRODUCT_CLASSIFICATIONS.includes(record.classification)) errors.push('classification is invalid');
  if (record.scopeType === 'product' && !isNonEmptyString(record.productId)) errors.push('product scope requires productId');
  if (record.scopeType === 'product_class' && !isNonEmptyString(record.productClassScope)) errors.push('product_class scope requires productClassScope');
  if (record.classification === 'unknown' && record.customerAnswerApproved === 'approved') errors.push('unknown classification cannot authorize customer-visible cosmetic claim');
  const result = governedResult(errors, record);
  return { ...result, usable: result.usable && record.classification !== 'unknown' };
}

function validateRegulatoryStatus(record) {
  const errors = [];
  if (!isPlainObject(record)) return { valid: false, errors: ['record must be an object'], usable: false };
  validateGovernedBase(record, errors);
  if (!SCOPE_TYPES.includes(record.scopeType)) errors.push('scopeType is invalid');
  if (record.scopeType === 'product' && !isNonEmptyString(record.productId)) errors.push('product scope requires productId');
  if (!JURISDICTIONS.includes(record.jurisdiction)) errors.push('jurisdiction is invalid');
  if (!REGULATORY_AUTHORITIES.includes(record.authority)) errors.push('authority is invalid');
  if (!REGULATORY_EVIDENCE_STATES.includes(record.evidenceState)) errors.push('evidenceState is invalid');
  if (!PUBLIC_CLAIM_KINDS.includes(record.publicClaimKind)) errors.push('publicClaimKind is invalid');
  if (record.evidenceState === 'evidenced' && record.provenance?.sourceType !== 'authoritative') errors.push('evidenced regulatory status requires authoritative provenance');
  if (record.evidenceState === 'evidenced' && !validTimestamp(record.effectiveAt)) errors.push('evidenced regulatory status requires effectiveAt');
  if (record.evidenceState === 'evidenced' && !validTimestamp(record.reviewedAt)) errors.push('evidenced regulatory status requires reviewedAt');
  if (record.evidenceState === 'evidenced' && record.publicClaimKind === 'authority_status' && !isNonEmptyString(record.allowedPublicWording)) errors.push('evidenced public authority claim requires allowedPublicWording');
  if (record.publicClaimKind === 'authority_status' && record.complianceApproved !== 'approved') errors.push('authority-specific public claim requires compliance approval');
  if (record.publicClaimKind === 'authority_status' && record.customerAnswerApproved !== 'approved') errors.push('authority-specific public claim requires customer answer approval');
  if (record.publicClaimKind === 'authority_status' && record.evidenceState !== 'evidenced') errors.push('unknown or not_proven status cannot authorize authority output');
  return governedResult(errors, record);
}

function validateClaimPolicy(record) {
  const errors = [];
  if (!isPlainObject(record)) return { valid: false, errors: ['record must be an object'], usable: false };
  validateGovernedBase(record, errors);
  if (!CLAIM_CATEGORIES.includes(record.claimCategory)) errors.push('claimCategory is invalid');
  if (!CLAIM_DISPOSITIONS.includes(record.defaultDisposition)) errors.push('defaultDisposition is invalid');
  if (!STRUCTURED_OUTPUT_ENFORCEMENT.includes(record.structuredOutputEnforcement)) errors.push('structuredOutputEnforcement is invalid');
  if (['diagnosis', 'treatment_cure', 'therapeutic'].includes(record.claimCategory) && record.defaultDisposition !== 'prohibited') errors.push('medical claim categories must default to prohibited');
  return governedResult(errors, record);
}

function validateClaimAuthorization(record, regulatoryStatus = null, policy = null) {
  const errors = [];
  if (!isPlainObject(record)) return { valid: false, errors: ['record must be an object'], usable: false };
  validateGovernedBase(record, errors);
  if (!AUTHORIZATION_STATUSES.includes(record.authorizationStatus)) errors.push('authorizationStatus is invalid');
  if (!CLAIM_CATEGORIES.includes(record.claimCategory)) errors.push('claimCategory is invalid');
  if (!validEvidenceIds(record.evidenceRecordIds)) errors.push('authorization requires evidenceRecordIds');
  if (!isNonEmptyString(record.allowedWordingId)) errors.push('authorization requires allowedWordingId');
  if (['diagnosis', 'treatment_cure', 'therapeutic'].includes(record.claimCategory) && record.authorizationStatus === 'authorized') errors.push('medical claim categories cannot be authorized');
  if (policy?.requiresComplianceApproval && record.complianceApproved !== 'approved') errors.push('authorization cannot bypass compliance approval');
  if (policy?.requiresCustomerAnswerApproval && record.customerAnswerApproved !== 'approved') errors.push('authorization cannot bypass customer answer approval');
  if (record.claimCategory === 'regulatory_authority' && (!regulatoryStatus || !validateRegulatoryStatus(regulatoryStatus).usable || regulatoryStatus.evidenceState !== 'evidenced')) errors.push('regulatory authority authorization requires usable RegulatoryStatus evidence');
  return governedResult(errors, record);
}

function validateConcernBoundary(record) {
  const errors = [];
  if (!isPlainObject(record)) return { valid: false, errors: ['record must be an object'], usable: false };
  validateGovernedBase(record, errors);
  if (!CONCERNS.includes(record.concern)) errors.push('concern is invalid');
  if (!CLAIM_DISPOSITIONS.includes(record.medicalClaimDisposition)) errors.push('medicalClaimDisposition is invalid');
  if (!CLAIM_DISPOSITIONS.includes(record.diagnosisDisposition)) errors.push('diagnosisDisposition is invalid');
  if (!CLAIM_DISPOSITIONS.includes(record.treatmentCureDisposition)) errors.push('treatmentCureDisposition is invalid');
  if (!SAFETY_INTERACTIONS.includes(record.defaultSafetyInteraction)) errors.push('defaultSafetyInteraction is invalid');
  if (record.medicalClaimDisposition !== 'prohibited' || record.diagnosisDisposition !== 'prohibited' || record.treatmentCureDisposition !== 'prohibited') errors.push('concern boundary cannot authorize medical, diagnosis, or treatment claims');
  if (record.recommendationAuthorizationId !== undefined) errors.push('concern recognition cannot create recommendation authorization');
  return governedResult(errors, record);
}

function validateRecommendationScope(record) {
  const errors = [];
  if (!isPlainObject(record)) return { valid: false, errors: ['record must be an object'], usable: false };
  validateGovernedBase(record, errors);
  if (!isNonEmptyString(record.productId)) errors.push('productId is required');
  if (!CONCERNS.includes(record.concernContext)) errors.push('concernContext is invalid');
  if (!APPLICATION_AREAS.includes(record.applicationArea)) errors.push('applicationArea is invalid');
  if (!RECOMMENDATION_ROLES.includes(record.recommendationRole)) errors.push('recommendationRole is invalid');
  if (!ELIGIBILITY_STATES.includes(record.eligibilityState)) errors.push('eligibilityState is invalid');
  if (!SAFETY_INTERACTIONS.includes(record.safetyInteraction)) errors.push('safetyInteraction is invalid');
  if (record.eligibilityState === 'approved' && !isNonEmptyString(record.allowedWordingId)) errors.push('approved scope requires allowedWordingId');
  if (record.eligibilityState === 'approved' && !validEvidenceIds(record.evidenceRecordIds)) errors.push('approved scope requires evidenceRecordIds');
  if (record.decisionSupportUse === true && record.decisionSupportApproved !== 'approved') errors.push('decision-support use requires decisionSupport approval');
  if (record.comparisonUse === true && record.comparisonApproved !== 'approved') errors.push('comparison use requires comparison approval');
  if (record.safetyInteraction === 'medical_escalation' && record.eligibilityState === 'approved') errors.push('medical escalation cannot be overridden by recommendation eligibility');
  return governedResult(errors, record);
}

function validateProductFact(fact, products = PRODUCTS) {
  const errors = [];
  if (!isPlainObject(fact)) return { valid: false, errors: ['fact must be an object'], runtimeEligible: false };
  if (!isNonEmptyString(fact.factId)) errors.push('factId must be a non-empty string');
  if (fact.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!isNonEmptyString(fact.canonicalProductId) || !products[fact.canonicalProductId]) errors.push('canonicalProductId is unknown');
  const definition = DIMENSIONS[fact.dimension];
  if (!definition) errors.push('dimension is unknown');
  if (fact.valueType !== definition?.valueType) errors.push('valueType does not match dimension');
  if (!matchesValueType(fact.value, fact.valueType)) errors.push('value does not match valueType');
  if (!FACT_STATUSES.includes(fact.status)) errors.push('status is invalid');
  if (!isPlainObject(fact.source) || !isNonEmptyString(fact.source.sourceType) || !isNonEmptyString(fact.source.sourceId)) errors.push('source identity is required');
  if (isPlaceholder(fact.source?.sourceType) || isPlaceholder(fact.source?.sourceId)) errors.push('source identity cannot be a placeholder');
  if (fact.source?.location !== undefined && (!isPlainObject(fact.source.location) || !isNonEmptyString(fact.source.location.kind) || !isNonEmptyString(fact.source.location.path))) errors.push('source location is malformed');
  if (fact.source?.capturedAt !== undefined && (!isNonEmptyString(fact.source.capturedAt) || Number.isNaN(Date.parse(fact.source.capturedAt)))) errors.push('capturedAt is malformed');
  if (!isPlainObject(fact.approval)) errors.push('approval is required');
  for (const scope of APPROVAL_SCOPES) if (!APPROVAL_STATES.includes(fact.approval?.[scope])) errors.push(`approval.${scope} is invalid`);
  if (typeof fact.approved === 'boolean') errors.push('generic approved is not an authorization field');
  if (fact.approval?.reviewerId !== undefined && !isNonEmptyString(fact.approval.reviewerId)) errors.push('reviewerId is malformed');
  if (fact.approval?.reviewedAt !== undefined && (!isNonEmptyString(fact.approval.reviewedAt) || Number.isNaN(Date.parse(fact.approval.reviewedAt)))) errors.push('reviewedAt is malformed');
  if (!Number.isInteger(fact.version) || fact.version < 1) errors.push('version must be a positive integer');
  if (!Array.isArray(fact.supersedes) || fact.supersedes.some((id) => !isNonEmptyString(id))) errors.push('supersedes must be an array of non-empty fact IDs');
  if (fact.supersedes?.includes(fact.factId)) errors.push('fact cannot supersede itself');
  if (!CONFLICT_STATUSES.includes(fact.conflictStatus)) errors.push('conflictStatus is invalid');
  if (fact.status === 'active' && !['none', 'duplicate'].includes(fact.conflictStatus)) errors.push('active fact cannot have unresolved conflict');
  if (fact.approval?.comparison === 'approved' && !definition?.comparisonCapable) errors.push('dimension does not allow comparison approval');
  if (fact.approval?.decisionSupport === 'approved' && !definition?.decisionSupportCapable) errors.push('dimension does not allow decision support approval');
  if (fact.runtimeEligible === true && fact.status !== 'active') errors.push('non-active fact cannot be runtime eligible');
  return { valid: errors.length === 0, errors, runtimeEligible: errors.length === 0 && fact.status === 'active' && fact.conflictStatus === 'none' };
}

module.exports = {
  matchesValueType,
  validateProductFact,
  validateProductClassification,
  validateRegulatoryStatus,
  validateClaimPolicy,
  validateClaimAuthorization,
  validateConcernBoundary,
  validateRecommendationScope
};