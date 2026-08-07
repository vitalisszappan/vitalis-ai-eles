'use strict';

const fs = require('fs');
const path = require('path');
const { normalize } = require('./normalizer.cjs');

const DEFAULT_SNAPSHOT = path.join(__dirname, '..', 'data', 'unas-catalog-snapshot.json');
const CATEGORY_DEFINITIONS = [
  { id: 'shower_gel', label: 'tusfürdő', query: /\b(tusfurdo|tusfurdotok|folyekony szappan)\w*/, product: /\b(tusfurdo|folyekony szappan)\w*/ },
  { id: 'sunscreen', label: 'naptej/fényvédő', query: /\b(naptej|fenyvedo|fenyvedelem|spf)\w*/, product: /\b(naptej|fenyvedo|spf ?[0-9]*)\w*/ },
  { id: 'deodorant', label: 'dezodor', query: /\b(dezodor|izzadasgatlo|izzadasgatlorol)\w*/, product: /\b(dezodor|kremdezodor)\w*/ },
  { id: 'shampoo', label: 'sampon', query: /\b(sampon|samponotok)\w*/, product: /\b(sampon|samponszappan)\w*/ },
  { id: 'soap', label: 'szappan', query: /\b(szappan|szappanotok)\w*/, product: /\b(szappan)\w*/ },
  { id: 'hand_cream', label: 'kézkrém', query: /\b(kezkrem|kezapolo)\w*/, product: /\b(kezkrem|kezapolo|testapolo krem|shea vaj)\w*/ },
  { id: 'heel_care', label: 'sarokápoló', query: /\b(sarokkrem|sarokapol|repedt sarok|szaraz sarok)\w*/, product: /\b(sarokkrem|labapolo|testapolo krem|shea vaj)\w*/ },
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

function safeProduct(product) {
  const image = validUrl(product.image?.url) || validUrl(product.image?.sefUrl);
  const price = Number.isFinite(product.actualPriceGross) ? product.actualPriceGross
    : Number.isFinite(product.priceGross) ? product.priceGross : null;
  const size = normalize(product.name).match(/\b\d+(?:[.,]\d+)?\s*(?:ml|g|kg|db)\b/)?.[0] || '';
  return {
    id: String(product.unasId || product.sku || ''), unasId: String(product.unasId || ''), sku: String(product.sku || ''),
    name: String(product.name || '').trim(), normalizedName: normalize(product.name), aliases: [],
    category: (product.categoryNames || []).map(String), public: product.public !== false,
    active: product.active !== false && product.status?.state !== 'disabled', orderable: product.orderable !== false,
    size, price, currency: product.currency || 'HUF', url: validUrl(product.url), image
  };
}

function createCatalogSearch(snapshotPath = DEFAULT_SNAPSHOT) {
  let signature = null;
  let products = [];
  function load() {
    let next = 'missing';
    try { const stat = fs.statSync(snapshotPath); next = `${stat.size}:${stat.mtimeMs}`; } catch {}
    if (next === signature) return products;
    signature = next;
    try {
      const parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      products = (Array.isArray(parsed.products) ? parsed.products : []).map(safeProduct)
        .filter((item) => item.name && item.url && item.public && item.active && item.orderable);
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
  return { all: load, detectCategory, searchCategory, findExactProduct };
}

module.exports = { CATEGORY_DEFINITIONS, createCatalogSearch, validUrl };
