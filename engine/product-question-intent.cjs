'use strict';

const { normalize } = require('./normalizer.cjs');

function detectProductQuestionIntent(question) {
  const text = normalize(question);
  if (/\b(osszehasonlit\w*|hasonlit\w*\s+ossze|kulonbseg|miben mas|melyik jobb|melyik olcsobb|olcsobb|vs)\b/.test(text)) return 'comparison';
  if (/\b(mi van\b.*\b(?:benne|\w+ban|\w+ben)|\bmasik(?:ban|ben)\b.*\bmi van|mik az?\b.*\bosszetevoi|osszetevo\w*|inci(?:je)?|mit tartalmaz|milyen\b.*\bosszetevo)\b/.test(text)) return 'ingredients';
  if (/\b(van\b.*\bbenne\s+\w+|van\b.*\b\w+(?:ban|ben)\s+\w+|tartalmaz\s+(?!a\b)\w+)\b/.test(text) && !/\b(van belole|van mas|van krem|van szappan|van sampon)\b/.test(text)) return 'ingredient_existence';
  if (/\b(hogyan hasznaljam|hogy hasznaljam|hogyan kell hasznalni|ezt hogyan hasznaljam|ezt hogy kell hasznalni|mikor kenjem|milyen gyakran|mennyi ideig hagyjam|hogyan alkalmazzam)\b/.test(text)) return 'usage';
  if (/\b(mennyibe kerul|mennyi az ara|mennyiert|ara mennyi)\b/.test(text)) return 'price';
  if (/\b(mire jo ez|mire jo a|mire valo|mit tud ez|mit tud a)\b/.test(text)) return 'benefits';
  if (/\b(alkalmas|megfelel|hasznalhato|jo lehet)\b.*\b(?:borre|hajra|fejborre|arcra)\b|\b(?:borre|hajra|fejborre|arcra)\b.*\b(alkalmas|megfelel|hasznalhato|jo)\b/.test(text)) return 'suitability';
  if (/\b(mit erdemes tudni rola|milyen ez|lehet arcra hasznalni|hasznalhato arcra|szappan vagy sampon)\b/.test(text)) return 'product_information';
  if (/\b(milyen illata|milyen az illata|illat[a]? van)\b/.test(text)) return 'scent';
  if (/\b(ajanl\w*|javasol\w*|melyiket valassz\w*|mit valassz\w*|melyik jobb|melyik\b.*\bjo|melyik a legjobb|mit hasznaljak|keresek)\b/.test(text)) return 'recommendation';
  if (/\b(van belole mas\w*|mas illat|masik valtozat|mekkora a kiszereles)\b/.test(text)) return 'variant';
  if (/^(van|vannak|kaphato|elerheto)\b/.test(text)) return 'availability';
  return null;
}

module.exports = { detectProductQuestionIntent };
