'use strict';

const { normalize } = require('./normalizer.cjs');
const { detectComplaintIntent } = require('./complaint-intents.cjs');

const CONTACT = /\b(kapcsolat\w*|eler\w*|erlek\w*|email\w*|e-mail\w*|ugyfelszolgalat\w*)\b/;
const GENERAL_CATALOG = /\b(milyen (?:mas )?termek(?:eket|eitek)|milyen termekkategoria\w*|mik a termekkategoria\w*|mit lehet nalatok kapni|mit arultok|teljes kinalat|altalanos kinalat)\b/;
const SHIPPING_TIME = /^mikor erkezik meg[.!?]*$|\bhany nap alatt er ide\b|\bmikor erkez\w*\b.*\b(rendeles\w*|csomag\w*)\b|\b(mennyi ido|hany nap|mikor erkez\w*|szallitasi ido|kiszallitasi ido|mennyi(?:re)? gyorsan)\b.*\b(szallit\w*|kiszallit\w*|erkez\w*)\b|\b(szallit\w*|kiszallit\w*)\b.*\b(mennyi ido|hany nap|mikor|ido)\b/;
const SHIPPING_COST = /\bhol latom\b.*\b(szallit\w*|kiszallit\w*)\b.*\b(dij|koltseg)\w*|\b(mennyi|mennyibe kerul|mennyit fizet\w*|mi az ara|mekkora a dij|szallitasi dij|szallitasi koltseg|kiszallitasi dij|kiszallitasi koltseg)\b.*\b(szallit\w*|kiszallit\w*|posta\w*)\b|\b(szallit\w*|kiszallit\w*|posta\w*)\b.*\b(mennyi|mennyibe|koltseg|dij|ar)\w*/;
const FREE_SHIPPING = /\b(ingyenes|dijmentes)\b.*\b(szallit\w*|kiszallit\w*|posta\w*)\b|\b(szallit\w*|kiszallit\w*)\b.*\b(ingyenes|dijmentes)\b/;
const CARRIER = /\b(gls|mpl|dpd|futarszolgalat\w*|melyik futar\w*)\b/;

function detectBusinessInfo(question) {
  const text = normalize(question);
  if (!text) return null;
  const complaint = detectComplaintIntent(question);
  if (complaint?.polarity === 'positive') return null;
  if (FREE_SHIPPING.test(text)) return { intent: 'shipping_free_unknown' };
  if (CARRIER.test(text)) return { intent: 'shipping_carrier_unknown' };
  if (SHIPPING_TIME.test(text)) return { intent: 'shipping_time' };
  if (SHIPPING_COST.test(text)) return { intent: 'shipping_cost' };
  if (GENERAL_CATALOG.test(text)) return { intent: 'general_catalog' };
  if (CONTACT.test(text) && /\b(hogy|hogyan|hol|mi|melyik|tudok|szeretnek|keresem|adj\w*)\b/.test(text)) return { intent: 'contact' };
  if (/^(kapcsolat|elerhetoseg|email|e-mail|ugyfelszolgalat)[.!?]*$/.test(text)) return { intent: 'contact' };
  return null;
}

function resolveBusinessInfo(intent, catalog) {
  const categories = intent === 'general_catalog' ? catalog.categorySummary() : [];
  const answers = {
    contact: 'E-mailben az ugyfelszolgalat@vitalis-szappan.hu címen tudsz kapcsolatba lépni velünk.',
    general_catalog: categories.length
      ? `A jelenlegi kínálat fő kategóriái: ${categories.join(', ')}.`
      : 'A jelenlegi termékkategóriákat most nem tudom biztosan felsorolni.',
    shipping_cost: 'A szállítás díja a választott szállítási és fizetési módtól függ; az aktuális összeget a pénztár mutatja.',
    shipping_time: 'A kiszállítás általában körülbelül 2 munkanap, a pontos idő a választott szállítási módtól függ.',
    shipping_carrier_unknown: 'A jelenlegi jóváhagyott adatainkból nem tudom biztosan megmondani, melyik futárszolgálat érhető el. Az aktuális szállítási módokat a pénztárban látod.',
    shipping_free_unknown: 'A jelenlegi jóváhagyott adatainkból nem tudom biztosan megmondani, van-e ingyenes kiszállítás. Az aktuális feltételeket a pénztárban tudod ellenőrizni.'
  };
  return {
    source: 'business-info', answer: answers[intent] || '', confidence: 100,
    links: [], suggestions: [], ruleId: null, intent, matchedKnowledgeIds: []
  };
}

module.exports = { detectBusinessInfo, resolveBusinessInfo };
