'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');

const parsed = JSON.parse(fs.readFileSync('./data/knowledge.json', 'utf8'));
const knowledge = Array.isArray(parsed) ? parsed : parsed.items || parsed.knowledge || [];
const ruleEngine = new ExpertRuleEngine('./data/rules/expert-rules.json');
const originalFlag = process.env.SEMANTIC_GUARD_ENFORCEMENT;
const ask = (question, history = [], conversationState = structuredState(history)) => createAnswer({
  question, history, conversationState, knowledge, ruleEngine, logGap() {}
});

const complaintCases = [
  'irritálja a bőröm a szappan',
  'ettől a krémtől kipirosodtam',
  'csíp a krém használat után',
  'a szappantól viszket a bőröm',
  'a sampontól kipirosodott a fejbőröm',
  'a balzsamtól irritált lett a bőröm, és még most is irritált',
  'felkenés után csíp a krém',
  'attól a szappantól pirosodtam ki',
  'a dezodor irritálja a bőröm',
  'a tusfürdőtől viszket a bőröm',
  'Dermavital szappan csíp',
  'Dermavital krémtől kipirosodtam',
  'Dermavital sampon irritálja a fejbőröm',
  'Aktív szenes szappan csíp',
  'tegnap irritált, még most is piros',
  'múltkor csípett, de még mindig érzem',
  'barátnőmnek csíp a krém használat után',
  'gyerekem bőrét irritálja a szappan',
  'irritál a szappan, mit használjak helyette?',
  'kipirosodtam, melyik szappant ajánlod?',
  'csíp a krém, van másik?',
  'csíp a krém, de ezt szeretném megrendelni',
  'irritál a szappan, akkor a másodikat kérem',
  'ettől kipirosodtam',
  'kipirosodtam, visszakaphatom a pénzem?'
];

const controls = [
  'a balzsamtól irritált lett a bőröm',
  'a balzsamtól irritált lett a bőröm, de már elmúlt',
  'irritált bőrre keresek krémet',
  'érzékeny a bőröm',
  'nem irritáló szappant keresek',
  'kipirosodásra keresek valamit',
  'irritálhat?',
  'okozhat kipirosodást?',
  'mi van, ha kipirosodok?',
  'nem irritál',
  'nem pirosodtam ki',
  'egyáltalán nem csíp',
  'tegnap irritált, de már elmúlt',
  'múltkor csípett, most nincs baj',
  'már elmúlt és nincs baj',
  'csípős illatot keresek',
  'égetően szükségem van szappanra',
  'furcsa szaga van',
  'megolvadt',
  'törött',
  'elszíneződött',
  'rossz az állaga'
];

const safetyCases = [
  'nehezen kapok levegőt',
  'bedagadt a nyelvem',
  'felhólyagosodott a bőröm',
  'bedagadt a nyelvem, mit használjak helyette?',
  'nehezen kapok levegőt, de ezt megrendelném'
];

const forbidden = /ne használd tovább|öblítsd le vízzel|ez allergia|allergiás reakciód van|a termék okozta|a termék hibás|a termék veszélyes|fordulj bőrgyógyászhoz|visszakapod a pénzed|kicseréljük/i;

function assistantMessage(answer) {
  return {
    role: 'assistant', content: answer.answer, route: answer.route, intent: answer.intent,
    domain: answer.domain, targetProductId: answer.targetProductId, links: answer.links,
    routing: answer.routing
  };
}

function assertIsolated(answer, question) {
  assert.equal(answer.route, 'complaint', question);
  assert.equal(answer.routing.semanticGuard.resolutionOwner, 'complaint', question);
  assert.equal(answer.routing.semanticGuard.ownershipApplied, true, question);
  assert.equal(answer.routing.semanticGuard.ownershipClass, 'complaint', question);
  assert.equal(answer.routing.semanticGuard.enforcementClass, null, question);
  assert.equal(answer.routing.semanticGuard.resolvedRoute.route, 'complaint', question);
  assert.equal(answer.recommendationAllowed, false, question);
  assert.equal(answer.purchaseAllowed, false, question);
  assert.equal(answer.productLinksAllowed, false, question);
  assert.deepEqual(answer.links, [], question);
  assert.equal(answer.targetProductId, null, question);
  assert.equal(forbidden.test(answer.answer), false, question);
  const history = [{ role: 'user', content: question }, assistantMessage(answer)];
  const state = structuredState(history);
  assert.equal(state.focusedProductId, null, question);
  assert.equal(state.purchaseProductId, null, question);
  assert.equal(state.selectedProductId, null, question);
  assert.deepEqual(state.lastRecommendedProducts, [], question);
  assert.deepEqual(state.activeProductIds, [], question);
  assert.equal(state.productContextStatus, 'unresolved', question);
}

