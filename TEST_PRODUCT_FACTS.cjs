'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');
const restoreCatalogFixture = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restoreCatalogFixture);
const { createProductFactsResolver, normalizeIngredient } = require('./engine/product-facts.cjs');

const resolver = createProductFactsResolver();
const known = resolver.getProductFacts('dermavital_krem');
assert.equal(known.canonicalProductId, 'dermavital_krem');
assert.equal(known.facts.name.status, 'grounded');
assert.equal(known.facts.price.status, 'grounded');
assert.ok(known.identityProvenance.every((item) => item.approved && item.productId === 'dermavital_krem'));

assert.equal(resolver.getProductFacts('does_not_exist'), null);

const missing = resolver.getProductFacts('parajdi_sotomb');
assert.equal(missing.facts.ingredientBenefits.status, 'unavailable');
assert.equal(missing.facts.ingredientBenefits.value, null);

for (const fact of Object.values(known.facts).filter((item) => item.status === 'grounded')) {
  assert.ok(fact.provenance.length > 0);
  assert.ok(fact.provenance.every((item) => item.sourceType && item.sourceId && item.productId === 'dermavital_krem' && item.approved));
}

assert.equal(normalizeIngredient('Urea'), 'urea');
assert.equal(normalizeIngredient('Karbamid'), 'urea');
assert.equal(resolver.hasIngredient('dermavital_krem', 'Karbamid').exists, true);
assert.doesNotMatch(resolver.getFact('dermavital_krem', 'usageInstructions').value || '', /használatra alkalmas/i);
assert.ok(!resolver.getFact('dermavital_krem', 'ingredientBenefits').value || resolver.getFact('dermavital_krem', 'ingredientBenefits').value.every((item) => resolver.hasIngredient('dermavital_krem', item.ingredientId).exists));

const conflictResolver = createProductFactsResolver({
  additionalFacts: [
    { productId: 'dermavital_krem', factType: 'price', value: 1, sourceType: 'unas_snapshot', sourceId: 'conflict-a' },
    { productId: 'dermavital_krem', factType: 'price', value: 2, sourceType: 'unas_snapshot', sourceId: 'conflict-b' }
  ]
});
const conflict = conflictResolver.getFact('dermavital_krem', 'price');
assert.equal(conflict.status, 'conflicted');
assert.equal(conflict.value, null);
assert.ok(conflict.conflicts.length >= 2);

const identityOnly = createProductFactsResolver({
  mappingData: { mappings: [{ canonicalId: 'identity_only', unasId: '1', sku: 'SKU', mappingStatus: 'approved' }] },
  snapshotData: { generatedAt: '2026-01-01T00:00:00Z', products: [{ unasId: '1', sku: 'SKU', name: 'Identity only', longDescription: 'INCI: Aqua, Urea', priceGross: 10, url: 'https://www.vitalis-szappan.hu/test' }] },
  deterministicProducts: { identity_only: { id: 'identity_only', name: 'Identity only' } }
});
assert.equal(identityOnly.hasIngredient('identity_only', 'Karbamid').exists, true);
assert.equal(identityOnly.getFact('identity_only', 'ingredientBenefits').status, 'unavailable');
assert.equal(identityOnly.getFact('identity_only', 'ingredientBenefits').value, null);

const realMapping = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'canonical-unas-mapping.json'), 'utf8'));
const realSnapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'unas-catalog-snapshot.json'), 'utf8'));
const realResolver = createProductFactsResolver({ mappingData: realMapping, snapshotData: realSnapshot });
const shampooUsage = realResolver.getFact('dermavital_sampon', 'usageInstructions');
assert.equal(shampooUsage.status, 'grounded');
assert.equal(shampooUsage.provenance[0].sourceType, 'unas_snapshot');
assert.equal(shampooUsage.provenance[0].sourceId, 'unas:1553769891');
assert.match(shampooUsage.value, /Vigyél fel kisebb mennyiséget a nedves hajra/);
assert.match(shampooUsage.value, /egészítsd ki a Dermavital termékcsalád többi tagjával\.$/);
assert.doesNotMatch(shampooUsage.value, /A Dermavital termékcsalád A Dermavital Sampon/);

