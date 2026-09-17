'use strict';

// Dormant, single-field validation only. admissible is proposal admissibility,
// never permission, event/base validity, or reducer applicability/application.
// Supplied source locators and canonical identity attestations are not authenticated.
// Input uses value / candidates[{value,evidenceIds}] and optional productResolutions.
// Evidence productId binds identity/resolver backing; evidence disposition:'CLEAR'
// records explicit removal. sourceSpan uses UTF-16 [start,end) sourceText offsets.
const {
  CLOSED_FIELD_PATHS, CONCERNS, APPLICATION_AREA_VALUES, PRODUCT_TYPE_VALUES,
  GOAL_VALUES, QUALIFIER_KEYS, OWNERSHIP_STATES, PROVENANCE_SOURCE_TYPES
} = require('./conversation-decision-envelope-schema.cjs');
const { TRANSITION_OPERATIONS, TRANSITION_FIELD_PATHS } = require('./conversation-decision-transition-schema.cjs');
const { FIELD_PAYLOAD_POLICY, policyFor, isRecoveryOnly } = require('./conversation-decision-field-policy.cjs');

const PROPOSAL_VERSION = 1;
const PROPOSAL_DISPOSITIONS = Object.freeze([
  ...TRANSITION_OPERATIONS.filter((operation) => ['SET', 'CLEAR'].includes(operation)),
  'UNRESOLVED', ...TRANSITION_OPERATIONS.filter((operation) => operation === 'CONFLICT')
]);
const PROPOSAL_FIELD_PATHS = Object.freeze([
  'resolved.concernContext', 'resolved.applicationArea', 'resolved.requestedProductType',
  'resolved.productFocus', 'resolved.referencedProducts', 'explicit.concerns',
  'explicit.applicationAreas', 'explicit.products', 'explicit.goal',
  'explicit.qualifiers', 'derived.ownershipState'
]);
const VALUE_ENUMS = Object.freeze({
  'resolved.concernContext': CONCERNS, 'explicit.concerns': CONCERNS,
  'resolved.applicationArea': APPLICATION_AREA_VALUES, 'explicit.applicationAreas': APPLICATION_AREA_VALUES,
  'resolved.requestedProductType': PRODUCT_TYPE_VALUES,
  'explicit.goal': GOAL_VALUES, 'derived.ownershipState': OWNERSHIP_STATES
});
const PRODUCT_FIELDS = Object.freeze(['resolved.productFocus', 'resolved.referencedProducts', 'explicit.products']);
const REQUIRED = Object.freeze([
  'proposalVersion', 'proposalId', 'conversationId', 'turnId', 'producerId',
  'fieldPath', 'disposition', 'provenance', 'evidenceIds', 'evidence'
]);
const EVIDENCE_REQUIRED = Object.freeze(['evidenceId', 'sourceType', 'fieldPath', 'sourceTurnId', 'sourceReference']);
const EVIDENCE_OPTIONAL = Object.freeze([
  'producerId', 'supportEvidenceIds', 'resolverId', 'ruleId', 'sourceText', 'sourceSpan',
  'productId', 'disposition'
]);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const scalar = (value) => typeof value === 'string' || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value));

// Inspect descriptors before reading values: reject accessors, custom prototypes,
// symbols, sparse arrays, cycles and non-JSON values without invoking getters.
function jsonData(value, ancestors = new Set()) {
  if (value === null || scalar(value)) return true;
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  const array = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) return false;
  if (array && (keys.length !== value.length + 1 || !keys.every((key) => key === 'length'
    || /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length))) return false;
  ancestors.add(value);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !has(descriptor, 'value') || !jsonData(descriptor.value, ancestors)) return false;
  }
  ancestors.delete(value);
  return true;
}

