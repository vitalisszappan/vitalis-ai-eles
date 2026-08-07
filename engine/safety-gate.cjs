'use strict';

const { normalize } = require('./normalizer.cjs');

function evaluateSafety(question, problem = null) {
  const text = normalize(question);
  const evidence = [];
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

module.exports = { evaluateSafety };
