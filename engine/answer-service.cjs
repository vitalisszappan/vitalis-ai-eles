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

function removeTechnicalNoise(
  value
) {
  let text =
    cleanText(
      value
    );

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
   AJÁNLOTT TERMÉKEK AUTOMATIKUS UNAS LINKELÉSE
========================================================= */

function findUnasProductBySuggestion(
  knowledge,
  suggestion
) {
  const wanted =
    normalize(
      suggestion
    );

  if (
    !wanted
  ) {
    return null;
  }

  const wantedTokens =
    wanted
      .split(
        ' '
      )
      .filter(
        (
          token
        ) =>
          token.length >=
          3
      );

  const candidates =
    knowledge
      .filter(
        isProductItem
      )
      .map(
        (
          item
        ) => {

          const title =
            normalize(
              getItemTitle(
                item
              )
            );

          let score =
            0;

          if (
            title ===
            wanted
          ) {
            score +=
              1000;
          }

          if (
            title.includes(
              wanted
            ) ||
            wanted.includes(
              title
            )
          ) {
            score +=
              500;
          }

          for (
            const token of
            wantedTokens
          ) {
            if (
              title.includes(
                token
              )
            ) {
              score +=
                100;
            }
          }

          return {
            item,
            score
          };
        }
      )
      .filter(
        (
          candidate
        ) =>
          candidate.score >
          0
      )
      .sort(
        (
          a,
          b
        ) =>
          b.score -
          a.score
      );

  return candidates[0]?.item ||
    null;
}

function attachProductLinks(
  answer,
  knowledge
) {
  if (
    !answer ||
    !Array.isArray(
      answer.suggestions
    ) ||
    !answer.suggestions.length
  ) {
    return answer;
  }

  const links =
    [];

  const matchedKnowledgeIds =
    [];

  const seenUrls =
    new Set();

  for (
    const suggestion of
    answer.suggestions
  ) {
    const item =
      findUnasProductBySuggestion(
        knowledge,
        suggestion
      );

    if (
      !item ||
      !item.url ||
      seenUrls.has(
        item.url
      )
    ) {
      continue;
    }

    seenUrls.add(
      item.url
    );

    links.push({
      label:
        getItemTitle(
          item
        ),

      url:
        item.url
    });

    if (
      item.id
    ) {
      matchedKnowledgeIds.push(
        item.id
      );
    }
  }

  return {
    ...answer,

    links,

    matchedKnowledgeIds
  };
}

/* =========================================================
   PROBLÉMAKÖRÖK ELSŐBBSÉGI AJÁNLÁSA
========================================================= */

function buildProblemAnswer(
  problem
) {
  if (
    problem ===
    'psoriasis'
  ) {
    return {
      source:
        'expert-problem',

      answer:
        'Pikkelysömörre hajlamos, száraz és hámló bőr mindennapi kozmetikai ápolására elsősorban a PsoriVital csomagot ajánlom. A csomag Holt-tengeri só balzsamot, shea vajas szappant és Holt-tengeri iszapos szappant tartalmaz. A balzsam rendszeresen használható az érintett bőrfelületek ápolására. A termékek kozmetikumok, nem helyettesítik az orvosi kezelést.',

      confidence:
        100,

      links:
        [],

      suggestions:
        [
          'PsoriVital csomag',
          'Holt-tengeri só balzsam'
        ],

      ruleId:
        'problem-psoriasis',

      intent:
        'problem-recommendation',

      matchedKnowledgeIds:
        []
    };
  }

  if (
    problem ===
    'eczema'
  ) {
    return {
      source:
        'expert-problem',

      answer:
        'Ekcémára vagy atópiára hajlamos, érzékeny bőr kozmetikai ápolására elsősorban a Dermavital termékcsaládot ajánlom. A kíméletes tisztítás és az illatmentes bőrápolás lehet a legjobb kiindulás. Ha megírod, hogy arcra, testre vagy fejbőrre keresel megoldást, pontosabban is tudok ajánlani.',

      confidence:
        100,

      links:
        [],

      suggestions:
        [
          'Dermavital szappan',
          'Dermavital krém',
          'Dermavital sampon'
        ],

      ruleId:
        'problem-eczema',

      intent:
        'problem-recommendation',

      matchedKnowledgeIds:
        []
    };
  }

  if (
    problem ===
    'rosacea'
  ) {
    return {
      source:
        'expert-problem',

      answer:
        'Rosaceára, kipirosodásra hajlamos érzékeny arcbőrnél kíméletes, illatmentes bőrápolást javaslok. A Dermavital nyugtató bőrápoló krém lehet jó választás, mert érzékeny, irritált és kipirosodásra hajlamos bőr mindennapi ápolására készült. Erős illóolajos vagy intenzíven hámlasztó termékeket ilyen bőrnél érdemes kerülni.',

      confidence:
        100,

      links:
        [],

      suggestions:
  [
    'Dermavital nyugtató bőrápoló krém',
    'Natúr kecsketejes szappan',
    'Natúr olíva szappan'
  ],
        'problem-rosacea',

      intent:
        'problem-recommendation',

      matchedKnowledgeIds:
        []
    };
  }

  if (
    problem ===
    'couperose'
  ) {
    return {
      source:
        'expert-problem',

      answer:
        'Hajszálértágulatra vagy couperose-ra hajlamos arcbőrnél különösen fontos a kíméletes, nyugtató és lehetőleg illatmentes ápolás. Ilyen esetben a Dermavital nyugtató bőrápoló krém lehet jó kiindulás. A látható hajszálereket kozmetikum nem tünteti el, de az érzékeny bőr komfortérzetének támogatásában segíthet.',

      confidence:
        100,

      links:
        [],

      suggestions:
        [
          'Dermavital nyugtató bőrápoló krém'
        ],

      ruleId:
        'problem-couperose',

      intent:
        'problem-recommendation',

      matchedKnowledgeIds:
        []
    };
  }

  if (
    problem ===
    'acne'
  ) {
    return {
      source:
        'expert-problem',

      answer:
        'Pattanásos, aknéra hajlamos bőrnél a kíméletes tisztítás és a bőr túlzott kiszárításának kerülése fontos. Ha megírod, hogy arcbőrre vagy testre keresel terméket, segítek a megfelelő Vitalis termék kiválasztásában.',

      confidence:
        100,

      links:
        [],

      suggestions:
        [],

      ruleId:
        'problem-acne',

      intent:
        'problem-recommendation',

      matchedKnowledgeIds:
        []
    };
  }

  if (
    problem ===
    'dry_skin'
  ) {
    return {
      source:
        'expert-problem',

      answer:
        'Száraz, húzódó bőr ápolására kíméletes tisztítást és zsírosabb, tápláló bőrápolást javaslok. A shea vajat tartalmazó Vitalis szappanok és krémes bőrápolók jó kiindulást jelenthetnek. Ha megírod, hogy arcra, kézre vagy testre keresel terméket, pontosabban is ajánlok.',

      confidence:
        100,

      links:
        [],

      suggestions:
        [],

      ruleId:
        'problem-dry-skin',

      intent:
        'problem-recommendation',

      matchedKnowledgeIds:
        []
    };
  }

  if (
    problem ===
    'scalp'
  ) {
    return {
      source:
        'expert-problem',

      answer:
        'Problémás, viszkető vagy korpás fejbőrre elsőként a Dermavital sampont ajánlom. Ha megírod, hogy inkább száraz, zsíros, hámló vagy irritált a fejbőröd, segítek pontosítani az ajánlást.',

      confidence:
        100,

      links:
        [],

      suggestions:
        [
          'Dermavital sampon'
        ],

      ruleId:
        'problem-scalp',

      intent:
        'problem-recommendation',

      matchedKnowledgeIds:
        []
    };
  }

  return null;
}

/* =========================================================
   BESZÉLGETÉSI FOLYTATÁS
========================================================= */

function resolveProblemFromContext({
  question,
  history
}) {
  const directProblem =
    detectProblem(
      question
    );

  if (
    directProblem
  ) {
    return directProblem;
  }

  const context =
    buildConversationContext(
      history,
      normalize
    );

  if (
    isFollowUpMessage(
      question
    ) &&
    context.lastProblem
  ) {
    return context.lastProblem;
  }

  return null;
}

/* =========================================================
   KATALÓGUSKÉRDÉS
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
    'kapni'
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
      (
        token
      ) =>
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
        (
          item
        ) => {

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
                item.keywords?.join(
                  ' '
                ),
                item.products?.join(
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
        (
          match
        ) =>
          match.score >
          0
      )
      .sort(
        (
          a,
          b
        ) =>
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
   TERMÉKLISTA
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
        (
          match
        ) =>
          match.item
      )
      .slice(
        0,
        6
      );

  const lines =
    items.map(
      (
        item
      ) => {

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
            110
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
      items.map(
        (
          item
        ) =>
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
    1. E-MAIL-CÍM
  */

  if (
    looksLikeEmail(
      question
    )
  ) {
    return {
      source:
        'conversation-context',

      answer:
        'Köszönöm, megkaptam az e-mail-címet. Ha egy korábbi kérdésedhez vagy kuponkódhoz kapcsolódik, kérlek írd meg röviden azt is, miben segíthetek tovább.',

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

  /*
    2. SLS / SLES
  */

  const slsAnswer =
    answerSlsSlesQuestion(
      question
    );

  if (
    slsAnswer
  ) {
    return slsAnswer;
  }

  /*
    3. PROBLÉMAKÖR ELSŐBBSÉGI FELISMERÉS
  */

  const problem =
    resolveProblemFromContext({
      question,
      history
    });

  if (
    problem
  ) {
    const problemAnswer =
      buildProblemAnswer(
        problem
      );

    if (
      problemAnswer
    ) {
      return attachProductLinks(
        problemAnswer,
        knowledge
      );
    }
  }

  /*
    4. KATALÓGUSKERESÉS
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
    5. SZAKÉRTŐI SZABÁLYOK
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
    6. TUDÁSBÁZIS
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
        null,

      matchedKnowledgeIds:
        []
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
