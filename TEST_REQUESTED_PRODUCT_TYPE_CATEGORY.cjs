'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const Module = require('node:module');

// Compile mutations in child-process memory. Never overwrite production source.
const mutations = {
  M1: ['catalog-search.cjs', '.filter((item) => matchesRequestedSubtype(item, subtype))', '.filter(() => true)'],
  M2: ['catalog-search.cjs', '.filter((item) => matchesSubtypeQualifiers(item, qualifiers))', '.filter(() => true)'],
  M3: ['catalog-search.cjs', 'const eligible = scopedProducts.filter', 'const eligible = scopedProducts.slice(0, limit).filter'],
  M4: ['answer-router.cjs', 'if (!compatibleSubtypeExpert(expert, subtypeRequest, catalog.all()))', 'if (false)'],
  M5: ['answer-service.cjs', 'if (!compatibleSubtypeExpert(expert, routing.subtypeRequest, products)) return subtypeUnavailable(routing);', 'if (!compatibleSubtypeExpert(expert, routing.subtypeRequest, products)) return attachDecision(expert, routing);'],
  M6: ['product-type-constraint.cjs', 'if (hasSubtypeProseConflict(expert.answer, request.type)) return false;', 'if (false) return false;'],
  M7: ["product-type-constraint.cjs","if (qualifiers.includes('kecsketejes') && /\\bnem[\\s-]+kecsketejes\\b/.test(name)) return false;","if (false) return false;"],
  M8: ['answer-service.cjs', 'const composed = finalizeSubtypeOutput({ routing: goalRouting, draft: goalDraft, question, history: effectiveHistory });', 'const composed = composeCommunication({ decision: goalRouting, draft: goalDraft, question, history: effectiveHistory });'],
  M9: ["product-type-constraint.cjs","if (new RegExp(`\\\\bnem[\\\\s-]+${designation}\\\\b`).test(name)) return false;","if (false) return false;"],
  M10: ["product-type-constraint.cjs","if (!new RegExp(`(?:^|\\\\s)${designation}(?=\\\\s|$)`).test(name)) return false;\n  // Bounded descriptor stems, including spacing/punctuation variants. A\n  // commerce separator before a real variant (e.g. hyaluron) stays valid.\n  if (new RegExp(`\\\\b${designation}[\\\\s-]+(?:illatu|allagu|hatasu|jellegu|szeru)\\\\b`).test(name)) return false;","if (!new RegExp(`\\\\b${designation}\\\\b`).test(name)) return false;"],
  M11: ["product-type-constraint.cjs","if (qualifiers.includes('kecsketejes') && /\\bnem[\\s-]+kecsketejes\\b/.test(name)) return false;","if (qualifiers.includes('kecsketejes') && /\\bnem kecsketejes\\b/.test(name)) return false;"],
  M12: ["product-type-constraint.cjs","if (new RegExp(`\\\\bnem[\\\\s-]+${designation}\\\\b`).test(name)) return false;","if (new RegExp(`\\\\bnem(?:\\\\s*-\\\\s*|\\\\s+)${designation}\\\\b`).test(name)) return false;"],
  M13: ["product-type-constraint.cjs","if (new RegExp(`\\\\b${designation}[\\\\s-]+(?:illatu|allagu|hatasu|jellegu|szeru)\\\\b`).test(name)) return false;","if (false) return false;"],
  M14: ["product-type-constraint.cjs","if (qualifiers.includes('kecsketejes') && /\\bnem[\\s-]+kecsketejes\\b/.test(name)) return false;","if (qualifiers.includes('kecsketejes') && /\\bnem(?:\\s*-\\s*|\\s+)kecsketejes\\b/.test(name)) return false;"],
  M15: ["catalog-search.cjs","if (parsed.products.some(item => !item.name.trim() || !usableIdentity(item.unasId || item.sku)","if (false && parsed.products.some(item => !item.name.trim() || !usableIdentity(item.unasId || item.sku)"],
  M16: ['product-type-constraint.cjs', 'if (!item || !compatibleSubtypeIdentity(link, item)) return false;', 'if (!item) return false;'],
  M17: ['answer-service.cjs', 'return attachDecision({ ...acceptedExpert, links, primaryProductId }, finalRouting);', 'return attachDecision({ ...acceptedExpert, links, primaryProductId }, routing);'],
  M18: ['product-type-constraint.cjs', "const id = item.canonicalProductId || `catalog:${unasId ? 'unas' : 'sku'}:${encodeURIComponent(unasId || sku)}`;", 'const id = item.id;'],
  M19: ['answer-service.cjs', 'targetProductId: primaryProductId\n', 'targetProductId: expert.targetProductId || primaryProductId\n'],
  M20: ['product-type-constraint.cjs', "if (product?.commerceIdentity || String(product?.id || '').startsWith('catalog:')) return product?.canonicalProductId || null;", 'if (false) return null;'],
  M21: ['catalog-search.cjs', 'if (counts.get(item.commerceIdentity[field]) > 1)', 'if (false)'],
  M22: ['catalog-search.cjs', "return !text || /^(undefined|null)$/i.test(text) ? '' : text;", 'return text;'],
  M23: ['catalog-search.cjs', 'next += `:${mappingSource}`;', "next += '';"],
  M24: ['widget.js', "recommendationType: ['primary', 'secondary', 'related', 'context'].includes(item.recommendationType) ? item.recommendationType : 'available',", "recommendationType: item.recommendationType || (index === 0 ? 'primary' : 'secondary'),"],
  M25: ['widget.js', 'validItems.slice(0, productCardLimit(context)).entries()', 'validItems.slice(0, 3).entries()'],
  M26: ['answer-service.cjs', 'return attachDecision({ ...acceptedExpert, links, primaryProductId }, finalRouting);', 'return attachDecision({ ...acceptedExpert, ...expert, links, primaryProductId }, finalRouting);'],
  M27: ['widget.js', "const constrainedExpert = context.route === 'expert_rule' && ['body_lotion', 'facial_cream'].includes(context.productTypeConstraint);", 'const constrainedExpert = false;'],
  M28: ['conversation-memory.cjs', "const selectionLimit = value.route === 'subtype_catalog' || constrainedExpert ? 6 : 3;", 'const selectionLimit = 3;'],
  M29: ['product-type-constraint.cjs', "const evidence = name.replace(/\\bkecsketejes[\\s-]+(?:illatu|allagu|hatasu|jellegu|szeru)\\b/g, ' ');", 'const evidence = name;'],
  M30: ['conversation-context.cjs', "const laterOrdinal = /\\b(negyedik(?:et)?|otodik(?:et)?|hatodik(?:at)?)\\b/.exec(value);", 'const laterOrdinal = null;'],
};
mutations.M31 = ["conversation-context.cjs","  if (/\\b(?:het|nyolc|kilenc|tiz|husz|harminc|negyven|otven|hatvan|hetven|nyolcvan|kilencven|szaz|ezer)[a-z]*(?:adik|edik|odik)(?:at|et)?\\b/.test(value)) index = -1;","  // Mutant: unsupported ordinals have no reference."];
mutations.M32 = ["conversation-memory.cjs","    const key=JSON.stringify([item.role,item.content,(item.links||[]).map(link=>link.id),item.targetProductId||null,item.route||null,item.intent||null,item.domain||null,item.productTypeConstraint||null,item.catalogStatus||null]);","    const key=JSON.stringify([item.role,item.content]);"];
mutations.M33 = ["answer-service.cjs","const intent = detectCustomerGoal(question).intent;","const intent = expert.intent;"];
mutations.M34 = ["conversation-context.cjs","if (message.route === 'subtype_catalog' && message.catalogStatus === 'CATALOG_AVAILABLE_NO_MATCH') {","if (false) {"];
mutations.M35 = ["conversation-memory.cjs","    const key=JSON.stringify([item.role,item.content,(item.links||[]).map(link=>link.id),item.targetProductId||null,item.route||null,item.intent||null,item.domain||null,item.productTypeConstraint||null,item.catalogStatus||null]);","    const key=JSON.stringify([item.role,item.content,(item.links||[]).map(link=>link.id),item.targetProductId||null,item.route||null,item.intent||null,item.domain||null,item.responseType||null,item.productTypeConstraint||null,item.catalogStatus||null]);"];
mutations.M36=['conversation-context.cjs','  if (inflectedOrdinal) {','  if (false) {'];
mutations.M37=['conversation-context.cjs','context.primaryRecommendedProduct = message.targetProductId || products[0] || null;','context.primaryRecommendedProduct = products[0] || null;'];
mutations.M38=['server.cjs','history_event: buildConversationHistoryEvent(record.historyResult, record.turnId),','history_event: null,'];
mutations.M39=['conversation-memory.cjs','  return [...prefix,...serverHistory];','  return [...serverHistory,...clientHistory];'];
mutations.M40=['conversation-context.cjs','  if (numericOrdinals.length) index = numericOrdinals.every(match => Number(match[1]) >= 1 && Number(match[1]) <= 6) ? Number(numericOrdinals[0][1]) - 1 : -1;','  if (numericOrdinals.length) index = numericOrdinals.every(match => Number(match[1]) >= 1 && Number(match[1]) <= 6) ? Number(numericOrdinals[0][1]) - 1 : null;'];
mutations.M41=['server.cjs','  return recoverConversationHistoryRows(rows, sessionId, safeLimit);','  return validateConversationHistoryRows(rows);'];
mutations.M42=['answer-service.cjs',"  if (catalogReference) compositionRouting = { ...compositionRouting, answerMode: 'DIRECT' };",'  // Mutant: identity inherits recommendation wording from user intent.'];
mutations.M43=['conversation-memory.cjs',"      return browser?.responseType?normalizeMessage({...row,responseType:browser.responseType}):row;","      return browser?normalizeMessage({...row,...browser,role:row.role,content:row.content}):row;"];
const mutationAssertions = {
  M43:'T10.2 exact legacy prose cannot authorize browser semantics',
  M40:'T10 F10-01 numeric seventh retains invalid status after reload',
  M41:'T10 F10-02 failed write preserves newer server-validated browser turn',
  M42:'T10 F10-03 neutral ordinal cannot authorize an endorsement',
  M36:'T9 F9-01 inflected seventh cannot fall through to focus',
  M37:'T9 F9-02 real acknowledgement reload retains primary six',
  M38:'T9 F9-03 actual server storage preserves selection and no-match',
  M39:'T9 F9-04 stale browser cannot override newer server empty',
  M35: "T8.1 optional metadata matrix preserves selection and target authority",
  M31: "T8 F-01 explicit unsupported ordinal blocks focus fallback",
  M32: "T8 F-02 changed primary survives dedupe and reload",
  M33: "T8 F-03 expert intent cannot isolate history",
  M34: "T8 F-04 empty constrained event clears stale ordinal",
  M1: 'T3 facial scope', M2: 'T1 qualified availability without recommendation',
  M3: 'filter subtype and qualifier BEFORE limit', M4: 'routing rejects incompatible expert even if materializer could guard',
  M5: 'final materialization revalidates empty expert results', M6: 'F1 body request rejects bounded facial prose conflicts',
  M7: 'F2 negated official qualifier fails closed before limit', M8: 'F3 history and fresh listing preserve one product set',
  M9: 'R1-A negated facial designation cannot establish membership',
  M10: 'R1-B hyphen-derived facial designation cannot establish membership',
  M11: 'R2 separator-negated qualifier cannot establish membership',
  M12: 'T4 repeated subtype negation facial', M13: 'T4 descriptor boundary',
  M14: 'T4 repeated qualifier negation', M15: 'T4 empty-URL unusable catalog',
  M16: 'T5 incompatible commerce cannot survive output', M17: 'T5 final selection replaces stale routing',
  M18: 'T5 SKU collision preserves lotion visible identity', M19: 'T7 R-01 target metadata cannot change readback focus',
  M20: 'T6 F-01 raw commerce ID cannot authorize product type',
  M21: 'T6 F-02 ambiguous normalized identity cannot emit selection',
  M22: 'T6 F-03 placeholder identity cannot establish usable inventory',
  M23: 'T6 F-04 mapping changes invalidate warm canonical approval',
  M24: 'T6 F-05 informational widget cannot invent recommendation',
  M25: 'T6 F-06 actual resolved history preserves rendered selection',
  M26: 'T7 R-01 target metadata cannot change readback focus',
  M27: 'T7 R-02 constrained expert selected set reaches widget',
  M28: 'T7 R-03 six displayed products survive server rehydration',
  M29: 'T7 R-04 qualifier descriptor evidence fails closed before limit',
  M30: 'T7 R-03 ordinal fourth and sixth target actual price follow-up'
};
if (process.env.RPT_MUTATION) {
  const mutation = mutations[process.env.RPT_MUTATION];
  assert.ok(mutation, 'known mutation');
  const original = Module._extensions['.js'];
  Module._extensions['.js'] = function load(module, filename) {
    if (filename === path.join(__dirname, 'engine', mutation[0])) {
      const source = fs.readFileSync(filename, 'utf8');
      assert.equal(source.split(mutation[1]).length - 1, 1, 'mutation anchor must be unique');
      process.stdout.write(`MUTATION_APPLIED ${process.env.RPT_MUTATION}\n`);
      return module._compile(source.replace(mutation[1], mutation[2]), filename);
    }
    return original(module, filename);
  };
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-rpt-'));
const snapshot = path.join(scratch, 'catalog.json');
process.env.UNAS_CATALOG_SNAPSHOT_PATH = snapshot;
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'test/fixtures/knowledge-builder-catalog.json'), 'utf8'));
const product = (id, name, extra = {}) => ({ unasId: id, sku: id, name, url: `https://www.vitalis-szappan.hu/${id}`, public: true, active: true, orderable: true, categoryNames: ['Test és arcápoló krémek'], ...extra });
const body = product('body-goat', 'Kecsketejes testápoló krém levendula 250 ml');
const otherBody = product('body-other', 'Mandulás testápoló krém 250 ml');
const face = product('face', 'Hyaluron feszesítő arckrém 75 ml');
const wrong = [product('hand', 'Kézkrém'), product('generic', 'Ápoló krém'), product('soap', 'Kecsketejes szappan'), product('conflict', 'Arckrém és testápoló'), product('category-only', 'Ápoló termék')];
let fixtureVersion = Date.now() / 1000;
function fixture(products) {
  fs.writeFileSync(snapshot, JSON.stringify({ ...baseline, products }));
  // Deterministic snapshot cache invalidation even for same-size rapid writes.
  fs.utimesSync(snapshot, ++fixtureVersion, fixtureVersion);
}
fixture([...baseline.products, body, otherBody, face, ...wrong]);
const dormantCalls = {};
const dormantModules = /product-intelligence-recommendation-(?:intent-contract|authorization-adapter|scope-repository)|problem-domain-decision|conversation-decision-(?:envelope|transition|reducer|semantic)/;
const instrumented = new WeakSet(), originalModuleLoad = Module._load;
Module._load = function(request, parent, isMain) {
  const api = originalModuleLoad.call(this, request, parent, isMain);
  if (dormantModules.test(request) && api && typeof api === 'object' && !instrumented.has(api)) {
    instrumented.add(api);
    for (const [name, fn] of Object.entries(api)) if (typeof fn === 'function') api[name] = function(...args) {
      const key=`${request}.${name}`; dormantCalls[key]=(dormantCalls[key]||0)+1;
      return fn.apply(this,args);
    };
  }
  return api;
};
const compositionTrace = [];
const communication = require('./engine/communication-engine.cjs');
const originalCompose = communication.composeCommunication;
communication.composeCommunication = function(args) {
  compositionTrace.push({ route:args.decision.route, target:args.decision.contextTarget,
    mode:args.decision.answerMode, rule:args.decision.matchedRuleId,
    source:args.draft.source, referenceAuthoritative:args.decision.referenceAuthoritative });
  return originalCompose(args);
};
const { createAnswer } = require('./engine/answer-service.cjs');
const { routeAnswer } = require('./engine/answer-router.cjs');
const types = require('./engine/product-type-constraint.cjs');
const { createCatalogSearch } = require('./engine/catalog-search.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const rawKnowledge = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/knowledge.json'), 'utf8'));
const knowledge = Array.isArray(rawKnowledge) ? rawKnowledge : rawKnowledge.items || rawKnowledge.knowledge;
const rules = new ExpertRuleEngine(path.join(__dirname, 'data/rules/expert-rules.json'));
const ask = (question, ruleEngine = rules, extra = {}) => createAnswer({ question, history: [], knowledge, ruleEngine, logGap() {}, logDiagnostic() {}, ...extra });
let passed = 0, failed = 0;
function selectedTest(name) { return !(process.argv.includes('--t10-reproductions') && !name.startsWith('T10 F10-')) && !(process.argv.includes('--t8-reproductions') && !name.startsWith('T8 ')) && !(process.argv.includes('--t6-reproductions') && !name.startsWith('T6 F-')) && !(process.argv.includes('--t7-reproductions') && !name.startsWith('T7 ')); }
function test(name, fn) { if (!selectedTest(name)) return; try { fn(); passed++; console.log(`PASS ${name}`); } catch (e) { failed++; console.error(`FAIL ${name} [${e.code || e.name}]: ${e.message}`); } }
async function testAsync(name, fn) { if (!selectedTest(name)) return; try { await fn(); passed++; console.log(`PASS ${name}`); } catch (e) { failed++; console.error(`FAIL ${name} [${e.code || e.name}]: ${e.message}`); } }
const t1 = 'Van kecsketejes testápolótok?';
const t2 = 'Száraz bőrre keresek testápolót.';
const t3 = 'Milyen arckrémeitek vannak?';
const ids = answer => answer.links.map(x => x.id);

