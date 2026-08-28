'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');
const restoreCatalogFixture = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restoreCatalogFixture);
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { enrichLinks } = require('./engine/communication-engine.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');
function ask(question, history = []) {
  return createAnswer({ question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {} });
}
function productContext(productId, name) {
  return [
    { role: 'user', content: `A ${name} érdekel.` },
    { role: 'assistant', content: `A ${name} az érintett termék.`, route: 'exact_product', intent: 'product_detail', links: [{ id: productId, name }] }
  ];
}

const solid = ask('Van szilárd samponotok?');
assert.equal(solid.answerMode, 'DIRECT');
assert.equal(solid.intent, 'product_type_availability');
assert.deepEqual(solid.links.map((item) => item.id), ['solid_shampoo_normal_green_tea', 'solid_shampoo_oily_rosemary_caffeine']);
assert.ok(solid.links.every((item) => item.recommendationType === 'available' && item.reason === ''));
assert.match(solid.answer, /^Igen\./);
assert.equal(solid.answer, 'Igen. Kétféle szilárd samponunk van: egy zöldteás normál hajra, valamint egy rozmaringos-koffeines zsírosodásra hajlamos hajra.');
assert.doesNotMatch(solid.answer, /Hajnövekedés|hajdúsítás/i);
assert.doesNotMatch(solid.answer, /Nézzük meg|elsőként|Azért ezt|Hogyan használd/i);

const shampoo = ask('Van samponotok?');
assert.equal(shampoo.answerMode, 'DIRECT');
assert.equal(shampoo.intent, 'product_type_availability');
assert.doesNotMatch(shampoo.answer, /elsőként|javaslom|ajánlom/i);

for (const question of ['Melyik sampont ajánlod zsíros hajra?', 'Viszket a fejbőröm. Melyik samponszappant ajánlod?']) {
  const result = ask(question);
  assert.equal(result.answerMode, 'RECOMMENDATION', question);
  assert.equal(result.route, 'hair_product_type', question);
  assert.equal(result.intent, 'product_recommendation', question);
}
const oilyLiquid = ask('Melyik sampont ajánlod zsíros hajra?');
assert.deepEqual(oilyLiquid.links.map((item) => item.commerce?.sku), ['VSZSP04']);
assert.ok(oilyLiquid.links.every((item) => item.productType === 'solid_shampoo'));
assert.match(oilyLiquid.answer, /rozmaringos-koffeines szilárd sampont ajánlom/i);

const psoriHistory = productContext('psorivital_csomag', 'PsoriVital csomag');
const usage = ask('Hogyan használjam?', psoriHistory);
assert.equal(usage.answerMode, 'EXPLANATORY');
assert.equal(usage.route, 'context_followup');
assert.equal(usage.intent, 'product_usage');
assert.equal(usage.contextTarget, 'psorivital_csomag');
assert.doesNotMatch(usage.answer, /elsőként|Azért ezt|ajánlom|javaslom/i);
assert.ok(usage.links.every((item) => item.recommendationType === 'context' && item.reason === ''));

const missingUsage = ask('Hogyan használjam?');
assert.equal(missingUsage.route, 'clarification');
assert.equal(missingUsage.answerMode, 'EXPLANATORY');
assert.match(missingUsage.answer, /Melyik termékre gondolsz/i);
assert.equal(missingUsage.links.length, 0);

const productHistory = productContext('dermavital_sampon', 'Dermavital sampon');
const price = ask('Mennyibe kerül?', productHistory);
assert.equal(price.route, 'commerce');
assert.equal(price.answerMode, 'DIRECT');
assert.equal(price.intent, 'price_query');
assert.equal(price.answer, 'A Dermavital sampon jelenlegi ára 3 400 Ft.');

const information = ask('Mit tud ez?', productHistory);
assert.equal(information.route, 'context_followup');
assert.equal(information.answerMode, 'EXPLANATORY');
assert.equal(information.intent, 'benefits');
assert.equal(information.answerIntent, 'product_benefits');
assert.equal(information.contextTarget, 'dermavital_sampon');
assert.equal(information.targetProductId, 'dermavital_sampon');
assert.equal(information.groundingStatus, 'grounded');
assert.match(information.answer, /fejbőr/i);

const guarded = enrichLinks([{ name: 'Sampon – Hajnövekedés és hajdúsítás természetesen', description: 'Serkenti a hajnövekedést.' }], { answerMode: 'DIRECT', domain: 'shampoo' });
assert.equal(guarded[0].reason, '');

const widget = fs.readFileSync('public/widget.js', 'utf8');
assert.match(widget, /data\.answerMode === 'RECOMMENDATION'/);
assert.match(widget, /Elérhető termékek/);

console.log('Conversation routing / answer behavior regresszió: PASS');
