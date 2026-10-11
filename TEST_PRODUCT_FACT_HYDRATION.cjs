'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProductFactsResolver } = require('./engine/product-facts.cjs');
const { createUnasSyncCoordinator } = require('./unas-sync-coordinator.cjs');

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-fact-hydration-'));
  try {
    const mappingPath = path.join(tempDir, 'mapping.json');
    const snapshotPath = path.join(tempDir, 'snapshot.json');
    const approvedFactsPath = path.join(tempDir, 'approved.json');
    fs.writeFileSync(mappingPath, JSON.stringify({ mappings: [{
      canonicalId: 'dermavital_sampon', unasId: '1001', sku: 'SKU-1001', mappingStatus: 'approved'
    }] }), 'utf8');
    fs.writeFileSync(approvedFactsPath, JSON.stringify({ facts: [] }), 'utf8');

    const facts = createProductFactsResolver({
      mappingPath, snapshotPath, approvedFactsPath, deterministicProducts: {}, reloadOnFileChange: true
    });
    assert.equal(facts.getProductFacts('dermavital_sampon'), null);

    const coordinator = createUnasSyncCoordinator({
      snapshotPath,
      buildSync: async () => {
        fs.writeFileSync(snapshotPath, JSON.stringify({
          generatedAt: '2026-10-11T12:00:00.000Z',
          products: [{
            unasId: '1001', sku: 'SKU-1001', name: 'Dermavital sampon', actualPriceGross: 3400,
            currency: 'HUF', url: 'https://www.vitalis-szappan.hu/dermavital-sampon',
            shortDescription: 'Kíméletes sampon érzékeny fejbőr tisztítására.',
            longDescription: 'Hogyan használd? Masszírozd nedves hajba, majd alaposan öblítsd ki.'
          }]
        }), 'utf8');
        return { products: 1, categories: 0 };
      },
      logger: { info() {}, error() {} }
    });
    await coordinator.run('startup');

    assert.equal(facts.getFact('dermavital_sampon', 'price').value, 3400);
    assert.equal(facts.getFact('dermavital_sampon', 'name').value, 'Dermavital sampon');
    assert.equal(facts.getFact('dermavital_sampon', 'usageInstructions').status, 'grounded');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  console.log('PRODUCT_FACT_HYDRATION_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
