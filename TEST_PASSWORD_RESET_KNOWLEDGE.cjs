'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const ROOT = __dirname;
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'knowledge.json'), 'utf8'));
const knowledge = Array.isArray(raw) ? raw : raw.items;
const ruleEngine = new ExpertRuleEngine(path.join(ROOT, 'data', 'rules', 'expert-rules.json'));
const expectedAnswer = 'Ha elfelejtetted a jelszavad, kérj új jelszót a webshop belépési felületén. Add meg a regisztrációhoz használt email-címedet, és elküldjük az új jelszó megadásához szükséges linket. Ha ezután sem sikerül belépned, írj nekünk, és segítünk.';
const questions = [
  'Elfelejtettem a jelszavam.',
  'Elfelejtettem a jelszót.',
  'Nem emlékszem a jelszavamra.',
  'Hogyan kérek új jelszót?',
  'Jelszó visszaállítás.',
  'Nem tudok belépni.'
];

function answer(question) {
  return createAnswer({ question, history: [], knowledge, ruleEngine, logGap() {} });
}

for (const question of questions) {
  const result = answer(question);
  assert.equal(result.answer, expectedAnswer, question);
  assert.equal(result.source, 'knowledge-fallback', question);
  assert.equal(result.routing.route, 'knowledge', question);
  assert.deepEqual(result.matchedKnowledgeIds, ['kb_forgotten_password_reset'], question);
  assert.notEqual(result.fallbackRootCause, 'knowledge_missing', question);
}

const unknown = answer('Milyen színű a Hold túloldalán álló postaláda?');
assert.equal(unknown.source, 'hard-fallback');
assert.equal(unknown.routing.route, 'hard_fallback');
assert.equal(unknown.fallbackRootCause, 'knowledge_missing');

console.log('Password reset approved knowledge regresszio: PASS');
