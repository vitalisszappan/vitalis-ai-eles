'use strict';

const fs = require('fs');
const path = require('path');
const { resolveUnasCatalogSnapshotPath } = require('./unas-catalog-path.cjs');

const ROOT = path.join(__dirname, '..');
const DEFAULT_MAPPING_PATH = path.join(ROOT, 'data', 'canonical-unas-mapping.json');
const DEFAULT_SNAPSHOT_PATH = resolveUnasCatalogSnapshotPath();
const DEFAULT_APPROVED_FACTS_PATH = path.join(ROOT, 'data', 'approved-product-facts.json');

const SOURCE_PRIORITY = Object.freeze({
  approved_mapping: 400,
  unas_snapshot: 300,
  deterministic_product: 200,
  approved_knowledge: 150,
  base_knowledge: 100,
  owner_approved: 500
});

const INGREDIENT_ALIASES = Object.freeze({
  urea: 'urea',
  karbamid: 'urea',
  carbamide: 'urea',
  rozmaring: 'rosmarinus officinalis leaf oil',
  rozmaringolaj: 'rosmarinus officinalis leaf oil'
});

const FACT_TYPES = Object.freeze([
  'name', 'price', 'currency', 'url', 'image', 'ingredients', 'inci',
  'keyIngredients', 'ingredientBenefits', 'usageInstructions',
  'recommendedFor', 'productDescription', 'productBenefits', 'approvedClaims', 'warnings'
]);

function clean(value) { return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''; }
function fold(value) { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function normalizeIngredient(value) {
  const normalized = fold(value).replace(/\([^)]*\)/g, '').replace(/[^a-z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim();
  return INGREDIENT_ALIASES[normalized] || normalized || null;
}
function readJson(filePath) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; } }
function validUrl(value) { try { const url = new URL(clean(value)); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; } }
function provenance(sourceType, sourceId, productId, sourceUpdatedAt = null) {
  return { sourceType, sourceId, productId, groundingStatus: 'grounded', approved: true, sourceUpdatedAt };
}
function unavailable(productId, conflicts = []) {
  return { status: conflicts.length ? 'conflicted' : 'unavailable', value: null, productId, provenance: [], conflicts };
}
function grounded(productId, value, evidence) {
  return { status: 'grounded', value, productId, provenance: [evidence], conflicts: [] };
}
function imageUrl(product) { return validUrl(typeof product?.image === 'string' ? product.image : product?.image?.url) || validUrl(product?.image?.sefUrl); }

const HEADINGS = /(?:Kinek aj[aá]nljuk\?|Mire aj[aá]nljuk\?|Mi[eé]rt v[aá]laszd|Haszn[aá]lat(?:a)?|Hogyan haszn[aá]ld\??|Fontos tudnival[oó]k|Mire figyelj\?|Csomagol[aá]s|Gyakori k[eé]rd[eé]sek|[ÖO]sszetev[őo]k|INGREDIENTS\s*\(INCI\)|INCI)(?![A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű])\s*:?|(?<=[.!?])\s+A\s+[A-ZÁÉÍÓÖŐÚÜŰ][A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű0-9 -]{0,80}\s+term[eé]kcsal[aá]d(?=\s+[A-ZÁÉÍÓÖŐÚÜŰ])/gi;
function section(text, labels) {
  const source = String(text || '');
  const matches = [...source.matchAll(HEADINGS)];
  // Labels are ordered from most explicit to least explicit. This prevents a
  // prose phrase such as "rendszeres használat mellett" from outranking the
  // later, explicit "Hogyan használd?" source heading.
  const wanted = labels.map((label) => matches.find((match) => {
    if (!label.test(fold(match[0]))) return false;
    const continuation = fold(source.slice(match.index + match[0].length)).split(' ')[0];
    return !/^hasznalat/.test(fold(match[0])) || !['mellett', 'soran', 'kozben', 'utan', 'elott'].includes(continuation);
  })).find(Boolean);
  if (!wanted) return '';
  const next = matches.find((match) => match.index > wanted.index);
  return clean(source.slice(wanted.index + wanted[0].length, next?.index ?? source.length));
}

function recommendedForSection(text) {
  const value = section(text, [/^kinek ajanljuk/, /^mire ajanljuk/]);
  if (!value) return extendedRecommendedForSection(text);
  const sentences = value.split(/(?<=[.!?])\s+/);
  const metaIndex = sentences.findIndex((sentence) => /^(?:nem\s+(?:szeretnenk|akarunk)\s+csodat\s+igerni|azt\s+viszont\s+tudjuk\b|(?:nagyon\s+sok\s+)?(?:visszatero\s+)?vasarlonk\s+szamolt\s+be\b)/.test(fold(sentence)));
  return clean(sentences.slice(0, metaIndex < 0 ? sentences.length : metaIndex).join(' '));
}