test('T1 qualified availability without recommendation', () => {
  const r = ask(t1);
  assert.equal(r.routing.productTypeConstraint, 'body_lotion');
  assert.equal(r.routing.productQuestionIntent, 'availability');
  assert.deepEqual(r.routing.subtypeRequest.qualifiers, ['kecsketejes']);
  assert.deepEqual(ids(r), ['catalog:unas:body-goat']);
  assert.match(r.answer, /Kecsketejes testápoló/);
  assert.doesNotMatch(r.answer, /ajánl|megfelel|gyógyít/i);
  assert.ok(r.links.every(x => !x.recommendationLabel && !x.reason && !x.recommendationType));
});
test('T2 concern cannot emit soap at routing or output', () => {
  const r = ask(t2);
  assert.equal(r.routing.productTypeConstraint, 'body_lotion');
  assert.equal(r.route, 'clarification');
  assert.deepEqual(ids(r), []);
  assert.doesNotMatch(JSON.stringify(r), /shea_vajas_szappan|Shea vajas szappan/);
  assert.match(r.answer, /nem tudok.*ajánl/i);
});
test('T3 facial scope', () => { const r = ask(t3); assert.equal(r.routing.productTypeConstraint, 'facial_cream'); assert.deepEqual(ids(r), ['catalog:unas:face']); });
test('lexical accents suffixes and separated forms', () => {
  for (const word of ['testápoló','testapolo','testápolót','testapolot','testápolótok','testapolotok','testápolók','testapolok','testápolóitok','testapoloitok','testápoló krém']) assert.equal(types.extractSubtypeRequest(`Van ${word}?`).type, 'body_lotion', word);
  for (const word of ['arckrém','arckrem','arckrémet','arckremet','arckrémek','arckremek','arckrémeitek','arckremeitek','arc krém','arc krem','arc krémet','arc kremet','arc krémek','arc kremeitek']) assert.equal(types.extractSubtypeRequest(`Van ${word}?`).type, 'facial_cream', word);
  for (const word of ['arckrémes','testápolóillatú']) assert.equal(types.extractSubtypeRequest(`Van ${word}?`).status, 'NONE');
  assert.equal(types.detectProductTypeConstraint('sampon'), null);
  assert.equal(types.detectProductTypeConstraint('szappant'), 'szappan');
  assert.equal(types.detectProductTypeConstraint('krém'), 'krem');
});
test('ambiguous negated unsupported and unrelated modifier handling', () => {
  for (const q of ['Van arckrém vagy testápoló?', 'Van testápoló és szappan?', 'Van nem kecsketejes testápoló?', 'Van illatmentes testápoló?', 'Nem testápolót keresek.', 'Van testápoló szappan?', 'Van testápoló-illatú szappan?']) {
    const r = ask(q); assert.equal(r.route, 'clarification', q); assert.deepEqual(ids(r), [], q);
  }
});
test('official name is required for subtype and qualifier', () => {
  const cat = createCatalogSearch(snapshot);
  fixture([...wrong, product('fake', 'Krém', { description: 'kecsketejes testápoló', categoryNames: ['Kecsketejes testápolók'] })]);
  assert.equal(cat.searchSubtype('body_lotion', ['kecsketejes']).status, 'CATALOG_AVAILABLE_NO_MATCH');
  assert.equal(cat.searchSubtype('facial_cream').status, 'CATALOG_AVAILABLE_NO_MATCH');
  assert.equal(types.matchesRequestedSubtype({ name: 'Testápoló', commerceName: 'Szappan' }, 'body_lotion'), false);
  assert.equal(types.matchesRequestedSubtype({ name: 'Testápoló' }, 'body_lotion'), false);
});
test('filter subtype and qualifier BEFORE limit', () => {
  fixture([...Array.from({length: 9}, (_,i) => product(`wrong-${i}`, 'Kézkrém')), ...Array.from({length: 9}, (_,i) => product(`body-${i}`, 'Mandulás testápoló')), body]);
  const r = createCatalogSearch(snapshot).searchSubtype('body_lotion', ['kecsketejes'], 1);
  assert.deepEqual(r.products.map(x=>x.id), ['body-goat']);
});
test('eligible matching products only', () => {
  fixture([product('hidden','Kecsketejes testápoló',{public:false}),product('disabled','Kecsketejes testápoló',{active:false}),product('unorderable','Kecsketejes testápoló',{orderable:false}),product('badurl','Kecsketejes testápoló',{url:'javascript:bad'}),body]);
  assert.deepEqual(ids(ask(t1)), ['catalog:unas:body-goat']);
});
test('no-match retains qualifier and never broadens', () => {
  fixture([otherBody]); const r = ask(t1); assert.deepEqual(ids(r), []); assert.match(r.answer, /kecsketejes/i); assert.equal(r.routing.catalogStatus, 'CATALOG_AVAILABLE_NO_MATCH');
  fixture([face]); assert.deepEqual(ids(ask(t1)), []);
  fixture([otherBody, ...wrong]); assert.deepEqual(ids(ask(t3)), []);
});
test('catalog absent malformed and empty are distinct including cached reads', () => {
  const cat = createCatalogSearch(snapshot);
  for (const contents of [null, '{broken', '{}', '{"products":{}}']) {
    if (contents === null) fs.rmSync(snapshot, {force:true}); else fs.writeFileSync(snapshot, contents);
    assert.equal(cat.searchSubtype('body_lotion').status, 'CATALOG_UNAVAILABLE');
    const r = ask(t1); assert.equal(r.routing.catalogStatus, 'CATALOG_UNAVAILABLE'); assert.match(r.answer, /nem tudom.*ellenőriz/i); assert.deepEqual(ids(r), []);
  }
  fixture([]); assert.equal(cat.searchSubtype('body_lotion').status, 'CATALOG_AVAILABLE_NO_MATCH');
});
function expert(links, answer, primaryProductId = links[0]?.id) { return { source:'expert-rule', ruleId:'controlled-test-rule', intent:'dry_skin', primaryProductId, answer, confidence:100, links, suggestions:[] }; }
const bodyCard = {id: 'body-goat', name: body.name, url:body.url};
test('routing rejects incompatible expert even if materializer could guard', () => {
  fixture([body]); const r = routeAnswer({question:t2,history:[],knowledge,ruleEngine:rules}); assert.notEqual(r.route, 'expert_rule');
});
test('final materialization revalidates empty expert results', () => {
  fixture([body]); let calls=0;
  const engine={resolve(){return ++calls===1 ? expert([bodyCard], `A ${body.name} terméket javaslom.`) : expert([], 'A Shea vajas szappant ajánlom.', 'shea_vajas_szappan');}};
  const r=ask(t2,engine); assert.equal(calls,2); assert.deepEqual(ids(r),[]); assert.doesNotMatch(r.answer,/Shea|szappan/i); assert.match(r.answer,/nem tudok.*ajánl/i);
  assert.equal(r.route, 'clarification'); assert.equal(r.routing.primaryProductId, null); assert.deepEqual(r.routing.matchedProductIds, []);
});
test('expert card identity cannot contradict official identity', () => {
  fixture([body]);
  const valid = expert([bodyCard], `A ${body.name} terméket javaslom.`);
  assert.deepEqual(ids(ask(t2, {resolve(){return valid;}})), ['catalog:unas:body-goat']);
  for (const field of ['name', 'title', 'label', 'description', 'reason']) {
    const invalid = {...valid, links:[{...bodyCard, [field]:'Shea vajas szappan'}]};
    assert.deepEqual(ids(ask(t2, {resolve(){return invalid;}})), [], field);
  }
});
test('compatible cards cannot launder incompatible prose or hidden links', () => {
  fixture([body, ...wrong]);
  for(const answer of ['A Shea vajas szappant ajánlom.', `A ${body.name} terméket és a kézkrémet ajánlom.`, `A ${body.name} terméket ajánlom: https://www.vitalis-szappan.hu/soap`]) {
    const r=ask(t2,{resolve(){return expert([bodyCard],answer)}}); assert.deepEqual(ids(r),[]); assert.doesNotMatch(r.answer,/Shea|kézkrém|https:/i);
  }
});
test('mixed candidates and missing primary do not promote secondary', () => {
  fixture([body, ...wrong]);
  for(const e of [expert([{id:'soap',name:'Szappan',url:wrong[2].url},bodyCard],'Szappant és testápolót ajánlok.','soap'),expert([bodyCard],`A ${body.name} terméket ajánlom.`,'soap')]) assert.deepEqual(ids(ask(t2,{resolve(){return e}})),[]);
});
test('F1 body request rejects bounded facial prose conflicts', () => {
  fixture([body, face]);
  for (const word of ['arckrém', 'arckrémet', 'arckrémek', 'arckrémeitek', 'arc krém', 'arc krémet', 'arc krémek', 'arc krémeitek']) {
    const r = ask(t2, {resolve(){return expert([bodyCard], `A ${body.name} mellett ${word} is ajánlok.`);}});
    assert.equal(r.route, 'clarification', word);
    assert.deepEqual(ids(r), [], word);
    assert.doesNotMatch(r.answer, /arckrém|arc krém/i);
    assert.equal(r.primaryProductId ?? null, null);
    assert.equal(r.routing.primaryProductId, null);
    assert.deepEqual(r.routing.matchedProductIds, []);
  }
});
test('F1 facial request rejects bounded body prose conflicts', () => {
  fixture([body, face]);
  for (const word of ['testápoló', 'testápolót', 'testápolótok', 'testápolók', 'testápolóitok']) {
    const r = ask('Száraz bőrre keresek arckrémet.', {resolve(){return expert([{id:'face',name:face.name,url:face.url}], `A ${face.name} mellett ${word} is ajánlok.`);}});
    assert.equal(r.route, 'clarification', word);
    assert.deepEqual(ids(r), [], word);
    assert.doesNotMatch(r.answer, /testápoló/i);
    assert.equal(r.primaryProductId ?? null, null);
    assert.equal(r.routing.primaryProductId, null);
    assert.deepEqual(r.routing.matchedProductIds, []);
  }
});
test('F1 compatible prose and unrelated derived words remain accepted', () => {
  fixture([body, face]);
  for (const [p, question, neutral] of [[body,t2,'Az arckrémes szó itt nyelvi példa.'],[face,'Száraz bőrre keresek arckrémet.','A testápolóillatú szó itt nyelvi példa.']]) {
    const id = p.unasId;
    for (const suffix of ['', neutral]) {
      const answer = `A ${p.name} terméket ajánlom. ${suffix}`.trim();
      const r=ask(question,{resolve(){return expert([{id,name:p.name,url:p.url}],answer);}});
      assert.equal(r.route,'expert_rule'); assert.equal(r.answer,answer);
      assert.deepEqual(ids(r),[`catalog:unas:${id}`]); assert.equal(r.links[0].url,p.url);
      assert.equal(r.primaryProductId,`catalog:unas:${id}`); assert.equal(r.routing.primaryProductId,`catalog:unas:${id}`);
      assert.deepEqual(r.routing.matchedProductIds,[`catalog:unas:${id}`]);
    }
  }
});
test('F2 negated official qualifier fails closed before limit', () => {
  const negated=product('negated','Nem kecsketejes testápoló krém');
  fixture([body]); assert.deepEqual(ids(ask(t1)),['catalog:unas:body-goat']);
  for(const p of [negated,otherBody,product('description','Testápoló krém',{description:'kecsketejes'}),product('category','Testápoló krém',{categoryNames:['Kecsketejes termékek']})]) {
    fixture([p]); const r=ask(t1); assert.deepEqual(ids(r),[],p.name);
    assert.equal(r.routing.catalogStatus,'CATALOG_AVAILABLE_NO_MATCH');
    assert.match(r.answer,/Nem találok igazoltan kecsketejes testápoló/);
    assert.deepEqual(r.routing.matchedProductIds,[]);
  }
  fixture([...Array.from({length:8},(_,i)=>({...negated,unasId:`negated-${i}`,sku:`negated-${i}`})),otherBody,body]);
  assert.deepEqual(createCatalogSearch(snapshot).searchSubtype('body_lotion',['kecsketejes'],1).products.map(p=>p.id),['body-goat']);
});
function assertNoSubtypeCandidate(question, candidate) {
  fixture([candidate]);
  const r = ask(question);
  assert.equal(r.routing.catalogStatus, 'CATALOG_AVAILABLE_NO_MATCH', candidate.name);
  assert.deepEqual(r.links, []);
  assert.deepEqual(r.routing.matchedProductIds, []);
  assert.equal(r.routing.primaryProductId, null);
  assert.equal(r.primaryProductId ?? null, null);
  assert.ok(!r.answer.includes(candidate.name));
  assert.match(r.answer, /Nem találok igazoltan/);
}
test('R1-A negated facial designation cannot establish membership', () => {
  assertNoSubtypeCandidate(t3, product('r1-a', 'Nem arckrém'));
});
test('R1-B hyphen-derived facial designation cannot establish membership', () => {
  assertNoSubtypeCandidate(t3, product('r1-b', 'Arckrém-illatú krém'));
});
test('R1-C negated body designation cannot establish membership', () => {
  assertNoSubtypeCandidate('Mutass testápolót.', product('r1-c', 'Nem testápoló krém'));
});
test('R1 nearby candidate boundaries fail closed', () => {
  for (const name of ['Nem - arc krém', 'Arckrém-állagú krém', 'Arc krém-illatú krém', 'Arckrémes krém'])
    assertNoSubtypeCandidate(t3, product('r1-face-boundary', name));
  for (const name of ['Nem - testápoló krém', 'Testápoló-illatú krém', 'Testápolóillatú krém'])
    assertNoSubtypeCandidate('Mutass testápolót.', product('r1-body-boundary', name));
});
test('R1 valid standalone designations preserve harmless punctuation', () => {
  for (const [question, names] of [[t1, [body.name, 'Vitalis: Kecsketejes testápoló, levendula 250 ml', 'Kecsketejes testápoló - levendula 250 ml']],
    [t3, [face.name, 'Vitalis (arc krém), 75 ml', 'Arckrém - hyaluron 75 ml']]]) {
    for (const name of names) {
      const p = product('positive', name); fixture([p]); const r = ask(question);
      assert.equal(r.routing.catalogStatus, 'CATALOG_AVAILABLE_WITH_MATCHES', name);
      assert.deepEqual(ids(r), ['catalog:unas:positive']); assert.deepEqual(r.routing.matchedProductIds, ['catalog:unas:positive']);
      assert.equal(r.links[0].url, p.url); assert.ok(r.answer.includes(name));
      assert.ok(r.links.every(x => !x.recommendationType && !x.recommendationLabel && !x.reason));
    }
  }
});
test('R2 separator-negated qualifier cannot establish membership', () => {
  assertNoSubtypeCandidate(t1, product('r2', 'Nem - kecsketejes testápoló krém'));
});
test('R2 separators and later valid qualifier remain bounded before limit', () => {
  const names = ['Nem kecsketejes testápoló krém', 'Nem - kecsketejes testápoló krém', 'Nem- kecsketejes testápoló krém', 'Nem – kecsketejes testápoló krém'];
  for (const name of names) assertNoSubtypeCandidate(t1, product('r2-control', name));
  fixture([...Array.from({length: 9}, (_, i) => product(`r2-${i}`, names[i % names.length])), otherBody, body]);
  assert.deepEqual(createCatalogSearch(snapshot).searchSubtype('body_lotion', ['kecsketejes'], 1).products.map(p => p.id), ['body-goat']);
  assert.deepEqual(ids(ask(t1)), ['catalog:unas:body-goat']);
});

test('T4 repeated subtype negation facial', () => {
  assertNoSubtypeCandidate(t3, product('t4-face', 'Nem -- arckrem'));
});
test('T4 repeated subtype negation body', () => {
  assertNoSubtypeCandidate('Mutass testápolót.', product('t4-body', 'Nem -- testápoló krém'));
});
test('T4 descriptor boundary', () => {
  assertNoSubtypeCandidate(t3, product('t4-descriptor', 'Arckrém -illatú krém'));
});
test('T4 repeated qualifier negation', () => {
  assertNoSubtypeCandidate(t1, product('t4-qualifier', 'Nem -- kecsketejes testápoló krém'));
});
function assertUnusableCatalog(products) {
  fixture(products);
  assert.equal(createCatalogSearch(snapshot).searchSubtype('body_lotion').status, 'CATALOG_UNAVAILABLE');
  const r = ask(t1);
  assert.equal(r.routing.catalogStatus, 'CATALOG_UNAVAILABLE');
  assert.match(r.answer, /nem tudom.*ellenőriz/i);
  assert.doesNotMatch(r.answer, /Nem találok igazoltan/);
  assert.deepEqual(r.links, []);
  assert.deepEqual(r.routing.matchedProductIds, []);
  assert.equal(r.routing.primaryProductId, null);
}
test('T4 empty-name unusable catalog', () => assertUnusableCatalog([{name:''}]));
test('T4 name-only unusable catalog', () => assertUnusableCatalog([{name:'Testapolo'}]));
test('T4 empty-URL unusable catalog', () => assertUnusableCatalog([{...body,url:''}]));
test('T4 separator alphabet and descriptor variants at output boundary', () => {
  for (const separator of [' ', '  ', '\t', '-', ' - ', '-- ', ' -- ', ' - - ', '---', ': ', ', ', '/', ' (', ' – ']) {
    assertNoSubtypeCandidate(t3, product('neg-face', `Nem${separator}arckrém`));
    assertNoSubtypeCandidate('Mutass testápolót.', product('neg-body', `Nem${separator}testápoló krém`));
    assertNoSubtypeCandidate(t1, product('neg-goat', `Nem${separator}kecsketejes testápoló krém`));
    for (const descriptor of ['illatú', 'állagú', 'hatású', 'jellegű', 'szerű']) {
      assertNoSubtypeCandidate(t3, product('derived-face', `Arckrém${separator}${descriptor} krém`));
      assertNoSubtypeCandidate('Mutass testápolót.', product('derived-body', `Testápoló${separator}${descriptor} krém`));
    }
  }
  fixture([...Array.from({length:9},(_,i)=>product(`neg-${i}`, 'Nem -- kecsketejes testápoló krém')),otherBody,body]);
  assert.deepEqual(createCatalogSearch(snapshot).searchSubtype('body_lotion',['kecsketejes'],1).products.map(p=>p.id),['body-goat']);
  assert.deepEqual(ids(ask(t1)),['catalog:unas:body-goat']);
});
test('T4 mixed catalog structural failure versus eligibility', () => {
  for (const invalid of [null, {}, {name:''}, {name:'Testapolo'}, product('', 'Testápoló'),
    product('id','Testápoló',{url:''}), product('id','Testápoló',{unasId:{},sku:''}),
    product('id','   '), product('id','Testápoló',{url:null})]) {
    assertUnusableCatalog([invalid]);
    assertUnusableCatalog([body,invalid]);
  }
  fixture([product('unsafe','Testápoló',{url:'javascript:bad'}),body]);
  assert.deepEqual(ids(ask(t1)),['catalog:unas:body-goat']);
  fixture([{sku:'minimal',name:'Kecsketejes testápoló',url:body.url}]);
  assert.deepEqual(ids(ask(t1)),['catalog:sku:minimal']);
  fixture([]); assert.equal(ask(t1).routing.catalogStatus,'CATALOG_AVAILABLE_NO_MATCH');
  fixture([face]); assert.equal(ask(t1).routing.catalogStatus,'CATALOG_AVAILABLE_NO_MATCH');
});
test('T4 final revalidation cannot restore inflected conflict', () => {
  fixture([body,face]);
  for(const [p,q,conflict] of [[body,t2,'arckrémet'],[face,'Száraz bőrre keresek arckrémet.','testápolót']]) {
    let calls=0;
    const r=ask(q,{resolve(){return expert([{id:p.unasId,name:p.name,url:p.url}],`${p.name}${++calls===1?'':` mellett ${conflict} ajánlok.`}`)}});
    assert.equal(calls,2); assert.equal(r.route,'clarification'); assert.deepEqual(r.links,[]);
    assert.deepEqual(r.routing.matchedProductIds,[]); assert.equal(r.routing.primaryProductId,null);
    assert.ok(!r.answer.includes(conflict));
  }
});

