'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const contract = require('./engine/conversation-decision-semantic-evidence-observation.cjs');

let count = 0;
function test(name, fn) { try { fn(); count++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
const TURN = '123e4567-e89b-42d3-a456-426614174000';
const OLD_TURN = '223e4567-e89b-42d3-a456-426614174000';
const OBS = '323e4567-e89b-42d3-a456-426614174000';
const REP = '423e4567-e89b-42d3-a456-426614174000';
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const correlation = (overrides = {}) => ({
  correlationVersion: 1, conversationId: 'conversation-0001', turnId: TURN,
  correlationSource: 'SERVER_ASSIGNED', requestReference: 'request:r4a2i/1', ...overrides
});
const whole = () => ({ locatorType: 'WHOLE_SOURCE' });
const context = (overrides = {}) => ({
  rawTextBindings: [{ sourceType: 'CURRENT_TURN_TEXT', sourceTurnId: TURN, rawText: 'shipping question' }],
  structuredContextBindings: [], representationBindings: [], externalReferenceBindings: [],
  historicalObservations: [], ...overrides
});
const observation = (overrides = {}) => ({
  observationVersion: 1, observationReference: OBS, correlation: correlation(),
  producer: { namespace: 'COMMERCE_INTENT_CLASSIFIER', version: 1 },
  evidenceKind: 'SEMANTIC_CLASSIFICATION', predicate: 'COMMERCE_INTENT',
  value: 'shipping_general', lineage: 'DIRECT',
  sources: [{ sourceType: 'CURRENT_TURN_TEXT', sourceTurnId: TURN, locators: [whole()] }],
  dependencies: [], ...overrides
});
function one(obs = observation(), ctx = context()) { return contract.validateSemanticEvidenceObservation({ observation: obs, validationContext: ctx }); }
function graph(observations, ctx = context()) { return contract.validateSemanticEvidenceObservationGraph({ observations, validationContext: ctx }); }
function valid(result) { assert.equal(result.status, 'VALID'); assert.equal(result.reasonCode, null); assert.deepEqual(result.errors, []); return result; }
function rejected(result, reason) { assert.deepEqual(result, { status: 'REJECTED', reasonCode: reason, observation: null, errors: [reason] }); }
function graphRejected(result, reason) { assert.deepEqual(result, { status: 'REJECTED', reasonCode: reason, observations: null, errors: [reason] }); }
function clone(value) { return structuredClone(value); }

test('exports exact public API family and frozen constants', () => {
  for (const key of ['validateSemanticEvidenceObservation', 'validateSemanticEvidenceObservationGraph']) assert.equal(typeof contract[key], 'function');
  for (const key of ['OBSERVATION_STATUSES', 'OBSERVATION_REASON_CODES', 'PRODUCER_NAMESPACES', 'PRODUCER_VERSIONS', 'PRODUCER_PREDICATES', 'EVIDENCE_KINDS', 'EVIDENCE_KIND_PREDICATES', 'PREDICATES', 'LINEAGE_VALUES', 'SOURCE_TYPES', 'REPRESENTATION_KINDS', 'CONTEXT_KINDS', 'REFERENCE_KINDS', 'LOCATOR_TYPES', 'RELATION_TYPES', 'RESOURCE_LIMITS']) assert.ok(Object.isFrozen(contract[key]), key);
  assert.equal(contract.OBSERVATION_VERSION, 1);
  assert.deepEqual(contract.OBSERVATION_STATUSES, ['VALID', 'REJECTED']);
});
test('basic DIRECT observation validates', () => valid(one()));
test('output is detached, mutable, and preserves caller order', () => {
  const input = observation(); const result = valid(one(input));
  assert.notEqual(result.observation, input); assert.notEqual(result.observation.sources, input.sources);
  result.observation.value = 'changed'; assert.equal(input.value, 'shipping_general'); assert.equal(valid(one(input)).observation.value, 'shipping_general');
});
test('root is closed and evidenceId is forbidden', () => { const value = observation(); value.evidenceId = 'x'; rejected(one(value), 'UNKNOWN_PROPERTY'); });
test('version is exact numeric one', () => { for (const value of ['1', 0, 2]) rejected(one(observation({ observationVersion: value })), 'INVALID_VERSION'); });
test('observation UUID is lowercase UUIDv4', () => { for (const value of [OBS.toUpperCase(), '123e4567-e89b-12d3-a456-426614174000', ` ${OBS}`]) rejected(one(observation({ observationReference: value })), 'INVALID_REFERENCE'); });
test('invalid correlation delegates and fails closed', () => { const value = observation(); value.correlation.turnId = 'bad'; rejected(one(value), 'INVALID_CORRELATION'); });

const enumCases = {
  COMMERCE_INTENT: ['COMMERCE_INTENT_CLASSIFIER', 'order_start'],
  PROBLEM_DOMAIN: ['PROBLEM_DOMAIN_CLASSIFIER', 'eczema'],
  CUSTOMER_GOAL: ['CUSTOMER_GOAL_INTERPRETER', 'find_product'],
  INTERPRETED_INTENT: ['CUSTOMER_GOAL_INTERPRETER', 'product_usage'],
  SEMANTIC_DOMAIN: ['CUSTOMER_GOAL_INTERPRETER', 'product'],
  SAFETY_CLASS: ['SAFETY_CLASSIFIER', 'safe'],
  ADVERSE_REACTION_SUBTYPE: ['SAFETY_CLASSIFIER', 'blistering'],
  COMPLAINT_INTENT: ['COMPLAINT_INTERPRETER', 'product_irritation'],
  COMPLAINT_SUBJECT: ['COMPLAINT_INTERPRETER', 'user'],
  COMPLAINT_TEMPORALITY: ['COMPLAINT_INTERPRETER', 'current'],
  COMPLAINT_POLARITY: ['COMPLAINT_INTERPRETER', 'positive'],
  COMPLAINT_CAUSALITY: ['COMPLAINT_INTERPRETER', 'asserted'],
  COMPLAINT_SEVERITY: ['COMPLAINT_INTERPRETER', 'moderate'],
  PRODUCT_CATEGORY: ['COMPLAINT_INTERPRETER', 'szappan'],
  ORDINAL_INTERPRETATION_STATUS: ['PRODUCT_REFERENCE_RESOLVER', 'VALID_DISPLAYED_ORDINAL'],
  PRODUCT_RECOVERY_STATUS: ['PERSISTED_PRODUCT_RECOVERY', 'resolved']
};
for (const [predicate, [namespace, value]] of Object.entries(enumCases)) test(`predicate ${predicate} accepts settled value`, () => {
  let lineage = namespace === 'PRODUCT_REFERENCE_RESOLVER' ? 'DERIVED' : namespace === 'PERSISTED_PRODUCT_RECOVERY' ? 'RECOVERY' : 'DIRECT';
  let sources = observation().sources, ctx = context(), dependencies = [];
  if (lineage === 'DERIVED') {
    sources = [{ sourceType: 'STRUCTURED_CONVERSATION_CONTEXT', sourceTurnId: TURN, contextKind: 'DISPLAYED_PRODUCT_SEQUENCE', locators: [whole()] }];
    ctx = context({ structuredContextBindings: [{ sourceTurnId: TURN, contextKind: 'DISPLAYED_PRODUCT_SEQUENCE', value: ['product'] }] });
  }
  if (lineage === 'RECOVERY') {
    sources = [{ sourceType: 'PERSISTED_UNATTRIBUTED_REPRESENTATION', representationKind: 'CONVERSATION_ANSWER', representationReference: REP, locators: [whole()] }];
    ctx = context({ representationBindings: [{ representationReference: REP, representationKind: 'CONVERSATION_ANSWER', sourceTurnId: null }] });
  }
  valid(one(observation({ producer: { namespace, version: 1 }, predicate, value, lineage, sources, dependencies }), ctx));
});
test('all settled enum members validate', () => {
  for (const [predicate, values] of Object.entries({
    COMMERCE_INTENT: ['order_confirmation_problem','checkout_problem','order_status','shipping_cost','shipping_time','shipping_general','payment','availability_query','price_query','purchase_location','ordering_help','order_start'],
    SAFETY_CLASS: ['medical_escalation','caution_with_boundary','safe_cosmetic_answer','safe'],
    PRODUCT_RECOVERY_STATUS: ['resolved','ambiguous','unresolved']
  })) for (const value of values) {
    const [namespace] = enumCases[predicate]; let obs = observation({ producer: { namespace, version: 1 }, predicate, value }); let ctx = context();
    if (namespace === 'PERSISTED_PRODUCT_RECOVERY') { obs = observation({ producer: { namespace, version: 1 }, predicate, value, lineage: 'RECOVERY', sources: [{ sourceType:'PERSISTED_UNATTRIBUTED_REPRESENTATION', representationKind:'CONVERSATION_ANSWER', representationReference:REP, locators:[whole()] }] }); ctx = context({representationBindings:[{representationReference:REP,representationKind:'CONVERSATION_ANSWER',sourceTurnId:null}]}); }
    valid(one(obs, ctx));
  }
});
test('unknown enum and null fail', () => { rejected(one(observation({ value: 'OTHER' })), 'INVALID_VALUE'); rejected(one(observation({ value: null })), 'INVALID_VALUE'); });
for (const predicate of ['PRODUCT_PRESENCE', 'REPLACEMENT_REQUEST', 'CUSTOMER_SERVICE_INTERSECTION']) test(`${predicate} is positive-only`, () => {
  valid(one(observation({ producer: { namespace: 'COMPLAINT_INTERPRETER', version: 1 }, predicate, value: true })));
  rejected(one(observation({ producer: { namespace: 'COMPLAINT_INTERPRETER', version: 1 }, predicate, value: false })), 'INVALID_VALUE');
});
test('producer, kind, and predicate matrices reject cross-combinations', () => {
  rejected(one(observation({ producer: { namespace: 'PROBLEM_DOMAIN_CLASSIFIER', version: 1 } })), 'INVALID_KIND_PREDICATE');
  rejected(one(observation({ evidenceKind: 'PRODUCT_CANDIDATE' })), 'INVALID_KIND_PREDICATE');
  rejected(one(observation({ producer: { namespace: 'NOPE', version: 1 } })), 'INVALID_PRODUCER');
  rejected(one(observation({ producer: { namespace: 'COMMERCE_INTENT_CLASSIFIER', version: 2 } })), 'INVALID_PRODUCER');
});
test('product candidate membership preserves valid ID boundaries', () => {
  for (const id of ['A', 'Á'.repeat(256)]) valid(one(observation({ producer:{namespace:'PRODUCT_ALIAS_MATCHER',version:1}, evidenceKind:'PRODUCT_CANDIDATE', predicate:'PRODUCT_CANDIDATE_MEMBERSHIP', value:id })));
  for (const id of ['', 'x'.repeat(257), ' edge', 'edge ', 'a\u0000b']) rejected(one(observation({ producer:{namespace:'PRODUCT_ALIAS_MATCHER',version:1}, evidenceKind:'PRODUCT_CANDIDATE', predicate:'PRODUCT_CANDIDATE_MEMBERSHIP', value:id })), 'INVALID_VALUE');
});
test('preferred candidate exact structure and DERIVED context', () => {
  const sources=[{sourceType:'STRUCTURED_CONVERSATION_CONTEXT',sourceTurnId:TURN,contextKind:'PRODUCT_CANDIDATE_COLLECTION',locators:[whole()]}];
  const ctx=context({structuredContextBindings:[{sourceTurnId:TURN,contextKind:'PRODUCT_CANDIDATE_COLLECTION',value:['CaseID']}]});
  valid(one(observation({producer:{namespace:'PRODUCT_ALIAS_MATCHER',version:1},evidenceKind:'PRODUCT_CANDIDATE',predicate:'PREFERRED_PRODUCT_CANDIDATE',value:{productId:'CaseID',preferenceMode:'EARLIEST_SOURCE_MATCH'},lineage:'DERIVED',sources}),ctx));
  rejected(one(observation({producer:{namespace:'PRODUCT_ALIAS_MATCHER',version:1},evidenceKind:'PRODUCT_CANDIDATE',predicate:'PREFERRED_PRODUCT_CANDIDATE',value:{productId:'x',preferenceMode:'OTHER'},lineage:'DERIVED',sources}),ctx),'INVALID_VALUE');
});
test('mention count accepts 0 and safe positive, rejects -0 and unsafe', () => {
  const src=[{sourceType:'PERSISTED_UNATTRIBUTED_REPRESENTATION',representationKind:'CONVERSATION_ANSWER',representationReference:REP,locators:[whole()]}];
  const ctx=context({representationBindings:[{representationReference:REP,representationKind:'CONVERSATION_ANSWER',sourceTurnId:null}]});
  for(const value of [0,9,Number.MAX_SAFE_INTEGER]) valid(one(observation({producer:{namespace:'PERSISTED_PRODUCT_RECOVERY',version:1},evidenceKind:'QUANTITATIVE_MEASUREMENT',predicate:'PRODUCT_MENTION_COUNT',value,lineage:'RECOVERY',sources:src}),ctx));
  for(const value of [-0,-1,Number.MAX_SAFE_INTEGER+1,1.5]) rejected(one(observation({producer:{namespace:'PERSISTED_PRODUCT_RECOVERY',version:1},evidenceKind:'QUANTITATIVE_MEASUREMENT',predicate:'PRODUCT_MENTION_COUNT',value,lineage:'RECOVERY',sources:src}),ctx),'INVALID_VALUE');
});
test('reference resolution union has closed branches and no authority flag', () => {
  const sources=[{sourceType:'STRUCTURED_CONVERSATION_CONTEXT',sourceTurnId:TURN,contextKind:'PRODUCT_FOCUS_CONTEXT',locators:[{locatorType:'PRODUCT_ID',productId:'p'}]}];
  const ctx=context({structuredContextBindings:[{sourceTurnId:TURN,contextKind:'PRODUCT_FOCUS_CONTEXT',value:'p'}]});
  for(const value of [
    {outcome:'UNRESOLVED',referenceType:'ordinal'},
    {outcome:'AMBIGUOUS',referenceType:'category'},
    {outcome:'UNIQUE_CANDIDATE',referenceType:'variant',productId:'p'},
    {outcome:'UNIQUE_CANDIDATE',referenceType:'companion',productId:'p',relationType:'soap'},
    {outcome:'UNIQUE_CANDIDATE',referenceType:'focus',productId:'p',focusBasis:'explicit_focus'}
  ]) valid(one(observation({producer:{namespace:'PRODUCT_REFERENCE_RESOLVER',version:1},evidenceKind:'REFERENCE_RESOLUTION',predicate:'PRODUCT_REFERENCE_RESOLUTION',value,lineage:'DERIVED',sources}),ctx));
  rejected(one(observation({producer:{namespace:'PRODUCT_REFERENCE_RESOLVER',version:1},evidenceKind:'REFERENCE_RESOLUTION',predicate:'PRODUCT_REFERENCE_RESOLUTION',value:{outcome:'UNIQUE_CANDIDATE',referenceType:'focus',productId:'p',focusBasis:'focus',authoritative:true},lineage:'DERIVED',sources}),ctx),'INVALID_VALUE');
});

test('historical text requires a different turn and trusted raw binding', () => {
  const src={sourceType:'HISTORICAL_TURN_TEXT',sourceTurnId:OLD_TURN,locators:[whole()]};
  valid(one(observation({sources:[src]}),context({rawTextBindings:[{sourceType:'HISTORICAL_TURN_TEXT',sourceTurnId:OLD_TURN,rawText:'old'}]})));
  rejected(one(observation({sources:[{...src,sourceTurnId:TURN}]}),context()),'INVALID_SOURCE');
});
test('raw UTF-16 ranges validate exact boundaries including astral text', () => {
  const raw='a😀b';
  const ctx=context({rawTextBindings:[{sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,rawText:raw}]});
  const source={sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,locators:[{locatorType:'TEXT_RANGE',coordinateSpace:'RAW_SOURCE_TEXT',start:1,end:3}]};
  valid(one(observation({sources:[source]}),ctx));
  valid(one(observation({sources:[{...source,locators:[{...source.locators[0],start:3,end:4}]}]}),ctx));
  rejected(one(observation({sources:[{...source,locators:[{...source.locators[0],end:5}]}]}),ctx),'INVALID_LOCATOR');
  rejected(one(observation({sources:[{...source,locators:[{...source.locators[0],coordinateSpace:'NORMALIZED_TEXT'}]}]}),ctx),'INVALID_LOCATOR');
});
test('empty ranges and numeric -0 are rejected', () => {
  const loc={locatorType:'TEXT_RANGE',coordinateSpace:'RAW_SOURCE_TEXT',start:0,end:1};
  rejected(one(observation({sources:[{sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,locators:[{...loc,end:0}]}]})),'INVALID_LOCATOR');
  rejected(one(observation({sources:[{sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,locators:[{...loc,start:-0}]}]})),'INVALID_LOCATOR');
});
test('duplicate locators and WHOLE_SOURCE coexistence reject', () => {
  const src={sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,locators:[whole(),whole()]};
  rejected(one(observation({sources:[src]})),'INVALID_LOCATOR');
  src.locators=[whole(),{locatorType:'TEXT_RANGE',coordinateSpace:'RAW_SOURCE_TEXT',start:0,end:1}];
  rejected(one(observation({sources:[src]})),'INVALID_LOCATOR');
});
test('malformed locator containers fail closed for single observations', () => {
  for (const locators of [null, {}, 'x', 1]) {
    const result = one(observation({sources:[{sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,locators}]}));
    rejected(result,'INVALID_LOCATOR');
    assert.doesNotMatch(JSON.stringify(result),/\"x\"/);
  }
});
test('malformed locator containers fail closed in graph validation', () => {
  for (const locators of [null, {}, 'x', 1]) {
    graphRejected(graph([observation({sources:[{sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,locators}]})]),'INVALID_LOCATOR');
  }
});
test('adjacent and overlapping distinct ranges are accepted', () => {
  const ranges=[[0,2],[2,4],[1,3]].map(([start,end])=>({locatorType:'TEXT_RANGE',coordinateSpace:'RAW_SOURCE_TEXT',start,end}));
  valid(one(observation({sources:[{sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,locators:ranges}]}),context({rawTextBindings:[{sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,rawText:'abcd'}]})));
});
test('duplicate sources reject independent of locator order', () => {
  const a={sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,locators:[{locatorType:'TEXT_RANGE',coordinateSpace:'RAW_SOURCE_TEXT',start:0,end:1},{locatorType:'TEXT_RANGE',coordinateSpace:'RAW_SOURCE_TEXT',start:1,end:2}]};
  const b=clone(a); b.locators.reverse();
  rejected(one(observation({sources:[a,b]}),context({rawTextBindings:[{sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,rawText:'ab'}]})),'INVALID_SOURCE');
});

const structuredCases=[
  ['PRODUCT_FOCUS_CONTEXT','focus',{locatorType:'PRODUCT_ID',productId:'focus'}],
  ['PRODUCT_SELECTION_CONTEXT','selected',{locatorType:'PRODUCT_ID',productId:'selected'}],
  ['PRODUCT_CONTEXT_STATUS','resolved',{locatorType:'CONTEXT_STATUS'}],
  ['DISPLAYED_PRODUCT_SEQUENCE',['one','two'],{locatorType:'SEQUENCE_ITEM',position:1,productId:'two'}],
  ['PRODUCT_CANDIDATE_COLLECTION',['one','two'],{locatorType:'COLLECTION_ITEM',productId:'one'}]
];
for(const [kind,value,locator] of structuredCases)test(`structured context ${kind} validates`,()=>{
  const src={sourceType:'STRUCTURED_CONVERSATION_CONTEXT',sourceTurnId:TURN,contextKind:kind,locators:[locator]};
  valid(one(observation({producer:{namespace:'CUSTOMER_GOAL_INTERPRETER',version:1},predicate:'CUSTOMER_GOAL',value:'find_product',lineage:'DERIVED',sources:[src]}),context({structuredContextBindings:[{sourceTurnId:TURN,contextKind:kind,value}]})));
});
test('displayed sequence position and product must agree',()=>{
  const src={sourceType:'STRUCTURED_CONVERSATION_CONTEXT',sourceTurnId:TURN,contextKind:'DISPLAYED_PRODUCT_SEQUENCE',locators:[{locatorType:'SEQUENCE_ITEM',position:1,productId:'one'}]};
  rejected(one(observation({producer:{namespace:'CUSTOMER_GOAL_INTERPRETER',version:1},predicate:'CUSTOMER_GOAL',value:'find_product',lineage:'DERIVED',sources:[src]}),context({structuredContextBindings:[{sourceTurnId:TURN,contextKind:'DISPLAYED_PRODUCT_SEQUENCE',value:['one','two']}]})),'INVALID_LOCATOR');
});
test('structured locator kind allowlist is closed',()=>{
  const src={sourceType:'STRUCTURED_CONVERSATION_CONTEXT',sourceTurnId:TURN,contextKind:'PRODUCT_CONTEXT_STATUS',locators:[{locatorType:'PRODUCT_ID',productId:'x'}]};
  rejected(one(observation({producer:{namespace:'CUSTOMER_GOAL_INTERPRETER',version:1},predicate:'CUSTOMER_GOAL',value:'find_product',lineage:'DERIVED',sources:[src]}),context({structuredContextBindings:[{sourceTurnId:TURN,contextKind:'PRODUCT_CONTEXT_STATUS',value:'resolved'}]})),'INVALID_LOCATOR');
});

test('persisted attributed and unattributed sources validate exact bindings',()=>{
  const attributed={sourceType:'PERSISTED_TURN_REPRESENTATION',sourceTurnId:OLD_TURN,representationKind:'CONVERSATION_QUESTION',representationReference:REP,locators:[whole()]};
  const ctx=context({representationBindings:[{representationReference:REP,representationKind:'CONVERSATION_QUESTION',sourceTurnId:OLD_TURN}]});
  valid(one(observation({producer:{namespace:'PERSISTED_PRODUCT_RECOVERY',version:1},predicate:'PRODUCT_RECOVERY_STATUS',value:'resolved',lineage:'RECOVERY',sources:[attributed]}),ctx));
  const unattributed={sourceType:'PERSISTED_UNATTRIBUTED_REPRESENTATION',representationKind:'CONVERSATION_ANSWER',representationReference:REP,locators:[whole()]};
  valid(one(observation({producer:{namespace:'PERSISTED_PRODUCT_RECOVERY',version:1},predicate:'PRODUCT_RECOVERY_STATUS',value:'resolved',lineage:'RECOVERY',sources:[unattributed]}),context({representationBindings:[{representationReference:REP,representationKind:'CONVERSATION_ANSWER',sourceTurnId:null}]})));
});
test('unbound, mismatched, legacy bounded prose, and sourceTurn on unattributed fail',()=>{
  const base={sourceType:'PERSISTED_UNATTRIBUTED_REPRESENTATION',representationKind:'CONVERSATION_ANSWER',representationReference:REP,locators:[whole()]};
  const obs=(source)=>observation({producer:{namespace:'PERSISTED_PRODUCT_RECOVERY',version:1},predicate:'PRODUCT_RECOVERY_STATUS',value:'resolved',lineage:'RECOVERY',sources:[source]});
  rejected(one(obs(base)), 'MISSING_TRUSTED_CONTEXT');
  rejected(one(obs({...base,representationKind:'BOUNDED_PERSISTED_PROSE'}),context({representationBindings:[{representationReference:REP,representationKind:'CONVERSATION_ANSWER',sourceTurnId:null}]})),'INVALID_SOURCE');
  rejected(one(obs({...base,sourceTurnId:OLD_TURN}),context({representationBindings:[{representationReference:REP,representationKind:'CONVERSATION_ANSWER',sourceTurnId:null}]})),'UNKNOWN_PROPERTY');
});
test('persisted TEXT_RANGE requires matching raw representation binding',()=>{
  const src={sourceType:'PERSISTED_UNATTRIBUTED_REPRESENTATION',representationKind:'CONVERSATION_ANSWER',representationReference:REP,locators:[{locatorType:'TEXT_RANGE',coordinateSpace:'RAW_SOURCE_TEXT',start:0,end:3}]};
  const obs=observation({producer:{namespace:'PERSISTED_PRODUCT_RECOVERY',version:1},predicate:'PRODUCT_RECOVERY_STATUS',value:'resolved',lineage:'RECOVERY',sources:[src]});
  const base={representationBindings:[{representationReference:REP,representationKind:'CONVERSATION_ANSWER',sourceTurnId:null}]};
  rejected(one(obs,context(base)),'MISSING_TRUSTED_CONTEXT');
  valid(one(obs,context({...base,rawTextBindings:[{sourceType:'PERSISTED_UNATTRIBUTED_REPRESENTATION',representationReference:REP,rawText:'abc'}]})));
});

function externalContext(relations=[{sourceProductId:'a',relationType:'soap',targetProductId:'b'}],sourceReference='product-relations:v1'){
  return context({externalReferenceBindings:[{referenceKind:'PRODUCT_RELATION_REGISTRY',sourceReference,relations}]});
}
function externalObservation(locator=whole(),sourceReference='product-relations:v1'){
  return observation({producer:{namespace:'PRODUCT_REFERENCE_RESOLVER',version:1},evidenceKind:'REFERENCE_RESOLUTION',predicate:'PRODUCT_REFERENCE_RESOLUTION',value:{outcome:'UNIQUE_CANDIDATE',referenceType:'companion',productId:'b',relationType:'soap'},lineage:'DERIVED',sources:[{sourceType:'EXTERNAL_REFERENCE_DATA',referenceKind:'PRODUCT_RELATION_REGISTRY',sourceReference,locators:[locator]}]});
}
test('external whole registry and exact relation tuple validate',()=>{
  valid(one(externalObservation(),externalContext()));
  valid(one(externalObservation({locatorType:'PRODUCT_RELATION',sourceProductId:'a',relationType:'soap',targetProductId:'b'}),externalContext()));
});
test('external missing tuple, binding, duplicate binding and bad grammar fail closed',()=>{
  rejected(one(externalObservation({locatorType:'PRODUCT_RELATION',sourceProductId:'a',relationType:'cream',targetProductId:'b'}),externalContext()),'INVALID_LOCATOR');
  rejected(one(externalObservation(),context()),'MISSING_TRUSTED_CONTEXT');
  const binding=externalContext().externalReferenceBindings[0];
  rejected(one(externalObservation(),externalContext().externalReferenceBindings ? context({externalReferenceBindings:[binding,clone(binding)]}) : context()),'INVALID_TRUSTED_CONTEXT');
  rejected(one(externalObservation(whole(),'PRODUCT-RELATIONS:v1'),externalContext()),'INVALID_SOURCE');
});
test('duplicate external relation tuples reject trusted context',()=>{
  const relation={sourceProductId:'a',relationType:'soap',targetProductId:'b'};
  rejected(one(externalObservation(),externalContext([relation,clone(relation)])),'INVALID_TRUSTED_CONTEXT');
});

test('DIRECT forbids dependencies',()=>rejected(one(observation({dependencies:[uuid(1)]}),context({historicalObservations:[{observationReference:uuid(1),conversationId:'conversation-0001',dependencies:[]}]})),'INVALID_DEPENDENCY'));
test('DERIVED with no dependency requires structured context',()=>{
  rejected(one(observation({producer:{namespace:'CUSTOMER_GOAL_INTERPRETER',version:1},predicate:'CUSTOMER_GOAL',value:'find_product',lineage:'DERIVED'})),'INVALID_LINEAGE');
});
test('single observation resolves historical dependency',()=>{
  const dep=uuid(1),src={sourceType:'STRUCTURED_CONVERSATION_CONTEXT',sourceTurnId:TURN,contextKind:'PRODUCT_CONTEXT_STATUS',locators:[whole()]};
  const obs=observation({producer:{namespace:'CUSTOMER_GOAL_INTERPRETER',version:1},predicate:'CUSTOMER_GOAL',value:'find_product',lineage:'DERIVED',sources:[src],dependencies:[dep]});
  valid(one(obs,context({structuredContextBindings:[{sourceTurnId:TURN,contextKind:'PRODUCT_CONTEXT_STATUS',value:'resolved'}],historicalObservations:[{observationReference:dep,conversationId:'conversation-0001',dependencies:[]}]})));
});
test('missing historical dependency fails graph validation',()=>{
  const src={sourceType:'STRUCTURED_CONVERSATION_CONTEXT',sourceTurnId:TURN,contextKind:'PRODUCT_CONTEXT_STATUS',locators:[whole()]};
  const obs=observation({producer:{namespace:'CUSTOMER_GOAL_INTERPRETER',version:1},predicate:'CUSTOMER_GOAL',value:'find_product',lineage:'DERIVED',sources:[src],dependencies:[uuid(1)]});
  rejected(one(obs,context({structuredContextBindings:[{sourceTurnId:TURN,contextKind:'PRODUCT_CONTEXT_STATUS',value:'resolved'}]})),'INVALID_GRAPH');
});
test('graph accepts forward submitted dependency',()=>{
  const dep=observation({observationReference:uuid(2)});
  const src={sourceType:'STRUCTURED_CONVERSATION_CONTEXT',sourceTurnId:TURN,contextKind:'PRODUCT_CONTEXT_STATUS',locators:[whole()]};
  const derived=observation({observationReference:uuid(1),producer:{namespace:'CUSTOMER_GOAL_INTERPRETER',version:1},predicate:'CUSTOMER_GOAL',value:'find_product',lineage:'DERIVED',sources:[src],dependencies:[uuid(2)]});
  const result=valid(graph([derived,dep],context({structuredContextBindings:[{sourceTurnId:TURN,contextKind:'PRODUCT_CONTEXT_STATUS',value:'resolved'}]})));
  assert.deepEqual(result.observations.map(x=>x.observationReference),[uuid(1),uuid(2)]);
});
test('duplicate dependency and self-reference reject',()=>{
  rejected(one(observation({dependencies:[uuid(1),uuid(1)]})),'INVALID_DEPENDENCY');
  rejected(one(observation({dependencies:[OBS]})),'INVALID_DEPENDENCY');
});
test('malformed submitted dependencies fail closed in graph validation',()=>{
  for(const dependencies of [{},null,'x',1,true]) {
    const result=graph([observation({dependencies})]);
    graphRejected(result,'INVALID_DEPENDENCY');
    assert.doesNotMatch(JSON.stringify(result),/\"x\"/);
  }
});
test('malformed historical dependencies fail closed in graph validation',()=>{
  for(const dependencies of [{},null,'x',1,true]) {
    const historicalObservations=[{observationReference:uuid(1),conversationId:'conversation-0001',dependencies}];
    graphRejected(graph([observation()],context({historicalObservations})),'INVALID_TRUSTED_CONTEXT');
  }
});
test('duplicate observation reference and cross-conversation reject graph',()=>{
  graphRejected(graph([observation({observationReference:uuid(1)}),observation({observationReference:uuid(1)})]),'INVALID_GRAPH');
  graphRejected(graph([observation({observationReference:uuid(1)}),observation({observationReference:uuid(2),correlation:correlation({conversationId:'conversation-0002'})})]),'INVALID_GRAPH');
});
test('submitted cycle and combined historical cycle reject',()=>{
  const src={sourceType:'STRUCTURED_CONVERSATION_CONTEXT',sourceTurnId:TURN,contextKind:'PRODUCT_CONTEXT_STATUS',locators:[whole()]};
  const ctx=context({structuredContextBindings:[{sourceTurnId:TURN,contextKind:'PRODUCT_CONTEXT_STATUS',value:'resolved'}]});
  const make=(id,dep)=>observation({observationReference:id,producer:{namespace:'CUSTOMER_GOAL_INTERPRETER',version:1},predicate:'CUSTOMER_GOAL',value:'find_product',lineage:'DERIVED',sources:[src],dependencies:[dep]});
  graphRejected(graph([make(uuid(1),uuid(2)),make(uuid(2),uuid(1))],ctx),'INVALID_GRAPH');
  graphRejected(graph([make(uuid(1),uuid(2))],context({...ctx,historicalObservations:[{observationReference:uuid(2),conversationId:'conversation-0001',dependencies:[uuid(1)]}]})),'INVALID_GRAPH');
});

test('source, locator, and dependency exact maxima validate',()=>{
  const rawTextBindings=[],sources=[];
  for(let i=1;i<=8;i++){const turn=uuid(100+i);rawTextBindings.push({sourceType:'HISTORICAL_TURN_TEXT',sourceTurnId:turn,rawText:'x'.repeat(32)});sources.push({sourceType:'HISTORICAL_TURN_TEXT',sourceTurnId:turn,locators:Array.from({length:32},(_,j)=>({locatorType:'TEXT_RANGE',coordinateSpace:'RAW_SOURCE_TEXT',start:j,end:j+1}))});}
  valid(one(observation({sources}),context({rawTextBindings})));
});
test('one above source and locator limits gets resource precedence',()=>{
  const bad=observation({observationVersion:2,sources:Array.from({length:9},()=>({}))}); rejected(one(bad),'RESOURCE_LIMIT_EXCEEDED');
  const source={sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,locators:Array.from({length:33},()=>({}))}; rejected(one(observation({sources:[source]})),'RESOURCE_LIMIT_EXCEEDED');
});
test('dependency 33 and graph 65 reject as resources',()=>{
  rejected(one(observation({dependencies:Array.from({length:33},(_,i)=>uuid(i+1))})),'RESOURCE_LIMIT_EXCEEDED');
  graphRejected(graph(Array.from({length:65},(_,i)=>observation({observationReference:uuid(i+1)}))),'RESOURCE_LIMIT_EXCEEDED');
});
test('raw text 16384 accepted and 16385 rejected',()=>{
  valid(one(observation(),context({rawTextBindings:[{sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,rawText:'x'.repeat(16384)}]})));
  rejected(one(observation(),context({rawTextBindings:[{sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,rawText:'x'.repeat(16385)}]})),'RESOURCE_LIMIT_EXCEEDED');
});
test('structured and external collection over-limits reject resources',()=>{
  const structured=context({structuredContextBindings:[{sourceTurnId:TURN,contextKind:'DISPLAYED_PRODUCT_SEQUENCE',value:Array.from({length:65},(_,i)=>`p${i}`)}]});
  rejected(one(observation(),structured),'RESOURCE_LIMIT_EXCEEDED');
  const relations=Array.from({length:257},(_,i)=>({sourceProductId:`s${i}`,relationType:'soap',targetProductId:`t${i}`}));
  rejected(one(externalObservation(),externalContext(relations)),'RESOURCE_LIMIT_EXCEEDED');
});
test('33-key object rejects as resource before unknown-property semantics',()=>{
  const value=observation(); for(let i=0;i<23;i++)value[`x${i}`]=i; rejected(one(value),'RESOURCE_LIMIT_EXCEEDED');
});
test('depth 17 rejects as resource',()=>{
  let nested={}; for(let i=0;i<17;i++)nested={x:nested}; const input={observation:observation(),validationContext:context(),extra:nested};
  rejected(contract.validateSemanticEvidenceObservation(input),'RESOURCE_LIMIT_EXCEEDED');
});
test('aggregate string budget rejects deterministically',()=>{
  const rawTextBindings=Array.from({length:65},(_,i)=>({sourceType:'HISTORICAL_TURN_TEXT',sourceTurnId:uuid(1000+i),rawText:'x'.repeat(16384)}));
  const input={observation:observation(),validationContext:context({rawTextBindings})};
  const first=contract.validateSemanticEvidenceObservation(input),second=contract.validateSemanticEvidenceObservation(input);
  rejected(first,'RESOURCE_LIMIT_EXCEEDED');assert.deepEqual(second,first);
});
test('captured node budget rejects',()=>{
  const block=Array.from({length:512},()=>0); const huge=Array.from({length:400},()=>block);
  rejected(contract.validateSemanticEvidenceObservation({observation:observation(),validationContext:context(),extra:huge}),'RESOURCE_LIMIT_EXCEEDED');
});

test('getters and setters are not invoked',()=>{
  let calls=0; const value={observation:observation(),validationContext:context()}; Object.defineProperty(value,'evil',{enumerable:true,get(){calls++;throw new Error('getter');}});
  rejected(contract.validateSemanticEvidenceObservation(value),'INVALID_INPUT');assert.equal(calls,0);
  const setter={observation:observation(),validationContext:context()};Object.defineProperty(setter,'evil',{enumerable:true,set(){calls++;}});
  rejected(contract.validateSemanticEvidenceObservation(setter),'INVALID_INPUT');assert.equal(calls,0);
});
test('revoked and throwing proxies fail closed',()=>{
  const {proxy,revoke}=Proxy.revocable({},{});revoke();rejected(contract.validateSemanticEvidenceObservation(proxy),'INVALID_INPUT');
  const throwing=new Proxy({}, {ownKeys(){throw new Error('trap');}});rejected(contract.validateSemanticEvidenceObservation(throwing),'INVALID_INPUT');
});
test('unsupported JavaScript values fail closed',()=>{
  for(const value of [new Date(),new Map(),new Set(),new Uint8Array(),()=>{},1n,Symbol('x')]) rejected(contract.validateSemanticEvidenceObservation(value),'INVALID_INPUT');
});
test('custom prototype, sparse arrays, cycles, NaN and infinities fail closed',()=>{
  rejected(contract.validateSemanticEvidenceObservation(Object.create({x:1})),'INVALID_INPUT');
  const sparse=[];sparse.length=2;rejected(contract.validateSemanticEvidenceObservation(sparse),'INVALID_INPUT');
  const cyclic={};cyclic.self=cyclic;rejected(contract.validateSemanticEvidenceObservation(cyclic),'INVALID_INPUT');
  for(const value of [NaN,Infinity,-Infinity]){const input=observation({value});rejected(one(input),'INVALID_INPUT');}
});
test('malformed graph and lineage collections fail closed',()=>{
  graphRejected(contract.validateSemanticEvidenceObservationGraph({observations:{},validationContext:context()}),'INVALID_INPUT');
  rejected(one(observation({lineage:'DERIVED',sources:{},dependencies:[]})),'INVALID_LINEAGE');
  rejected(one(observation({lineage:'RECOVERY',sources:{}})),'INVALID_LINEAGE');
});
test('caller data is not mutated and order is preserved',()=>{
  const input=observation({sources:[{sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,locators:[{locatorType:'TEXT_RANGE',coordinateSpace:'RAW_SOURCE_TEXT',start:1,end:2},{locatorType:'TEXT_RANGE',coordinateSpace:'RAW_SOURCE_TEXT',start:0,end:1}]}]});
  const before=clone(input);const out=valid(one(input,context({rawTextBindings:[{sourceType:'CURRENT_TURN_TEXT',sourceTurnId:TURN,rawText:'ab'}]}))).observation;
  assert.deepEqual(input,before);assert.deepEqual(out.sources[0].locators,before.sources[0].locators);
});
test('missing and malformed trusted context are distinct',()=>{
  rejected(contract.validateSemanticEvidenceObservation({observation:observation(),validationContext:null}),'MISSING_TRUSTED_CONTEXT');
  rejected(contract.validateSemanticEvidenceObservation({observation:observation(),validationContext:{}}),'INVALID_TRUSTED_CONTEXT');
});
test('module imports only dormant correlation contract and contains no forbidden capability',()=>{
  const source=fs.readFileSync(path.join(__dirname,'engine','conversation-decision-semantic-evidence-observation.cjs'),'utf8');
  const imports=[...source.matchAll(/require\((['"])(.*?)\1\)/g)].map(match=>match[2]);
  assert.deepEqual(imports,['./conversation-decision-correlation-contract.cjs']);
  assert.doesNotMatch(source,/process\.env|Date\.now|Math\.random|randomUUID|node:fs|node:https/i);
});
test('authority fields and canonical evidenceId are rejected',()=>{
  for(const [target,key] of [['root','authoritative'],['root','evidenceId']]){const value=observation();value[key]=true;rejected(one(value),'UNKNOWN_PROPERTY');}
  const value=observation();value.value={outcome:'UNIQUE_CANDIDATE',referenceType:'variant',productId:'p',authoritative:true};value.producer={namespace:'PRODUCT_REFERENCE_RESOLVER',version:1};value.evidenceKind='REFERENCE_RESOLUTION';value.predicate='PRODUCT_REFERENCE_RESOLUTION';value.lineage='DERIVED';value.sources=[{sourceType:'STRUCTURED_CONVERSATION_CONTEXT',sourceTurnId:TURN,contextKind:'PRODUCT_FOCUS_CONTEXT',locators:[whole()]}];
  rejected(one(value,context({structuredContextBindings:[{sourceTurnId:TURN,contextKind:'PRODUCT_FOCUS_CONTEXT',value:'p'}]})),'INVALID_VALUE');
});

console.log(`PASS TEST_CONVERSATION_DECISION_SEMANTIC_EVIDENCE_OBSERVATION_R4A2I (${count} cases)`);
