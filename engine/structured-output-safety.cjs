'use strict';

const { PRODUCTS } = require('./product-catalog.cjs');

const FORBIDDEN_TAR_NAME = /gyógyászati\s+kátrány/giu;
const CUSTOMER_VISIBLE_LINK_FIELDS = ['name', 'title', 'label', 'description', 'reason'];

function safeText(value) {
  return typeof value === 'string'
    ? value.replace(FORBIDDEN_TAR_NAME, 'Kátrány')
    : value;
}

function safeLink(link) {
  if (!link || typeof link !== 'object') return link;
  const safeDisplayName = PRODUCTS[link.id]?.displayName || null;
  const next = { ...link };
  for (const field of CUSTOMER_VISIBLE_LINK_FIELDS) {
    if (typeof next[field] !== 'string') continue;
    next[field] = safeDisplayName && ['name', 'title', 'label'].includes(field)
      ? safeDisplayName
      : safeText(next[field]);
  }
  return next;
}

function validateStructuredOutput(result) {
  if (!result || typeof result !== 'object') return result;
  return {
    ...result,
    answer: safeText(result.answer),
    links: Array.isArray(result.links) ? result.links.map(safeLink) : result.links
  };
}

module.exports = {
  CUSTOMER_VISIBLE_LINK_FIELDS,
  FORBIDDEN_TAR_NAME,
  safeText,
  validateStructuredOutput
};
