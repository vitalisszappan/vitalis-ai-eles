'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { rehydrateSessionHistory } = require('./engine/conversation-memory.cjs');
const { buildConversationHistoryEvent, validateConversationHistoryRows } = require('./server.cjs');

const knowledge = JSON.parse(fs.readFileSync('data/knowledge.json', 'utf8'));
const ruleEngine = new ExpertRuleEngine('data/rules/expert-rules.json');

async function conversation(questions) {
  const sessionId = crypto.randomUUID();
  const rows = [];
  const results = [];
  results.states = [];
  results.events = [];
  for (const [index, question] of questions.entries()) {
    const memory = await rehydrateSessionHistory({
      sessionId, clientHistory: [], loadRows: async () => validateConversationHistoryRows(rows)
    });
    results.states.push(memory.state);
    const result = createAnswer({
      question, history: memory.history, conversationState: memory.state, knowledge, ruleEngine,
      logGap() {}, logDiagnostic() {}
    });
    results.push(result);
    const event = buildConversationHistoryEvent(result, crypto.randomUUID());
    results.events.push(event);
    rows.push({
      id: crypto.randomUUID(), created_at: new Date(Date.UTC(2026, 9, 13, 16, 0, index)).toISOString(),
      session_id: sessionId, question, answer: result.answer, source: result.source, history_event: event
    });
  }
  return results;
}

const base = ['Ekcémás, nagyon száraz a bőröm. Mit ajánlasz?', 'Van másik?'];

function assertPersistedContext(results) {
  assert.deepEqual(results.states[2].activeProblemDomains, ['eczema']);
  assert.deepEqual(results.states[2].lastRecommendedProducts, ['dermavital_krem', 'dermavital_szappan']);
  assert.equal(results.states[2].focusedProductId, 'dermavital_krem');
  assert.equal(results.events[1].kind, 'none');
  assert.equal(results.events[1].route, 'recommendation_alternative');
  assert.equal(results.events[2].kind, 'none');
  assert.equal(results.events[2].route, 'recommendation_alternative');
}

function assertRefinement(result, intent) {
  assert.equal(result.route, 'recommendation_alternative');
  assert.equal(result.intent, intent);
  assert.equal(result.contextUsed, true);
  assert.equal(result.targetProductId, 'dermavital_krem');
  assert.doesNotMatch(result.answer, /nincs elég biztos|melyik termékre|gyógyít|kezel/i);
}

(async () => {
  const one = await conversation([...base, 'Csak egy terméket szeretnék.']);
  assertPersistedContext(one);
  assertRefinement(one[2], 'recommendation_refinement_one_product');
  assert.deepEqual(one[2].links.map((item) => item.id), ['dermavital_krem']);
  assert.match(one[2].answer, /csak egy terméket.*Dermavital krémet.*száraz.*érzékeny/i);

  const price = await conversation([...base, 'Nekem az ár is számít.']);
  assertPersistedContext(price);
  assertRefinement(price[2], 'recommendation_refinement_price');
  assert.deepEqual(price[2].links.map((item) => item.id), ['dermavital_krem', 'dermavital_szappan']);
  assert.match(price[2].answer, /Dermavital szappan.*2 700 Ft.*Dermavital krém.*3 700 Ft.*továbbra is.*Dermavital krémet/i);
  assert.equal(price[2].factsUsed.filter((fact) => fact.factType === 'price' && fact.status === 'grounded').length, 2);

  const noSoap = await conversation([...base, 'Inkább ne szappan legyen.']);
  assertPersistedContext(noSoap);
  assertRefinement(noSoap[2], 'recommendation_refinement_exclude_soap');
  assert.deepEqual(noSoap[2].links.map((item) => item.id), ['dermavital_krem']);
  assert.match(noSoap[2].answer, /ne szappan.*Dermavital krémet/i);

  const sensitive = await conversation([...base, 'Nagyon érzékeny a bőröm.']);
  assertRefinement(sensitive[2], 'recommendation_refinement_sensitive_skin');
  assertPersistedContext(sensitive);
  assert.match(sensitive[2].answer, /érzékeny bőr.*mindkét.*Dermavital krémet.*tisztálkodási alternatíva/i);
  assert.equal(sensitive[2].factsUsed.filter((fact) => fact.factType === 'productBenefits' && fact.status === 'grounded').length, 2);

  const variants = [
    ['csak egyet vennék', 'recommendation_refinement_one_product'],
    ['az ár is fontos', 'recommendation_refinement_price'],
    ['olcsóbb megoldást szeretnék', 'recommendation_refinement_price'],
    ['szappant inkább nem', 'recommendation_refinement_exclude_soap'],
    ['érzékeny a bőröm', 'recommendation_refinement_sensitive_skin']
  ];
  for (const [question, intent] of variants) {
    const results = await conversation([...base, question]);
    assertRefinement(results[2], intent);
  }

  const standalone = await conversation(['Csak egy terméket szeretnék.']);
  assert.equal(standalone[0].route, 'clarification');
  assert.match(standalone[0].answer, /Milyen problémára vagy igényre/i);

  const single = await conversation(['Hajhullásra mit ajánlasz?', 'Nekem az ár is számít.']);
  assert.equal(single[1].route, 'clarification');
  assert.match(single[1].answer, /legalább két.*ajánlott termék/i);
  assert.equal(single[1].links.length, 0);

  const noApprovedNonSoap = await conversation(['Hajhullásra mit ajánlasz?', 'Inkább ne szappan legyen.']);
  assert.equal(noApprovedNonSoap[1].route, 'recommendation_alternative');
  assert.equal(noApprovedNonSoap[1].intent, 'recommendation_refinement_exclude_soap');
  assert.match(noApprovedNonSoap[1].answer, /nincs másik.*jóváhagyott nem szappan/i);
  assert.equal(noApprovedNonSoap[1].links.length, 0);

  const explicit = await conversation(['Dermavital krém', 'Mennyibe kerül?']);
  assert.equal(explicit[1].route, 'commerce');
  assert.match(explicit[1].answer, /3 700 Ft/);

  console.log('RECOMMENDATION_PREFERENCE_REFINEMENT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