function validateData(proposal) {
  const errors = [];
  const fail = (path, message) => errors.push(`${path}: ${message}`);
  function shape(value, required, optional, path) {
    if (!object(value)) { fail(path, 'must be an object'); return false; }
    for (const key of required) if (!has(value, key)) fail(`${path}.${key}`, 'required');
    for (const key of Object.keys(value).sort()) {
      if (!required.includes(key) && !optional.includes(key)) fail(`${path}.${key}`, 'unknown property');
    }
    return true;
  }
  function ids(value, path) {
    if (!Array.isArray(value) || value.length === 0 || value.some((id) => !text(id))
      || new Set(value).size !== value.length) {
      fail(path, 'must be nonempty unique evidence IDs'); return [];
    }
    return value;
  }
  if (!shape(proposal, REQUIRED, ['value', 'candidates', 'productResolutions', 'referenceResolutionStatus'], 'proposal')) return errors;
  if (proposal.proposalVersion !== PROPOSAL_VERSION) fail('proposal.proposalVersion', 'invalid version');
  for (const key of ['proposalId', 'conversationId', 'turnId', 'producerId']) {
    if (!text(proposal[key])) fail(`proposal.${key}`, 'must be a nonempty string');
  }
  const field = proposal.fieldPath;
  if (!PROPOSAL_FIELD_PATHS.includes(field) || !CLOSED_FIELD_PATHS.includes(field)
    || !TRANSITION_FIELD_PATHS.includes(field)) fail('proposal.fieldPath', 'unsupported field');
  const disposition = proposal.disposition;
  if (!PROPOSAL_DISPOSITIONS.includes(disposition)) fail('proposal.disposition', 'unsupported disposition');
  const establishing = ['SET', 'CLEAR', 'CONFLICT'].includes(disposition);
  const productField = PRODUCT_FIELDS.includes(field);
  const kind = FIELD_PAYLOAD_POLICY[field];
  const scalarField = ['SCALAR_STRING', 'OWNERSHIP_ENUM'].includes(kind);
  const roots = ids(proposal.evidenceIds, 'proposal.evidenceIds');
  const references = roots.map((id) => ({ id, path: 'proposal.evidenceIds' }));
  const anchors = [...roots];
  const direct = [];
  const productBindings = [];
  function useIds(value, path) {
    const list = ids(value, path);
    for (const id of list) { references.push({ id, path }); anchors.push(id); }
    return list;
  }
  function valueValid(value, path, diagnostic = false) {
    if (productField) {
      if (!text(value)) fail(path, 'must be a supplied product identifier');
    } else if (!VALUE_ENUMS[field]?.includes(value) || (!diagnostic && value === 'unknown'
      && ['resolved.applicationArea', 'explicit.applicationAreas'].includes(field))) {
      fail(path, 'not an established canonical value');
    }
  }

  const productValues = [];
  if (disposition === 'SET') {
    if (!has(proposal, 'value') || proposal.value === null) fail('proposal.value', 'SET requires a value');
    if (has(proposal, 'candidates')) fail('proposal.candidates', 'not allowed for SET');
    if (scalarField) {
      valueValid(proposal.value, 'proposal.value');
      if (productField) {
        productValues.push(proposal.value);
        productBindings.push({ value: proposal.value, evidenceIds: [proposal.provenance?.evidenceId], path: 'proposal.value' });
      }
    } else if (['VALUE_EVIDENCE', 'QUALIFIER_OBJECT'].includes(kind)) {
      if (!Array.isArray(proposal.value) || proposal.value.length === 0) fail('proposal.value', 'SET requires a nonempty list');
      else {
        const seen = new Set();
        proposal.value.forEach((entry, index) => {
          const path = `proposal.value[${index}]`;
          const qualifier = kind === 'QUALIFIER_OBJECT';
          if (!shape(entry, qualifier ? ['key', 'value', 'evidenceIds'] : ['value', 'evidenceIds'], [], path)) return;
          const entryIds = useIds(entry.evidenceIds, `${path}.evidenceIds`);
          direct.push(...entryIds.map((id) => ({ id, path: `${path}.evidenceIds` })));
          if (productField) productBindings.push({ value: entry.value, evidenceIds: entryIds, path });
          if (qualifier) {
            if (!QUALIFIER_KEYS.includes(entry.key)) fail(`${path}.key`, 'unknown qualifier');
            if (!scalar(entry.value) || entry.key === 'dry' && typeof entry.value !== 'boolean') fail(`${path}.value`, 'invalid qualifier scalar');
          } else {
            valueValid(entry.value, `${path}.value`);
            if (productField) productValues.push(entry.value);
          }
          const key = qualifier ? entry.key : entry.value;
          if (seen.has(key)) fail(path, 'duplicate field value/key');
          seen.add(key);
        });
      }
    }
  } else {
    if (has(proposal, 'value')) fail('proposal.value', 'only allowed for SET');
    if (disposition === 'CLEAR' && has(proposal, 'candidates')) fail('proposal.candidates', 'not allowed for CLEAR');
    if (disposition === 'CONFLICT' && !scalarField) fail('proposal.candidates', 'CONFLICT supports scalar fields only');
    if (disposition === 'CONFLICT' || has(proposal, 'candidates') && disposition === 'UNRESOLVED') {
      const candidates = proposal.candidates;
      if (!Array.isArray(candidates) || candidates.length < (disposition === 'CONFLICT' ? 2 : 1)) fail('proposal.candidates', 'insufficient candidates');
      else {
        const seen = new Set();
        candidates.forEach((candidate, index) => {
          const path = `proposal.candidates[${index}]`;
          if (!shape(candidate, ['value', 'evidenceIds'], [], path)) return;
          valueValid(candidate.value, `${path}.value`, disposition === 'UNRESOLVED');
          const candidateIds = useIds(candidate.evidenceIds, `${path}.evidenceIds`);
          if (disposition === 'CONFLICT') {
            direct.push(...candidateIds.map((id) => ({ id, path: `${path}.evidenceIds` })));
            if (productField) productBindings.push({ value: candidate.value, evidenceIds: candidateIds, path });
          }
          if (seen.has(candidate.value)) fail(path, 'duplicate candidate');
          seen.add(candidate.value);
          if (productField && disposition === 'CONFLICT') productValues.push(candidate.value);
        });
      }
    }
  }
  if (has(proposal, 'referenceResolutionStatus')) {
    if (!productField || !['resolved', 'unresolved', 'ambiguous'].includes(proposal.referenceResolutionStatus)) {
      fail('proposal.referenceResolutionStatus', 'invalid reference status');
    } else if ((disposition === 'SET' || disposition === 'CLEAR') && proposal.referenceResolutionStatus !== 'resolved') {
      fail('proposal.referenceResolutionStatus', 'establishment/removal requires resolved reference');
    } else if (disposition === 'CONFLICT' && proposal.referenceResolutionStatus !== 'ambiguous') {
      fail('proposal.referenceResolutionStatus', 'conflicting referents require ambiguous status');
    }
  }

  const records = new Map();
  const dependencies = new Map();
  if (!Array.isArray(proposal.evidence) || proposal.evidence.length === 0) fail('proposal.evidence', 'requires inline evidence');
  else proposal.evidence.forEach((record, index) => {
    const path = `proposal.evidence[${index}]`;
    if (!shape(record, EVIDENCE_REQUIRED, EVIDENCE_OPTIONAL, path)) return;
    for (const key of ['evidenceId', 'sourceReference']) if (!text(record[key])) fail(`${path}.${key}`, 'must be nonempty');
    if (!PROVENANCE_SOURCE_TYPES.includes(record.sourceType)) fail(`${path}.sourceType`, 'invalid source');
    if (record.fieldPath !== field) fail(`${path}.fieldPath`, 'must match proposal field');
    if (record.sourceTurnId !== null && !text(record.sourceTurnId)) fail(`${path}.sourceTurnId`, 'must be a turn ID or permitted null');
    if (record.sourceType === 'USER_EXPLICIT' && record.sourceTurnId !== proposal.turnId) fail(`${path}.sourceTurnId`, 'USER_EXPLICIT must identify current turn');
    if (record.sourceType === 'USER_EXPLICIT' && !text(record.sourceTurnId)) fail(`${path}.sourceTurnId`, 'current turn required');
    for (const key of ['producerId', 'resolverId', 'ruleId', 'productId']) {
      if (has(record, key) && !text(record[key])) fail(`${path}.${key}`, 'must be nonempty');
    }
    if (has(record, 'disposition') && record.disposition !== 'CLEAR') fail(`${path}.disposition`, 'only explicit CLEAR evidence is supported');
    if (record.disposition === 'CLEAR' && record.sourceType !== 'USER_EXPLICIT') fail(`${path}.disposition`, 'removal evidence must be USER_EXPLICIT');
    const derived = ['CANONICAL_RESOLUTION', 'PROBLEM_DOMAIN_DECISION'].includes(record.sourceType) || has(record, 'supportEvidenceIds');
    if (derived && !text(record.producerId)) fail(`${path}.producerId`, 'derived evidence requires producer');
    const support = derived ? ids(record.supportEvidenceIds, `${path}.supportEvidenceIds`) : [];
    if (record.sourceType === 'CANONICAL_RESOLUTION' && !text(record.resolverId)) fail(`${path}.resolverId`, 'resolution evidence requires resolver');
    if (has(record, 'resolverId') && !derived) fail(`${path}.supportEvidenceIds`, 'resolution evidence requires support');
    for (const id of support) references.push({ id, path: `${path}.supportEvidenceIds` });
    if (has(record, 'sourceText') && typeof record.sourceText !== 'string') fail(`${path}.sourceText`, 'must be a string');
    if (has(record, 'sourceSpan') && shape(record.sourceSpan, ['start', 'end'], [], `${path}.sourceSpan`)) {
      const { start, end } = record.sourceSpan;
      if (typeof record.sourceText !== 'string' || !Number.isInteger(start) || !Number.isInteger(end)
        || start < 0 || end < start || end > record.sourceText.length) fail(`${path}.sourceSpan`, 'invalid sourceText offsets');
    }
    if (records.has(record.evidenceId)) fail(`${path}.evidenceId`, 'duplicate evidence ID');
    else { records.set(record.evidenceId, record); dependencies.set(record.evidenceId, support); }
    if (establishing && isRecoveryOnly(record.sourceType)) fail(`${path}.sourceType`, 'recovery/unknown support is diagnostic only');
  });

  if (shape(proposal.provenance, ['sourceType', 'evidenceId', 'sourceTurnId'], [], 'proposal.provenance')) {
    const provenance = proposal.provenance;
    const primary = records.get(provenance.evidenceId);
    direct.push({ id: provenance.evidenceId, path: 'proposal.provenance' });
    if (!roots.includes(provenance.evidenceId) || !primary || primary.sourceType !== provenance.sourceType
      || primary.sourceTurnId !== provenance.sourceTurnId) fail('proposal.provenance', 'must match a root evidence record');
    if (establishing && (isRecoveryOnly(provenance.sourceType)
      || !['AUTHORITATIVE_WRITE', 'ADMISSIBLE_CANDIDATE'].includes(policyFor(field, provenance.sourceType)))) {
      fail('proposal.provenance.sourceType', 'forbidden establishing source for field');
    }
    if (disposition === 'CLEAR' && (provenance.sourceType !== 'USER_EXPLICIT'
      || provenance.sourceTurnId !== proposal.turnId || primary?.disposition !== 'CLEAR')) {
      fail('proposal.provenance', 'CLEAR requires current USER_EXPLICIT removal evidence');
    }
  }

  // productResolutions is proof data supplied upstream, never a lookup request.
  // Evidence productId explicitly binds identity and resolver attestations to the ID.
  function supports(from, target, seen = new Set()) {
    if (seen.has(from)) return false;
    seen.add(from);
    return (dependencies.get(from) || []).some((id) => id === target || supports(id, target, seen));
  }
  const proofs = proposal.productResolutions;
  if (productValues.length && (!Array.isArray(proofs) || proofs.length === 0)) fail('proposal.productResolutions', 'product establishment requires proof');
  if (has(proposal, 'productResolutions')) {
    if (!productField || !['SET', 'CONFLICT'].includes(disposition) || !Array.isArray(proofs) || proofs.length === 0) {
      fail('proposal.productResolutions', 'only allowed for established product values/candidates');
    } else {
      const proved = new Set();
      proofs.forEach((proof, index) => {
        const path = `proposal.productResolutions[${index}]`;
        if (!shape(proof, ['productId', 'status', 'resolverId', 'sourceReference', 'evidenceIds', 'identityEvidenceId'], [], path)) return;
        for (const key of ['productId', 'resolverId', 'sourceReference', 'identityEvidenceId']) if (!text(proof[key])) fail(`${path}.${key}`, 'must be nonempty');
        if (proof.status !== 'resolved') fail(`${path}.status`, 'requires resolved identity');
        if (!productValues.includes(proof.productId) || proved.has(proof.productId)) fail(`${path}.productId`, 'unmatched or duplicate product proof');
        proved.add(proof.productId);
        const proofIds = useIds(proof.evidenceIds, `${path}.evidenceIds`);
        direct.push(...proofIds.map((id) => ({ id, path: `${path}.evidenceIds` })));
        references.push({ id: proof.identityEvidenceId, path: `${path}.identityEvidenceId` });
        anchors.push(proof.identityEvidenceId);
        const identity = records.get(proof.identityEvidenceId);
        if (!identity || identity.productId !== proof.productId
          || !['APPROVED_PRODUCT_FACT', 'CANONICAL_RESOLUTION'].includes(identity.sourceType)) {
          fail(`${path}.identityEvidenceId`, 'requires matching canonical identity backing, not user intent');
        }
        const resolverIds = proofIds.filter((id) => {
          const record = records.get(id);
          return record?.sourceType === 'CANONICAL_RESOLUTION' && record.productId === proof.productId
            && record.resolverId === proof.resolverId && record.sourceReference === proof.sourceReference
            && id !== proof.identityEvidenceId && supports(id, proof.identityEvidenceId);
        });
        if (!resolverIds.length) fail(`${path}.evidenceIds`, 'requires matching canonical resolver evidence');
        for (const binding of productBindings.filter((entry) => entry.value === proof.productId)) {
          for (const id of [...binding.evidenceIds, ...proofIds]) {
            const record = records.get(id);
            if (!record || has(record, 'productId') && record.productId !== binding.value
              || !resolverIds.some((resolver) => resolver === id || supports(resolver, id))) {
              fail(`${binding.path}.evidenceIds`, 'product value evidence must bind to its matching resolution proof');
            }
          }
        }
      });
      for (const id of productValues) if (!proved.has(id)) fail('proposal.productResolutions', 'missing product proof');
    }
  }
  // Only direct value/candidate/resolution evidence establishes the field.
  // Dependencies (including identity facts) remain support, not field writes.
  for (const { id, path } of direct) {
    const record = records.get(id);
    if (!establishing || !record) continue;
    if (!['AUTHORITATIVE_WRITE', 'ADMISSIBLE_CANDIDATE'].includes(policyFor(field, record.sourceType))) {
      fail(path, 'forbidden direct establishing source for field');
    }
    if (['SET', 'CONFLICT'].includes(disposition) && record.disposition === 'CLEAR') {
      fail(path, 'removal evidence cannot establish a value');
    }
  }
  for (const reference of references) if (!records.has(reference.id)) fail(reference.path, 'dangling evidence ID');
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { fail('proposal.evidence', 'dependency cycle'); return; }
    if (visited.has(id) || !records.has(id)) return;
    visiting.add(id);
    for (const next of dependencies.get(id) || []) visit(next);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of anchors) visit(id);
  for (const id of records.keys()) {
    if (!visited.has(id)) { fail('proposal.evidence', 'unused detached evidence record'); visit(id); }
  }
  // Null is honest for external derivations only when every dependency also lacks
  // a turn. A derivation must not discard a known turn by claiming external origin.
  for (const [id, record] of records) {
    if (record.sourceTurnId !== null || isRecoveryOnly(record.sourceType)) continue;
    if (record.sourceType === 'USER_EXPLICIT') continue; // already rejected above
    const seen = new Set();
    function knownTurn(key) {
      if (seen.has(key)) return false;
      seen.add(key);
      return (dependencies.get(key) || []).some((next) => text(records.get(next)?.sourceTurnId) || knownTurn(next));
    }
    if (knownTurn(id)) fail('proposal.evidence.sourceTurnId', 'derived evidence cannot discard known source turn');
  }
  return errors;
}

function validateSemanticProposal(proposal) {
  let errors;
  try {
    errors = jsonData(proposal) ? validateData(proposal) : ['proposal: must contain only plain JSON data'];
  } catch {
    errors = ['proposal: malformed or excessively nested data'];
  }
  const valid = errors.length === 0;
  return { valid, admissible: valid && ['SET', 'CLEAR', 'CONFLICT'].includes(proposal.disposition), errors };
}

module.exports = { PROPOSAL_VERSION, PROPOSAL_DISPOSITIONS, PROPOSAL_FIELD_PATHS, validateSemanticProposal };
