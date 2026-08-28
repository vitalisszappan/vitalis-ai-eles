'use strict';

const assert = require('node:assert/strict');
const { createCatalogSearch } = require('./engine/catalog-search.cjs');

const catalog = createCatalogSearch();
const detected = catalog.detectCategory('Repedt sarokra mit ajánlasz?');
assert.equal(detected?.id, 'heel_care');

const result = catalog.searchCategory('heel_care');
assert.equal(result.category?.id, 'heel_care');
assert.deepEqual(result.products, [], 'Generikus testápoló és shea-vaj termék nem lehet automatikusan heel_care candidate.');

console.log('Heel-care catalog regression: PASS (query detected, unproven generic candidates excluded)');
