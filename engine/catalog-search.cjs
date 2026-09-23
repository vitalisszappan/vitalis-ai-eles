'use strict';

const fs = require('fs');
const path = require('path');
const { normalize } = require('./normalizer.cjs');
const {inferredHairType}=require('./product-type-constraint.cjs');
const { matchesRequestedSubtype, matchesSubtypeQualifiers } = require('./product-type-constraint.cjs');
const { resolveUnasCatalogSnapshotPath } = require('./unas-catalog-path.cjs');
const { PRODUCTS } = require('./product-catalog.cjs');
const { buildCommerceIndex } = require('./product-registry.cjs');

const DEFAULT_SNAPSHOT = resolveUnasCatalogSnapshotPath();
const DEFAULT_MAPPING = path.join(__dirname, '..', 'data', 'canonical-unas-mapping.json');
const CATEGORY_DEFINITIONS = [
  { id: 'shower_gel', label: 'tusfürdő', query: /\b(tusfurdo|tusfurdotok|folyekony szappan)\w*/, product: /\b(tusfurdo|folyekony szappan)\w*/ },
  { id: 'sunscreen', label: 'naptej/fényvédő', query: /\b(naptej|fenyvedo|fenyvedelem|spf)\w*/, product: /\b(naptej|fenyvedo|spf ?[0-9]*)\w*/ },
  { id: 'deodorant', label: 'dezodor', query: /\b(dezodor|izzadasgatlo|izzadasgatlorol)\w*/, product: /\b(dezodor|kremdezodor)\w*/ },
  { id: 'shampoo', label: 'sampon', query: /\b(sampon|samponotok)\w*/, product: /\b(sampon|samponszappan)\w*/ },
  { id: 'soap', label: 'szappan', query: /\b(szappan|szappanotok)\w*/, product: /\b(szappan)\w*/ },
  { id: 'hand_cream', label: 'kézkrém', query: /\b(kezkrem|kezapolo)\w*/, product: /\b(kezkrem|kezapolo|testapolo krem|shea vaj)\w*/ },
  { id: 'heel_care', label: 'sarokápoló', query: /\b(sarokkrem|sarokapol|repedt sarok|szaraz sarok)\w*/, product: /\b(sarokkrem|sarokapol|labapolo)\w*/ },
  { id: 'cream', label: 'krém', query: /\b(krem|balzsam)\w*/, product: /\b(krem|balzsam)\w*/ }
];

function validUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'vitalis-szappan.hu' || host.endsWith('.vitalis-szappan.hu')) ? url.href : '';
  } catch { return ''; }
}

function productText(product) {
  return normalize([product.name, ...(product.categoryNames || [])].filter(Boolean).join(' '));
}

// Mirror widget safeText for strings; retain the catalog's positive numeric IDs.
function normalizeCommerceIdentity(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? String(value) : '';
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return !text || /^(undefined|null)$/i.test(text) ? '' : text;
}
const usableIdentity = value => Boolean(normalizeCommerceIdentity(value));

