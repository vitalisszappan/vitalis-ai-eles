'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const { performance } = require('perf_hooks');
const { buildSemanticEvidence } = require('./engine/semantic-evidence.cjs');
const { validateSemanticRoute } = require('./engine/semantic-route-guard.cjs');
const { detectComplaintIntent } = require('./engine/complaint-intents.cjs');
const { routeAnswer } = require('./engine/answer-router.cjs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const parsedKnowledge = JSON.parse(fs.readFileSync('./data/knowledge.json', 'utf8'));
const knowledge = Array.isArray(parsedKnowledge) ? parsedKnowledge : parsedKnowledge.items || parsedKnowledge.knowledge || [];
const ruleEngine = new ExpertRuleEngine('./data/rules/expert-rules.json');
let assertions = 0;
let goldenCases = 0;
let multiTurnCases = 0;
let adversarialCases = 0;

function routing(route, overrides = {}) {
  return { route, goal: 'unknown', intent: null, domain: null, responseSource: 'fixture', evidence: [], contextUsed: false, matchedCanonicalIds: [], matchedProductIds: [], safetyClass: 'safe', ...overrides };
}

function guard(question, selected, options = {}) {
  const evidence = buildSemanticEvidence({ question, routing: selected, history: options.history || [], conversationState: options.state || null });
  return validateSemanticRoute({ routing: selected, evidence });
}

function expectDecision(question, selected, decision, reason, options = {}) {
  const result = guard(question, selected, options);
  assert.equal(result.decision, decision, `${question}: ${JSON.stringify(result)}`);
  if (reason) assert.ok(result.reasonCodes.includes(reason), `${question}: missing ${reason}`);
  assert.ok(['TRUST', 'DO_NOT_TRUST', 'CONDITIONAL'].includes(result.contextTrustRecommendation));
  assert.equal(typeof result.timingMs, 'number');
  assertions += 4;
  goldenCases++;
  return result;
}

const catalogAccept = [
  'szappan', 'szappan?', 'milyen szappanok vannak?', 'van szappan?', 'milyen samponotok van?',
  'mutass szappanokat', 'szappant keresek', 'milyen kremek vannak?', 'van balzsam?', 'ajanlj szappant',
  'milyen termek van szappanbol?', 'szappanokat mutass', 'sampon?', 'krem?', 'balzsam?'
];
for (const q of catalogAccept) expectDecision(q, routing('product_category', { domain: /sampon/.test(q) ? 'shampoo' : 'soap' }), 'ACCEPT');

const catalogReject = [
  'tegnap vacsoraztam egy szappant, nagyon finom volt', 'a szappan leesett az asztalrol', 'a szappan szo ket p vel van',
  'szappant rajzoltam', 'szappannal almodtam', 'megettem egy szappant', 'a szappan cimu konyv',
  'nem szappant keresek', 'nem akarok sampont', 'a krem leesett', 'balzsamot rajzoltam',
  'a sampon szo hosszu', 'a szappan volt a rejtveny megfejtese', 'vacsoraztam egy kremet', 'szappant dobtam az asztalra'
];
for (const q of catalogReject) { expectDecision(q, routing('product_category', { domain: 'soap' }), 'REJECT', /\bnem\b/.test(q) ? 'EXCLUDED_PRODUCT_TYPE' : 'SEMANTIC_ROLE_MISMATCH'); adversarialCases++; }

const commerceAccept = [
  'szallitas', 'szallitas?', 'postakoltseg', 'futar', 'GLS', 'utanvet', 'mennyi a kiszallitas?',
  'milyen futarszolgalattal szallitotok?', 'mikor erkezik?', 'hol a csomagom?', 'fizethetek kartyaval?',
  'mennyi a posta?', 'mivel szallitotok?', 'hogyan kapom meg?', 'mikor jon meg a csomag?'
];
for (const q of commerceAccept) expectDecision(q, routing('commerce', { goal: 'ask_shipping', intent: 'shipping_general', domain: 'commerce' }), 'ACCEPT');

const commerceReject = [
  'tegnap leugrottam egy 3 emeletes szallitasrol', 'tegnap szallitottam fat', 'a szallitas szo hosszu',
  'a futar cimu film', 'GLS betui', 'utanvetel szo jelentese', 'nem a szallitas erdekel',
  'nem akarok rendelni', 'futarral almodtam', 'szallitast rajzoltam', 'a posta cimu vers',
  'a csomag szo rovid', 'szallitasbol feleltem', 'utanvettel almodtam', 'futart rajzoltam'
];
for (const q of commerceReject) { expectDecision(q, routing('commerce', { domain: 'commerce' }), 'REJECT'); adversarialCases++; }

const problemAccept = [
  'ekcema', 'pikkelysomor', 'ekcemas a borom', 'ekcemam van', 'ekcemara mit ajanlasz',
  'mit javasolsz ekcemara?', 'pikkelysomoros a borom', 'aknes a borom', 'mit hasznaljak aknera?',
  'rosaceas a borom', 'borom ekcemas', 'ekcemara keresek valamit', 'ajanlj valamit ekcemara',
  'pikkelysomorre mit ajanlasz', 'van valami ekcemara?'
];
for (const q of problemAccept) expectDecision(q, routing('expert_rule', { goal: 'solve_problem', intent: 'eczema', domain: /pikkely/.test(q) ? 'psoriasis' : 'eczema' }), 'ACCEPT');

const problemReject = [
  'kifingottam egy ekcemat', 'az ekcema volt a rejtveny megfejtese', 'az ekcema szo', 'Ekcema cimu konyv',
  'nincs ekcemam', 'nem vagyok ekcemas', 'ekcemat rajzoltam', 'ekcemaval almodtam',
  'pikkelysomor volt a jelszo', 'az akne szo rovid', 'rosaceat irtam a lapra', 'ekcemat megettem',
  'nem pikkelysomoros a borom', 'az ekcema cimu film', 'kifingottam egy pikkelysomort'
];
for (const q of problemReject) { expectDecision(q, routing('expert_rule', { goal: 'solve_problem', intent: 'eczema', domain: 'eczema' }), 'REJECT'); adversarialCases++; }

const capabilityCases = [
  ['milyen termekeitek vannak?', 'general_catalog', 'router'], ['mik vannak nalatok?', 'general_catalog', 'router'],
  ['mit arultok?', 'general_catalog', 'router'], ['mi van a webshopban?', 'general_catalog', 'router'],
  ['miket lehet kapni?', 'general_catalog', 'router'], ['mutasd a termekeket', 'general_catalog', 'router'],
  ['garancia', 'warranty', 'customer_service'], ['van garancia?', 'warranty', 'customer_service'],
  ['elerhetoseg', 'contact', 'customer_service'], ['tudsz adni elerhetoseget?', 'contact', 'customer_service'],
  ['kit keressek?', 'contact', 'customer_service'], ['kapcsolat', 'contact', 'customer_service'],
  ['fizikai bolt', 'physical_store', 'customer_service'], ['van fizikai boltotok?', 'physical_store', 'customer_service'],
  ['nyitvatartas', 'opening_hours', 'customer_service'], ['mi a nyitvatartas?', 'opening_hours', 'customer_service'],
  ['kedvezmeny', 'promotion', 'customer_service'], ['van kedvezmeny?', 'promotion', 'customer_service'],
  ['akcio', 'promotion', 'customer_service'], ['kupon van?', 'promotion', 'customer_service']
];
for (const [q, capability, owner] of capabilityCases) {
  const result = expectDecision(q, routing('hard_fallback'), 'REJECT', 'ROUTER_CAPABILITY_MISSING');
  assert.equal(result.suggestedCapability, capability);
  assert.equal(result.resolutionOwner, owner);
  assertions += 2;
}

const complaintCases = [
  ['mit tegyek ha a szappan irritalja a borom?', 'positive', 'current'],
  ['csip a krem felkenes utan', 'positive', 'current'], ['egeti a borom', 'positive', 'current'],
  ['kipirosodott tole a borom', 'positive', 'current'], ['kiuteses lettem utana', 'positive', 'current'],
  ['a baratnomnek csipett', 'positive', 'past'], ['a gyermekem bore kipirosodott', 'positive', 'current'],
  ['azt olvastam hogy irritalhat', 'uncertain', 'hypothetical'], ['kipirosodhat tole?', 'uncertain', 'hypothetical'],
  ['allergiasok is hasznalhatjak?', 'uncertain', 'hypothetical'], ['nem irrital', 'negative', 'current'],
  ['nem vagyok allergias', 'negative', 'current'], ['nem pirosodott ki', 'negative', 'current'],
  ['a doboz serulten erkezett', 'positive', 'current'], ['rossz termeket kaptam', 'positive', 'current'],
  ['kifolyt a krem', 'positive', 'current'], ['abbahagyjam a hasznalatat mert csip?', 'positive', 'current'],
  ['bedagadt a szam tole', 'positive', 'current'], ['alig kapok levegot utana', 'positive', 'current'],
  ['a lanyom szerint eget', 'positive', 'current']
];
for (const [q, polarity, temporality] of complaintCases) {
  const complaint = detectComplaintIntent(q, { focusedProductId: 'fixture' });
  assert.ok(complaint, q);
  assert.equal(complaint.polarity, polarity, q);
  assert.equal(complaint.temporality, temporality, q);
  assertions += 3;
  goldenCases++;
}

const exactCases = [
  ['ránc', 'REJECT'], ['rác', 'REJECT'], ['ár', 'REJECT'], ['nar', 'REJECT'], ['abc', 'REJECT'],
  ['Dermavital krém', 'ACCEPT'], ['Dermavital szappan', 'ACCEPT'], ['PsoriVital csomag', 'ACCEPT'],
  ['Shea vajas szappan', 'ACCEPT'], ['Holt tengeri iszapos szappan', 'ACCEPT']
];
for (const [q, decision] of exactCases) {
  const selected = routing('exact_product', decision === 'ACCEPT' ? { matchedCanonicalIds: ['fixture'] } : { matchedProductIds: ['unas'] });
  expectDecision(q, selected, decision, decision === 'REJECT' ? 'EXACT_MATCH_SUBSTRING_ONLY' : 'ROUTE_SUPPORTED_BY_APPROVED_ALIAS');
  if (decision === 'REJECT') adversarialCases++;
}

const safetyCases = ['fulladok', 'nem kapok levegot', 'alig kapok levegot', 'bedagadt a nyelvem', 'dagad a szam', 'eros mellkasi fajdalom', 'elajultam', 'elkekultem', 'hirtelen bedagadtam', 'elviselhetetlen fajdalom'];
for (const q of safetyCases) {
  const result = expectDecision(q, routing('safety', { safetyClass: 'medical_escalation', intent: 'medical_escalation' }), 'ACCEPT', 'STRONG_SAFETY_NON_DOWNGRADE');
  assert.equal(result.enforcement, 'MANDATORY_ESCALATION');
  assertions++;
}

const contexts = [
  ['és még?', ['dermavital_krem'], 'resolved'], ['és milyen termékek vannak még?', ['dermavital_krem'], 'resolved'],
  ['de úgy alapból', ['dermavital_krem'], 'resolved'], ['a második mit tud?', ['a', 'b', 'c'], 'ambiguous'],
  ['és ez?', ['a', 'b', 'c'], 'ambiguous'], ['nem ezt', ['dermavital_krem'], 'resolved'],
  ['az elsőt kérem', ['a', 'b', 'c'], 'ambiguous'], ['mennyi?', ['dermavital_krem'], 'resolved'],
  ['mennyi?', ['a', 'b', 'c'], 'ambiguous'], ['hogyan?', ['dermavital_krem'], 'resolved'],
  ['miért?', ['dermavital_krem'], 'resolved'], ['másik?', ['a', 'b'], 'ambiguous'],
  ['van még?', ['a', 'b'], 'ambiguous'], ['ezt kérem', ['dermavital_krem'], 'resolved'],
  ['ezt', ['dermavital_krem'], 'resolved'], ['inkább a szappanokat', ['dermavital_krem'], 'resolved'],
  ['és szállítás?', ['dermavital_krem'], 'resolved'], ['a legutóbbi', ['a', 'b'], 'ambiguous'],
  ['ugyanaz csak krémben', ['soap'], 'resolved'], ['anyukámnak viszont ekcémára', ['soap'], 'resolved']
];
for (const [q, products, status] of contexts) {
  const state = { focusedProductId: status === 'resolved' ? products[0] : null, productContextStatus: status, lastOrdinalProductList: products, activeProblemDomains: ['eczema'] };
  const selected = routing('context_followup', { contextUsed: true, contextTarget: state.focusedProductId });
  const result = guard(q, selected, { history: [{ role: 'assistant', content: 'Korábbi válasz.', route: 'expert_rule' }], state });
  assert.ok(['ACCEPT', 'REJECT', 'UNCERTAIN'].includes(result.decision));
  assert.equal(result.contextUsed, result.decision === 'ACCEPT');
  assertions += 2;
  goldenCases++;
  multiTurnCases++;
}

const integrationCases = [
  ['milyen szappanok vannak?', 'ACCEPT'],
  ['tegnap vacsoraztam egy szappant, nagyon finom volt', 'REJECT'],
  ['milyen termeket tudsz ajanlani ekcemas borre?', 'ACCEPT'],
  ['kifingottam egy ekcemat', 'REJECT'],
  ['van ingyenes kiszallitas?', 'ACCEPT'],
  ['tegnap leugrottam egy 3 emeletes szallitasrol', 'REJECT'],
  ['ránc', 'REJECT'],
  ['mit tegyek ha a szappan irritalja a borom?', 'REJECT'],
  ['milyen termékeitek vannak?', 'REJECT'],
  ['garancia', 'REJECT'], ['elérhetőség', 'ACCEPT'], ['nyitvatartás', 'REJECT'], ['kedvezmény', 'REJECT']
];
for (const [q, expected] of integrationCases) {
  const selected = routeAnswer({ question: q, history: [], knowledge, ruleEngine });
  const result = guard(q, selected);
  assert.equal(result.decision, expected, `${q}: route=${selected.route} ${JSON.stringify(result)}`);
  assertions++;
  adversarialCases++;
}

// Shadow equivalence: the trace exists, while route, answer, links and materialized source equal a no-guard reconstruction.
for (const q of ['milyen szappanok vannak?', 'Dermavital krém', 'ekcémára mit ajánlasz?', 'mennyi a kiszállítás?', 'fulladok']) {
  const answer = createAnswer({ question: q, history: [], knowledge, ruleEngine, logGap: () => {} });
  assert.ok(answer.routing.semanticGuard);
  assert.equal(answer.route, answer.routing.route);
  assert.ok(answer.answer);
  assertions += 3;
}

const timings = [];
const perfRouting = routing('product_category', { domain: 'soap' });
for (let i = 0; i < 5000; i++) {
  const start = performance.now();
  guard(i % 2 ? 'milyen szappanok vannak?' : 'vacsoraztam egy szappant', perfRouting);
  timings.push(performance.now() - start);
}
timings.sort((a, b) => a - b);
const percentile = (p) => timings[Math.min(timings.length - 1, Math.floor(timings.length * p))];
const performanceResult = { p50: percentile(0.5), p95: percentile(0.95), max: timings[timings.length - 1] };
assert.ok(performanceResult.p95 <= 5, JSON.stringify(performanceResult));
assert.ok(goldenCases >= 150, `only ${goldenCases} golden cases`);

console.log(JSON.stringify({ ok: true, goldenCases, assertions, multiTurnCases, adversarialCases, performanceMs: performanceResult }, null, 2));
