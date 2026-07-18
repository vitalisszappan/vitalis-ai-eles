const {
  findProductInText
} = require(
  './product-faq.cjs'
);

/* =========================================================
   PROBLÉMAFELISMERÉS
========================================================= */

const PROBLEM_PATTERNS = [

  [
    'eczema',
    [
      'ekcema',
      'atopias',
      'dermatitisz'
    ]
  ],

  [
    'scalp',
    [
      'fejbor',
      'korpa',
      'korpas',
      'hajlas',
      'viszket a fejbor'
    ]
  ],

  [
    'psoriasis',
    [
      'pikkelysomor',
      'pszoriazis'
    ]
  ],

  [
    'acne',
    [
      'akne',
      'pattanas',
      'pattanasos',
      'mitesszer'
    ]
  ],

  [
    'dry_skin',
    [
      'szaraz bor',
      'kiszaradt bor',
      'huzodik a borom'
    ]
  ],

  [
    'rosacea',
    [
      'rosacea',
      'rozacea',
      'rozsacea',
      'kipirosodas',
      'pirosodo arcbor'
    ]
  ]
];

/* =========================================================
   PROBLÉMA AZONOSÍTÁSA
========================================================= */

function detectProblem(
  text
) {
  for (
    const [
      id,
      phrases
    ] of PROBLEM_PATTERNS
  ) {

    if (
      phrases.some(
        (
          phrase
        ) =>
          text.includes(
            phrase
          )
      )
    ) {
      return id;
    }
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
    String(
      text ||
      ''
    ).trim();

  if (
    !value
  ) {
    return false;
  }

  const followUps = [

    'mas is van',
    'mas is van meg',
    'es meg',
    'van mas',
    'melyik',
    'melyiket',
    'melyiket ajanlod',
    'mit ajanlasz',
    'es krem',
    'krem is van',
    'es szappan',
    'szappan is van',
    'igen',
    'nem',
    'oke',
    'rendben',
    'nem kaptam kodot',
    'nem kaptam meg',
    'es akkor'
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

    mentionedProducts:
      []
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
      normalize(
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
    }

    /* -------------------------
       TERMÉK
    ------------------------- */

    const product =
      findProductInText(
        text,
        message.role ===
          'assistant'
      );

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
      }

      if (
        message.role ===
        'assistant'
      ) {

        context.lastAssistantProduct =
          product;
      }

      context.lastProduct =
        product;
    }

    /* -------------------------
       PROBLÉMA
    ------------------------- */

    const problem =
      detectProblem(
        text
      );

    if (
      problem
    ) {

      context.lastProblem =
        problem;
    }
  }

  /*
    Konkrét felhasználói terméknév elsőbbséget kap.
    Ha nincs, az utolsó ajánlott terméket használjuk.
  */

  context.lastProduct =
    context.lastUserProduct ||
    context.lastAssistantProduct ||
    context.lastProduct;

  return context;
}

module.exports = {

  buildConversationContext,

  detectProblem,

  looksLikeEmail,

  isFollowUpMessage
};