const soapUsage = realResolver.getFact('dermavital_szappan', 'usageInstructions');
assert.equal(soapUsage.status, 'grounded');
assert.equal(soapUsage.provenance[0].sourceType, 'unas_snapshot');
assert.match(soapUsage.value, /^Nedvesítsd be a szappant/);
assert.match(soapUsage.value, /Holt-tengeri só balzsamot is\.$/);
assert.doesNotMatch(soapUsage.value, /nedves hajra|Dermavital Sampon/);
assert.doesNotMatch(shampooUsage.value, /Nedvesítsd be a szappant/);

const malformedSnapshot = {
  ...realSnapshot,
  products: realSnapshot.products.map((product) => String(product.unasId) === '1553769891'
    ? { ...product, longDescription: 'A rendszeres használat mellett fontos a kíméletes hajápolás. Nincs külön használati fejezet.' }
    : product)
};
const malformedResolver = createProductFactsResolver({ mappingData: realMapping, snapshotData: malformedSnapshot });
assert.equal(malformedResolver.getFact('dermavital_sampon', 'usageInstructions').status, 'unavailable');
assert.equal(malformedResolver.getFact('dermavital_sampon', 'usageInstructions').value, null);

const typedIngredientCases = {
  rozmaringos_samponszappan: { sourceId: 'unas:1467825966', ingredients: /Rozmaring illóolaj/, inci: /Rosmarinus Officinalis Leaf Oil/ },
  teafa_aktiv_szen_samponszappan: { sourceId: 'unas:1467818511', ingredients: /Aktív szén/, inci: /Charcoal Powder/ },
  holt_tengeri_iszapos_szappan: { sourceId: 'unas:111374989', ingredients: /Holt Tengeri iszap/, inci: null },
  katrany_szappan: { sourceId: 'unas:111374984', ingredients: null, inci: /Sodium shale oil sulfonate/ },
  shea_vajas_szappan: { sourceId: 'unas:111374997', ingredients: /Shea vaj/, inci: /Butyrospermum Parkii Butter/ },
  kecsketejes_levendulas_szappan: { sourceId: 'unas:1241471919', ingredients: /Levendula illóolaj/, inci: /Lavandula Angustifolia Oil/ },
  oliva_szappan: { sourceId: 'unas:111374990', ingredients: /kecsketej/, inci: /Caprae Lac/ },
  teafa_szappan: { sourceId: 'unas:111374987', ingredients: /Argán olaj/, inci: /Melaleuca Alternifolia Oil/ },
  tengeri_soszappan: { sourceId: 'unas:111374991', ingredients: /Tengeri só/, inci: /Sodium Chloride/ }
};
const typedFingerprints = [];
for (const [productId, expected] of Object.entries(typedIngredientCases)) {
  const record = realResolver.getProductFacts(productId);
  assert.equal(record.canonicalProductId, productId);
  for (const [factType, marker] of [['ingredients', expected.ingredients], ['inci', expected.inci]]) {
    const fact = record.facts[factType];
    if (!marker) {
      assert.equal(fact.status, 'unavailable', `${productId}:${factType}`);
      assert.equal(fact.value, null, `${productId}:${factType}`);
      continue;
    }
    assert.equal(fact.status, 'grounded', `${productId}:${factType}`);
    assert.equal(fact.provenance[0].sourceType, 'unas_snapshot', `${productId}:${factType}`);
    assert.equal(fact.provenance[0].sourceId, expected.sourceId, `${productId}:${factType}`);
    assert.equal(fact.provenance[0].productId, productId, `${productId}:${factType}`);
    const rawValues = factType === 'ingredients' ? fact.value.map((item) => item.rawName) : fact.value;
    const serialized = rawValues.join(' | ');
    assert.match(serialized, marker, `${productId}:${factType}`);
    assert.doesNotMatch(serialized, /\b(?:INCI|Ingredients|Összetevők)\b|\*|szappanosodás során|illóolaj(?:ok)? természetes összetevői/i, `${productId}:${factType}`);
    if (factType === 'ingredients') assert.doesNotMatch(serialized, /\bSodium\b|\bAqua\b|\bCaprae Lac\b/, productId);
    typedFingerprints.push(`${productId}:${factType}:${JSON.stringify(rawValues)}`);
  }
}
assert.equal(new Set(typedFingerprints).size, typedFingerprints.length);
assert.doesNotMatch(realResolver.getFact('rozmaringos_samponszappan', 'ingredients').value.map((item) => item.rawName).join(' '), /Charcoal|Melaleuca/);
assert.doesNotMatch(realResolver.getFact('teafa_szappan', 'inci').value.join(' '), /Sodium Chloride|Rosmarinus Officinalis/);

