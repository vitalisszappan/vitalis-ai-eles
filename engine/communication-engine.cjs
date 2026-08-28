'use strict';

const { normalize } = require('./normalizer.cjs');
const { ANSWER_MODES } = require('./answer-mode.cjs');

const SAFETY_PATTERN = /\b(orvos|orvosi|bőrgyógy|gyermekorvos|sürgős|nem gyógyszer|nem helyettesít|nyílt|vérző|gyulladt|erős fájdalom|mellkasi|nehézlégzés)\w*/i;
const BANNED_REPLACEMENTS = [
  [/kozmetikai ápolására (?:elsősorban )?javaslom/gi, 'mindennapi ápolására ezt választanám'],
  [/kozmetikai ápolásra/gi, 'mindennapi bőrápolásra'],
  [/a rendszer ezt ajánlja/gi, 'erre ezt szoktuk ajánlani'],
  [/az ön kérdése/gi, 'amit leírtál'],
  [/elegendő információ hiányában/gi, 'ha még nem egyértelmű minden részlet'],
  [/a jelenlegi kínálatban nem találok/gi, 'a jelenlegi kínálatban most nincs'],
  [/ehhez nem találtam elég pontos, jóváhagyott vitalis-információt/gi, 'erről még nincs elég biztos Vitalis-információnk'],
  [/\b(?:elsősorban|elsőként)\s+/gi, ''],
  [/\bjó kiindulás(?:t jelenthet| lehet)?\b/gi, 'jó választás'],
  [/\bA Vitalis (?:megoldások|termékek) közül\s*/gi, ''],
  [/\bSegítek megtalálni a számodra legmegfelelőbb[^.!?]*[.!?]?\s*/gi, '']
];

const OPTIONAL_CTA = /^(?:ha megírod|ha szeretnéd|írj|írd meg|nézd meg|az aktuális változatokat|ha más állagot|mit vegyek mellé)/i;

function clean(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function humanize(value = '') {
  let text = clean(value);
  for (const [pattern, replacement] of BANNED_REPLACEMENTS) text = text.replace(pattern, replacement);
  return text;
}

const EMAIL_DOT = '\uE000';

function sentenceParts(text) {
  const protectedText = humanize(text).replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (email) => email.replace(/\./g, EMAIL_DOT));
  return (protectedText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [])
    .map((part) => clean(part.replaceAll(EMAIL_DOT, '.'))).filter(Boolean);
}

function splitSafety(text) {
  const sentences = sentenceParts(text);
  const safety = [];
  const body = [];
  for (const sentence of sentences.map(clean).filter(Boolean)) {
    (SAFETY_PATTERN.test(sentence) ? safety : body).push(sentence);
  }
  return { body: body.join(' '), safety: safety.join(' ') };
}

function sentences(text) {
  return sentenceParts(text);
}

function sentenceMaximum(decision) {
  if (decision.route === 'safety') return 4;
  if (decision.route === 'clarification' || decision.route === 'hard_fallback') return 1;
  if (decision.route === 'meta') return 3;
  if (decision.answerMode === ANSWER_MODES.SOCIAL_META) return 3;
  if (decision.intent === 'price_query') return 1;
  if (decision.goal === 'ask_usage' || decision.goal === 'ask_child_usage' || decision.intent === 'product_usage') return 4;
  if (decision.answerMode === ANSWER_MODES.DIRECT) return 2;
  if (decision.answerMode === ANSWER_MODES.RECOMMENDATION) return 2;
  if (decision.answerMode === ANSWER_MODES.EXPLANATORY) return 3;
  return 1;
}

function applyMinimalAnswerPolicy(text, decision) {
  const all = sentences(text);
  if (!all.length) return '';
  const withoutOptionalCta = all.filter((sentence, index) => index === 0 || !OPTIONAL_CTA.test(sentence));
  const maximum = sentenceMaximum(decision);
  if (withoutOptionalCta.length <= maximum) return withoutOptionalCta.join(' ');
  const safety = withoutOptionalCta.filter((sentence) => SAFETY_PATTERN.test(sentence));
  const body = withoutOptionalCta.filter((sentence) => !SAFETY_PATTERN.test(sentence));
  if (decision.answerMode === ANSWER_MODES.RECOMMENDATION && safety.length) {
    return [...body.slice(0, maximum), safety[0]].join(' ');
  }
  const keptSafety = safety.slice(0, Math.min(safety.length, maximum));
  return [...body.slice(0, Math.max(0, maximum - keptSafety.length)), ...keptSafety].join(' ');
}

