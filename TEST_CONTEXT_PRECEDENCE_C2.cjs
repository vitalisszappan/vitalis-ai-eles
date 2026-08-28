'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');
const restoreCatalogFixture = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restoreCatalogFixture);
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');

const parsed = JSON.parse(fs.readFileSync('./data/knowledge.json', 'utf8'));
const knowledge = Array.isArray(parsed) ? parsed : parsed.items || parsed.knowledge || [];
const ruleEngine = new ExpertRuleEngine('./data/rules/expert-rules.json');
const ask = (question, history = []) => createAnswer({
  question, history, conversationState: structuredState(history), knowledge, ruleEngine, logGap() {}
});
const append = (history, question, result) => [
  ...history, { role: 'user', content: question }, { role: 'assistant', content: result.answer, ...result }
];
const sequence = (first, second) => {
  const firstResult = ask(first);
  const history = append([], first, firstResult);
  return { firstResult, history, secondResult: ask(second, history) };
};

// A/B: explicit current need owns the turn; unsupported need cannot revive the old expert domain.
let run = sequence('Mit ajánlasz pattanásos bőrre?', 'És érzékeny bőrre?');
assert.notEqual(run.secondResult.intent, 'acne');
run = sequence('Viszket a fejbőröm.', 'És érzékeny bőrre?');
assert.notEqual(run.secondResult.intent, 'scalp_itchy');
assert.notEqual(run.secondResult.intent, 'scalp_problem');
assert.equal(sequence('Mit ajánlasz pikkelysömörre?', 'És száraz bőrre?').secondResult.intent, 'dry_skin');
assert.equal(sequence('Mit ajánlasz száraz bőrre?', 'És pattanásos bőrre?').secondResult.intent, 'acne');
assert.equal(sequence('Mire jó a Dermavital sampon?', 'Most inkább pattanásos bőrre keresek valamit.').secondResult.intent, 'acne');
assert.notEqual(sequence('Mit ajánlasz ekcémára?', 'Most sampont keresek.').secondResult.intent, 'eczema');

// C/D/E/F/G: one authoritative list drives details, price and purchase resolution.
const catalog = sequence('Mutass két szappant.', 'Mit tud a második?');
const ordered = catalog.firstResult.links.map((link) => link.id);
assert.ok(ordered.length >= 2);
assert.equal(catalog.secondResult.contextTarget, 'dermavital_szappan');
assert.deepEqual(catalog.secondResult.links.map((link) => link.id), ['dermavital_szappan']);
assert.equal(sequence('Mutass két szappant.', 'Mennyibe kerül a második?').secondResult.contextTarget, 'dermavital_szappan');
assert.equal(sequence('Mutass két szappant.', 'Az elsőt kérem.').secondResult.contextTarget, ordered[0]);
assert.equal(sequence('Mutass két szappant.', 'Inkább a másodikat.').secondResult.contextTarget, 'dermavital_szappan');
assert.equal(sequence('Mit ajánlasz ekcémára?', 'Az előbbit kérem.').secondResult.contextTarget, 'dermavital_krem');
assert.equal(sequence('Mit ajánlasz ekcémára?', 'Az utóbbit kérem.').secondResult.contextTarget, 'dermavital_szappan');

// H/I/J: alternative, explicit variant and genuinely ambiguous generic another stay distinct.
run = sequence('Viszket és hámlik a fejbőröm.', 'Van belőle másik?');
assert.equal(run.secondResult.contextTarget, 'rozmaringos_samponszappan');
assert.equal(run.secondResult.routing.referenceType, 'alternative');
assert.doesNotMatch(run.secondResult.answer, /másik változatról/i);
run = sequence('Mire jó a Dermavital sampon?', 'Van másik változat?');
assert.equal(run.secondResult.contextTarget, 'dermavital_sampon');
assert.equal(run.secondResult.routing.referenceType, 'variant');
run = sequence('Mire jó a Dermavital sampon?', 'Van másik?');
assert.equal(run.secondResult.route, 'clarification');

// K/L: only the authoritative relation may resolve the elliptical product type.
run = sequence('Mire jó a Dermavital sampon?', 'És a szappan?');
assert.equal(run.secondResult.contextTarget, 'rozmaringos_samponszappan');
assert.equal(run.secondResult.routing.referenceType, 'companion');
assert.notEqual(run.secondResult.contextTarget, 'dermavital_szappan');
run = sequence('Mire jó az Aktív szenes szappan?', 'És a szappan?');
assert.notEqual(run.secondResult.contextTarget, 'dermavital_szappan');

// M: an unresolved standalone purchase never invents a product.
let result = ask('Ezt kérem.');
assert.equal(result.contextTarget, null);
assert.equal(result.links.length, 0);
assert.match(result.answer, /Melyik termék/i);
run = sequence('Mutass két szappant.', 'Ezt kérem.');
assert.equal(run.secondResult.route, 'clarification');
assert.equal(run.secondResult.contextTarget, 'product');

// N/O/P: complaint, safety and enforced rejection cut authoritative references.
let history = append([], 'Mit ajánlasz ekcémára?', ask('Mit ajánlasz ekcémára?'));
result = ask('Irritálja a bőröm a szappan.', history);
history = append(history, 'Irritálja a bőröm a szappan.', result);
result = ask('Az elsőt kérem.', history);
assert.equal(result.route, 'clarification');

history = append([], 'Mit ajánlasz ekcémára?', ask('Mit ajánlasz ekcémára?'));
result = ask('Nehezen kapok levegőt a szappan után.', history);
history = append(history, 'Nehezen kapok levegőt a szappan után.', result);
result = ask('Az elsőt kérem.', history);
assert.equal(result.route, 'clarification');

history = append([], 'Mit ajánlasz ekcémára?', ask('Mit ajánlasz ekcémára?'));
result = ask('ránc', history);
assert.equal(result.routing.semanticGuard.enforcementApplied, true);
history = append(history, 'ránc', result);
result = ask('Az elsőt kérem.', history);
assert.equal(result.route, 'clarification');

console.log('C2 context precedence and authoritative reference resolution: PASS');
