'use strict';

const { normalize } = require('./normalizer.cjs');

const CHECKOUT_PROBLEM = [
  /\b(nem enged tovabb|nem tud(?:om|ok) (?:tovabbmenni|tovabb menni|megvenni|megrendelni|fizetni)|nem sikerul (?:rendelni|megrendelni|fizetni)|rendelesnel (?:elakad|elakadtam|hibat? ir)|hibat? ir ki a rendelesnel|nem enged kosarba tenni|miert nem (?:lehet(?:\s+\w+){0,4}? rendelni|tudom megvenni))\b/,
  /\b(?:mas termek\w*|nem kulon)\b.*\bkosarba\b.*\b(?:tesz\w*|rak\w*|kerul\w*)\b|\b(?:de|helyett)\b.*\bcsomagot\b.*\b(?:tesz\w*|rak\w*)\b.*\bkosarba\b|\bnem kulon\b.*\b(?:tesz\w*|rak\w*|kerul\w*)\b.*\bkosarba\b|\bkosarba\b.*\b(?:tesz\w*|rak\w*)\b.*\b(?:mas termek\w*|csomag\w*)\b.*\b(?:hozzaad\w*|tesz\w*|rak\w*|kerul\w*)\b/,
  /\b(?:mast|mas termek\w*|tovabbi termek\w*)\b.{0,40}\b(?:hozzaad\w*|tesz\w*|rak\w*|kerul\w*)\b.{0,40}\bkosar(?:ba|hoz|ban)\b/,
  /\bmiert\b.{0,30}\b(?:ad hozza|hozzaad\w*)\b.{0,30}\bmas termek\w*\b.{0,30}\bkosar(?:ba|hoz|ban)\b/,
  /\bnem azt\b.{0,50}\bkosar(?:ba|ban)\b/,
  /\bkosarban\b.{0,50}\bmas termek\w*\b.{0,40}\b(?:jelenik meg|kerul|van)\b/,
  /\bcsak\b.{0,50}\b(?:akar\w*|ker\w*|szeretn\w*)\b.{0,50}\bmegis\b.{0,40}\bcsomag\w*\b.{0,40}\b(?:tesz\w*|rak\w*|kerul\w*)\b/,
  /\bcsomag\w*\b.{0,40}\bkosarba\b.*\btermek\w*\s+helyett\b/
];
const PERSONAL_PICKUP = /\b(szemelyes\w*\s+atvet|szemelyesen\s+atve|at\s+tudom\s+venni\s+szemelyesen|bemehetek erte|elmehetek erte|be lehet menni erte)\w*|\bszemelyes\s+(?:uzlet\w*|bolt\w*)\b|\bszemelyesen\b(?:\s+\w+){0,5}\s+(?:megvenni|venni|kapni|kaphato)\b|\b(?:megvenni|venni|kapni|kaphato)\b(?:\s+\w+){0,5}\s+szemelyesen\b|\b(?:van|talalhato)\b(?:\s+\w+){0,2}\s+\b(?:uzlet|bolt)\w*\b|\bhol\b(?:\s+\w+){0,4}\s+\b(?:vehetem|tudom)\s+at\b(?:\s+\w+){0,5}\s+szemelyesen\b|\bhol\b(?:\s+\w+){0,4}\s+\b(?:atvehetem|atvehet\w*|atvennem)\b(?:\s+\w+){0,5}\s+szemelyesen\b|\b(?:at tudom venni|atvehetem|atvennem)\b(?:\s+\w+){0,5}\s+\b(?:nalatok|szemelyesen)\b/;