test('F3 history and fresh listing preserve one product set', () => {
  const inventory=Array.from({length:8},(_,i)=>product(`lotion-${i}`,`Kecsketejes testápoló krém ${i+1} ml`));
  const products=inventory.slice(0,6);
  fixture(inventory);
  const complaintQuestion='Csípi a bőrömet a szappan.';
  const complaint=ask(complaintQuestion); assert.equal(complaint.route,'complaint');
  const history=[{role:'user',content:complaintQuestion},{role:'assistant',content:complaint.answer,route:complaint.route,intent:complaint.intent,routing:complaint.routing}];
  const fresh=ask('Mutass testápolót.');
  const continued=ask('Már elmúlt, mutass testápolót.',rules,{history});
  assert.equal(continued.resolvedTransitionApplied,true);
  for(const r of [fresh,continued]) {
    assert.equal(r.route,'subtype_catalog'); assert.equal(r.routing.productTypeConstraint,'body_lotion');
    const proseIds=products.filter(p=>r.answer.includes(p.name)).map(p=>`catalog:unas:${p.unasId}`);
    assert.deepEqual(proseIds,products.map(p=>`catalog:unas:${p.unasId}`));
    assert.ok(inventory.slice(6).every(p=>!r.answer.includes(p.name)));
    assert.deepEqual(ids(r),proseIds);
    assert.deepEqual(r.routing.matchedProductIds,proseIds);
    assert.equal(r.routing.primaryProductId,null);
    assert.deepEqual(r.links.map(p=>p.url),products.map(p=>p.url));
    assert.ok(r.links.every(p=>!p.recommendationType&&!p.recommendationLabel&&!p.reason));
  }
  assert.deepEqual(fresh.links,continued.links);
});
test('preserve T4 T5 T6 T7 T8 A4 and generic cream', () => {
  fixture([...baseline.products,body]);
  const soap=ask('Érzékeny bőrre keresek szappant.'); assert.match(soap.answer,/Natúr kecsketejes szappan/); assert.ok(soap.links.length);
  const shampoo=ask('Milyen samponjaitok vannak?'); assert.match(shampoo.answer,/Dermavital Sampon/); assert.ok(shampoo.links.length);
  const d3=ask('Mit tudsz a Kecsketejes testápoló krémről?'); assert.equal(d3.route,'product_category'); assert.equal(d3.routing.productTypeConstraint,'krem'); assert.ok(ids(d3).includes('body-goat'));
  const psoriasis=ask('Pikkelysömörrel kapcsolatban kérdeznék.'); assert.match(psoriasis.answer,/PsoriVital/); assert.match(psoriasis.answer,/orvosi/);
  const scalp=ask('Viszket és hámlik a fejbőröm. Milyen terméketek van erre?'); assert.match(scalp.answer,/Dermavital sampont/); assert.match(scalp.answer,/bőrgyógyász/);
  assert.match(ask('Mit tudsz a Dermavital samponról?').answer,/Dermavital sampon/);
  const cream=ask('Milyen krémeitek vannak?'); assert.equal(cream.routing.productTypeConstraint,'krem'); assert.equal(cream.route,'product_category');
});
test('no page observation dependence or dormant module activation', () => {
  fixture([body]); const stable = value => JSON.parse(JSON.stringify(value, (key, item) => key === 'timingMs' ? undefined : item));
  for (const question of [t1, t2, t3]) {
    const plain = ask(question);
    assert.deepEqual(stable(plain),stable(ask(question,rules,{pageObservation:{pageUrl:'https://example.com'},pageContext:{productId:'soap'}})));
    assert.equal(plain.recommendationIntent, undefined);
    assert.equal(plain.routing.problemDomainDecision, undefined);
  }
  assert.ok(!Object.keys(require.cache).some(p=>/conversation-decision-(envelope|transition|reducer|semantic)|recommendation-authorization-adapter|recommendation-scope-repository/.test(p)));
});
test('T5 commerce identity rejected by router', () => {
  fixture([body, ...baseline.products]);
  const soap = baseline.products.find(p => p.sku === 'TEST-ORANGE-SOAP');
  const dirty = expert([{...bodyCard, commerce:{source:'unas',mappingStatus:'approved',unasId:soap.unasId,sku:soap.sku}}], body.name);
  const r = routeAnswer({question:t2,history:[],knowledge,ruleEngine:{resolve(){return dirty;}}});
  assert.equal(r.route, 'clarification');
});
test('T5 incompatible commerce cannot survive output', () => {
  fixture([body,...baseline.products]);
  const dirty=expert([{...bodyCard,commerce:{source:'unas',mappingStatus:'approved',unasId:'test-orange-soap',sku:'TEST-ORANGE-SOAP'}}],body.name);
  const r=ask(t2,{resolve(){return dirty;}});
  assert.ok(r.links.every(link=>link.commerce?.unasId!=='test-orange-soap'&&link.commerce?.sku!=='TEST-ORANGE-SOAP'),'incompatible commerce identity survived');
  assert.equal(r.route,'clarification');assert.deepEqual(r.links,[]);
});
test('T5 explicit runtime identities fail closed', () => {
  fixture([body, ...baseline.products]);
  for (const patch of [{canonicalProductId:'shea_vajas_szappan'}, {unasProductId:'test-orange-soap'}, {sku:'TEST-ORANGE-SOAP'},
    {commerce:{unasId:'test-orange-soap'}}, {commerce:{sku:'TEST-ORANGE-SOAP'}}]) {
    const r = ask(t2,{resolve(){return expert([{...bodyCard,...patch}],body.name);}});
    assert.equal(r.route,'clarification',JSON.stringify(patch));
    assert.deepEqual(r.links,[]);
    assert.deepEqual(r.routing.matchedProductIds,[]);
  }
});
test('T5 final materializer rejects commerce identity', () => {
  fixture([body, ...baseline.products]); let calls=0;
  const r = ask(t2,{resolve(){return expert([{...bodyCard,...(++calls===1?{}:{commerce:{unasId:'test-orange-soap',sku:'TEST-ORANGE-SOAP'}})}],body.name);}});
  assert.equal(calls,2);
  assert.equal(r.route,'clarification');
  assert.deepEqual(r.links,[]);
  assert.deepEqual(r.routing.matchedProductIds,[]);
  assert.equal(r.routing.primaryProductId,null);
});
test('T5 final selection replaces stale routing', () => {
  fixture([body,otherBody]); let calls=0;
  const r=ask(t2,{resolve(){const p=++calls===1?body:otherBody;return {...expert([{id:p.unasId,name:p.name,url:p.url}],p.name),ruleId:calls===1?'first-rule':'second-rule'};}});
  assert.equal(calls,2);
  assert.equal(r.route,'expert_rule');
  assert.equal(r.answer,otherBody.name);
  assert.equal(r.links[0].url,otherBody.url);
  assert.equal(r.primaryProductId,r.links[0].id);
  assert.equal(r.routing.primaryProductId,r.primaryProductId);
  assert.deepEqual(r.routing.matchedProductIds,ids(r));
  assert.equal(r.ruleId,'second-rule');
  assert.equal(r.routing.matchedRuleId,r.ruleId);
});
test('T5 SKU collision preserves lotion visible identity', () => {
  fixture([{sku:'katrany_szappan',name:body.name,url:body.url}]);
  const r=ask(t1);
  assert.equal(r.routing.catalogStatus,'CATALOG_AVAILABLE_WITH_MATCHES');
  for(const field of ['name','title','label']) assert.equal(r.links[0][field],body.name);
  assert.ok(r.answer.includes(body.name));
});
test('T5 SKU collision preserves facial visible identity', () => {
  fixture([{sku:'katrany_szappan',name:face.name,url:face.url}]);
  const r=ask(t3);
  assert.equal(r.routing.catalogStatus,'CATALOG_AVAILABLE_WITH_MATCHES');
  for(const field of ['name','title','label']) assert.equal(r.links[0][field],face.name);
  assert.ok(r.answer.includes(face.name));
});
test('T5 identity matrix validates each namespace at both boundaries', () => {
  const mappings = JSON.parse(fs.readFileSync(path.join(__dirname,'data/canonical-unas-mapping.json'),'utf8')).mappings;
  const approved = mappings.find(m=>m.canonicalId==='dermavital_krem');
  const a = product(approved.unasId,body.name,{sku:approved.sku});
  fixture([a,face]);
  const clean = {id:approved.canonicalId,name:a.name,url:a.url,canonicalProductId:approved.canonicalId,
    unasProductId:a.unasId,sku:a.sku,commerce:{source:'unas',mappingStatus:'approved',unasId:a.unasId,sku:a.sku}};
  for(let mask=0;mask<32;mask++) {
    const card={...clean,commerce:{...clean.commerce}};
    if(mask&1)card.canonicalProductId='shea_vajas_szappan';
    if(mask&2)card.unasProductId='test-orange-soap';
    if(mask&4)card.sku='TEST-ORANGE-SOAP';
    if(mask&8)card.commerce.unasId='test-orange-soap';
    if(mask&16)card.commerce.sku='TEST-ORANGE-SOAP';
    const dirty=expert([card],a.name);
    const routed=routeAnswer({question:t2,history:[],knowledge,ruleEngine:{resolve(){return dirty;}}});
    assert.equal(routed.route,mask?'clarification':'expert_rule',`router mask ${mask}`);
    let calls=0;
    const r=ask(t2,{resolve(){return ++calls===1?expert([clean],a.name):dirty;}});
    assert.equal(calls,2);
    assert.equal(r.route,mask?'clarification':'expert_rule',`materializer mask ${mask}`);
    if(mask) {
      assert.deepEqual(r.links,[]);assert.deepEqual(r.routing.matchedProductIds,[]);assert.equal(r.routing.primaryProductId,null);
    } else {
      assert.equal(r.links[0].canonicalProductId,approved.canonicalId);
      assert.equal(r.links[0].unasProductId,a.unasId);assert.equal(r.links[0].sku,a.sku);
      assert.deepEqual(r.links[0].commerce,clean.commerce);
      assert.equal(r.primaryProductId,approved.canonicalId);
      assert.equal(r.routing.primaryProductId,approved.canonicalId);
      assert.deepEqual(r.routing.matchedProductIds,[approved.canonicalId]);
    }
  }
});
test('T5 unmapped consistent identity survives without canonical authority', () => {
  fixture([body]);
  for(const id of [body.unasId,'catalog:unas:body-goat']) {
    const card={...bodyCard,id,unasProductId:body.unasId,sku:body.sku,canonicalProductId:null,
      commerce:{source:'unas',unasId:body.unasId,sku:body.sku}};
    const r=ask(t2,{resolve(){return expert([card],body.name);}});
    assert.equal(r.route,'expert_rule');assert.equal(r.links[0].id,'catalog:unas:body-goat');
    assert.equal(r.links[0].canonicalProductId,null);assert.equal(r.links[0].commerce.mappingStatus,undefined);
    assert.equal(r.links[0].unasProductId,body.unasId);assert.equal(r.links[0].sku,body.sku);
  }
  for(const patch of [{canonicalProductId:body.unasId},{commerce:{source:'unas',mappingStatus:'approved',unasId:body.unasId,sku:body.sku}},
    {sku:42},{unasProductId:{}},{commerce:[]},{commerce:'unas'},{commerce:{source:'other'}},{productType:'szappan'}]) {
    assert.equal(ask(t2,{resolve(){return expert([{...bodyCard,...patch}],body.name);}}).route,'clarification',JSON.stringify(patch));
  }
});
test('T5 mapping proof requires approved unique matching UNAS and SKU', () => {
  const mappings=JSON.parse(fs.readFileSync(path.join(__dirname,'data/canonical-unas-mapping.json'),'utf8')).mappings;
  const m=mappings.find(x=>x.canonicalId==='dermavital_krem');
  const a=product(m.unasId,body.name,{sku:m.sku});
  for(const products of [[{...a,sku:'mismatch'}],[{...a,unasId:'unmapped'}],[a,{...a}]]) {
    fixture(products);
    const r=ask(t2,{resolve(){return expert([{id:m.canonicalId,name:a.name,url:a.url,canonicalProductId:m.canonicalId}],a.name);}});
    assert.equal(r.route,'clarification');assert.deepEqual(r.links,[]);
  }
  const tar=mappings.find(x=>x.canonicalId==='katrany_szappan');
  const contradictory=product(tar.unasId,body.name,{sku:tar.sku});fixture([contradictory]);
  const r=ask(t2,{resolve(){return expert([{id:tar.canonicalId,name:body.name,url:contradictory.url}],body.name);}});
  assert.equal(r.route,'clarification','canonical display must also obey subtype');
});
test('T5 second resolution synchronizes selection but preserves diagnostics', () => {
  fixture([body,otherBody]);
  for(const second of [body,otherBody]) {
    let calls=0;
    const r=ask(t2,{resolve(){const first=++calls===1,p=first?body:second;return {...expert([{id:p.unasId,name:p.name,url:p.url}],p.name),ruleId:first?'rule-A':'rule-B',intent:first?'intent-A':'intent-B'};}});
    assert.equal(calls,2);assert.equal(r.answer,second.name);assert.equal(r.links[0].url,second.url);
    assert.equal(r.primaryProductId,r.links[0].id);assert.equal(r.routing.primaryProductId,r.primaryProductId);
    assert.deepEqual(r.routing.matchedProductIds,ids(r));assert.equal(r.ruleId,'rule-B');assert.equal(r.routing.matchedRuleId,'rule-B');
    const trustedIntent=require('./engine/customer-goal.cjs').detectCustomerGoal(t2).intent;
    assert.equal(r.intent,trustedIntent);assert.equal(r.routing.intent,trustedIntent);
    assert.equal(r.routing.threshold,1);assert.equal(r.routing.confidence,1);
    assert.equal(r.routing.semanticGuard.originalRoute.intent,trustedIntent);
  }
});
test('T5 catalog collision matrix preserves names and commerce namespaces', () => {
  const {PRODUCTS}=require('./engine/product-catalog.cjs');
  const vm=require('node:vm');
  const widget=fs.readFileSync(path.join(__dirname,'public/widget.js'),'utf8');
  const consumer={URL,window:{location:{href:'https://www.vitalis-szappan.hu/'}}};
  vm.createContext(consumer);
  vm.runInContext(widget.slice(widget.indexOf('function safeText(value, fallback'),widget.indexOf('function sendCommerceEvent')),consumer);
  const dynamic='t5_runtime_canonical_control';
  PRODUCTS[dynamic]={id:dynamic,name:'Unrelated product',displayName:'Unrelated canonical display'};
  try {
    for(const key of ['katrany_szappan','dermavital_sampon',dynamic])for(const [q,p] of [[t1,body],[t3,face]])for(const field of ['sku','unasId']) {
      const record={name:p.name,url:p.url,[field]:key,...(field==='unasId'?{sku:'independent-sku'}:{})};fixture([record]);
      const r=ask(q),card=r.links[0];
      assert.equal(r.routing.catalogStatus,'CATALOG_AVAILABLE_WITH_MATCHES');
      for(const name of ['name','title','label'])assert.equal(card[name],p.name,`${key}/${field}/${q}`);
      assert.equal(card.id,`catalog:${field==='sku'?'sku':'unas'}:${key}`);
      assert.equal(PRODUCTS[card.id],undefined);assert.equal(card.canonicalProductId,null);
      assert.equal(card.sku,record.sku||null);assert.equal(card.unasProductId,record.unasId||null);
      assert.equal(card.commerce.mappingStatus,undefined);
      assert.deepEqual(r.routing.matchedProductIds,[card.id]);assert.equal(r.routing.primaryProductId,null);
      assert.ok(r.answer.includes(p.name));assert.equal(card.url,p.url);
      assert.ok(!card.recommendationType&&!card.recommendationLabel&&!card.reason);
      const consumed=consumer.normalizeProduct(card,0);
      assert.equal(consumed.name,p.name);assert.notEqual(consumed.canonicalProductId,key);
      assert.equal(consumed.sku,record.sku||'');assert.equal(consumed.unasProductId,record.unasId||'');
    }
  } finally {delete PRODUCTS[dynamic];}
});
test('T5 unusable catalog identity cannot authorize an expert', () => {
  for(const [record,id] of [[{name:body.name,url:body.url},'catalog:sku:'],
    [{...body,unasId:{},sku:'unused'},'[object Object]'],[{...body,unasId:'   '},'   ']]) {
    fixture([record]);
    const r=ask(t2,{resolve(){return expert([{id,name:body.name,url:body.url}],body.name);}});
    assert.equal(r.route,'clarification');assert.deepEqual(r.links,[]);
  }
});
test('T5 actual B5 rule remains blocked', () => {
  fixture([...baseline.products,body]);
  const raw=rules.resolve(t2,[]);assert.equal(raw.primaryProductId,'shea_vajas_szappan');
  const r=ask(t2);assert.equal(r.route,'clarification');assert.deepEqual(r.links,[]);
  assert.deepEqual(r.routing.matchedProductIds,[]);assert.equal(r.routing.primaryProductId,null);
  assert.doesNotMatch(JSON.stringify(r),/shea_vajas_szappan|Shea vajas szappan/);
});
// Execute the production renderer, including its normalizer, without a browser.
function widgetHarness() {
  const vm = require('node:vm');
  let source = fs.readFileSync(path.join(__dirname, 'public/widget.js'), 'utf8');
  const mutation = mutations[process.env.RPT_MUTATION];
  if (mutation?.[0] === 'widget.js') {
    assert.equal(source.split(mutation[1]).length - 1, 1, 'widget mutation anchor must be unique');
    source = source.replace(mutation[1], mutation[2]);
    console.log(`MUTATION_APPLIED ${process.env.RPT_MUTATION}`);
  }
  const element = tag => ({ tag, children: [], append(...items) { this.children.push(...items); }, addEventListener() {}, setAttribute() {} });
  const saves = [];
  const consumer = { URL, performance: { now: () => 0 }, localStorage: { setItem(key, value) { saves.push(JSON.parse(value)); } }, window: { location: { href: 'https://www.vitalis-szappan.hu/' } }, document: { createElement: element } };
  vm.createContext(consumer);
  vm.runInContext(source.slice(source.indexOf('function safeText(value, fallback'), source.indexOf('function sendCommerceEvent')), consumer);
  vm.runInContext(source.slice(source.indexOf('function addProductCards('), source.indexOf('\nfunction add(text')), consumer);
  vm.runInContext("const STATE_VERSION=2, STATE_TTL_MS=86400000, MAX_STORED_MESSAGES=40, STORAGE_KEY='test', parentOrigin=''; const history=[]; let storedMessages=[], sessionId='test-session-123456789', sessionLocked=false, restorationDeadline=null, stateReady=false, finishRestoration=null; const messagesEl={appendChild(){},querySelectorAll(){return []}}; function addTextWithLinks(){} function scrollToBottom(){}", consumer);
  vm.runInContext(source.slice(source.indexOf('function normalizeState('), source.indexOf('function readFallbackState(')), consumer);
  vm.runInContext(source.slice(source.indexOf('function currentState('), source.indexOf('function scrollToBottom(')), consumer);
  vm.runInContext(source.slice(source.indexOf('function add(text'), source.indexOf('function setSuggestions(')), consumer);
  return { consumer, saves, stored() { return JSON.parse(vm.runInContext('JSON.stringify({history,storedMessages})',consumer)); }, render(result) {
    const article = element('article');
    consumer.addProductCards(article, result.links, result);
    return { heading: article.children[0]?.children[0]?.textContent, cards: article.children[0]?.children[1]?.children || [] };
  } };
}
function mappingFixture(run) {
  const mappingPath = path.join(__dirname, 'data/canonical-unas-mapping.json');
  const read = fs.readFileSync;
  const original = JSON.parse(read(mappingPath, 'utf8'));
  let current = original;
  fs.readFileSync = function(file, ...args) {
    return path.resolve(String(file)) === mappingPath ? JSON.stringify(current) : read.call(this, file, ...args);
  };
  try { run(original, value => { current = value; }); } finally { fs.readFileSync = read; }
}
test('T6 F-01 raw commerce ID cannot authorize product type', () => {
  for (const [q,p] of [[t2,body],['Száraz bőrre keresek arckrémet.',face]]) for (const field of ['sku','unasId']) {
    const id = 'solid_shampoo_oily_rosemary_caffeine';
    fixture([{[field]:id,name:p.name,url:p.url}]);
    const clean = {id,name:p.name,url:p.url};
    const dirty = {...clean,productType:'solid_shampoo'};
    const routed = routeAnswer({question:q,history:[],knowledge,ruleEngine:{resolve(){return expert([dirty],p.name);}}});
    assert.equal(routed.route,'clarification','raw commerce ID authorized contradictory product type');
    let calls=0;
    const result=ask(q,{resolve(){return expert([++calls===1?clean:dirty],p.name);}});
    assert.equal(calls,2);assert.equal(result.route,'clarification');assert.deepEqual(result.links,[]);
    const accepted=ask(q,{resolve(){return expert([clean],p.name);}});
    assert.equal(accepted.route,'expert_rule');assert.ok(!accepted.links[0].productType);
  }
});
test('T6 F-02 ambiguous normalized identity cannot emit selection', () => {
  for (const records of [[{...body,unasId:'duplicate',sku:'A'},{...otherBody,unasId:'duplicate',sku:'B'}],
    [{name:body.name,url:body.url,sku:' SKU-X '},{name:otherBody.name,url:otherBody.url,sku:'SKU-X'}]]) {
    fixture(records);const result=ask('Mutass testápolót.');
    assert.equal(result.routing.catalogStatus,'CATALOG_UNAVAILABLE','ambiguous commerce selection was emitted');
    assert.deepEqual(result.links,[]);assert.deepEqual(result.routing.matchedProductIds,[]);
    const p=records[0];const id=p.unasId||p.sku;
    assert.equal(ask(t2,{resolve(){return expert([{id,name:p.name,url:p.url}],p.name);}}).route,'clarification');
  }
});
test('T6 F-03 placeholder identity cannot establish usable inventory', () => {
  for(const id of ['null','undefined',' NULL ',' UnDeFiNeD ']) for(const field of ['unasId','sku']) for(const name of [body.name,'Gazdag krém']) {
    fixture([{[field]:id,name,url:body.url}]);const result=ask(t1);
    assert.equal(result.routing.catalogStatus,'CATALOG_UNAVAILABLE','placeholder established usable inventory');
    assert.deepEqual(result.links,[]);assert.doesNotMatch(result.answer,/Nem találok igazoltan/);
  }
});
test('T6 F-04 mapping changes invalidate warm canonical approval', () => mappingFixture((original,setMapping) => {
  const m=original.mappings.find(x=>x.canonicalId==='dermavital_krem');
  fixture([product(m.unasId,body.name,{sku:m.sku})]);
  const card={id:m.canonicalId,name:body.name,url:`https://www.vitalis-szappan.hu/${m.unasId}`};
  const engine={resolve(){return expert([card],body.name);}};
  const removed={...original,mappings:original.mappings.filter(x=>x!==m)};
  const ambiguous={...original,mappings:[...original.mappings,{...m,unasId:'another',sku:'another'}]};
  for(const invalid of [removed,ambiguous]) {
    setMapping(original);assert.equal(ask(t2,engine).route,'expert_rule');
    setMapping(invalid);
    const result=ask(t2,engine);
    assert.equal(result.route,'clarification','stale canonical approval survived mapping change');
    assert.deepEqual(result.links,[]);
    setMapping(original);assert.equal(ask(t2,engine).links[0].canonicalProductId,m.canonicalId);
  }
}));
test('T6 F-05 informational widget cannot invent recommendation', () => {
  fixture([body]);const result=ask(t1);const rendered=widgetHarness().render(result);
  assert.equal(rendered.cards.length,1);
  assert.doesNotMatch(rendered.cards[0].innerHTML,/Vitalis ajánlása|Alternatíva/,'availability rendered as recommendation');
  assert.doesNotMatch(rendered.cards[0].className,/is-primary|is-secondary|is-related/);
  assert.match(rendered.cards[0].innerHTML,/Elérhető termék/);
});
test('T6 F-06 actual resolved history preserves rendered selection', () => {
  const inventory=Array.from({length:9},(_,i)=>product(`t6-lotion-${i}`,`Kecsketejes testápoló krém ${i+201} ml`));
  fixture(inventory);
  const q='Csípi a bőrömet a szappan.',complaint=ask(q);assert.equal(complaint.route,'complaint');
  const history=[{role:'user',content:q},{role:'assistant',content:complaint.answer,route:complaint.route,intent:complaint.intent,routing:complaint.routing}];
  const fresh=ask('Mutass testápolót.'),continued=ask('Már elmúlt, mutass testápolót.',rules,{history});
  assert.equal(continued.resolvedTransitionApplied,true);
  const widget=widgetHarness();
  for(const result of [fresh,continued]) {
    const rendered=widget.render(result);
    assert.equal(result.links.length,6);
    assert.equal(rendered.cards.length,result.links.length,'rendered selection differs from service selection');
    assert.deepEqual(rendered.cards.map(card=>card.href),result.links.map(card=>card.url));
    assert.deepEqual(result.routing.matchedProductIds,ids(result));
    assert.ok(inventory.slice(0,6).every(p=>result.answer.includes(p.name)));
    assert.ok(inventory.slice(6).every(p=>!result.answer.includes(p.name)));
  }
  assert.deepEqual(fresh.links,continued.links);
});
test('T6 widget preserves neutral listings and authorized recommendations after storage', () => {
  fixture([...baseline.products,body]);
  const recommended=ask('Érzékeny bőrre keresek szappant.');
  assert.equal(recommended.answerMode,'RECOMMENDATION');
  assert.equal(recommended.links[0].recommendationType,'primary');
  const harness=widgetHarness();
  const view=harness.render(recommended);
  assert.match(view.cards[0].innerHTML,/Vitalis ajánlása/);assert.match(view.cards[0].className,/is-primary/);
  assert.match(view.heading,/Ajánlott/);
  const inventory=Array.from({length:8},(_,i)=>product(`persist-${i}`,`Kecsketejes testápoló ${301+i} ml`));
  fixture(inventory);const listing=ask(t1);
  harness.consumer.add(listing.answer,'bot',{...listing,persist:false});
  const stored=harness.stored();
  for(const items of [stored.history,stored.storedMessages]) assert.equal(items[0].links.length,6);
  const restored=harness.consumer.normalizeState({version:2,updatedAt:Date.now(),sessionId:'test-session-123456789',messages:stored.storedMessages});
  const rendered=harness.render(restored.messages[0]);
  assert.equal(rendered.cards.length,6);assert.deepEqual(rendered.cards.map(p=>p.href),listing.links.map(p=>p.url));
  assert.ok(rendered.cards.every(p=>!(/Vitalis ajánlása|Alternatíva/.test(p.innerHTML))));
  assert.match(rendered.heading,/Elérhető/);
  const neutral=harness.render({links:[{...listing.links[0],recommendationLabel:'Vitalis ajánlása',reason:'recommend me'}]});
  assert.match(neutral.heading,/Elérhető/);assert.doesNotMatch(neutral.cards[0].innerHTML,/Vitalis ajánlása|recommend me/);
  assert.equal(harness.consumer.normalizeProduct(listing.links[0],0).canonicalProductId,'');
  const mixed=harness.render({links:[listing.links[0],{...listing.links[1],recommendationType:'context'}]});
  assert.doesNotMatch(mixed.heading,/Ajánlott/);
  harness.consumer.add(recommended.answer,'bot',{...recommended,persist:false});
  const restoredRecommendation=harness.consumer.normalizeState({version:2,updatedAt:Date.now(),sessionId:'test-session-123456789',messages:harness.stored().storedMessages}).messages[1];
  assert.match(harness.render(restoredRecommendation).cards[0].innerHTML,/Vitalis ajánlása/);
});
test('T6 normalized identity round trips preserve case and encoding', () => {
  const harness=widgetHarness();
  for(const field of ['sku','unasId']) for(const value of [' padded ','a/b','a:b','a%b','a%2Fb','ÁrVíz','MiXeD',731]) {
    fixture([{[field]:value,name:body.name,url:body.url}]);const result=ask(t1),card=result.links[0];
    const normalized=String(value).trim();
    assert.equal(card.id,`catalog:${field==='sku'?'sku':'unas'}:${encodeURIComponent(normalized)}`);
    const consumed=harness.consumer.normalizeProduct(card,0);
    assert.equal(consumed[field==='sku'?'sku':'unasProductId'],normalized);assert.equal(consumed.canonicalProductId,'');
    assert.equal(decodeURIComponent(card.id.split(':').slice(2).join(':')),normalized);
    const selected=ask(t2,{resolve(){return expert([{id:card.id,name:body.name,url:body.url}],body.name);}});
    assert.equal(selected.route,'expert_rule');assert.equal(selected.links[0].id,card.id);
  }
  fixture([{sku:'Case-X',name:body.name,url:body.url},{sku:'case-x',name:otherBody.name,url:otherBody.url}]);
  assert.equal(ask('Mutass testápolót.').links.length,2,'identity case must not be folded');
});
test('T6 duplicate policy covers secondary namespaces and normalized numbers', () => {
  for(const records of [[{...body,unasId:' 123 '},{...otherBody,unasId:123}],
    [{...body,sku:' shared '},{...otherBody,sku:'shared'}],
    [{sku:'S',name:body.name,url:body.url},{...otherBody,sku:' S '}],
    [body,{...body,public:false}]]) {
    assertUnusableCatalog(records);
    const first=records[0];
    assert.equal(ask(t2,{resolve(){return expert([{id:String(first.unasId||first.sku).trim(),name:first.name,url:first.url}],first.name);}}).route,'clarification');
  }
});
test('T6 identity types and optional placeholder clearing match consumers', () => {
  const harness=widgetHarness();
  for(const field of ['unasId','sku']) for(const value of [undefined,null,'',' ',0,-1,false,true,{},[],'NuLl',' undefined ']) {
    assertUnusableCatalog([{[field]:value,name:body.name,url:body.url}]);
  }
  for(const value of [undefined,null,'',' ',0,-1,false,true,{},[],'NuLl',' undefined ']) {
    fixture([{...body,sku:value}]);const result=ask(t1);
    assert.equal(result.links.length,1);assert.equal(result.links[0].sku,null);
    assert.equal(harness.consumer.normalizeProduct(result.links[0],0).sku,'');
  }
  fixture([{...body,unasId:0,sku:'fallback'}]);assert.equal(ask(t1).links[0].id,'catalog:sku:fallback');
  fixture([{...body,unasId:{},sku:'fallback'}]);assert.equal(ask(t1).routing.catalogStatus,'CATALOG_UNAVAILABLE');
});
test('T6 cache rejects missing malformed mapping and second-resolution revocation', () => mappingFixture((original,setMapping) => {
  const m=original.mappings.find(x=>x.canonicalId==='dermavital_krem');
  const p=product(m.unasId,body.name,{sku:m.sku});fixture([p]);
  const card={id:m.canonicalId,name:p.name,url:p.url};
  for(const mapping of [{},null,{...original,mappings:original.mappings.map(x=>x===m?{...x,mappingStatus:'needs_review'}:x)}]) {
    setMapping(original);assert.equal(ask(t2,{resolve(){return expert([card],p.name);}}).route,'expert_rule');
    setMapping(mapping);assert.equal(ask(t2,{resolve(){return expert([card],p.name);}}).route,'clarification');
  }
  setMapping(original);let calls=0;
  const result=ask(t2,{resolve(){if(++calls===2)setMapping({mappings:[]});return expert([card],p.name);}});
  assert.equal(calls,2);assert.equal(result.route,'clarification');assert.deepEqual(result.links,[]);
}));
test('T6 fresh semantic-key collisions and bounded lexical separators', () => {
  for(const key of ['shampoo_soap_probe','solid_shampoo_probe','szappan','krem','balzsam','tusfurdo']) for(const field of ['unasId','sku']) {
    fixture([{[field]:key,name:body.name,url:body.url}]);
    const result=ask(t1);assert.equal(result.links[0].name,body.name);assert.equal(result.links[0].canonicalProductId,null);
    const catalogProduct=createCatalogSearch(snapshot).all()[0];
    assert.equal(catalogProduct.productType,null);
    for(const type of ['shampoo_soap','solid_shampoo','szappan','balzsam','tusfurdo']) assert.equal(types.matchesProductType(catalogProduct,type),false);
  }
  for(const separator of ['\t-- /:, - ',' -:\t- / (','/ --,\t: - ']) {
    assertNoSubtypeCandidate(t1,product('fresh-neg',`Nem${separator}kecsketejes testápoló`));
    for(const [q,name] of [[t3,'Arckrém'],['Mutass testápolót.','Testápoló']]) {
      assertNoSubtypeCandidate(q,product('fresh-neg',`Nem${separator}${name}`));
      for(const descriptor of ['illatú','állagú','hatású','jellegű','szerű']) assertNoSubtypeCandidate(q,product('fresh-desc',`${name}${separator}${descriptor}`));
    }
  }
});
test('T6 namespaced history cannot reintroduce raw identity type authority', () => {
  for(const [key,type] of [['solid_shampoo_oily_rosemary_caffeine','solid_shampoo'],['shampoo_soap_probe','shampoo_soap']]) for(const field of ['sku','unasId']) {
    fixture([{[field]:key,name:body.name,url:body.url}]);const first=ask(t1);
    const history=[{role:'user',content:t1},{role:'assistant',content:first.answer,links:first.links,route:first.route,intent:first.intent}];
    const result=ask('Melyiket ajánlod?',rules,{history});
    assert.notEqual(result.routing.productTypeConstraint,type,'namespaced history created semantic type');
    assert.notEqual(result.route,'hair_product_type');
  }
});
test('T6 dormant runtime instrumentation remains empty', () => {
  assert.deepEqual(dormantCalls,{});
  assert.ok(!Object.keys(require.cache).some(p=>/conversation-decision-(envelope|transition|reducer|semantic)|recommendation-authorization-adapter|recommendation-scope-repository/.test(p)));
});
async function readback(result, rows = []) {
  const harness = widgetHarness();
  harness.consumer.add(result.answer, 'bot', result);
  const live = harness.stored();
  const saved = harness.saves.at(-1);
  assert.ok(saved, 'actual widget persistence executed');
  assert.equal(harness.consumer.restoreState(saved), true);
  const browser = harness.stored();
  const memoryApi = require('./engine/conversation-memory.cjs');
  const restore = history => rows.length
    ? memoryApi.rehydrateSessionHistory({sessionId:'t7-review-session-123456',clientHistory:history,loadRows:async()=>rows})
    : Promise.resolve({history:memoryApi.mergeHistory([],history),state:memoryApi.structuredState(memoryApi.mergeHistory([],history)),technicalFailure:false});
  const memory = await restore(live.history);
  const restoredMemory = await restore(browser.history);
  assert.equal(memory.technicalFailure, false);
  return { harness, browser, memory, restoredMemory };
}