const creamInci = realResolver.getFact('dermavital_krem', 'inci');
assert.equal(creamInci.status, 'grounded');
assert.equal(creamInci.provenance[0].sourceId, 'unas:1412837511');
assert.match(creamInci.value.join(' | '), /Urea \(Karbamid\)/);
assert.equal(realResolver.getFact('dermavital_krem', 'ingredients').status, 'unavailable');
const greenTeaInci = realResolver.getFact('solid_shampoo_normal_green_tea', 'inci');
assert.equal(greenTeaInci.status, 'grounded');
assert.equal(greenTeaInci.provenance[0].sourceId, 'unas:1229849469');
assert.match(greenTeaInci.value.join(' | '), /Sodium Cocoyl Isethionate – SCI/);
assert.match(greenTeaInci.value.join(' | '), /Parfum – Illat \(zöldtea és bergamott\)/);

function fixtureFacts(longDescription) {
  const fixture = createProductFactsResolver({
    mappingData: { mappings: [{ canonicalId: 'ingredient_fixture', unasId: 'ingredient-1', sku: 'ING', mappingStatus: 'approved' }] },
    snapshotData: { generatedAt: '2026-10-06T00:00:00Z', products: [{
      unasId: 'ingredient-1', sku: 'ING', name: 'Ingredient fixture', longDescription,
      actualPriceGross: 1, currency: 'HUF', url: 'https://www.vitalis-szappan.hu/ingredient-fixture'
    }] },
    deterministicProducts: {}
  });
  return { ingredients: fixture.getFact('ingredient_fixture', 'ingredients'), inci: fixture.getFact('ingredient_fixture', 'inci') };
}

for (const description of [
  'Összetevők: Kókuszolaj, Shea vaj INCI: Sodium Cocoate, Aqua',
  'Összetevők (INCI): Sodium Cocoate, Aqua Összetevők: Kókuszolaj, Shea vaj',
  'Összetevők: Kókuszolaj, Shea vaj Ingredients: Sodium Cocoate, Aqua *: magyarázó lábjegyzet'
]) {
  const facts = fixtureFacts(description);
  assert.equal(facts.ingredients.status, 'grounded', description);
  assert.equal(facts.inci.status, 'grounded', description);
  assert.deepEqual(facts.ingredients.value.map((item) => item.rawName), ['Kókuszolaj', 'Shea vaj'], description);
  assert.deepEqual(facts.inci.value, ['Sodium Cocoate', 'Aqua'], description);
}

const marketingOnly = fixtureFacts('A rozmaringolaj és a shea vaj ápoló hatásáról ismert, az aktív szén pedig tiszta érzetet ad.');
assert.equal(marketingOnly.ingredients.status, 'unavailable');
assert.equal(marketingOnly.inci.status, 'unavailable');
const questionableInci = fixtureFacts('INCI: Sodium Cocoate, Sodium Sunflowerseedate?, Aqua');
assert.equal(questionableInci.inci.status, 'unavailable');
const cleanPlainMalformedInci = fixtureFacts('Összetevők: Kókuszolaj, Shea vaj INCI: Sodium Cocoate, Broken?');
assert.equal(cleanPlainMalformedInci.ingredients.status, 'grounded');
assert.equal(cleanPlainMalformedInci.inci.status, 'unavailable');
const malformedPlainCleanInci = fixtureFacts('Összetevők: szappanosított, ricinus olaj INCI: Sodium Castorate, Aqua');
assert.equal(malformedPlainCleanInci.ingredients.status, 'unavailable');
assert.equal(malformedPlainCleanInci.inci.status, 'grounded');
const uncertainBoundary = fixtureFacts('Összetevők: Kókuszolaj, Shea vaj Ismeretlen rész: marketing szöveg.');
assert.equal(uncertainBoundary.ingredients.status, 'unavailable');
assert.equal(uncertainBoundary.inci.status, 'unavailable');

