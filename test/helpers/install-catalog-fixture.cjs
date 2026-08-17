'use strict';

const fs = require('node:fs');
const path = require('node:path');

function installCatalogFixture(fixturePath) {
  const snapshotPath = path.resolve(__dirname, '..', '..', 'data', 'unas-catalog-snapshot.json');
  const resolvedFixturePath = path.resolve(fixturePath);
  const fixtureBuffer = fs.readFileSync(resolvedFixturePath);
  const fixtureStat = fs.statSync(resolvedFixturePath);
  const fixture = JSON.parse(fixtureBuffer.toString('utf8'));

  if (fixture.source !== 'deterministic-test-fixture') {
    throw new Error(`Refusing non-test catalog fixture: ${resolvedFixturePath}`);
  }

  const originalReadFileSync = fs.readFileSync;
  const originalStatSync = fs.statSync;
  const isSnapshotPath = (value) => path.resolve(String(value)) === snapshotPath;

  fs.readFileSync = function readFileSync(filePath, options) {
    if (!isSnapshotPath(filePath)) return originalReadFileSync.call(this, filePath, options);
    if (typeof options === 'string') return fixtureBuffer.toString(options);
    if (options?.encoding) return fixtureBuffer.toString(options.encoding);
    return Buffer.from(fixtureBuffer);
  };
  fs.statSync = function statSync(filePath, options) {
    if (!isSnapshotPath(filePath)) return originalStatSync.call(this, filePath, options);
    return fixtureStat;
  };

  let restored = false;
  return function restoreCatalogFixture() {
    if (restored) return;
    restored = true;
    fs.readFileSync = originalReadFileSync;
    fs.statSync = originalStatSync;
  };
}

module.exports = { installCatalogFixture };

if (process.env.VITALIS_TEST_CATALOG_FIXTURE) {
  installCatalogFixture(process.env.VITALIS_TEST_CATALOG_FIXTURE);
}
