'use strict';

const { CONFLICT_STATUSES, APPROVAL_STATES } = require('./product-intelligence-schema.cjs');
const { WORDING_MODES, WORDING_LIFECYCLES, CONTROLLED_SLOT_VALUE_TYPES } = require('./product-intelligence-wording-artifact-schema.cjs');

function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function version(value) { return Number.isInteger(value) && value > 0; }
function approval(value) { return APPROVAL_STATES.includes(value); }

function validateWordingArtifact(artifact) {
  const errors = [];
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return { valid: false, errors: ['wording artifact must be an object'], usable: false };
  if (!text(artifact.wordingId)) errors.push('wordingId is required');
  if (!version(artifact.version)) errors.push('version must be a positive integer');
  if (!text(artifact.locale)) errors.push('locale is required');
  if (!WORDING_MODES.includes(artifact.mode)) errors.push('mode is invalid');
  if (!WORDING_LIFECYCLES.includes(artifact.lifecycle)) errors.push('lifecycle is invalid');
  if (!CONFLICT_STATUSES.includes(artifact.conflictStatus)) errors.push('conflictStatus is invalid');
  if (!artifact.provenance || !text(artifact.provenance.sourceType) || !text(artifact.provenance.sourceId)) errors.push('provenance identity is required');
  if (!approval(artifact.ownerApproved) || artifact.ownerApproved !== 'approved') errors.push('ownerApproved must be approved');
  if (!approval(artifact.complianceApproved) || artifact.complianceApproved !== 'approved') errors.push('complianceApproved must be approved');
  if (!approval(artifact.customerAnswerApproved) || artifact.customerAnswerApproved !== 'approved') errors.push('customerAnswerApproved must be approved');
  if (artifact.mode === 'EXACT_TEXT' && !text(artifact.exactText)) errors.push('EXACT_TEXT requires exactText');
  if (artifact.mode === 'CLOSED_TEMPLATE') {
    if (!text(artifact.template)) errors.push('CLOSED_TEMPLATE requires template');
    if (!Array.isArray(artifact.slots)) errors.push('CLOSED_TEMPLATE requires slots');
    else for (const slot of artifact.slots) if (!text(slot.name) || !CONTROLLED_SLOT_VALUE_TYPES.includes(slot.valueType) || (slot.allowedValues !== undefined && (!Array.isArray(slot.allowedValues) || slot.allowedValues.some((value) => !text(value))))) errors.push('template slot is invalid');
  }
  if (artifact.lifecycle === 'active' && !['none', 'duplicate'].includes(artifact.conflictStatus)) errors.push('active wording cannot have unresolved conflict');
  return { valid: errors.length === 0, errors, usable: errors.length === 0 && artifact.lifecycle === 'active' && artifact.conflictStatus === 'none' };
}

function resolveWordingArtifacts(artifacts, reference) {
  const matches = (Array.isArray(artifacts) ? artifacts : []).filter((artifact) => artifact.wordingId === reference?.wordingId && artifact.version === reference?.version && artifact.locale === reference?.locale && validateWordingArtifact(artifact).usable);
  if (matches.length > 1) return { status: 'WORDING_CONFLICT', artifacts: matches };
  if (matches.length === 0) return { status: 'WORDING_UNAVAILABLE', artifacts: [] };
  return { status: 'AUTHORIZED', artifact: matches[0], artifacts: matches };
}

module.exports = { validateWordingArtifact, resolveWordingArtifacts };