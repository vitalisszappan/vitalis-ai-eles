'use strict';

const { normalize } = require('./normalizer.cjs');

const SAFETY_PATTERN = /\b(orvos|orvosi|bőrgyógy|gyermekorvos|sürgős|nem gyógyszer|nem helyettesít|nyílt|vérző|gyulladt|erős fájdalom|mellkasi|nehézlégzés)\w*/i;
const BANNED_REPLACEMENTS = [
  [/kozmetikai ápolására (?:elsősorban )?javaslom/gi, 'mindennapi ápolására ezt választanám'],
  [/kozmetikai ápolásra/gi, 'mindennapi bőrápolásra'],
  [/a rendszer ezt ajánlja/gi, 'erre ezt szoktuk ajánlani'],
  [/az ön kérdése/gi, 'amit leírtál'],
  [/elegendő információ hiányában/gi, 'ha még nem egyértelmű minden részlet'],
  [/a jelenlegi kínálatban nem találok/gi, 'a jelenlegi kínálatban most nincs'],
  [/ehhez nem találtam elég pontos, jóváhagyott vitalis-információt/gi, 'erről még nincs elég biztos Vitalis-információnk'],
  [/nem találtam/gi, 'most nincs biztos találat']
];

function clean(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function humanize(value = '') {
  let text = clean(value);
  for (const [pattern, replacement] of BANNED_REPLACEMENTS) text = text.replace(pattern, replacement);
  return text;
}

function splitSafety(text) {
  const sentences = humanize(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const safety = [];
  const body = [];
  for (const sentence of sentences.map(clean).filter(Boolean)) {
    (SAFETY_PATTERN.test(sentence) ? safety : body).push(sentence);
  }
  return { body: body.join(' '), safety: safety.join(' ') };
}

function introFor(decision) {
  const intros = {
    cracked_heel: 'A repedt sarok kellemetlen tud lenni, főleg amikor a bőr húzódik vagy járás közben érzékennyé válik.',
    dry_heel: 'A száraz, érdes sarok gyakori panasz, és rendszeres, kímélő ápolással sokat lehet javítani a bőr komfortján.',
    dry_skin: 'A száraz, húzódó bőrnek általában gyengéd tisztításra és következetes visszazsírozásra van szüksége.',
    eczema: 'Az ekcémára hajlamos bőr könnyen kiszárad és érzékennyé válik, ezért érdemes egyszerű, kímélő rutinnal kezdeni.',
    psoriasis: 'A pikkelysömörre hajlamos, hámló bőr mindennapi ápolásánál a kíméletesség és a rendszeresség a legfontosabb.',
    itchy_scalp: 'A viszkető, érzékeny fejbőr sok kellemetlenséget okozhat, ezért elsőként gyengéd tisztítást érdemes választani.',
    deodorant: 'Ha természetes megoldást keresel a kellemetlen testszag ellen, több alumíniummentes Vitalis dezodor közül választhatsz.',
    shower_gel: 'Ha természetes tusfürdőt keresel, több illat és hangulat közül is választhatsz a jelenlegi kínálatban.',
    sunscreen: 'Jó, hogy rákérdeztél a fényvédelemre, mert ez a mindennapi bőrápolás egyik legfontosabb része.',
    commerce: 'Szívesen segítek, hogy a vásárlás következő lépése egyszerű és átlátható legyen.',
    conversation: 'Értem, nézzük meg röviden és egyértelműen, mire vonatkozott az előző válasz.'
  };
  return intros[decision.domain] || (decision.route === 'safety'
    ? 'Érthető, hogy szeretnél valami kézzelfogható segítséget erre a panaszra.'
    : decision.route === 'hard_fallback' || decision.route === 'clarification'
      ? 'Szívesen segítek, csak egy rövid pontosításra van szükség, hogy valóban hasznos választ adjak.'
      : 'Nézzük meg, melyik Vitalis megoldás illik legjobban ahhoz, amit keresel.');
}

function reasonFor(link, decision) {
  const name = normalize(link?.name || link?.title || '');
  const domain = decision.domain;
  if (domain === 'cracked_heel' || domain === 'dry_heel') return 'Gazdagabb, bőrpuhító ápolást ad a száraz, érdes és repedezésre hajlamos saroknak.';
  if (domain === 'eczema') return 'Kímélő ápolást ad a száraz, érzékeny és irritációra hajlamos bőrnek.';
  if (domain === 'psoriasis') return 'A száraz, hámlásra hajlamos bőr napi, gyengéd ápolásához állítottuk össze.';
  if (domain === 'itchy_scalp') return 'Gyengéden tisztít, miközben nem terheli feleslegesen az érzékeny, viszkető fejbőrt.';
  if (domain === 'deodorant') return 'Alumíniummentes választás, amely a kellemetlen testszag kialakulása ellen segíthet.';
  if (domain === 'shower_gel') return 'Növényi alapú, mindennapi tisztálkodáshoz készült választás.';
  if (name.includes('sampon')) return 'A fejbőr és a haj kímélő, rendszeres tisztításához illik.';
  if (name.includes('szappan')) return 'Egyszerű, gyengéd tisztítási lépésként jól beilleszthető a napi rutinba.';
  if (name.includes('krem') || name.includes('balzsam') || name.includes('vaj')) return 'Táplálóbb ápolást ad, amikor a bőrnek több puhaságra és komfortérzetre van szüksége.';
  return humanize(link?.description) || 'Jól illeszkedik ahhoz a mindennapi ápolási célhoz, amit leírtál.';
}

function usageFor(links, decision) {
  const names = normalize(links.map((item) => item.name).join(' '));
  if (decision.domain === 'deodorant') return 'Használat: tiszta, száraz hónaljbőrre vigyél fel borsónyi mennyiséget, majd finoman dolgozd el, és hagyd felszívódni.';
  if (decision.domain === 'shower_gel') return 'Használat: nedves bőrön habosítsd fel, finoman mosd át vele a bőrt, majd alaposan öblítsd le.';
  if (names.includes('sampon')) return 'Használat: nedves hajon és fejbőrön finoman habosítsd fel, rövid ideig hagyd hatni, majd alaposan öblítsd le.';
  if (names.includes('szappan') && !/krem|balzsam|vaj/.test(names)) return 'Használat: nedves bőrön kézzel habosítsd fel, gyengéden tisztíts, majd alaposan öblítsd le és töröld szárazra a bőrt.';
  if (links.length) return 'Használat: tiszta, száraz bőrre először kis mennyiséget vigyél fel, finoman masszírozd be, és a bőr igénye szerint ismételd naponta.';
  return 'Ha megírod a pontos terméket és azt is, melyik bőrfelületre keresed, a használat lépéseit is személyre tudom szabni.';
}

function enrichLinks(links, decision) {
  return (Array.isArray(links) ? links : []).slice(0, 3).map((link, index) => ({
    ...link,
    recommendationType: index === 0 ? 'primary' : index === 1 ? 'secondary' : 'related',
    recommendationLabel: index === 0 ? 'Vitalis ajánlása' : index === 1 ? 'Alternatíva' : 'Kapcsolódó termék',
    reason: reasonFor(link, decision)
  }));
}

function wordCount(value) {
  return clean(value).split(/\s+/).filter(Boolean).length;
}

function truncateWords(text, maximum) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  if (words.length <= maximum) return clean(text);
  return `${words.slice(0, maximum).join(' ').replace(/[,;:]$/, '')}.`;
}

function responseRange(decision) {
  if (decision.route === 'meta') return { minimum: 0, maximum: 180 };
  if (decision.route === 'commerce' || decision.route === 'product_category') return { minimum: 30, maximum: 80 };
  if (decision.route === 'safety') return { minimum: 30, maximum: 130 };
  if (decision.route === 'clarification' || decision.route === 'hard_fallback') return { minimum: 30, maximum: 80 };
  if (decision.goal === 'ask_usage' || decision.goal === 'ask_child_usage' || decision.goal === 'ask_variant') {
    return { minimum: 40, maximum: 100 };
  }
  if (decision.goal === 'solve_problem' || decision.route === 'problem_domain' || decision.route === 'expert_rule') {
    return { minimum: 80, maximum: 150 };
  }
  return { minimum: 40, maximum: 100 };
}

function ensureMinimumWords(text, decision, minimum) {
  if (wordCount(text) >= minimum || decision.route === 'meta') return clean(text);
  const separated = splitSafety(text);
  const additions = decision.route === 'commerce'
    ? [
        'Az aktuális ár, készlet és szállítási feltétel szempontjából mindig a megnyitott webshopoldal adata az irányadó.'
      ]
    : decision.route === 'clarification' || decision.route === 'hard_fallback'
      ? [
          'Néhány szó a bőrtípusról, a testrészről vagy a kiválasztott termékről általában elég a folytatáshoz.'
        ]
      : [
          'Érdemes egyszerre csak egy új terméket bevezetni a rutinba, így könnyebb megfigyelni, hogyan érzi magát tőle a bőröd vagy a fejbőröd.',
          'Az első használat előtt kis bőrfelületen is kipróbálhatod, majd a tapasztalatod szerint fokozatosan beillesztheted a mindennapi ápolásba.'
        ];
  let body = separated.body;
  for (const addition of additions) {
    if (wordCount(`${body} ${separated.safety}`) >= minimum) break;
    body = `${body} ${addition}`;
  }
  return clean(`${body} ${separated.safety}`);
}

function limitWords(text, maximum) {
  if (wordCount(text) <= maximum) return clean(text);
  const separated = splitSafety(text);
  if (!separated.safety) return truncateWords(text, maximum);
  const safetyWords = wordCount(separated.safety);
  const bodyLimit = Math.max(1, maximum - safetyWords);
  return clean(`${truncateWords(separated.body, bodyLimit)} ${separated.safety}`);
}

function composeCommerce(decision, draft, links) {
  const detail = humanize(draft.answer);
  const context = links.length
    ? `A kiválasztott termék kártyáján közvetlenül eléred a termékoldalt, ahol az aktuális árat, kiszerelést és rendelhetőséget is ellenőrizheted.`
    : 'Ha már tudod, melyik terméket szeretnéd, írd meg a nevét. Így közvetlenül a megfelelő termékoldalhoz tudlak irányítani, és nem kell a teljes kínálatban keresgélned.';
  return `${introFor({ ...decision, domain: 'commerce' })} ${detail} ${context} A kosárba helyezés után a pénztárban látod a választható szállítási és fizetési módokat, valamint a rendelés végleges összegeit. Árat vagy készletet csak az aktuális webshopadat alapján érdemes biztosnak venni. Ha elakadnál a következő lépésnél, írd meg röviden, hogy termékválasztásban, fizetésben vagy szállításban kéred a segítséget.`;
}

function composeCategory(decision, draft, links) {
  if (decision.intent === 'catalog_category_absent') {
    return `${introFor(decision)} A jelenlegi Vitalis kínálatban most nincs ilyen termék, ezért nem szeretnék helyette olyat ajánlani, amely nem ugyanazt a célt szolgálja. Fényvédő esetén különösen fontos, hogy igazolt SPF-értékű, a bőrtípusodnak megfelelő készítményt válassz. Érdemes széles spektrumú UVA- és UVB-védelmet keresni, és a csomagoláson szereplő mennyiségben, rendszeresen újrakenni. Ha más Vitalis bőrápolót keresel napozás utáni, száraz vagy érzékeny bőrre, írd meg ezt külön, és csak a jelenlegi kínálatból mutatok megfelelő lehetőséget.`;
  }
  const primary = links[0];
  const alternatives = links.slice(1).map((item) => item.name).join(', ');
  return `${introFor(decision)} Elsőként a ${primary?.name || 'kiemelt terméket'} érdemes megnézni. Azért ezt emelem ki, mert ${reasonFor(primary, decision).replace(/^./, (letter) => letter.toLowerCase())} ${usageFor(links, decision)}${alternatives ? ` Alternatívaként ezeket is megnézheted: ${alternatives}.` : ''} A kártyákon közvetlenül eléred a termékoldalakat.`;
}

function composeRichAnswer(decision, draft, links, history) {
  const previous = normalize((history || []).filter((item) => item?.role === 'assistant').map((item) => item.content || '').join(' '));
  const primaryName = links[0]?.name || '';
  const alreadyRecommended = primaryName && previous.includes(normalize(primaryName));
  const parts = splitSafety(draft.answer);
  const intro = alreadyRecommended
    ? 'Maradjunk az előzőleg kiválasztott terméknél, de most a gyakorlati használatra és a választás okára koncentráljunk.'
    : introFor(decision);
  const explanation = alreadyRecommended
    ? 'Korábban már átbeszéltük, miért illik ez a választás a leírt problémához, ezért most nem ismétlem meg ugyanazt a bemutatást.'
    : parts.body || (parts.safety
      ? 'Ilyenkor az a legfontosabb, hogy kíméld az érintett területet, és csak ép bőrön használj egyszerű, jól tolerálható ápolót.'
      : humanize(draft.answer));
  const why = links.length
    ? `Erre elsőként a ${primaryName} terméket ajánlom. Azért ezt, mert ${reasonFor(links[0], decision).replace(/^./, (letter) => letter.toLowerCase())}`
    : 'Erre akkor lehet igazán jó választ adni, ha a bőrfelületet, a panasz jellegét és a használni kívánt terméket is pontosan ismerjük.';
  const alternatives = links.length > 1
    ? `Ha más állagot vagy kiegészítő lépést szeretnél, alternatívaként a ${links[1].name}${links[2] ? `, kapcsolódó termékként pedig a ${links[2].name}` : ''} is megnézhető.`
    : '';
  const safety = parts.safety || (decision.safetyClass === 'caution_with_boundary'
    ? 'Fontos: ez bőrápolási segítség, nem kezeli a panasz egészségügyi okát. Erősödő vagy tartós tünetnél kérj orvosi tanácsot.'
    : '');
  const linkHelp = links.length ? 'A termékkártyán eléred a részletes termékoldalt, ahol a kiszerelést és az aktuális webshopadatokat is ellenőrizheted.' : '';
  return {
    text: `${intro} ${explanation} ${why} ${alternatives} ${usageFor(links, decision)} ${linkHelp} ${safety}`,
    alreadyRecommended
  };
}

function composeCommunication({ decision, draft, question = '', history = [] }) {
  if (!draft || !decision) return draft;
  const links = enrichLinks(draft.links, decision);
  let answer;
  let repeatedRecommendation = false;

  if (decision.route === 'meta') {
    answer = humanize(draft.answer);
  } else if (decision.route === 'commerce') {
    answer = composeCommerce(decision, draft, links);
  } else if (decision.route === 'product_category') {
    answer = composeCategory(decision, draft, links);
  } else if (decision.route === 'clarification' || decision.route === 'hard_fallback') {
    answer = `${introFor(decision)} ${humanize(draft.answer)} Írd meg a termék nevét, a problémás bőrfelületet vagy azt, hogy vásárlásról, használatról, árról vagy szállításról kérdezel. Így nem kell felesleges kérdéskörökön végigmennünk, és rögtön arra tudok válaszolni, ami neked fontos. Ha egy korábbi ajánlásra utalsz, olyan rövid megfogalmazás is elég, mint „az első”, „a krém” vagy „hogyan használjam?”.`;
  } else {
    const rich = composeRichAnswer(decision, draft, links, history);
    answer = rich.text;
    repeatedRecommendation = rich.alreadyRecommended;
  }

  const range = responseRange(decision);
  answer = ensureMinimumWords(answer, decision, range.minimum);
  answer = limitWords(answer, range.maximum);
  return {
    ...draft,
    answer,
    links,
    communication: {
      engine: 'vitalis-communication/v1',
      wordCount: wordCount(answer),
      minimumWords: range.minimum,
      maximumWords: range.maximum,
      repeatedRecommendation,
      questionUsed: Boolean(clean(question))
    }
  };
}

module.exports = { composeCommunication, enrichLinks, humanize, responseRange, wordCount };
