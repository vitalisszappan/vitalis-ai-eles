'use strict';

const { normalize } = require('./normalizer.cjs');

function detectProductQuestionIntent(question) {
  const text = normalize(question);
  if (/\b(van (?:belole )?masik|masik termek|hasonlo (?:termek|keszitmeny|valtozat)|helyett\b.*\b(?:mas|hasonlo)|alternativa)\b/.test(text)) return 'alternative';
  if (/\b(osszehasonlit\w*|hasonlit\w*\s+ossze|kulonbseg|miben mas|miben kulonboz\w*|melyik jobb|melyik olcsobb|olcsobb|vs)\b/.test(text)) return 'comparison';
  if (/\b(mi van\b.*\b(?:benne|\w+ban|\w+ben)|\bmasik(?:ban|ben)\b.*\bmi van|mik az?\b.*\bosszetevoi|miket tartalmaz|miket rakt\w*|osszetevo\w*|alkotoelem\w*|inci(?:je)?|mit tartalmaz|mibol keszul|mikbol all|milyen\b.*\bosszetevo|sorold fel\b.*\bosszetevo)\b/.test(text)) return 'ingredients';
  if (/\b(van\b.*\bbenne\s+\w+|van\b.*\b\w+(?:ban|ben)\s+\w+|tartalmaz\s+(?!a\b)\w+)\b/.test(text) && !/\b(van belole|van mas|van krem|van szappan|van sampon)\b/.test(text)) return 'ingredient_existence';
  if (/\b(hogyan hasznaljam|hogy hasznaljam|hogyan kell hasznalni|hogy kell hasznalni|ezt hogyan hasznaljam|ezt hogy kell hasznalni|hogy kenjem|hogyan kenjem|mikent kenjem|hogy vigyem fel|hogyan vigyem fel|mikent vigyem fel|hogy alkalmazzam|hogyan alkalmazzam|mikent alkalmazzam|hogyan mossak|hogy mossak|hogyan mossam|hogy mossam|mikor hasznaljam|mikor kenjem|milyen gyakran|naponta hanyszor|naponta\b.*\bhasznal|mennyit hasznaljak(?: belole)?|mennyi ideig hagyjam|hasznalhatom)\b/.test(text)) return 'usage';
  if (/\b(mennyibe kerul|mennyi az ara|mennyiert|mennyiert adjatok|ara mennyi|mi az ara|hany forint\w*|ez mennyi|mennyi most|jelenlegi ar|ara erdekel)\b/.test(text)) return 'price';
  if (/\b(mi ez(?: a termek)?|mire valo(?: ez| a)?|mit tud (?:ez|a)\b|mit csinal|mire hasznalhato|milyen\b.*\bpanaszra valo)\b/.test(text)) return 'description';
  if (/\b(mire jo(?: ez| a)?|miert jo|miert ajanl|miben segit|milyen\b.*\bpanaszra ajanl)\b/.test(text)) return 'benefits';
  if (/\b(kinek ajanlott|kinek valo|milyen (?:borre|hajra|fejborre) valo)\b/.test(text)) return 'suitability';
  if (/\b(alkalmas|megfelel|hasznalhato|jo lehet)\b.*\b(?:borre|hajra|fejborre|arcra)\b|\b(?:borre|hajra|fejborre|arcra)\b.*\b(alkalmas|megfelel|hasznalhato|jo)\b/.test(text)) return 'suitability';
  if (/\b(mit erdemes tudni rola|milyen ez|lehet arcra hasznalni|hasznalhato arcra|szappan vagy sampon)\b/.test(text)) return 'product_information';
  if (/\b(milyen illata|milyen az illata|illat[a]? van)\b/.test(text)) return 'scent';
  if (/\b(ajanl\w*|javasol\w*|melyiket valassz\w*|mit valassz\w*|melyik jobb|melyik\b.*\bjo|melyik a legjobb|mit hasznaljak|keresek)\b/.test(text)) return 'recommendation';
  if (/\b(van belole mas\w*|mas illat|masik valtozat|mekkora a kiszereles)\b/.test(text)) return 'variant';
  if (/^(van|vannak|kaphato|elerheto)\b/.test(text)) return 'availability';
  return null;
}

module.exports = { detectProductQuestionIntent };
