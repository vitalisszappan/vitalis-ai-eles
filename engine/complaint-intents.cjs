'use strict';

const { normalize } = require('./normalizer.cjs');

const SYMPTOM = /\b(irrital\w*|csip\w*|eget\w*|kipiros\w*|pirosod\w*|viszket\w*|kiutes\w*|bedagad\w*|dagad\w*|allergi\w*|foltos\w*)\b/;
const PRODUCT = /\b(szappan\w*|krem\w*|balzsam\w*|sampon\w*|termek\w*|dezodor\w*|tusfurdo\w*)\b/;
const QUALITY = /\b(serult\w*|hibas\w*|rossz termek\w*|kifolyt\w*|torott\w*|hianyos\w*|furcsa szag\w*|megolvadt\w*|elszinezodott\w*|rossz az allaga)\b/;
const CRITICAL = /\b(nem kapok levegot|alig kapok levegot|fullad\w*|bedagadt a nyelv\w*|dagad a nyelv\w*|bedagadt a szam|dagad a szam)\b/;
const HIGH = /\b(bedagad\w*|dagad\w*|lenyelt\w*|lenyeltem|megette|szemebe ment)\b/;
const NEGATED = /\b(nem|se|sem|egyaltalan nem)\s+(?:\w+\s+){0,3}?(irrital\w*|csip\w*|eget\w*|pirosod\w*|pirosodtam\w*|viszket\w*|allergi\w*|dagad\w*|verzik\w*)\b/;
const HYPOTHETICAL = /\b(lehet\w*|irritalhat\w*|csiphet\w*|egethet\w*|kipirosodhat\w*|bedagadhat\w*|okozhat\w*|hasznalhat\w*)\b|\bmi van ha\b/;
const REPORTED = /\b(azt olvastam|azt irjak|a reklam\w*|hallottam)\b/;
const NEED_STATE = /\b(irritalt|erzekeny|kipirosodasra|pirosodasra|viszketo)\b.*\b(bor\w*|krem\w*|szappan\w*|termek\w*)\b.*\b(keres\w*|szeretnek|ajanl\w*)\b|\b(irritalt|erzekeny|kipirosodasra|pirosodasra)\s+borre\b/;
const TARGET_NEED_STATE = /\b\w+(?:ra|re)\b.*\b(?:mit\s+(?:hasznalj\w*|ajanl\w*)|keres\w*|szeretn\w*)\b/;
const RESOLVED = /\b(mar elmult|most nincs baj|mar nincs baj|mar jol vagyok|teljesen elmult|nincs mar baj)\b/;
const STILL_RELEVANT = /\b(meg most is|most is|tovabbra is|meg mindig)\b.*\b(irrital\w*|csip\w*|eget\w*|piros\w*|viszket\w*)\b|\b(irrital\w*|csip\w*|eget\w*|piros\w*|viszket\w*)\b.*\b(meg most is|most is|tovabbra is|meg mindig)\b/;
const CAUSAL_MARKER = /\b(ettol|attol|miatta|hasznalat\w* utan|felkenes utan|amikor ezt kentem)\b|\bbekentem ezzel\b.*\butana\b|\b\w+tol\b/;
const REPLACEMENT_REQUEST = /\b(helyette|melyik\w*.*ajanl\w*|mit hasznalj\w*|van masik)\b/;
const RECOMMENDATION_NEED = /\b(melyik\w*.*ajanl\w*|mit\s+(?:hasznalj\w*|ajanl\w*))\b/;
const SERVICE_INTERSECTION = /\b(visszakap\w*.*penz\w*|refund\w*|visszaterit\w*|kicserel\w*|panaszt szeretnek)\b/;
const METAPHORICAL = /\b(csipos illat\w*|egetoen szukseg\w*)\b/;

function detectSubject(text) {
  if (/\b(gyerek\w*|gyermek\w*|fiam\w*|lanyom\w*|babam\w*)\b/.test(text)) return 'child';
  if (/\b(baratnom\w*|baratom\w*|anyukam\w*|apukam\w*|ferjem\w*|felesegem\w*)\b/.test(text)) return 'third_party';
  if (/\b(en|nekem|borom\w*|szam\w*|nyelvem\w*|lettem|vagyok)\b/.test(text)) return 'user';
  return 'generic';
}

function detectTemporality(text) {
  if (HYPOTHETICAL.test(text)) return 'hypothetical';
  if (RESOLVED.test(text)) return 'resolved_past';
  if (STILL_RELEVANT.test(text)) return 'still_relevant_past';
  if (/\b(tegnap|multkor|korabban|regen|volt|csipett|irritalt)\b/.test(text)) return 'past';
  if (/\b(most|jelenleg|utana|hasznalat utan|felkenes utan|erkezett|kaptam|kifolyt)\b/.test(text) || SYMPTOM.test(text)) return 'current';
  return 'unknown';
}

