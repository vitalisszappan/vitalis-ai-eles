'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');
const restoreCatalogFixture = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restoreCatalogFixture);
const { createAnswer } = require('./engine/answer-service.cjs');
const { structuredState, rehydrateSessionHistory } = require('./engine/conversation-memory.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');
const ask = (question, history = []) => createAnswer({ question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });
const addTurn = (history, question, result) => history.push({ role: 'user', content: question }, { role: 'assistant', content: result.answer, route: result.route, intent: result.intent, domain: result.domain, responseType: result.responseSource, links: result.links });
const assertGroundedFacts = (result) => result.factsUsed.filter((fact) => fact.status === 'grounded').forEach((fact) => assert.ok(fact.provenance.length, fact.factType));

let history = [];
const turns = [];
let result = ask('Mit tudsz a Dermavital krémről?', history); addTurn(history, 'Mit tudsz a Dermavital krémről?', result); turns.push(result);
result = ask('Mi van benne?', history); addTurn(history, 'Mi van benne?', result); turns.push(result);
assert.equal(result.answerIntent, 'ingredients'); assert.equal(result.targetProductId, 'dermavital_krem'); assert.equal(result.groundingStatus, 'grounded'); assert.match(result.answer, /Urea \(Karbamid\)/); assertGroundedFacts(result);
result = ask('Mire jó benne az urea?', history); addTurn(history, 'Mire jó benne az urea?', result); turns.push(result);
assert.equal(result.answerIntent, 'ingredient_benefit'); assert.equal(result.targetProductId, 'dermavital_krem'); assert.equal(result.groundingStatus, 'partial'); assert.match(result.answer, /szerepel az urea/i); assert.match(result.answer, /nincs külön bizonyított leírás/i); assert.doesNotMatch(result.answer, /hidrat|puh|nedvesség/i); assertGroundedFacts(result);
result = ask('Hogyan használjam?', history); addTurn(history, 'Hogyan használjam?', result); turns.push(result);
assert.equal(result.answerIntent, 'usage'); assert.equal(result.targetProductId, 'dermavital_krem'); assert.equal(result.groundingStatus, 'grounded'); assert.match(result.answer, /naponta 1–3 alkalommal/); assertGroundedFacts(result);
result = ask('Mennyibe kerül?', history); addTurn(history, 'Mennyibe kerül?', result); turns.push(result);
assert.equal(result.answerIntent, 'price_query'); assert.equal(result.targetProductId, 'dermavital_krem'); assert.equal(result.groundingStatus, 'grounded'); assert.match(result.answer, /3 700 Ft/); assertGroundedFacts(result);
result = ask('Akkor ezt kérem.', history); turns.push(result);
assert.equal(result.route, 'commerce'); assert.equal(result.intent, 'order_start'); assert.equal(result.answerIntent, 'order_start'); assert.equal(result.targetProductId, 'dermavital_krem'); assert.deepEqual(result.links.map((item) => item.id), ['dermavital_krem']);
const purchaseVariant = ask('Megveszem.', history);
assert.equal(purchaseVariant.route, 'commerce'); assert.equal(purchaseVariant.intent, 'order_start'); assert.equal(purchaseVariant.targetProductId, 'dermavital_krem');

result = ask('Mi van benne?'); assert.equal(result.answerIntent, 'ingredients'); assert.equal(result.groundingStatus, 'unavailable'); assert.match(result.answer, /Melyik termékre gondolsz/);
const ambiguous = [{ role: 'assistant', content: 'Két termék.', links: [{ id: 'dermavital_krem', name: 'Dermavital krém' }, { id: 'dermavital_szappan', name: 'Dermavital szappan' }] }];
result = ask('Mi van benne?', ambiguous); assert.equal(result.groundingStatus, 'ambiguous'); assert.match(result.answer, /Melyik termékre gondolsz/);
const focused = history.slice(0, 2);
result = ask('Van benne ceramid?', focused); assert.equal(result.answerIntent, 'ingredients'); assert.match(result.answer, /nem szerepel ceramid/i); assert.doesNotMatch(result.answer, /Igen/);
const missingUsage = [{ role: 'assistant', content: 'Holt-tengeri só balzsam.', links: [{ id: 'holt_tengeri_so_balzsam', name: 'Holt-tengeri só balzsam' }] }];
result = ask('Hogyan használjam?', missingUsage); assert.equal(result.answerIntent, 'usage'); assert.equal(result.groundingStatus, 'unavailable'); assert.match(result.answer, /nincs elérhető, bizonyított használati/);

(async () => {
  const firstTurn = history.slice(0, 2);
  const memory = await rehydrateSessionHistory({
    sessionId: 'phase1b-reload-proof', clientHistory: firstTurn,
    loadRows: async () => [{
      id: 1, created_at: '2026-01-01T00:00:00.000Z', question: firstTurn[0].content,
      answer: firstTurn[1].content, source: firstTurn[1].responseType,
      history_event_status: 'valid', history_event: {
        version: 1, turnId: '11111111-1111-4111-8111-111111111111', kind: 'selection',
        route: firstTurn[1].route, productTypeConstraint: null,
        products: firstTurn[1].links.map(({ id, name }) => ({ id, name })),
        targetProductId: firstTurn[1].targetProductId
      }
    }]
  });
  const reloadResult = createAnswer({ question: 'Mi van benne?', history: memory.history, conversationState: memory.state, knowledge, ruleEngine, logGap() {}, logDiagnostic() {} });
  assert.equal(reloadResult.targetProductId, 'dermavital_krem');
  console.log('Answer Planner Phase 1B: PASS (six-turn + negative + structured reload)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
