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
    item.source ===
      'unas' &&
    (
      item.sourceType ===
        'product' ||
      item.type ===
        'product' ||
      item.category ===
        'UNAS termék'
    )
  );
}

/* =========================================================
   TECHNIKAI ZAJ ELTÁVOLÍTÁSA
========================================================= */

function removeTechnicalNoise(
  value
) {
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
      /\bÁr:\s*[^.]{0,120}\.?/gi,
      ''
    )
    .replace(
      /\bKiszerelés vagy egység:\s*[^.]{0,120}\.?/gi,
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

function asksAboutSlsOrSles(
  question
) {
  const q =
    normalize(
      question
    );

  return (
    /\bsls\b/.test(q) ||
    /\bsles\b/.test(q) ||
    q.includes(
      'sodium lauryl sulfate'
    ) ||
    q.includes(
      'sodium laureth sulfate'
    )
  );
}

function buildSlsAnswer() {
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
   TERMÉKKATALÓGUS-KÉRDÉS
========================================================= */

function isCatalogQuestion(
  question
) {
  const q =
    normalize(
      question
    );

  return (
    q.includes(
      'termek'
    ) ||
    q.includes(
      'termekeitek'
    ) ||
    q.includes(
      'termeketek'
    ) ||
    q.includes(
      'milyen'
    ) ||
    q.includes(
      'mik vannak'
    ) ||
    q.includes(
      'mit ajanl'
    ) ||
    q.includes(
      'melyik'
    )
  );
}

/* =========================================================
   KERESŐSZAVAK
========================================================= */

const GENERIC_WORDS =
  new Set([
    'milyen',
    'mik',
    'melyik',
    'van',
    'vannak',
    'termek',
    'termekek',
    'termekeitek',
    'termeketek',
    'nalatok',
    'keresek',
    'szeretnek',
    'ajanlasz',
    'ajanlotok',
    'lehet',
    'kapni',
    'tovabbi'
  ]);

function getMeaningfulTokens(
  question
) {
  return normalize(
    question
  )
    .split(
      ' '
    )
    .filter(
      (token) =>
        token.length >=
          4 &&
        !GENERIC_WORDS.has(
          token
        )
    );
}

/* =========================================================
   UNAS TERMÉKKERESÉS
========================================================= */

function findMatchingProducts(
  knowledge,
  question
) {
  const tokens =
    getMeaningfulTokens(
      question
    );

  if (
    !tokens.length
  ) {
    return [];
  }

  const scored =
    knowledge
      .filter(
        isProductItem
      )
      .map(
        (item) => {

          const title =
            normalize(
              getItemTitle(
                item
              )
            );

          const searchable =
            normalize(
              [
                item.title,
                item.name,
                item.shortAnswer,
                item.fullAnswer,
                item.keywords
                  ?.join(
                    ' '
                  ),
                item.products
                  ?.join(
                    ' '
                  ),
                item.category,
                item.subcategory
              ]
                .filter(
                  Boolean
                )
                .join(
                  ' '
                )
            );

          let score =
            0;

          let matchedTokens =
            0;

          for (
            const token of
            tokens
          ) {

            let matched =
              false;

            if (
              title.includes(
                token
              )
            ) {
              score +=
                100;

              matched =
                true;
            }

            if (
              searchable.includes(
                token
              )
            ) {
              score +=
                25;

              matched =
                true;
            }

            if (
              matched
            ) {
              matchedTokens +=
                1;
            }
          }

          /*
            Több keresőszó együttes
            egyezése extra pontot kap.
          */

          if (
            matchedTokens >=
            2
          ) {
            score +=
              50;
          }

          return {
            item,
            score
          };
        }
      )
      .filter(
        (match) =>
          match.score >
          0
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      );

  const unique =
    [];

  const seen =
    new Set();

  for (
    const match of
    scored
  ) {

    const title =
      getItemTitle(
        match.item
      );

    const key =
      normalize(
        title
      );

    if (
      seen.has(
        key
      )
    ) {
      continue;
    }

    seen.add(
      key
    );

    unique.push(
      match
    );

    if (
      unique.length >=
      6
    ) {
      break;
    }
  }

  return unique;
}

/* =========================================================
   TERMÉKLISTA VÁLASZ
========================================================= */

function buildProductListAnswer(
  matches
) {
  if (
    !matches.length
  ) {
    return null;
  }

  const items =
    matches
      .map(
        (match) =>
          match.item
      )
      .slice(
        0,
        6
      );

  const lines =
    items.map(
      (item) => {

        const title =
          getItemTitle(
            item
          );

        const raw =
          removeTechnicalNoise(
            getItemAnswer(
              item
            )
          );

        const summary =
          shorten(
            raw,
            105
          );

        return summary
          ? `• ${title} – ${summary}`
          : `• ${title}`;
      }
    );

  return {
    source:
      'unas-list',

    answer:
      `Több kapcsolódó termékünk is van:\n\n${lines.join(
        '\n'
      )}\n\nHa megírod, melyik érdekel, szívesen segítek részletesebben is.`,

    confidence:
      matches[0]
        .score,

    links:
      items
        .filter(
          (item) =>
            item.url
        )
        .map(
          (item) => ({
            label:
              getItemTitle(
                item
              ),

            url:
              item.url
          })
        ),

    suggestions:
      [],

    ruleId:
      null,

    intent:
      'product-list',

    matchedKnowledgeIds:
      items.map(
        (item) =>
          item.id
      )
  };
}

/* =========================================================
   EGYEDI TUDÁSVÁLASZ
========================================================= */

function buildSingleAnswer(
  item,
  score
) {
  const raw =
    removeTechnicalNoise(
      getItemAnswer(
        item
      )
    );

  return {
    source:
      item.source ===
      'unas'
        ? 'unas-knowledge'
        : 'knowledge-fallback',

    answer:
      shorten(
        raw,
        480
      ),

    confidence:
      score,

    links:
      item.url
        ? [
            {
              label:
                getItemTitle(
                  item
                ),

              url:
                item.url
            }
          ]
        : [],

    suggestions:
      [],

    ruleId:
      null,

    intent:
      item.intents?.[0] ||
      null,

    matchedKnowledgeIds:
      [
        item.id
      ]
  };
}

/* =========================================================
   EMAIL FOLLOW-UP
========================================================= */

function buildEmailFollowUpAnswer(
  context
) {
  const previous =
    context.lastAssistantMessage ||
    '';

  if (
    previous.includes(
      'kod'
    ) ||
    previous.includes(
      'email'
    ) ||
    previous.includes(
      'e-mail'
    )
  ) {
    return {
      source:
        'conversation-context',

      answer:
        'Köszönöm, megkaptam az e-mail-címet. Az ügyintézéshez ezt az adatot továbbítani kell a Vitalis ügyfélszolgálatnak. Itt a chatbotban nem tudok kedvezménykódot kiküldeni vagy a feliratkozást ellenőrizni.',

      confidence:
        100,

      links:
        [],

      suggestions:
        [],

      ruleId:
        'email-followup',

      intent:
        'customer-service-followup',

      matchedKnowledgeIds:
        []
    };
  }

  return {
    source:
      'conversation-context',

    answer:
      'Köszönöm, megkaptam az e-mail-címet. Kérlek, írd meg röviden azt is, milyen ügyben küldted, hogy megfelelően tudjak segíteni.',

    confidence:
      100,

    links:
      [],

    suggestions:
      [],

    ruleId:
      'email-followup',

    intent:
      'conversation-followup',

    matchedKnowledgeIds:
      []
  };
}

/* =========================================================
   FOLYTATÓ KÉRDÉS KIBŐVÍTÉSE
========================================================= */

function expandFollowUpQuestion(
  question,
  context
) {
  const normalizedQuestion =
    normalize(
      question
    );

  if (
    !isFollowUpMessage(
      normalizedQuestion
    )
  ) {
    return question;
  }

  const problemMap = {

    psoriasis:
      'Milyen további Vitalis termékeket ajánlotok pikkelysömörre hajlamos bőr kozmetikai ápolására?',

    eczema:
      'Milyen további Vitalis termékeket ajánlotok ekcémára vagy atópiára hajlamos bőr kozmetikai ápolására?',

    rosacea:
      'Milyen Vitalis termékeket ajánlotok rosaceára és kipirosodásra hajlamos érzékeny arcbőr kozmetikai ápolására?',

    acne:
      'Milyen Vitalis termékeket ajánlotok pattanásos és aknéra hajlamos bőr kozmetikai ápolására?',

    dry_skin:
      'Milyen további Vitalis termékeket ajánlotok száraz bőr mindennapi kozmetikai ápolására?',

    scalp:
      'Milyen további Vitalis termékeket ajánlotok problémás, viszkető vagy korpás fejbőr kozmetikai ápolására?'
  };

  if (
    context.lastProblem &&
    problemMap[
      context.lastProblem
    ]
  ) {
    return problemMap[
      context.lastProblem
    ];
  }

  /*
    Ha nincs problémakör,
    de volt konkrét termék,
    a folytatást ahhoz kötjük.
  */

  if (
    context.lastProduct
  ) {
    return (
      `${context.lastProduct} termékkel kapcsolatban: ${question}`
    );
  }

  return question;
}

/* =========================================================
   FŐ VÁLASZKÉPZÉS
========================================================= */

function createAnswer({
  question,
  history,
  knowledge,
  ruleEngine,
  logGap
}) {

  /*
    1. BESZÉLGETÉSI KONTEXTUS
  */

  const context =
    buildConversationContext(
      history,
      normalize
    );

  /*
    2. EMAIL-CÍM

    Puszta e-mail-címet soha nem küldünk
    a tudásbázis-keresőbe.
  */

  if (
    looksLikeEmail(
      question
    )
  ) {
    return buildEmailFollowUpAnswer(
      context
    );
  }

  /*
    3. SLS / SLES

    Ez biztos, elsőbbségi Vitalis tudás.
  */

  if (
    asksAboutSlsOrSles(
      question
    )
  ) {
    return buildSlsAnswer();
  }

  /*
    4. RÖVID FOLYTATÁS KIBŐVÍTÉSE

    Például:
    "Más is van még?"
    -> az előző problémával együtt értelmezzük.
  */

  const effectiveQuestion =
    expandFollowUpQuestion(
      question,
      context
    );

  /*
    5. TERMÉKKATALÓGUS-KÉRDÉSEK

    Az UNAS katalógus keresése
    megelőzi a szabálymotort.
  */

  if (
    isCatalogQuestion(
      effectiveQuestion
    )
  ) {

    const productMatches =
      findMatchingProducts(
        knowledge,
        effectiveQuestion
      );

    if (
      productMatches.length
    ) {

      const listAnswer =
        buildProductListAnswer(
          productMatches
        );

      if (
        listAnswer
      ) {
        return listAnswer;
      }
    }
  }

  /*
    6. SZAKÉRTŐI SZABÁLYOK
  */

  const expert =
    ruleEngine.resolve(
      effectiveQuestion,
      history
    );

  if (
    expert
  ) {
    return expert;
  }

  /*
    7. ÁLTALÁNOS TUDÁSBÁZIS
  */

  const matches =
    searchKnowledge(
      knowledge,
      effectiveQuestion
    );

  const best =
    matches[0];

  if (
    !best ||
    best.score <
    60
  ) {

    logGap(
      effectiveQuestion,
      best?.score ||
      0,
      history
    );

    return {
      source:
        'gap',

      answer:
        'Erre még nem találtam elég pontos, jóváhagyott Vitalis-információt. Írd meg kérlek részletesebben, melyik termékről vagy problémáról van szó.',

      confidence:
        best?.score ||
        0,

      links:
        [],

      suggestions:
        [],

      ruleId:
        null,

      intent:
        null,

      matchedKnowledgeIds:
        []
    };
  }

  /*
    8. LEGJOBB EGYEDI TALÁLAT
  */

  return buildSingleAnswer(
    best.item,
    best.score
  );
}

module.exports = {
  createAnswer
};
