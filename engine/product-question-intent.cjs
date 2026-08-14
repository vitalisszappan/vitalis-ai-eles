'use strict';

const { normalize } = require('./normalizer.cjs');

function detectProductQuestionIntent(question) {
  const text = normalize(question);
  if (/\b(hogyan hasznaljam|hogy hasznaljam|hogyan kell hasznalni|ezt hogyan hasznaljam|ezt hogy kell hasznalni|mikor kenjem|milyen gyakran|mennyi ideig hagyjam|hogyan alkalmazzam)\b/.test(text)) return 'usage';
  if (/\b(mennyibe kerul|mennyi az ara|mennyiert|ara mennyi)\b/.test(text)) return 'price';
  if (/\b(mit tud ez|mit tud a|mire jo ez|mire jo a|mit erdemes tudni rola|milyen ez)\b/.test(text)) return 'product_information';
  if (/\b(ajanl\w*|javasol\w*|melyiket valassz\w*|mit valassz\w*|melyik jobb|melyik jo|mit hasznaljak)\b/.test(text)) return 'recommendation';
  if (/^(van|vannak|kaphato|elerheto)\b/.test(text)) return 'availability';
  return null;
}

module.exports = { detectProductQuestionIntent };
