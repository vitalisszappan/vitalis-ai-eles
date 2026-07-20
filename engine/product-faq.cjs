const PRODUCT_FAQ = {
  dermavital_krem: {
    child: 'A Dermavital krém gyermekek bőrének kozmetikai ápolására is használható lehet. Első alkalommal kis bőrfelületen próbáld ki, és irritáció esetén ne használd tovább. Csecsemőnél, kiterjedt vagy gyulladt bőrtünetnél érdemes gyermekorvossal vagy bőrgyógyásszal egyeztetni.'
  },
  dermavital_szappan: {
    child: 'A Dermavital szappan gyermekeknél is használható kímélő tisztálkodásra. Első alkalommal kis bőrfelületen próbáld ki, kerüld a szembe jutást, és irritáció esetén hagyd abba a használatát.'
  },
  dermavital_sampon: {
    child: 'A Dermavital sampon gyermekeknél is használható lehet problémás fejbőr kímélő tisztítására. Kerüld a szembe jutást, első alkalommal kis mennyiséggel próbáld ki, és tartós vagy erős panasz esetén kérj gyermekorvosi vagy bőrgyógyászati tanácsot.'
  },
  aktiv_szenes_szappan: {
    child: 'Az Aktív szenes szappant gyermekek érzékeny bőrén nem ezt választanám elsőként. Ha pattanásos bőr miatt merült fel, először kis felületen próbáld ki, és ha szárít vagy irritál, ne használd tovább.'
  },
  shea_vajas_szappan: {
    child: 'A Shea vajas szappan gyermekeknél is használható lehet kímélő tisztálkodásra. Első alkalommal kis bőrfelületen próbáld ki, és irritáció esetén hagyd abba a használatát.'
  },
  psorivital_csomag: {
    child: 'Gyermeknél a PsoriVital csomag használatáról életkor és a bőrtünetek ismerete nélkül nem adnék általános igen választ. Írd meg, hány éves gyermekről van szó, és melyik testrészen jelentkezik a panasz.'
  },
  rozmaringos_samponszappan: {
    child: 'Gyermeknél a rozmaringos samponszappant csak körültekintően javasolnám. Írd meg a gyermek életkorát és a fejbőrpanaszt, hogy pontosabban tudjak segíteni.'
  }
};

const PRODUCT_ALIASES = [
  ['dermavital_krem', [
    'dermavital nyugtato borapolo krem',
    'dermavital nyugtato krem',
    'dermavital krem',
    'dermavital balzsam'
  ]],
  ['dermavital_szappan', ['dermavital szappan']],
  ['dermavital_sampon', ['dermavital sampon']],
  ['aktiv_szenes_szappan', ['aktiv szenes szappan']],
  ['shea_vajas_szappan', ['shea vajas szappan']],
  ['psorivital_csomag', ['psorivital csomag', 'psorivital']],
  ['holt_tengeri_so_balzsam', ['holt tengeri so balzsam', 'holt tengeri balzsam']],
  ['holt_tengeri_iszapos_szappan', [
    'holt tengeri iszapos szappan',
    'holt tengeri iszap szappan',
    'iszapos szappan',
    'iszap szappan'
  ]],
  ['katrany_szappan', [
    'gyogyaszati katrany szappan',
    'gyogyaszati katranyszappan',
    'katrany szappan',
    'katranyszappan'
  ]],
  ['rozmaringos_samponszappan', ['rozmaringos samponszappan']]
];

function findProductsInText(normalizedText) {
  normalizedText = String(normalizedText || '').replace(/-/g, ' ');
  const matches = [];

  for (const [id, aliases] of PRODUCT_ALIASES) {
    let index = Number.POSITIVE_INFINITY;

    for (const alias of aliases) {
      const found = normalizedText.indexOf(alias);
      if (found >= 0 && found < index) index = found;
    }

    if (Number.isFinite(index)) matches.push({ id, index });
  }

  return matches
    .sort((a, b) => a.index - b.index)
    .map((match) => match.id);
}

function findProductInText(normalizedText, preferFirst = true) {
  normalizedText = String(normalizedText || '').replace(/-/g, ' ');
  let best = null;
  let bestIndex = preferFirst ? Number.POSITIVE_INFINITY : -1;
  for (const [id, aliases] of PRODUCT_ALIASES) {
    for (const alias of aliases) {
      const index = preferFirst ? normalizedText.indexOf(alias) : normalizedText.lastIndexOf(alias);
      if (index < 0) continue;
      if ((preferFirst && index < bestIndex) || (!preferFirst && index > bestIndex)) {
        best = id;
        bestIndex = index;
      }
    }
  }
  return best;
}

function findRecentProductFromHistory(history, normalize) {
  // A felhasználó konkrét termékmegnevezése mindig elsőbbséget élvez.
  for (const message of [...history].reverse()) {
    if (!message || message.role !== 'user') continue;
    const found = findProductInText(normalize(message.content || ''), false);
    if (found) return found;
  }
  // Ha a kérdés csak visszautal, az utolsó asszisztensi ajánlás első (elsődleges) termékét használjuk.
  for (const message of [...history].reverse()) {
    if (!message || message.role !== 'assistant') continue;
    const found = findProductInText(normalize(message.content || ''), true);
    if (found) return found;
  }
  return null;
}

function childAnswer(productId) {
  return PRODUCT_FAQ[productId]?.child || null;
}

module.exports = { PRODUCT_FAQ, PRODUCT_ALIASES, findProductInText, findProductsInText, findRecentProductFromHistory, childAnswer };
