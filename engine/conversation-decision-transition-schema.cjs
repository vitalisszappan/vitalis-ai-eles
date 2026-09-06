'use strict';

const {
  PROVENANCE_SOURCE_TYPES,
  OWNERSHIP_STATES,
  AUTHORIZATION_STATUSES
} = require('./conversation-decision-envelope-schema.cjs');

const R4A2A_VERSION = 1;
const TRANSITION_OPERATIONS = Object.freeze(['UNSET', 'SET', 'CLEAR', 'CONFLICT', 'INVALIDATE']);
const TRANSITION_EVENT_TYPES = Object.freeze(['FIELD_TRANSITION', 'OWNERSHIP_TRANSITION', 'GOVERNANCE_INVALIDATION']);
const TRANSITION_FIELD_PATHS = Object.freeze([
  'explicit.concerns', 'explicit.applicationAreas', 'explicit.products', 'explicit.goal', 'explicit.qualifiers',
  'explicit.complaintState', 'explicit.safetySignals', 'resolved.productFocus', 'resolved.referencedProducts',
  'resolved.problemDomain', 'resolved.concernContext', 'resolved.applicationArea', 'resolved.requestedProductType',
  'resolved.commerceIntent', 'resolved.complaintIntent', 'resolved.safetyClass', 'derived.ownershipState',
  'governance.scopeId', 'governance.scopeVersion', 'governance.criterionSetId', 'governance.criterionSetVersion',
  'governance.bindingId', 'governance.bindingVersion', 'governance.reviewRecordId', 'governance.wordingArtifactId',
  'governance.wordingArtifactVersion', 'governance.wordingLocale', 'governance.authorizationStatus',
  'governance.authorizationReason', 'governance.authorizedProductIds', 'governance.authorizationEvidenceIds'
]);
const TRANSITION_BOUNDARY_TYPES = Object.freeze(['safety', 'medical', 'complaint', 'topic', 'governance', 'system']);
const TRANSITION_REASON_CODES = Object.freeze([
  'CURRENT_TURN_REPLACEMENT', 'EXPLICIT_CLEAR', 'EVIDENCE_CONFLICT', 'DEPENDENCY_INVALIDATED',
  'GOVERNANCE_VERSION_CHANGED', 'OWNERSHIP_BOUNDARY', 'STALE_BASE_STATE', 'REPLAY_CONFLICT'
]);
const EVENT_ID_FORMAT = Object.freeze({ type: 'string', required: true, generated: false });

module.exports = {
  R4A2A_VERSION,
  TRANSITION_OPERATIONS,
  TRANSITION_EVENT_TYPES,
  TRANSITION_FIELD_PATHS,
  TRANSITION_BOUNDARY_TYPES,
  TRANSITION_REASON_CODES,
  EVENT_ID_FORMAT,
  PROVENANCE_SOURCE_TYPES,
  OWNERSHIP_STATES,
  AUTHORIZATION_STATUSES
};