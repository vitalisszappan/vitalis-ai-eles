'use strict';

const assert = require('assert');
const mapping = require('./data/canonical-unas-mapping.json');
const snapshot = require('./data/unas-catalog-snapshot.json');
const { buildCommerceIndex } = require('./engine/product-registry.cjs');

const BATCH_1 = [
  ['mentas_kave_szappan', '1511229416', 'Vsz023', 'soap'],
  ['mentas_citrom_tusfurdo', '1423192981', 'VTUS07', 'shower_gel'],
  ['rozsa_tusfurdo', '1423189211', 'VTUS05', 'shower_gel'],
  ['levendula_tusfurdo', '1423186461', 'VTUS04', 'shower_gel'],
  ['teafa_levendula_tusfurdo', '1423171731', 'VTUS03', 'shower_gel'],
  ['barack_tusfurdo', '1423140766', 'VTUS02', 'shower_gel'],
  ['citromfuves_szappan', '679258019', 'Vcfsz101', 'soap'],
  ['aloe_vera_szappan', '423469634', 'VSZ026', 'soap'],
  ['csipkebogyo_szappan', '423468118', 'VSZ025', 'soap'],
  ['hevizi_gyogyiszapos_termal_szappan', '116883769', 'Vsz23', 'soap'],
  ['dioliget_szappan', '111375002', 'VSZ024', 'soap'],
  ['csalan_szappan', '111375001', 'VSZ022', 'soap'],
  ['sargarepa_shea_vajas_szappan', '111374999', 'Vsz018', 'soap'],
  ['gyogynoveny_szappan', '111374998', 'Vsz017', 'soap'],
  ['koromvirag_szappan', '111374995', 'Vsz014', 'soap'],
  ['kecsketejes_etcsokis_kremvarazs_szappan', '111374994', 'Vsz013', 'soap'],
  ['levendula_szappan', '111374988', 'Vsz006', 'soap'],
  ['chilis_etcsokis_szappan', '111374985', 'Vsz003', 'soap'],
  ['kecsketejes_mezes_szappan', '111374983', 'Vsz001', 'soap']
];

const EXPECTED_CANONICAL_IDS = [
  'dermavital_sampon',
  'rozmaringos_samponszappan',
  'teafa_aktiv_szen_samponszappan',
  'solid_shampoo_normal_green_tea',
  'solid_shampoo_oily_rosemary_caffeine',
  'dermavital_krem',
  'dermavital_szappan',
  'psorivital_csomag',
  'holt_tengeri_so_balzsam',
  'holt_tengeri_iszapos_szappan',
  'tengeri_soszappan',
  'aktiv_szenes_szappan',
  'katrany_szappan',
  'shea_vajas_szappan',
  'natur_kecsketejes_szappan',
  'kecsketejes_levendulas_szappan',
  'oliva_szappan',
  'teafa_szappan',
  'parajdi_sotomb',
  ...BATCH_1.map(([canonicalId]) => canonicalId)
];

function assertUnique(values, label) {
  assert.equal(
    new Set(values).size,
    values.length,
    `${label}: duplikált érték található.`
  );
}

assert.equal(mapping.schema, 'vitalis-canonical-unas-mapping/v1');
assert.equal(mapping.version, 1);
assert.ok(Array.isArray(mapping.mappings));
assert.equal(mapping.mappings.length, 38);

const canonicalIds = mapping.mappings.map((item) => item.canonicalId);
assertUnique(canonicalIds, 'canonicalId');
assert.deepEqual([...canonicalIds].sort(), [...EXPECTED_CANONICAL_IDS].sort());

const approved = mapping.mappings.filter((item) => item.mappingStatus === 'approved');
assert.equal(approved.length, 37);

for (const item of approved) {
  assert.equal(typeof item.canonicalId, 'string');
  assert.match(item.unasId, /^\d+$/);
  assert.equal(typeof item.sku, 'string');
  assert.ok(item.sku.length > 0);
  assert.equal(typeof item.verifiedName, 'string');
  assert.ok(item.verifiedName.length > 0);
  assert.equal(item.mappingStatus, 'approved');
  assert.ok(Number.isFinite(Date.parse(item.approvedAt)));
}

const hairTypes = Object.fromEntries(approved.filter((item) => ['liquid_shampoo', 'shampoo_soap', 'solid_shampoo'].includes(item.productType)).map((item) => [item.canonicalId, item.productType]));
assert.deepEqual(hairTypes, {
  dermavital_sampon: 'liquid_shampoo',
  rozmaringos_samponszappan: 'shampoo_soap',
  teafa_aktiv_szen_samponszappan: 'shampoo_soap',
  solid_shampoo_normal_green_tea: 'solid_shampoo',
  solid_shampoo_oily_rosemary_caffeine: 'solid_shampoo'
});

assertUnique(approved.map((item) => item.unasId), 'unasId');
assertUnique(approved.map((item) => item.sku), 'sku');

for (const [canonicalId, unasId, sku, productType] of BATCH_1) {
  const item = approved.find((candidate) => candidate.canonicalId === canonicalId);
  assert.ok(item, canonicalId);
  assert.equal(item.unasId, unasId, canonicalId);
  assert.equal(item.sku, sku, canonicalId);
  assert.equal(item.productType, productType, canonicalId);
  const products = snapshot.products.filter((product) => String(product.unasId) === unasId);
  assert.equal(products.length, 1, canonicalId);
  assert.equal(products[0].sku, sku, canonicalId);
  assert.equal(products[0].name, item.verifiedName, canonicalId);
}

function indexWithMutation(mutate) {
  const cloned = JSON.parse(JSON.stringify(mapping));
  mutate(cloned.mappings);
  return buildCommerceIndex(cloned, snapshot);
}

const controlIndex = buildCommerceIndex(mapping, snapshot);
assert.equal(controlIndex.size, 37);
assert.equal(indexWithMutation((items) => { items.find((item) => item.canonicalId === 'mentas_kave_szappan').canonicalId = 'dermavital_sampon'; }).has('dermavital_sampon'), false);
assert.equal(indexWithMutation((items) => { items.find((item) => item.canonicalId === 'mentas_kave_szappan').unasId = '1553769891'; }).has('mentas_kave_szappan'), false);
assert.equal(indexWithMutation((items) => { items.find((item) => item.canonicalId === 'mentas_kave_szappan').sku = 'Vitdermsamp01'; }).has('mentas_kave_szappan'), false);
assert.equal(indexWithMutation((items) => { items.find((item) => item.canonicalId === 'mentas_kave_szappan').sku = 'MISMATCH'; }).has('mentas_kave_szappan'), false);

const activeCharcoal = mapping.mappings.find(
  (item) => item.canonicalId === 'aktiv_szenes_szappan'
);
assert.ok(activeCharcoal);
assert.equal(activeCharcoal.mappingStatus, 'needs_review');
assert.equal(Object.hasOwn(activeCharcoal, 'unasId'), false);
assert.equal(Object.hasOwn(activeCharcoal, 'sku'), false);
assert.equal(activeCharcoal.approvedAt, null);
assert.match(activeCharcoal.note, /eltérő terméktípusú samponszappan/);

console.log('TEST_CANONICAL_UNAS_MAPPING: minden ellenőrzés sikeres');
