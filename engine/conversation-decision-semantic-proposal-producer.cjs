'use strict';

// R4A2G — pure, dormant packaging of one already-established semantic fact.
// This module creates no semantic, identity, provenance, recommendation, or
// execution authority; canonical proposal validity remains owned downstream.
const { PROPOSAL_VERSION, validateSemanticProposal } = require('./conversation-decision-semantic-proposal-contract.cjs');

const SEMANTIC_PROPOSAL_PRODUCER_VERSION = 1;
const PRODUCTION_STATUSES = Object.freeze(['PRODUCED', 'UNRESOLVED', 'REJECTED']);
const PRODUCTION_REASON_CODES = Object.freeze([
  'INVALID_INPUT', 'INVALID_IDENTIFIERS', 'INVALID_ESTABLISHED_FACT',
  'INVALID_PROPOSAL', 'UNRESOLVED_FACT'
]);
const INPUT_KEYS = Object.freeze(['proposalId', 'conversationId', 'turnId', 'producerId', 'fact']);
const FACT_REQUIRED_KEYS = Object.freeze([
  'fieldPath', 'disposition', 'provenance', 'evidenceIds', 'evidence'
]);
const FACT_OPTIONAL_KEYS = Object.freeze([
  'value', 'candidates', 'productResolutions', 'referenceResolutionStatus'
]);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

// Capture exactly once without invoking caller-owned accessors. All semantic
// processing below reads only this owned plain-data representation.
function captureData(value, seen = new Set()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite contract number');
    return value;
  }
  if (typeof value !== 'object') throw new Error('unsupported contract value');
  if (seen.has(value)) throw new Error('cyclic contract data');
  seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string')) throw new Error('symbol contract key');
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || descriptors.length?.value !== value.length) {
        throw new Error('invalid contract array');
      }
      const keys = Object.keys(descriptors).filter((key) => key !== 'length');
      if (keys.length !== value.length) throw new Error('sparse contract array');
      return keys.map((key, index) => {
        const descriptor = descriptors[String(index)];
        if (key !== String(index) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new Error('invalid contract array entry');
        }
        return captureData(descriptor.value, seen);
      });
    }
    if (!plainObject(value)) throw new Error('non-plain contract object');
    const output = {};
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('accessor contract value');
      output[key] = captureData(descriptor.value, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function exactKeys(value, required, optional = []) {
  if (!plainObject(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function result(status, reasonCode, proposal = null, errors = []) {
  return { status, reasonCode, proposal, errors: Array.isArray(errors) ? [...errors] : [] };
}
function reject(reasonCode, errors) { return result('REJECTED', reasonCode, null, errors); }

function produceSemanticProposal(rawInput) {
  let input;
  try { input = captureData(rawInput); } catch { return reject('INVALID_INPUT', ['input must contain only closed plain data']); }
  if (!exactKeys(input, INPUT_KEYS) || Object.keys(input).length !== INPUT_KEYS.length) {
    return reject('INVALID_INPUT', ['input must be a closed producer input object']);
  }
  if (!['proposalId', 'conversationId', 'turnId', 'producerId'].every((key) => text(input[key]))) {
    return reject('INVALID_IDENTIFIERS', ['all producer identifiers must be nonempty strings']);
  }
  if (!exactKeys(input.fact, FACT_REQUIRED_KEYS, FACT_OPTIONAL_KEYS)) {
    return reject('INVALID_ESTABLISHED_FACT', ['fact must have the canonical closed property set']);
  }

  const proposal = {
    proposalVersion: PROPOSAL_VERSION,
    proposalId: input.proposalId,
    conversationId: input.conversationId,
    turnId: input.turnId,
    producerId: input.producerId
  };
  for (const key of [...FACT_REQUIRED_KEYS, ...FACT_OPTIONAL_KEYS]) {
    if (Object.hasOwn(input.fact, key)) proposal[key] = input.fact[key];
  }

  let validation;
  try { validation = validateSemanticProposal(proposal); } catch {
    return reject('INVALID_PROPOSAL', ['canonical proposal validation failed closed']);
  }
  if (!validation || validation.valid !== true) {
    return reject('INVALID_PROPOSAL', validation?.errors);
  }
  if (proposal.disposition === 'UNRESOLVED') {
    return result('UNRESOLVED', 'UNRESOLVED_FACT', captureData(proposal));
  }
  return result('PRODUCED', null, captureData(proposal));
}

module.exports = {
  produceSemanticProposal,
  SEMANTIC_PROPOSAL_PRODUCER_VERSION,
  PRODUCTION_STATUSES,
  PRODUCTION_REASON_CODES
};
