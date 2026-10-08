'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { evaluateSafety } = require('./engine/safety-gate.cjs');

const ruleEngine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
const ask = (question, history = []) => createAnswer({
  question, history, knowledge: [], ruleEngine,
  logGap: () => {}, logDiagnostic: () => {}, conversationState: null
});

for (const question of [
  'A só nem csípi a sebes kirepedezett ekcémás bőrt?',
  'Repedezett bőrre is használható?',
  'Csípni fog a só a kirepedezett bőrön?',
  'Nyílt sebre használhatom?',
  'Vérzik is, rákenhetem?'
]) {
  const safety = evaluateSafety(question);
  assert.equal(safety.safetyClass, 'caution_with_boundary', question);
  assert.deepEqual(safety.evidence, ['safety:broken_skin_product_use'], question);
  const answer = ask(question);
  assert.equal(answer.route, 'safety', question);
  assert.equal(answer.intent, 'cosmetic_boundary', question);
  assert.doesNotMatch(answer.answer, /ödéma|keringési panasz/i, question);
  assert.match(answer.answer, /nincs (?:elég konkrét, )?jóváhagyott|nincs jóváhagyott/i, question);
}

for (const question of [
  'Mi okozza a gyulladást?',
  'Ez fertőzés lehet?',
  'Mitől dagadt meg?',
  'Keringési probléma lehet?',
  'Meggyógyítja az ekcémát?',
  'Kiválthatom vele a gyógyszeremet?'
]) {
  const safety = evaluateSafety(question);
  assert.equal(safety.safetyClass, 'medical_escalation', question);
  const answer = ask(question);
  assert.equal(answer.route, 'safety', question);
  assert.equal(answer.intent, 'medical_escalation', question);
}

const ambiguousSaltAnswer = ask('A só nem csípi a sebes kirepedezett ekcémás bőrt?');
assert.doesNotMatch(ambiguousSaltAnswer.answer, /Parajdi|Holt-tengeri/i);
assert.match(ambiguousSaltAnswer.answer, /nincs jóváhagyott használati útmutatásunk/i);
assert.match(ambiguousSaltAnswer.answer, /melyik sót tartalmazó Vitalis termékre gondolsz/i);

const parajdiContext = [{ role: 'assistant', content: 'A Parajdi sótömbről beszélünk.', targetProductId: 'parajdi_sotomb' }];
const parajdiAnswer = ask('Csípni fog a kirepedezett bőrön?', parajdiContext);
assert.match(parajdiAnswer.answer, /enyhe csípő érzés/i);
assert.match(parajdiAnswer.answer, /kisebb felületen kipróbálni/i);
assert.doesNotMatch(parajdiAnswer.answer, /Holt-tengeri só balzsam/i);

const balmContext = [{ role: 'assistant', content: 'A Holt-tengeri só balzsamról beszélünk.', targetProductId: 'holt_tengeri_so_balzsam' }];
const balmAnswer = ask('Repedezett bőrre is használható?', balmContext);
assert.match(balmAnswer.answer, /irritáció esetén hagyd abba a használatát/i);
assert.doesNotMatch(balmAnswer.answer, /enyhe csípő érzés|Parajdi/i);

console.log('Cracked-skin safety routing: PASS');
