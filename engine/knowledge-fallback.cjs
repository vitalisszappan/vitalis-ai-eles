const { normalize } = require('./normalizer.cjs');

/* =========================================================
   STOP SZAVAK
========================================================= */

const STOP = new Set([
  'egy',
  'hogy',
  'van',
  'vagy',
  'is',
  'lehet',
  'nekem',
  'kerem',
  'szeretnek',
  'mit',
  'milyen',
  'hogyan',
  'szia',
  'udv',
  'ezt',
  'azt',
  'most',
  'mar',
  'kell',
  'kapcsolatban',
  'lenne',
  'tudna',
  'tudok',
  'szeretnem',
  'kerdes',
  'erdekel'
]);

/* =========================================================
   ALAP SEGÉDFÜGGVÉNYEK
========================================================= */

function tokenize(value) {
  return normalize(value)
    .split(' ')
    .filter(
      (token) =>
        token.length >= 3 &&
        !STOP.has(token)
    );
}

function unique(values) {
  return [...new Set(values)];
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeText(value) {
  return normalize(value || '');
}

/* =========================================================
   MINŐSÉGI SZŰRÉS
========================================================= */

function lowQuality(item) {
  const question = safeText(
    item.canonicalQuestion ||
    item.title ||
    ''
  );

  const answer = safeText(
    item.fullAnswer ||
    item.shortAnswer ||
    ''
  );

  if (
    !question ||
    !answer ||
    question.length < 10 ||
    answer.length < 12
  ) {
    return true;
  }

  if (
    /emailben keresem|majd jelzek|milyen neven|hivni fogja|keressen email|rakd kosarba|kaptam ertesitest/.test(
      answer
    )
  ) {
    return true;
  }

  if (
    [
      'igen',
      'oke',
      'van',
      'rendben'
    ].includes(answer)
  ) {
    return true;
  }

  return false;
}

/* =========================================================
   EGYEZÉS SEGÉDFÜGGVÉNYEK
========================================================= */

function exactTokenMatches(
  queryTokens,
  fieldTokens
) {
  let count = 0;

  for (const token of queryTokens) {
    if (fieldTokens.includes(token)) {
      count += 1;
    }
  }

  return count;
}

function partialTokenMatch(
  queryToken,
  fieldToken
) {
  if (
    !queryToken ||
    !fieldToken
  ) {
    return false;
  }

  if (
    queryToken.length < 5 ||
    fieldToken.length < 5
  ) {
    return false;
  }

  return (
    queryToken.includes(fieldToken) ||
    fieldToken.includes(queryToken)
  );
}

function partialTokenMatches(
  queryTokens,
  fieldTokens
) {
  let count = 0;

  for (const queryToken of queryTokens) {
    const found = fieldTokens.some(
      (fieldToken) =>
        partialTokenMatch(
          queryToken,
          fieldToken
        )
    );

    if (found) {
      count += 1;
    }
  }

  return count;
}

function phraseMatch(
  query,
  value
) {
  const normalizedQuery =
    safeText(query);

  const normalizedValue =
    safeText(value);

  if (
    !normalizedQuery ||
    !normalizedValue
  ) {
    return false;
  }

  return (
    normalizedValue.includes(
      normalizedQuery
    ) ||
    normalizedQuery.includes(
      normalizedValue
    )
  );
}

/* =========================================================
   TUDÁSELEM PONTOZÁSA
========================================================= */

function scoreItem(
  item,
  question
) {
  const query =
    safeText(question);

  const queryTokens =
    unique(tokenize(question));

  if (
    !query ||
    !queryTokens.length
  ) {
    return 0;
  }

  const title =
    safeText(item.title);

  const canonical =
    safeText(
      item.canonicalQuestion
    );

  const variants =
    safeArray(
      item.questionVariants
    ).map(safeText);

  const keywords =
    safeArray(
      item.keywords
    ).map(safeText);

  const products =
    safeArray(
      item.products
    ).map(safeText);

  const intents =
    safeArray(
      item.intents
    ).map(safeText);

  const category =
    safeText(item.category);

  const subcategory =
    safeText(item.subcategory);

  const shortAnswer =
    safeText(item.shortAnswer);

  const fullAnswer =
    safeText(item.fullAnswer);

  let score = 0;

  /* -----------------------------------------
     TELJES KÉRDÉS EGYEZÉS
  ----------------------------------------- */

  if (
    canonical &&
    canonical === query
  ) {
    score += 220;
  } else if (
    canonical &&
    phraseMatch(
      question,
      item.canonicalQuestion
    )
  ) {
    score += 120;
  }

  for (
    const variant of variants
  ) {
    if (
      variant === query
    ) {
      score += 200;
      break;
    }

    if (
      phraseMatch(
        question,
        variant
      )
    ) {
      score += 100;
      break;
    }
  }

  /* -----------------------------------------
     CANONICAL QUESTION
  ----------------------------------------- */

  const canonicalTokens =
    tokenize(canonical);

  const canonicalExact =
    exactTokenMatches(
      queryTokens,
      canonicalTokens
    );

  const canonicalPartial =
    partialTokenMatches(
      queryTokens,
      canonicalTokens
    );

  score += canonicalExact * 24;
  score += canonicalPartial * 8;

  /* -----------------------------------------
     KÉRDÉSVARIÁNSOK
  ----------------------------------------- */

  for (
    const variant of variants
  ) {
    const variantTokens =
      tokenize(variant);

    const exact =
      exactTokenMatches(
        queryTokens,
        variantTokens
      );

    const partial =
      partialTokenMatches(
        queryTokens,
        variantTokens
      );

    score += exact * 20;
    score += partial * 7;
  }

  /* -----------------------------------------
     KULCSSZAVAK
  ----------------------------------------- */

  const keywordTokens =
    unique(
      keywords.flatMap(
        tokenize
      )
    );

  const keywordExact =
    exactTokenMatches(
      queryTokens,
      keywordTokens
    );

  const keywordPartial =
    partialTokenMatches(
      queryTokens,
      keywordTokens
    );

  score += keywordExact * 18;
  score += keywordPartial * 6;

  /* -----------------------------------------
     TERMÉKEK
  ----------------------------------------- */

  const productTokens =
    unique(
      products.flatMap(
        tokenize
      )
    );

  const productExact =
    exactTokenMatches(
      queryTokens,
      productTokens
    );

  const productPartial =
    partialTokenMatches(
      queryTokens,
      productTokens
    );

  score += productExact * 28;
  score += productPartial * 10;

  /* -----------------------------------------
     INTENTEK
  ----------------------------------------- */

  const intentTokens =
    unique(
      intents.flatMap(
        tokenize
      )
    );

  const intentExact =
    exactTokenMatches(
      queryTokens,
      intentTokens
    );

  score += intentExact * 22;

  /* -----------------------------------------
     KATEGÓRIA / ALKATEGÓRIA
  ----------------------------------------- */

  const categoryTokens =
    tokenize(
      `${category} ${subcategory}`
    );

  const categoryExact =
    exactTokenMatches(
      queryTokens,
      categoryTokens
    );

  score += categoryExact * 14;

  /* -----------------------------------------
     TITLE
  ----------------------------------------- */

  const titleTokens =
    tokenize(title);

  const titleExact =
    exactTokenMatches(
      queryTokens,
      titleTokens
    );

  const titlePartial =
    partialTokenMatches(
      queryTokens,
      titleTokens
    );

  score += titleExact * 16;
  score += titlePartial * 5;

  /* -----------------------------------------
     VÁLASZSZÖVEG
     Csak kisebb súllyal, hogy ne vigye el
     a találatot egy véletlen szó.
  ----------------------------------------- */

  const answerTokens =
    tokenize(
      `${shortAnswer} ${fullAnswer}`
    );

  const answerExact =
    exactTokenMatches(
      queryTokens,
      answerTokens
    );

  score += answerExact * 3;

  /* -----------------------------------------
     TÖBB KULCSSZÓ EGYÜTTES TALÁLATA
  ----------------------------------------- */

  const importantMatches =
    canonicalExact +
    keywordExact +
    productExact +
    intentExact;

  if (
    importantMatches >= 2
  ) {
    score += 20;
  }

  if (
    importantMatches >= 3
  ) {
    score += 25;
  }

  if (
    importantMatches >= 4
  ) {
    score += 35;
  }

  /* -----------------------------------------
     LEFEDETTSÉGI BÓNUSZ
  ----------------------------------------- */

  const allPrimaryTokens =
    unique([
      ...canonicalTokens,
      ...keywordTokens,
      ...productTokens,
      ...intentTokens
    ]);

  const covered =
    exactTokenMatches(
      queryTokens,
      allPrimaryTokens
    );

  const coverage =
    queryTokens.length
      ? covered /
        queryTokens.length
      : 0;

  if (
    coverage >= 0.8
  ) {
    score += 50;
  } else if (
    coverage >= 0.6
  ) {
    score += 30;
  } else if (
    coverage >= 0.4
  ) {
    score += 15;
  }

  /* -----------------------------------------
     GYENGE, EGYETLEN ÁLTALÁNOS TALÁLAT
     BÜNTETÉSE
  ----------------------------------------- */

  if (
    importantMatches <= 1 &&
    coverage < 0.4 &&
    score < 80
  ) {
    score -= 20;
  }

  return Math.max(
    0,
    Math.round(score)
  );
}

/* =========================================================
   KERESÉS
========================================================= */

function searchKnowledge(
  knowledge,
  question
) {
  return knowledge
    .filter(
      (item) =>
        item &&
        typeof item ===
          'object' &&
        !lowQuality(item)
    )
    .map(
      (item) => ({
        item,
        score:
          scoreItem(
            item,
            question
          )
      })
    )
    .filter(
      (result) =>
        result.score > 0
    )
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(0, 5);
}

module.exports = {
  searchKnowledge
};