const PATTERNS = [
  ['order_confirmation_problem', /\b(?:nem|sem) (?:kaptam|erkezett|jott)\b.*\b(?:rendelesi )?visszaigazolas\w*\b|\bnem kaptam visszaigazolast\b/],
  ['checkout_problem', CHECKOUT_PROBLEM],
  ['order_status', /\b(hol tart|allapota|hol jar)\b.*\b(rendeles|csomag)/],
  ['gls_parcel_point', /\bgls\b.*\b(?:pont|csomagpont)\w*\b/],
  ['shipping_cost', /\b(szallitas|futar|hazhozszallitas)\w*.*\b(mennyi|mennyibe|dij|koltseg)|\b(mennyi|mennyibe)\b.*\bhazhozszallitas\w*/],
  ['shipping_cheapest', /\b(legolcsobb|legkedvezobb|legkevesebb\w*)\b.*\b(szallitas|kiszallitas|kezbesites)\w*|\b(szallitas|kiszallitas|kezbesites)\w*.*\b(legolcsobb|legkedvezobb|legkevesebb\w*)\b/],
  ['parcel_locker', /\b(csomagautomata|automata|csomagpont)\w*\b.*\b(ker|szallit|atvet|valaszt)\w*|\b(automataba|csomagpontra)\b/],
  ['cash_on_delivery', /\b(utanvet|utanvetel)\w*|\b(futarnal|kezbesitonel)\b.*\b(fizet|atvetel)\w*/],
  ['shipping_carrier', /\b(foxpost|gls|mpl|dpd|futarszolgalat)\w*\b|\bmelyik futar\w*/],
  ['personal_pickup', PERSONAL_PICKUP],
  ['registration_phone_format', /\b(regisztracio\w*|regisztral\w*)\b.*\btelefonszam\w*\b|\btelefonszam\w*\b.*\b(regisztracio\w*|regisztral\w*|hogy\s+irjam\s+be|milyen\s+formatum)\b/],
  ['shipping_time', /\b(mikor erkezik|mennyi ido|hany nap|szallitasi ido)\b/],
  ['shipping_general', /\b(hogy|hogyan|mivel)?\s*szallit|szallitas\w*|kiszallitas\w*/],
  ['card_payment', /\b(bankkartya|kartyaval|bankkartyas)\w*/],
  ['payment', /\b(fizetes|fizetni|fizethetek|bankkartya|kartyaval|paypal)\w*/],
  ['availability_query', /\b(keszleten|elerheto|rendelheto)\b/],
  ['price_query', /\b(mennyibe kerul|mennyi az ara|mennyiert|mennyiert adjatok|ara mennyi|mi az ara|hany forint\w*|ez mennyi|mennyi most|jelenlegi ar|ara erdekel)\b/],
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

function hasRecentShippingContext(history = [], conversationState = null) {
  if (['shipping_cost', 'shipping_cheapest', 'shipping_general', 'gls_parcel_point', 'parcel_locker', 'shipping_carrier', 'personal_pickup']
    .some((intent) => [conversationState?.lastCommerceFocus, conversationState?.lastAssistantIntent, conversationState?.lastUserIntent].includes(intent))) return true;
  const lastAssistant = [...history].reverse().find((item) => item?.role === 'assistant');
  const intent = lastAssistant?.intent || lastAssistant?.routing?.intent;
  return ['business_info', 'commerce'].includes(lastAssistant?.route)
    && ['shipping_cost', 'shipping_cheapest', 'shipping_general', 'gls_parcel_point', 'parcel_locker', 'shipping_carrier', 'personal_pickup'].includes(intent);
}

function detectCommerceIntent(question, history = [], conversationState = null) {
  const text = normalize(question);
  if (hasRecentShippingContext(history, conversationState) && /^(?:es )?(?:melyik|mi) (?:a )?(?:legolcsobb|legkedvezobb)(?: szallitas)?[?!.]*$/.test(text)) {
    return { intent: 'shipping_cheapest', evidence: ['commerce:shipping_cheapest', 'context:shipping'] };
  }
  for (const [intent, pattern] of PATTERNS) {
    if ((Array.isArray(pattern) ? pattern.some((item) => item.test(text)) : pattern.test(text))) {
      return { intent, evidence: [`commerce:${intent}`] };
    }
  }
  return null;
}

module.exports = { detectCommerceIntent, hasCommerceDomainEvidence };
