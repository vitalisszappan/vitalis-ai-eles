'use strict';

const fs = require('fs');
const path = require('path');
const { resolveUnasCatalogSnapshotPath } = require('./unas-catalog-path.cjs');

const ROOT = path.join(__dirname, '..');
const DEFAULT_MAPPING_PATH = path.join(ROOT, 'data', 'canonical-unas-mapping.json');
const DEFAULT_SNAPSHOT_PATH = resolveUnasCatalogSnapshotPath();

const SOURCE_PRIORITY = Object.freeze({
  approved_mapping: 400,
  unas_snapshot: 300,
  deterministic_product: 200,
  approved_knowledge: 150,
  base_knowledge: 100
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
  'recommendedFor', 'productBenefits', 'approvedClaims', 'warnings'
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

const HEADINGS = /(?:Kinek aj[aá]nljuk\?|Mire aj[aá]nljuk\?|Mi[eé]rt v[aá]laszd|Haszn[aá]lat(?:a)?|Hogyan haszn[aá]ld|Fontos tudnival[oó]k|Mire figyelj\?|Csomagol[aá]s|Gyakori k[eé]rd[eé]sek|[ÖO]sszetev[őo]k|INGREDIENTS\s*\(INCI\)|INCI)(?![A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű])\s*:?/gi;
function section(text, labels) {
  const source = String(text || '');
  const matches = [...source.matchAll(HEADINGS)];
  const wanted = matches.find((match) => labels.some((label) => label.test(fold(match[0]))));
  if (!wanted) return '';
  const next = matches.find((match) => match.index > wanted.index);
  return clean(source.slice(wanted.index + wanted[0].length, next?.index ?? source.length));
}
function splitList(value) {
  return clean(value).split(/\s*(?:,|;|\n|\r|\u2022|\*)\s*/).map(clean).filter(Boolean);
}
function explicitIngredientBlock(text) {
  const source = String(text || '');
  const match = /(?:INGREDIENTS\s*\(INCI\)|INCI|[ÖO]sszetev[őo]k)\s*:\s*/i.exec(source);
  if (!match) return [];
  const tail = source.slice(match.index + match[0].length);
  const stop = /\b(?:Kinek aj[aá]nljuk|Mire aj[aá]nljuk|Haszn[aá]lat|Hogyan haszn[aá]ld|Fontos tudnival[oó]k|Mire figyelj|Csomagol[aá]s|Gyakori k[eé]rd[eé]sek)\b/i.exec(tail);
  const block = clean(tail.slice(0, stop?.index ?? tail.length));
  if (!block || block.length > 4000) return [];
  return splitList(block).filter((item) => item.length <= 180);
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

function createProductFactsResolver(options = {}) {
  const mappingData = options.mappingData ?? readJson(options.mappingPath || DEFAULT_MAPPING_PATH);
  const snapshotData = options.snapshotData ?? readJson(options.snapshotPath || DEFAULT_SNAPSHOT_PATH);
  const deterministicProducts = options.deterministicProducts || require('./product-catalog.cjs').PRODUCTS;
  const additionalFacts = Array.isArray(options.additionalFacts) ? options.additionalFacts : [];
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
    if (!mapping) return [];
    const snapshot = snapshotById.get(clean(mapping.unasId));
    if (!snapshot || clean(snapshot.sku) !== clean(mapping.sku)) return [];
    const updatedAt = snapshot.updatedAt || snapshotData?.generatedAt || null;
    const source = provenance('unas_snapshot', `unas:${mapping.unasId}`, productId, updatedAt);
    const ingredients = explicitIngredientBlock(snapshot.longDescription);
    const normalizedIngredients = ingredients.map((rawName) => ({ rawName, ingredientId: normalizeIngredient(rawName) })).filter((item) => item.ingredientId);
    const benefits = explicitBenefits(snapshot.longDescription, normalizedIngredients);
    const values = {
      name: clean(snapshot.name) || null,
      price: Number.isFinite(snapshot.actualPriceGross) ? snapshot.actualPriceGross : Number.isFinite(snapshot.priceGross) ? snapshot.priceGross : null,
      currency: clean(snapshot.currency) || 'HUF',
      url: validUrl(snapshot.url), image: imageUrl(snapshot),
      ingredients: normalizedIngredients.length ? normalizedIngredients : null,
      inci: ingredients.length ? ingredients : null,
      keyIngredients: null,
      ingredientBenefits: benefits.length ? benefits : null,
      usageInstructions: section(snapshot.longDescription, [/^hasznalat/, /^hogyan hasznald/]) || null,
      recommendedFor: section(snapshot.longDescription, [/^kinek ajanljuk/, /^mire ajanljuk/]) || null,
      productBenefits: null,
      approvedClaims: null,
      warnings: section(snapshot.longDescription, [/^fontos tudnivalok/, /^mire figyelj/]) || null
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
    if (!id || !mapping) return null;
    const snapshot = snapshotById.get(clean(mapping.unasId));
    if (!snapshot || clean(snapshot.sku) !== clean(mapping.sku)) return null;
    const facts = Object.fromEntries(FACT_TYPES.map((type) => [type, resolveFact(id, type)]));
    return {
      canonicalProductId: id,
      status: Object.values(facts).some((fact) => fact.status === 'conflicted') ? 'conflicted' : 'grounded',
      identityProvenance: [provenance('approved_mapping', `mapping:${id}:${mapping.unasId}:${mapping.sku}`, id, mapping.approvedAt || null)],
      facts
    };
  }
  function getFact(productId, factType) { return getProductFacts(productId)?.facts?.[factType] || unavailable(clean(productId)); }
  function hasIngredient(productId, ingredient) {
    const fact = getFact(productId, 'ingredients');
    const ingredientId = normalizeIngredient(ingredient);
    return { status: fact.status, productId: clean(productId), ingredientId, exists: fact.status === 'grounded' ? fact.value.some((item) => item.ingredientId === ingredientId) : null, provenance: fact.provenance };
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
