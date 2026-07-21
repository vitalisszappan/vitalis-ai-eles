'use strict';

const assert = require('assert');
const mapping = require('./data/canonical-unas-mapping.json');

const EXPECTED_CANONICAL_IDS = [
  'dermavital_sampon',
  'rozmaringos_samponszappan',
  'dermavital_krem',
  'dermavital_szappan',
  'psorivital_csomag',
  'holt_tengeri_so_balzsam',
  'holt_tengeri_iszapos_szappan',
  'aktiv_szenes_szappan',
  'katrany_szappan',
  'shea_vajas_szappan'
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
assert.equal(mapping.mappings.length, 10);

const canonicalIds = mapping.mappings.map((item) => item.canonicalId);
assertUnique(canonicalIds, 'canonicalId');
assert.deepEqual([...canonicalIds].sort(), [...EXPECTED_CANONICAL_IDS].sort());

const approved = mapping.mappings.filter((item) => item.mappingStatus === 'approved');
assert.equal(approved.length, 9);

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

assertUnique(approved.map((item) => item.unasId), 'unasId');
assertUnique(approved.map((item) => item.sku), 'sku');

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
