'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLifecycle } = require('./engine/attribution-lifecycle.cjs');
const { validateEvent, createLocalPocEventStore } = require('./engine/commerce-events.cjs');
const { validateOrderProof, createLocalPocProofStore, processOrderProof } = require('./engine/order-proof.cjs');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

async function main() {
  const now = Date.now();
  const browserStorage = memoryStorage();
  const productPage = createLifecycle({ storage: browserStorage, crypto, now: () => now });
  const attributionId = productPage.get().attributionId;

  // A teljes oldalváltás új lifecycle példányt hoz létre, de azonos originen
  // ugyanabból a localStorage-ból ugyanazt az attribution ID-t olvassa vissza.
  const thankYouPage = createLifecycle({ storage: browserStorage, crypto, now: () => now + 2_000 });
  assert.equal(thankYouPage.get().attributionId, attributionId);

  // Külön origin külön localStorage-partíció: www <-> apex között a jelenlegi
  // browser lifecycle önmagában nem tudja átvinni az attribution ID-t.
  const otherOrigin = createLifecycle({ storage: memoryStorage(), crypto, now: () => now + 2_000 });
  assert.notEqual(otherOrigin.get().attributionId, attributionId);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-attribution-order-'));
  const eventLog = path.join(tempDir, 'commerce-events.jsonl');
  const proofLog = path.join(tempDir, 'order-proofs.jsonl');
  try {
    const eventStore = createLocalPocEventStore(eventLog);
    const clicked = validateEvent({
      eventId: crypto.randomUUID(), attributionId, chatSessionId: crypto.randomUUID(),
      eventType: 'product_clicked', route: 'product', intent: 'recommendation',
      canonicalProductId: 'dermavital_sampon', unasProductId: '123', sku: 'SKU-CLICKED',
      recommendationType: 'primary', recommendationRank: 1,
      occurredAt: new Date(now - 1_000).toISOString(), schemaVersion: 1
    }, { now: () => now });
    assert.equal(clicked.ok, true);
    assert.deepEqual(eventStore.append(clicked.event), { duplicate: false });

    let bridgePayload;
    const oldDocument = globalThis.document;
    globalThis.document = { currentScript: { src: 'https://vitalis-ai-eles.onrender.com/unas-order-bridge.js' } };
    delete require.cache[require.resolve('./public/unas-order-bridge.js')];
    require('./public/unas-order-bridge.js');
    globalThis.document = oldDocument;
    const bridgeResult = await globalThis.VitalisUnasOrderBridge.runOrderBridge({
      UNAS: { getOrder(callback) { callback({ key: '970185' }); } },
      lifecycleApi: { createLifecycle: () => thankYouPage }, storage: browserStorage, crypto,
      fetch: async (_endpoint, request) => {
        bridgePayload = JSON.parse(request.body);
        return { ok: true, status: 201, json: async () => ({ ok: true }) };
      }
    });
    assert.equal(bridgeResult.ok, true);
    assert.equal(bridgePayload.attributionId, attributionId);

    const proof = validateOrderProof(bridgePayload, { now: () => now + 2_000 });
    assert.equal(proof.ok, true);
    const proofStore = createLocalPocProofStore(proofLog);
    const outcomeStore = { insertOutcome: async (outcome) => ({ duplicate: false, outcome }) };
    const verified = await processOrderProof(proof.proof, {
      eventLogPath: eventLog, proofStore, outcomeStore,
      verifyOrder: async (key) => ({ ok: true, order: { key, id: '99212-970185', date: '2026.08.08', items: [{ id: '1', sku: 'SKU-CLICKED' }] } })
    });
    assert.deepEqual(verified, { ok: true, verified: true, duplicate: false });

    // Process restart ugyanazzal a fájllal túlélhető; Render deploy/restart során
    // az ephemeral fájl elvesztése viszont bizonyíthatóan attribution_not_found.
    assert.equal(createLocalPocEventStore(eventLog).kind, 'local_poc_jsonl');
    fs.unlinkSync(eventLog);
    const afterEphemeralLoss = await processOrderProof({ ...proof.proof, orderKey: '970186' }, {
      eventLogPath: eventLog, proofStore,
      verifyOrder: async () => { throw new Error('must_not_run'); }
    });
    assert.equal(afterEphemeralLoss.error, 'attribution_not_found');
  } finally {
    productPage.close(); thankYouPage.close(); otherOrigin.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  console.log('Attribution -> page transition -> order proof lifecycle E2E: OK');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
