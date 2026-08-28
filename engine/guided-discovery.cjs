'use strict';

const { normalize } = require('./normalizer.cjs');
const { detectProductTypeConstraint, detectExcludedProductTypes } = require('./product-type-constraint.cjs');

function dimension(value, source = 'current-turn') {
  return value ? { value, source, explicit: source === 'current-turn' } : null;
}

function detectNeedState(question) {
  const text = normalize(question);
  if (/\b(szaraz bor|szaraz borre|szaraz a bor(?:om)?|kiszaradt bor(?:om)?|huzodik a bor(?:om)?)\b/.test(text)) {
    return { needState: 'dry_skin', bodyArea: 'skin' };
  }
  if (/\berzekeny\w*\b/.test(text) && /\b(?:bor|borom|arcbor)\w*\b/.test(text)) {
    return { needState: 'sensitive_skin', bodyArea: 'skin' };
  }
  if (/\b(?:szaraz|kiszárad\w*|kirepedez\w*)\b/.test(text) && /\b(?:kez|kezem|kezeim|kezbor)\w*\b/.test(text)) {
    return { needState: 'dry_hands', bodyArea: 'hands' };
  }
  if (/\b(?:ranc|rancos|oreged\w*|erett)\w*\b/.test(text) && /\b(?:bor|borom|arc|arcbor)\w*\b/.test(text)) {
    return { needState: 'wrinkles_or_mature_skin', bodyArea: 'face' };
  }
  return null;
}

function isPureBrowse(question) {
  const text = normalize(question);
  return /\b(?:korulnez\w*|bongesz\w*)\b/.test(text)
    && !detectProductTypeConstraint(question)
    && !detectNeedState(question);
}

function currentDimensions(question) {
  const need = detectNeedState(question);
  const text = normalize(question);
  const excluded = detectExcludedProductTypes(question);
  const productType = detectProductTypeConstraint(question) || (!excluded.includes('shampoo') && /\bsampon\w*/.test(text) ? 'shampoo' : null);
  return {
    browseIntent: dimension(isPureBrowse(question) ? 'catalog' : null),
    needState: dimension(need?.needState || null),
    productType: dimension(productType),
    bodyArea: dimension(need?.bodyArea || null),
    goal: dimension(isPureBrowse(question) ? 'browse' : need || productType ? 'guided_discovery' : null)
  };
}

function mergeDimensions(current, inherited = {}) {
  const currentHasNeed = Boolean(current.needState);
  return {
    browseIntent: current.browseIntent || null,
    needState: current.needState || inherited.needState || null,
    productType: current.productType || inherited.productType || null,
    bodyArea: current.bodyArea || (currentHasNeed ? null : inherited.bodyArea) || null,
    goal: current.goal || inherited.goal || null
  };
}

function resolveGuidedDiscovery({ question, conversationState = null }) {
  const current = currentDimensions(question);
  const text = normalize(question);
  const inherited = conversationState?.guidedDiscovery || {};
  const dimensions = mergeDimensions(current, inherited);
  const need = dimensions.needState?.value;
  const type = dimensions.productType?.value;

  if (current.browseIntent) return { kind: 'browse', dimensions };
  if (!current.needState && !current.productType) return null;
  if (!need && !type) return null;

  if (current.productType && inherited.browseIntent && !need) return { kind: 'defer', dimensions };
  if (current.productType && !need && (/\b(?:mutass\w*|listaz\w*|sorolj\w*)\b/.test(text) || /\bmilyen\b.*\b(?:van|vannak)\b/.test(text))) return { kind: 'defer', dimensions };

  // This exact combination already has an approved catalog-backed contract.
  if (need === 'sensitive_skin' && type === 'szappan') return { kind: 'defer', dimensions };

  if (need && !type) return { kind: 'clarify_product_type', dimensions };
  if (!need && type) return { kind: 'clarify_need', dimensions };
  return { kind: 'unsupported_need_type', dimensions };
}

function reconstructGuidedDiscovery(history = []) {
  let state = {};
  for (const item of history) {
    if (item?.role === 'assistant' && item.routing?.guidedDiscovery) {
      state = mergeDimensions(item.routing.guidedDiscovery, state);
      continue;
    }
    if (item?.role !== 'user') continue;
    const current = currentDimensions(item.content || '');
    if (current.browseIntent || current.needState || current.productType) state = mergeDimensions(current, state);
  }
  return state;
}

module.exports = {
  detectNeedState,
  isPureBrowse,
  currentDimensions,
  mergeDimensions,
  resolveGuidedDiscovery,
  reconstructGuidedDiscovery
};