function productCategory(text) {
  return text.match(/\b(szappan|krem|balzsam|sampon|dezodor|tusfurdo)\w*\b/)?.[1] || null;
}

function symptomLabel(text) {
  if (/\b(kipiros\w*|pirosod\w*|piros\w*)\b/.test(text)) return 'kipirosodás';
  if (/\bcsip\w*\b/.test(text)) return 'csípő érzés';
  if (/\beget\w*\b/.test(text)) return 'égető érzés';
  if (/\bviszket\w*\b/.test(text)) return 'viszketés';
  return 'panasz';
}

function detectComplaintIntent(question, context = {}) {
  const text = normalize(question);
  if (!text || METAPHORICAL.test(text) || NEED_STATE.test(text) || TARGET_NEED_STATE.test(text)) return null;
  const quality = QUALITY.test(text);
  const critical = CRITICAL.test(text);
  const symptom = SYMPTOM.test(text) || critical || HIGH.test(text);
  const negated = NEGATED.test(text);
  const hypothetical = HYPOTHETICAL.test(text) || REPORTED.test(text);
  const productPresent = PRODUCT.test(text) || Boolean(context.focusedProductId);
  if (!quality && !symptom) return null;

  const temporality = detectTemporality(text);
  const polarity = negated ? 'negative' : hypothetical ? 'uncertain' : 'positive';
  const explicitRelation = CAUSAL_MARKER.test(text) || (PRODUCT.test(text) && /\b(irrital\w*|csip\w*|eget\w*)\b/.test(text));
  if (RECOMMENDATION_NEED.test(text) && !explicitRelation) return null;
  const impliedComplaintFlow = REPLACEMENT_REQUEST.test(text) || SERVICE_INTERSECTION.test(text) || temporality === 'still_relevant_past';
  const causality = quality ? 'asserted' : explicitRelation ? 'asserted'
    : context.focusedProductId && /\b(ettol|attol|utana|miatta)\b/.test(text) ? 'asserted'
      : impliedComplaintFlow ? 'sufficient' : productPresent ? 'suspected' : 'generic';
  const severity = critical ? 'critical' : HIGH.test(text) ? 'high'
    : /\b(kiutes\w*|allergi\w*|eget\w*|csip\w*)\b/.test(text) ? 'moderate' : symptom || quality ? 'low' : 'unknown';
  const intent = quality && !symptom ? 'product_quality_complaint'
    : /\b(abbahagy\w*|hasznaljam tovabb|ne hasznaljam)\b/.test(text) ? 'stop_use_question'
      : /\ballergi\w*\b/.test(text) ? 'allergic_reaction_concern'
        : /\b(eget\w*|csip\w*)\b/.test(text) ? 'burning_after_use'
          : /\b(kipiros\w*|pirosod\w*|foltos\w*)\b/.test(text) ? 'redness_after_use'
            : quality ? 'product_quality_complaint' : 'product_irritation';

  return {
    intent, subject: detectSubject(text), temporality, polarity, causality, severity,
    productPresent, productCategory: productCategory(text), symptomLabel: symptomLabel(text),
    stillRelevant: temporality === 'current' || temporality === 'still_relevant_past',
    resolved: temporality === 'resolved_past', replacementRequest: REPLACEMENT_REQUEST.test(text),
    customerServiceIntersection: SERVICE_INTERSECTION.test(text), qualityOnly: quality && !symptom,
    evidence: [quality ? 'complaint:quality' : 'complaint:symptom', `complaint:${polarity}`, `complaint:${causality}`, `complaint:${temporality}`]
  };
}

function isP0ComplaintEligible(complaint, routing = {}) {
  if (!complaint || complaint.qualityOnly || complaint.intent === 'product_quality_complaint') return false;
  if (complaint.polarity !== 'positive' || complaint.resolved) return false;
  if (!['current', 'still_relevant_past'].includes(complaint.temporality)) return false;
  if (!['low', 'moderate'].includes(complaint.severity)) return false;
  if (complaint.causality !== 'asserted' && !(complaint.causality === 'sufficient' && complaint.productPresent)) return false;
  if (routing.route === 'safety' || routing.safetyClass === 'medical_escalation') return false;
  return ['product_category', 'exact_product', 'expert_rule', 'problem_domain', 'context_followup', 'commerce', 'clarification', 'hard_fallback'].includes(routing.route);
}

module.exports = { detectComplaintIntent, isP0ComplaintEligible };
