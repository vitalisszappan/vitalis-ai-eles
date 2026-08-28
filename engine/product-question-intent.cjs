'use strict';

const { normalize } = require('./normalizer.cjs');

function detectProductQuestionIntent(question) {
  const text = normalize(question);
  if (/\b(hogyan hasznaljam|hogy hasznaljam|hogyan kell hasznalni|ezt hogyan hasznaljam|ezt hogy kell hasznalni|mikor kenjem|milyen gyakran|mennyi ideig hagyjam|hogyan alkalmazzam)\b/.test(text)) return 'usage';
  if (/\b(mennyibe kerul|mennyi az ara|mennyiert|ara mennyi)\b/.test(text)) return 'price';
  if (/\b(mit tud ez|mit tud a|mire jo ez|mire jo a|mire valo|mit erdemes tudni rola|milyen ez|lehet arcra hasznalni|hasznalhato arcra|szappan vagy sampon)\b/.test(text)) return 'product_information';
  if (/\b(milyen illata|milyen az illata|illat[a]? van)\b/.test(text)) return 'scent';
  if (/\b(ajanl\w*|javasol\w*|melyiket valassz\w*|mit valassz\w*|melyik jobb|melyik\b.*\bjo|melyik a legjobb|mit hasznaljak|keresek)\b/.test(text)) return 'recommendation';
  if (/\b(van belole mas\w*|mas illat|masik valtozat|mekkora a kiszereles)\b/.test(text)) return 'variant';
  if (/^(van|vannak|kaphato|elerheto)\b/.test(text)) return 'availability';
  return null;
}

module.exports = { detectProductQuestionIntent };