function validateCommerceIdentities(products) {
  // Both namespaces are consumed downstream (including SKU attribution).
  // Never disambiguate duplicate evidence by position or a manufactured ID.
  for (const field of ['unasId', 'sku']) {
    const counts = new Map();
    for (const item of products) {
      const id = item.commerceIdentity[field];
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    for (const item of products) {
      if (counts.get(item.commerceIdentity[field]) > 1) item.commerceIdentity.usable = false;
    }
  }
  for (const item of products) if (!item.commerceIdentity.usable) item.canonicalProductId = null;
  return products;
}

function safeProduct(product, canonicalId = null) {
  const image = validUrl(product.image?.url) || validUrl(product.image?.sefUrl);
  const price = Number.isFinite(product.actualPriceGross) ? product.actualPriceGross
    : Number.isFinite(product.priceGross) ? product.priceGross : null;
  const size = normalize(product.name).match(/\b\d+(?:[.,]\d+)?\s*(?:ml|g|kg|db)\b/)?.[0] || '';
  const displayName = canonicalId && PRODUCTS[canonicalId]?.displayName;
  const safe={
    id: normalizeCommerceIdentity(product.unasId || product.sku),
    unasId: normalizeCommerceIdentity(product.unasId), sku: normalizeCommerceIdentity(product.sku),
    // Only normalized, typed evidence may become a commerce reference.
    commerceIdentity: { usable: usableIdentity(product.unasId || product.sku),
      unasId: normalizeCommerceIdentity(product.unasId),
      sku: normalizeCommerceIdentity(product.sku) },
    canonicalProductId: canonicalId || null,
    name: String(displayName || product.name || '').trim(), commerceName: String(product.name || '').trim(),
    normalizedName: normalize(displayName || product.name), aliases: [],
    category: (product.categoryNames || []).map(String), public: product.public !== false,
    active: product.active !== false && product.status?.state !== 'disabled', orderable: product.orderable !== false,
    size, price, currency: product.currency || 'HUF', url: validUrl(product.url), image
  };
  safe.productType=inferredHairType(safe);
  return safe;
}

function createCatalogSearch(snapshotPath = DEFAULT_SNAPSHOT) {
  let signature = null;
  let products = [];
  function load() {
    let next = 'missing';
    try { const stat = fs.statSync(snapshotPath); next = `${stat.size}:${stat.mtimeMs}`; } catch {}
    // Canonical resolution depends on current mapping contents, including
    // revocation and ambiguity. Content also catches same-size/timestamp edits.
    let mappingSource = '';
    try { mappingSource = fs.readFileSync(DEFAULT_MAPPING, 'utf8'); } catch {}
    next += `:${mappingSource}`;
    if (next === signature) return products;
    signature = next;
    try {
      const parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      const mappingData = JSON.parse(mappingSource);
      // Reuse the registry's uniqueness and exact UNAS/SKU proof contract.
      const approvedByUnasId = new Map([...buildCommerceIndex(mappingData, parsed)]
        .map(([canonicalId, { mapping }]) => [normalizeCommerceIdentity(mapping.unasId), canonicalId]));
      products = validateCommerceIdentities((Array.isArray(parsed.products) ? parsed.products : []).map((product) => {
        const canonicalId = approvedByUnasId.get(normalizeCommerceIdentity(product?.unasId)) || null;
        return safeProduct(product, canonicalId);
      }))
        .filter((item) => item.commerceIdentity.usable && item.name && item.url && item.public && item.active && item.orderable);
    } catch { products = []; }
    return products;
  }
  function detectCategory(question) {
    const text = normalize(question);
    return CATEGORY_DEFINITIONS.find((category) => category.query.test(text)) || null;
  }
  function searchCategory(categoryId, limit = 6) {
    const category = CATEGORY_DEFINITIONS.find((item) => item.id === categoryId);
    if (!category) return { category: null, products: [] };
    return { category, products: load().filter((item) => category.product.test(productText(item))).slice(0, limit) };
  }
  function findExactProduct(question) {
    const text = normalize(question);
    if (!text || text.length < 4) return null;
    const candidates = load().map((product) => {
      const name = product.normalizedName;
      const exact = text === name || text.includes(name);
      const queryTokens = text.split(' ').filter((x) => x.length >= 4);
      const matched = queryTokens.filter((token) => name.includes(token));
      return { product, exact, coverage: queryTokens.length ? matched.length / queryTokens.length : 0 };
    }).filter((item) => item.exact || item.coverage === 1).sort((a, b) => Number(b.exact) - Number(a.exact) || b.product.normalizedName.length - a.product.normalizedName.length);
    return candidates[0]?.product || null;
  }
  function categorySummary() {
    const excluded = new Set(['osszes termekunk', 'problemak es megoldasok']);
    return [...new Set(load().flatMap((product) => product.category)
      .map((value) => String(value).split('|')[0].trim())
      .filter((value) => value && !excluded.has(normalize(value))))]
      .sort((left, right) => left.localeCompare(right, 'hu'));
  }
  function searchSubtype(subtype, qualifiers = [], limit = 6) {
    // Unlike the legacy search, failure is not represented as empty inventory.
    // Read the complete snapshot here: neither stale cached results nor an
    // already-limited generic cream list can establish a constrained no-match.
    try {
      const parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      if (!Array.isArray(parsed.products) || parsed.products.some(item => !item || typeof item.name !== 'string')) throw new Error('invalid_catalog');
      // Preserve whole-snapshot failure for malformed records, even in mixed
      // inventories. Require the fields consumed by identity/materialization;
      // price, image and category metadata remain optional. A present unsafe
      // URL remains an eligibility exclusion, as in the existing catalog path.
      if (parsed.products.some(item => !item.name.trim() || !usableIdentity(item.unasId || item.sku)
        || typeof item.url !== 'string' || !item.url.trim())) throw new Error('unusable_catalog');
      const scopedProducts = validateCommerceIdentities(parsed.products.map(item => safeProduct(item)));
      // As with structural failure, ambiguity prevents a truthful whole-catalog
      // no-match claim. Expert resolution separately excludes unusable records.
      if (scopedProducts.some(item => !item.commerceIdentity.usable)) throw new Error('ambiguous_catalog');
      const eligible = scopedProducts.filter(item => item.id && item.name && item.url && item.public && item.active && item.orderable)
        .filter((item) => matchesRequestedSubtype(item, subtype))
        .filter((item) => matchesSubtypeQualifiers(item, qualifiers));
      // Snapshot order is the existing deterministic catalog order.
      const products = eligible.slice(0, Math.max(0, Math.min(6, Number.isInteger(limit) ? limit : 6)));
      return { status: eligible.length ? 'CATALOG_AVAILABLE_WITH_MATCHES' : 'CATALOG_AVAILABLE_NO_MATCH', products };
    } catch {
      return { status: 'CATALOG_UNAVAILABLE', products: [] };
    }
  }
  return { all: load, detectCategory, searchCategory, searchSubtype, findExactProduct, categorySummary };
}

module.exports = { CATEGORY_DEFINITIONS, createCatalogSearch, validUrl };
