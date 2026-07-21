'use strict';

const assert = require('assert');
const fs = require('fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { PRODUCTS, productCards, validProductUrl } = require('./engine/product-catalog.cjs');
const { createProductRegistry } = require('./engine/product-registry.cjs');

const psoriUrl = 'https://www.vitalis-szappan.hu/psorivital-csomag-ekcemas-borre';
const balmUrl = 'https://www.vitalis-szappan.hu/termek/holt-tengeri-so-balzsam';

assert.strictEqual(productCards(['psorivital_csomag'])[0].url, psoriUrl);
assert.strictEqual(productCards(['holt_tengeri_so_balzsam'])[0].url, balmUrl);
assert.strictEqual(validProductUrl('javascript:alert(1)'), '');
assert.strictEqual(validProductUrl('nem-url'), '');

const originalUrl = PRODUCTS.shea_vajas_szappan.url;
PRODUCTS.shea_vajas_szappan.url = 'javascript:alert(1)';
const invalidCard = productCards(['shea_vajas_szappan'], {
  registry: createProductRegistry({ mappingData: { mappings: [] }, snapshotData: null })
})[0];
PRODUCTS.shea_vajas_szappan.url = originalUrl;
assert.strictEqual(invalidCard.url, '');
assert.strictEqual(invalidCard.name, 'Shea vajas szappan');

const unasPsoriUrl = 'https://www.vitalis-szappan.hu/unas-psorivital-teszt';
const result = createAnswer({
  question: 'Mit ajánlasz pikkelysömörre?',
  history: [],
  knowledge: [{
    id: 'unas-product-psori',
    source: 'unas',
    sourceType: 'product',
    type: 'product',
    category: 'UNAS termék',
    title: 'PsoriVital csomag',
    canonicalQuestion: 'PsoriVital csomag termékinformáció',
    shortAnswer: 'Aktuális UNAS termékinformáció a PsoriVital csomagról.',
    fullAnswer: 'Aktuális UNAS termékinformáció a PsoriVital csomagról.',
    products: ['PsoriVital csomag'],
    url: unasPsoriUrl
  }],
  ruleEngine: { resolve: () => null },
  logGap: () => {}
});
assert.strictEqual(result.links[0].url, unasPsoriUrl);
assert.strictEqual(result.links[1].url, balmUrl);

const widget = fs.readFileSync('./public/widget.js', 'utf8');
assert(/createElement\(hasUrl \? 'a' : 'div'\)/.test(widget));
assert(/card\.target = '_blank'/.test(widget));
assert(/card\.rel = 'noopener noreferrer'/.test(widget));
assert(/price: safeProductPrice\(item\.price\)/.test(widget));
assert(/class="product-price"/.test(widget));

console.log('TEST_PRODUCT_LINKS: 14/14 sikeres');
