'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const contract = require('./engine/conversation-decision-evidence-identity.cjs');

let count = 0;
function test(name, fn) { try { fn(); count++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const TURN = '123e4567-e89b-42d3-a456-426614174000';
const OBS = '323e4567-e89b-42d3-a456-426614174000';
const EVIDENCE = '423e4567-e89b-42d3-a456-426614174000';
const correlation = (overrides = {}) => ({
  correlationVersion: 1, conversationId: 'conversation-0001', turnId: TURN,
  correlationSource: 'SERVER_ASSIGNED', requestReference: 'request:r4a2j/1', ...overrides
});
const observation = (overrides = {}) => ({
  observationVersion: 1, observationReference: OBS, correlation: correlation(),
  producer: { namespace: 'COMMERCE_INTENT_CLASSIFIER', version: 1 },
  evidenceKind: 'SEMANTIC_CLASSIFICATION', predicate: 'COMMERCE_INTENT',
  value: 'shipping_general', lineage: 'DIRECT',
  sources: [{ sourceType: 'CURRENT_TURN_TEXT', sourceTurnId: TURN, locators: [{ locatorType: 'WHOLE_SOURCE' }] }],
  dependencies: [], ...overrides
});
const context = (overrides = {}) => ({
  rawTextBindings: [{ sourceType: 'CURRENT_TURN_TEXT', sourceTurnId: TURN, rawText: 'shipping question' }],
  structuredContextBindings: [], representationBindings: [], externalReferenceBindings: [],
  historicalObservations: [], ...overrides
});
const input = (overrides = {}) => ({
  admissionVersion: 1, observation: observation(), validationContext: context(), evidenceId: EVIDENCE,
  dependencyBindings: [], existingAdmissions: [], ...overrides
});
function admitted(result, status = 'ADMITTED') {
  assert.equal(result.status, status); assert.equal(result.reasonCode, null); assert.deepEqual(result.errors, []);
  assert.ok(result.evidence); return result.evidence;
}
function rejected(result, reasonCode) {
  assert.deepEqual(result, { status: 'REJECTED', reasonCode, evidence: null, errors: [reasonCode] });
}
function clone(value) { return structuredClone(value); }

test('exports exact frozen contract family', () => {
  assert.equal(typeof contract.admitSemanticEvidence, 'function');
  assert.equal(contract.ADMISSION_VERSION, 1); assert.equal(contract.EVIDENCE_VERSION, 1);
  for (const key of ['ADMISSION_STATUSES', 'ADMISSION_REASON_CODES', 'ADMISSION_RESOURCE_LIMITS']) assert.ok(Object.isFrozen(contract[key]));
  assert.deepEqual(contract.ADMISSION_STATUSES, ['ADMITTED', 'EXACT_REPLAY', 'REJECTED']);
});
test('valid canonical observation admission', () => {
  const node = admitted(contract.admitSemanticEvidence(input()));
  assert.deepEqual(Object.keys(node), ['evidenceVersion','evidenceId','observationReference','conversationId','turnId','supportEvidenceIds','observation']);
  assert.equal(node.evidenceId, EVIDENCE); assert.equal(node.observationReference, OBS);
  assert.equal(node.conversationId, 'conversation-0001'); assert.equal(node.turnId, TURN);
  assert.deepEqual(node.supportEvidenceIds, []); assert.notEqual(node.observation, input().observation);
});
test('invalid version and unknown input property reject', () => {
  rejected(contract.admitSemanticEvidence(input({admissionVersion:2})),'INVALID_INPUT');
  const value=input(); value.browserEvidenceId=EVIDENCE; rejected(contract.admitSemanticEvidence(value),'INVALID_INPUT');
});
test('malformed observation and invalid observationReference reject', () => {
  rejected(contract.admitSemanticEvidence(input({observation:{}})),'INVALID_OBSERVATION');
  rejected(contract.admitSemanticEvidence(input({observation:observation({observationReference:'bad'})})),'INVALID_OBSERVATION');
});
test('evidenceId is exact lowercase UUIDv4 and never coerced', () => {
  for(const evidenceId of ['',EVIDENCE.toUpperCase(),'  '+EVIDENCE,1,null,OBS.replace('-4','-1')]) {
    rejected(contract.admitSemanticEvidence(input({evidenceId})),'INVALID_EVIDENCE_ID');
  }
});
test('exact retry reuses admitted identity', () => {
  const first=admitted(contract.admitSemanticEvidence(input()));
  const replay=admitted(contract.admitSemanticEvidence(input({existingAdmissions:[first]})),'EXACT_REPLAY');
  assert.equal(replay.evidenceId,first.evidenceId); assert.deepEqual(replay,first);
});
test('source and locator order do not change exact replay identity', () => {
  const obs=observation({sources:[
    {sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,locators:[{locatorType:'TEXT_RANGE',coordinateSpace:'RAW_SOURCE_TEXT',start:0,end:1}]},
    {sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,locators:[{locatorType:'TEXT_RANGE',coordinateSpace:'RAW_SOURCE_TEXT',start:1,end:2}]}
  ]});
  const ctx=context({rawTextBindings:[{sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,rawText:'ab'}]});
  const first=admitted(contract.admitSemanticEvidence(input({observation:obs,validationContext:ctx})));
  const reversed=clone(obs); reversed.sources.reverse();
  admitted(contract.admitSemanticEvidence(input({observation:reversed,validationContext:ctx,existingAdmissions:[first]})),'EXACT_REPLAY');
});
test('same observation with changed evidenceId collides', () => {
  const first=admitted(contract.admitSemanticEvidence(input()));
  rejected(contract.admitSemanticEvidence(input({evidenceId:uuid(20),existingAdmissions:[first]})),'OBSERVATION_IDENTITY_COLLISION');
});
test('same evidenceId for a different observation collides', () => {
  const first=admitted(contract.admitSemanticEvidence(input()));
  const other=observation({observationReference:uuid(21)});
  rejected(contract.admitSemanticEvidence(input({observation:other,existingAdmissions:[first]})),'EVIDENCE_IDENTITY_COLLISION');
});
test('changed canonical content on retry rejects mismatch', () => {
  const first=admitted(contract.admitSemanticEvidence(input()));
  rejected(contract.admitSemanticEvidence(input({observation:observation({value:'shipping_time'}),existingAdmissions:[first]})),'REPLAY_MISMATCH');
});

function dependencyFixture() {
  const dependencyObservation=observation({observationReference:uuid(1)});
  const dependencyEvidence=admitted(contract.admitSemanticEvidence(input({observation:dependencyObservation,evidenceId:uuid(101)})));
  const source={sourceType:'STRUCTURED_CONVERSATION_CONTEXT',sourceTurnId:TURN,contextKind:'PRODUCT_CONTEXT_STATUS',locators:[{locatorType:'WHOLE_SOURCE'}]};
  const derived=observation({
    observationReference:uuid(2),producer:{namespace:'CUSTOMER_GOAL_INTERPRETER',version:1},
    predicate:'CUSTOMER_GOAL',value:'find_product',lineage:'DERIVED',sources:[source],dependencies:[uuid(1)]
  });
  const validationContext=context({
    structuredContextBindings:[{sourceTurnId:TURN,contextKind:'PRODUCT_CONTEXT_STATUS',value:'resolved'}],
    historicalObservations:[{observationReference:uuid(1),conversationId:'conversation-0001',dependencies:[]}]
  });
  return {dependencyEvidence,derived,validationContext,binding:{observationReference:uuid(1),evidenceId:uuid(101)}};
}
test('dependency mapping produces deterministic support evidence IDs', () => {
  const f=dependencyFixture();
  const node=admitted(contract.admitSemanticEvidence(input({observation:f.derived,validationContext:f.validationContext,evidenceId:uuid(102),dependencyBindings:[f.binding],existingAdmissions:[f.dependencyEvidence]})));
  assert.deepEqual(node.supportEvidenceIds,[uuid(101)]);
});
test('multiple support IDs use deterministic lexical order', () => {
  const f=dependencyFixture();
  const second={...f.dependencyEvidence,evidenceId:uuid(99),observationReference:uuid(3),observation:clone(f.dependencyEvidence.observation)};
  second.observation.observationReference=uuid(3);
  const derived={...f.derived,dependencies:[uuid(3),uuid(1)]};
  const validationContext=context({structuredContextBindings:f.validationContext.structuredContextBindings,historicalObservations:[
    {observationReference:uuid(1),conversationId:'conversation-0001',dependencies:[]},
    {observationReference:uuid(3),conversationId:'conversation-0001',dependencies:[]}
  ]});
  const bindings=[{observationReference:uuid(3),evidenceId:uuid(99)},f.binding];
  const node=admitted(contract.admitSemanticEvidence(input({observation:derived,validationContext,evidenceId:uuid(102),dependencyBindings:bindings,existingAdmissions:[second,f.dependencyEvidence]})));
  assert.deepEqual(node.supportEvidenceIds,[uuid(99),uuid(101)].sort());
});
test('dependency and binding order do not change exact replay identity', () => {
  const f=dependencyFixture();
  const second={...f.dependencyEvidence,evidenceId:uuid(99),observationReference:uuid(3),observation:clone(f.dependencyEvidence.observation)};
  second.observation.observationReference=uuid(3);
  const derived={...f.derived,dependencies:[uuid(3),uuid(1)]};
  const validationContext=context({structuredContextBindings:f.validationContext.structuredContextBindings,historicalObservations:[
    {observationReference:uuid(1),conversationId:'conversation-0001',dependencies:[]},
    {observationReference:uuid(3),conversationId:'conversation-0001',dependencies:[]}
  ]});
  const bindings=[{observationReference:uuid(3),evidenceId:uuid(99)},f.binding];
  const first=admitted(contract.admitSemanticEvidence(input({observation:derived,validationContext,evidenceId:uuid(102),dependencyBindings:bindings,existingAdmissions:[second,f.dependencyEvidence]})));
  const reversed=clone(derived); reversed.dependencies.reverse();
  admitted(contract.admitSemanticEvidence(input({observation:reversed,validationContext,evidenceId:uuid(102),dependencyBindings:[...bindings].reverse(),existingAdmissions:[first,second,f.dependencyEvidence]})),'EXACT_REPLAY');
});
test('missing dependency binding rejects', () => {
  const f=dependencyFixture();
  rejected(contract.admitSemanticEvidence(input({observation:f.derived,validationContext:f.validationContext,evidenceId:uuid(102),existingAdmissions:[f.dependencyEvidence]})),'MISSING_DEPENDENCY_BINDING');
});
test('duplicate and conflicting dependency bindings reject', () => {
  const f=dependencyFixture();
  for(const bindings of [[f.binding,clone(f.binding)],[f.binding,{observationReference:uuid(1),evidenceId:uuid(103)}]]) {
    rejected(contract.admitSemanticEvidence(input({observation:f.derived,validationContext:f.validationContext,evidenceId:uuid(102),dependencyBindings:bindings,existingAdmissions:[f.dependencyEvidence]})),'CONFLICTING_DEPENDENCY_BINDING');
  }
});
test('binding must resolve to an existing admitted pair', () => {
  const f=dependencyFixture();
  rejected(contract.admitSemanticEvidence(input({observation:f.derived,validationContext:f.validationContext,evidenceId:uuid(102),dependencyBindings:[f.binding]})),'CONFLICTING_DEPENDENCY_BINDING');
});
test('extra nondependency binding rejects admission context', () => {
  rejected(contract.admitSemanticEvidence(input({dependencyBindings:[{observationReference:uuid(1),evidenceId:uuid(101)}]})),'INVALID_ADMISSION_CONTEXT');
});
test('cross-conversation dependency binding rejects', () => {
  const f=dependencyFixture(),foreign=clone(f.dependencyEvidence);
  foreign.conversationId='conversation-0002'; foreign.observation.correlation.conversationId='conversation-0002';
  rejected(contract.admitSemanticEvidence(input({observation:f.derived,validationContext:f.validationContext,evidenceId:uuid(102),dependencyBindings:[f.binding],existingAdmissions:[foreign]})),'CROSS_CONVERSATION_BINDING');
});
test('malformed admission arrays fail closed', () => {
  for(const dependencyBindings of [null,{},'x',1,true]) rejected(contract.admitSemanticEvidence(input({dependencyBindings})),'INVALID_ADMISSION_CONTEXT');
  for(const existingAdmissions of [null,{},'x',1,true]) rejected(contract.admitSemanticEvidence(input({existingAdmissions})),'INVALID_ADMISSION_CONTEXT');
});
test('malformed nested binding and admission entries fail closed', () => {
  const f=dependencyFixture();
  for(const binding of [null,{},'x',1,true]) rejected(contract.admitSemanticEvidence(input({observation:f.derived,validationContext:f.validationContext,evidenceId:uuid(102),dependencyBindings:[binding],existingAdmissions:[f.dependencyEvidence]})),'INVALID_ADMISSION_CONTEXT');
  for(const admission of [null,{},'x',1,true]) rejected(contract.admitSemanticEvidence(input({existingAdmissions:[admission]})),'INVALID_ADMISSION_CONTEXT');
});
test('duplicate existing registry identities reject deterministically', () => {
  const first=admitted(contract.admitSemanticEvidence(input()));
  rejected(contract.admitSemanticEvidence(input({existingAdmissions:[first,clone(first)]})),'INVALID_ADMISSION_CONTEXT');
});
test('malformed stored replay observation rejects context without throwing', () => {
  const first=admitted(contract.admitSemanticEvidence(input())); first.observation.sources=null;
  rejected(contract.admitSemanticEvidence(input({existingAdmissions:[first]})),'REPLAY_MISMATCH');
});

test('getters are not invoked at any nesting level', () => {
  let calls=0; const value=input(); Object.defineProperty(value.observation,'predicate',{enumerable:true,get(){calls++;throw new Error('poison');}});
  rejected(contract.admitSemanticEvidence(value),'INVALID_INPUT'); assert.equal(calls,0);
});
test('revoked and failing proxies reject without throwing', () => {
  const {proxy,revoke}=Proxy.revocable({},{}); revoke(); rejected(contract.admitSemanticEvidence(proxy),'INVALID_INPUT');
  rejected(contract.admitSemanticEvidence(new Proxy({}, {ownKeys(){throw new Error('trap');}})),'INVALID_INPUT');
});
test('sparse arrays, cycles, custom prototypes and unsupported values reject', () => {
  const sparse=input(); sparse.dependencyBindings=new Array(2); rejected(contract.admitSemanticEvidence(sparse),'INVALID_INPUT');
  const cyclic=input(); cyclic.self=cyclic; rejected(contract.admitSemanticEvidence(cyclic),'INVALID_INPUT');
  rejected(contract.admitSemanticEvidence(Object.create({x:1})),'INVALID_INPUT');
  for(const value of [new Date(),new Map(),()=>{},Symbol('x'),1n]) rejected(contract.admitSemanticEvidence(value),'INVALID_INPUT');
});
test('resource bounds reject whole admission', () => {
  rejected(contract.admitSemanticEvidence(input({dependencyBindings:Array.from({length:33},()=>({}))})),'RESOURCE_LIMIT_EXCEEDED');
  rejected(contract.admitSemanticEvidence(input({existingAdmissions:Array.from({length:257},()=>({}))})),'RESOURCE_LIMIT_EXCEEDED');
  let nested={}; for(let i=0;i<17;i++) nested={x:nested}; const value=input(); value.extra=nested;
  rejected(contract.admitSemanticEvidence(value),'RESOURCE_LIMIT_EXCEEDED');
});
test('caller data is not mutated or aliased', () => {
  const value=input(),before=clone(value),node=admitted(contract.admitSemanticEvidence(value));
  assert.deepEqual(value,before); node.observation.value='changed'; node.supportEvidenceIds.push(uuid(9));
  assert.deepEqual(value,before);
});
test('caller mutation after admission cannot affect output', () => {
  const value=input(),node=admitted(contract.admitSemanticEvidence(value));
  value.observation.value='changed'; value.dependencyBindings.push({});
  assert.equal(node.observation.value,'shipping_general'); assert.deepEqual(node.supportEvidenceIds,[]);
});

test('authority-neutral node has no proposal materialization fields', () => {
  const node=admitted(contract.admitSemanticEvidence(input()));
  for(const key of ['fieldPath','sourceType','disposition','producerId','resolverId','ruleId','productId','sourceText','sourceSpan']) assert.equal(Object.hasOwn(node,key),false,key);
});
test('product candidate remains an observation, never product proof', () => {
  const candidate=observation({producer:{namespace:'PRODUCT_ALIAS_MATCHER',version:1},evidenceKind:'PRODUCT_CANDIDATE',predicate:'PRODUCT_CANDIDATE_MEMBERSHIP',value:'candidate-A'});
  const node=admitted(contract.admitSemanticEvidence(input({observation:candidate})));
  assert.equal(node.observation.value,'candidate-A'); assert.equal(Object.hasOwn(node,'productId'),false);
});
test('reference resolution remains an observation, never canonical identity proof', () => {
  const source={sourceType:'STRUCTURED_CONVERSATION_CONTEXT',sourceTurnId:TURN,contextKind:'PRODUCT_FOCUS_CONTEXT',locators:[{locatorType:'PRODUCT_ID',productId:'candidate-A'}]};
  const resolved=observation({producer:{namespace:'PRODUCT_REFERENCE_RESOLVER',version:1},evidenceKind:'REFERENCE_RESOLUTION',predicate:'PRODUCT_REFERENCE_RESOLUTION',value:{outcome:'UNIQUE_CANDIDATE',referenceType:'variant',productId:'candidate-A'},lineage:'DERIVED',sources:source?[source]:[],dependencies:[]});
  const ctx=context({structuredContextBindings:[{sourceTurnId:TURN,contextKind:'PRODUCT_FOCUS_CONTEXT',value:'candidate-A'}]});
  const node=admitted(contract.admitSemanticEvidence(input({observation:resolved,validationContext:ctx})));
  assert.equal(node.observation.value.productId,'candidate-A'); assert.equal(Object.hasOwn(node,'productId'),false);
});
test('production module is dormant and capability-free', () => {
  const source=fs.readFileSync(path.join(__dirname,'engine','conversation-decision-evidence-identity.cjs'),'utf8');
  const imports=[...source.matchAll(/require\((['"])(.*?)\1\)/g)].map((match)=>match[2]);
  assert.deepEqual(imports,['./conversation-decision-semantic-evidence-observation.cjs']);
  assert.doesNotMatch(source,/process\.env|Date\.now|new Date|Math\.random|randomUUID|crypto|node:fs|node:https|fetch|supabase|sql|jsonl/i);
  for(const forbidden of ['fieldPath','CANONICAL_RESOLUTION','APPROVED_PRODUCT_FACT','SET','CLEAR']) assert.doesNotMatch(source,new RegExp(`['\"]${forbidden}['\"]`));
});
test('only the fail-isolated first-shadow runner imports R4A2J', () => {
  const target='conversation-decision-evidence-identity.cjs';
  const root=fs.readdirSync(__dirname).filter((name)=>/\.(?:cjs|js)$/.test(name)&&!name.startsWith('TEST_')).map((name)=>name);
  const engine=fs.readdirSync(path.join(__dirname,'engine')).filter((name)=>/\.(?:cjs|js)$/.test(name)&&name!==target).map((name)=>`engine/${name}`);
  const importers=[...root,...engine].filter((name)=>fs.readFileSync(path.join(__dirname,name),'utf8').includes(target));
  assert.deepEqual(importers,['engine/conversation-decision-shadow-runner.cjs']);
});

console.log(`PASS TEST_CONVERSATION_DECISION_EVIDENCE_IDENTITY_R4A2J (${count} cases)`);