const mappedIngredientFacts = realMapping.mappings.filter((item) => item.mappingStatus === 'approved').map((item) => ({
  productId: item.canonicalId,
  ingredients: realResolver.getFact(item.canonicalId, 'ingredients'),
  inci: realResolver.getFact(item.canonicalId, 'inci')
}));
assert.equal(mappedIngredientFacts.length, 18);
assert.equal(mappedIngredientFacts.filter((item) => item.ingredients.status === 'grounded').length, 8);
assert.equal(mappedIngredientFacts.filter((item) => item.inci.status === 'grounded').length, 10);
assert.equal(mappedIngredientFacts.filter((item) => item.ingredients.status === 'grounded' && item.inci.status === 'grounded').length, 7);
assert.equal(mappedIngredientFacts.filter((item) => item.ingredients.status === 'grounded' || item.inci.status === 'grounded').length, 11);
assert.deepEqual(mappedIngredientFacts.filter((item) => item.ingredients.status !== 'grounded' && item.inci.status !== 'grounded')
  .map((item) => item.productId).sort(), [
  'dermavital_sampon', 'dermavital_szappan', 'holt_tengeri_so_balzsam', 'natur_kecsketejes_szappan',
  'parajdi_sotomb', 'psorivital_csomag', 'solid_shampoo_oily_rosemary_caffeine'
]);
for (const item of mappedIngredientFacts) {
  const benefits = realResolver.getFact(item.productId, 'ingredientBenefits');
  if (benefits.status === 'grounded') {
    assert.ok(benefits.value.every((benefit) => realResolver.hasIngredient(item.productId, benefit.ingredientId).exists === true), item.productId);
  }
}

const repairedUsageCases = {
  solid_shampoo_normal_green_tea: {
    sourceId: 'unas:1229849469', include: /Habosítsd fel a sampont/, exclude: /használat mellett|Milyen összetevőkkel|INCI/
  },
  shea_vajas_szappan: {
    sourceId: 'unas:111374997', include: /Habosítsd fel nedves bőrön/, exclude: /használat mellett|Fedezd fel|Összetevők/
  },
  natur_kecsketejes_szappan: {
    sourceId: 'unas:1241472589', include: /hagyja hatni néhány másodpercig/, exclude: /használat mellett|További száraz bőrre|Összetevők/
  },
  kecsketejes_levendulas_szappan: {
    sourceId: 'unas:1241471919', include: /hagyd hatni néhány másodpercig/, exclude: /használat mellett|További száraz bőrre|illatmentes megoldást/
  },
  psorivital_csomag: {
    sourceId: 'unas:1120057029', include: /Használd napi 1–2 alkalommal rendszeresen\.$/, exclude: /Miért működik|összehangolt használata/
  },
  holt_tengeri_so_balzsam: {
    sourceId: 'unas:163833663', include: /Vigyél fel egy vékony réteget/, exclude: /Miért választják|Tipp|Nem tudod|Mire figyelj/
  }
};
const repairedValues = [];
for (const [productId, expected] of Object.entries(repairedUsageCases)) {
  const record = realResolver.getProductFacts(productId);
  assert.equal(record.canonicalProductId, productId);
  const usage = record.facts.usageInstructions;
  assert.equal(usage.status, 'grounded', productId);
  assert.equal(usage.provenance[0].sourceType, 'unas_snapshot', productId);
  assert.equal(usage.provenance[0].sourceId, expected.sourceId, productId);
  assert.equal(usage.provenance[0].productId, productId);
  assert.match(usage.value, expected.include, productId);
  assert.doesNotMatch(usage.value, expected.exclude, productId);
  repairedValues.push(usage.value);
}
assert.equal(new Set(repairedValues).size, repairedValues.length);
assert.doesNotMatch(realResolver.getFact('solid_shampoo_normal_green_tea', 'usageInstructions').value, /Habosítsd fel nedves bőrön/);
assert.doesNotMatch(realResolver.getFact('shea_vajas_szappan', 'usageInstructions').value, /fejbőrödbe|Holt-tengeri iszapos/);

for (const [productId, marker] of [
  ['dermavital_sampon', /Vigyél fel kisebb mennyiséget a nedves hajra/],
  ['dermavital_szappan', /^Nedvesítsd be a szappant/],
  ['dermavital_krem', /^Vékony rétegben vidd fel/],
  ['holt_tengeri_iszapos_szappan', /^Nedvesítsd meg a bőrt/],
  ['parajdi_sotomb', /^Zuhanyzás vagy fürdés után/]
]) {
  const usage = realResolver.getFact(productId, 'usageInstructions');
  assert.equal(usage.status, 'grounded', productId);
  assert.equal(usage.provenance[0].sourceType, 'unas_snapshot', productId);
  assert.match(usage.value, marker, productId);
}
const tarUsage = realResolver.getFact('katrany_szappan', 'usageInstructions');
assert.equal(tarUsage.status, 'grounded');
assert.equal(tarUsage.provenance[0].sourceType, 'owner_approved');
assert.equal(tarUsage.provenance[0].sourceId, 'owner-approved:acne:katrany:hair-washing:v1');