const EXTENDED_RECOMMENDED_HEADING = /(?:Kinek aj[aá]nljuk\s+[^?]{1,80}\?|Kinek aj[aá]nlott\?|(?:A|Az)\s+[A-ZÁÉÍÓÖŐÚÜŰ][^.!?]{1,100}\s+azoknak\s+aj[aá]nlott,?\s+akik\s*:)/i;
const EXTENDED_RECOMMENDED_BOUNDARY = /(?:Mi[eé]rt j[oó] v[aá]laszt[aá]s[^?]{0,80}\?|Haszn[aá]lati\s+(?:[uú]tmutat[oó]|javaslat|utas[ií]t[aá]s)|Hogyan haszn[aá]ld[^?]{0,80}\?|Fontos tudnival[oó]k|[ÖO]sszetev[őo]k(?:\s*\(INCI\))?\s*:|Ingredients\s*:|\bINCI\s*:|Sokan v[aá]lasztj[aá]k\b|V[aá]s[aá]rl[oó](?:ink|i visszajelz[eé]sek)\b|Nem helyettes[ií]ti\b|Mer[uü]lj el\b|Engedd meg\b|Tapasztald meg\b|Fontos\s*:)/i;
const UNSAFE_RECOMMENDED = /\b(?:gyogyit|meggyogyit|kezeli|kezeles|fajdalomcsillapito|gyulladascsokkento|keringes\s+(?:helyreallitas|javitas)|visszer|verzescsillapito)\w*\b/;
const SUITABILITY_SEMANTICS = /\b(?:annak|azoknak|akik|szeretn|keres|kedvel|borre|bortipusra|hajra|hajtipusra|ferfi|nok|gyermek|csalad|mindennapi\s+(?:bor|haj|ajak)apolas)\w*\b/;

function extendedRecommendedForSection(text) {
  const source = String(text || '');
  const heading = EXTENDED_RECOMMENDED_HEADING.exec(source);
  if (heading) {
    const tail = source.slice(heading.index + heading[0].length);
    const boundary = EXTENDED_RECOMMENDED_BOUNDARY.exec(tail);
    const candidate = clean(tail.slice(0, boundary?.index ?? tail.length));
    const normalized = fold(candidate);
    if (candidate.length >= 20 && candidate.length <= 1000
      && SUITABILITY_SEMANTICS.test(normalized) && !UNSAFE_RECOMMENDED.test(normalized)) return candidate;
  }
  return clean(source.split(/(?<=[.!?])\s+/).find((sentence) => {
    const normalized = fold(sentence);
    return sentence.length >= 30 && sentence.length <= 250
      && /\balkalmas\s+(?:minden|valamennyi|normal|szaraz|zsiros|erzekeny)[^.!?]{0,80}\b(?:bor|haj)tipusra\b/.test(normalized)
      && !UNSAFE_RECOMMENDED.test(normalized);
  }) || '');
}

