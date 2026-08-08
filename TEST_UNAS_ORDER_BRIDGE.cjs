'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const attributionId = crypto.randomUUID();
let callbackPayload = null;
const lifecycleApi = { createLifecycle: () => ({ get: () => ({ attributionId }) }) };
const UNAS = { getOrder(callback, options) { assert.deepEqual(options, { lang: 'base' }); callback({ key: 'ORDER-123' }); } };

const originalDocument = globalThis.document;
globalThis.document = { currentScript: { src: 'https://vitalis-backend.example/unas-order-bridge.js' } };
delete require.cache[require.resolve('./public/unas-order-bridge.js')];
require('./public/unas-order-bridge.js');
globalThis.document = originalDocument;

globalThis.VitalisUnasOrderBridge.runOrderBridge({
  UNAS, lifecycleApi, storage: {}, crypto,
  fetch: async (endpoint, options) => {
    assert.equal(endpoint, 'https://vitalis-backend.example/api/commerce/order-proof');
    callbackPayload = JSON.parse(options.body);
    return { ok: true, status: 201, json: async () => ({ ok: true, verified: true }) };
  }
}).then((result) => {
  assert.equal(result.ok, true);
  assert.equal(callbackPayload.attributionId, attributionId);
  assert.equal(callbackPayload.orderKey, 'ORDER-123');
  assert.deepEqual(Object.keys(callbackPayload).sort(), ['attributionId', 'orderKey', 'schemaVersion', 'timestamp'].sort());
  assert.equal(JSON.stringify(callbackPayload).match(/email|name|phone|address|revenue|price/i), null);
  return globalThis.VitalisUnasOrderBridge.runOrderBridge({
    UNAS, lifecycleApi, storage: {}, crypto,
    fetch: async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: 'attribution_not_found', detail: 'must-not-leak' }) })
  });
}).then((failure) => {
  assert.deepEqual(failure, { ok: false, status: 400, reason: 'attribution_not_found' });
  console.log('UNAS order_send bridge skeleton teszt: OK');
}).catch((error) => { console.error(error); process.exitCode = 1; });
