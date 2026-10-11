'use strict';

const { normalize } = require('./normalizer.cjs');
const { detectComplaintIntent } = require('./complaint-intents.cjs');

const CONTACT = /\b(kapcsolat\w*|eler\w*|erlek\w*|email\w*|e-mail\w*|ugyfelszolgalat\w*)\b/;
const GENERAL_CATALOG = /\b(milyen (?:mas )?termek(?:eket|eitek)|milyen termekkategoria\w*|mik a termekkategoria\w*|mit lehet nalatok kapni|mit arultok|teljes kinalat|altalanos kinalat)\b/;
const SHIPPING_TIME = /^mikor erkezik meg[.!?]*$|\bhany nap alatt er ide\b|\bmikor erkez\w*\b.*\b(rendeles\w*|csomag\w*)\b|\b(mennyi ido|hany nap|mikor erkez\w*|szallitasi ido|kiszallitasi ido|mennyi(?:re)? gyorsan)\b.*\b(szallit\w*|kiszallit\w*|erkez\w*)\b|\b(szallit\w*|kiszallit\w*)\b.*\b(mennyi ido|hany nap|mikor|ido)\b/;
const SHIPPING_COST = /\bhol latom\b.*\b(szallit\w*|kiszallit\w*)\b.*\b(dij|koltseg)\w*|\b(mennyi|mennyibe kerul|mennyit fizet\w*|mi az ara|mekkora a dij|szallitasi dij|szallitasi koltseg|kiszallitasi dij|kiszallitasi koltseg)\b.*\b(szallit\w*|kiszallit\w*|posta\w*)\b|\b(szallit\w*|kiszallit\w*|posta\w*)\b.*\b(mennyi|mennyibe|koltseg|dij|ar)\w*/;
const FREE_SHIPPING = /\b(ingyenes|dijmentes)\b.*\b(szallit\w*|kiszallit\w*|posta\w*)\b|\b(szallit\w*|kiszallit\w*)\b.*\b(ingyenes|dijmentes)\b/;
const CARRIER = /\b(gls|mpl|dpd|futarszolgalat\w*|melyik futar\w*)\b/;

const OWNER_APPROVED_BUSINESS_FACTS = Object.freeze({
  shippingMethods: Object.freeze([
    Object.freeze({ id: 'gls_home', name: 'GLS házhozszállítás', price: 1850, currency: 'HUF' }),
    Object.freeze({ id: 'gls_parcel_point', name: 'GLS CsomagPont', price: 1390, currency: 'HUF' }),
    Object.freeze({ id: 'parcel_locker', name: 'Csomagautomata', price: 1500, currency: 'HUF' }),
    Object.freeze({ id: 'mpl', name: 'MPL', price: 4500, currency: 'HUF' })
  ]),
  foxpostAvailable: false,
  personalPickupAvailable: false,
  cashOnDeliveryHandlingFee: Object.freeze({ amount: 450, currency: 'HUF' }),
  registrationPhoneExample: '06301234567'
});

const OWNER_APPROVED_PROVENANCE = Object.freeze([{ sourceType: 'owner_approved_business_info', approvalStatus: 'OWNER_APPROVED' }]);

function forints(value) {
  return `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Ft`;
}

function resolveApprovedBusinessFact(intent) {
  const facts = OWNER_APPROVED_BUSINESS_FACTS;
  const shipping = facts.shippingMethods.map((method) => `${method.name}: ${forints(method.price)}`).join('; ');
  const cheapest = facts.shippingMethods.reduce((best, method) => method.price < best.price ? method : best);
  const locker = facts.shippingMethods.find((method) => method.id === 'parcel_locker');
  const answers = {
    shipping_cost: `Az elérhető szállítási díjak: ${shipping}.`,
    shipping_cheapest: `A legolcsóbb szállítási mód a ${cheapest.name}: ${forints(cheapest.price)}.`,
    parcel_locker: `Igen, csomagautomatába is kérheted. A díja ${forints(locker.price)}.`,
    shipping_carrier: facts.foxpostAvailable ? 'Igen, a Foxpost elérhető.' : 'Nem, Foxpost jelenleg nem érhető el.',
    personal_pickup: facts.personalPickupAvailable ? 'Igen, személyes átvétel elérhető.' : 'Nem, személyes átvétel jelenleg nem elérhető.',
    cash_on_delivery: `Igen, utánvéttel lehet fizetni. Az utánvét kezelési díja ${forints(facts.cashOnDeliveryHandlingFee.amount)}.`,
    registration_phone_format: `A telefonszámot ilyen formátumban add meg: ${facts.registrationPhoneExample}.`
  };
  if (!answers[intent]) return null;
  return { answer: answers[intent], businessFactStatus: 'OWNER_APPROVED', provenance: OWNER_APPROVED_PROVENANCE };
}

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
    shipping_cost: resolveApprovedBusinessFact('shipping_cost').answer,
    shipping_time: 'A kiszállítás általában körülbelül 2 munkanap, a pontos idő a választott szállítási módtól függ.',
    shipping_carrier_unknown: 'A jelenlegi jóváhagyott adatainkból nem tudom biztosan megmondani, melyik futárszolgálat érhető el. Az aktuális szállítási módokat a pénztárban látod.',
    shipping_free_unknown: 'A jelenlegi jóváhagyott adatainkból nem tudom biztosan megmondani, van-e ingyenes kiszállítás. Az aktuális feltételeket a pénztárban tudod ellenőrizni.'
  };
  const approved = resolveApprovedBusinessFact(intent);
  return {
    source: 'business-info', answer: answers[intent] || '', confidence: 100,
    links: [], suggestions: [], ruleId: null, intent, matchedKnowledgeIds: [],
    ...(approved ? { businessFactStatus: approved.businessFactStatus, provenance: approved.provenance } : {})
  };
}

module.exports = { OWNER_APPROVED_BUSINESS_FACTS, detectBusinessInfo, resolveApprovedBusinessFact, resolveBusinessInfo };
