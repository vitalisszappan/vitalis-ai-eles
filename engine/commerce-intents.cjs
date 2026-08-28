'use strict';

const { normalize } = require('./normalizer.cjs');

const PATTERNS = [
  ['order_confirmation_problem', /\b(?:nem|sem) (?:kaptam|erkezett|jott)\b.*\b(?:rendelesi )?visszaigazolas\w*\b|\bnem kaptam visszaigazolast\b/],
  ['checkout_problem', /\b(nem enged tovabb|nem tud(?:om|ok) (?:tovabbmenni|tovabb menni|megvenni|megrendelni|fizetni)|nem sikerul (?:rendelni|megrendelni|fizetni)|rendelesnel (?:elakad|elakadtam|hibat? ir)|hibat? ir ki a rendelesnel|nem enged kosarba tenni|miert nem (?:lehet(?:\s+\w+){0,4}? rendelni|tudom megvenni))\b/],
  ['order_status', /\b(hol tart|allapota|hol jar)\b.*\b(rendeles|csomag)/],
  ['shipping_cost', /\b(szallitas|futar)\w*.*\b(mennyi|mennyibe|dij|koltseg)/],
  ['shipping_time', /\b(mikor erkezik|mennyi ido|hany nap|szallitasi ido)\b/],
  ['shipping_general', /\b(hogy|hogyan|mivel)?\s*szallit|szallitas\w*|kiszallitas\w*/],
  ['payment', /\b(fizetes|fizetni|bankkartya|utanvet|paypal)\w*/],
  ['availability_query', /\b(keszleten|elerheto|rendelheto)\b/],
  ['price_query', /\b(mennyibe kerul|mennyi az ara|mennyiert|ara mennyi)\b/],
  ['purchase_location', /\b(hol tudom megvenni|hol vehetem meg|hol kaphato)\b/],
  ['ordering_help', /\b(hogyan|hogy) (?:tudom )?(?:meg)?rendelni\b|\bhogyan rendel(?:hetek|jek|hetem meg)\b|\bhogyan vasarolhatok\b/],
  ['order_start', /\b(szeretnem megrendelni|meg szeretnem rendelni|rendelni szeretnek|kosarba tennem|megveszem|(?:akkor |csak )?ezt kerem|csak ezt|nem kell mas|ezt akarom megrendelni|ezt szeretnem(?: megvenni)?|ezt veszem|csak (?:ezt|(?:a |az )?\w+) szeretnem|(?:az? )?(?:elsot|masodikat|harmadikat|elobbit|utobbit)(?: kerem| szeretnem| vennem meg)|inkabb (?:az? )?(?:elsot|masodikat|harmadikat|elobbit|utobbit|masikat)|(?:inkabb )?(?:a |az )?[\w -]+(?:kremet|balzsamot|szappant|sampont|csomagot) (?:kerem|szeretnem))\b/]
];

function hasCommerceDomainEvidence(question, { hasProductContext = false, directProduct = false } = {}) {
  const text = normalize(question);
  if (hasProductContext || directProduct) return true;
  if (/\b(rendeles|rendelni|megrendelni|kosar|penztar|checkout|webshop|termek|szappan|sampon|krem|balzsam|csomag)\w*\b/.test(text)) return true;
  if (/\b(?:nem tud(?:ok|om)|nem sikerul) fizetni\b/.test(text)) return true;
  if (/\bmiert nem (?:tudom megvenni|lehet(?:\s+\w+){0,4}? rendelni)\b/.test(text)) return true;
  if (/^(?:ezt szeretnem megvenni|(?:csak )?ezt kerem|csak ezt|nem kell mas|ezt akarom megrendelni|megveszem)$/i.test(text)) return !/\b(?:otlet|vacsora|kave|elet)\w*\b/.test(text);
  if (/^(?:(?:az? )?(?:elsot|masodikat|harmadikat|elobbit|utobbit)(?: kerem| szeretnem| vennem meg)|inkabb (?:az? )?(?:elsot|masodikat|harmadikat|elobbit|utobbit|masikat))$/i.test(text)) return true;
  return false;
}

function detectCommerceIntent(question) {
  const text = normalize(question);
  for (const [intent, pattern] of PATTERNS) {
    if (pattern.test(text)) return { intent, evidence: [`commerce:${intent}`] };
  }
  return null;
}

module.exports = { detectCommerceIntent, hasCommerceDomainEvidence };