function fixtureUsage(longDescription) {
  const fixture = createProductFactsResolver({
    mappingData: { mappings: [{ canonicalId: 'fixture', unasId: 'fixture-1', sku: 'FIXTURE', mappingStatus: 'approved' }] },
    snapshotData: { generatedAt: '2026-10-06T00:00:00Z', products: [{
      unasId: 'fixture-1', sku: 'FIXTURE', name: 'Fixture', longDescription,
      actualPriceGross: 1, currency: 'HUF', url: 'https://www.vitalis-szappan.hu/fixture'
    }] },
    deterministicProducts: {}
  });
  return fixture.getFact('fixture', 'usageInstructions');
}

for (const prose of [
  'Miért jó rendszeres használat mellett?',
  'A rendszeres használat mellett: puhább érzet várható.',
  'Használat során figyelj a bőröd jelzéseire.',
  'Használat közben kerüld a szembe jutást.',
  'A termék használatával komfortosabb érzet érhető el.',
  'A mindennapi használathoz készült.'
]) {
  assert.equal(fixtureUsage(prose).status, 'unavailable', prose);
}

for (const [description, included, excluded] of [
  ['Használati javaslat Kend fel vékony rétegben. Miért választják sokan? Marketing szöveg.', /Kend fel vékony rétegben\.$/, /Miért|Marketing/],
  ['Használati utasítás: Nedvesítsd be, majd öblítsd le. INCI: Aqua, Urea', /Nedvesítsd be, majd öblítsd le\.$/, /INCI|Aqua/],
  ['Hogyan használd? Vidd fel, majd öblítsd le. Mire figyelj? Kerüld a szemet.', /Vidd fel, majd öblítsd le\.$/, /Mire figyelj|Kerüld/]
]) {
  const usage = fixtureUsage(description);
  assert.equal(usage.status, 'grounded', description);
  assert.match(usage.value, included, description);
  assert.doesNotMatch(usage.value, excluded, description);
}
assert.equal(fixtureUsage('Használati javaslat Összetevők: Aqua').status, 'unavailable');
assert.equal(fixtureUsage('Használati javaslat Kend fel. Következő rész: bizonytalan tartalom.').status, 'unavailable');

const mappedIds = realMapping.mappings.filter((item) => item.mappingStatus === 'approved').map((item) => item.canonicalId);
const groundedUsageIds = mappedIds.filter((productId) => realResolver.getFact(productId, 'usageInstructions').status === 'grounded');
const trueUsageGaps = mappedIds.filter((productId) => realResolver.getFact(productId, 'usageInstructions').status !== 'grounded');
assert.equal(mappedIds.length, 18);
assert.equal(groundedUsageIds.length, 15);
assert.deepEqual(trueUsageGaps.sort(), ['oliva_szappan', 'teafa_szappan', 'tengeri_soszappan']);
for (const productId of groundedUsageIds) {
  assert.doesNotMatch(realResolver.getFact(productId, 'usageInstructions').value,
    /(?:használat mellett[?:]|Miért működik együtt|Miért választják sokan|Fedezd fel további|További száraz bőrre|\bINCI\b|Összetevők)/i,
    productId);
}

const groundedDescriptionIds = mappedIds.filter((productId) => realResolver.getFact(productId, 'productDescription').status === 'grounded');
const unavailableDescriptionIds = mappedIds.filter((productId) => realResolver.getFact(productId, 'productDescription').status !== 'grounded');
assert.equal(groundedDescriptionIds.length, 14);
assert.deepEqual(unavailableDescriptionIds.sort(), ['katrany_szappan', 'oliva_szappan', 'teafa_szappan', 'tengeri_soszappan']);

