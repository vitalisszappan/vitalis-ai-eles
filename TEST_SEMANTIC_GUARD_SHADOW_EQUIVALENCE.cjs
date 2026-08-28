'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const guardPath = require.resolve('./engine/semantic-route-guard.cjs');
const servicePath = require.resolve('./engine/answer-service.cjs');
const realGuard = require(guardPath);
const parsed = JSON.parse(fs.readFileSync('./data/knowledge.json', 'utf8'));
const knowledge = Array.isArray(parsed) ? parsed : parsed.items || parsed.knowledge || [];
const ruleEngine = new ExpertRuleEngine('./data/rules/expert-rules.json');
const originalFlag = process.env.SEMANTIC_GUARD_ENFORCEMENT;

function loadService(validateSemanticRoute) {
  require.cache[guardPath].exports = { validateSemanticRoute };
  delete require.cache[servicePath];
  return require(servicePath);
}

function neutralGuard({ routing }) {
  return {
    decision: 'ACCEPT', enforcement: 'ALLOW', resolutionOwner: 'router', evidenceStrength: 'sufficient',
    hardConflict: false, reasonCodes: ['BASELINE_NO_ENFORCEMENT'], contextUsed: false,
    contextTrustRecommendation: 'TRUST', originalRoute: {
      route: routing.route, goal: routing.goal, intent: routing.intent, domain: routing.domain, source: routing.responseSource
    }, suggestedCapability: null, complaint: null, timingMs: 0
  };
}

const scenarios = [
  { family: 'exact_product', question: 'Dermavital krém', history: [] },
  { family: 'category', question: 'milyen szappanok vannak?', history: [] },
  { family: 'expert', question: 'mit ajánlasz ekcémára?', history: [] },
  { family: 'commerce', question: 'mennyi a kiszállítás?', history: [] },
  { family: 'purchase', question: 'ezt kérem', history: [{ role: 'assistant', content: 'A Dermavital krémet ajánlom.', links: [{ id: 'dermavital_krem' }] }] },
  { family: 'context_followup', question: 'hogyan használjam?', history: [{ role: 'assistant', content: 'A Dermavital krémet ajánlom.', links: [{ id: 'dermavital_krem' }] }] },
  { family: 'safety', question: 'nagyon erős mellkasi fájdalmam van', history: [] },
  { family: 'knowledge_fallback', question: 'elérhetőség', history: [] }
];

process.env.SEMANTIC_GUARD_ENFORCEMENT = 'false';
const baselineService = loadService(neutralGuard);
const baseline = scenarios.map((scenario) => baselineService.createAnswer({ ...scenario, knowledge, ruleEngine, logGap: () => {} }));
const guardedService = loadService(realGuard.validateSemanticRoute);
const guarded = scenarios.map((scenario) => guardedService.createAnswer({ ...scenario, knowledge, ruleEngine, logGap: () => {} }));
require.cache[guardPath].exports = realGuard;
delete require.cache[servicePath];
if (originalFlag === undefined) delete process.env.SEMANTIC_GUARD_ENFORCEMENT;
else process.env.SEMANTIC_GUARD_ENFORCEMENT = originalFlag;

for (let index = 0; index < scenarios.length; index++) {
  const before = baseline[index];
  const after = guarded[index];
  assert.equal(after.answer, before.answer, scenarios[index].family);
  assert.equal(after.source, before.source, scenarios[index].family);
  assert.equal(after.route, before.route, scenarios[index].family);
  assert.deepEqual(after.links, before.links, scenarios[index].family);
  assert.deepEqual(after.suggestions, before.suggestions, scenarios[index].family);
  assert.ok(after.routing.semanticGuard, scenarios[index].family);
}

console.log(`Semantic Guard shadow behavior equivalence: PASS (${scenarios.length}/${scenarios.length})`);
