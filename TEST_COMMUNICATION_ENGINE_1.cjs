'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const ROOT = __dirname;
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'knowledge.json'), 'utf8'));
const knowledge = Array.isArray(raw) ? raw : raw.items;
const ruleEngine = new ExpertRuleEngine(path.join(ROOT, 'data', 'rules', 'expert-rules.json'));
const ask = (question, history = []) => createAnswer({ question, history, knowledge, ruleEngine, logGap() {} });

const dermavitalHistory = [
  { role: 'user', content: 'Mit ajánlasz ekcémára?' },
  { role: 'assistant', content: 'Elsőként a Dermavital krémet ajánlom.', route: 'expert_rule', intent: 'eczema' }
];
const psoriasisHistory = [
  { role: 'user', content: 'Pikkelysömörre mit ajánlasz?' },
  { role: 'assistant', content: 'Elsőként a PsoriVital csomagot, alternatívaként a Holt-tengeri só balzsamot ajánlom.', route: 'expert_rule', intent: 'psoriasis_body' }
];

const cases = [
  { q: 'repedt a sarkam', kind: 'recommendation', safety: true },
  { q: 'a sarkam fel van repedve', kind: 'recommendation', safety: true },
  { q: 'száraz sarokra mit ajánlasz?', kind: 'recommendation' },
  { q: 'nagyon száraz a bőröm', kind: 'advice' },
  { q: 'Mit ajánlasz ekcémára?', kind: 'recommendation', safety: true },
  { q: 'pikkelysömörre mit ajánlasz?', kind: 'recommendation', safety: true },
  { q: 'viszkető fejbőrre mit használjak?', kind: 'recommendation', safety: true },
  { q: 'korpás a fejbőröm', kind: 'recommendation', safety: true },
  { q: 'pattanásos bőrre mit ajánlasz?', kind: 'advice' },
  { q: 'rosaceás az arcom', kind: 'recommendation' },
  { q: 'van tusfürdőtök?', kind: 'category' },
  { q: 'van sampon?', kind: 'category' },
  { q: 'van szappan?', kind: 'category' },
  { q: 'milyen dezodorotok van?', kind: 'category' },
  { q: 'izzadásgátlóról', kind: 'category' },
  { q: 'van kézkrém?', kind: 'category' },
  { q: 'van sarokkrém?', kind: 'category' },
  { q: 'van naptej?', kind: 'absent' },
  { q: 'Van SPF 50-es fényvédőtök?', kind: 'absent' },
  { q: 'visszérre van valamilyen balzsam?', kind: 'safety', safety: true },
  { q: 'ödémára mit használjak?', kind: 'safety', safety: true },
  { q: 'begyulladt és erős fájdalom van a lábamban', kind: 'safety', safety: true },
  { q: 'javítja a keringést?', kind: 'safety', safety: true },
  { q: 'Szeretném megrendelni', kind: 'commerce' },
  { q: 'hol tudom megvenni?', kind: 'commerce' },
  { q: 'hogy szállítotok?', kind: 'commerce' },
  { q: 'mennyi a szállítási díj?', kind: 'commerce' },
  { q: 'mikor érkezik meg?', kind: 'commerce' },
  { q: 'lehet utánvéttel fizetni?', kind: 'commerce' },
  { q: 'mennyibe kerül?', kind: 'clarification' },
  { q: 'van készleten?', kind: 'clarification' },
  { q: 'És gyereknek?', h: dermavitalHistory, kind: 'recommendation', safety: true },
  { q: 'Ezt hogyan használjam?', h: dermavitalHistory, kind: 'recommendation' },
  { q: 'Melyik?', h: psoriasisHistory, kind: 'recommendation' },
  { q: 'Van nagyobb?', h: dermavitalHistory, kind: 'recommendation' },
  { q: 'Dermavital krém', kind: 'recommendation' }
];

const banned = [
  /kozmetikai ápolásra javaslom/i,
  /a rendszer ezt ajánlja/i,
  /az alapján/i,
  /az ön kérdése/i,
  /hidratáló készítmény/i,
  /elegendő információ hiányában/i,
  /nem találtam/i
];

