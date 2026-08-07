'use strict';

const { normalize } = require('./normalizer.cjs');

const STOP = new Set(['van', 'vagy', 'milyen', 'mennyi', 'mennyibe', 'kerul', 'ezt', 'azt', 'nekem', 'szeretnem']);
function tokens(value) { return [...new Set(normalize(value).split(' ').filter((x) => x.length >= 3 && !STOP.has(x)))]; }

function evaluateKnowledgeConfidence(question, matches, { domain = null, intent = null, context = null } = {}) {
  const best = matches?.[0];
  if (!best) return { accepted: false, confidence: 0, threshold: 0.72, rejectionReasons: ['no_knowledge_match'], metrics: {} };
  const item = best.item || {};
  const queryTokens = tokens(question);
  const evidenceText = [item.title, item.canonicalQuestion, ...(item.questionVariants || []), ...(item.keywords || []), ...(item.products || []), ...(item.intents || []), item.category, item.subcategory].filter(Boolean).join(' ');
  const evidenceTokens = tokens(evidenceText);
  const matched = queryTokens.filter((token) => evidenceTokens.some((field) => field === token || (token.length >= 5 && (field.includes(token) || token.includes(field)))));
  const coverage = queryTokens.length ? matched.length / queryTokens.length : 0;
  const precision = evidenceTokens.length ? matched.length / Math.min(evidenceTokens.length, Math.max(queryTokens.length * 3, 1)) : 0;
  const margin = best.score - (matches[1]?.score || 0);
  const itemDomains = normalize([item.category, item.subcategory, ...(item.intents || [])].join(' '));
  const domainCompatible = !domain || domain === 'conversation' || itemDomains.includes(normalize(domain).replace(/_/g, ' '));
  const intentCompatible = !intent || !item.intents?.length || (item.intents || []).some((value) => normalize(value).includes(normalize(intent).replace(/_/g, ' ')));
  const contextCompatible = !context?.lastProblemDomain || !domain || context.lastProblemDomain === domain;
  const confidence = Math.max(0, Math.min(1, coverage * 0.65 + Math.min(margin / 100, 1) * 0.2 + (domainCompatible ? 0.1 : 0) + (intentCompatible ? 0.05 : 0)));
  const rejectionReasons = [];
  if (coverage < 0.72) rejectionReasons.push('low_query_coverage');
  if (margin < 15) rejectionReasons.push('low_top_match_margin');
  if (!domainCompatible) rejectionReasons.push('domain_mismatch');
  if (!intentCompatible) rejectionReasons.push('intent_mismatch');
  if (!contextCompatible) rejectionReasons.push('context_mismatch');
  return { accepted: rejectionReasons.length === 0 && confidence >= 0.72, confidence: Number(confidence.toFixed(3)), threshold: 0.72, rejectionReasons, metrics: { coverage, precision, margin, domainCompatible, intentCompatible, contextCompatible, legacyScore: best.score } };
}

module.exports = { evaluateKnowledgeConfidence };