(async () => {
async function readbackTurns(results, rows = []) {
  const harness=widgetHarness();
  for(const result of results) harness.consumer.add(result.answer,'bot',result);
  assert.equal(harness.consumer.restoreState(harness.saves.at(-1)),true);
  const memory=require('./engine/conversation-memory.cjs'),history=harness.stored().history;
  return rows.length?memory.rehydrateSessionHistory({sessionId:'t8-session-123456789',clientHistory:history,loadRows:async()=>rows})
    : {history:memory.mergeHistory([],history),state:memory.structuredState(memory.mergeHistory([],history)),technicalFailure:false};
}
function t8Selection(primary=0, intent='dry_skin') {
  const inventory=Array.from({length:6},(_,i)=>product(`t8-${i}`,`Kecsketejes testápoló ${1601+i} ml`,{actualPriceGross:6100+i}));
  fixture(inventory);
  const candidate={...expert(inventory.map(p=>({id:p.unasId,name:p.name,url:p.url})),inventory.map(p=>p.name).join(', '),inventory[primary].unasId),intent};
  return {inventory,result:ask(t2,{resolve:()=>candidate})};
}
await testAsync('T8 F-01 explicit unsupported ordinal blocks focus fallback',async()=>{
  const {result}=t8Selection(5),memory=await readbackTurns([result]);
  assert.equal(ask('Mennyibe kerül?',rules,{history:memory.history,conversationState:memory.state}).targetProductId,result.links[5].id);
  for(const q of ['Mennyibe kerül a hetedik?','A hetediket.','A hetedik terméket.']) {
    const next=ask(q,rules,{history:memory.history,conversationState:memory.state});
    assert.equal(next.route,'clarification','unsupported ordinal fell through to focus');assert.deepEqual(next.links,[]);
  }
});
await testAsync('T8 F-02 changed primary survives dedupe and reload',async()=>{
  const first=t8Selection(0).result,second=t8Selection(5).result;
  assert.equal(first.answer,second.answer);assert.deepEqual(first.links,second.links);
  const memory=await readbackTurns([first,second]);
  assert.equal(memory.history.length,2,'distinct primary authority events were collapsed');
  assert.equal(memory.state.focusedProductId,second.links[5].id,'content dedupe kept obsolete primary');
  assert.equal(ask('Mennyibe kerül?',rules,{history:memory.history,conversationState:memory.state}).targetProductId,second.links[5].id);
});
await testAsync('T8 F-03 expert intent cannot isolate history',async()=>{
  const {result}=t8Selection(5,'medical_escalation');
  const memory=await readbackTurns([result]);
  assert.deepEqual(memory.state.lastOrdinalProductList,ids(result),'expert intent discarded valid selection');
  assert.equal(ask('A hatodikat.',rules,{history:memory.history,conversationState:memory.state}).targetProductId,result.links[5].id);
});
await testAsync('T8 F-04 empty constrained event clears stale ordinal',async()=>{
  const {result}=t8Selection(),empty=ask(t3);
  assert.deepEqual(empty.links,[]);assert.equal(empty.routing.catalogStatus,'CATALOG_AVAILABLE_NO_MATCH');
  const memory=await readbackTurns([result,empty]);
  const next=ask('A negyediket.',rules,{history:memory.history,conversationState:memory.state});
  assert.equal(next.route,'clarification','empty facial result restored obsolete lotion selection');assert.deepEqual(next.links,[]);
});
await testAsync('T8 F-01 ordinal matrix uses only displayed positions zero through six',async()=>{
  const {inventory,result}=t8Selection(5);
  const words=['első','második','harmadik','negyedik','ötödik','hatodik'];
  for(let count=0;count<=6;count++) {
    fixture(inventory.slice(0,count));
    const selection=count?ask(t1):ask(t3);
    const memory=await readbackTurns([result,selection]);
    fixture([...inventory,product('seventh','Kecsketejes testápoló 999 ml',{actualPriceGross:9999})]);
    for(const [q,index] of [...words.map((word,i)=>[`Mennyibe kerül a ${word}?`,i]),['A hetediket.',6],['A hetedik terméket.',6],['Mennyibe kerül a hetedik?',6],['Mennyibe kerül a nyolcadik?',7],['A tizenkettediket.',11],['Mennyibe kerül a 7. termék?',6],['Mennyibe kerül a 4. termék?',3]]) {
      const next=ask(q,rules,{history:memory.history,conversationState:memory.state});
      if(index<count) assert.equal(next.targetProductId,selection.links[index].id,`${q}/${count}`);
      else {assert.equal(next.route,'clarification',`${q}/${count}`);assert.deepEqual(next.links,[]);}
    }
  }
});
await testAsync('T8 F-02 authority identity collapses only interchangeable history',async()=>{
  const first=t8Selection(0).result,second=t8Selection(5).result;
  const {mergeHistory}=require('./engine/conversation-memory.cjs');
  const row=r=>({role:'assistant',content:r.answer,...r});
  assert.equal(mergeHistory([],[row(first),row(first)]).length,1);
  assert.equal(mergeHistory([],[row(first),row(second)]).length,2);
  assert.equal(mergeHistory([],[{...row(first),timestamp:1},{...row(first),timestamp:2}]).length,1);
  for(const field of ['route','intent','domain','productTypeConstraint']) {
    assert.equal(mergeHistory([],[row(first),{...row(first),[field]:'different'}]).length,2,field);
  }
  assert.equal(mergeHistory([],[row(first),{...row(first),role:'user'}]).length,2);
  const reordered={...second,links:[...second.links].reverse()};
  for(const turns of [[first,second],[first,second,first],[first,reordered]]) {
    const memory=await readbackTurns(turns),latest=turns.at(-1);
    assert.equal(memory.state.focusedProductId,latest.targetProductId);
    assert.deepEqual(memory.state.lastOrdinalProductList,ids(latest));
    for(const [q,target] of [['Mennyibe kerül?',latest.targetProductId],['A hatodikat.',latest.links[5].id],['Mennyibe kerül a hatodik?',latest.links[5].id]])assert.equal(ask(q,rules,{history:memory.history,conversationState:memory.state}).targetProductId,target);
    assert.equal(ask('Mennyibe kerül a hetedik?',rules,{history:memory.history,conversationState:memory.state}).route,'clarification');
  }
});
await testAsync('T8.1 optional response metadata preserves two-row memory dedupe',async()=>{
  const {rehydrateSessionHistory}=require('./engine/conversation-memory.cjs');
  const content='Elsőként a Dermavital sampont ajánlom.';
  // Exact legacy regression, plus both missing/richer directions and arbitrary
  // differing labels. None changes structured selection or focus authority.
  for(const [serverType,clientType] of [['expert-problem',undefined],[undefined,'expert-problem'],['expert-problem','browser-answer'],['browser-answer','expert-problem'],['same','same'],[undefined,undefined]]) {
    const memory=await rehydrateSessionHistory({sessionId:'t8-1-memory-123456789',
      clientHistory:[{role:'assistant',content,...(clientType?{responseType:clientType}:{})}],
      loadRows:async()=>[{created_at:'2026-01-01T00:00:00Z',question:'Mit ajánlasz problémás fejbőrre?',answer:content,source:serverType}]});
    assert.equal(memory.history.length,2,'optional responseType split equivalent history into three rows');
    assert.equal(memory.history[1].responseType,clientType||serverType,'available response metadata was discarded');
    assert.equal(memory.state.focusedProductId,'dermavital_sampon');
    assert.equal(ask('Hogyan használjam?',rules,{history:memory.history,conversationState:memory.state}).contextTarget,'dermavital_sampon');
  }
});
await testAsync('T8.1 optional metadata matrix preserves selection and target authority',async()=>{
  const first=t8Selection(0).result,changedPrimary=t8Selection(5).result;
  const {mergeHistory,rehydrateSessionHistory}=require('./engine/conversation-memory.cjs');
  const row=result=>({role:'assistant',content:result.answer,...result});
  for(const [left,right] of [['same','same'],['server-label','browser-label'],['browser-label','server-label'],[undefined,'present'],['present',undefined]]) {
    const a={...first,responseType:left},b={...first,responseType:right};
    const memory=await readbackTurns([a,b]);
    assert.equal(memory.history.length,1,'optional metadata divided equivalent rendered selection');
    assert.equal(memory.state.focusedProductId,first.targetProductId);
    for(const [server,client] of [[a,b],[b,a]]) {
      const merged=mergeHistory([row(server)],[row(client)]);
      assert.equal(merged.length,1,'equivalence changed with server/client direction');
      assert.equal(merged[0].responseType,client.responseType||server.responseType);
      const recovered={history:merged,state:require('./engine/conversation-memory.cjs').structuredState(merged)};
      assert.equal(ask('Mennyibe kerül?',rules,{history:recovered.history,conversationState:recovered.state}).targetProductId,first.targetProductId);
    }
  }
  const changedSelection={...first,links:first.links.slice(0,5)};
  const changedOrder={...first,links:[...first.links].reverse()};
  const changedTarget={...first,targetProductId:first.links[4].id};
  for(const next of [changedPrimary,changedSelection,changedOrder,changedTarget]) {
    const memory=await readbackTurns([{...first,responseType:'old'},{...next,responseType:'new'}]);
    assert.equal(memory.history.length,2,'materially changed authority collapsed');
    assert.equal(memory.state.focusedProductId,next.targetProductId);
    assert.deepEqual(memory.state.lastOrdinalProductList,ids(next));
    assert.equal(ask('Mennyibe kerül?',rules,{history:memory.history,conversationState:memory.state}).targetProductId,next.targetProductId);
    assert.equal(ask('A negyediket.',rules,{history:memory.history,conversationState:memory.state}).targetProductId,next.links[3].id);
  }
});
await testAsync('T8.1 optional metadata merges preserve all four authority fixes',async()=>{
  const first=t8Selection(0,'medical_escalation').result,latest=t8Selection(5,'medical_escalation').result;
  const trustedStore=t9Store();await trustedStore.write(first,0,t2);await trustedStore.write(latest,1,t2);const rows=await trustedStore.read();
  const memory=await readbackTurns([{...first,responseType:'old'},latest,{...latest,responseType:'new'}],rows);
  assert.notEqual(latest.intent,'medical_escalation');
  assert.equal(memory.state.focusedProductId,latest.links[5].id);
  assert.equal(memory.history.filter(r=>r.targetProductId&&!r.historyEventUncorrelated&&!r.historyEventInvalid).length,2);
  assert.equal(ask('Mennyibe kerül?',rules,{history:memory.history,conversationState:memory.state}).targetProductId,latest.links[5].id);
  assert.equal(ask('A hatodikat.',rules,{history:memory.history,conversationState:memory.state}).targetProductId,latest.links[5].id);
  assert.equal(ask('Mennyibe kerül a hetedik?',rules,{history:memory.history,conversationState:memory.state}).route,'clarification');
  const empty=ask(t3);await trustedStore.write(empty,2,t3);const emptyRows=await trustedStore.read();
  const afterEmpty=await readbackTurns([first,latest,{...empty,responseType:'old-empty'},{...empty,responseType:'new-empty'}],emptyRows);
  assert.deepEqual(afterEmpty.state.lastOrdinalProductList,[]);
  assert.ok(afterEmpty.history.some(r=>r.catalogStatus==='CATALOG_AVAILABLE_NO_MATCH'));
  for(const q of ['A negyediket.','Mennyibe kerül a hetedik?']) {
    const result=ask(q,rules,{history:afterEmpty.history,conversationState:afterEmpty.state});
    assert.equal(result.route,'clarification');assert.deepEqual(result.links,[]);
  }
  const {mergeHistory}=require('./engine/conversation-memory.cjs');
  const event={role:'assistant',content:empty.answer,route:'subtype_catalog',productTypeConstraint:'facial_cream'};
  assert.equal(mergeHistory([],[event,{...event,catalogStatus:'CATALOG_AVAILABLE_NO_MATCH'}]).length,2,'empty selection authority marker collapsed with mere prose');
});
await testAsync('T8 F-03 expert intent contract and trusted medical source',async()=>{
  const trusted=require('./engine/customer-goal.cjs').detectCustomerGoal(t2).intent;
  for(const intent of ['medical_escalation','arbitrary_valid_string','','   ','dry_skin','product_usage','shipping_time']) {
    const first=t8Selection(0,intent).result,second=t8Selection(5,intent).result;
    assert.equal(second.route,'expert_rule');assert.equal(second.intent,trusted);assert.equal(second.routing.intent,trusted);
    const memory=await readbackTurns([first,second]);
    assert.deepEqual(memory.state.lastOrdinalProductList,ids(second));
    assert.equal(memory.state.focusedProductId,second.links[5].id);
    assert.equal(ask('A hatodikat.',rules,{history:memory.history,conversationState:memory.state}).targetProductId,second.links[5].id);
  }
  for(const intent of [undefined,null,1,false,{},[]]) {
    const {inventory}=t8Selection();
    const candidate=expert(inventory.map(p=>({id:p.unasId,name:p.name,url:p.url})),inventory.map(p=>p.name).join(', '));
    if(intent===undefined)delete candidate.intent;else candidate.intent=intent;
    const result=ask(t2,{resolve:()=>candidate});assert.equal(result.route,'clarification');assert.deepEqual(result.links,[]);
  }
  const first=t8Selection().result,safety=ask('Nehezen kapok levegőt.');
  assert.equal(safety.route,'safety');assert.equal(safety.intent,'medical_escalation');
  const memory=await readbackTurns([first,safety]);assert.deepEqual(memory.state.lastOrdinalProductList,[]);
  // Historical non-constrained expert semantics remain unchanged.
  const historical=require('./engine/conversation-memory.cjs').structuredState([{role:'assistant',content:'Korábbi termék.',route:'expert_rule',intent:'dry_skin',links:[{id:'dermavital_krem'}]}]);
  assert.deepEqual(historical.lastOrdinalProductList,['dermavital_krem']);
});
await testAsync('T8 F-04 empty selection matrix preserves focus and ordinary prose',async()=>{
  for(const [firstQuestion,emptyQuestion,kind] of [[t1,t3,'body'],[t3,'Mutass testápolót.','face'],[t1,t1,'body']]) {
    const inventory=Array.from({length:6},(_,i)=>product(`t8-empty-${kind}-${i}`,kind==='body'?`Kecsketejes testápoló ${1801+i} ml`:`Hyaluron arckrém ${1801+i} ml`,{actualPriceGross:7000+i}));
    fixture(inventory);const first=ask(firstQuestion);assert.equal(first.links.length,6);
    fixture([]);const empty=ask(emptyQuestion);assert.equal(empty.routing.catalogStatus,'CATALOG_AVAILABLE_NO_MATCH');
    fixture(inventory);
    for(const tail of [[],[{answer:'Szívesen segítek.',route:'meta',links:[]}]]) {
      const memory=await readbackTurns([first,empty,...tail]);assert.deepEqual(memory.state.lastOrdinalProductList,[]);
      assert.ok(memory.state.focusedProductId,'empty ordinal event must not erase unrelated focus');
      for(const q of ['A negyediket.','Mennyibe kerül a negyedik?','A hetediket.','Mennyibe kerül a hetedik?']) {
        const next=ask(q,rules,{history:memory.history,conversationState:memory.state});assert.equal(next.route,'clarification');assert.deepEqual(next.links,[]);
      }
      const direct=ask('A negyediket.',rules,{history:memory.history});assert.equal(direct.route,'clarification');
    }
    const ordinary=await readbackTurns([first,{answer:'Szívesen segítek.',route:'meta',links:[]}]);
    assert.equal(ask('A negyediket.',rules,{history:ordinary.history,conversationState:ordinary.state}).targetProductId,first.links[3].id);
    const {rehydrateSessionHistory}=require('./engine/conversation-memory.cjs');
    const recovered=await rehydrateSessionHistory({sessionId:'t8-server-empty-123456',loadRows:async()=>[
      {created_at:'2026-09-20T10:00:00Z',question:firstQuestion,answer:first.answer,routing_trace:first.routing},
      {created_at:'2026-09-20T10:01:00Z',question:emptyQuestion,answer:empty.answer,routing_trace:empty.routing}
    ]});assert.deepEqual(recovered.state.lastOrdinalProductList,[]);
  }
});
await testAsync('T7 R-01 target metadata cannot change readback focus', async () => {
  for (const [record,question] of [[body,t2],[face,'Száraz bőrre keresek arckrémet.']]) {
    fixture([record]);
    const clean = expert([{id:record.unasId,name:record.name,url:record.url}],record.name);
    for (const dirtySecond of [true,false]) {
      let calls=0;
      const result=ask(question,{resolve(){const contaminated=(++calls===2)===dirtySecond;return {...clean,...(contaminated?{targetProductId:'shea_vajas_szappan'}:{})};}});
      assert.equal(calls,2);
      const {memory,restoredMemory}=await readback(result);
      const next=ask('Mennyibe kerül?',rules,{history:memory.history,conversationState:memory.state});
      assert.notEqual(memory.state.focusedProductId,'shea_vajas_szappan','incompatible expert target became rehydrated focus');
      assert.ok(!JSON.stringify(next).includes('shea_vajas_szappan'),'price follow-up selected incompatible soap');
      assert.equal(result.targetProductId,result.primaryProductId);
      assert.equal(restoredMemory.state.focusedProductId,result.primaryProductId);
    }
  }
});
await testAsync('T7 R-01 bounded output discards extra semantic metadata', async () => {
  fixture([body]);
  const extra={productId:'shea_vajas_szappan',canonicalProductId:'shea_vajas_szappan',productType:'szappan',unasProductId:'wrong',sku:'wrong',commerce:{unasId:'wrong'},routing:{matchedProductIds:['wrong']},cards:[{id:'wrong'}]};
  const card={...bodyCard,productId:'wrong',targetProductId:'wrong',commerce:{source:'unas',unasId:body.unasId,sku:body.sku,canonicalProductId:'wrong',productType:'szappan'}};
  const result=ask(t2,{resolve(){return {...expert([card],body.name),...extra};}});
  assert.equal(result.route,'expert_rule');
  for(const key of ['productId','canonicalProductId','productType','unasProductId','sku','commerce','cards'])assert.equal(result[key],undefined,key);
  assert.equal(result.links[0].commerce.canonicalProductId,undefined);
  assert.equal(result.links[0].commerce.productType,undefined);
  assert.equal(result.links[0].productId,undefined);
  const {memory}=await readback(result);
  assert.equal(memory.state.focusedProductId,result.primaryProductId);
});
await testAsync('T7 R-02 constrained expert selected set reaches widget', async () => {
  for(const count of [5,0,1,2,3,4,6,7,9]) {
    const inventory=Array.from({length:count},(_,i)=>product(`t7-expert-${i}`,`Kecsketejes testápoló ${901+i} ml`));fixture(inventory);
    const selected=expert(inventory.map(p=>({id:p.unasId,name:p.name,url:p.url})),inventory.map(p=>p.name).join(', '));
    const result=ask(t2,{resolve:()=>selected});
    if(count===0||count>6){assert.equal(result.route,'clarification');assert.deepEqual(result.links,[]);assert.deepEqual(result.routing.matchedProductIds,[]);continue;}
    assert.equal(result.route,'expert_rule');assert.equal(result.links.length,count);
    const rendered=widgetHarness().render(result);
    assert.equal(rendered.cards.length,result.links.length,'expert selected set was truncated by widget');
    assert.deepEqual(rendered.cards.map(p=>p.href),inventory.map(p=>p.url));
    assert.deepEqual(result.routing.matchedProductIds,ids(result));
    assert.ok(inventory.every(p=>result.answer.includes(p.name)));
    const {browser,memory,harness,restoredMemory}=await readback(result);
    assert.equal(browser.history[0].links.length,count);assert.equal(memory.history[0].links.length,count);
    assert.deepEqual(restoredMemory.state.lastOrdinalProductList,ids(result));
    assert.equal(harness.render(browser.storedMessages[0]).cards.length,count);
  }
});
test('T7 R-02 real expert rule preserves four to six canonical selections', () => mappingFixture((original,setMapping)=>{
  const {PRODUCTS}=require('./engine/product-catalog.cjs');
  const inventory=Array.from({length:6},(_,i)=>product(`t7-real-${i}`,`Kecsketejes testápoló ${1101+i} ml`));
  const keys=inventory.map((p,i)=>`t7_canonical_${i}`);
  try {
    inventory.forEach((p,i)=>{PRODUCTS[keys[i]]={id:keys[i],name:p.name,displayName:p.name,url:p.url,description:''};});
    setMapping({mappings:inventory.map((p,i)=>({canonicalId:keys[i],unasId:p.unasId,sku:p.sku,mappingStatus:'approved'}))});
    fixture(inventory);
    const engine=new ExpertRuleEngine(path.join(__dirname,'data/rules/expert-rules.json'));
    for(const count of [4,5,6]){
      engine.rules=[{id:'t7-real-rule',intent:'dry_skin',matchAll:['testápolót'],primaryProduct:keys[0],secondaryProducts:keys.slice(1,count),answer:inventory.slice(0,count).map(p=>p.name).join(', '),suggestions:[]}];
      assert.equal(engine.resolve(t2,[]).links.length,count);
      const result=ask(t2,engine);assert.equal(result.route,'expert_rule');assert.deepEqual(ids(result),keys.slice(0,count));
      assert.equal(widgetHarness().render(result).cards.length,count);
    }
  } finally {for(const key of keys)delete PRODUCTS[key];}
}));
await testAsync('T7 R-03 six displayed products survive server rehydration', async () => {
  const inventory=Array.from({length:9},(_,i)=>product(`t7-history-${i}`,`Kecsketejes testápoló ${501+i} ml`,{actualPriceGross:2100+i}));fixture(inventory);
  const complaintQuestion='Csípi a bőrömet a szappan.',complaint=ask(complaintQuestion);
  assert.equal(complaint.route,'complaint');
  const history=[{role:'user',content:complaintQuestion},{role:'assistant',content:complaint.answer,route:complaint.route,intent:complaint.intent,routing:complaint.routing}];
  const fresh=ask('Mutass testápolót.'),resolved=ask('Már elmúlt, mutass testápolót.',rules,{history});
  assert.equal(resolved.resolvedTransitionApplied,true);assert.deepEqual(fresh.links,resolved.links);
  for(const result of [fresh,resolved]) {
    const {browser,memory,harness,restoredMemory}=await readback(result);
    assert.equal(browser.history[0].links.length,6);
    assert.equal(memory.history[0].links.length,6,'six displayed products were truncated by server');
    assert.deepEqual(memory.state.lastOrdinalProductList,ids(result));
    assert.deepEqual(restoredMemory.state.lastOrdinalProductList,ids(result));
    assert.deepEqual(harness.render(result).cards.map(x=>x.href),result.links.map(x=>x.url));
    assert.ok(inventory.slice(0,6).every(p=>result.answer.includes(p.name)));
    assert.ok(inventory.slice(6).every(p=>!result.answer.includes(p.name)));
    for(const [q,index]of [['Mennyibe kerül a negyedik?',3],['Mennyibe kerül a hatodik?',5]]){
      const next=ask(q,rules,{history:restoredMemory.history,conversationState:restoredMemory.state});
      assert.equal(next.targetProductId,result.links[index].id);
      assert.equal(next.links[0].url,result.links[index].url);
    }
  }
});
await testAsync('T7 R-03 ordinal fourth and sixth target actual price follow-up', async () => {
  const inventory=Array.from({length:9},(_,i)=>product(`t7-ordinal-${i}`,`Kecsketejes testápoló ${601+i} ml`,{actualPriceGross:3100+i}));fixture(inventory);
  const result=ask(t1),{memory}=await readback(result);
  const {resolveProductReference}=require('./engine/conversation-context.cjs');
  assert.equal(memory.history[0].links.length,6,'M30 requires six preserved products before ordinal resolution');
  assert.deepEqual(memory.state.lastOrdinalProductList,ids(result));
  for(const [question,index]of [['Mennyibe kerül a negyedik?',3],['Mennyibe kerül az ötödik?',4],['Mennyibe kerül a hatodik?',5]]) {
    const next=ask(question,rules,{history:memory.history,conversationState:memory.state});
    assert.equal(next.targetProductId,result.links[index].id,'rehydrated ordinal did not target displayed product');
    assert.deepEqual(ids(next),[result.links[index].id]);assert.equal(next.links[0].url,inventory[index].url);
    assert.ok(next.answer.replace(/\s/g,'').includes(String(inventory[index].actualPriceGross)));
  }
  for(const [question,index]of [['A negyediket.',3],['A negyedik terméket.',3],['A ötödiket.',4],['Az ötödiket.',4],['A hatodikat.',5],['A hatodik terméket.',5]]) {
    const next=ask(question,rules,{history:memory.history,conversationState:memory.state});
    assert.deepEqual(ids(next),[result.links[index].id],'bare ordinal lost its selected card during materialization');
    assert.equal(next.targetProductId,result.links[index].id);
    assert.ok(next.answer.includes(inventory[index].name));
  }
  for(const count of [3,4,5,6])for(const [word,index]of [['A negyediket.',3],['A negyedik terméket.',3],['A ötödiket.',4],['Az ötödiket.',4],['Mennyibe kerül az ötödik?',4],['A hatodikat.',5],['A hatodik terméket.',5]]) {
    const ref=resolveProductReference(word,{lastRecommendedProducts:ids(result).slice(0,count)});
    assert.equal(ref?.productId,index<count?result.links[index].id:null,`${word}/${count}`);
    if(index>=count)assert.equal(ref?.authoritative,false);
  }
  for(const [word,index]of [['Az elsőt.',0],['A másodikat.',1],['A harmadikat.',2]])assert.equal(resolveProductReference(word,{lastRecommendedProducts:ids(result)}).productId,result.links[index].id);
  assert.ok(!resolveProductReference('A hetediket.',{lastRecommendedProducts:[...ids(result),'arbitrary-extra']})?.productId);
  const outOfRange=ask('Mennyibe kerül a hetedik?',rules,{history:memory.history,conversationState:memory.state});
  assert.equal(outOfRange.route,'clarification');assert.deepEqual(outOfRange.links,[]);
});
await testAsync('T7 R-03 ordinal boundaries survive actual rehydrated follow-ups', async () => {
  const inventory=Array.from({length:9},(_,i)=>product(`t7-boundary-${i}`,`Kecsketejes testápoló ${1201+i} ml`,{actualPriceGross:5100+i}));
  for(const count of [3,4,5,6]) {
    fixture(inventory.slice(0,count));
    const result=ask(t1),{restoredMemory}=await readback(result);
    assert.equal(result.links.length,count);
    assert.deepEqual(restoredMemory.state.lastOrdinalProductList,ids(result));
    // Extra catalog data must not enlarge the selection displayed before reload.
    fixture(inventory);
    for(const [question,index]of [['A másodikat.',1],['A harmadikat.',2],['A negyediket.',3],['A ötödiket.',4],['A hatodikat.',5],['Mennyibe kerül a negyedik?',3],['Mennyibe kerül az ötödik?',4],['Mennyibe kerül a hatodik?',5]]) {
      const next=ask(question,rules,{history:restoredMemory.history,conversationState:restoredMemory.state});
      if(index<count) {
        assert.equal(next.targetProductId,result.links[index].id,`${question}/${count}`);
        assert.deepEqual(ids(next),[result.links[index].id]);
      } else {
        assert.equal(next.route,'clarification',`${question}/${count}`);
        assert.deepEqual(next.links,[],'absent displayed product must not be supplied from catalog');
      }
    }
  }
});
await testAsync('T7 R-03 server prose duplicate retains displayed client selection', async () => {
  const inventory=Array.from({length:9},(_,i)=>product(`t7-merge-${i}`,`Kecsketejes testápoló ${701+i} ml`,{actualPriceGross:4100+i}));fixture(inventory);
  const result=ask(t1);
  // Persisted server rows carry prose and route metadata, not rendered cards.
  const rows=[{created_at:'2026-09-20T10:00:00Z',question:t1,answer:result.answer,source:result.source,routing_trace:{route:result.route,intent:result.intent,domain:result.domain}}];
  const {memory}=await readback(result,rows);
  assert.deepEqual(memory.state.lastOrdinalProductList,[],'legacy prose authorized displayed browser selection');
  const next=ask('Mennyibe kerül a hatodik?',rules,{history:memory.history,conversationState:memory.state});
  assert.equal(next.route,'clarification');assert.deepEqual(next.links,[]);
});
await testAsync('T7 R-03 encoded commerce references preserve complete identity', async () => {
  const record=product('Á'.repeat(18)+'/reference',body.name,{actualPriceGross:4321});fixture([record]);
  const result=ask(t1),{memory}=await readback(result);
  assert.deepEqual(memory.state.lastOrdinalProductList,ids(result),'encoded identity was truncated');
  const next=ask('Mennyibe kerül?',rules,{history:memory.history,conversationState:memory.state});
  assert.deepEqual(ids(next),ids(result));
});
await testAsync('T7 historical routes keep three-card history and render limits', async () => {
  const links=Array.from({length:6},(_,i)=>({id:`legacy-${i}`,name:`Legacy ${i}`,url:body.url}));
  const {normalizeMessage}=require('./engine/conversation-memory.cjs');
  for(const route of ['expert_rule','product_category','exact_product'])for(const productTypeConstraint of [undefined,'krem',true,'true',{}]){
    const result={route,productTypeConstraint,answer:'Historical selection',links};
    assert.equal(widgetHarness().render(result).cards.length,3);
    assert.equal(normalizeMessage({role:'assistant',content:result.answer,...result}).links.length,3);
  }
});
test('T7 supported expert metadata must be scalar and restored state remains bounded',()=>{
  fixture([body]);
  for(const key of ['source','intent','ruleId','answer']){
    const result=ask(t2,{resolve:()=>({...expert([bodyCard],body.name),[key]:{targetProductId:'shea_vajas_szappan'}})});
    assert.equal(result.route,'clarification');assert.deepEqual(result.links,[]);
  }
  const harness=widgetHarness();
  const normalized=harness.consumer.normalizeState({version:2,updatedAt:Date.now(),sessionId:'t7-session-123456789',messages:[{role:'bot',content:'Malformed stored links',route:'subtype_catalog',links:{}}]});
  assert.equal(normalized.messages[0].links.length,0);
});
test('T7 R-04 qualifier descriptor evidence fails closed before limit', () => {
  for(const descriptor of ['illatú','állagú','hatású','jellegű','szerű'])for(const sep of [' ',' - ','-- ',': / - ','\t--- , ']) {
    const bad=product('t7-descriptor',`Kecsketejes${sep}${descriptor} testápoló`);fixture([bad]);
    const r=ask(t1);assert.deepEqual(r.links,[],'descriptor-only qualifier established goat-milk membership');
    assert.equal(r.routing.catalogStatus,'CATALOG_AVAILABLE_NO_MATCH');
    fixture([bad,body]);assert.deepEqual(createCatalogSearch(snapshot).searchSubtype('body_lotion',['kecsketejes'],1).products.map(p=>p.id),[body.unasId]);
  }
  for(const name of [body.name,'Levendula illatú kecsketejes testápoló','Testápoló: kecsketejes, levendula 250 ml']){
    fixture([product('t7-positive',name)]);assert.equal(ask(t1).links.length,1,name);
  }
});

// Execute the actual production serializer and read query; only storage I/O is replaced.
function t9Store() {
  const vm=require('node:vm');let source=fs.readFileSync(path.join(__dirname,'server.cjs'),'utf8');
  const mutation=mutations[process.env.RPT_MUTATION];
  if(mutation?.[0]==='server.cjs') {assert.equal(source.split(mutation[1]).length-1,1);source=source.replace(mutation[1],mutation[2]);console.log('MUTATION_APPLIED '+process.env.RPT_MUTATION);}
  const rows=[],local=[],requests=[];
  const sandbox={require,console:{log(){},error(...args){throw Error(args.join(' '));}},fs:{appendFileSync(file,line){local.push(JSON.parse(line));},existsSync:()=>true,readFileSync:()=>local.map(row=>JSON.stringify(row)).join('\n')},CONVERSATION_LOG:'memory-only',CONVERSATION_TABLE:'chat_conversations',
    cleanText:(s,n)=>typeof s==='string'?s.trim().slice(0,n):'',sanitizePageUrl:()=>null,supabaseConfigured:()=>true,
    validSessionId:require('./engine/conversation-memory.cjs').validSessionId,isDiagnosticOnlyConversation:()=>true,
    logSafeTechnicalError(...args){throw Error(JSON.stringify(args));},
    supabaseRequest:async request=>{requests.push(request);if(request.method==='POST'){rows.push({...JSON.parse(JSON.stringify(request.body)),id:rows.length+1});return{body:'[]'};}
      const columns=new URL('https://local'+request.pathname).searchParams.get('select').split(',');return{body:JSON.stringify(rows.map(row=>Object.fromEntries(columns.map(k=>[k,row[k]]))))};}};
  vm.createContext(sandbox);vm.runInContext(source.slice(source.indexOf('function supabaseTablePath('),source.indexOf('function readLocalConversations('))+'\nthis.write=persistConversation;this.read=readSessionConversationRows;',sandbox);
  vm.runInContext(source.slice(source.indexOf('function readLocalConversations('),source.indexOf('async function readSupabaseConversations(')),sandbox);
  return {rows,local,requests,sandbox,async write(result,index,question=t2){const turnId='99999999-9999-4999-8999-'+String(index+1).padStart(12,'0');await sandbox.write({created_at:'2026-09-20T16:'+String(index).padStart(2,'0')+':00Z',session_id:'t9-session-123456789',question,answer:result.answer,source:result.source,routing_trace:result.routing,historyResult:result,turnId});return{...result,turnId};},read:()=>sandbox.read('t9-session-123456789')};
}
async function t9Reload(store,results=[]) {
  const harness=widgetHarness();for(const result of results)harness.consumer.add(result.answer,'bot',result);
  if(results.length)assert.equal(harness.consumer.restoreState(harness.saves.at(-1)),true);
  return require('./engine/conversation-memory.cjs').rehydrateSessionHistory({sessionId:'t9-session-123456789',clientHistory:harness.stored().history,loadRows:()=>store.read()});
}
await testAsync('T9 F9-01 inflected seventh cannot fall through to focus',async()=>{
  const {result}=t8Selection(5),store=t9Store(),saved=await store.write(result,0),m=await t9Reload(store,[saved]);
  for(const q of ['Mennyibe kerül a hetedikből kettő?','Mennyibe kerül a hetediknek az ára?','Van a hetedik termékből másik változat?','A 7.-et.'])assert.equal(ask(q,rules,{history:m.history,conversationState:m.state}).route,'clarification','unsupported variant fell through to focus');
});
await testAsync('T9 F9-02 real acknowledgement reload retains primary six',async()=>{
  const first=t8Selection(0).result,last=t8Selection(5).result,store=t9Store(),a=await store.write(first,0),b=await store.write(last,1);
  for(const q of ['Köszönöm!','Rendben.']){const acknowledgement=ask(q),c=await store.write(acknowledgement,2,q),m=await t9Reload(store,[a,b,c]);assert.equal(ask('Mennyibe kerül?',rules,{history:m.history,conversationState:m.state}).targetProductId,last.links[5].id,'non-selection reset primary six');}
});
await testAsync('T9 F9-03 actual server storage preserves selection and no-match',async()=>{
  const {result}=t8Selection(5),store=t9Store();await store.write(result,0);let m=await t9Reload(store);
  assert.deepEqual(m.state.lastOrdinalProductList,ids(result),'server persistence dropped selection');assert.equal(m.state.focusedProductId,result.links[5].id);
  await store.write(ask(t3),1,t3);m=await t9Reload(store);assert.ok(m.history.some(x=>x.catalogStatus==='CATALOG_AVAILABLE_NO_MATCH'),'server persistence dropped no-match');assert.deepEqual(m.state.lastOrdinalProductList,[]);
});
await testAsync('T9 F9-04 stale browser cannot override newer server empty',async()=>{
  const {result}=t8Selection(5),store=t9Store(),old=await store.write(result,0);await store.write(ask(t3),1,t3);const m=await t9Reload(store,[old]);
  assert.equal(ask('A negyediket.',rules,{history:m.history,conversationState:m.state}).route,'clarification','stale browser restored old fourth');
});


await testAsync('T9 ordinal tri-state broad forms after real reload',async()=>{
  const {inventory,result}=t8Selection(5),store=t9Store(),saved=await store.write(result,0),m=await t9Reload(store,[saved]);
  for(const q of ['A hetediket.','A hetedik terméket.','Mennyibe kerül a hetedik?','És a hetedik?','Mutasd a hetediket.','A 7.-et.','A 7. terméket.','Mennyi a hetedik ára?','MENNYIBE KERÜL A HETEDIK?','A   7.   terméket.','Mennyibe kerül a hetedikből kettő?','Mennyibe kerül a hetedikkel?','Mennyibe kerül a tizenkettedikből egy?','Van a hetedik termékből másik változat?']) {
    const r=ask(q,rules,{history:m.history,conversationState:m.state});assert.equal(r.route,'clarification',q);assert.deepEqual(r.links,[]);assert.equal(r.targetProductId??null,null);
  }
  const {resolveProductReference}=require('./engine/conversation-context.cjs');assert.equal(resolveProductReference('Mennyibe kerül?',{lastRecommendedProducts:ids(result)}),null);
  for(const q of ['A hetediket.','A 7.-et.'])assert.equal(resolveProductReference(q,{lastRecommendedProducts:ids(result)}).ordinalStatus,'EXPLICIT_INVALID_OR_OUT_OF_RANGE_ORDINAL');
  assert.equal(resolveProductReference('A hatodikat.',{lastRecommendedProducts:ids(result)}).ordinalStatus,'VALID_DISPLAYED_ORDINAL');
});
await testAsync('T9 actual server-only fourth fifth sixth and later price',async()=>{
  const {result}=t8Selection(5);
  for(const [q,i] of [['Az elsőt.',0],['A másodikat.',1],['A harmadikat.',2],['A negyediket.',3],['Az ötödiket.',4],['A hatodikat.',5],['Mennyibe kerül a negyedik?',3],['Mennyibe kerül az ötödik?',4],['Mennyibe kerül a hatodik?',5]]){
    const store=t9Store();await store.write(result,0);let m=await t9Reload(store);const next=ask(q,rules,{history:m.history,conversationState:m.state});assert.equal(next.targetProductId,result.links[i].id,q);const browser=await store.write(next,1,q);m=await t9Reload(store,[browser]);assert.equal(ask('Mennyibe kerül?',rules,{history:m.history,conversationState:m.state}).targetProductId,result.links[i].id,q);
  }
});
await testAsync('T9 both subtype no-match directions defeat stale browser',async()=>{
  for(const kind of ['body','face']){
    fixture(Array.from({length:6},(_,i)=>product('t9-'+kind+'-'+i,kind==='body'?('Kecsketejes testápoló '+(2900+i)+' ml'):('Hyaluron arckrém '+(2900+i)+' ml'),{actualPriceGross:9200+i})));
    const first=ask(kind==='body'?t1:t3),empty=ask(kind==='body'?t3:t1),store=t9Store(),old=await store.write(first,0);await store.write(empty,1);
    assert.equal(store.rows[1].history_event.kind,'empty');for(const browser of [[],[old],[old,{...empty,turnId:old.turnId}], [{...old,history_event:{version:1,kind:'selection'},createdAt:'2999-01-01',turnId:'88888888-8888-4888-8888-888888888888'}]]){
      const m=await t9Reload(store,browser);for(const q of ['A negyediket.','Mennyibe kerül a negyedik?','Mennyibe kerül a hetedik?'])assert.equal(ask(q,rules,{history:m.history,conversationState:m.state}).route,'clarification');
    }
  }
});
await testAsync('T9 later acknowledged browser selection and empty obey server chronology',async()=>{
  const first=t8Selection(0).result,last=t8Selection(5).result,store=t9Store(),a=await store.write(first,0),b=await store.write(last,1);
  // Even when the read transport returns rows backwards, database order wins.
  store.rows.reverse();let m=await t9Reload(store,[a]);assert.equal(m.state.focusedProductId,last.targetProductId);m=await t9Reload(store,[b]);assert.equal(m.state.focusedProductId,last.targetProductId);
  const empty=await store.write(ask(t3),2,t3);m=await t9Reload(store,[a,b,empty]);assert.deepEqual(m.state.lastOrdinalProductList,[]);
  const newer=t8Selection(3).result,c=await store.write(newer,3);m=await t9Reload(store,[empty,c]);assert.equal(m.state.focusedProductId,newer.targetProductId);assert.deepEqual(m.state.lastOrdinalProductList,ids(newer));
});
await testAsync('T9 uncorrelated browser clock and event shape confer no authority',async()=>{
  const {result}=t8Selection(5),store=t9Store(),a=await store.write(result,0);const empty=await store.write(ask(t3),1,t3);
  const fake={...a,turnId:'77777777-7777-4777-8777-777777777777',created_at:'2999-01-01T00:00:00Z',history_event:store.rows[0].history_event,history_event_status:'valid',historySelectionAuthority:true};
  let m=await t9Reload(store,[fake]);assert.deepEqual(m.state.lastOrdinalProductList,[]);
  // Conflicting cards using the exact empty turn's ID cannot enrich an empty event.
  m=await t9Reload(store,[{...a,answer:empty.answer,turnId:empty.turnId}]);assert.deepEqual(m.state.lastOrdinalProductList,[]);assert.equal(m.state.focusedProductId,null);
});
await testAsync('T9 actual no-match supersedes primary six after acknowledgement',async()=>{
  const {result}=t8Selection(5),store=t9Store(),a=await store.write(result,0),thanks=await store.write(ask('Köszönöm!'),1,'Köszönöm!');await store.write(ask(t3),2,t3);
  const m=await t9Reload(store,[a,thanks]);assert.deepEqual(m.state.lastOrdinalProductList,[]);assert.equal(m.state.focusedProductId,null);
  for(const q of ['A hatodikat.','A negyediket.','Mennyibe kerül?','Mennyibe kerül a hetedikből egy?'])assert.equal(ask(q,rules,{history:m.history,conversationState:m.state}).route,'clarification');
});
await testAsync('T9 unavailable and rejected expert are not verified empty',async()=>{
  for(const kind of ['unavailable','rejected','prose']){
    const {inventory,result}=t8Selection(5),store=t9Store(),a=await store.write(result,0);let next;
    if(kind==='unavailable'){fs.writeFileSync(snapshot,'{broken');next=ask(t3);fixture(inventory);}else next=kind==='rejected'?ask(t2,{resolve:()=>null}):ask('Köszönöm!');
    const b=await store.write(next,1);assert.equal(store.rows[1].history_event.kind,'none');const m=await t9Reload(store,[a,b]);assert.deepEqual(m.state.lastOrdinalProductList,ids(result));assert.equal(m.state.focusedProductId,result.links[5].id);assert.equal(ask('A negyediket.',rules,{history:m.history,conversationState:m.state}).targetProductId,result.links[3].id);
  }
});
await testAsync('T9 legacy missing events and malformed events stay distinct',async()=>{
  const {result}=t8Selection(5),seed=t9Store();await seed.write(result,0);const valid=JSON.parse(JSON.stringify(seed.rows[0].history_event));
  for(const event of [undefined,null]){const store=t9Store();store.rows.push({id:1,created_at:'2026-09-20T10:00:00Z',question:'Mit ajánlasz problémás fejbőrre?',answer:'Elsőként a Dermavital sampont ajánlom.',source:'expert-problem',...(event===undefined?{}:{history_event:event})});const m=await t9Reload(store);assert.equal(m.state.focusedProductId,'dermavital_sampon');assert.ok(!m.history.some(x=>x.catalogStatus));}
  const malformed=[{},[],true,'event',{...valid,version:2},{...valid,kind:'unknown'},{...valid,turnId:'bad'},{...valid,extra:'not allowed'},{...valid,products:[{id:'catalog:unas:%broken',name:'Dermavital sampon'}]}, {...valid,products:[...valid.products,{...valid.products[0]}]},{...valid,targetProductId:'shea_vajas_szappan'},{...valid,products:valid.products.map((p,i)=>i? p:{...p,id:{}})}];
  for(const event of malformed){const store=t9Store();store.rows.push({id:1,created_at:'2026-09-20T10:00:00Z',question:'Korábbi válasz?',answer:'Dermavital sampon.',source:'expert-rule',history_event:event});const m=await t9Reload(store);assert.deepEqual(m.state.lastOrdinalProductList,[]);assert.equal(m.state.focusedProductId,null);assert.ok(m.history.some(x=>x.historyEventInvalid));assert.ok(!m.history.some(x=>x.catalogStatus));}
});
await testAsync('T9 optional metadata and changed authority retain opposite boundaries',async()=>{
  const first=t8Selection(0).result,last=t8Selection(5).result,store=t9Store(),a=await store.write(first,0),b=await store.write(last,1);
  const m=await t9Reload(store,[{...a,responseType:'browser-rich'},b,{...b,responseType:'another-label'}]);assert.equal(m.history.filter(x=>x.role==='assistant'&&x.turnId===b.turnId).length,1);assert.equal(m.state.focusedProductId,last.targetProductId);
  const {mergeHistory}=require('./engine/conversation-memory.cjs'),row=r=>({role:'assistant',content:r.answer,...r});assert.equal(mergeHistory([row(first)],[{...row(first),responseType:'different'}]).length,1);assert.equal(mergeHistory([row(first)],[row(last)]).length,2);
});
test('T9 SQL and event validator agree without executing migration',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'SUPABASE_BESZELGETES_MENTES.sql'),'utf8');assert.match(sql,/alter table public\.chat_conversations add column if not exists history_event jsonb;/i);assert.doesNotMatch(sql,/history_event\s+jsonb\s+(?:not\s+null|default)/i);assert.doesNotMatch(sql,/\b(drop|rename|delete|update|truncate)\b/i);
  const store=t9Store(),fn=store.sandbox.validateConversationHistoryEvent;assert.equal(typeof fn,'function');assert.equal(fn({version:2}),null);
  const value={version:1,turnId:null,kind:'none',route:null,productTypeConstraint:null,products:[],targetProductId:null};assert.deepEqual(JSON.parse(JSON.stringify(fn(value))),value);assert.equal(fn({...value,products:[{id:'x',name:'x'}]}),null);
  const src=fs.readFileSync(path.join(__dirname,'server.cjs'),'utf8');assert.match(src,/select=id,created_at,question,answer,source,history_event/);assert.match(src,/history_event: buildConversationHistoryEvent/);assert.match(src,/validateConversationHistoryEvent\(row.history_event\)/);
});


