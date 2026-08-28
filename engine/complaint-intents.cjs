'use strict';

const { normalize } = require('./normalizer.cjs');

const SYMPTOM = /\b(irrital\w*|csip\w*|eget\w*|kipiros\w*|pirosod\w*|viszket\w*|kiutes\w*|bedagad\w*|dagad\w*|allergi\w*|foltos\w*)\b/;
const PRODUCT = /\b(szappan\w*|krem\w*|balzsam\w*|sampon\w*|termek\w*|dezodor\w*|tusfurdo\w*)\b/;
const QUALITY = /\b(serult\w*|hibas\w*|rossz termek\w*|kifolyt\w*|torott\w*|hianyos\w*)\b/;
const CRITICAL = /\b(nem kapok levegot|alig kapok levegot|fullad\w*|bedagadt a nyelv\w*|dagad a nyelv\w*|bedagadt a szam|dagad a szam)\b/;
const HIGH = /\b(bedagad\w*|dagad\w*|lenyelt\w*|lenyeltem|megette|szemebe ment)\b/;
const NEGATED = /\b(nem|se|sem)\s+(?:\w+\s+){0,2}?(irrital\w*|csip\w*|eget\w*|pirosod\w*|viszket\w*|allergi\w*|dagad\w*|verzik\w*)\b/;
const HYPOTHETICAL = /\b(lehet\w*|irritalhat\w*|csiphet\w*|egethet\w*|kipirosodhat\w*|bedagadhat\w*|okozhat\w*|hasznalhat\w*)\b|\bmi van ha\b/;
const REPORTED = /\b(azt olvastam|azt irjak|a reklam\w*|hallottam)\b/;

function detectSubject(text) {
  if (/\b(gyerek\w*|gyermek\w*|fiam\w*|lanyom\w*|babam\w*)\b/.test(text)) return 'child';
  if (/\b(baratnom\w*|baratom\w*|anyukam\w*|apukam\w*|ferjem\w*|felesegem\w*)\b/.test(text)) return 'third_party';
  if (/\b(en|nekem|borom\w*|szam\w*|nyelvem\w*|lettem|vagyok)\b/.test(text)) return 'user';
  return 'generic';
}

function detectTemporality(text) {
  if (HYPOTHETICAL.test(text)) return 'hypothetical';
  if (/\b(tegnap|multkor|korabban|regen|volt|csipett|irritalt)\b/.test(text)) return 'past';
  if (/\b(most|jelenleg|utana|hasznalat utan|felkenes utan|erkezett|kaptam|kifolyt)\b/.test(text) || SYMPTOM.test(text)) return 'current';
  return 'unknown';
}

function detectComplaintIntent(question, context = {}) {
  const text = normalize(question);
  if (!text) return null;
  const quality = QUALITY.test(text);
  const critical = CRITICAL.test(text);
  const symptom = SYMPTOM.test(text) || critical || HIGH.test(text);
  const negated = NEGATED.test(text);
  const hypothetical = HYPOTHETICAL.test(text) || REPORTED.test(text);
  const productPresent = PRODUCT.test(text) || Boolean(context.focusedProductId);
  if (!quality && !symptom) return null;

  const polarity = negated ? 'negative' : hypothetical ? 'uncertain' : 'positive';
  const causality = quality ? 'asserted'
    : /\b(tol|attol|miatta|utana|hasznalat utan|felkenes utan|okoz\w*)\b/.test(text) ? 'asserted'
      : productPresent ? 'suspected' : 'generic';
  const severity = critical ? 'critical' : HIGH.test(text) ? 'high'
    : /\b(kiutes\w*|allergi\w*|eget\w*|csip\w*)\b/.test(text) ? 'moderate' : symptom || quality ? 'low' : 'unknown';
  const intent = quality ? 'product_quality_complaint'
    : /\b(abbahagy\w*|hasznaljam tovabb|ne hasznaljam)\b/.test(text) ? 'stop_use_question'
      : /\b(allergi\w*)\b/.test(text) ? 'allergic_reaction_concern'
        : /\b(eget\w*|csip\w*)\b/.test(text) ? 'burning_after_use'
          : /\b(kipiros\w*|pirosod\w*|foltos\w*)\b/.test(text) ? 'redness_after_use'
            : 'product_irritation';

  return {
    intent,
    subject: detectSubject(text),
    temporality: detectTemporality(text),
    polarity,
    causality,
    severity,
    productPresent,
    evidence: [quality ? 'complaint:quality' : 'complaint:symptom', `complaint:${polarity}`, `complaint:${causality}`]
  };
}

module.exports = { detectComplaintIntent };