try {
  process.env.SEMANTIC_GUARD_ENFORCEMENT = 'true';
  for (const question of complaintCases) assertIsolated(ask(question), question);

  for (const question of controls) {
    const answer = ask(question);
    assert.notEqual(answer.route, 'complaint', question);
    assert.notEqual(answer.routing.semanticGuard.ownershipApplied, true, question);
  }

  for (const question of safetyCases) {
    const answer = ask(question);
    assert.equal(answer.route, 'safety', question);
    assert.equal(answer.intent, 'medical_escalation', question);
    assert.equal(answer.routing.semanticGuard.resolutionOwner, 'safety', question);
    assert.notEqual(answer.routing.semanticGuard.ownershipClass, 'complaint', question);
    assert.deepEqual(answer.links, [], question);
  }

  const known = ask('Dermavital szappan csíp');
  assert.equal(known.resolutionFamily, 'complaint_product_known');
  assert.equal(known.complaintSubjectProductId, 'dermavital_szappan');
  assert.match(known.answer, /Dermavital szappan/);
  assert.equal(known.links.length, 0);

  const unknown = ask('ettől kipirosodtam');
  assert.equal(unknown.resolutionFamily, 'complaint_product_unknown');
  assert.equal(unknown.complaintSubjectProductId, null);
  assert.match(unknown.answer, /Melyik termékről/);

  const status = ask('tegnap irritált, még most is piros');
  assert.equal(status.resolutionFamily, 'complaint_status_unclear');
  assert.match(status.answer, /Most is fennáll/);

  const turn1 = ask('Mit ajánlasz ekcémára?');
  const history1 = [{ role: 'user', content: 'Mit ajánlasz ekcémára?' }, assistantMessage(turn1)];
  const turn2 = ask('ettől kipirosodtam', history1, structuredState(history1));
  assertIsolated(turn2, 'contextual complaint');
  assert.notEqual(turn2.complaintSubjectProductId, null);
  const history2 = [...history1, { role: 'user', content: 'ettől kipirosodtam' }, assistantMessage(turn2)];
  const postComplaintState = structuredState(history2);
  assert.equal(postComplaintState.focusedProductId, null);
  assert.deepEqual(postComplaintState.activeProductIds, []);
  const turn3 = ask('mit tud?', history2, postComplaintState);
  assert.equal(turn3.targetProductId == null, true);
  assert.deepEqual(turn3.links, []);

  const complaintFirst = ask('Dermavital szappan csíp');
  const complaintHistory = [{ role: 'user', content: 'Dermavital szappan csíp' }, assistantMessage(complaintFirst)];
  const isolatedState = structuredState(complaintHistory);
  const purchaseFollowup = ask('akkor ezt kérem', complaintHistory, isolatedState);
  assert.equal(purchaseFollowup.targetProductId == null, true);
  assert.deepEqual(purchaseFollowup.links, []);
  const identityFollowup = ask('melyik volt az?', complaintHistory, isolatedState);
  assert.equal(identityFollowup.targetProductId == null, true);
  assert.deepEqual(identityFollowup.links, []);

  process.env.SEMANTIC_GUARD_ENFORCEMENT = 'false';
  const darkCases = [
    ['irritálja a bőröm a szappan', 'product_category'],
    ['ettől a krémtől kipirosodtam', 'product_category'],
    ['csíp a krém használat után', 'product_category'],
    ['irritál a szappan, mit használjak helyette?', 'product_category'],
    ['Dermavital szappan csíp', 'exact_product'],
    ['ettől kipirosodtam', 'hard_fallback']
  ];
  for (const [question, route] of darkCases) {
    const answer = ask(question);
    assert.equal(answer.route, route, question);
    assert.equal(answer.routing.semanticGuard.enforcementEnabled, false, question);
    assert.notEqual(answer.routing.semanticGuard.ownershipApplied, true, question);
  }
  assert(ask('irritálja a bőröm a szappan').links.length > 0);
  assert.equal(ask('Dermavital szappan csíp').links.length, 1);
  assert.equal(ask('nehezen kapok levegőt').route, 'safety');
} finally {
  if (originalFlag === undefined) delete process.env.SEMANTIC_GUARD_ENFORCEMENT;
  else process.env.SEMANTIC_GUARD_ENFORCEMENT = originalFlag;
}

console.log(`Semantic Guard Complaint B2 P0: PASS (${complaintCases.length + controls.length + safetyCases.length} matrix cases + multi-turn + flag-off)`);
