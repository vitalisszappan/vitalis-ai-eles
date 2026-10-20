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
    preferenceAxis: null,
    preferenceValue: null,
    goal: dimension(isPureBrowse(question) ? 'browse' : need || productType ? 'guided_discovery' : null)
  };
}

function mergeDimensions(current, inherited = {}) {
  const currentHasNeed = current.needState?.source === 'current-turn';
  return {
    browseIntent: current.browseIntent || null,
    needState: current.needState || inherited.needState || null,
    // An explicit new need owns the topic. Do not carry a product type from an
    // older product-focused turn into the new recommendation flow.
    productType: current.productType || (currentHasNeed ? null : inherited.productType) || null,
    bodyArea: current.bodyArea || (currentHasNeed ? null : inherited.bodyArea) || null,
    preferenceAxis: current.preferenceAxis || (currentHasNeed ? null : inherited.preferenceAxis) || null,
    preferenceValue: current.preferenceValue || (currentHasNeed ? null : inherited.preferenceValue) || null,
    goal: current.goal || inherited.goal || null
  };
}

function scentPreference(text) {
  if (/\b(?:illatmentes|semleges|natur)\w*/.test(text)) return 'unscented';
  if (/\blevendula\w*/.test(text)) return 'lavender';
  if (/\b(?:citrus|citrom)\w*/.test(text)) return 'citrus';
  if (/\bfriss\w*/.test(text)) return 'fresh';
  if (/\bvirag\w*/.test(text)) return 'floral';
  if (/\b(?:gyogynoveny|teafa|rozmaring|menta)\w*/.test(text)) return 'herbal';
  if (/\b(?:edes|fuszeres|csoki|mezes)\w*/.test(text)) return 'sweet_spicy';
  return null;
}

function resolveGuidedDiscovery({ question, conversationState = null }) {
  let current = currentDimensions(question);
  const text = normalize(question);
  let inherited = conversationState?.guidedDiscovery || {};
  const excludedTypes = detectExcludedProductTypes(question);
  if (excludedTypes.includes(inherited.productType?.value)) inherited = { ...inherited, productType: null };
  const directScentPreference = current.productType ? scentPreference(text) : null;
  if (directScentPreference) {
    current = { ...current, preferenceAxis: dimension('scent'),
      preferenceValue: dimension(directScentPreference) };
  } else if (inherited.productType && !inherited.preferenceAxis && /^illat(?:\s+alapjan)?$/.test(text)) {
    current = { ...current, preferenceAxis: dimension('scent', 'clarification-answer') };
  } else if (inherited.productType && inherited.preferenceAxis?.value === 'scent') {
    const preference = scentPreference(text);
    if (preference) current = { ...current, preferenceAxis: inherited.preferenceAxis,
      preferenceValue: dimension(preference, 'clarification-answer') };
  }
  if (inherited.productType && current.needState) current={...current,needState:{...current.needState,source:'clarification-answer',explicit:true},bodyArea:current.bodyArea?{...current.bodyArea,source:'clarification-answer',explicit:true}:null};
  if (inherited.productType && !current.needState) {
    const contextualNeed = /\b(?:szaraz|erzekeny)\w*/.test(text) ? 'dry_skin'
      : /\b(?:zsiros|pattanasos)\w*/.test(text) ? 'acne'
      : /\b(?:viszket|korpas|hamlik)\w*/.test(text) ? 'itchy_scalp' : null;
    if (contextualNeed) current={...current,needState:dimension(contextualNeed,'clarification-answer'),bodyArea:dimension(contextualNeed==='itchy_scalp'?'scalp':'skin','clarification-answer')};
  }
  const dimensions = mergeDimensions(current, inherited);
  const need = dimensions.needState?.value;
  const type = dimensions.productType?.value;

  if (current.browseIntent) return { kind: 'browse', dimensions };
  if (dimensions.preferenceAxis && !dimensions.preferenceValue) return { kind: 'clarify_preference', dimensions };
  if (current.preferenceValue && type) return { kind: 'category_answer', dimensions };
  if (!current.needState && !current.productType) return inherited.productType ? { kind: 'category_answer', dimensions } : null;
  if (!need && !type) return null;

  if (current.productType && inherited.browseIntent && !need) return { kind: 'defer', dimensions };

  // This exact combination already has an approved catalog-backed contract.
  if (need === 'sensitive_skin' && type === 'szappan') return { kind: 'defer', dimensions };

  if (need && !type) return { kind: 'clarify_product_type', dimensions };
  if (!need && type) return { kind: 'clarify_need', dimensions };
  return { kind: 'unsupported_need_type', dimensions };
}

function isBroadCategoryRequest(question, productType) {
  if (!productType) return false;
  let text = normalize(question);
  const pattern = { szappan: /\bszappan\w*/g, shampoo: /\bsampon\w*/g, krem: /\bkrem\w*/g,
    dezodor: /\bdezodor\w*/g, ajakbalzsam: /\b(?:ajakbalzsam|ajakapolo)\w*/g }[productType];
  if (!pattern) return false;
  text = text.replace(pattern, ' ').replace(/\b(?:van|vannak|valami|egy|keresek|keresem|szeretnek|erdekel|nekem|kerlek|mutass|milyen|melyik|ajanl\w*|javasol\w*|listaz\w*|sorolj\w*|termeket|termek)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  return !text;
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
  reconstructGuidedDiscovery,
  isBroadCategoryRequest
};
