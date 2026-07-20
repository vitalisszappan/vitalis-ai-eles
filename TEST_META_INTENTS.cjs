'use strict';

const assert = require('assert');
const path = require('path');
const knowledge = require('./data/knowledge.json');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const ruleEngine = new ExpertRuleEngine(
  path.join(__dirname, 'data', 'rules', 'expert-rules.json')
);

function ask(question) {
  let gapCalls = 0;
  const answer = createAnswer({
    question,
    history: [],
    knowledge,
    ruleEngine,
    logGap: () => { gapCalls += 1; }
  });
  return { answer, gapCalls };
}

const cases = [
  {
    question: 'Ki fejlesztett?',
    intent: 'chatbot-development',
    includes: ['Vitalis saját digitális asszisztense', 'Szalacsi Zoltán']
  },
  {
    question: 'Ki csinálta ezt a chatbotot?',
    intent: 'chatbot-development',
    includes: ['Vitalis saját ügyféltámogató rendszere', 'belső részleteiről']
  },
  {
    question: 'Tetszik a kommunikációd, ki fejlesztett?',
    intent: 'chatbot-development',
    includes: ['Vitalis saját digitális asszisztense', 'jóváhagyott információira']
  },
  {
    question: 'Te mesterséges intelligencia vagy?',
    intent: 'chatbot-identity',
    includes: ['AI-alapú asszisztens', 'Vitalis termékekkel']
  },
  {
    question: 'Ki az a Szalacsi Zoltán?',
    intent: 'vitalis-product-creator',
    includes: ['natúrkozmetikumok fejlesztője és készítője']
  },
  {
    question: 'Ki készíti a Vitalis termékeket?',
    intent: 'vitalis-product-creator',
    includes: ['Szalacsi Zoltán', 'natúrkozmetikumok']
  },
  {
    question: 'Milyen technológiával működsz?',
    intent: 'chatbot-technology',
    includes: ['AI-alapú rendszer', 'belső vagy bizonytalan információt']
  },
  {
    question: 'Hol dolgozol?',
    intent: 'chatbot-identity',
    includes: ['Vitalis webshop online asszisztenseként']
  }
];

for (const test of cases) {
  const { answer, gapCalls } = ask(test.question);
  assert.strictEqual(answer.source, 'meta-intent', test.question);
  assert.strictEqual(answer.intent, test.intent, test.question);
  assert.strictEqual(gapCalls, 0, test.question);
  assert.notStrictEqual(answer.source, 'knowledge-fallback', test.question);
  assert.notStrictEqual(answer.source, 'gap', test.question);
  assert(answer.answer.length >= 45, test.question);
  for (const text of test.includes) {
    assert(answer.answer.includes(text), `${test.question}: ${text}`);
  }
  assert(!/\b(?:Kft|Zrt|OpenAI|fejlesztőcég)\b/i.test(answer.answer), test.question);
}

const developer = ask('Ki csinálta ezt a chatbotot?').answer.answer;
assert(!developer.includes('Szalacsi Zoltán'), 'A chatbot fejlesztőjét nem szabad összekeverni a termékkészítővel.');

const creator = ask('Ki készíti a Vitalis termékeket?').answer.answer;
assert(!/chatbot.*fejleszt/i.test(creator), 'A termékkészítői válasz ne legyen chatbotfejlesztési állítás.');

const ambiguous = ask('Ki készítette ezt?');
assert.strictEqual(ambiguous.answer.intent, 'meta-clarification');
assert.strictEqual(ambiguous.gapCalls, 0);
assert(/termékeket.*chatbot/i.test(ambiguous.answer.answer));

console.log('TEST_META_INTENTS: minden ellenőrzés sikeres');
