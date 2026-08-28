'use strict';

const fs = require('node:fs');
const path = require('node:path');

function installCatalogFixture(fixturePath) {
  const resolvedFixturePath = path.resolve(fixturePath);
  if (!fs.existsSync(resolvedFixturePath)) throw new Error(`Missing catalog fixture: ${resolvedFixturePath}`);
  const fixture = JSON.parse(fs.readFileSync(resolvedFixturePath, 'utf8'));

  if (fixture.source !== 'deterministic-test-fixture') {
    throw new Error(`Refusing non-test catalog fixture: ${resolvedFixturePath}`);
  }

  const hadPrevious = Object.prototype.hasOwnProperty.call(process.env, 'UNAS_CATALOG_SNAPSHOT_PATH');
  const previous = process.env.UNAS_CATALOG_SNAPSHOT_PATH;
  process.env.UNAS_CATALOG_SNAPSHOT_PATH = resolvedFixturePath;

  let restored = false;
  return function restoreCatalogFixture() {
    if (restored) return;
    restored = true;
    if (hadPrevious) process.env.UNAS_CATALOG_SNAPSHOT_PATH = previous;
    else delete process.env.UNAS_CATALOG_SNAPSHOT_PATH;
  };
}

module.exports = { installCatalogFixture };

if (process.env.VITALIS_TEST_CATALOG_FIXTURE) {
  installCatalogFixture(process.env.VITALIS_TEST_CATALOG_FIXTURE);
}
