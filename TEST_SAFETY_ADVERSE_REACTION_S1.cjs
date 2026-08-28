'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const { evaluateSafety } = require('./engine/safety-gate.cjs');

const parsed = JSON.parse(fs.readFileSync('./data/knowledge.json', 'utf8'));
const knowledge = Array.isArray(parsed) ? parsed : parsed.items || parsed.knowledge || [];
const ruleEngine = new ExpertRuleEngine('./data/rules/expert-rules.json');
const originalFlag = process.env.SEMANTIC_GUARD_ENFORCEMENT;
const ask = (question) => createAnswer({
  question,
  history: [],
  conversationState: structuredState([]),
  knowledge,
  ruleEngine,
  logGap() {}
});

const positives = [
  ['nehezen kapok levegőt', 'breathing'],
  ['alig kapok levegőt', 'breathing'],
  ['nem kapok levegőt', 'breathing'],
  ['nehéz levegőt vennem', 'breathing'],
  ['nehézlégzésem van', 'breathing'],
  ['nehezen kapok levegot', 'breathing-accentless'],
  ['bedagadt a szám', 'swelling'],
  ['bedagadt a nyelvem', 'swelling'],
  ['bedagadt a torkom', 'swelling'],
  ['feldagadt a szám', 'swelling'],
  ['megdagadt a nyelvem', 'swelling'],
  ['bedagadtam', 'swelling-person'],
  ['felhólyagosodott a bőröm', 'blistering'],
  ['hólyagos lett a bőröm', 'blistering'],
  ['hólyagok jelentek meg', 'blistering'],
  ['erősen felhólyagosodott', 'blistering'],
  ['felholyagosodott a borom', 'blistering-accentless'],
  ['Dermavital krémtől nehezen kapok levegőt', 'exact-product'],
  ['ettől nehezen kapok levegőt', 'pronoun'],
  ['a szappan után bedagadt a nyelvem', 'category'],
  ['gyerekem nehezen kap levegőt', 'child'],
  ['barátnőmnek bedagadt a szája', 'third-party'],
  ['nehezen kapok levegőt, melyik szappant ajánlod?', 'recommendation-priority'],
  ['bedagadt a nyelvem, ezt kérem', 'purchase-priority'],
  ['tegnap vacsoráztam egy szappant és most nehezen kapok levegőt', 'semantic-mismatch-priority']
];

const negatives = [
  'nem nehéz levegőt vennem',
  'nem dagadt be',
  'nem hólyagos',
  'lehet, hogy bedagad a szám?',
  'okozhat hólyagosodást?',
  'hallottam, hogy valakinek bedagadt a szája',
  'érzékeny a bőröm',
  'kicsit csíp',
  'enyhén kipirosodott',
  'irritál a szappan',
  'viszket a bőröm',
  'tegnap bedagadt a szám, most jól vagyok',
  'mi van, ha bedagad a szám?',
  'a festék felhólyagosodott',
  'a lufi feldagadt a napon',
  'nehéz levegőt venni a búvárfelszerelésben?',
  'hólyagos csomagolást keresek'
];

function safetyHistory(question, answer) {
  return [
    { role: 'user', content: question },
    {
      role: 'assistant', content: answer.answer, route: answer.route,
      intent: answer.intent, domain: answer.domain,
      targetProductId: answer.targetProductId, links: answer.links
    }
  ];
}

try {
  delete process.env.SEMANTIC_GUARD_ENFORCEMENT;
  for (const [question, family] of positives) {
    const detected = evaluateSafety(question);
    assert.equal(detected.safetyClass, 'medical_escalation', `${family}: ${question}`);
    assert(detected.evidence.some((item) => item.startsWith('safety:severe_adverse_reaction:')), question);

    const answer = ask(question);
    assert.equal(answer.route, 'safety', question);
    assert.equal(answer.intent, 'medical_escalation', question);
    assert.equal(answer.routing.semanticGuard.resolutionOwner, 'safety', question);
    assert.equal(answer.routing.semanticGuard.enforcementApplied, false, question);
    assert.deepEqual(answer.links, [], question);
    assert.equal(answer.targetProductId == null, true, question);
    assert.deepEqual(answer.routing.matchedProductIds, [], question);
    assert.deepEqual(answer.routing.recommendedProductIds || [], [], question);

    const state = structuredState(safetyHistory(question, answer));
    assert.equal(state.focusedProductId, null, question);
    assert.equal(state.purchaseProductId, null, question);
    assert.equal(state.selectedProductId, null, question);
    assert.deepEqual(state.lastRecommendedProducts, [], question);
    assert.deepEqual(state.activeProductIds, [], question);
  }

  for (const question of negatives) {
    const detected = evaluateSafety(question);
    assert.notEqual(detected.safetyClass, 'medical_escalation', question);
    const answer = ask(question);
    assert.notEqual(answer.route, 'safety', question);
  }

  process.env.SEMANTIC_GUARD_ENFORCEMENT = 'true';
  for (const question of [
    'nehezen kapok levegőt, melyik szappant ajánlod?',
    'bedagadt a nyelvem, ezt kérem',
    'tegnap vacsoráztam egy szappant és most nehezen kapok levegőt'
  ]) {
    const answer = ask(question);
    assert.equal(answer.route, 'safety', question);
    assert.equal(answer.routing.semanticGuard.resolutionOwner, 'safety', question);
    assert.equal(answer.routing.semanticGuard.enforcementClass, null, question);
    assert.equal(answer.routing.semanticGuard.enforcementApplied, false, question);
    assert.deepEqual(answer.links, [], question);
  }
} finally {
  if (originalFlag === undefined) delete process.env.SEMANTIC_GUARD_ENFORCEMENT;
  else process.env.SEMANTIC_GUARD_ENFORCEMENT = originalFlag;
}

console.log(`Safety adverse-reaction S1: PASS (${positives.length} positive, ${negatives.length} negative)`);