await testAsync('T9 actual handleChat persists event and existing turn correlation',async()=>{
  const {inventory}=t8Selection(5),store=t9Store(),box=store.sandbox,vm=require('node:vm');const source=fs.readFileSync(path.join(__dirname,'server.cjs'),'utf8');
  const requestId='12345678-1234-4123-8123-123456789012';let response;
  Object.assign(box,require('./engine/page-context-observation.cjs'),{parseBody:async()=>JSON.stringify({message:t2,sessionId:'t9-session-123456789',turnId:requestId,history:[]}),knowledge,
    rehydrateSessionHistory:require('./engine/conversation-memory.cjs').rehydrateSessionHistory,createAnswer,logGap(){},
    ruleEngine:{resolve:()=>expert(inventory.map(p=>({id:p.unasId,name:p.name,url:p.url})),inventory.map(p=>p.name).join(', '),inventory[5].unasId)},sendJson(res,status,body){assert.equal(status,200);response=body;}});
  vm.runInContext(source.slice(source.indexOf('function normalizeMatchedIds('),source.indexOf('function supabaseConfigured(')),box);
  vm.runInContext(source.slice(source.indexOf('async function handleChat('),source.indexOf('async function handleAdminConversations('))+'\nthis.handle=handleChat;',box);
  await box.handle({headers:{}},{});assert.equal(response.turnId,requestId);assert.equal(store.rows.length,1);assert.equal(store.rows[0].history_event.turnId,requestId);assert.equal(store.rows[0].history_event.targetProductId,response.targetProductId);
  const m=await t9Reload(store,[response]);assert.equal(ask('Mennyibe kerül?',rules,{history:m.history,conversationState:m.state}).targetProductId,response.links[5].id);
});
await testAsync('T9 production local-log recovery retains bounded authority',async()=>{
  const {result}=t8Selection(5),store=t9Store();await store.write(result,0);const box=store.sandbox,vm=require('node:vm'),source=fs.readFileSync(path.join(__dirname,'server.cjs'),'utf8');
  box.fs.existsSync=()=>true;box.fs.readFileSync=()=>store.local.map(row=>JSON.stringify(row)).join('\n');box.supabaseConfigured=()=>false;
  vm.runInContext(source.slice(source.indexOf('function readLocalConversations('),source.indexOf('async function readSupabaseConversations(')),box);
  let m=await t9Reload(store);assert.equal(m.state.focusedProductId,result.links[5].id);await store.write(ask(t3),1,t3);m=await t9Reload(store);assert.deepEqual(m.state.lastOrdinalProductList,[]);
});
await testAsync('T9 missing-column fallback reads legacy without false absence',async()=>{
  const store=t9Store();let calls=0;store.sandbox.supabaseRequest=async request=>{calls++;if(calls===1)throw Object.assign(new Error('missing column'),{supabaseCode:'42703',supabaseMessage:'column history_event does not exist'});assert.match(request.pathname,/select=created_at,question,answer,source&session_id/);return{body:JSON.stringify([{created_at:'2026-01-01',question:'Mit ajánlasz?',answer:'Dermavital sampon.',source:'expert-problem'}])}};
  const m=await t9Reload(store);assert.equal(calls,2);assert.equal(m.state.focusedProductId,'dermavital_sampon');assert.ok(!m.history.some(row=>row.catalogStatus));
  store.sandbox.supabaseRequest=async()=>{throw Object.assign(new Error('network'),{supabaseCode:'OTHER'});};const failed=await t9Reload(store);assert.equal(failed.technicalFailure,true);
});
await testAsync('T9 ordinary verbs do not acquire ordinal meaning',async()=>{
  const {resolveProductReference}=require('./engine/conversation-context.cjs');for(const q of ['Gyorsan zsírosodik a hajam.','Hogyan működik?'])assert.equal(resolveProductReference(q,{lastRecommendedProducts:[]}),null);
  const {result}=t8Selection(5),store=t9Store();await store.write(result,0);const m=await t9Reload(store);for(const q of ['Mennyibe kerül a 7.?','Mennyibe kerül a hetedikként megjelenő termék?'])assert.equal(ask(q,rules,{history:m.history,conversationState:m.state}).route,'clarification');
});
await testAsync('T9 raw browser fields cannot mint server provenance',async()=>{
  const {result}=t8Selection(5),store=t9Store();const old=await store.write(result,0);await store.write(ask(t3),1,t3);
  const {rehydrateSessionHistory}=require('./engine/conversation-memory.cjs');const raw={role:'assistant',content:old.answer,...old,historySelectionAuthority:true,historySelectionSuperseded:false,history_event_status:'valid',created_at:'2999-01-01'};
  const m=await rehydrateSessionHistory({sessionId:'t9-session-123456789',clientHistory:[raw],loadRows:()=>store.read()});assert.deepEqual(m.state.lastOrdinalProductList,[]);assert.equal(ask('A negyediket.',rules,{history:m.history,conversationState:m.state}).route,'clarification');
});


