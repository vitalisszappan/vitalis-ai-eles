'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');

const restoreCatalogFixture = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restoreCatalogFixture);

const { createAnswer } = require('./engine/answer-service.cjs');
const { structuredState, rehydrateSessionHistory } = require('./engine/conversation-memory.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const knowledge = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'knowledge.json'), 'utf8'));
const ruleEngine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));

const ask = (question, history = [], state = structuredState(history)) => createAnswer({
  question,
  history,
  conversationState: state,
  knowledge,
  ruleEngine,
  logGap() {},
  logDiagnostic() {}
});

const assistantTurn = (result) => ({
  role: 'assistant',
  content: result.answer,
  route: result.route,
  intent: result.intent,
  links: result.links,
  targetProductId: result.targetProductId || null
});

const trustedRows = (history) => {
  const rows = [];
  for (let index = 0; index < history.length; index += 1) {
    if (history[index]?.role !== 'assistant') continue;
    const user = [...history.slice(0, index)].reverse().find((item) => item?.role === 'user');
    const links = Array.isArray(history[index].links) ? history[index].links : [];
    rows.push({
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, rows.length)).toISOString(),
      question: user?.content || 'Előző kérdés',
      answer: history[index].content,
      source: 'trusted-test',
      history_event_status: 'valid',
      history_event: {
        version: 1,
        turnId: `44444444-4444-4444-8444-${String(rows.length + 1).padStart(12, '0')}`,
        kind: links.length ? 'selection' : 'none',
        route: history[index].route || 'expert_rule',
        intent: history[index].intent || 'product_recommendation',
        products: links
      }
    });
  }
  return rows;
};

const psoriasisQuestion = 'Hol találok pikkelysömörre megoldást?';
const expectedIds = ['psorivital_csomag', 'dermavital_szappan', 'tengeri_soszappan'];

let history = [];
const first = ask(psoriasisQuestion, history);
assert.equal(first.route, 'expert_rule');
assert.equal(first.routing.primaryProductId, 'psorivital_csomag');
assert.deepEqual(first.links.map((item) => item.id), expectedIds);
history = [...history, { role: 'user', content: psoriasisQuestion }, assistantTurn(first)];

const followUps = [
  'Melyik a jobb?',
  'Melyik jobb?',
  'Melyiket ajánlod inkább?',
  'Ha csak egyet választanál, melyiket?'
];

for (const question of followUps) {
  const response = ask(question, history);
  assert.notEqual(response.route, 'hard_fallback', question);
  assert.equal(response.routing.contextUsed, true, question);
  assert.equal(response.routing.primaryProductId, 'psorivital_csomag', question);
  assert.equal(response.targetProductId, 'psorivital_csomag', question);
  assert.equal(response.routing.contextTarget, 'psorivital_csomag', question);
  assert.notEqual(response.routing.rejectionReasons?.includes('missing_recommendation_choice_products'), true, question);
  assert.match(response.answer, /PsoriVital/i, question);
  assert.match(response.answer, /(elsődleges|inkább|választanám|javaslom)/i, question);
  assert.doesNotMatch(response.answer, /\b(univerzálisan|mindenkinek|mindig)\s+jobb\b/i, question);
  assert.doesNotMatch(response.answer, /\b(gyógyít|kezel|meggyógyít|orvosi kezelés)\b/i, question);
}

const noContext = ask('Melyik a jobb?', []);
assert.notEqual(noContext.targetProductId, 'psorivital_csomag');
assert.notEqual(noContext.routing?.primaryProductId, 'psorivital_csomag');
assert.notEqual(noContext.route, 'recommendation_alternative');

(async () => {
  const sessionId = 'expert-recommendation-choice-session';
  const memory = await rehydrateSessionHistory({
    sessionId,
    clientHistory: history,
    loadRows: async () => trustedRows(history)
  });
  const reloaded = ask('Melyik a jobb?', memory.history, memory.state);
  assert.equal(reloaded.route, 'recommendation_alternative');
  assert.equal(reloaded.routing.contextUsed, true);
  assert.equal(reloaded.routing.primaryProductId, 'psorivital_csomag');
  assert.equal(reloaded.targetProductId, 'psorivital_csomag');
  assert.match(reloaded.answer, /PsoriVital/i);

  restoreCatalogFixture();
  console.log('TEST_EXPERT_RECOMMENDATION_CHOICE: PASS');
})().catch((error) => {
  restoreCatalogFixture();
  console.error(error);
  process.exitCode = 1;
});
