'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_MAPPING_PATH = path.join(ROOT, 'data', 'canonical-unas-mapping.json');
const DEFAULT_SNAPSHOT_PATH = path.join(ROOT, 'data', 'unas-catalog-snapshot.json');

function cleanText(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.toLowerCase() === 'undefined' || text.toLowerCase() === 'null') return '';
  return text;
}

function validHttpUrl(value) {
  const text = cleanText(value);
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function validPrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function snapshotImageUrl(product) {
  if (!product || typeof product !== 'object') return '';
  if (typeof product.image === 'string') return validHttpUrl(product.image);
  return validHttpUrl(product.image?.url) || validHttpUrl(product.image?.sefUrl);
}

function uniqueValues(items, field) {
  const counts = new Map();
  for (const item of items) {
    const value = cleanText(item?.[field]);
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function buildCommerceIndex(mappingData, snapshotData) {
  const mappings = Array.isArray(mappingData?.mappings) ? mappingData.mappings : [];
  const products = Array.isArray(snapshotData?.products) ? snapshotData.products : [];
  const approved = mappings.filter((item) => item?.mappingStatus === 'approved');
  const canonicalCounts = uniqueValues(approved, 'canonicalId');
  const unasCounts = uniqueValues(approved, 'unasId');
  const skuCounts = uniqueValues(approved, 'sku');
  const productsByUnasId = new Map();

  for (const product of products) {
    const unasId = cleanText(product?.unasId);
    if (!unasId || productsByUnasId.has(unasId)) {
      if (unasId) productsByUnasId.set(unasId, null);
      continue;
    }
    productsByUnasId.set(unasId, product);
  }

  const index = new Map();
  for (const mapping of approved) {
    const canonicalId = cleanText(mapping.canonicalId);
    const unasId = cleanText(mapping.unasId);
    const sku = cleanText(mapping.sku);
    if (!canonicalId || !unasId || !sku) continue;
    if (canonicalCounts.get(canonicalId) !== 1 || unasCounts.get(unasId) !== 1 || skuCounts.get(sku) !== 1) continue;

    const product = productsByUnasId.get(unasId);
    if (!product || cleanText(product.sku) !== sku) continue;
    index.set(canonicalId, { mapping, product });
  }

  return index;
}

function availabilityFrom(product) {
  const availability = {};
  if (typeof product.public === 'boolean') availability.public = product.public;
  if (typeof product.orderable === 'boolean') availability.orderable = product.orderable;
  if (typeof product.active === 'boolean') availability.active = product.active;
  const state = cleanText(product.status?.state);
  if (state) availability.state = state;
  return availability;
}

function mergeProduct(canonicalId, canonicalProduct, index) {
  const base = canonicalProduct && typeof canonicalProduct === 'object' ? { ...canonicalProduct } : null;
  if (!base) return null;

  const match = index instanceof Map ? index.get(canonicalId) : null;
  if (!match) return base;

  const { mapping, product } = match;
  const name = cleanText(product.name);
  const url = validHttpUrl(product.url);
  const image = snapshotImageUrl(product);
  const actualPrice = validPrice(product.actualPriceGross);
  const regularPrice = validPrice(product.priceGross);
  const price = actualPrice ?? regularPrice;
  const currency = cleanText(product.currency);
  const availability = availabilityFrom(product);

  if (name) base.name = name;
  if (url) base.url = url;
  if (image) base.image = image;
  if (price !== null) base.price = price;
  if (regularPrice !== null) base.priceGross = regularPrice;
  if (actualPrice !== null) base.actualPriceGross = actualPrice;
  if (currency) base.currency = currency;
  if (Object.keys(availability).length) base.availability = availability;
  base.commerce = {
    source: 'unas',
    mappingStatus: mapping.mappingStatus,
    unasId: cleanText(mapping.unasId),
    sku: cleanText(mapping.sku)
  };
  return base;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function fileSignature(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return 'missing';
  }
}

function createProductRegistry({
  mappingData = null,
  snapshotData = null,
  mappingPath = DEFAULT_MAPPING_PATH,
  snapshotPath = DEFAULT_SNAPSHOT_PATH
} = {}) {
  const fixedData = mappingData !== null || snapshotData !== null;
  let signature = null;
  let index = new Map();

  function currentIndex() {
    if (fixedData) {
      if (signature === null) {
        index = buildCommerceIndex(mappingData, snapshotData);
        signature = 'fixed';
      }
      return index;
    }

    const nextSignature = `${fileSignature(mappingPath)}|${fileSignature(snapshotPath)}`;
    if (nextSignature !== signature) {
      index = buildCommerceIndex(safeReadJson(mappingPath), safeReadJson(snapshotPath));
      signature = nextSignature;
    }
    return index;
  }

  return {
    resolve(canonicalId, canonicalProduct) {
      return mergeProduct(canonicalId, canonicalProduct, currentIndex());
    }
  };
}

module.exports = {
  DEFAULT_MAPPING_PATH,
  DEFAULT_SNAPSHOT_PATH,
  buildCommerceIndex,
  createProductRegistry,
  mergeProduct,
  validHttpUrl,
  validPrice
};
