'use strict';

const { normalize } = require('./normalizer.cjs');

const PATTERNS = [
  ['order_status', /\b(hol tart|allapota|hol jar)\b.*\b(rendeles|csomag)/],
  ['shipping_cost', /\b(szallitas|futar)\w*.*\b(mennyi|mennyibe|dij|koltseg)/],
  ['shipping_time', /\b(mikor erkezik|mennyi ido|hany nap|szallitasi ido)\b/],
  ['shipping_general', /\b(hogy|hogyan|mivel)?\s*szallit|szallitas\w*|kiszallitas\w*/],
  ['payment', /\b(fizetes|fizetni|bankkartya|utanvet|paypal)\w*/],
  ['availability_query', /\b(keszleten|elerheto|rendelheto)\b/],
  ['price_query', /\b(mennyibe kerul|mennyi az ara|mennyiert|ara mennyi)\b/],
  ['purchase_location', /\b(hol tudom megvenni|hol vehetem meg|hol kaphato)\b/],
  ['order_start', /\b(szeretnem megrendelni|meg szeretnem rendelni|rendelni szeretnek|kosarba tennem)\b/]
];

function detectCommerceIntent(question) {
  const text = normalize(question);
  for (const [intent, pattern] of PATTERNS) {
    if (pattern.test(text)) return { intent, evidence: [`commerce:${intent}`] };
  }
  return null;
}

module.exports = { detectCommerceIntent };
