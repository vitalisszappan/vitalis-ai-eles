'use strict';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const TRACKED_FAILURES = new Set(['attribution_not_found', 'product_clicked_not_found', 'commerce_event_store_unavailable', 'proof_storage_failed']);

function createCommerceHealthTracker(options = {}) {
  const now = options.now || Date.now;
  const failures = [];
  function prune(time) { while (failures.length && failures[0].at < time - WINDOW_MS) failures.shift(); }
  return {
    recordFailure(error) {
      if (!TRACKED_FAILURES.has(error)) return;
      const time = now(); prune(time); failures.push({ at: time, error });
    },
    snapshot() {
      const time = now(); prune(time);
      const count = (error) => failures.filter((item) => item.error === error).length;
      return {
        attributionNotFound: count('attribution_not_found'),
        productClickedNotFound: count('product_clicked_not_found'),
        storageErrors: count('commerce_event_store_unavailable') + count('proof_storage_failed')
      };
    }
  };
}

async function buildCommerceHealth({ eventStore, proofStore, tracker, now = Date.now }) {
  const generatedAt = new Date(now()).toISOString();
  const since = new Date(now() - WINDOW_MS).toISOString();
  const [events, proofs] = await Promise.all([
    eventStore.getHealthSnapshot(since).then((value) => ({ available: true, ...value })).catch(() => ({ available: false, eventCount: null, productClickedCount: null, lastSuccessfulEventAt: null })),
    proofStore.getHealthSnapshot(since).then((value) => ({ available: true, ...value })).catch(() => ({ available: false, verifiedProofCount: null, lastVerifiedProofAt: null }))
  ]);
  const failures = tracker.snapshot();
  const authoritative = eventStore.kind === 'supabase' && proofStore.kind === 'supabase';
  const productionDurable = eventStore.productionDurable === true && proofStore.productionDurable === true;
  const level = !events.available || !proofs.available || failures.storageErrors > 0
    ? 'ERROR' : (failures.attributionNotFound > 0 || failures.productClickedNotFound > 0 ? 'WARNING' : 'INFO');
  return { level, generatedAt, windowHours: 24, supabaseAuthoritative: authoritative, productionDurable, eventStore: { kind: eventStore.kind, available: events.available }, proofStore: { kind: proofStore.kind, available: proofs.available }, lastSuccessfulCommerceEventAt: events.lastSuccessfulEventAt, lastSuccessfulVerifiedProofAt: proofs.lastVerifiedProofAt, last24Hours: { commerceEvents: events.eventCount, productClicked: events.productClickedCount, verifiedProofs: proofs.verifiedProofCount, attributionNotFound: failures.attributionNotFound, productClickedNotFound: failures.productClickedNotFound, storageErrors: failures.storageErrors } };
}

module.exports = { WINDOW_MS, TRACKED_FAILURES, createCommerceHealthTracker, buildCommerceHealth };
