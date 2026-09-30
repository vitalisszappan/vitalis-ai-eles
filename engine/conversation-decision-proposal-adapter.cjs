'use strict';

// R4A2C — pure, dormant semantic-proposal admission. This layer validates and
// mechanically compiles one proposal into one transition; it performs no
// semantic recognition, lookup, authorization, persistence, or runtime wiring.
const { validateEnvelope } = require('./conversation-decision-envelope-schema.cjs');
const { R4A2A_VERSION } = require('./conversation-decision-transition-schema.cjs');
const { validateTransitionEvent } = require('./conversation-decision-transition-validator.cjs');
const { validateSemanticProposal } = require('./conversation-decision-semantic-proposal-contract.cjs');
const { reduceDecisionEnvelope } = require('./conversation-decision-reducer.cjs');

const ADMISSION_STATUSES = Object.freeze([
  'ADMITTED', 'UNRESOLVED', 'REJECTED', 'REDUCER_REJECTED'
]);
const ADMISSION_REASON_CODES = Object.freeze([
  'INVALID_INPUT', 'INVALID_ENVELOPE', 'INVALID_PROPOSAL', 'CONVERSATION_MISMATCH',
  'UNRESOLVED_PROPOSAL', 'INVALID_TRANSITION', 'STALE_BASE', 'FUTURE_BASE', 'INVALID_BASE'
]);
const INPUT_KEYS = Object.freeze([
  'currentEnvelope', 'proposal', 'eventId', 'eventVersion', 'baseEnvelopeVersion', 'baseStateVersion'
]);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value)) result[key] = clone(value[key]);
    return result;
  }
  return value;
}

// Capture contract data without executing accessors. Validators may accept an
// otherwise valid object containing a stateful getter, so all later reads use a
// descriptor-derived snapshot rather than caller-owned nested structures.
function captureData(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) throw new Error('cyclic contract data');
  seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string')) throw new Error('symbol contract key');
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype
        || descriptors.length?.value !== value.length) throw new Error('invalid contract array');
      const keys = Object.keys(descriptors).filter((key) => key !== 'length');
      if (keys.length !== value.length) throw new Error('sparse contract array');
      return keys.map((key, index) => {
        const descriptor = descriptors[String(index)];
        if (key !== String(index) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('accessor contract value');
        return captureData(descriptor.value, seen);
      });
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('non-plain contract object');
    const result = {};
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('accessor contract value');
      result[key] = captureData(descriptor.value, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function safeValidation(validator, value) {
  try {
    const result = validator(value);
    return result && typeof result === 'object' ? result : { valid: false, errors: ['validator returned an invalid result'] };
  } catch {
    return { valid: false, errors: ['validation failed closed'] };
  }
}

function rejected(reasonCode, errors) {
  return {
    status: 'REJECTED', reasonCode, transitionEvent: null, reducerResult: null,
    reducerReasonCode: null, nextEnvelope: null,
    errors: Array.isArray(errors) ? [...errors] : []
  };
}

function readInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string'
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) return null;
  const keys = Object.keys(descriptors);
  if (keys.length !== INPUT_KEYS.length || INPUT_KEYS.some((key) => !Object.hasOwn(descriptors, key))) return null;
  return Object.fromEntries(INPUT_KEYS.map((key) => [key, descriptors[key].value]));
}

function compileTransition(input) {
  const proposal = input.proposal;
  const primaryEvidence = proposal.evidence.find((record) => record.evidenceId === proposal.provenance.evidenceId);
  const provenance = {
    sourceType: proposal.provenance.sourceType,
    evidenceId: proposal.provenance.evidenceId,
    sourceTurnId: proposal.provenance.sourceTurnId,
    sourceReference: primaryEvidence.sourceReference
  };
  const event = {
    contractVersion: R4A2A_VERSION,
    eventId: input.eventId,
    conversationId: proposal.conversationId,
    turnId: proposal.turnId,
    fieldPath: proposal.fieldPath,
    operation: proposal.disposition,
    eventType: proposal.fieldPath === 'derived.ownershipState' ? 'OWNERSHIP_TRANSITION' : 'FIELD_TRANSITION',
    eventVersion: input.eventVersion,
    baseEnvelopeVersion: input.baseEnvelopeVersion,
    baseStateVersion: input.baseStateVersion,
    provenance,
    payload: proposal.disposition === 'SET' ? clone(proposal.value)
      : proposal.disposition === 'CONFLICT' ? { candidates: proposal.candidates.map((candidate) => candidate.value) }
        : null,
    evidenceIds: [...proposal.evidenceIds],
    reasonCode: proposal.disposition === 'SET' ? 'CURRENT_TURN_REPLACEMENT'
      : proposal.disposition === 'CLEAR' ? 'EXPLICIT_CLEAR' : 'EVIDENCE_CONFLICT'
  };
  return event;
}