function scanFold(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const FALSE_USAGE_CONTINUATIONS = /^(?:mellett|soran|kozben|utan|elott)\b/;
const USAGE_START = /\b(?:hogyan\s+hasznald(?:\s+[^.!?]{1,80})?\?|hogyan\s+hasznald\b|hasznalati\s+(?:javaslat|utasitas|utmutato|tanacs)\s*[:.-]?\s*|mire\s+figyelj\s+hasznalatakor\s*\?\s*|hasznalat\s*:?\s*)/g;
const USAGE_BOUNDARIES = [
  /\b(?:ingredients\s*(?:\(inci\))?|inci(?:\/osszetevok)?|osszetevok(?:\s*\(inci\))?)\b\s*:?/g,
  /\b(?:miert|milyen|mitol|mit|mire|kinek|hogyan)\s+[^.!?]{1,120}\?/g,
  /\b(?:fontos\s+tudnivalok?|mire\s+figyelj|csomagolas|gyakori\s+kerdesek(?:\s+[^.!?]{0,80})?|tipp)\b/g,
  /\bosszetetel\b\s*:?/g,
  /(?:^|[.!?]\s+)(?:a|az)\s+[a-z0-9 -]{1,60}\s+termekcsalad\b/g,
  /(?:^|[.!?]\s+)(?:fedezd\s+fel|tovabbi|tudj(?:on)?\s+meg|olvasd\s+el|nem\s+tudod)\b/g,
  /(?:^|[.!?]\s+)(?!(?:kezdd?|mosd|vidd|oszlasd|masszirozd|hagyd|oblitsd)\b)[a-z][a-z0-9 -]{1,80}:\s+/g,
  /(?:^|[.!?]\s+)huvos\s+helyen\s+tarold\b/g
];

const USAGE_ACTION = /\b(?:alkalmaz|csepegtess|dolgoz|dorzsol|hagy|habosits|hasznal|helyez|ken|massziroz|mos|nedvesit|oblit|oszlat|tedd|tegy|vidd)\w*\b/;

function firstUsageBoundary(foldedTail) {
  let first = null;
  for (const pattern of USAGE_BOUNDARIES) {
    pattern.lastIndex = 0;
    const match = pattern.exec(foldedTail);
    if (!match) continue;
    const leading = /^(?:[.!?]\s+)/.exec(match[0]);
    const index = match.index + (leading?.[0].length || 0);
    if (first === null || index < first) first = index;
  }
  return first;
}

function usageSection(text) {
  const source = String(text || '');
  const folded = scanFold(source);
  USAGE_START.lastIndex = 0;
  const starts = [];
  for (const match of folded.matchAll(USAGE_START)) {
    const heading = match[0].trim().replace(/\s*:\s*$/, '');
    const bodyStart = match.index + match[0].length;
    const continuation = scanFold(source.slice(bodyStart)).trimStart().match(/^[^\s.,;:!?]+/)?.[0] || '';
    if (heading === 'hasznalat' && FALSE_USAGE_CONTINUATIONS.test(continuation)) continue;
    if (heading === 'hasznalat' && !/^\s*[A-ZÁÉÍÓÖŐÚÜŰ]/u.test(source.slice(bodyStart))) continue;
    starts.push({ bodyStart, priority: heading.startsWith('hogyan hasznald') ? 3 : heading.startsWith('hasznalati ') ? 2 : 1 });
  }
  for (const candidate of starts.sort((left, right) => right.priority - left.priority || left.bodyStart - right.bodyStart)) {
    const tail = source.slice(candidate.bodyStart);
    const boundary = firstUsageBoundary(scanFold(tail));
    let value = clean(tail.slice(0, boundary ?? tail.length));
    if (value.length > 1200) {
      const actionable = [];
      for (const sentence of value.split(/(?<=[.!?])\s+/).map(clean).filter(Boolean)) {
        if (!USAGE_ACTION.test(scanFold(sentence))) break;
        actionable.push(sentence);
      }
      value = clean(actionable.join(' '));
    }
    if (!value || value.length < 12 || value.length > 1200) continue;
    if (FALSE_USAGE_CONTINUATIONS.test(scanFold(value).replace(/^[\s.,;:!?-]+/, ''))) continue;
    if (firstUsageBoundary(scanFold(value)) !== null) continue;
    if (!USAGE_ACTION.test(scanFold(value))) continue;
    return value;
  }
  return '';
}
function splitList(value) {
  return clean(value).split(/\s*(?:,|;|\n|\r|\u2022|\*)\s*/).map(clean).filter(Boolean);
}
const TYPED_INGREDIENT_HEADING = /(?:INGREDIENTS\s*\(INCI\)|[ÖO]sszetev[őo]k\s*\(INCI\)|INCI\s*\/\s*[ÖO]sszetev[őo]k|INCI|Ingredients|[ÖO]sszetev[őo]k)\s*:\s*/gi;
const INGREDIENT_SECTION_BOUNDARIES = [
  /\b(?:kinek\s+ajanljuk|mire\s+ajanljuk|hasznalati\s+(?:javaslat|utasitas)|hasznalat|hogyan\s+hasznald|fontos\s+tudnivalok?|mire\s+figyelj|csomagolas|gyakori\s+kerdesek)\b/g,
  /\b(?:miert|milyen|mitol|mit|mire|kinek|hogyan)\s+[^.!?]{1,120}\?/g,
  /(?:^|[.!?]\s+)(?:a|az)\s+[a-z0-9 -]{1,60}\s+termekcsalad\b/g,
  /(?:^|[.!?]\s+)(?:fedezd\s+fel|tovabbi|tudj(?:on)?\s+meg|olvasd\s+el|nem\s+tudod)\b/g,
  /\s+(?:\(\s*)?\*{1,2}\s*(?::\s*|(?=(?:szappanosodas|az\s+illoolaj|a\s+levendula)))/g
];

function typedIngredientHeadingType(heading) {
  const value = fold(heading);
  return value === 'osszetevok:' ? 'plain_ingredients' : 'formal_inci';
}

function firstIngredientSectionBoundary(text) {
  const folded = scanFold(text);
  let first = null;
  for (const pattern of INGREDIENT_SECTION_BOUNDARIES) {
    pattern.lastIndex = 0;
    const match = pattern.exec(folded);
    if (!match) continue;
    const leading = /^(?:[.!?]\s+)/.exec(match[0]);
    const index = match.index + (leading?.[0].length || 0);
    if (first === null || index < first) first = index;
  }
  return first;
}

function ingredientSectionCandidates(text) {
  const source = String(text || '');
  TYPED_INGREDIENT_HEADING.lastIndex = 0;
  const starts = [...source.matchAll(TYPED_INGREDIENT_HEADING)].map((match) => ({
    index: match.index,
    bodyStart: match.index + match[0].length,
    type: typedIngredientHeadingType(match[0])
  }));
  return starts.map((candidate, index) => {
    const nextStart = starts[index + 1]?.index ?? source.length;
    const tail = source.slice(candidate.bodyStart, nextStart);
    const boundary = firstIngredientSectionBoundary(tail);
    return { ...candidate, value: clean(tail.slice(0, boundary ?? tail.length)) };
  });
}

function cleanTypedIngredientItem(item) {
  return clean(item).replace(/\*+$/g, '').replace(/\.$/, '').trim();
}

function splitTypedIngredientList(value) {
  return clean(value).split(/\s*(?:,|;|\n|\r|\u2022)\s*/).map(cleanTypedIngredientItem).filter(Boolean);
}

function validCommonIngredientItem(item) {
  const normalized = fold(item);
  return item.length >= 2 && item.length <= 180
    && /^[\p{L}\p{N}]/u.test(item)
    && !/[?:]/.test(item)
    && !/\*|\b(?:inci|ingredients|osszetevok|fedezd|tovabbi|olvasd|marketing)\b/.test(normalized);
}

function validateFormalInci(value) {
  if (!value || value.length > 4000 || /[?]|\*{1,2}\s*:/.test(value)) return [];
  const items = splitTypedIngredientList(value);
  if (items.length < 2 || items.some((item) => !validCommonIngredientItem(item))) return [];
  return items;
}

function validatePlainIngredients(value) {
  if (!value || value.length > 4000 || /[?]|\*{1,2}\s*:/.test(value)) return [];
  const items = splitTypedIngredientList(value);
  if (items.length < 2 || items.some((item) => !validCommonIngredientItem(item)
    || fold(item) === 'szappanositott' || fold(item).split(' ').length > 14)) return [];
  return items;
}

function typedIngredientBlocks(text) {
  const candidates = ingredientSectionCandidates(text);
  const formal = candidates.filter((item) => item.type === 'formal_inci');
  const plain = candidates.filter((item) => item.type === 'plain_ingredients');
  return {
    inci: formal.length === 1 ? validateFormalInci(formal[0].value) : [],
    ingredients: plain.length === 1 ? validatePlainIngredients(plain[0].value) : []
  };
}
function explicitBenefits(text, ingredients) {
  const source = String(text || '');
  const result = [];
  const ingredientIds = new Set(ingredients.map((item) => item.ingredientId));
  const pattern = /(?:^|[.\n]\s*)([A-ZÁÉÍÓÖŐÚÜŰ][A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű -]{1,80}(?:\s*\([^)]{1,80}\))?)\s*[–—-]\s*([^\n.]+\.)/g;
  for (const match of source.matchAll(pattern)) {
    const ingredientId = normalizeIngredient(match[1]);
    if (ingredientId && ingredientIds.has(ingredientId) && clean(match[2])) result.push({ ingredientId, ingredientName: clean(match[1]), benefit: clean(match[2]) });
  }
  return result;
}
function uniqueByJson(items) { const seen = new Set(); return items.filter((item) => { const key = JSON.stringify(item); if (seen.has(key)) return false; seen.add(key); return true; }); }

const DESCRIPTION_SECTION_BOUNDARY = /\b(?:hogyan\s+hasznald|hasznalati\s+(?:javaslat|utasitas)|hasznalat\s*:|ingredients\s*(?:\(inci\))?|inci(?:\/osszetevok)?|osszetevok(?:\s*\(inci\))?|fontos\s+tudnivalok?|mire\s+figyelj|gyakori\s+kerdesek|csomagolas|fedezd\s+fel|tovabbi|olvasd\s+el|rendeld\s+meg|vasarold\s+meg|iratkozz\s+fel)\b/g;
const DESCRIPTION_STRONG_CLAIMS = /\b(?:gyogyaszati|gyogyit\w*|meggyogy\w*|kezeles(?:e|re|et)?|fertotlen\w*|antibakterialis|gyulladas(?:t|ok?at)?\s+csokkent\w*|csokkenti\s+a\s+gyullad\w*|serkenti\s+a\s+hajnovekedest|hajnovekedest\s+serkent\w*|megszuntet\w*|tunetek?\s+(?:enyhul\w*|megszun\w*)|gyogyszerkent|fantasztikus\s+hatas|jotekony\s+hatas|hatekony\s+apolas|egyedulallo|kiveteles\s+valasztas|megelozo|vitalizalo|vedelem\s+erdekeben|valasztasunk)\b|100\s*%/;
const DESCRIPTION_PRODUCT_TERMS = /\b(?:termek|keszitmeny|kozmetikum|sampon|samponszappan|szappan|krem|balzsam|csomag|sotomb|rendszer|formula)\w*\b/;
const DESCRIPTION_PURPOSE_TERMS = /\b(?:keszult|fejlesztett|apolas|apolasara|tisztitas|tisztitasara|tisztit|borapolo|hajapolo|mindennapi|kimeletes|erzekeny|szaraz|zsiros|hajra|fejborre|borre|komforterzet)\w*/;

const EXTENDED_DESCRIPTION_PRODUCT_TERMS = /\b(?:tusfurdo|testapolo|habkrem|ajakbalzsam|fogkrem|fogfeherito\s+por|hajkondicionalo\s+pakolas|keztiszt(?:it)?o\s+gel)\w*\b/;
const EXTENDED_DESCRIPTION_PURPOSE_TERMS = /\b(?:keszult|apolas|apol|tisztit|tisztasag|mindennapi|kimeletes|hidratal|puhit|frissit|kenheto|borre|hajra|ajak)\w*/;
const EXTENDED_DESCRIPTION_REJECT = /\b(?:fedezd\s+fel|kenyeztesd|szerezd\s+be|verhetetlen\s+ar|torzsvasarloi\s+ar|hatoanyagok|felhasznalasi\s+terulet|mire\s+hasznalhatod|jotekony\s+hatas|vasarloi\s+visszajelzes|vasarloink|gyogyit|kezeles|fertotlen|antibakterialis|gyulladascsokkento|csodaszer|garantaltan)\b/;

function descriptionSentences(value) {
  return clean(value).split(/(?<=[.!?])\s+/).map(clean).filter(Boolean);
}

function hasDescriptionMeaning(value) {
  const normalized = fold(value);
  return DESCRIPTION_PRODUCT_TERMS.test(normalized) && DESCRIPTION_PURPOSE_TERMS.test(normalized);
}

function isSafeDescriptionCandidate(value) {
  const text = clean(value);
  const normalized = fold(text);
  DESCRIPTION_SECTION_BOUNDARY.lastIndex = 0;
  return text.length >= 70 && text.length <= 700
    && descriptionSentences(text).length <= 4
    && hasDescriptionMeaning(text)
    && !DESCRIPTION_STRONG_CLAIMS.test(normalized)
    && !DESCRIPTION_SECTION_BOUNDARY.test(normalized)
    && !/\b(?:habosits|tisztitsd|vidd\s+fel|oblitsd|hasznald|masszirozd|nedvesitsd|kenj)\w*\b/.test(normalized)
    && !/\bnem\s+(?:minosul|gyogyhatasu|gyogyszer)\w*\b/.test(normalized)
    && !/\b(?:vasarloi\s+visszajelzesek|reszletes\s+leirasert|termekcsalad\s+(?:harmadik|kovetkezo)\s+tagja|tartalma\s*:|vitalis\s+torzsvasarloi\s+ar)\b/.test(normalized)
    && !/\b(?:hasznalat|kiszereles|tomeg)\s*:/.test(normalized)
    && !/:\s/.test(text)
    && !/[?]/.test(text)
    && normalized.split(' ').length <= 55
    && !/\.pos\b|\?\w/.test(normalized);
}

function shortProductDescription(value) {
  const text = clean(value)
    .replace(/^(?:Vásárlói visszajelzések alapján kedvelt (?:termék|szappan)\s+)?(?:Természetes bőrápolás válogatott alapanyagokkal\s+)?(?:Magyar kézműves (?:kozmetikum|szappan)\s+)?/iu, '')
    .replace(/\s+(?:Tömeg|Kiszerelés)\s*:.*$/iu, '');
  return isSafeDescriptionCandidate(text) ? text : '';
}

function isSafeExtendedDescription(value) {
  const text = clean(value);
  const normalized = fold(text);
  const hasProductIdentity = EXTENDED_DESCRIPTION_PRODUCT_TERMS.test(normalized)
    || /^(?:a|az)\s+(?!felhasznalt\b)[^.!?]{0,30}\bolaj\b/.test(normalized);
  DESCRIPTION_SECTION_BOUNDARY.lastIndex = 0;
  return text.length >= 50 && text.length <= 500
    && descriptionSentences(text).length <= 3
    && hasProductIdentity
    && EXTENDED_DESCRIPTION_PURPOSE_TERMS.test(normalized)
    && !DESCRIPTION_STRONG_CLAIMS.test(normalized)
    && !EXTENDED_DESCRIPTION_REJECT.test(normalized)
    && !DESCRIPTION_SECTION_BOUNDARY.test(normalized)
    && !/\b(?:habosits|vidd\s+fel|oblitsd|hasznald|masszirozd|nedvesitsd|kend\s+fel|csepegtess)\w*\b/.test(normalized)
    && !/[?]/.test(text)
    && !/:\s/.test(text);
}

function extendedShortProductDescription(value) {
  const sentences = descriptionSentences(value);
  while (sentences.length && /^(?:vitalis\s+torzsvasarloi\s+ar|ar|kiszereles|tomeg|tartalma)\s*:/i.test(fold(sentences[0]))) sentences.shift();
  for (let length = 1; length <= Math.min(3, sentences.length); length += 1) {
    const candidate = clean(sentences.slice(0, length).join(' '));
    if (isSafeExtendedDescription(candidate)) return candidate;
  }
  return '';
}

function extendedLongProductDescription(value) {
  const sentences = descriptionSentences(clean(value).slice(0, 5000));
  return sentences.find((sentence) => isSafeExtendedDescription(sentence)) || '';
}

function withoutDescriptionHeadingPrefix(value) {
  const text = clean(value);
  const match = /^([^.!?]{5,70}?)\s+((?:A|Az|Ez|Ezt)\s+[A-ZÁÉÍÓÖŐÚÜŰ].*)$/u.exec(text);
  if (!match) return text;
  const heading = fold(match[1]);
  if (heading.split(' ').length > 8 || /\b(?:van|volt|lesz|keszult|fejlesztett|tisztitja|apolja|segit|tartalmaz)\w*\b/.test(heading)) return text;
  return clean(match[2]);
}

function boundedLongProductDescription(value) {
  const source = clean(value).slice(0, 5000);
  if (!source) return '';
  const normalized = scanFold(source);
  DESCRIPTION_SECTION_BOUNDARY.lastIndex = 0;
  const boundary = DESCRIPTION_SECTION_BOUNDARY.exec(normalized);
  const opening = clean(source.slice(0, boundary?.index ?? source.length));
  const sentences = descriptionSentences(opening).map((sentence) => withoutDescriptionHeadingPrefix(
    sentence.replace(/\s*:\s*(?:Milyen|Miért|Kinek|Hogyan)\b.*$/u, '')
  ));
  const candidates = sentences.filter((sentence) => !/\?$/.test(sentence) && hasDescriptionMeaning(sentence) && isSafeDescriptionCandidate(sentence));
  const score = (sentence) => {
    const normalizedSentence = fold(sentence);
    return (/^(?:a|az|ez|ezt)\s+[^.!?]{0,80}\b(?:termek|keszitmeny|sampon|samponszappan|szappan|krem|balzsam|csomag|sotomb)\b/.test(normalizedSentence) ? 6 : 0)
      + (/\b(?:keszult|fejlesztett|apolasara|tisztitasara|azert\s+hogy)\b/.test(normalizedSentence) ? 8 : 0)
      + (/\b(?:mindennapi|kimeletes|erzekeny|szaraz|zsiros|fejbor)\w*\b/.test(normalizedSentence) ? 3 : 0)
      - (/\b(?:nem|sem|hanem)\b/.test(normalizedSentence) ? 12 : 0)
      - (/\b(?:sokan|problema)\b/.test(normalizedSentence) ? 2 : 0);
  };
  if (candidates.length) return candidates.sort((left, right) => score(right) - score(left))[0];
  for (let index = 0; index < sentences.length - 1; index += 1) {
    const pair = `${sentences[index]} ${sentences[index + 1]}`;
    if (!/\?$/.test(sentences[index]) && isSafeDescriptionCandidate(pair)) return pair;
  }
  const purposeBlock = /\bmiert\s+valaszd\??\s+(.+?)(?=\bhogyan\s+hasznald\b|\bhasznalati\b|\bfontos\s+tudnival)/.exec(normalized)?.[1] || '';
  const originalPurposeBlock = purposeBlock ? opening.slice(normalized.indexOf(purposeBlock), normalized.indexOf(purposeBlock) + purposeBlock.length) : '';
  return isSafeDescriptionCandidate(originalPurposeBlock) ? clean(originalPurposeBlock) : '';
}

function authoritativeProductDescription(product) {
  return shortProductDescription(product?.shortDescription)
    || boundedLongProductDescription(product?.longDescription)
    || extendedShortProductDescription(product?.shortDescription)
    || extendedLongProductDescription(product?.longDescription)
    || '';
}

function createProductFactsResolver(options = {}) {
  const mappingData = options.mappingData ?? readJson(options.mappingPath || DEFAULT_MAPPING_PATH);
  const snapshotData = options.snapshotData ?? readJson(options.snapshotPath || DEFAULT_SNAPSHOT_PATH);
  const deterministicProducts = options.deterministicProducts || require('./product-catalog.cjs').PRODUCTS;
  const additionalFacts = Array.isArray(options.additionalFacts) ? options.additionalFacts : [];
  const approvedFactData = options.approvedFactData ?? readJson(options.approvedFactsPath || DEFAULT_APPROVED_FACTS_PATH);
  const approvedFacts = (approvedFactData?.facts || []).filter((item) => item?.approved === true && item?.sourceType === 'owner_approved');
  const mappings = (mappingData?.mappings || []).filter((item) => item?.mappingStatus === 'approved');
  const mappingByCanonical = new Map();
  for (const mapping of mappings) {
    if (!mapping.canonicalId || mappingByCanonical.has(mapping.canonicalId)) mappingByCanonical.set(mapping.canonicalId, null);
    else mappingByCanonical.set(mapping.canonicalId, mapping);
  }
  const snapshotById = new Map();
  for (const product of snapshotData?.products || []) {
    const id = clean(product?.unasId);
    if (!id || snapshotById.has(id)) snapshotById.set(id, null); else snapshotById.set(id, product);
  }

  function candidates(productId, type) {
    const mapping = mappingByCanonical.get(productId);
    const snapshot = mapping ? snapshotById.get(clean(mapping.unasId)) : null;
    const validSnapshot = Boolean(mapping && snapshot && clean(snapshot.sku) === clean(mapping.sku));
    const updatedAt = validSnapshot ? snapshot.updatedAt || snapshotData?.generatedAt || null : null;
    const source = validSnapshot ? provenance('unas_snapshot', `unas:${mapping.unasId}`, productId, updatedAt) : null;
    const ingredientBlocks = validSnapshot ? typedIngredientBlocks(snapshot.longDescription) : { inci: [], ingredients: [] };
    const normalizedIngredients = ingredientBlocks.ingredients.map((rawName) => ({ rawName, ingredientId: normalizeIngredient(rawName) })).filter((item) => item.ingredientId);
    const normalizedInci = ingredientBlocks.inci.map((rawName) => ({ rawName, ingredientId: normalizeIngredient(rawName) })).filter((item) => item.ingredientId);
    const benefits = validSnapshot ? explicitBenefits(snapshot.longDescription, uniqueByJson([...normalizedIngredients, ...normalizedInci])) : [];
    const values = {
      name: validSnapshot ? clean(snapshot.name) || null : null,
      price: validSnapshot && Number.isFinite(snapshot.actualPriceGross) ? snapshot.actualPriceGross : validSnapshot && Number.isFinite(snapshot.priceGross) ? snapshot.priceGross : null,
      currency: validSnapshot ? clean(snapshot.currency) || 'HUF' : null,
      url: validSnapshot ? validUrl(snapshot.url) : null, image: validSnapshot ? imageUrl(snapshot) : null,
      ingredients: normalizedIngredients.length ? normalizedIngredients : null,
      inci: ingredientBlocks.inci.length ? ingredientBlocks.inci : null,
      keyIngredients: null,
      ingredientBenefits: benefits.length ? benefits : null,
      usageInstructions: validSnapshot ? usageSection(snapshot.longDescription) || null : null,
      recommendedFor: validSnapshot ? recommendedForSection(snapshot.longDescription) || null : null,
      productDescription: validSnapshot ? authoritativeProductDescription(snapshot) || null : null,
      productBenefits: null,
      approvedClaims: null,
      warnings: validSnapshot ? section(snapshot.longDescription, [/^fontos tudnivalok/, /^mire figyelj/]) || null : null
    };
    const out = values[type] == null ? [] : [{ value: values[type], priority: SOURCE_PRIORITY.unas_snapshot, evidence: source }];
    const deterministic = deterministicProducts[productId];
    const deterministicValues = deterministic ? {
      name: clean(deterministic.name) || null,
      url: validUrl(deterministic.url),
      image: validUrl(deterministic.image),
      productBenefits: clean(deterministic.description) ? [{
        claim: clean(deterministic.description),
        provenance: provenance('deterministic_product', `product-catalog:${productId}:description`, productId)
      }] : null
    } : {};
    if (deterministicValues[type] != null) {
      out.push({
        value: deterministicValues[type],
        priority: SOURCE_PRIORITY.deterministic_product,
        evidence: provenance('deterministic_product', `product-catalog:${productId}:${type}`, productId)
      });
    }
    for (const item of additionalFacts.filter((item) => item.productId === productId && item.factType === type && item.value != null)) {
      out.push({ value: item.value, priority: item.priority ?? SOURCE_PRIORITY[item.sourceType] ?? 0, evidence: provenance(item.sourceType, item.sourceId, productId, item.sourceUpdatedAt || null) });
    }
    for (const item of approvedFacts.filter((item) => item.productId === productId && item.factType === type && item.value != null)) {
      out.push({ value: item.value, priority: SOURCE_PRIORITY.owner_approved, evidence: provenance('owner_approved', item.sourceId, productId, item.sourceUpdatedAt || null) });
    }
    return out;
  }
  function resolveFact(productId, type) {
    if (!FACT_TYPES.includes(type)) return unavailable(productId);
    const found = candidates(productId, type);
    if (!found.length) return unavailable(productId);
    const highest = Math.max(...found.map((item) => item.priority));
    const top = found.filter((item) => item.priority === highest);
    const distinct = uniqueByJson(top.map((item) => item.value));
    if (distinct.length > 1) return unavailable(productId, top.map((item) => ({ value: item.value, provenance: item.evidence })));
    return grounded(productId, top[0].value, top[0].evidence);
  }
  function getProductFacts(productId) {
    const id = clean(productId);
    const mapping = mappingByCanonical.get(id);
    const snapshot = mapping ? snapshotById.get(clean(mapping.unasId)) : null;
    const validCommerceIdentity = Boolean(mapping && snapshot && clean(snapshot.sku) === clean(mapping.sku));
    const hasApprovedFacts = approvedFacts.some((item) => item.productId === id);
    if (!id || (!validCommerceIdentity && !hasApprovedFacts)) return null;
    const facts = Object.fromEntries(FACT_TYPES.map((type) => [type, resolveFact(id, type)]));
    return {
      canonicalProductId: id,
      status: Object.values(facts).some((fact) => fact.status === 'conflicted') ? 'conflicted' : 'grounded',
      identityProvenance: validCommerceIdentity ? [provenance('approved_mapping', `mapping:${id}:${mapping.unasId}:${mapping.sku}`, id, mapping.approvedAt || null)] : [],
      facts
    };
  }
  function getFact(productId, factType) { return getProductFacts(productId)?.facts?.[factType] || unavailable(clean(productId)); }
  function hasIngredient(productId, ingredient) {
    const ingredientId = normalizeIngredient(ingredient);
    const plain = getFact(productId, 'ingredients');
    const inci = getFact(productId, 'inci');
    const plainMatch = plain.status === 'grounded' && plain.value.some((item) => item.ingredientId === ingredientId);
    const inciMatch = inci.status === 'grounded' && inci.value.some((item) => normalizeIngredient(item) === ingredientId);
    const evidence = plainMatch ? plain : inciMatch ? inci : plain.status === 'grounded' ? plain : inci;
    return { status: evidence.status, productId: clean(productId), ingredientId,
      exists: evidence.status === 'grounded' ? Boolean(plainMatch || inciMatch) : null, provenance: evidence.provenance };
  }
  function getGrounding(productId, factType = null) {
    const record = getProductFacts(productId);
    if (!record) return null;
    return factType ? getFact(productId, factType).provenance : { identity: record.identityProvenance, facts: Object.fromEntries(FACT_TYPES.map((type) => [type, record.facts[type].provenance])) };
  }
  return { getProductFacts, getFact, hasIngredient, normalizeIngredient, getGrounding };
}

const defaultResolver = createProductFactsResolver();
module.exports = { FACT_TYPES, SOURCE_PRIORITY, INGREDIENT_ALIASES, createProductFactsResolver, ...defaultResolver };