assert.ok(cases.length >= 30, `Legalább 30 kommunikációs eset kell, jelenleg ${cases.length}.`);

for (const test of cases) {
  const result = ask(test.q, test.h || []);
  assert.strictEqual(result.communication?.engine, 'vitalis-communication/v1', `${test.q}: communication engine`);
  assert.ok(result.communication.wordCount <= result.communication.maximumWords, `${test.q}: route-plafonnál hosszabb`);
  assert.ok(result.communication.wordCount >= result.communication.minimumWords, `${test.q}: route-minimumnál rövidebb`);
  if (result.route === 'commerce' || result.route === 'product_category') {
    assert.ok(result.communication.wordCount >= 30 && result.communication.wordCount <= 80, `${test.q}: katalógus/commerce hossz`);
  }
  if (result.goal === 'ask_usage') {
    assert.ok(result.communication.wordCount >= 40 && result.communication.wordCount <= 100, `${test.q}: használati válasz hossza`);
  }
  if (result.goal === 'solve_problem') {
    assert.ok(result.communication.wordCount >= 80 && result.communication.wordCount <= 150, `${test.q}: problémaalapú válasz hossza`);
  }
  assert.ok(/érdemes|segít|szívesen|Vitalis|erre/i.test(result.answer), `${test.q}: hiányzik a Vitalis hang`);
  for (const pattern of banned) assert.ok(!pattern.test(result.answer), `${test.q}: AI-szagú fordulat: ${pattern}`);

  if (test.kind === 'recommendation' || test.kind === 'category') {
    assert.ok((result.links || []).length > 0, `${test.q}: nincs termékkártya`);
    assert.ok(result.links[0].reason, `${test.q}: nincs termékindok`);
    assert.strictEqual(result.links[0].recommendationLabel, 'Vitalis ajánlása', `${test.q}: első kártya címkéje`);
    assert.ok(/azért|Miért|mert/i.test(`${result.answer} ${result.links[0].reason}`), `${test.q}: nincs indoklás`);
    assert.ok(/Használat:/i.test(result.answer) || test.q === 'Melyik?', `${test.q}: nincs használati tanács`);
    if (result.links[1]) assert.strictEqual(result.links[1].recommendationLabel, 'Alternatíva', `${test.q}: alternatíva címkéje`);
    if (result.links[2]) assert.strictEqual(result.links[2].recommendationLabel, 'Kapcsolódó termék', `${test.q}: kapcsolódó címkéje`);
  }

  if (test.kind === 'absent') {
    assert.strictEqual(result.intent, 'catalog_category_absent', `${test.q}: absent intent`);
    assert.ok(/jelenlegi Vitalis kínálatban most nincs/i.test(result.answer), `${test.q}: nem informatív hiányválasz`);
  }

  if (test.safety) {
    const safetyIndex = result.answer.search(/Fontos:|orvosi|bőrgyógy|szakembertől|nem gyógyszer/i);
    assert.ok(safetyIndex >= result.answer.length * 0.55, `${test.q}: a safety blokk nincs a válasz végén`);
  }
}

const first = ask('Mit ajánlasz ekcémára?');
const repeatHistory = [
  { role: 'user', content: 'Mit ajánlasz ekcémára?' },
  { role: 'assistant', content: first.answer, route: first.route, intent: first.intent, domain: first.domain }
];
const repeated = ask('Hogyan használjam a Dermavital krémet?', repeatHistory);
assert.strictEqual(repeated.communication.repeatedRecommendation, true, 'Az ismételt ajánlást fel kell ismerni.');
assert.notStrictEqual(repeated.answer, first.answer, 'Nem ismételheti meg ugyanazt a teljes választ.');
assert.ok(!repeated.answer.includes(first.answer.slice(0, 90)), 'Nem másolhatja vissza az előző válasz első bekezdését.');
assert.ok(/nem ismétlem meg|gyakorlati használatra/i.test(repeated.answer), 'A follow-up fókuszáljon a következő hasznos lépésre.');

console.log(`Communication Engine regresszió: PASS (${cases.length} alaphelyzet + ismétlés)`);
