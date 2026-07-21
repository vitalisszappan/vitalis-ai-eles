'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_UNAS_SYNC_INTERVAL_MS,
  SAFE_SYNC_ERROR,
  createUnasSyncCoordinator,
  parseSyncInterval
} = require('./unas-sync-coordinator.cjs');
const { createProductRegistry } = require('./engine/product-registry.cjs');
const { PRODUCTS, productCards } = require('./engine/product-catalog.cjs');

function snapshot(product = {}) {
  return {
    schema: 'vitalis-unas-commerce-catalog/v1',
    generatedAt: '2026-07-21T10:00:00.000Z',
    products: [{ unasId: '1001', sku: 'SKU-1001', name: 'UNAS termék', ...product }],
    categories: [],
    audit: { totalRecords: 1 }
  };
}

function writeSnapshot(filePath, value = snapshot()) {
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Az aszinkron feltétel nem teljesült időben.');
}

async function main() {
  assert.equal(DEFAULT_UNAS_SYNC_INTERVAL_MS, 21600000);
  assert.equal(parseSyncInterval(undefined), 21600000);
  assert.equal(parseSyncInterval(''), 21600000);
  assert.equal(parseSyncInterval('hibás'), 21600000);
  assert.equal(parseSyncInterval('-1'), 21600000);
  assert.equal(parseSyncInterval('0'), 0);
  assert.equal(parseSyncInterval('1234'), 1234);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-unas-coordinator-'));
  try {
    const missingPath = path.join(tempDir, 'missing.json');
    const deferred = [];
    const timers = [];
    let startupCalls = 0;
    const startupCoordinator = createUnasSyncCoordinator({
      snapshotPath: missingPath,
      apiConfigured: () => true,
      buildSync: async () => {
        startupCalls += 1;
        writeSnapshot(missingPath);
        return { products: 1, categories: 0, audit: { totalRecords: 1 } };
      },
      defer: (callback) => deferred.push(callback),
      setIntervalFn: (callback, delay) => {
        const timer = { callback, delay, unrefCalled: false, unref() { this.unrefCalled = true; } };
        timers.push(timer);
        return timer;
      },
      clearIntervalFn: () => {},
      logger: { info() {}, error() {} }
    });
    const startup = startupCoordinator.start();
    assert.equal(startup.startupScheduled, true);
    assert.equal(startupCalls, 0);
    assert.equal(deferred.length, 1);
    assert.equal(timers[0].delay, 21600000);
    assert.equal(timers[0].unrefCalled, true);
    deferred[0]();
    await waitUntil(() => startupCalls === 1 && !startupCoordinator.status().unasSyncInProgress);
    assert.equal(startupCoordinator.status().snapshotPresent, true);
    assert.ok(startupCoordinator.status().lastSuccessfulUnasSyncAt);
    timers[0].callback();
    await waitUntil(() => startupCalls === 2 && !startupCoordinator.status().unasSyncInProgress);

    const unconfiguredDeferred = [];
    let unconfiguredTimerCalls = 0;
    const unconfiguredCoordinator = createUnasSyncCoordinator({
      snapshotPath: path.join(tempDir, 'unconfigured.json'),
      apiConfigured: () => false,
      buildSync: async () => { throw new Error('Nem futhat le.'); },
      defer: (callback) => unconfiguredDeferred.push(callback),
      setIntervalFn: () => { unconfiguredTimerCalls += 1; },
      logger: { info() {}, error() {} }
    });
    assert.equal(unconfiguredCoordinator.start().startupScheduled, false);
    assert.equal(unconfiguredDeferred.length, 0);
    assert.equal(unconfiguredTimerCalls, 0);

    const existingPath = path.join(tempDir, 'existing.json');
    writeSnapshot(existingPath);
    const existingDeferred = [];
    const existingCoordinator = createUnasSyncCoordinator({
      snapshotPath: existingPath,
      apiConfigured: () => true,
      buildSync: async () => { throw new Error('Nem futhat le.'); },
      defer: (callback) => existingDeferred.push(callback),
      setIntervalFn: () => ({ unref() {} }),
      clearIntervalFn: () => {},
      logger: { info() {}, error() {} }
    });
    assert.equal(existingCoordinator.start().startupScheduled, false);
    assert.equal(existingDeferred.length, 0);
    assert.equal(existingCoordinator.status().lastSuccessfulUnasSyncAt, '2026-07-21T10:00:00.000Z');

    const disabledDeferred = [];
    let disabledTimerCalls = 0;
    const disabledCoordinator = createUnasSyncCoordinator({
      snapshotPath: path.join(tempDir, 'disabled-missing.json'),
      apiConfigured: () => true,
      intervalValue: '0',
      buildSync: async () => ({ products: 1, categories: 0 }),
      defer: (callback) => disabledDeferred.push(callback),
      setIntervalFn: () => { disabledTimerCalls += 1; },
      logger: { info() {}, error() {} }
    });
    assert.equal(disabledCoordinator.start().startupScheduled, true);
    assert.equal(disabledDeferred.length, 1);
    assert.equal(disabledTimerCalls, 0);

    const errorPath = path.join(tempDir, 'error.json');
    const errorDeferred = [];
    const logEntries = [];
    const secret = 'SECRET-API-KEY-RAW-XML';
    const errorCoordinator = createUnasSyncCoordinator({
      snapshotPath: errorPath,
      apiConfigured: () => true,
      intervalValue: 0,
      buildSync: async () => { throw new Error(`${secret}<Products>raw</Products>`); },
      defer: (callback) => errorDeferred.push(callback),
      logger: {
        info: (...args) => logEntries.push(args),
        error: (...args) => logEntries.push(args)
      }
    });
    errorCoordinator.start();
    errorDeferred[0]();
    await waitUntil(() => errorCoordinator.status().lastUnasSyncError !== null);
    assert.equal(errorCoordinator.status().snapshotPresent, false);
    assert.equal(errorCoordinator.status().lastUnasSyncError, SAFE_SYNC_ERROR);
    assert.equal(errorCoordinator.status().unasSyncInProgress, false);
    const safeOutput = JSON.stringify({ logs: logEntries, status: errorCoordinator.status() });
    assert.equal(safeOutput.includes(secret), false);
    assert.equal(safeOutput.includes('<Products>'), false);

    let release;
    let realSyncCalls = 0;
    const lockCoordinator = createUnasSyncCoordinator({
      snapshotPath: path.join(tempDir, 'lock.json'),
      buildSync: () => {
        realSyncCalls += 1;
        return new Promise((resolve) => { release = resolve; });
      },
      logger: { info() {}, error() {} }
    });
    const first = lockCoordinator.run('admin');
    const second = lockCoordinator.run('admin');
    assert.strictEqual(first, second);
    await waitUntil(() => typeof release === 'function');
    assert.equal(realSyncCalls, 1);
    release({ products: 1, categories: 0 });
    await first;

    const combinedDeferred = [];
    let combinedRelease;
    let combinedCalls = 0;
    const combinedCoordinator = createUnasSyncCoordinator({
      snapshotPath: path.join(tempDir, 'combined.json'),
      apiConfigured: () => true,
      intervalValue: 0,
      defer: (callback) => combinedDeferred.push(callback),
      buildSync: () => {
        combinedCalls += 1;
        return new Promise((resolve) => { combinedRelease = resolve; });
      },
      logger: { info() {}, error() {} }
    });
    combinedCoordinator.start();
    combinedDeferred[0]();
    await waitUntil(() => typeof combinedRelease === 'function');
    const adminDuringStartup = combinedCoordinator.run('admin');
    assert.equal(combinedCalls, 1);
    combinedRelease({ products: 1, categories: 0 });
    await adminDuringStartup;

    const registrySnapshotPath = path.join(tempDir, 'registry-snapshot.json');
    const registryMappingPath = path.join(tempDir, 'registry-mapping.json');
    fs.writeFileSync(registryMappingPath, JSON.stringify({
      mappings: [{
        canonicalId: 'dermavital_sampon',
        unasId: '1001',
        sku: 'SKU-1001',
        mappingStatus: 'approved'
      }]
    }), 'utf8');
    const productRegistry = createProductRegistry({
      mappingPath: registryMappingPath,
      snapshotPath: registrySnapshotPath
    });
    assert.equal(productCards(['dermavital_sampon'], { registry: productRegistry })[0].url, '');
    const registryCoordinator = createUnasSyncCoordinator({
      snapshotPath: registrySnapshotPath,
      buildSync: async () => {
        writeSnapshot(registrySnapshotPath, snapshot({
          name: 'Friss UNAS sampon',
          url: 'https://www.vitalis-szappan.hu/friss-unas-sampon',
          image: { url: 'https://cdn.example.invalid/friss.jpg' },
          actualPriceGross: 3400
        }));
        return { products: 1, categories: 0 };
      },
      logger: { info() {}, error() {} }
    });
    await registryCoordinator.run('startup');
    const refreshedCard = productCards(['dermavital_sampon'], { registry: productRegistry })[0];
    assert.equal(refreshedCard.name, 'Friss UNAS sampon');
    assert.equal(refreshedCard.url, 'https://www.vitalis-szappan.hu/friss-unas-sampon');
    assert.equal(refreshedCard.price, 3400);
    assert.equal(refreshedCard.description, PRODUCTS.dermavital_sampon.description);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('TEST_UNAS_SYNC_COORDINATOR: minden ellenőrzés sikeres');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
