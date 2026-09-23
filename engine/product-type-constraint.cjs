'use strict';
const {normalize}=require('./normalizer.cjs');
const HAIR_WASH_TYPES=Object.freeze(['liquid_shampoo','solid_shampoo','shampoo_soap']);
const NEGATABLE_TYPES=Object.freeze([
  ['shampoo_soap','(?:samponszappan\\w*|sampon\\s+szappan\\w*)'],
  ['shampoo','sampon(?!szappan)\\w*'],
  ['solid_shampoo','(?:szilard\\s+sampon\\w*|samponrud\\w*|shampoo\\s+bar\\w*)'],
  ['liquid_shampoo','folyekony\\s+sampon\\w*'],
  ['tusfurdo','tusfurdo\\w*'],
  ['szappan','szappan\\w*'],
  ['krem','krem\\w*'],
  ['balzsam','balzsam\\w*']
]);
function negationPatterns(typePattern){return[
  new RegExp(`\\bnem\\s+${typePattern}(?:\\s+(?:erdekel\\w*|szeretn\\w*))?`,'g'),
  new RegExp(`\\b${typePattern}\\s+nem\\s+(?:erdekel\\w*|szeretn\\w*)`,'g'),
  new RegExp(`\\b(?:barmit\\s*)?csak\\s+${typePattern}\\s+ne\\b`,'g'),
  new RegExp(`\\b${typePattern}\\s+helyett\\b`,'g')
];}
function detectExcludedProductTypes(question){
  const q=normalize(question),excluded=[];
  for(const [type,pattern] of NEGATABLE_TYPES){if(negationPatterns(pattern).some(regex=>regex.test(q)))excluded.push(type);}
  return excluded;
}
function withoutNegatedProductTypes(question){let q=normalize(question);for(const [,pattern] of NEGATABLE_TYPES){for(const regex of negationPatterns(pattern))q=q.replace(regex,' ');}return q.replace(/\s+/g,' ').trim();}
function detectProductTypeConstraint(question){const q=withoutNegatedProductTypes(question);if(/\b(samponszappan\w*|sampon szappan\w*)/.test(q))return'shampoo_soap';if(/\b(szilard sampon\w*|samponrud\w*|shampoo bar\w*)/.test(q))return'solid_shampoo';if(/\bfolyekony sampon\w*/.test(q))return'liquid_shampoo';if(/\btusfurdo\w*/.test(q))return'tusfurdo';if(/\bszappan\w*/.test(q))return'szappan';if(/\bkrem\w*/.test(q))return'krem';if(/\bbalzsam\w*/.test(q))return'balzsam';return null;}
// Legacy canonical objects may use their ID; catalog records require mapped identity.
function semanticProductId(product) {
  if (product?.commerceIdentity || String(product?.id || '').startsWith('catalog:')) return product?.canonicalProductId || null;
  return product?.id;
}
function inferredHairType(product){const explicit=product?.productType;if(HAIR_WASH_TYPES.includes(explicit))return explicit;const raw=[semanticProductId(product),product?.name,product?.title,product?.label,...(product?.category||[])].filter(Boolean).join(' '),text=normalize(raw);if(/shampoo_soap|\b(samponszappan\w*|sampon szappan\w*)/.test(`${raw} ${text}`))return'shampoo_soap';if(/solid_shampoo|\b(szilard sampon\w*|samponrud\w*|shampoo bar\w*)/.test(`${raw} ${text}`))return'solid_shampoo';if(/\bsampon\w*/.test(text))return'liquid_shampoo';return null;}
function matchesProductType(product,constraint){if(!constraint)return true;if(HAIR_WASH_TYPES.includes(constraint))return inferredHairType(product)===constraint;const text=normalize([semanticProductId(product),product?.name,product?.title,product?.label].filter(Boolean).join(' '));if(constraint==='tusfurdo')return /\btusfurdo\w*/.test(text);if(constraint==='szappan')return /\bszappan\w*/.test(text)&&!inferredHairType(product);if(constraint==='krem')return /\bkrem\w*/.test(text);if(constraint==='balzsam')return /\bbalzsam\w*/.test(text);return false;}
// Narrow current-turn requests only. Keep legacy extraction (including generic
// shampoo's null constraint) unchanged for all existing consumers.
const BODY_REQUEST = /\btestapolo(?:t|tok|k|itok)?\b/g;
const FACE_REQUEST = /\barc ?krem(?:et|ek|eitek)?\b/g;
const SUBTYPES = Object.freeze(['body_lotion', 'facial_cream']);
function extractSubtypeRequest(question) {
  const text = normalize(question);
  const none = { status: 'NONE', type: null, qualifiers: [], mode: null };
  const informational = /^(?:van|vannak|kaphato|elerheto)\b/.test(text)
    || /^milyen\b.*\b(?:van|vannak)$/.test(text)
    || /\b(?:mutass|mutasd|listazz|sorolj)\b/.test(text);
  const selection = /\b(?:keresek|szeretnek|ajanl\w*|javasol\w*)\b/.test(text);
  if (!informational && !selection) return none;
  const body = [...text.matchAll(BODY_REQUEST)];
  const face = [...text.matchAll(FACE_REQUEST)];
  if (!body.length && !face.length) return none;
  const type = body.length && !face.length ? 'body_lotion' : face.length && !body.length ? 'facial_cream' : null;
  const mode = selection ? 'selection' : 'availability';
  const qualifiers = /\bkecsketejes\b/.test(text) ? ['kecsketejes'] : [];
  const result = { status: 'RESOLVED', type, qualifiers, mode };
  if (!type || /\b(?:szappan\w*|sampon\w*|kezkrem\w*|balzsam\w*|tusfurdo\w*)\b/.test(text)) return { ...result, status: 'AMBIGUOUS' };
  if (/\b(?:nem|ne|nincs|nelkul|helyett)\b/.test(text)) return { ...result, qualifiers: [], status: 'UNSUPPORTED' };
  // Only bounded request framing, the supported qualifier, and the evidenced
  // concern are removable. Unknown modifiers remain and force clarification.
  const residual = text.replace(BODY_REQUEST, ' ').replace(FACE_REQUEST, ' ')
    .replace(/\bkrem(?:et|ek|eitek|rol)?\b/g, ' ')
    .replace(/\bkecsketejes\b/g, ' ')
    .replace(/\bszaraz borre\b/g, ' ')
    .replace(/\b(?:van|vannak|kaphato|elerheto|milyen|mutass|mutasd|listazz|sorolj|keresek|szeretnek|ajanlotok|ajanlasz|javasoltok|javasolsz|kerlek|nekem|egy|a|az)\b/g, ' ')
    .trim();
  return residual ? { ...result, status: 'UNSUPPORTED' } : result;
}
function matchesRequestedSubtype(product, subtype) {
  if (!SUBTYPES.includes(subtype) || typeof product?.commerceName !== 'string') return false;
  const name = normalize(product.commerceName);
  const designation = subtype === 'body_lotion' ? 'testapolo' : 'arc ?krem';
  // Candidate evidence is nominative and standalone, not a negated designation
  // or a hyphen-derived word. Spaced commerce separators remain harmless.
  // Candidate-only separator alphabet: normalized whitespace and ASCII hyphens.
  // Normalization already maps parentheses, comma, colon and slash to spaces.
  // Runs are accepted; no words or additional punctuation grammar are skipped.
  if (new RegExp(`\\bnem[\\s-]+${designation}\\b`).test(name)) return false;
  if (!new RegExp(`(?:^|\\s)${designation}(?=\\s|$)`).test(name)) return false;
  // Bounded descriptor stems, including spacing/punctuation variants. A
  // commerce separator before a real variant (e.g. hyaluron) stays valid.
  if (new RegExp(`\\b${designation}[\\s-]+(?:illatu|allagu|hatasu|jellegu|szeru)\\b`).test(name)) return false;
  const body = /\btestapolo\b/.test(name);
  const face = /\barc ?krem\b/.test(name);
  if (/\b(?:szappan\w*|sampon\w*|kezkrem\w*|kezapolo\w*|tusfurdo\w*)\b/.test(name)) return false;
  return subtype === 'body_lotion' ? body && !face : face && !body;
}
function matchesSubtypeQualifiers(product, qualifiers = []) {
  const name = normalize(product?.commerceName || '');
  if (qualifiers.includes('kecsketejes') && /\bnem[\s-]+kecsketejes\b/.test(name)) return false;
  // Only the qualifier occurrence governed by a descriptor loses authority.
  // Descriptive words elsewhere do not invalidate genuine qualifier evidence.
  const evidence = name.replace(/\bkecsketejes[\s-]+(?:illatu|allagu|hatasu|jellegu|szeru)\b/g, ' ');
  const words = evidence.split(' ');
  return qualifiers.every(value => value === 'kecsketejes' && words.includes(value));
}
function hasSubtypeProseConflict(answer, subtype) {
  // Prose uses the approved inflections; official-name classification stays
  // nominative and separate. Reject conflicts without rewriting authority.
  const text = normalize(answer || '');
  const conflictingFamily = subtype === 'body_lotion' ? FACE_REQUEST : BODY_REQUEST;
  return [...text.matchAll(conflictingFamily)].length > 0;
}
// Card IDs are output references, not raw commerce identifiers. Only the
// catalog's approved mapping may supply a canonical product ID.
function subtypeCardIdentity(item) {
  const { unasId, sku } = item.commerceIdentity;
  const id = item.canonicalProductId || `catalog:${unasId ? 'unas' : 'sku'}:${encodeURIComponent(unasId || sku)}`;
  return { id, canonicalProductId: item.canonicalProductId || null,
    unasProductId: unasId || null, sku: sku || null,
    commerce: { source: 'unas', unasId, sku,
      ...(item.canonicalProductId ? { mappingStatus: 'approved' } : {}) } };
}
function resolveSubtypeProduct(link, catalogProducts) {
  if (!link || typeof link.id !== 'string' || !link.id) return null;
  const matches = catalogProducts.filter(item => item.commerceIdentity?.usable && (link.id === item.id
    || link.id === item.canonicalProductId || link.id === subtypeCardIdentity(item).id));
  return matches.length === 1 ? matches[0] : null;
}
function compatibleSubtypeIdentity(link, item) {
  const { unasId, sku } = item.commerceIdentity;
  const agrees = (value, expected) => value == null || value === ''
    || (typeof value === 'string' && Boolean(expected) && value === expected);
  if (!agrees(link.canonicalProductId, item.canonicalProductId)
    || !agrees(link.unasProductId, unasId) || !agrees(link.sku, sku)
    || !agrees(link.productType, item.productType)) return false;
  if (link.commerce == null) return true;
  if (typeof link.commerce !== 'object' || Array.isArray(link.commerce)) return false;
  return agrees(link.commerce.unasId, unasId) && agrees(link.commerce.sku, sku)
    && agrees(link.commerce.source, 'unas')
    && agrees(link.commerce.mappingStatus, item.canonicalProductId ? 'approved' : null);
}
function compatibleSubtypeExpert(expert, request, catalogProducts) {
  if (!expert || request?.status !== 'RESOLVED' || !SUBTYPES.includes(request.type)) return false;
  if (!['source', 'ruleId', 'intent', 'answer'].every(key => typeof expert[key] === 'string')) return false;
  const links = expert.links || [];
  // Preserve a complete bounded expert selection; never trim its existing prose.
  if (Array.isArray(links) && links.length > 6) return false;
  if (!Array.isArray(links) || !links.length || !expert.primaryProductId || !links.some(link => link?.id === expert.primaryProductId)) return false;
  if (!links.every(link => {
    const item = resolveSubtypeProduct(link, catalogProducts);
    if (!item || !compatibleSubtypeIdentity(link, item)) return false;
    return item && link.url === item.url && matchesRequestedSubtype(item, request.type) && matchesSubtypeQualifiers(item, request.qualifiers)
      && matchesRequestedSubtype({ commerceName: item.name }, request.type)
      && ['name', 'title', 'label'].every(key => !link[key] || [normalize(item.name), normalize(item.commerceName)].includes(normalize(link[key])))
      && !link.description && !link.reason;
  })) return false;
  // Existing expert prose is not a template for new authority: reject the whole
  // result if its product-bearing text conflicts, instead of promoting a card.
  const prose = normalize(expert.answer || '');
  if (hasSubtypeProseConflict(expert.answer, request.type)) return false;
  if (!matchesRequestedSubtype({ commerceName: expert.answer }, request.type)) return false;
  if (/https?:|www\.|\]\(/i.test(expert.answer || '') || (expert.suggestions || []).length) return false;
  return !catalogProducts.some(item => !links.some(link => resolveSubtypeProduct(link, catalogProducts) === item)
    && normalize(item.commerceName).length >= 8 && prose.includes(normalize(item.commerceName)));
}
module.exports={HAIR_WASH_TYPES,detectExcludedProductTypes,detectProductTypeConstraint,inferredHairType,matchesProductType,
  extractSubtypeRequest,matchesRequestedSubtype,matchesSubtypeQualifiers,compatibleSubtypeExpert,subtypeCardIdentity,resolveSubtypeProduct};
