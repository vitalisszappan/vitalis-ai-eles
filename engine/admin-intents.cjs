const { normalize } = require('./normalizer.cjs');

function includesAny(text, phrases) {
  return phrases.some((phrase) => text.includes(normalize(phrase)));
}

function resolveAdministrativeIntent(question) {
  const q = normalize(question);

  // A szállítási díj kérdéseit a jelenlegi mondat alapján, minden korábbi
  // termék- vagy bőrprobléma-kontextus előtt kezeljük.
  const shippingCost =
    (q.includes('szallitas') && includesAny(q, ['mennyibe kerül', 'mennyibe kerul', 'mennyi az ára', 'mennyi az ara', 'díj', 'dij', 'költség', 'koltseg'])) ||
    includesAny(q, ['szállítási díj', 'szallitasi dij', 'futár díja', 'futar dija']);
  if (shippingCost) {
    return {
      source: 'admin-intent',
      ruleId: 'shipping_cost',
      intent: 'shipping_cost',
      answer: 'A szállítás díja a választott szállítási és fizetési módtól függ. Az aktuális összeget a pénztárban, a rendelés véglegesítése előtt látod.',
      confidence: 100,
      links: [],
      suggestions: [
        { label: 'Szállítási idő', question: 'Mennyi a szállítási idő?' },
        { label: 'Utánvét', question: 'Lehet utánvéttel fizetni?' }
      ]
    };
  }

  const shippingTime = includesAny(q, [
    'mennyi a szállítási idő', 'mennyi a szallitasi ido', 'mikor érkezik',
    'mikor erkezik', 'mennyi idő alatt', 'mennyi ido alatt', 'hány nap a szállítás',
    'hany nap a szallitas'
  ]);
  if (shippingTime) {
    return {
      source: 'admin-intent',
      ruleId: 'shipping_time',
      intent: 'shipping_time',
      answer: 'A kiszállítás általában körülbelül 2 munkanap. A pontos érkezés a rendelés időpontjától és a választott szállítási módtól függ.',
      confidence: 100,
      links: [],
      suggestions: [
        { label: 'Szállítási díj', question: 'Mennyibe kerül a szállítás?' },
        { label: 'Rendelésem állapota', question: 'Hol tart a rendelésem?' }
      ]
    };
  }

  if (includesAny(q, ['utánvét', 'utanvet', 'utánvéttel', 'utanvettel'])) {
    return {
      source: 'admin-intent',
      ruleId: 'cash_on_delivery',
      intent: 'cash_on_delivery',
      answer: 'Utánvétes fizetést a pénztárban tudsz választani, ha az adott szállítási módnál elérhető.',
      confidence: 100,
      links: [],
      suggestions: []
    };
  }

  if (includesAny(q, ['hol tart a rendelésem', 'hol tart a rendelesem', 'rendelésem állapota', 'rendelesem allapota', 'csomagom hol jár', 'csomagom hol jar'])) {
    return {
      source: 'admin-intent',
      ruleId: 'order_status',
      intent: 'order_status',
      answer: 'A rendelés állapotának ellenőrzéséhez szükség lesz a rendelési számodra vagy a rendeléskor megadott névre és e-mail-címre. Ezekkel keresd az ügyfélszolgálatot.',
      confidence: 100,
      links: [],
      suggestions: []
    };
  }

  if (includesAny(q, ['kuponkód', 'kuponkod', 'kedvezménykód', 'kedvezmenykod'])) {
    return {
      source: 'admin-intent',
      ruleId: 'coupon',
      intent: 'coupon',
      answer: 'A kuponkódhoz fel kell iratkozni a hírlevélre, majd az e-mailben érkező megerősítést elvégezni. Ezután a rendszer elküldi a kódot.',
      confidence: 100,
      links: [],
      suggestions: []
    };
  }

  if (q === 'szallitas' || includesAny(q, ['szállítás érdekelne', 'szallitas erdekelne', 'szállítással kapcsolatban', 'szallitassal kapcsolatban', 'szállításról kérdeznék', 'szallitasrol kerdeznek'])) {
    return {
      source: 'admin-intent',
      ruleId: 'shipping_general',
      intent: 'shipping_general',
      answer: 'Segítek a szállítással kapcsolatban. Válaszd ki, mire vagy kíváncsi:',
      confidence: 100,
      links: [],
      suggestions: [
        { label: 'Szállítási idő', question: 'Mennyi a szállítási idő?' },
        { label: 'Szállítási díj', question: 'Mennyibe kerül a szállítás?' },
        { label: 'Utánvét', question: 'Lehet utánvéttel fizetni?' },
        { label: 'Rendelésem állapota', question: 'Hol tart a rendelésem?' }
      ]
    };
  }

  return null;
}

module.exports = { resolveAdministrativeIntent };
