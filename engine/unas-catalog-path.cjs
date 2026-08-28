'use strict';

const path = require('node:path');

const DEFAULT_UNAS_CATALOG_SNAPSHOT_PATH = path.join(__dirname, '..', 'data', 'unas-catalog-snapshot.json');

function resolveUnasCatalogSnapshotPath(explicitPath = process.env.UNAS_CATALOG_SNAPSHOT_PATH) {
  const configured = String(explicitPath || '').trim();
  return configured ? path.resolve(configured) : DEFAULT_UNAS_CATALOG_SNAPSHOT_PATH;
}

module.exports = { DEFAULT_UNAS_CATALOG_SNAPSHOT_PATH, resolveUnasCatalogSnapshotPath };
