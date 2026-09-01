'use strict';

const { normalize } = require('./normalizer.cjs');
const { CONCERNS, APPLICATION_AREAS, RECOMMENDATION_ROLES } = require('./product-intelligence-schema.cjs');

const UNKNOWN = 'unknown';

function emptyFactors() {
  return { acneFrequencyOrIntensity: UNKNOWN, skinOiliness: UNKNOWN, affectedArea: UNKNOWN };
}

function hasLiteralAcneSignal(text) {
  return /\b(akne|aknes|pattanas|pattanasos|mitesszer)\w*/.test(text)
    && !/\bpattanasig\s+feszul\w*\b/.test(text);
}

function extractFactors(question) {
  const text = normalize(question);
  const factors = emptyFactors();
  const areas = [
    /\b(fejbor|hajas fejbor)\w*/.test(text) && 'scalp',
    /\b(hat|vall|test)\w*/.test(text) && 'body',
    /\b(arc|arcom|arbor)\w*/.test(text) && 'face'
  ].filter(Boolean);
  factors.affectedArea = new Set(areas).size > 1 ? 'multiple' : areas[0] || UNKNOWN;
  const mildlyOily = /\b(kombinalt|enyhen zsiros)\w*/.test(text);
  const stronglyOily = /\b(nagyon zsiros|erosen zsiros)\b/.test(text);
  const oily = stronglyOily || (!mildlyOily && /\bzsiros a (?:borom|bor|arcom|fejborom)\b/.test(text));
  const occasional = /\b(neha|ritkan|alkalmankent|enyhe|enyhen|egy-ket)\b/.test(text);
  const frequent = /\b(gyakran|rendszeresen|surun|eros|erosebb|makacs)\w*/.test(text);
  if (mildlyOily && !oily) factors.skinOiliness = 'combination_or_mildly_oily';
  if (oily && !mildlyOily) factors.skinOiliness = 'oily';
  if (occasional && !frequent) factors.acneFrequencyOrIntensity = 'occasional_mild';
  if (frequent && !occasional) factors.acneFrequencyOrIntensity = 'frequent_or_stronger';
  return { factors, blackheads: /\bmitesszer\w*/.test(text), contradictory: (mildlyOily && oily) || (occasional && frequent), text };
}

function acneContext(history = [], conversationState = null) {
  if (conversationState?.acneDecision) return conversationState.acneDecision;
  const lastAcneAssistant = [...history].reverse().find((item) => item?.role === 'assistant' && (item?.routing?.acneDecision || item?.domain === 'acne' || item?.routing?.domain === 'acne'));
  if (!lastAcneAssistant) return null;
  const stored = lastAcneAssistant?.routing?.acneDecision?.factors || lastAcneAssistant?.acneDecision?.factors;
  return { factors: stored || emptyFactors(), active: true };
}

function mergeFactors(current, inherited) {
  return Object.fromEntries(Object.keys(emptyFactors()).map((key) => [key, current[key] !== UNKNOWN ? current[key] : inherited?.[key] || UNKNOWN]));
}

function resolveAcneDecision({ question, history = [], conversationState = null }) {
  const extracted = extractFactors(question);
  const context = acneContext(history, conversationState);
  const direct = hasLiteralAcneSignal(extracted.text);
  const hairUsage = /\bkatrany\s+szappan\w*\b/.test(extracted.text) && /\b(hajat mos|hajmosas|hajra hasznal|lehet.*haj)\w*/.test(extracted.text);
  if (hairUsage) return { kind: 'usage', selectedProductId: 'katrany_szappan', factors: extracted.factors, reasonCode: 'approved_hair_washing_fact' };
  if (!direct && !context) return null;
  const factors = mergeFactors(extracted.factors, context?.factors);
  const currentHasFactors = Object.values(extracted.factors).some((value) => value !== UNKNOWN);
  if (!direct && !currentHasFactors) return null;
  let selectedProductId = null;
  let reasonCode = 'insufficient_evidence';
  if (extracted.contradictory) {
    reasonCode = 'contradictory_evidence';
  } else if (factors.affectedArea === 'scalp') {
    selectedProductId = 'katrany_szappan'; reasonCode = 'scalp_acne';
  } else if (factors.acneFrequencyOrIntensity === 'frequent_or_stronger' && factors.skinOiliness === 'oily') {
    selectedProductId = 'katrany_szappan'; reasonCode = 'oily_frequent';
  } else if (factors.acneFrequencyOrIntensity === 'occasional_mild' && factors.skinOiliness === 'combination_or_mildly_oily') {
    selectedProductId = 'aktiv_szenes_szappan'; reasonCode = 'mild_combination';
  } else if (extracted.blackheads && factors.skinOiliness === 'combination_or_mildly_oily' && /\b(kombinalt|enyhen zsiros)\b/.test(extracted.text)) {
    selectedProductId = 'aktiv_szenes_szappan'; reasonCode = 'blackheads_combination';
  }
  const concernContext = CONCERNS.includes('acne') ? 'acne' : null;
  const applicationArea = (['face', 'scalp', 'body'].includes(factors.affectedArea) && APPLICATION_AREAS.includes(factors.affectedArea))
    ? factors.affectedArea
    : null;
  const recommendationRole = (selectedProductId && RECOMMENDATION_ROLES.includes('primary')) ? 'primary' : null;
  return {
    kind: selectedProductId ? 'resolved' : 'clarification',
    selectedProductId,
    factors,
    reasonCode,
    source: direct ? 'current-turn' : 'conversation-context',
    ...(concernContext ? { concernContext } : {}),
    ...(applicationArea ? { applicationArea } : {}),
    ...(recommendationRole ? { recommendationRole } : {})
  };
}

module.exports = { emptyFactors, extractFactors, hasLiteralAcneSignal, resolveAcneDecision };
