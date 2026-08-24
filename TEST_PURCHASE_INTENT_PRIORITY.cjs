'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');

const restoreCatalogFixture = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restoreCatalogFixture);

const { routeAnswer } = require('./engine/answer-router.cjs');

const route = (question) => routeAnswer({ question, history: [], knowledge: [], ruleEngine: null });

for (const question of [
  'Nem kérek mást csak a krémet nem enged tovább',
  'Miért nem lehet csak krémet rendelni?',
  'miért nem tudom megvenni?'
]) {
  const result = route(question);
  assert.equal(result.route, 'commerce', question);
  assert.equal(result.intent, 'checkout_problem', question);
}

for (const question of [
  'csak ezt kérem',
  'nem kell más',
  'ezt akarom megrendelni',
  'csak a krémet szeretném'
]) {
  const result = route(question);
  assert.equal(result.route, 'commerce', question);
  assert.equal(result.intent, 'order_start', question);
}

for (const question of [
  'Van krém?',
  'Milyen krémek vannak?',
  'Melyik krémet ajánlod?'
]) {
  const result = route(question);
  assert.equal(result.route, 'product_category', question);
  assert.notEqual(result.intent, 'checkout_problem', question);
  assert.notEqual(result.intent, 'order_start', question);
}

restoreCatalogFixture();
console.log('Purchase intent priority regression tests passed.');
