'use strict';

const {
  searchKnowledge
} = require(
  './knowledge-fallback.cjs'
);

const {
  normalize
} = require(
  './normalizer.cjs'
);

const {
  buildConversationContext,
  detectProblem,
  looksLikeEmail,
  isFollowUpMessage
} = require(
  './conversation-context.cjs'
);

/* =========================================================
   SEGÉDFÜGGVÉNYEK
========================================================= */

function cleanText(value = '') {
  return String(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function shorten(
  value,
  maxLength = 240
) {
  const text =
    cleanText(value);

  if (
    text.length <=
    maxLength
  ) {
    return text;
  }

  const cut =
    text.slice(
      0,
      maxLength
    );

  const lastSentence =
    Math.max(
      cut.lastIndexOf('.'),
      cut.lastIndexOf('!'),
      cut.lastIndexOf('?')
    );

  if (
    lastSentence >
    80
  ) {
    return cut
      .slice(
        0,
        lastSentence + 1
      )
      .trim();
  }

  return (
    cut
      .replace(
        /\s+\S*$/,
        ''
      )
      .trim() +
    '…'
  );
}

function getItemAnswer(item) {
  return cleanText(
    item.shortAnswer ||
    item.fullAnswer ||
    item.answer ||
    ''
  );
}

function getItemTitle(item) {
  return cleanText(
    item.title ||
    item.name ||
    item.products?.[0] ||
    'Termék'
  );
}

function isProductItem(item) {
  return (
    item &&
    item.source === 'unas' &&
    (
      item.sourceType === 'product' ||
      item.type === 'product' ||
      item.category === 'UNAS termék'
    )
  );
}

/* =========================================================
   TECHNIKAI ZAJ ELTÁVOLÍTÁSA
========================================================= */

function removeTechnicalNoise(value) {
  let text =
    cleanText(value);

  const cutMarkers = [
    'Összetevők (INCI):',
    'Összetevők:',
    'INCI:',
    'Ingredients:',
    'Mit tapasztalhatsz rendszeres használat mellett?',
    'Használati javaslat'
  ];

  for (
    const marker of
    cutMarkers
  ) {
    const index =
      text.indexOf(
        marker
      );

    if (
      index >
      50
    ) {
      text =
        text.slice(
          0,
          index
        );
    }
  }

  return text
    .replace(
      /\bÁr:\s*[^.]{0,160}\.?/gi,
      ''
    )
    .replace(
      /\bKiszerelés vagy egység:\s*[^.]{0,160}\.?/gi,
      ''
    )
    .replace(
      /\bnormal\b/gi,
      ''
    )
    .replace(
      /\b\d{3,6}\s+\d{3,6}\s*Ft\b/gi,
      ''
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

/* =========================================================
   SLS / SLES
========================================================= */

function answerSlsSlesQuestion(
  question
) {
  const q =
    normalize(
      question
    );

  const asksAboutSls =
    /\bsls\b/.test(q) ||
    /\bsles\b/.test(q) ||
    q.includes(
      'sodium lauryl sulfate'
    ) ||
    q.includes(
      'sodium laureth sulfate'
    );

  if (
    !asksAboutSls
  ) {
    return null;
  }

  return {
    source:
      'expert-sls-sles',

    answer:
      'Szia! Nem, a Vitalis termékeink nem tartalmaznak SLS-t vagy SLES-t. Ha megírod, melyik konkrét terméket nézed, szívesen segítek az összetevőivel kapcsolatban is.',

    confidence:
      100,

    links:
      [],

    suggestions:
      [],

    ruleId:
      'sls-sles-free',

    intent:
      'ingredient-question',

    matchedKnowledgeIds:
      []
  };
}

/* =========================================================
   BESZÉLGETÉSI FOLYTATÁSOK
========================================================= */

const PROBLEM_FOLLOW_UPS = {

  psoriasis:
    'Milyen további Vitalis termékek vannak pikkelysömörre hajlamos bőr kozmetikai ápolására?',

  eczema:
    'Milyen további Vitalis termékek vannak ekcémára vagy atópiára hajlamos bőr kozmetikai ápolására?',

  rosacea:
    'Milyen Vitalis termékek vannak rosaceára és kipirosodásra hajlamos érzékeny arcbőr kozmetikai ápolására?',

  acne:
    'Milyen Vitalis termékek vannak pattanásos vagy aknéra hajlamos bőr kozmetikai ápolására?',

  dry_skin:
    'Milyen Vitalis termékek vannak száraz bőr mindennapi kozmetikai ápolására?',

  scalp:
    'Milyen Vitalis termékek vannak problémás, viszkető vagy korpás fejbőr kozmetikai ápolására?'
};

function expandQuestionFromContext
