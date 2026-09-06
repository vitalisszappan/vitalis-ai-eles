'use strict';

const {
  FACT_STATUSES, CONFLICT_STATUSES, APPROVAL_STATES
} = require('./product-intelligence-schema.cjs');
const {
  CRITERION_NODE_TYPES, CRITERION_OPERATORS, CRITERION_FIELDS, CONTROLLED_VALUES
} = require('./product-intelligence-selection-criterion-schema.cjs');

const REASON_CODES = Object.freeze({
  INVALID_CRITERION: 'INVALID_CRITERION',
  MISSING_CRITERION: 'MISSING_CRITERION',
  CRITERION_NO_MATCH: 'CRITERION_NO_MATCH',
  CRITERION_CONFLICT: 'CRITERION_CONFLICT'
});

function nonEmpty(value) { return typeof value === 'string' && value.trim().length > 0; }
function version(value) { return Number.isInteger(value) && value > 0; }
function provenance(value) { return value && nonEmpty(value.sourceType) && nonEmpty(value.sourceId); }
function approval(value) { return APPROVAL_STATES.includes(value); }

function validateLeaf(node, errors) {
  if (node.type !== 'LEAF') errors.push('criterion node type must be LEAF');
  if (!CRITERION_FIELDS.includes(node.field)) errors.push('criterion field is invalid');
  if (!CRITERION_OPERATORS.includes(node.operator)) errors.push('criterion operator is invalid');
  const allowed = CONTROLLED_VALUES[node.field] || [];
  const values = node.operator === 'EXACT' ? [node.value] : node.values;
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !allowed.includes(value))) errors.push('criterion value is invalid');
  if (node.operator === 'EXACT' && Array.isArray(node.values)) errors.push('EXACT cannot use values');
  if (node.operator === 'ANY_OF' && node.value !== undefined) errors.push('ANY_OF cannot use value');
}

function validateNode(node, errors, depth = 0) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) { errors.push('criterion node is required'); return; }
  if (!CRITERION_NODE_TYPES.includes(node.type)) { errors.push('criterion node type is invalid'); return; }
  if (depth > 8) { errors.push('criterion nesting is too deep'); return; }
  if (node.type === 'LEAF') return validateLeaf(node, errors);
  if (!Array.isArray(node.conditions) || node.conditions.length === 0) { errors.push(`${node.type} requires conditions`); return; }
  node.conditions.forEach((child) => validateNode(child, errors, depth + 1));
}

function validateSelectionCriterion(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { valid: false, errors: ['criterion set must be an object'], usable: false };
  if (!nonEmpty(record.criterionSetId)) errors.push('criterionSetId is required');
  if (!version(record.criterionSetVersion)) errors.push('criterionSetVersion must be a positive integer');
  if (!FACT_STATUSES.includes(record.lifecycle)) errors.push('lifecycle is invalid');
  if (!CONFLICT_STATUSES.includes(record.conflictStatus)) errors.push('conflictStatus is invalid');
  if (!provenance(record.provenance)) errors.push('provenance identity is required');
  if (!approval(record.ownerApproved)) errors.push('ownerApproved is invalid');
  if (!approval(record.complianceApproved)) errors.push('complianceApproved is invalid');
  if (!Array.isArray(record.alternatives) || record.alternatives.length === 0) errors.push('alternatives are required');
  else record.alternatives.forEach((node) => validateNode(node, errors));
  if (record.lifecycle === 'active' && !['none', 'duplicate'].includes(record.conflictStatus)) errors.push('active criterion cannot have unresolved conflict');
  if (record.supersedes !== undefined && (!Array.isArray(record.supersedes) || record.supersedes.some((id) => !nonEmpty(id)))) errors.push('supersedes is malformed');
  return { valid: errors.length === 0, errors, usable: errors.length === 0 && record.lifecycle === 'active' && record.conflictStatus === 'none' };
}

function evaluateNode(node, state) {
  if (node.type === 'LEAF') {
    const actual = state?.[node.field];
    if (actual === undefined || actual === null || actual === 'unknown') return 'UNKNOWN';
    if (node.operator === 'EXACT') return actual === node.value ? 'MATCH' : 'NO_MATCH';
    if (node.operator === 'ANY_OF') return node.values.includes(actual) ? 'MATCH' : 'NO_MATCH';
  }
  const results = node.conditions.map((child) => evaluateNode(child, state));
  if (node.type === 'ALL') return results.every((result) => result === 'MATCH') ? 'MATCH' : results.some((result) => result === 'NO_MATCH') ? 'NO_MATCH' : 'UNKNOWN';
  return results.some((result) => result === 'MATCH') ? 'MATCH' : results.every((result) => result === 'NO_MATCH') ? 'NO_MATCH' : 'UNKNOWN';
}

function evaluateSelectionCriterion(record, state) {
  const validation = validateSelectionCriterion(record);
  if (!validation.valid) return { status: REASON_CODES.INVALID_CRITERION, matched: false, errors: validation.errors };
  const result = record.alternatives.map((node) => evaluateNode(node, state));
  if (result.includes('MATCH')) return { status: 'MATCH', matched: true, errors: [] };
  return { status: result.includes('UNKNOWN') ? REASON_CODES.MISSING_CRITERION : REASON_CODES.CRITERION_NO_MATCH, matched: false, errors: [] };
}

function resolveMatchingCriteria(records, state) {
  const usable = (Array.isArray(records) ? records : []).filter((record) => validateSelectionCriterion(record).usable);
  const matches = usable.filter((record) => evaluateSelectionCriterion(record, state).matched);
  if (matches.length > 1) return { status: REASON_CODES.CRITERION_CONFLICT, records: matches };
  if (matches.length === 1) return { status: 'MATCH', record: matches[0], records: matches };
  return { status: REASON_CODES.CRITERION_NO_MATCH, records: [] };
}

module.exports = { REASON_CODES, validateSelectionCriterion, evaluateSelectionCriterion, resolveMatchingCriteria };