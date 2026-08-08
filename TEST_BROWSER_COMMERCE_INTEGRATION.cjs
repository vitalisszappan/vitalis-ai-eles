'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const widget = read('public/widget.js');
const embed = read('public/embed.js');
const lifecycle = read('public/attribution-lifecycle.js');
const bridge = read('public/unas-order-bridge.js');

assert.match(embed, /attribution-lifecycle\.js/);
assert.match(embed, /vitalis-chat-attribution/);
assert.match(lifecycle, /cryptoObject\.randomUUID\(\)/);
assert.match(lifecycle, /BroadcastChannel/);
assert.match(lifecycle, /addEventListener\('storage'/);
assert.match(widget, /sendCommerceEvent\('chat_open'\)/);
assert.match(widget, /sendCommerceEvent\('chat_started'\)/);
assert.match(widget, /sendCommerceEvent\('product_recommended'/);
assert.match(widget, /sendCommerceEvent\('product_clicked'/);
for (const field of ['eventId', 'attributionId', 'chatSessionId', 'route', 'intent', 'canonicalProductId', 'unasProductId', 'sku', 'recommendationType', 'recommendationRank', 'occurredAt', 'schemaVersion']) {
  assert.match(widget, new RegExp(`\\b${field}\\b`), field);
}
assert.doesNotMatch(widget + embed, /purchase_attributed|cart_detected|checkout_detected/);
assert.doesNotMatch(widget + embed, /\b(?:email|phone|address|revenue)\b/i);
assert.match(bridge, /UNAS\.getOrder/);
assert.match(bridge, /orderKey/);
assert.match(bridge, /document\.currentScript/);
assert.match(bridge, /scriptOrigin.*order-proof/);
assert.doesNotMatch(bridge, /purchase_attributed|revenue|SumPriceGross|priceGross/);
console.log('Browser commerce event wiring és adatminimalizálási tesztek: OK');
