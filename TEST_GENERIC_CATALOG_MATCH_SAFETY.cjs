'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');
const ask = (question) => createAnswer({ question, history: [], knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });

const cases = [
  ['fogkr\u00e9m', true, /fogkr\u00e9m/i],
  ['ill\u00f3olaj', false],
  ['ajakbalzsam', true, /ajakbalzsam/i],
  ['f\u00fcrd\u0151s\u00f3', true, /f\u00fcrd\u0151s\u00f3/i],
  ['samponszappan', true, /samponszappan/i],
  ['testvaj', false],
  ['dezodor', true, /dezodor/i],
  ['arckr\u00e9m', true, /arckr\u00e9m/i],
  ['sz\u00e9rum', false],
  ['szak\u00e1llolaj', false]
];

let wrongConfidentProduct = 0;
for (const [question, exists, namePattern] of cases) {
  const result = ask(question);
  if (exists) {
    if (['ajakbalzsam', 'dezodor'].includes(question)) {
      assert.equal(result.route, 'clarification', question);
      assert.deepEqual(result.links, [], question);
    } else {
      assert.ok(result.links.length > 0, question);
      assert.ok(result.links.every((link) => namePattern.test(link.name)), question);
    }
  } else {
    assert.equal(result.source, 'catalog-absent', question);
    assert.equal(result.confidence, 0, question);
    assert.deepEqual(result.links, [], question);
  }
  if (result.confidence === 100 && result.links.some((link) => namePattern && !namePattern.test(link.name))) wrongConfidentProduct += 1;
}

const essentialOil = ask('ill\u00f3olaj');
assert.doesNotMatch(essentialOil.answer, /shea/i);
assert.deepEqual(essentialOil.links, []);
assert.equal(wrongConfidentProduct, 0);

const exact = ask('Shea vaj \u2013 Finom\u00edtatlan 100 ml');
assert.equal(exact.route, 'exact_product');
assert.match(exact.links[0].name, /Shea vaj/i);

const recommendation = ask('Mit aj\u00e1nlasz sz\u00e1raz b\u0151rre?');
assert.equal(recommendation.route, 'expert_rule');
assert.ok(recommendation.links.length > 0);

console.log('GENERIC_CATALOG_MATCH_SAFETY_OK WRONG_CONFIDENT_PRODUCT=0');