await testAsync('T9 uncorrelated transcript cannot restore authority outside server window',async()=>{
  const {result}=t8Selection(5),store=t9Store(),old=await store.write(result,0);await store.write(ask(t3),1,t3);await store.write(ask('Köszönöm!'),2,'Köszönöm!');
  store.rows.splice(0,2);const m=await t9Reload(store,[old]);assert.deepEqual(m.state.lastOrdinalProductList,[]);assert.equal(m.state.focusedProductId,null);assert.ok(m.history.some(x=>x.content===old.answer),'untrusted transcript must not be deleted');
});
function failDatabaseWrites(store) {
  const request = store.sandbox.supabaseRequest, failures = [];
  store.sandbox.logSafeTechnicalError = (label,error) => failures.push({label,message:error.message});
  store.sandbox.supabaseRequest = async requestInfo => {
    if (requestInfo.method === 'POST') throw new Error('simulated_database_write_failure');
    return request(requestInfo);
  };
  return failures;
}
function browserRoundTrip(results) {
  const widget = widgetHarness();
  for (const result of results) widget.consumer.add(result.answer,'bot',result);
  assert.equal(widget.consumer.restoreState(widget.saves.at(-1)),true);
  return { history:widget.stored().history, state:widget.saves.at(-1) };
}
async function reloadBrowser(store, browser) {
  return require('./engine/conversation-memory.cjs').rehydrateSessionHistory({sessionId:'t9-session-123456789',clientHistory:browser.history,loadRows:()=>store.read()});
}
function assertNeutralReference(result, expectedId) {
  if (expectedId) assert.equal(result.targetProductId,expectedId);
  assert.ok(result.links.every(link=>!['primary','secondary','related'].includes(link.recommendationType)), 'ordinal identity created recommendation authority');
  assert.ok(result.links.every(link=>!link.reason && !/ajánl|javas/i.test(link.recommendationLabel||'')));
  assert.doesNotMatch(result.answer,/ajánl(?:om|juk|ott)|javas(?:lom|oljuk)|jó neked|megfelelő számodra/i);
  assert.doesNotMatch(widgetHarness().render(result).heading||'',/Ajánlott/);
}
await testAsync('T10 F10-01 numeric seventh retains invalid status after reload',async()=>{
  const {result}=t8Selection(5),store=t9Store(),saved=await store.write(result,0);
  const thanks=await store.write(ask('Köszönöm!'),1,'Köszönöm!');
  const browser=browserRoundTrip([saved,thanks]),m=await reloadBrowser(store,browser);
  assert.equal(m.state.focusedProductId,result.links[5].id);
  for(const q of ['A 7.-ről kérdeznék: mennyibe kerül?','Mennyibe kerül a "7."?','Mennyibe kerül a 7.-nél?','A 7-et.']) {
    const next=ask(q,rules,{history:m.history,conversationState:m.state});
    assert.equal(next.route,'clarification','explicit seventh fell through to focus');
    assert.deepEqual(next.links,[]);assert.equal(next.targetProductId??null,null);
  }
});
await testAsync('T10 F10-02 failed write preserves newer server-validated browser turn',async()=>{
  const first=t8Selection(0).result,last=t8Selection(5).result,store=t9Store(),a=await store.write(first,0);
  const failures=failDatabaseWrites(store),b=await store.write(last,1);
  assert.equal(failures.length,1);assert.equal(store.rows.length,1);assert.equal(store.local.length,2);
  const browser=browserRoundTrip([a,b]);let m=await reloadBrowser(store,browser);
  assert.equal(ask('Mennyibe kerül?',rules,{history:m.history,conversationState:m.state}).targetProductId,last.targetProductId,'failed newer write restored old server primary');
  assert.deepEqual(m.state.lastOrdinalProductList,ids(last));
  const empty=await store.write(ask(t3),2,t3);assert.equal(failures.length,2);assert.equal(store.local[2].history_event.kind,'empty');
  m=await reloadBrowser(store,browserRoundTrip([a,b,empty]));
  for(const q of ['A negyediket.','Mennyibe kerül a negyedik?']){
    const r=ask(q,rules,{history:m.history,conversationState:m.state});assert.equal(r.route,'clarification');assert.deepEqual(r.links,[]);
  }
});
await testAsync('T10 F10-03 neutral ordinal cannot authorize an endorsement',async()=>{
  const {inventory}=t8Selection(5);fixture(inventory);
  const listing=ask(t1),store=t9Store(),a=await store.write(listing,0,t1),m=await reloadBrowser(store,browserRoundTrip([a]));
  assert.ok(listing.links.every(link=>!link.recommendationType));
  const r=ask('A hatodikat ajánlod száraz bőrre?',rules,{history:m.history,conversationState:m.state});
  assertNeutralReference(r,listing.links[5].id);
  const trace=compositionTrace.at(-1);assert.equal(trace.target,listing.links[5].id);
  assert.equal(trace.source,'unas-catalog');assert.equal(trace.rule,null);assert.equal(trace.mode,'DIRECT');
  assert.deepEqual(dormantCalls,{});
});

