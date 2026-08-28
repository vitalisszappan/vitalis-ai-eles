'use strict';

const { normalize } = require('./normalizer.cjs');
const { findProductsInText } = require('./product-faq.cjs');

const PRODUCT_TERM_PATTERN = /\b(samponszappan\w*|testapolo\w*|krem\w*|balzsam\w*|szappan\w*|sampon\w*|csomag\w*|dezodor\w*|tusfurdo\w*)\b/g;

function resolvePersistedProductEvidence(text) {
  const normalized = normalize(text);
  const productIds = [...new Set(findProductsInText(normalized))];
  const productMentionCount = [...normalized.matchAll(PRODUCT_TERM_PATTERN)].length;

  if (!productIds.length) {
    return { status: 'unresolved', productId: null, orderedProductIds: [], productMentionCount };
  }

  if (productIds.length > 1 || productMentionCount > productIds.length) {
    return { status: 'ambiguous', productId: null, orderedProductIds: productIds, productMentionCount };
  }

  return { status: 'resolved', productId: productIds[0], orderedProductIds: productIds, productMentionCount };
}

module.exports = { resolvePersistedProductEvidence };
