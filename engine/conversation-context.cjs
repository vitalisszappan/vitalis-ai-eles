'use strict';

const {
  findProductInText
} = require(
  './product-faq.cjs'
);
const { resolvePersistedProductEvidence } = require('./persisted-product-evidence.cjs');
const { hasLiteralAcneSignal } = require('./acne-decision.cjs');

/* =========================================================
   SEGÉDFÜGGVÉNYEK
========================================================= */

function normalizeLoose(
  value = ''
) {
  return String(
    value
  )
    .toLowerCase()
    .replace(/[őöó]/g, 'o')
    .replace(/[űüú]/g, 'u')
    .normalize(
      'NFD'
    )
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .replace(
      /[^a-z0-9\s]/g,
      ' '
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

function compact(
  value = ''
) {
  return normalizeLoose(
    value
  )
    .replace(
      /\s+/g,
      ''
    );
}

/* =========================================================
   PROBLÉMAFELISMERÉS
========================================================= */

const PROBLEM_PATTERNS = {

  eczema: [
    'ekcema',
    'ekcemas',
    'atopias',
    'atopia',
    'dermatitisz'
  ],

  scalp: [
    'fejbor',
    'korpa',
    'korpas',
    'hajlas',
    'viszketafejbor',
    'viszketofejbor'
  ],

  psoriasis: [
    'pikkelysomor',
    'pikkelysomoros',
    'pikkelysomorom',
    'pikkelysomorrel',
    'pikkelysomorrol',
    'pszoriazis',
    'pszoriazisos',

    /*
      Gyakori elírások és fonetikus alakok
    */

    'pikeisomor',
    'pikejsomor',
    'pikejsomor',
    'pikelisomor',
    'pikkelisomor',
    'pikkelysomor'
  ],

  acne: [
    'akne',
    'aknes',
    'pattanas',
    'pattanasos',
    'mitesszer'
  ],

  dry_skin: [
    'szarazbor',
    'kiszaradtbor',
    'huzodikaborom',
    'huzodikabor'
  ],

  rosacea: [
    'rosacea',
    'rozacea',
    'rozsacea',
    'kipirosodas',
    'pirosodoarcbor',
    'pirosarc',
    'erzekenyarcbor'
  ],

  couperose: [
    'hajszaler',
    'hajszalerek',
    'hajszaleres',
    'ertagulat',
    'ertagulatok',
    'kuperoz',
    'couperose'
  ]
};

/* =========================================================
   PROBLÉMA AZONOSÍTÁSA
========================================================= */

function detectProblem(
  text
) {
  const normalized =
    normalizeLoose(
      text
    );

  const compactText =
    compact(
      normalized
    );

  for (
    const [
      id,
      patterns
    ] of Object.entries(
      PROBLEM_PATTERNS
    )
  ) {

    if (
      id === 'acne' &&
      !hasLiteralAcneSignal(normalized)
    ) {
      continue;
    }

    for (
      const pattern of
      patterns
    ) {

      const normalizedPattern =
        compact(
          pattern
        );

      if (
        compactText.includes(
          normalizedPattern
        )
      ) {
        return id;
      }
    }
  }

  /*
    Külön laza felismerés a pikkelysömör
    gyakori, erősen elírt változataira.
  */

  const words =
    normalized
      .split(
        ' '
      )
      .filter(Boolean);

  const looksLikePsoriasis =
    words.some(
      (
        word
      ) =>
        word.startsWith(
          'pikk'
        ) ||
        word.startsWith(
          'pike'
        ) ||
        word.startsWith(
          'pikej'
        )
    ) &&
    words.some(
      (
        word
      ) =>
        word.includes(
          'somor'
        )
    );

  if (
    looksLikePsoriasis
  ) {
    return 'psoriasis';
  }

  return null;
}

/* =========================================================
   E-MAIL FELISMERÉS
========================================================= */

function looksLikeEmail(
  text
) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i
    .test(
      String(
        text ||
        ''
      ).trim()
    );
}

/* =========================================================
   RÖVID FOLYTATÓ KÉRDÉSEK
========================================================= */

function isFollowUpMessage(
  text
) {
  const value =
    normalizeLoose(
      text
    );

  if (
    !value
  ) {
    return false;
  }

  const followUps = [

    'mas is van',
    'mas is van meg',
    'van meg mas',
    'es meg',
    'van mas',

    'melyik',
    'melyiket',
    'melyiket ajanlod',
    'mit ajanlasz',

    'es krem',
    'krem is van',
    'van krem is',

    'es szappan',
    'szappan is van',
    'van szappan is',

    'es balzsam',
    'balzsam is van',

    'igen',
    'nem',
    'oke',
    'rendben',

    'nem kaptam kodot',
    'nem kaptam meg',
    'es akkor',

    'ez jo lehet',
    'ezt ajanlod',
    'mit hasznaljak meg',

    'az elsot',
    'az elso',
    'a masodikat',
    'a masodik',
    'a masikat',
    'masikat',
    'ebbol',
    'belole',
    'ezt',
    'azt'
  ];

  return followUps.some(
    (
      phrase
    ) =>
      value === phrase ||
      value.startsWith(
        `${phrase} `
      )
  );
}

function resolveProductReference(text, context) {
  const value = normalizeLoose(text);
  const products = context?.lastRecommendedProducts || [];
  let index = null;

  const result = (overrides = {}) => ({
    type: 'existing', productId: null, authoritative: false, ambiguous: false,
    resolvedFrom: null, ordinalStatus: 'NO_EXPLICIT_ORDINAL', ...overrides
  });

  if (/\b(az )?elsot?\b/.test(value)) index = 0;
  if (/\b(a )?masodik(?:at)?\b/.test(value)) index = 1;
  if (/\b(a )?harmadik(?:at)?\b/.test(value)) index = 2;
  const laterOrdinal = /\b(negyedik(?:et)?|otodik(?:et)?|hatodik(?:at)?)\b/.exec(value);
  if (laterOrdinal) index = /^(?:negyedik)/.test(laterOrdinal[1]) ? 3 : /^otodik/.test(laterOrdinal[1]) ? 4 : 5;
  // A period or explicit Hungarian case suffix marks a numeric reference.
  // Closing quotes/brackets end the token just like whitespace; decimals and
  // ordinary unsuffixed quantities do not enter the ordinal grammar.
  const ordinalSuffix = '(?:at|et|ot|bol|ben|ban|rol|ra|re|hoz|hez|nak|nek|nal|nel|ert|kel|kal|kent|ig|e)';
  const numericText = String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const numericOrdinals = [...numericText.matchAll(new RegExp(`\\b(\\d+)(?:\\.(?=$|[\\s"'‘’„“”«»()\\[\\]!?;,:])|\\.?(?=[-–]${ordinalSuffix}\\b))`, 'g'))];
  if (numericOrdinals.length) index = numericOrdinals.every(match => Number(match[1]) >= 1 && Number(match[1]) <= 6) ? Number(numericOrdinals[0][1]) - 1 : -1;
  // An explicit unsupported ordinal is a failed reference, never absent intent.
  if (/\b(?:het|nyolc|kilenc|tiz|husz|harminc|negyven|otven|hatvan|hetven|nyolcvan|kilencven|szaz|ezer)[a-z]*(?:adik|edik|odik)(?:at|et)?\b/.test(value)) index = -1;
  // Hungarian case suffixes are still an explicit reference, not absent intent.
  const inflectedOrdinals = [...value.matchAll(new RegExp(`\\b((?:masodik|harmadik|negyedik|otodik|hatodik|(?:het|nyolc|kilenc|tiz|husz|harminc|negyven|otven|hatvan|hetven|nyolcvan|kilencven|szaz|ezer)[a-z]*(?:adik|edik|odik)))${ordinalSuffix}\\b`, 'g'))];
  const inflectedOrdinal = inflectedOrdinals.find(match => !['masodik','harmadik','negyedik','otodik','hatodik'].includes(match[1])) || inflectedOrdinals[0];
  if (inflectedOrdinal) {
    const supported = ['masodik','harmadik','negyedik','otodik','hatodik'].indexOf(inflectedOrdinal[1]);
    index = index === -1 || supported < 0 ? -1 : supported + 1;
  }
  if (index === null && /\b(az )?elobbit?\b/.test(value)) index = products.length === 2 ? 0 : -1;
  if (index === null && /\b(az )?utobbit?\b/.test(value)) index = products.length === 2 ? 1 : -1;

  if (index !== null) {
    return index >= 0 && products[index]
      ? result({ type: 'ordinal', productId: products[index], authoritative: true, resolvedFrom: 'ordered_list', ordinalStatus: 'VALID_DISPLAYED_ORDINAL' })
      : result({ type: 'ordinal', ambiguous: true, resolvedFrom: 'ordered_list', ordinalStatus: 'EXPLICIT_INVALID_OR_OUT_OF_RANGE_ORDINAL' });
  }

  if (/\bmasik\s+valtozat\b/.test(value)) {
    const target = context.lastSelectedProduct || context.lastUserProduct || context.lastFocusProduct || (products.length === 1 ? products[0] : null);
    return target
      ? result({ type: 'variant', productId: target, authoritative: true, resolvedFrom: 'focus' })
      : result({ type: 'variant', ambiguous: true, resolvedFrom: 'focus' });
  }

  if (/\b(a )masik(?:at|ban|ben)\b/.test(value)) {
    const selectedProduct = context.lastSelectedProduct || context.purchaseProductId || context.lastFocusProduct;
    if (products.length === 2 && selectedProduct && products.includes(selectedProduct)) {
      return result({
        type: 'alternative',
        productId: products.find((id) => id !== selectedProduct) || null,
        authoritative: true,
        resolvedFrom: 'ordered_list'
      });
    }
    return result({ type: 'alternative', ambiguous: true, resolvedFrom: products.length ? 'ordered_list' : 'focus' });
  }

  if (/\bmutass\w*\s+masikat\b|\bbelole\s+masik\b|\bvan\s+masik\b/.test(value)) {
    if (products.length > 1) {
      const primary = context.primaryRecommendedProduct || context.lastFocusProduct || products[0];
      const alternative = products.find((id) => id !== primary) || null;
      if (alternative) return result({ type: 'alternative', productId: alternative, authoritative: true, resolvedFrom: 'ordered_list' });
    }
    return result({ type: 'alternative', ambiguous: true, resolvedFrom: products.length ? 'ordered_list' : 'focus' });
  }

  const relativeType = /^(es\s+)?a\s+(szappan|krem|balzsam|sampon)(?:\?|$)/.exec(value);
  if (relativeType && context.lastFocusProduct) {
    const { resolveRelation } = require('./product-relations.cjs');
    const relation = resolveRelation(context.lastFocusProduct, relativeType[2]);
    if (relation?.relatedProduct) return result({
      type: 'companion', productId: relation.relatedProduct, authoritative: true,
      resolvedFrom: 'product_relation', relationType: relation.type
    });
    return result({ type: 'category', ambiguous: true, resolvedFrom: 'product_relation' });
  }

  if (/^(es\s+)?(ez|az)(\s+.*)?$|\b(ezt|ennek|ennel|ebben|benne|errol)\b/.test(value)) {
    if (context.lastSelectedProduct && context.productContextStatus !== 'ambiguous') {
      return result({ type: 'focus', productId: context.lastSelectedProduct, authoritative: true, resolvedFrom: 'explicit_focus' });
    }
    if (context.lastUserProduct && context.productContextStatus !== 'ambiguous') {
      return result({ type: 'focus', productId: context.lastUserProduct, authoritative: true, resolvedFrom: 'explicit_focus' });
    }
    if (context.lastFocusProduct && context.productContextStatus !== 'ambiguous') {
      return result({ type: 'focus', productId: context.lastFocusProduct, authoritative: true, resolvedFrom: 'focus' });
    }
    if (products.length === 1 && context.productContextStatus !== 'ambiguous') {
      return result({ type: 'focus', productId: products[0], authoritative: true, resolvedFrom: 'single_product' });
    }
    return result({ type: 'focus', ambiguous: products.length > 1 });
  }

  if (/\b(ebbol|belole|ezt|azt)\b/.test(value)) {
    if (context.lastSelectedProduct && context.productContextStatus !== 'ambiguous') {
      return result({ type: 'focus', productId: context.lastSelectedProduct, authoritative: true, resolvedFrom: 'explicit_focus' });
    }
    if (context.lastUserProduct && context.productContextStatus !== 'ambiguous') {
      return result({ type: 'focus', productId: context.lastUserProduct, authoritative: true, resolvedFrom: 'explicit_focus' });
    }
    if (context.lastFocusProduct && context.productContextStatus !== 'ambiguous') {
      return result({ type: 'focus', productId: context.lastFocusProduct, authoritative: true, resolvedFrom: 'focus' });
    }
    if (products.length === 1 && context.productContextStatus !== 'ambiguous') {
      return result({ type: 'focus', productId: products[0], authoritative: true, resolvedFrom: 'single_product' });
    }
    return result({ type: 'focus', ambiguous: products.length > 1 });
  }

  return null;
}

/* =========================================================
   BESZÉLGETÉSI KONTEXTUS
========================================================= */

function buildConversationContext(
  history = [],
  normalize
) {

  const context = {

    lastUserProduct:
      null,

    lastAssistantProduct:
      null,

    lastSelectedProduct:
      null,

    lastProduct:
      null,

    lastProblem:
      null,

    lastUserMessage:
      null,

    lastAssistantMessage:
      null,

    lastUserEmail:
      null,

    lastRecommendedProducts:
      [],

    mentionedProducts:
      []
    ,
    lastFocusProduct:
      null,

    primaryRecommendedProduct:
      null,

    lastProblemDomain:
      null,

    lastResponseType:
      null,

    missingArgument:
      null,

    lastCommerceIntent:
      null,

    productContextStatus:
      'unresolved'
  };

  for (
    const message of
    history.slice(
      -20
    )
  ) {

    if (
      !message ||
      !message.content || message.historyEventInvalid === true || message.historyEventUncorrelated === true
    ) {
      continue;
    }

    const originalText =
      String(
        message.content
      ).trim();

    const text =
      normalize
        ? normalize(
            originalText
          )
        : normalizeLoose(
            originalText
          );

    /* -------------------------
       UTOLSÓ ÜZENETEK
    ------------------------- */

    if (
      message.role ===
      'user'
    ) {

      context.lastUserMessage =
        text;

      const reference = resolveProductReference(originalText, context);
      if (reference?.productId) {
        context.lastSelectedProduct = reference.productId;
        context.productContextStatus = 'resolved';
      }

      if (
        looksLikeEmail(
          originalText
        )
      ) {

        context.lastUserEmail =
          originalText;
      }
    }

    if (
      message.role ===
      'assistant'
    ) {

      context.lastAssistantMessage =
        text;

      context.lastResponseType = message.responseType || message.route || message.source || 'answer';

      if (message.route === 'subtype_catalog' && message.catalogStatus === 'CATALOG_AVAILABLE_NO_MATCH') {
        if (message.historySelectionSuperseded) {
          const superseded = context.lastRecommendedProducts;
          for (const key of ['lastSelectedProduct','lastUserProduct','lastAssistantProduct','primaryRecommendedProduct','lastProduct']) {
            if (superseded.includes(context[key])) context[key] = null;
          }
          context.productContextStatus = 'unresolved';
        }
        context.lastRecommendedProducts = [];
        // Retain unrelated focus; only the displayed ordinal selection is empty.
        continue;
      }

      if (message.historySelectionAuthority) {
        context.lastSelectedProduct = null;
        context.lastUserProduct = null;
      }
      if (message.targetProductId) {
        context.lastAssistantProduct = String(message.targetProductId);
        context.primaryRecommendedProduct = String(message.targetProductId);
        context.productContextStatus = 'resolved';
      }
    }

    /* -------------------------
       TERMÉK
    ------------------------- */

    const linkedProducts = Array.isArray(message.links)
      ? message.links.map((item) => String(item?.id || '')).filter(Boolean)
      : [];
    const persistedEvidence = linkedProducts.length ? null : resolvePersistedProductEvidence(text);
    const products = linkedProducts.length ? linkedProducts : persistedEvidence.orderedProductIds;
    const productEvidenceAmbiguous = !linkedProducts.length && persistedEvidence.status === 'ambiguous';
    const product = message.role === 'assistant' ? message.targetProductId || products[0] || null : products.length === 1 ? products[0] : null;

    if ((products.length > 1 && !message.targetProductId) || productEvidenceAmbiguous) {
      context.productContextStatus = 'ambiguous';
      if (message.role === 'user') {
        context.lastUserProduct = null;
        context.lastSelectedProduct = null;
      }
      if (message.role === 'assistant') {
        context.lastAssistantProduct = null;
        context.primaryRecommendedProduct = null;
        context.lastRecommendedProducts = productEvidenceAmbiguous && products.length < 2 ? [] : products;
      }
    }

    if (
      product
    ) {

      if (
        !context
          .mentionedProducts
          .includes(
            product
          )
      ) {

        context
          .mentionedProducts
          .push(
            product
          );
      }

      if (
        message.role ===
        'user'
      ) {

        context.lastUserProduct =
          product;

        context.lastSelectedProduct =
          product;
      }

      if (
        message.role ===
        'assistant'
      ) {

        context.lastAssistantProduct =
          product;

        context.lastRecommendedProducts =
          products;

        context.primaryRecommendedProduct = message.targetProductId || products[0] || null;
      }

      context.lastProduct =
        product;

      if (products.length === 1 && !productEvidenceAmbiguous) context.productContextStatus = 'resolved';
    }

    /* -------------------------
       PROBLÉMA
    ------------------------- */

    const problem =
      detectProblem(
        originalText
      );

    if (
      problem
    ) {

      context.lastProblem =
        problem;

      context.lastProblemDomain = problem;
    }
  }

  context.lastProduct =
    context.lastUserProduct ||
    context.lastAssistantProduct ||
    context.lastProduct;

  context.lastFocusProduct = context.lastSelectedProduct || context.lastUserProduct || context.primaryRecommendedProduct || context.lastProduct;
  if (!context.lastFocusProduct && context.productContextStatus !== 'ambiguous') context.productContextStatus = 'unresolved';

  const lastUserText = context.lastUserMessage || '';
  if (/\b(mennyibe kerul|keszleten|nagyobb|kisebb)\b/.test(lastUserText) && !context.lastFocusProduct) {
    context.missingArgument = 'product';
  }

  for (const message of [...history].reverse()) {
    if (message?.role === 'assistant' && message.intent && /order|shipping|payment|price|availability/.test(message.intent)) {
      context.lastCommerceIntent = message.intent;
      break;
    }
  }

  return context;
}

module.exports = {

  buildConversationContext,

  detectProblem,

  looksLikeEmail,

  isFollowUpMessage,

  resolveProductReference
};