async function t10LifecycleContexts(result) {
  const memory=require('./engine/conversation-memory.cjs');
  const live=[{role:'assistant',content:result.answer,...result}];
  const store=t9Store(),saved=await store.write(result,0),browser=browserRoundTrip([saved]);
  return [{history:live,state:memory.structuredState(live)},
    await memory.rehydrateSessionHistory({sessionId:'t9-session-123456789',clientHistory:browser.history,loadRows:()=>store.read()}),
    await t9Reload(store),await reloadBrowser(store,browser)];
}
await testAsync('T10 bounded ordinal morphology survives every persistence stage',async()=>{
  const {inventory,result}=t8Selection(5);fixture([...inventory,product('extra-7','Testápoló 7'),product('extra-8','Testápoló 8')]);
  const contexts=await t10LifecycleContexts(result),{resolveProductReference}=require('./engine/conversation-context.cjs');
  const forms=['hetedik','hetediket','hetediknek','hetedikre','hetedikről','hetediknél','hetedikkel','hetediké',
    '"a hetedik"','„a hetedik”',"'a hetedik'",'(a hetedik)','[a hetedik]','a "hetedik"','a „hetedik”',
    'a hetedik?','a hetedik!','a hetedik,','a hetedik.','a hetedik termék','a hetedik terméket',
    '7.','7.-et','7-et','7. termék','7. terméket','"7."','„7.”','[7.]','7.-ről','7.-nél','7.-ért','7.-ben'];
  const questions=[...forms.map(form=>`Mennyibe kerül ${form}?`),'Mennyibe kerül "a hetedik"?','Mennyi a hetediknek az ára?','És a hetedik?','A hetedikről mit lehet tudni?','A   7.   terméket!','A hetedik, az utóbbi.','A 6. és a 7.','A hetedik, a hatodikból.'];
  for(const [stage,m] of contexts.entries())for(const q of questions){
    assert.equal(m.state.focusedProductId,result.targetProductId);
    const ref=resolveProductReference(q,{lastRecommendedProducts:ids(result)});
    assert.equal(ref?.ordinalStatus,'EXPLICIT_INVALID_OR_OUT_OF_RANGE_ORDINAL',`${stage}/${q}`);
    const r=ask(q,rules,{history:m.history,conversationState:m.state});assert.equal(r.route,'clarification',`${stage}/${q}`);assert.deepEqual(r.links,[]);assert.equal(r.targetProductId??null,null);
  }
  for(let count=0;count<=6;count++)for(const q of ['A 7-et.','A "7."','A hetediknél.'])assert.equal(resolveProductReference(q,{lastRecommendedProducts:ids(result).slice(0,count)})?.ordinalStatus,'EXPLICIT_INVALID_OR_OUT_OF_RANGE_ORDINAL');
  for(const q of ['Mennyibe kerül?','7 darabot kérek.','7.5 ml','Hogyan működik?'])assert.equal(resolveProductReference(q,{lastRecommendedProducts:ids(result)}),null,q);
  for(const q of ['A 6-et.','A "6."','A hatodikról.'])assert.equal(resolveProductReference(q,{lastRecommendedProducts:ids(result)}).productId,result.links[5].id,q);
});
await testAsync('T10 failed writes recover distinct selections and both empty directions',async()=>{
  for(const type of ['body_lotion','facial_cream']){
    const make=(prefix,n=6)=>Array.from({length:n},(_,i)=>product(`${prefix}-${i}`,`${type==='body_lotion'?'Testápoló':'Arckrém'} ${2000+i} ml`,{actualPriceGross:800+i}));
    const firstInventory=make('old'),secondInventory=make('new');fixture(firstInventory);
    const question=type==='body_lotion'?'Mutass testápolót.':t3;
    const first=ask(question),store=t9Store(),a=await store.write(first,0,question);fixture(secondInventory);
    const next=ask(question),failures=failDatabaseWrites(store),b=await store.write(next,1,question);
    let m=await reloadBrowser(store,browserRoundTrip([a,b]));assert.deepEqual(m.state.lastOrdinalProductList,ids(next));
    for(const [q,index] of [['A negyediket.',3],['Mennyibe kerül a hatodik?',5]])assert.equal(ask(q,rules,{history:m.history,conversationState:m.state}).targetProductId,next.links[index].id);
    const emptyQuestion=type==='body_lotion'?t3:'Mutass testápolót.',empty=ask(emptyQuestion),c=await store.write(empty,2,emptyQuestion);
    assert.equal(store.local.at(-1).history_event.kind,'empty');assert.equal(failures.length,2);
    m=await reloadBrowser(store,browserRoundTrip([a,b,c]));assert.deepEqual(m.state.lastOrdinalProductList,[]);assert.equal(m.state.focusedProductId,null);
    for(const q of ['A negyediket.','Mennyibe kerül a negyedik?','A negyediket ajánlod?'])assertNeutralReference(ask(q,rules,{history:m.history,conversationState:m.state}));
  }
});
await testAsync('T10 failed-write prose and equal-time gaps retain trustworthy order',async()=>{
  const first=t8Selection(0).result,last=t8Selection(5).result,store=t9Store(),a=await store.write(first,0);
  const request=store.sandbox.supabaseRequest;failDatabaseWrites(store);const b=await store.write(last,1);
  store.sandbox.supabaseRequest=request;const ack=ask('Rendben.'),c=await store.write(ack,2,'Rendben.');
  // Preserve append chronology with all three timestamps equal, even when the
  // newer successful database turn is prose and the selection POST failed.
  for(const row of [...store.rows,...store.local])row.created_at='2026-09-20T10:00:00.000Z';
  store.rows.reverse();let m=await reloadBrowser(store,browserRoundTrip([a,b,c]));
  assert.equal(m.state.focusedProductId,last.targetProductId);assert.deepEqual(m.state.lastOrdinalProductList,ids(last));
  assert.equal(ask('Mennyibe kerül?',rules,{history:m.history,conversationState:m.state}).targetProductId,last.targetProductId);
  // PostgREST may render timestamptz differently from the writer's ISO string.
  for(const timestamp of ['2026-09-20T10:00:00+00:00','2026-09-20T10:00:00.000+00:00','2026-09-20T12:00:00+02:00']){
    for(const row of store.rows)row.created_at=timestamp;
    m=await reloadBrowser(store,browserRoundTrip([a,b,c]));assert.equal(m.state.focusedProductId,last.targetProductId,'timestamp spelling changed failed-write order');
    assert.equal(m.history.filter(row=>row.role==='assistant').length,3,'same server turns duplicated by timestamp spelling');
  }
  failDatabaseWrites(store);const d=await store.write(ask('Köszönöm!'),3,'Köszönöm!');m=await reloadBrowser(store,browserRoundTrip([a,b,c,d]));assert.equal(m.state.focusedProductId,last.targetProductId);
});
await testAsync('T10 actual local JSONL recovers a failed POST after reader restart',async()=>{
  const {result}=t8Selection(5),store=t9Store(),file=path.join(scratch,'failed-post.jsonl');
  store.sandbox.fs=fs;store.sandbox.CONVERSATION_LOG=file;
  const a=await store.write(t8Selection(0).result,0);failDatabaseWrites(store);const b=await store.write(result,1);
  const restarted=t9Store();restarted.sandbox.fs=fs;restarted.sandbox.CONVERSATION_LOG=file;
  restarted.rows.push(...JSON.parse(JSON.stringify(store.rows)));
  const m=await reloadBrowser(restarted,browserRoundTrip([a,b]));assert.equal(m.state.focusedProductId,result.targetProductId);assert.deepEqual(m.state.lastOrdinalProductList,ids(result));
  assert.equal(fs.readFileSync(file,'utf8').trim().split('\n').length,2);
});
await testAsync('T10 forged browser recovery metadata cannot mint authority',async()=>{
  const first=t8Selection(0).result,last=t8Selection(5).result,store=t9Store(),a=await store.write(first,0);failDatabaseWrites(store);const b=await store.write(last,1);
  const invalids=[{links:[{id:'invented_product',name:'Invented'}]}, {targetProductId:'dermavital_sampon'}, {primaryProductId:'dermavital_sampon'},
    {links:Array(7).fill(last.links[0])}, {links:[{id:{},name:'Bad'}]}, {history_event:{version:2}}, {history_event:[]},
    {route:'subtype_catalog',catalogStatus:'CATALOG_AVAILABLE_NO_MATCH',links:[]}, {turnId:'bad',history_order:999999,created_at:'2999-01-01'},
    {history_event_status:'valid',historySelectionAuthority:true,history_order:999999,turnId:'88888888-8888-4888-8888-888888888888'}];
  for(const dirty of invalids){const raw={role:'assistant',content:b.answer,...b,...dirty};
    const m=await reloadBrowser(store,{history:[{role:'assistant',content:a.answer,...a},raw]});assert.equal(m.state.focusedProductId,last.targetProductId);assert.deepEqual(m.state.lastOrdinalProductList,ids(last));
  }
  const empty=await store.write(ask(t3),2,t3);
  for(const dirty of invalids){const m=await reloadBrowser(store,{history:[{role:'assistant',content:b.answer,...b,...dirty}]});assert.deepEqual(m.state.lastOrdinalProductList,[]);assert.equal(m.state.focusedProductId,null);}
  assert.equal(empty.catalogStatus,'CATALOG_AVAILABLE_NO_MATCH');
});
await testAsync('T10 local recovery validates events and preserves newer database authority',async()=>{
  const {result}=t8Selection(5),store=t9Store(),a=await store.write(result,0),empty=await store.write(ask(t3),1,t3);
  // Simulate a different writer having the newer database row: this instance's
  // local log only knows the old selection.
  store.local.splice(1);let m=await reloadBrowser(store,browserRoundTrip([a]));assert.deepEqual(m.state.lastOrdinalProductList,[]);
  const invalid={...store.local[0],created_at:'2999-01-01',history_event:{version:2},history_event_status:'valid'};
  store.local.push(invalid,{...invalid,history_event:store.local[0].history_event,session_id:'another-session-123456789'});
  m=await reloadBrowser(store,browserRoundTrip([a]));assert.deepEqual(m.state.lastOrdinalProductList,[]);
  store.local.length=0;const noLocal=await reloadBrowser(store,browserRoundTrip([a,empty]));assert.deepEqual(noLocal.state.lastOrdinalProductList,[]);
});
await testAsync('T10 recommendation and neutral ordinal matrix never upgrades listing authority',async()=>{
  const {inventory}=t8Selection(5);fixture(inventory);const listing=ask(t1),contexts=await t10LifecycleContexts(listing);
  const questions=[['A negyediket ajánlod?',3],['A negyediket ajánlanád?',3],['A negyediket javaslod?',3],['Melyiket ajánlod ezek közül?',null],['A hatodikat ajánlod?',5],['Szerinted a negyedik jó nekem?',3],
    ['A negyediket.',3],['Mutasd a negyediket.',3],['Mennyibe kerül a negyedik?',3],['Mit lehet tudni a negyedikről?',3]];
  for(const m of contexts)for(const [q,index] of questions){const r=ask(q,rules,{history:m.history,conversationState:m.state});assertNeutralReference(r,index===null?null:listing.links[index].id);
    if(index!==null){assert.equal(r.routing.answerMode,'DIRECT');assert.equal(r.communication.answerMode,'DIRECT');}
  }
  const store=t9Store(),a=await store.write(listing,0,t1);let m=await t9Reload(store,[a]);
  const price=ask('Mennyibe kerül a negyedik?',rules,{history:m.history,conversationState:m.state}),b=await store.write(price,1,'Mennyibe kerül a negyedik?');m=await t9Reload(store,[a,b]);
  assertNeutralReference(ask('Ezt ajánlod?',rules,{history:m.history,conversationState:m.state}));
});
await testAsync('T10 active authorized recommendation survives storage and neutral reference',async()=>{
  fixture(baseline.products);const q='Viszket a fejbőröm.',r=ask(q);
  assert.equal(r.route,'expert_rule');assert.equal(r.routing.matchedRuleId,'scalp_itchy');assert.equal(r.answerMode,'RECOMMENDATION');
  assert.ok(r.links.some(link=>link.recommendationType==='primary'));assert.match(widgetHarness().render(r).heading,/Ajánlott/);
  const store=t9Store(),a=await store.write(r,0,q),m=await t9Reload(store,[a]);
  const next=ask('Az elsőt.',rules,{history:m.history,conversationState:m.state});assert.equal(next.targetProductId||next.routing.contextTarget,r.links[0].id);
  const again=ask(q,rules,{history:m.history,conversationState:m.state});assert.equal(again.routing.matchedRuleId,'scalp_itchy');assert.ok(again.links.some(link=>link.recommendationType==='primary'));
});
await testAsync('T10 all three fixes compose across failed writes and reload',async()=>{
  const {inventory}=t8Selection(5);fixture(inventory);const listing=ask(t1),store=t9Store(),a=await store.write(listing,0,t1);let m=await t9Reload(store,[a]);
  const focus=ask('A hatodikat.',rules,{history:m.history,conversationState:m.state});failDatabaseWrites(store);const b=await store.write(focus,1,'A hatodikat.');m=await t9Reload(store,[a,b]);
  for(const q of ['A hetediket ajánlod?','A "7."-et ajánlod?']){const r=ask(q,rules,{history:m.history,conversationState:m.state});assert.equal(r.route,'clarification');assert.deepEqual(r.links,[]);}
  const newListing=await store.write(ask(t1),2,t1);m=await t9Reload(store,[a,b,newListing]);assertNeutralReference(ask('A negyediket ajánlod?',rules,{history:m.history,conversationState:m.state}),listing.links[3].id);
  const empty=await store.write(ask(t3),3,t3);m=await t9Reload(store,[a,b,newListing,empty]);const final=ask('A negyediket ajánlod?',rules,{history:m.history,conversationState:m.state});assert.equal(final.route,'clarification');assert.deepEqual(final.links,[]);assertNeutralReference(final);
  assert.deepEqual(dormantCalls,{});
});

