'use strict';

const fs = require('fs');
const { validateSnapshot } = require('./unas-sync.cjs');

const DEFAULT_UNAS_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SAFE_SYNC_ERROR = 'Az UNAS katalógusszinkron sikertelen.';

function parseSyncInterval(value, fallback = DEFAULT_UNAS_SYNC_INTERVAL_MS) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function readValidSnapshot(snapshotPath) {
  try {
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    validateSnapshot(snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

function createUnasSyncCoordinator({
  buildSync,
  snapshotPath,
  apiConfigured = () => false,
  intervalValue = process.env.UNAS_SYNC_INTERVAL_MS,
  logger = console,
  now = () => new Date(),
  defer = (callback) => queueMicrotask(callback),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
} = {}) {
  if (typeof buildSync !== 'function') throw new TypeError('A buildSync függvény kötelező.');
  if (!snapshotPath) throw new TypeError('A snapshotPath kötelező.');

  const intervalMs = parseSyncInterval(intervalValue);
  const initialSnapshot = readValidSnapshot(snapshotPath);
  let lastSuccessfulUnasSyncAt = initialSnapshot?.generatedAt || null;
  let lastUnasSyncError = null;
  let inFlight = null;
  let timer = null;
  let started = false;

  function snapshotPresent() {
    return Boolean(readValidSnapshot(snapshotPath));
  }

  function status() {
    return {
      snapshotPresent: snapshotPresent(),
      lastSuccessfulUnasSyncAt,
      unasSyncInProgress: Boolean(inFlight),
      lastUnasSyncError
    };
  }

  function run(trigger = 'manual') {
    if (inFlight) return inFlight;

    inFlight = Promise.resolve()
      .then(() => buildSync())
      .then((result) => {
        lastSuccessfulUnasSyncAt = now().toISOString();
        lastUnasSyncError = null;
        logger.info?.('UNAS háttérszinkron sikeres.', {
          trigger,
          products: result?.products ?? null,
          categories: result?.categories ?? null
        });
        return result;
      })
      .catch(() => {
        lastUnasSyncError = SAFE_SYNC_ERROR;
        logger.error?.('UNAS háttérszinkron sikertelen.', { trigger });
        throw new Error(SAFE_SYNC_ERROR);
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  function start() {
    if (started) return { startupScheduled: false, intervalMs, timer };
    started = true;
    const configured = Boolean(apiConfigured());
    const startupScheduled = configured && !snapshotPresent();

    if (startupScheduled) {
      defer(() => {
        run('startup').catch(() => {});
      });
    }

    if (configured && intervalMs > 0) {
      timer = setIntervalFn(() => {
        run('interval').catch(() => {});
      }, intervalMs);
      timer?.unref?.();
    }

    return { startupScheduled, intervalMs, timer };
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
  }

  return {
    intervalMs,
    run,
    start,
    status,
    stop
  };
}

module.exports = {
  DEFAULT_UNAS_SYNC_INTERVAL_MS,
  SAFE_SYNC_ERROR,
  createUnasSyncCoordinator,
  parseSyncInterval,
  readValidSnapshot
};