function admitSemanticProposal(rawInput) {
  let input;
  try { input = readInput(rawInput); } catch { input = null; }
  if (!input) return rejected('INVALID_INPUT', ['input must be a closed plain data object']);

  const envelopeResult = safeValidation(validateEnvelope, input.currentEnvelope);
  if (envelopeResult.valid !== true) return rejected('INVALID_ENVELOPE', envelopeResult.errors);

  try { input.currentEnvelope = captureData(input.currentEnvelope); } catch {
    return rejected('INVALID_ENVELOPE', ['validated envelope could not be safely captured']);
  }
  const capturedEnvelopeResult = safeValidation(validateEnvelope, input.currentEnvelope);
  if (capturedEnvelopeResult.valid !== true) return rejected('INVALID_ENVELOPE', capturedEnvelopeResult.errors);

  const proposalResult = safeValidation(validateSemanticProposal, input.proposal);
  if (proposalResult.valid !== true) return rejected('INVALID_PROPOSAL', proposalResult.errors);

  try { input.proposal = captureData(input.proposal); } catch {
    return rejected('INVALID_PROPOSAL', ['validated proposal could not be safely captured']);
  }
  const capturedProposalResult = safeValidation(validateSemanticProposal, input.proposal);
  if (capturedProposalResult.valid !== true) return rejected('INVALID_PROPOSAL', capturedProposalResult.errors);

  if (input.proposal.conversationId !== input.currentEnvelope.conversationId) {
    return rejected('CONVERSATION_MISMATCH', ['proposal conversationId does not match envelope conversationId']);
  }

  if (input.proposal.disposition === 'UNRESOLVED') {
    return {
      status: 'UNRESOLVED', reasonCode: 'UNRESOLVED_PROPOSAL', transitionEvent: null,
      reducerResult: null, reducerReasonCode: null, nextEnvelope: null,
      diagnostic: {
        proposalId: input.proposal.proposalId,
        conversationId: input.proposal.conversationId,
        turnId: input.proposal.turnId,
        fieldPath: input.proposal.fieldPath,
        candidateValues: Array.isArray(input.proposal.candidates)
          ? input.proposal.candidates.map((candidate) => candidate.value) : []
      }
    };
  }

  // The transition validator accepts numeric -0 under its nonnegative check,
  // while version coordinates elsewhere in the decision contract reject it.
  if (Object.is(input.baseStateVersion, -0)) {
    return rejected('INVALID_TRANSITION', ['baseStateVersion is invalid']);
  }

  let transitionEvent;
  try { transitionEvent = compileTransition(input); } catch {
    return rejected('INVALID_TRANSITION', ['transition compilation failed closed']);
  }
  const transitionResult = safeValidation(validateTransitionEvent, transitionEvent);
  if (transitionResult.valid !== true) return rejected('INVALID_TRANSITION', transitionResult.errors);

  let reduced;
  try { reduced = reduceDecisionEnvelope(input.currentEnvelope, transitionEvent); } catch {
    return {
      status: 'REDUCER_REJECTED', reasonCode: 'INVALID_BASE', transitionEvent,
      reducerResult: 'REJECTED', reducerReasonCode: 'INVALID_BASE', nextEnvelope: null
    };
  }
  if (reduced.result === 'REJECTED') {
    const reasonCode = ['STALE_BASE', 'FUTURE_BASE', 'INVALID_BASE'].includes(reduced.reasonCode)
      ? reduced.reasonCode : 'INVALID_BASE';
    return {
      status: 'REDUCER_REJECTED', reasonCode, transitionEvent,
      reducerResult: reduced.result, reducerReasonCode: reduced.reasonCode, nextEnvelope: reduced.nextEnvelope
    };
  }
  return {
    status: 'ADMITTED', reasonCode: null, transitionEvent,
    reducerResult: reduced.result, reducerReasonCode: reduced.reasonCode, nextEnvelope: reduced.nextEnvelope
  };
}

module.exports = { admitSemanticProposal, ADMISSION_STATUSES, ADMISSION_REASON_CODES };