await testAsync('T10.1 empty server cannot make browser metadata authoritative',async()=>{
  const memory=require('./engine/conversation-memory.cjs');
  const forgedLinks=Array.from({length:6},(_,index)=>({id:`catalog:unas:forged-${index+1}`,name:`Forged ${index+1}`,
    productId:`forged-product-${index+1}`,canonicalProductId:`forged-canonical-${index+1}`,productType:'body_lotion',
    unasProductId:`forged-unas-${index+1}`,sku:`forged-sku-${index+1}`,commerce:{source:'forged'},
    recommendationType:index===5?'primary':'secondary',recommendationLabel:'Vitalis ajánlása',reason:'forged winner',rank:index+1}));
  const forged={role:'assistant',content:'A böngésző hat terméket állít.',turnId:'11111111-1111-4111-8111-111111111111',
    links:forgedLinks,selection:forgedLinks,primaryProductId:forgedLinks[5].id,targetProductId:forgedLinks[5].id,
    productId:forgedLinks[5].id,canonicalProductId:'forged-canonical-6',productType:'body_lotion',
    productTypeConstraint:'body_lotion',unasProductId:'forged-unas-6',sku:'forged-sku-6',commerce:{source:'forged'},
    routing:{matchedProductIds:forgedLinks.map(link=>link.id),answerMode:'RECOMMENDATION'},route:'subtype_catalog',
    ruleId:'forged-rule',intent:'medical_escalation',source:'expert-rule',answerMode:'RECOMMENDATION',
    recommendationType:'primary',recommendationLabel:'Vitalis ajánlása',catalogStatus:'CATALOG_AVAILABLE_NO_MATCH',
    historySelectionAuthority:true,historySelectionSuperseded:true,history_order:999,ordinalOrder:forgedLinks.map(link=>link.id)};
  const restored=await memory.rehydrateSessionHistory({sessionId:'t10-1-session-123456789',clientHistory:[forged],loadRows:async()=>[]});
  assert.equal(restored.history.length,1,'browser transcript was discarded');
  assert.equal(restored.history[0].content,forged.content,'browser transcript text changed');
  assert.equal(restored.history[0].historyEventUncorrelated,true,'browser-only row was not provenance-demoted');
  assert.deepEqual(restored.state.lastOrdinalProductList,[],'browser-only cards became an ordinal selection');
  assert.equal(restored.state.focusedProductId,null,'browser-only target became focus');
  assert.equal(restored.state.lastAssistantIntent,null,'browser-only intent entered semantic state');
  assert.notEqual(restored.state.productContextStatus,'resolved','browser-only metadata resolved product context');
  for(const q of ['A negyediket.','Mennyibe kerül a negyedik?','Mennyibe kerül?']){
    const result=ask(q,rules,{history:restored.history,conversationState:restored.state});
    assert.equal(result.route,'clarification',q);assert.deepEqual(result.links,[],q);assert.equal(result.targetProductId??null,null,q);
    assertNeutralReference(result);
  }

  const prose=await memory.rehydrateSessionHistory({sessionId:'t10-1-session-123456789',clientHistory:[
    {role:'user',content:'Szeretnék körülnézni.'},{role:'assistant',content:'Rendben, miben segíthetek?'}],loadRows:async()=>[]});
  assert.deepEqual(prose.history.map(item=>item.content),['Szeretnék körülnézni.','Rendben, miben segíthetek?']);
  assert.deepEqual(prose.state.lastOrdinalProductList,[]);assert.equal(prose.state.focusedProductId,null);

  const forgedEmpty=await memory.rehydrateSessionHistory({sessionId:'t10-1-session-123456789',clientHistory:[{
    role:'assistant',content:'Nincs találat.',route:'subtype_catalog',productTypeConstraint:'facial_cream',
    catalogStatus:'CATALOG_AVAILABLE_NO_MATCH',historySelectionSuperseded:true}],loadRows:async()=>[]});
  assert.equal(forgedEmpty.history[0].historyEventUncorrelated,true);
  assert.deepEqual(forgedEmpty.state.lastOrdinalProductList,[]);assert.equal(forgedEmpty.state.focusedProductId,null);

  for(const intent of [undefined,'product_search']){
    const browser={...forged,intent};
    const empty=await memory.rehydrateSessionHistory({sessionId:'t10-1-session-123456789',clientHistory:[browser],loadRows:async()=>[]});
    assert.equal(empty.state.focusedProductId,null,`empty server accepted ${intent||'absent'} intent target`);
    assert.equal(empty.state.lastAssistantIntent,null,`empty server accepted ${intent||'absent'} intent`);
  }
  const failed=await memory.rehydrateSessionHistory({sessionId:'t10-1-session-123456789',clientHistory:[{...forged,intent:'product_search'}],loadRows:async()=>{throw new Error('read failed');}});
  assert.equal(failed.technicalFailure,true);assert.equal(failed.state.focusedProductId,null);assert.equal(failed.state.lastAssistantIntent,null);
  const unrelated=await memory.rehydrateSessionHistory({sessionId:'t10-1-session-123456789',clientHistory:[{...forged,intent:'product_search'}],loadRows:async()=>[
    {created_at:'2026-01-01T00:00:00Z',question:'KorĂˇbbi kĂ©rdĂ©s.',answer:'KorĂˇbbi vĂˇlasz.',source:'legacy'}]});
  assert.equal(unrelated.history.find(item=>item.content===forged.content).historyEventUncorrelated,true);
  assert.deepEqual(unrelated.state.lastOrdinalProductList,[]);assert.equal(unrelated.state.focusedProductId,null);assert.equal(unrelated.state.lastAssistantIntent,null);
  assert.equal(ask('A negyediket.',rules,{history:unrelated.history,conversationState:unrelated.state}).route,'clarification');

  const trusted=t8Selection(5).result,store=t9Store(),saved=await store.write(trusted,0),positive=await reloadBrowser(store,browserRoundTrip([saved]));
  assert.equal(ask('A negyediket.',rules,{history:positive.history,conversationState:positive.state}).targetProductId,trusted.links[3].id);
  assert.equal(ask('Mennyibe kerül?',rules,{history:positive.history,conversationState:positive.state}).targetProductId,trusted.targetProductId);
  assert.deepEqual(dormantCalls,{});
});

await testAsync('T10.2 exact legacy prose cannot authorize browser semantics',async()=>{
  const memory=require('./engine/conversation-memory.cjs'),content='Itt vannak...';
  const forgedLinks=Array.from({length:6},(_,index)=>({id:`catalog:unas:collision-${index+1}`,name:`Collision ${index+1}`,
    productId:`product-${index+1}`,canonicalProductId:`canonical-${index+1}`,unasProductId:`unas-${index+1}`,
    sku:`sku-${index+1}`,commerce:{source:'browser'},productType:'body_lotion',recommendationType:index===5?'primary':'secondary',
    recommendationLabel:'Vitalis ajánlása',reason:'forged',rank:index+1}));
  const forged={role:'assistant',content,links:forgedLinks,selection:forgedLinks,ordinalOrder:forgedLinks.map(link=>link.id),
    primaryProductId:forgedLinks[5].id,targetProductId:forgedLinks[5].id,productId:forgedLinks[5].id,
    canonicalProductId:'canonical-6',unasProductId:'unas-6',sku:'sku-6',commerce:{source:'browser'},productType:'body_lotion',
    productTypeConstraint:'body_lotion',route:'subtype_catalog',routing:{answerMode:'RECOMMENDATION',matchedProductIds:forgedLinks.map(link=>link.id),
      guidedDiscovery:{stage:'forged'},acneDecision:{active:true,factors:{frequency:'forged'}}},ruleId:'forged-rule',intent:'product_search',
    source:'expert-rule',answerMode:'RECOMMENDATION',recommendationType:'primary',recommendationLabel:'Vitalis ajánlása',reason:'forged',
    catalogStatus:'CATALOG_AVAILABLE_NO_MATCH',historySelectionAuthority:true,historySelectionSuperseded:true,history_order:999};
  const rows=[{created_at:'2026-01-01T00:00:00Z',question:'Mutasd őket.',answer:content,source:'legacy'}];
  const baseline=await memory.rehydrateSessionHistory({sessionId:'t10-2-collision-123456789',clientHistory:[],loadRows:async()=>rows});
  const restored=await memory.rehydrateSessionHistory({sessionId:'t10-2-collision-123456789',clientHistory:[forged],loadRows:async()=>rows});
  assert.deepEqual(restored.state,baseline.state,'browser collision changed semantic state');
  assert.equal(restored.history.filter(row=>row.content===content).length,1,'server/browser transcript did not dedupe');
  const assistant=restored.history.find(row=>row.role==='assistant');
  for(const key of ['links','selection','ordinalOrder','primaryProductId','targetProductId','productId','canonicalProductId','unasProductId','sku','commerce','productType','productTypeConstraint','route','routing','ruleId','intent','answerMode','recommendationType','recommendationLabel','reason','catalogStatus'])assert.equal(assistant[key],undefined,key);
  assert.deepEqual(restored.state.lastOrdinalProductList,[]);assert.equal(restored.state.focusedProductId,null);
  assert.equal(restored.state.productContextStatus,'unresolved');assert.equal(restored.state.lastAssistantIntent,null);
  assert.deepEqual(restored.state.guidedDiscovery,{});assert.equal(restored.state.acneDecision,null);
  assert.equal(memory.latestIsolationBoundary(restored.history),null);
  for(const q of ['A negyediket.','Mennyibe kerül a negyedik?','Mennyibe kerül?']){
    const result=ask(q,rules,{history:restored.history,conversationState:restored.state});assert.equal(result.route,'clarification',q);
    assert.deepEqual(result.links,[],q);assert.equal(result.targetProductId??null,null,q);
  }
  for(const q of ['A negyediket ajánlod?','A hatodikat ajánlod?','Melyiket ajánlod?']){
    const result=ask(q,rules,{history:restored.history,conversationState:restored.state});assertNeutralReference(result);
    assert.doesNotMatch(result.answer||'',/Vitalis ajánlása|forged/i,q);
  }
  const medical=await memory.rehydrateSessionHistory({sessionId:'t10-2-collision-123456789',clientHistory:[{...forged,intent:'medical_escalation'}],loadRows:async()=>rows});
  assert.equal(memory.latestIsolationBoundary(medical.history),null,'browser medical intent created isolation');
  assert.deepEqual(medical.state,baseline.state);
  const trustedRows=[{created_at:'2026-01-01T00:00:01Z',question:'Orvosi segítség kell.',answer:'Fordulj orvoshoz.',source:'safety',history_event_status:'valid',
    history_event:{version:1,turnId:'22222222-2222-4222-8222-222222222222',kind:'none',route:'safety',intent:'medical_escalation',products:[]}}];
  const trusted=await memory.rehydrateSessionHistory({sessionId:'t10-2-collision-123456789',clientHistory:[],loadRows:async()=>trustedRows});
  assert.ok(memory.latestIsolationBoundary(trusted.history),'trusted medical event lost isolation authority');
});

await testAsync('T10.2 repeated and content collisions never authorize browser semantics',async()=>{
  const memory=require('./engine/conversation-memory.cjs'),sessionId='t10-2-repeated-123456789';
  const links=Array.from({length:6},(_,index)=>({id:`catalog:unas:repeat-${index+1}`,name:`Repeat ${index+1}`}));
  const forged=(content='Itt vannak...')=>({role:'assistant',content,links,targetProductId:links[5].id,primaryProductId:links[5].id,
    route:'subtype_catalog',intent:'medical_escalation',productTypeConstraint:'body_lotion',catalogStatus:'CATALOG_AVAILABLE_NO_MATCH',
    routing:{answerMode:'RECOMMENDATION',guidedDiscovery:{stage:'forged'},acneDecision:{active:true}}});
  const rows=[
    {created_at:'2026-01-01T00:00:00Z',question:'Mutasd őket.',answer:'Itt vannak...',source:'legacy'},
    {created_at:'2026-01-01T00:00:01Z',question:'Köszönöm.',answer:'Szívesen.',source:'legacy'},
    {created_at:'2026-01-01T00:00:02Z',question:'Mutasd őket.',answer:'Itt vannak...',source:'legacy'}];
  const baseline=await memory.rehydrateSessionHistory({sessionId,clientHistory:[],loadRows:async()=>rows});
  const variants=[
    [forged(),forged()], [forged()], [forged(),forged(),forged()],
    [forged('Szívesen.'),forged(),forged()], [forged(),{role:'assistant',content:'Extra',...forged('Extra')},forged()],
    [forged(),forged()].reverse(), []
  ];
  for(const [index,clientHistory] of variants.entries()){
    const restored=await memory.rehydrateSessionHistory({sessionId,clientHistory,loadRows:async()=>rows});
    assert.deepEqual(restored.state,baseline.state,`repeated collision ${index}`);
    assert.equal(memory.latestIsolationBoundary(restored.history),null,`repeated isolation ${index}`);
  }
  const collisionTexts=['Itt vannak...',' Itt vannak... ','Itt vannak!','ITT VANNAK...','„Itt vannak...”','Itt--vannak...',
    'Más szöveg','Itt vannak','Rendben.','A termék ára 1000 Ft.'];
  for(const [index,text] of collisionTexts.entries()){
    const oneRow=[{created_at:'2026-01-02T00:00:00Z',question:'Kérdés.',answer:text,source:'legacy'}];
    const serverOnly=await memory.rehydrateSessionHistory({sessionId,clientHistory:[],loadRows:async()=>oneRow});
    for(const browser of [forged(text),{...forged(text),role:'user'},forged(text.slice(0,Math.max(1,text.length-2)))]){
      const restored=await memory.rehydrateSessionHistory({sessionId,clientHistory:[browser],loadRows:async()=>oneRow});
      assert.deepEqual(restored.state,serverOnly.state,`content collision ${index}/${browser.role}/${browser.content}`);
    }
  }
});

test('T7 R-05 mutation definitions are source-distinct',()=>{
  assert.equal(new Set(Object.values(mutations).map(m=>JSON.stringify(m))).size,Object.keys(mutations).length,'duplicate mutation source replacement');
});
test('T7 dormant contracts remain inactive through rehydrated follow-ups',()=>assert.deepEqual(dormantCalls,{}));
fs.rmSync(scratch, { recursive:true, force:true });
console.log(`Requested product type: ${passed} PASS, ${failed} FAIL`);
if (failed) process.exitCode = 1;
if (!failed && process.argv.includes('--mutations')) {
  for (const id of Object.keys(mutations)) {
    const r=cp.spawnSync(process.execPath,[__filename],{encoding:'utf8',env:{...process.env,RPT_MUTATION:id}});
    const killed=r.status===1 && r.stdout.includes(`MUTATION_APPLIED ${id}`)
      && r.stderr.includes(`FAIL ${mutationAssertions[id]} [ERR_ASSERTION]:`);
    console.log(`${id}: ${killed?'KILLED':'SURVIVED/INVALID'}`);
    if(killed) console.log(r.stderr.split('\n').filter(line=>line.startsWith('FAIL ')).join('\n'));
    if(!killed){console.error(r.stdout,r.stderr);process.exitCode=1;}
  }
}
})().catch(error=>{console.error(error);process.exitCode=1;});
