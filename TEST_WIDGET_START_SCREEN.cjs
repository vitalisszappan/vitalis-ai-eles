'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('./public/widget.html', 'utf8');
const widget = fs.readFileSync('./public/widget.js', 'utf8');

assert.match(html, /<strong>Szia! Miben segíthetek\?<\/strong>/);
assert.match(html, /Írd meg, mit keresel, vagy milyen problémára szeretnél terméket\./);
assert.match(html, /Első vásárlásod\?<\/strong>\s*10% kedvezmény feliratkozásért/);
assert.match(html, /href="https:\/\/www\.vitalis-szappan\.hu\/shop_newsletter\.php\?utm_source=vitalis_ai&amp;utm_medium=chat&amp;utm_campaign=first_purchase_10"/);
assert.match(html, /target="_top"/);
assert.match(html, /rel="noopener"/);
assert.doesNotMatch(html, /Gyorsindítás/);

for (const label of ['Ekcéma', 'Pikkelysömör', 'Száraz bőr', 'Pattanásos bőr', 'Szállítás', 'Kuponkód']) {
  assert.doesNotMatch(html, new RegExp(`>${label}<`), `${label} must not be present as a static quick-start button`);
}

assert.match(html, /<div id="suggestions" class="suggestions" hidden aria-hidden="true"><\/div>/);
assert.match(widget, /suggestionsEl\.hidden = false/);
assert.match(widget, /suggestionsEl\.hidden = true/);
assert.match(html, /nem helyettesít orvosi diagnózist vagy kezelést/);
assert.match(html, /id="new-conversation"/);

console.log('Widget start screen regresszió: OK');