const directDescriptionCases = {
  rozmaringos_samponszappan: /hajmosó szappan/i,
  teafa_aktiv_szen_samponszappan: /zsíros, gyorsan zsírosodó hajra/i,
  dermavital_krem: /bőrápoló krém/i,
  dermavital_szappan: /kíméletesen tisztítja/i,
  shea_vajas_szappan: /száraz, vízhiányos bőr/i,
  kecsketejes_levendulas_szappan: /érzékeny, kipirosodásra hajlamos bőr/i,
  parajdi_sotomb: /természetes sótömb/i
};
for (const [productId, marker] of Object.entries(directDescriptionCases)) {
  const fact = realResolver.getFact(productId, 'productDescription');
  assert.equal(fact.status, 'grounded', productId);
  assert.match(fact.value, marker, productId);
  assert.equal(fact.provenance[0].sourceType, 'unas_snapshot', productId);
  assert.equal(fact.provenance[0].productId, productId);
}

const recoveredDescriptionCases = {
  dermavital_sampon: /Dermavital Sampon/i,
  solid_shampoo_normal_green_tea: /szilárd sampon/i,
  solid_shampoo_oily_rosemary_caffeine: /zsírosodásra hajlamos/i,
  psorivital_csomag: /napi ápolási rendszer/i,
  holt_tengeri_so_balzsam: /Intenzív bőrápoló balzsam/i,
  holt_tengeri_iszapos_szappan: /Holt-tengeri iszap szappan/i,
  natur_kecsketejes_szappan: /mindennapos ápolására készült/i
};
for (const [productId, marker] of Object.entries(recoveredDescriptionCases)) {
  const fact = realResolver.getFact(productId, 'productDescription');
  assert.equal(fact.status, 'grounded', productId);
  assert.match(fact.value, marker, productId);
}

for (const productId of groundedDescriptionIds) {
  const value = realResolver.getFact(productId, 'productDescription').value;
  assert.doesNotMatch(value, /Hogyan használd|Használati|\bINCI\b|Ingredients\s*:|Összetevők\s*:|Fontos tudnival|Gyakori kérdések|Fedezd fel|Iratkozz fel|Rendeld meg/i, productId);
  assert.doesNotMatch(value, /gyógyít|kezelés|antibakteriális|fertőtlen|serkenti a hajnövekedést|csökkenti a gyulladást|megszünteti/i, productId);
}

function fixtureDescription({ shortDescription = null, longDescription = null, approvedFacts = [], deterministic = {} }) {
  const fixture = createProductFactsResolver({
    mappingData: { mappings: [{ canonicalId: 'description_fixture', unasId: 'description-1', sku: 'DESC', mappingStatus: 'approved' }] },
    snapshotData: { generatedAt: '2026-10-07T00:00:00Z', products: [{ unasId: 'description-1', sku: 'DESC', name: 'Fixture szappan', shortDescription, longDescription }] },
    deterministicProducts: deterministic,
    approvedFactData: { facts: approvedFacts }
  });
  return fixture.getFact('description_fixture', 'productDescription');
}

assert.equal(fixtureDescription({ shortDescription: 'Kíméletes kézműves szappan száraz és érzékeny bőr mindennapi kozmetikai tisztítására.' }).status, 'grounded');
assert.equal(fixtureDescription({ shortDescription: 'Antibakteriális szappan, amely csökkenti a gyulladást és kezeli a problémás bőrt.' }).status, 'unavailable');
assert.equal(fixtureDescription({ shortDescription: 'Használat: nedves bőrön habosítsd fel a szappant.' }).status, 'unavailable');
assert.equal(fixtureDescription({ longDescription: 'Ez a kíméletes kézműves szappan száraz és érzékeny bőr mindennapi kozmetikai tisztítására készült. Hogyan használd? Habosítsd fel. INCI: Aqua.' }).value,
  'Ez a kíméletes kézműves szappan száraz és érzékeny bőr mindennapi kozmetikai tisztítására készült.');
assert.equal(fixtureDescription({ deterministic: { description_fixture: { name: 'Fixture', description: 'Statikus leírás.' } } }).status, 'unavailable');
const ownerDescription = fixtureDescription({
  shortDescription: 'Kíméletes kézműves szappan száraz és érzékeny bőr mindennapi kozmetikai tisztítására.',
  approvedFacts: [{ productId: 'description_fixture', factType: 'productDescription', value: 'Tulajdonos által jóváhagyott leírás.', sourceType: 'owner_approved', sourceId: 'owner:description:v1', approved: true }]
});
assert.equal(ownerDescription.value, 'Tulajdonos által jóváhagyott leírás.');
assert.equal(ownerDescription.provenance[0].sourceType, 'owner_approved');

console.log('Product Facts regressions: PASS (15/18 safe usage, boundaries, provenance, fail-closed negatives)');
