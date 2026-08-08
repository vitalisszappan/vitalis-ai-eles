'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
require('./public/unas-order-bridge.js');

const attributionId = crypto.randomUUID();
let callbackPayload = null;
const lifecycleApi = { createLifecycle: () => ({ get: () => ({ attributionId }) }) };
const UNAS = { getOrder(callback, options) { assert.deepEqual(options, { lang: 'base' }); callback({ key: 'ORDER-123' }); } };

globalThis.VitalisUnasOrderBridge.runOrderBridge({
  UNAS, lifecycleApi, storage: {}, crypto,
  fetch: async (endpoint, options) => {
    assert.equal(endpoint, '/api/commerce/order-proof');
    callbackPayload = JSON.parse(options.body);
    return { ok: true, status: 201 };
  }
}).then((result) => {
  assert.equal(result.ok, true);
  assert.equal(callbackPayload.attributionId, attributionId);
  assert.equal(callbackPayload.orderKey, 'ORDER-123');
  assert.deepEqual(Object.keys(callbackPayload).sort(), ['attributionId', 'orderKey', 'schemaVersion', 'timestamp'].sort());
  assert.equal(JSON.stringify(callbackPayload).match(/email|name|phone|address|revenue|price/i), null);
  console.log('UNAS order_send bridge skeleton teszt: OK');
}).catch((error) => { console.error(error); process.exitCode = 1; });
