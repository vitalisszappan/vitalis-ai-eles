'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const adapter = require('./engine/conversation-decision-shadow-observation-adapter.cjs');
const { validateSemanticEvidenceObservation } = require('./engine/conversation-decision-semantic-evidence-observation.cjs');

let count = 0;
function test(name, fn) { try { fn(); count++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
const TURN = '123e4567-e89b-42d3-a456-426614174000';
const COMMERCE_REF = '223e4567-e89b-42d3-a456-426614174000';
const PROBLEM_REF = '323e4567-e89b-42d3-a456-426614174000';
const correlation = (overrides = {}) => ({
  correlationVersion: 1, conversationId: 'conversation-0001', turnId: TURN,
  correlationSource: 'VALIDATED_CLIENT', requestReference: 'request:first-shadow/1', ...overrides
});
const input = (overrides = {}) => ({
  adapterVersion: 1,
  correlation: correlation(),
  rawText: 'Mennyi a szállítás, és ekcémám van?',
  routing: { intent: 'shipping_cost', domain: 'eczema', evidence: ['commerce:shipping_cost', 'problem:eczema'] },
  observationReferences: { COMMERCE_INTENT: COMMERCE_REF, PROBLEM_DOMAIN: PROBLEM_REF },
  ...overrides
});
function produced(result, length) {
  assert.equal(result.status, 'PRODUCED'); assert.equal(result.reasonCode, null); assert.deepEqual(result.errors, []);
  assert.equal(result.observations.length, length); return result.observations;
}
function none(result) { assert.deepEqual(result, { status: 'NO_OBSERVATION', reasonCode: null, observations: [], errors: [] }); }
function rejected(result, reasonCode) {
  assert.deepEqual(result, { status: 'REJECTED', reasonCode, observations: null, errors: [reasonCode] });
}
function clone(value) { return structuredClone(value); }
function trustedContext(rawText = input().rawText) {
  return { rawTextBindings:[{sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,rawText}],structuredContextBindings:[],representationBindings:[],externalReferenceBindings:[],historicalObservations:[] };
}

test('exports exact frozen API family', () => {
  assert.equal(typeof adapter.adaptLiveRoutingToSemanticObservations,'function');
  assert.equal(adapter.SHADOW_OBSERVATION_ADAPTER_VERSION,1);
  for(const key of ['SHADOW_OBSERVATION_STATUSES','SHADOW_OBSERVATION_REASON_CODES','SHADOW_OBSERVATION_RESOURCE_LIMITS']) assert.ok(Object.isFrozen(adapter[key]),key);
  assert.deepEqual(adapter.SHADOW_OBSERVATION_STATUSES,['PRODUCED','NO_OBSERVATION','REJECTED']);
});
test('exact COMMERCE_INTENT mapping', () => {
  const observations=produced(adapter.adaptLiveRoutingToSemanticObservations(input({routing:{intent:'shipping_time',domain:null,evidence:['commerce:shipping_time']},observationReferences:{COMMERCE_INTENT:COMMERCE_REF,PROBLEM_DOMAIN:null}})),1);
  assert.equal(observations[0].predicate,'COMMERCE_INTENT'); assert.equal(observations[0].value,'shipping_time');
});
test('exact PROBLEM_DOMAIN mapping', () => {
  const observations=produced(adapter.adaptLiveRoutingToSemanticObservations(input({routing:{intent:null,domain:'psoriasis',evidence:['problem:psoriasis']},observationReferences:{COMMERCE_INTENT:null,PROBLEM_DOMAIN:PROBLEM_REF}})),1);
  assert.equal(observations[0].predicate,'PROBLEM_DOMAIN'); assert.equal(observations[0].value,'psoriasis');
});
test('both observations are emitted in stable predicate order', () => {
  const observations=produced(adapter.adaptLiveRoutingToSemanticObservations(input()),2);
  assert.deepEqual(observations.map((item)=>item.predicate),['COMMERCE_INTENT','PROBLEM_DOMAIN']);
});
test('missing commerce marker produces no commerce observation', () => {
  const observations=produced(adapter.adaptLiveRoutingToSemanticObservations(input({routing:{intent:'shipping_cost',domain:'eczema',evidence:['problem:eczema']},observationReferences:{COMMERCE_INTENT:null,PROBLEM_DOMAIN:PROBLEM_REF}})),1);
  assert.deepEqual(observations.map((item)=>item.predicate),['PROBLEM_DOMAIN']);
});
test('missing problem marker produces no problem observation', () => {
  const observations=produced(adapter.adaptLiveRoutingToSemanticObservations(input({routing:{intent:'shipping_cost',domain:'eczema',evidence:['commerce:shipping_cost']},observationReferences:{COMMERCE_INTENT:COMMERCE_REF,PROBLEM_DOMAIN:null}})),1);
  assert.deepEqual(observations.map((item)=>item.predicate),['COMMERCE_INTENT']);
});
test('mismatched markers produce no observation', () => {
  none(adapter.adaptLiveRoutingToSemanticObservations(input({routing:{intent:'shipping_cost',domain:'eczema',evidence:['commerce:shipping_time','problem:psoriasis']},observationReferences:{COMMERCE_INTENT:null,PROBLEM_DOMAIN:null}})));
});
test('unsupported intent and domain produce no observation', () => {
  none(adapter.adaptLiveRoutingToSemanticObservations(input({routing:{intent:'product_recommendation',domain:'product',evidence:['commerce:product_recommendation','problem:product']},observationReferences:{COMMERCE_INTENT:null,PROBLEM_DOMAIN:null}})));
});
test('duplicate matching markers still produce one observation', () => {
  const observations=produced(adapter.adaptLiveRoutingToSemanticObservations(input({routing:{intent:'payment',domain:null,evidence:['commerce:payment','commerce:payment']},observationReferences:{COMMERCE_INTENT:COMMERCE_REF,PROBLEM_DOMAIN:null}})),1);
  assert.equal(observations[0].value,'payment');
});
test('routing may retain actual unrelated finalized fields', () => {
  const routing={...input().routing,route:'commerce',goal:'ask_shipping',safetyClass:'safe',semanticGuard:{decision:'ACCEPT'},matchedCanonicalIds:[]};
  produced(adapter.adaptLiveRoutingToSemanticObservations(input({routing})),2);
});

test('producer descriptors use committed namespace and version', () => {
  const observations=produced(adapter.adaptLiveRoutingToSemanticObservations(input()),2);
  assert.deepEqual(observations.map((item)=>item.producer),[
    {namespace:'COMMERCE_INTENT_CLASSIFIER',version:1},{namespace:'PROBLEM_DOMAIN_CLASSIFIER',version:1}
  ]);
});
test('observations are DIRECT current-turn whole-source declarations', () => {
  for(const observation of produced(adapter.adaptLiveRoutingToSemanticObservations(input()),2)) {
    assert.equal(observation.lineage,'DIRECT'); assert.deepEqual(observation.dependencies,[]);
    assert.deepEqual(observation.sources,[{sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,locators:[{locatorType:'WHOLE_SOURCE'}]}]);
  }
});
test('supplied references are preserved exactly', () => {
  const observations=produced(adapter.adaptLiveRoutingToSemanticObservations(input()),2);
  assert.deepEqual(observations.map((item)=>item.observationReference),[COMMERCE_REF,PROBLEM_REF]);
});
test('missing or invalid relevant observation reference rejects', () => {
  for(const reference of [null,'',COMMERCE_REF.toUpperCase(),1]) {
    const references={COMMERCE_INTENT:reference,PROBLEM_DOMAIN:null};
    rejected(adapter.adaptLiveRoutingToSemanticObservations(input({routing:{intent:'shipping_cost',domain:null,evidence:['commerce:shipping_cost']},observationReferences:references})),'INVALID_OBSERVATION_REFERENCE');
  }
  const references={PROBLEM_DOMAIN:null};
  rejected(adapter.adaptLiveRoutingToSemanticObservations(input({observationReferences:references})),'INVALID_INPUT');
});
test('irrelevant nullable references need no allocation', () => {
  none(adapter.adaptLiveRoutingToSemanticObservations(input({routing:{intent:null,domain:null,evidence:[]},observationReferences:{COMMERCE_INTENT:null,PROBLEM_DOMAIN:null}})));
});
test('malformed correlation rejects closed', () => {
  for(const value of [null,{},'x',correlation({turnId:'bad'}),correlation({correlationSource:'BROWSER'})]) {
    rejected(adapter.adaptLiveRoutingToSemanticObservations(input({correlation:value})),'INVALID_CORRELATION');
  }
});
test('malformed routing evidence rejects without iteration errors', () => {
  for(const evidence of [null,{},'x',1,true]) {
    rejected(adapter.adaptLiveRoutingToSemanticObservations(input({routing:{intent:'shipping_cost',domain:null,evidence}})),'INVALID_ROUTING');
  }
});
test('non-string routing evidence rejects', () => {
  for(const marker of [null,{},1,true]) rejected(adapter.adaptLiveRoutingToSemanticObservations(input({routing:{intent:'shipping_cost',domain:null,evidence:[marker]}})),'INVALID_ROUTING');
});
test('closed root and reference container reject aliases', () => {
  const root=input(); root.browserIntent='shipping_cost'; rejected(adapter.adaptLiveRoutingToSemanticObservations(root),'INVALID_INPUT');
  const references=input().observationReferences; references.browserReference=COMMERCE_REF;
  rejected(adapter.adaptLiveRoutingToSemanticObservations(input({observationReferences:references})),'INVALID_INPUT');
});

test('each emitted observation independently validates through R4A2I with raw text binding', () => {
  for(const observation of produced(adapter.adaptLiveRoutingToSemanticObservations(input()),2)) {
    assert.equal(validateSemanticEvidenceObservation({observation,validationContext:trustedContext()}).status,'VALID');
  }
});
test('raw text is not copied into an observation', () => {
  const observations=produced(adapter.adaptLiveRoutingToSemanticObservations(input()),2);
  assert.doesNotMatch(JSON.stringify(observations),/Mennyi a szállítás/);
});
test('raw-text resource excess rejects whole call', () => {
  rejected(adapter.adaptLiveRoutingToSemanticObservations(input({rawText:'x'.repeat(16385)})),'RESOURCE_LIMIT_EXCEEDED');
});
test('routing evidence resource excess rejects whole call', () => {
  rejected(adapter.adaptLiveRoutingToSemanticObservations(input({routing:{intent:null,domain:null,evidence:Array.from({length:65},()=> 'x')}})),'RESOURCE_LIMIT_EXCEEDED');
});
test('output is detached, mutable, and caller order is unchanged', () => {
  const value=input(),before=clone(value),observations=produced(adapter.adaptLiveRoutingToSemanticObservations(value),2);
  assert.deepEqual(value,before); observations[0].value='changed'; observations.reverse(); assert.deepEqual(value,before);
});
test('caller mutation after return cannot change observations', () => {
  const value=input(),observations=produced(adapter.adaptLiveRoutingToSemanticObservations(value),2);
  value.routing.intent='changed'; value.routing.evidence.length=0; value.correlation.turnId=PROBLEM_REF;
  assert.equal(observations[0].value,'shipping_cost'); assert.equal(observations[0].correlation.turnId,TURN);
});

test('getters are never invoked', () => {
  let calls=0; const value=input(); Object.defineProperty(value.routing,'evidence',{enumerable:true,get(){calls++;throw new Error('poison');}});
  rejected(adapter.adaptLiveRoutingToSemanticObservations(value),'INVALID_INPUT'); assert.equal(calls,0);
});
test('revoked and failing proxies reject without throwing', () => {
  const {proxy,revoke}=Proxy.revocable({},{}); revoke(); rejected(adapter.adaptLiveRoutingToSemanticObservations(proxy),'INVALID_INPUT');
  rejected(adapter.adaptLiveRoutingToSemanticObservations(new Proxy({}, {ownKeys(){throw new Error('trap');}})),'INVALID_INPUT');
});
test('sparse arrays, cycles, custom prototypes and unsupported values reject', () => {
  const sparse=input(); sparse.routing.evidence=new Array(2); rejected(adapter.adaptLiveRoutingToSemanticObservations(sparse),'INVALID_INPUT');
  const cyclic=input(); cyclic.routing.self=cyclic.routing; rejected(adapter.adaptLiveRoutingToSemanticObservations(cyclic),'INVALID_INPUT');
  rejected(adapter.adaptLiveRoutingToSemanticObservations(Object.create({x:1})),'INVALID_INPUT');
  for(const value of [new Date(),new Map(),()=>{},Symbol('x'),1n]) rejected(adapter.adaptLiveRoutingToSemanticObservations(value),'INVALID_INPUT');
});
test('nesting and aggregate string budgets fail closed', () => {
  let nested={}; for(let index=0;index<17;index++) nested={x:nested}; const deep=input(); deep.routing.extra=nested;
  rejected(adapter.adaptLiveRoutingToSemanticObservations(deep),'RESOURCE_LIMIT_EXCEEDED');
  const huge=input(); huge.routing.extra='x'.repeat(1048577);
  rejected(adapter.adaptLiveRoutingToSemanticObservations(huge),'RESOURCE_LIMIT_EXCEEDED');
});

test('observations contain no proposal, product, or authority fields', () => {
  for(const observation of produced(adapter.adaptLiveRoutingToSemanticObservations(input()),2)) {
    for(const key of ['fieldPath','disposition','evidenceId','productId','resolverId','ruleId','authoritative','recommendationPermission','transitionEvent']) {
      assert.equal(Object.hasOwn(observation,key),false,key);
    }
  }
});
test('unsupported product and planner metadata cannot create observations', () => {
  none(adapter.adaptLiveRoutingToSemanticObservations(input({
    routing:{intent:'product_recommendation',domain:'product',evidence:['product:candidate'],matchedCanonicalIds:['product-A'],targetProductId:'product-A',answerIntent:'product_recommendation'},
    observationReferences:{COMMERCE_INTENT:null,PROBLEM_DOMAIN:null}
  })));
});
test('module imports only dormant H and I contracts and has no forbidden capabilities', () => {
  const source=fs.readFileSync(path.join(__dirname,'engine','conversation-decision-shadow-observation-adapter.cjs'),'utf8');
  const imports=[...source.matchAll(/require\((['"])(.*?)\1\)/g)].map((match)=>match[2]);
  assert.deepEqual(imports,['./conversation-decision-correlation-contract.cjs','./conversation-decision-semantic-evidence-observation.cjs']);
  assert.doesNotMatch(source,/process\.env|Date\.now|new Date|Math\.random|randomUUID|crypto|node:fs|node:https|fetch|supabase|sql|jsonl/i);
});
test('only the fail-isolated first-shadow runner imports the adapter', () => {
  const target='conversation-decision-shadow-observation-adapter.cjs';
  const root=fs.readdirSync(__dirname).filter((name)=>/\.(?:cjs|js)$/.test(name)&&!name.startsWith('TEST_')).map((name)=>name);
  const engine=fs.readdirSync(path.join(__dirname,'engine')).filter((name)=>/\.(?:cjs|js)$/.test(name)&&name!==target).map((name)=>`engine/${name}`);
  const importers=[...root,...engine].filter((name)=>fs.readFileSync(path.join(__dirname,name),'utf8').includes(target));
  assert.deepEqual(importers,['engine/conversation-decision-shadow-runner.cjs']);
});

console.log(`PASS TEST_CONVERSATION_DECISION_SHADOW_OBSERVATION_ADAPTER (${count} cases)`);
