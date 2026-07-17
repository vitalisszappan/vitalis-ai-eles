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
      /\bÁr:\s*[^.]{0,120}\.?/gi,
      ''
    )
    .replace(
      /\bKiszerelés vagy egység:\s*[^.]{0,120}\.?/gi,
      ''
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

/* =========================================================
   TERMÉKKATALÓGUS-KÉRDÉS FELISMERÉSE
========================================================= */

function isCatalogQuestion(question) {
  const q =
    normalize(
      question
    );

  return (
    q.includes('termek') ||
    q.includes('termekeitek') ||
    q.includes('termeketek') ||
    q.includes('milyen') ||
    q.includes('mik vannak') ||
    q.includes('mit ajanl') ||
    q.includes('melyik')
  );
}

/* =========================================================
   KERESŐSZAVAK KINYERÉSE
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
    'kapni'
  ]);

function getMeaningfulTokens(
  question
) {
  return normalize(
    question
  )
    .split(' ')
    .filter(
      (token) =>
        token.length >= 4 &&
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
                item.keywords?.join(' '),
                item.products?.join(' '),
                item.category,
                item.subcategory
              ]
                .filter(Boolean)
                .join(' ')
            );

          let score =
            0;

          for (
            const token of
            tokens
          ) {

            if (
              title.includes(
                token
              )
            ) {
              score +=
                100;
            }

            if (
              searchable.includes(
                token
              )
            ) {
              score +=
                25;
            }
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
    matches.map(
      (match) =>
        match.item
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
            120
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
      `Igen, több kapcsolódó termékünk is van:\n\n${lines.join(
        '\n'
      )}\n\nHa megírod, hogy melyik érdekel, szívesen segítek részletesebben is.`,

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
    1. TERMÉKKATALÓGUS-KÉRDÉSEK

    Ezeket a szabálymotor ELŐTT kezeljük,
    mert különben egy túl általános expert rule
    elviheti a kérdést rossz irányba.
  */

  if (
    isCatalogQuestion(
      question
    )
  ) {

    const productMatches =
      findMatchingProducts(
        knowledge,
        question
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
    2. SZAKÉRTŐI SZABÁLYOK

    Csak akkor futnak, ha nem sikerült
    konkrét katalógustalálatot adni.
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
    3. ÁLTALÁNOS TUDÁSBÁZIS-KERESÉS
  */

  const matches =
    searchKnowledge(
      knowledge,
      question
    );

  const best =
    matches[0];

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

  return buildSingleAnswer(
    best.item,
    best.score
  );
}

module.exports = {
  createAnswer
};
