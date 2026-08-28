'use strict';

const { normalize } = require('./normalizer.cjs');
const { detectComplaintIntent } = require('./complaint-intents.cjs');

const MINIMAL_DOMAINS = new Set(['szappan', 'sampon', 'krem', 'balzsam', 'ekcema', 'pikkelysomor', 'akne', 'rosacea', 'szallitas', 'postakoltseg', 'futar', 'gls', 'utanvet']);
const GENERAL_CATALOG = /^(milyen termekeitek vannak|mik vannak nalatok|mit arultok|mi van a webshopban|miket lehet kapni|mutasd a termekeket)\??$/;
const CUSTOMER_SERVICE = {
  warranty: /\bgarancia\w*\b/,
  contact: /\b(elerhetoseg\w*|kit keressek|kapcsolat\w*)\b/,
  physical_store: /\b(fizikai bolt\w*|uzletetek\w*|szemelyesen hol)\b/,
  opening_hours: /\bnyitvatartas\w*\b/,
  promotion: /\b(kedvezmeny\w*|akcio\w*|kupon\w*)\b/
};

function words(text) { return text.split(' ').filter(Boolean); }
function hasAny(text, expressions) { return expressions.some((expression) => expression.test(text)); }

function utteranceType(raw, text) {
  if (/\?\s*$/.test(String(raw)) || /^(mi|mit|milyen|mennyi|hogyan|hogy|hol|mikor|van|vannak|lehet|tudsz|kit)\b/.test(text)) return 'question';
  if (/^(mutasd|mondd|ajanlj|adj|kerem|szeretnem|ne)\b/.test(text)) return 'command';
  if (words(text).length <= 2) return 'fragment';
  return 'assertion';
}

function previousAssistant(history) {
  return [...(history || [])].reverse().find((item) => item?.role === 'assistant') || null;
}

function buildSemanticEvidence({ question, routing = {}, history = [], conversationState = null } = {}) {
  const raw = String(question || '');
  const normalized = normalize(raw);
  const tokens = words(normalized);
  const state = conversationState || {};
  const complaint = detectComplaintIntent(raw, state);
  const minimalDomain = tokens.length === 1 && MINIMAL_DOMAINS.has(tokens[0]);
  const informationalProblem = /\b(mi az|mit jelent|fertozo|fertoz e|lehet e|lehet)\b.*\b(ekcema|pikkelysomor|akne|rosacea)\w*|\b(ekcema|pikkelysomor|akne|rosacea)\w*\b.*\b(mi|mit jelent|fertozo)\b/.test(normalized);
  const catalogLookup = minimalDomain && ['szappan', 'sampon', 'krem', 'balzsam'].includes(tokens[0]) || /\b(milyen|mutasd|mutass|van|vannak|keresek|ajanl\w*)\b.*\b(szappan|sampon|krem|balzsam|termek)\w*/.test(normalized) || /\b(szappan|sampon|krem|balzsam)\w*\b.*\b(mutass|keresek)\b/.test(normalized) || GENERAL_CATALOG.test(normalized);
  const commerceInformation = minimalDomain && ['szallitas', 'postakoltseg', 'futar', 'gls', 'utanvet'].includes(tokens[0]) || /\b(mennyi|mennyibe|milyen|hogyan|mivel|mikor|hol|van)\b.*\b(szallitas|kiszallitas|szallitotok|posta|futar|futarszolgalat|csomag)\w*|\b(fizethetek|utanvet|bankkartya|gls)\w*|\b(mikor erkezik|mikor jon meg|hogyan kapom meg)\b/.test(normalized);
  const purchase = /\b(megrendel\w*|megvesz\w*|kosar\w*|ezt kerem|elsot kerem|masodikat kerem)\b/.test(normalized);
  const problemRequest = minimalDomain && ['ekcema', 'pikkelysomor', 'akne', 'rosacea'].includes(tokens[0]) || /\b(ajanl\w*|javasol\w*|hasznaljak|borom\w*|van)\b.*\b(ekcema|pikkelysomor|akne|rosacea)\w*|\b(ekcema|pikkelysomor|akne|rosacea)\w*\b.*\b(van|borom\w*|ajanl\w*|javasol\w*|keresek)|\b(ekcemas|pikkelysomoros|aknes|rosaceas)\b/.test(normalized);
  const metalinguistic = /\b(szo\w*|betu\w*|cimu|rejtvény|rejtveny|jelentese|jelszo\w*)\b/.test(normalized);
  const incompatibleAction = /\b(vacsoraz\w*|megettem|kifing\w*|rajzolt\w*|irtam|leesett|leugrott\w*|dobtam|szallitottam fat|almodtam|feleltem)\b/.test(normalized);
  const negations = tokens.flatMap((token, index) => ['nem', 'nincs', 'se', 'sem', 'ne'].includes(token) ? [{ token, index }] : []);
  const previous = previousAssistant(history);
  const currentDomains = [commerceInformation ? 'commerce' : null, catalogLookup ? 'catalog' : null, problemRequest || informationalProblem ? 'problem' : null].filter(Boolean);
  const priorDomains = state.activeProblemDomains || [];
  const marker = /^(es|de|amugy|egyebkent|inkabb|viszont)\b/.test(normalized);
  const topicSwitch = Boolean((marker && currentDomains.length && priorDomains.length && !currentDomains.some((x) => priorDomains.includes(x))) || (currentDomains.length && priorDomains.length && currentDomains[0] !== 'problem'));
  const serviceGap = Object.entries(CUSTOMER_SERVICE).find(([, pattern]) => pattern.test(normalized));

  return {
    utterance: { raw, normalized, tokens, tokenCount: tokens.length, utteranceType: utteranceType(raw, normalized), negations, minimalDomain },
    signals: {
      safety: { strong: routing.route === 'safety' && routing.safetyClass === 'medical_escalation', caution: routing.route === 'safety' },
      complaint: Boolean(complaint && complaint.polarity !== 'negative'), purchase, commerceInformation, catalogLookup,
      problemRequest, informationalQuery: informationalProblem, topicSwitch,
      exclusion: negations.length > 0,
      unsupportedAssertion: metalinguistic || incompatibleAction,
      metalinguistic, incompatibleAction,
      generalCatalogGap: GENERAL_CATALOG.test(normalized),
      customerServiceGap: serviceGap?.[0] || null
    },
    routeEvidence: {
      route: routing.route || null, goal: routing.goal || null, intent: routing.intent || null,
      domain: routing.domain || null, source: routing.responseSource || null,
      evidence: Array.isArray(routing.evidence) ? [...routing.evidence] : []
    },
    context: {
      available: Boolean(history.length || conversationState), focusedProductId: state.focusedProductId || null,
      purchaseProductId: state.purchaseProductId || null, productContextStatus: state.productContextStatus || null,
      activeProblemDomains: [...(state.activeProblemDomains || [])], previousRoute: previous?.route || null,
      previousProducts: [...(state.lastOrdinalProductList || state.lastRecommendedProducts || [])]
    },
    complaint
  };
}

module.exports = { buildSemanticEvidence, GENERAL_CATALOG, CUSTOMER_SERVICE };