function reasonFor(link, decision) {
  const name = normalize(link?.name || link?.title || '');
  const domain = decision.domain;
  if (domain === 'cracked_heel' || domain === 'dry_heel') return 'Gazdagabb, bőrpuhító ápolást ad a száraz, érdes és repedezésre hajlamos saroknak.';
  if (domain === 'eczema') return 'Kímélő ápolást ad a száraz, érzékeny és irritációra hajlamos bőrnek.';
  if (domain === 'psoriasis') return 'A száraz, hámlásra hajlamos bőr napi, gyengéd ápolásához állítottuk össze.';
  if (domain === 'itchy_scalp') return 'Gyengéden tisztít, miközben nem terheli feleslegesen az érzékeny, viszkető fejbőrt.';
  if (domain === 'deodorant') return 'Alumíniummentes választás, amely a kellemetlen testszag kialakulása ellen segíthet.';
  if (domain === 'shower_gel') return 'Növényi alapú, mindennapi tisztálkodáshoz készült választás.';
  if (name.includes('sampon')) return 'A fejbőr és a haj kímélő, rendszeres tisztításához illik.';
  if (name.includes('szappan')) return 'Egyszerű, gyengéd tisztítási lépésként jól beilleszthető a napi rutinba.';
  if (name.includes('krem') || name.includes('balzsam') || name.includes('vaj')) return 'Táplálóbb ápolást ad, amikor a bőrnek több puhaságra és komfortérzetre van szüksége.';
  return humanize(link?.description) || 'Jól illeszkedik ahhoz a mindennapi ápolási célhoz, amit leírtál.';
}

function enrichLinks(links, decision, options = {}) {
  return (Array.isArray(links) ? links : []).slice(0, 3).map((link, index) => ({
    ...link,
    recommendationType: decision.answerMode === ANSWER_MODES.DIRECT ? 'available' : decision.answerMode === ANSWER_MODES.RECOMMENDATION ? (index === 0 ? 'primary' : index === 1 ? 'secondary' : 'related') : 'context',
    recommendationLabel: decision.answerMode === ANSWER_MODES.DIRECT ? 'Elérhető termék' : decision.answerMode === ANSWER_MODES.RECOMMENDATION ? (index === 0 ? 'Vitalis ajánlása' : index === 1 ? 'Alternatíva' : 'Kapcsolódó termék') : 'Az érintett termék',
    reason: decision.answerMode === ANSWER_MODES.RECOMMENDATION
      ? (options.preserveGroundedReason ? (link.reason || '') : reasonFor(link, decision))
      : ''
  }));
}

function wordCount(value) {
  return clean(value).split(/\s+/).filter(Boolean).length;
}

function truncateWords(text, maximum) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  if (words.length <= maximum) return clean(text);
  return `${words.slice(0, maximum).join(' ').replace(/[,;:]$/, '')}.`;
}

function limitWords(text, maximum) {
  if (wordCount(text) <= maximum) return clean(text);
  const separated = splitSafety(text);
  if (!separated.safety) return truncateWords(text, maximum);
  const safetyWords = wordCount(separated.safety);
  return clean(`${truncateWords(separated.body, Math.max(1, maximum - safetyWords))} ${separated.safety}`);
}

function responseRange(decision) {
  if (decision.route === 'safety') return { minimum: 0, maximum: 130 };
  if (decision.route === 'clarification' || decision.route === 'hard_fallback') return { minimum: 0, maximum: 60 };
  if (decision.answerMode === ANSWER_MODES.SOCIAL_META) return { minimum: 0, maximum: 35 };
  if (decision.answerMode === ANSWER_MODES.DIRECT) return { minimum: 0, maximum: 55 };
  if (decision.answerMode === ANSWER_MODES.RECOMMENDATION) return { minimum: 0, maximum: 90 };
  return { minimum: 0, maximum: 120 };
}

function composeCommunication({ decision, draft, question = '', history = [] }) {
  if (!draft || !decision) return draft;
  const preserveGroundedReason = ['product_recommendation', 'product_benefits'].includes(draft.answerIntent);
  const links = enrichLinks(draft.links, decision, { preserveGroundedReason });
  const range = responseRange(decision);
  const answer = limitWords(applyMinimalAnswerPolicy(draft.answer, decision), range.maximum);
  const primaryName = links[0]?.name || '';
  const previous = normalize((history || []).filter((item) => item?.role === 'assistant').map((item) => item.content || '').join(' '));
  const repeatedRecommendation = Boolean(primaryName && previous.includes(normalize(primaryName)));

  return {
    ...draft,
    answer,
    links,
    answerMode: decision.answerMode,
    communication: {
      engine: 'vitalis-communication/v2',
      answerMode: decision.answerMode,
      wordCount: wordCount(answer),
      minimumWords: range.minimum,
      maximumWords: range.maximum,
      repeatedRecommendation,
      questionUsed: Boolean(clean(question))
    }
  };
}

module.exports = { composeCommunication, enrichLinks, humanize, responseRange, wordCount, applyMinimalAnswerPolicy, sentenceMaximum };
