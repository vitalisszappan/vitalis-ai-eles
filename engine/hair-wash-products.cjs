'use strict';

const { normalize } = require('./normalizer.cjs');
const { productCards } = require('./product-catalog.cjs');

const IDS = Object.freeze({
  liquid: ['dermavital_sampon'],
  solidNormal: ['solid_shampoo_normal_green_tea'],
  solidOily: ['solid_shampoo_oily_rosemary_caffeine'],
  soapRosemary: ['rozmaringos_samponszappan'],
  soapTeaTree: ['teafa_aktiv_szen_samponszappan']
});

function isTypeComparison(question) {
  const q = normalize(question);
  return /szilard sampon/.test(q) && /(samponszappan|sampon szappan)/.test(q) && /(ugyanaz|kulonbseg|miben mas)/.test(q);
}

function comparisonAnswer() {
  return {
    source: 'approved-knowledge',
    ruleId: 'solid-shampoo-vs-shampoo-soap',
    intent: 'product_type_comparison',
    answer: 'Nem, a szilárd sampon és a samponszappan nem ugyanaz. A szilárd sampon sampon jellegű hajtisztító szilárd formában. A samponszappan szappanalapú hajtisztító. Külön terméktípusok, ezért nem cseréljük fel őket automatikusan.',
    confidence: 100,
    links: [],
    suggestions: [],
    matchedKnowledgeIds: ['kb_solid_shampoo_vs_shampoo_soap']
  };
}

function requestedQualifiers(question, type) {
  let q = normalize(question).replace(/\b(van|vannak|kaphato|elerheto|nalatok|termek|termeket)\w*\b/g, ' ');
  q = type === 'solid_shampoo'
    ? q.replace(/\b(szilard|sampon)\w*\b/g, ' ')
    : q.replace(/\b(samponszappan|sampon|szappan)\w*\b/g, ' ');
  return q.split(/\s+/).filter((word) => word.length > 2);
}

function exactExistence(question, type, allIds) {
  if (!/^\s*(van|vannak|kaphato|elerheto)\b/.test(normalize(question))) return null;
  const qualifiers = requestedQualifiers(question, type);
  if (!qualifiers.length) return null;
  const matches = productCards(allIds).filter((card) => {
    const name = normalize(card.name || card.title);
    return qualifiers.every((word) => name.includes(word));
  });
  return matches.length
    ? { answer: `Igen, ${matches.map((item) => item.name).join(', ')} elérhető a jelenlegi kínálatban.`, links: matches }
    : { answer: 'Nem, ilyen megnevezésű termék nincs a jelenlegi Vitalis kínálatban.', links: [] };
}

function recommendation(question, type) {
  const q = normalize(question);
  let ids = [];
  let allIds = [];
  let answer = '';

  if (type === 'liquid_shampoo') {
    allIds = [...IDS.liquid];
    const oily = /zsiro|gyorsan zsiros/.test(q);
    ids = oily ? [] : allIds;
    answer = oily
      ? 'Zsírosodásra hajlamos hajra a jelenlegi folyékony samponkínálatból nem tudok bizonyítottan megfelelő terméket ajánlani. Szilárd sampon is megfelelhet?'
      : 'A folyékony samponok közül a Dermavital sampon érhető el problémás, korpás vagy viszkető fejbőr kímélő tisztítására.';
  } else if (type === 'solid_shampoo') {
    allIds = [...IDS.solidNormal, ...IDS.solidOily];
    const oily = /zsiro|gyorsan zsiros|koffein/.test(q);
    const sensitive = /viszket|erzekeny|normal|szaraz/.test(q);
    ids = oily ? IDS.solidOily : sensitive ? IDS.solidNormal : allIds;
    answer = oily
      ? 'Zsírosodásra hajlamos hajra elsőként a rozmaringos-koffeines szilárd sampont javaslom. Kozmetikai hajtisztító; nem teszünk vele orvosi vagy garantált hajnövekedési ígéretet.'
      : sensitive
        ? 'Normál hajra vagy érzékeny, viszketésre hajlamos fejbőr kíméletes tisztításához elsőként a zöldteás szilárd sampont javaslom.'
        : 'Két szilárd sampon érhető el: a zöldteás normál hajra, illetve a rozmaringos-koffeines zsírosodásra hajlamos hajra.';
  } else if (type === 'shampoo_soap') {
    allIds = [...IDS.soapRosemary, ...IDS.soapTeaTree];
    const oily = /zsiro|aktiv szen|teafa/.test(q);
    ids = oily ? [...IDS.soapTeaTree, ...IDS.soapRosemary] : allIds;
    answer = oily
      ? 'Zsírosodásra hajlamos hajra a teafa–aktív szén samponszappant mutatom elsőként. Ez szappanalapú hajtisztító, nem szilárd sampon.'
      : 'A samponszappanok közül elsőként a rozmaringos változatot, alternatívaként a teafa–aktív szén változatot mutatom. Ezek szappanalapú hajtisztítók, nem szilárd samponok.';
  }

  const existence = exactExistence(question, type, allIds);
  return {
    source: 'approved-product-type-rule',
    ruleId: `hair-wash-${type}`,
    intent: existence ? 'product_type_existence' : 'product_recommendation',
    answer: existence?.answer || answer,
    confidence: 100,
    links: existence?.links || productCards(ids),
    suggestions: [],
    matchedKnowledgeIds: []
  };
}

function availability(question, type) {
  const config = {
    liquid_shampoo: { ids: IDS.liquid, label: 'folyékony samponunk' },
    solid_shampoo: { ids: [...IDS.solidNormal, ...IDS.solidOily], label: 'szilárd samponunk' },
    shampoo_soap: { ids: [...IDS.soapRosemary, ...IDS.soapTeaTree], label: 'samponszappanunk' }
  }[type];
  const links = productCards(config?.ids || []);
  if (!config || !links.length) return { source: 'approved-product-type-rule', ruleId: `hair-wash-${type}-availability`, intent: 'product_type_availability', answer: 'Nem találtam ilyen terméktípust a jelenlegi kínálatban.', confidence: 100, links: [], suggestions: [], matchedKnowledgeIds: [] };
  const exact = exactExistence(question, type, config.ids);
  if (exact) return { source: 'approved-product-type-rule', ruleId: `hair-wash-${type}-availability`, intent: 'product_type_availability', answer: exact.answer, confidence: 100, links: exact.links, suggestions: [], matchedKnowledgeIds: [] };
  const conciseAnswer = {
    liquid_shampoo: 'Igen. Egyféle folyékony samponunk van: a Dermavital sampon.',
    solid_shampoo: 'Igen. Kétféle szilárd samponunk van: egy zöldteás normál hajra, valamint egy rozmaringos-koffeines zsírosodásra hajlamos hajra.',
    shampoo_soap: 'Igen. Kétféle samponszappanunk van: egy rozmaringos, valamint egy teafa–aktív szenes változat.'
  }[type];
  return {
    source: 'approved-product-type-rule',
    ruleId: `hair-wash-${type}-availability`,
    intent: 'product_type_availability',
    answer: conciseAnswer,
    confidence: 100,
    links,
    suggestions: [],
    matchedKnowledgeIds: []
  };
}

module.exports = { IDS, isTypeComparison, comparisonAnswer, recommendation, availability };
