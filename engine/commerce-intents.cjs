'use strict';

const { normalize } = require('./normalizer.cjs');

const PATTERNS = [
  ['checkout_problem', /\b(nem enged tovabb|nem tud(?:om|ok) (?:tovabbmenni|tovabb menni|megvenni|megrendelni)|nem sikerul (?:rendelni|megrendelni)|rendelesnel (?:elakad|elakadtam)|miert nem (?:lehet(?:\s+\w+){0,4}? rendelni|tudom megvenni))\b/],
  ['order_status', /\b(hol tart|allapota|hol jar)\b.*\b(rendeles|csomag)/],
  ['shipping_cost', /\b(szallitas|futar)\w*.*\b(mennyi|mennyibe|dij|koltseg)/],
  ['shipping_time', /\b(mikor erkezik|mennyi ido|hany nap|szallitasi ido)\b/],
  ['shipping_general', /\b(hogy|hogyan|mivel)?\s*szallit|szallitas\w*|kiszallitas\w*/],
  ['payment', /\b(fizetes|fizetni|bankkartya|utanvet|paypal)\w*/],
  ['availability_query', /\b(keszleten|elerheto|rendelheto)\b/],
  ['price_query', /\b(mennyibe kerul|mennyi az ara|mennyiert|ara mennyi)\b/],
  ['purchase_location', /\b(hol tudom megvenni|hol vehetem meg|hol kaphato)\b/],
  ['order_start', /\b(szeretnem megrendelni|meg szeretnem rendelni|rendelni szeretnek|kosarba tennem|megveszem|(?:akkor |csak )?ezt kerem|csak ezt|nem kell mas|ezt akarom megrendelni|ezt szeretnem(?: megvenni)?|ezt veszem|csak (?:ezt|(?:a |az )?\w+) szeretnem|(?:az? )?(?:elsot|masodikat|harmadikat|elobbit|utobbit)(?: kerem| szeretnem| vennem meg)|inkabb (?:az? )?(?:elsot|masodikat|harmadikat|elobbit|utobbit|masikat)|(?:inkabb )?(?:a |az )?[\w -]+(?:kremet|balzsamot|szappant|sampont|csomagot) (?:kerem|szeretnem))\b/]
];

function detectCommerceIntent(question) {
  const text = normalize(question);
  for (const [intent, pattern] of PATTERNS) {
    if (pattern.test(text)) return { intent, evidence: [`commerce:${intent}`] };
  }
  return null;
}

module.exports = { detectCommerceIntent };
