'use strict';

const {
  findProductInText
} = require(
  './product-faq.cjs'
);
const { resolvePersistedProductEvidence } = require('./persisted-product-evidence.cjs');

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

  if (/\b(az )?elsot?\b/.test(value)) index = 0;
  if (/\b(a )?masodik(?:at)?\b/.test(value)) index = 1;
  if (/\b(a )?harmadikat?\b/.test(value)) index = 2;
  if (/\b(az )?elobbit?\b/.test(value)) index = products.length === 2 ? 0 : -1;
  if (/\b(az )?utobbit?\b/.test(value)) index = products.length === 2 ? 1 : -1;

  if (index !== null) {
    return index >= 0 && products[index]
      ? { productId: products[index], ambiguous: false, resolvedFrom: 'ordered_list' }
      : { productId: null, ambiguous: true };
  }

  if (/\b(a )?masikat\b/.test(value)) {
    const selectedProduct = context.lastSelectedProduct || context.purchaseProductId;
    if (products.length === 2 && selectedProduct && products.includes(selectedProduct)) {
      return {
        productId: products.find((id) => id !== selectedProduct) || null,
        ambiguous: false,
        resolvedFrom: 'ordered_list'
      };
    }
    return { productId: null, ambiguous: true };
  }

  if (/^(es\s+)?(ez|az)(\s+.*)?$|\b(ezt|ennek|ennel|ebben|benne|errol)\b/.test(value)) {
    if (context.lastSelectedProduct) {
      return { productId: context.lastSelectedProduct, ambiguous: false, resolvedFrom: 'explicit_focus' };
    }
    if (context.lastUserProduct) {
      return { productId: context.lastUserProduct, ambiguous: false, resolvedFrom: 'explicit_focus' };
    }
    if (context.lastFocusProduct && context.productContextStatus !== 'ambiguous') {
      return { productId: context.lastFocusProduct, ambiguous: false, resolvedFrom: 'focus' };
    }
    if (products.length === 1) {
      return { productId: products[0], ambiguous: false, resolvedFrom: 'single_product' };
    }
    return { productId: null, ambiguous: products.length > 1 };
  }

  if (/\b(ebbol|belole|ezt|azt)\b/.test(value)) {
    if (context.lastSelectedProduct) {
      return { productId: context.lastSelectedProduct, ambiguous: false, resolvedFrom: 'explicit_focus' };
    }
    if (context.lastUserProduct) {
      return { productId: context.lastUserProduct, ambiguous: false, resolvedFrom: 'explicit_focus' };
    }
    if (context.lastFocusProduct && context.productContextStatus !== 'ambiguous') {
      return { productId: context.lastFocusProduct, ambiguous: false, resolvedFrom: 'focus' };
    }
    if (products.length === 1) {
      return { productId: products[0], ambiguous: false, resolvedFrom: 'single_product' };
    }
    return { productId: null, ambiguous: products.length > 1 };
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
      !message.content
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

        context.primaryRecommendedProduct = products[0] || null;
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
