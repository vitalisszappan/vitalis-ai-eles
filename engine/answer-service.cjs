const {
  searchKnowledge
} = require(
  './knowledge-fallback.cjs'
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
  maxLength = 420
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
    120
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

function getItemAnswer(
  item
) {
  return cleanText(
    item.shortAnswer ||
    item.fullAnswer ||
    item.answer ||
    ''
  );
}

function getItemTitle(
  item
) {
  return cleanText(
    item.title ||
    item.name ||
    item.products?.[0] ||
    'Termék'
  );
}

function isProductItem(
  item
) {
  return (
    item.source ===
      'unas' ||
    item.sourceType ===
      'product' ||
    item.type ===
      'product'
  );
}

function isCategoryItem(
  item
) {
  return (
    item.sourceType ===
      'category' ||
    item.type ===
      'category'
  );
}

function looksLikeListQuestion(
  question
) {
  const q =
    cleanText(
      question
    ).toLowerCase();

  return (
    /\bmilyen\b/.test(q) ||
    /\bmik\b/.test(q) ||
    /\bmelyik\b/.test(q) ||
    /\btermékek\b/.test(q) ||
    /\btermékeitek\b/.test(q) ||
    /\bvan\b/.test(q) ||
    /\bvannak\b/.test(q) ||
    /\bajánlotok\b/.test(q) ||
    /\bajánlasz\b/.test(q)
  );
}

function removeTechnicalNoise(
  value
) {
  let text =
    cleanText(value);

  const cutMarkers = [
    'Összetevők (INCI):',
    'Összetevők:',
    'INCI:',
    'Ingredients:'
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
      80
    ) {
      text =
        text.slice(
          0,
          index
        );
    }
  }

  text =
    text
      .replace(
        /\bÁr:\s*[^.]{0,100}\.?/gi,
        ''
      )
      .replace(
        /\bKiszerelés vagy egység:\s*[^.]{0,100}\.?/gi,
        ''
      )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();

  return text;
}

/* =========================================================
   EGY TERMÉK RÖVID VÁLASZA
========================================================= */

function buildSingleAnswer(
  item
) {
  const raw =
    removeTechnicalNoise(
      getItemAnswer(
        item
      )
    );

  const answer =
    shorten(
      raw,
      520
    );

  return {
    source:
      item.source ===
      'unas'
        ? 'unas-knowledge'
        : 'knowledge-fallback',

    answer,

    confidence:
      null,

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
   TÖBB TERMÉK RÖVID FELSOROLÁSA
========================================================= */

function buildListAnswer(
  matches
) {
  const unique = [];

  const seen =
    new Set();

  for (
    const match of
    matches
  ) {
    const item =
      match.item;

    if (
      !isProductItem(
        item
      )
    ) {
      continue;
    }

    const title =
      getItemTitle(
        item
      );

    const key =
      title.toLowerCase();

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
      item
    );

    if (
      unique.length >=
      5
    ) {
      break;
    }
  }

  if (
    unique.length <
    2
  ) {
    return null;
  }

  const lines =
    unique.map(
      (
        item
      ) => {

        const raw =
          removeTechnicalNoise(
            getItemAnswer(
              item
            )
          );

        const summary =
          shorten(
            raw,
            135
          );

        return (
          `• ${getItemTitle(item)}` +
          (
            summary
              ? ` – ${summary}`
              : ''
          )
        );
      }
    );

  return {
    source:
      'unas-list',

    answer:
      `Több kapcsolódó termékünk is van:\n\n${lines.join(
        '\n'
      )}\n\nHa megírod, melyik típus érdekel leginkább, segítek szűkíteni a választást.`,

    confidence:
      null,

    links:
      unique
        .filter(
          (
            item
          ) =>
            item.url
        )
        .map(
          (
            item
          ) => ({
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
      unique.map(
        (
          item
        ) =>
          item.id
      )
  };
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
    1. Szakértői szabályok mindig elsőbbséget élveznek.
  */

  const expert =
    ruleEngine.resolve(
      question,
      history
    );

  if (
    expert
  ) {
    return expert;
  }

  /*
    2. Tudásbázis keresés.
  */

  const matches =
    searchKnowledge(
      knowledge,
      question
    );

  const best =
    matches[0];

  /*
    3. Nincs megfelelő találat.
  */

  if (
    !best ||
    best.score <
    60
  ) {

    logGap(
      question,
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
        null
    };
  }

  /*
    4. Listázó kérdés:
       több termék röviden.
  */

  if (
    looksLikeListQuestion(
      question
    )
  ) {

    const listAnswer =
      buildListAnswer(
        matches
      );

    if (
      listAnswer
    ) {

      listAnswer.confidence =
        best.score;

      return listAnswer;
    }
  }

  /*
    5. Konkrét termék vagy kategória.
  */

  const result =
    buildSingleAnswer(
      best.item
    );

  result.confidence =
    best.score;

  return result;
}

module.exports = {
  createAnswer
};
