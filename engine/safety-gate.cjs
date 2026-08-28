'use strict';

const { normalize } = require('./normalizer.cjs');

const BREATHING_DIFFICULTY = /\b(?:nehezen|alig|nem)\s+kap(?:ok|sz|unk|nak)?\s+levegot\b|\bnehez\s+levegot\s+venn(?:em|ed|ie|unk|etek|iuk)\b|\bnehezlegzes(?:em|ed|e|unk|etek|uk)?\s+van\b/;
const SEVERE_SWELLING = /\b(?:bedagadt|feldagadt|megdagadt)\s+(?:a\s+)?(?:szam|szaja|nyelvem|nyelve|torkom|torka)\b|\b(?:bedagadtam|feldagadtam|megdagadtam)\b/;
const BLISTERING = /\bfelholyagosodott\s+(?:a\s+)?bor(?:om|od|e)?\b|\bbor(?:om|od|e)?\s+felholyagosodott\b|\berosen\s+felholyagosodott\b|\bholyagos\s+lett\s+(?:a\s+)?bor(?:om|od|e)?\b|\bholyagok\s+jelentek\s+meg\b/;
const NON_ACTUAL_CONTEXT = /\b(?:lehet\s+hogy|mi\s+van\s+ha|okozhat|eloidezhat|hallottam|azt\s+olvastam|azt\s+mondtak)\b|\b(?:bedagadhat|feldagadhat|megdagadhat|holyagosodhat|felholyagosodhat)\w*\b/;
const EXPLICIT_NEGATIVE = /\bnem\s+(?:nehez\s+levegot\s+venn\w*|dagadt\s+be|holyagos|holyagosodott|felholyagosodott)\b/;
const PAST_RESOLVED = /\b(?:tegnap|multkor|korabban|regen)\b.*\b(?:most|mar)\b.*\b(?:jol\s+vagyok|nincs\s+baj|elmult|rendben\s+vagyok)\b/;

function severeAdverseReaction(text) {
  if (NON_ACTUAL_CONTEXT.test(text) || EXPLICIT_NEGATIVE.test(text) || PAST_RESOLVED.test(text)) return null;
  if (BREATHING_DIFFICULTY.test(text)) return 'breathing_difficulty';
  if (SEVERE_SWELLING.test(text)) return 'severe_swelling';
  if (BLISTERING.test(text)) return 'blistering';
  return null;
}

function evaluateSafety(question, problem = null) {
  const text = normalize(question);
  const evidence = [];
  const adverseReaction = severeAdverseReaction(text);
  if (adverseReaction) {
    return { safetyClass: 'medical_escalation', evidence: [`safety:severe_adverse_reaction:${adverseReaction}`] };
  }
  if (/\b(legszomj|nehezlegzes|mellkasi fajdalom|ajulas|elkekul|hirtelen bedagad|eros fajdalom|elviselhetetlen fajdalom)\b/.test(text)) {
    return { safetyClass: 'medical_escalation', evidence: ['safety:urgent_symptom'] };
  }
  if (/\b(diagnosztiz|gyogyszer|antibiotikum|tabletta|orvosi kezeles)\w*/.test(text)) {
    return { safetyClass: 'medical_escalation', evidence: ['safety:diagnosis_or_medicine'] };
  }
  if (problem?.domain === 'edema_medical_boundary' || /\b(odema|visszergyulladas|viszergyulladas)\w*/.test(text)) {
    evidence.push('safety:edema_or_inflammation');
    return { safetyClass: 'caution_with_boundary', evidence };
  }
  if (problem && ['varicose_cosmetic', 'circulation_claim'].includes(problem.domain)) {
    return { safetyClass: 'caution_with_boundary', evidence: [`safety:${problem.domain}`] };
  }
  if (problem?.domain === 'child_usage' || /\b(gyerek|gyermek|baba|[0-9]{1,2} eves)\b/.test(text)) {
    return { safetyClass: 'safe_cosmetic_answer', evidence: ['safety:child_usage'] };
  }
  if (/\b(gyulladt|gyulladas|sebes|verzik)\w*/.test(text)) {
    return { safetyClass: 'caution_with_boundary', evidence: ['safety:inflamed_or_broken_skin'] };
  }
  return { safetyClass: 'safe', evidence: [] };
}

module.exports = { evaluateSafety, severeAdverseReaction };
