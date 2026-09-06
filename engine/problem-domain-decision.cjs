'use strict';

const { CONCERNS } = require('./product-intelligence-schema.cjs');

const APPROVED_CONCERN_CONTEXT = Object.freeze({
  psoriasis: 'psoriasis',
  eczema: 'eczema',
  acne: 'acne'
});

function buildProblemDomainDecision(recognition = null) {
  const input = recognition && typeof recognition === 'object' ? recognition : {};
  const domain = typeof input.domain === 'string' && input.domain.length > 0 ? input.domain : null;
  const concernContext = domain && CONCERNS.includes(APPROVED_CONCERN_CONTEXT[domain])
    ? APPROVED_CONCERN_CONTEXT[domain]
    : null;

  return {
    domain,
    evidence: Array.isArray(input.evidence) ? [...input.evidence] : [],
    expertRuleId: input.expertRuleId ?? null,
    concernContext
  };
}

module.exports = { buildProblemDomainDecision };