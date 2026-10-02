'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const producerPath = path.join(__dirname, 'engine', 'conversation-decision-semantic-proposal-producer.cjs');
const producer = require(producerPath);
const { validateSemanticProposal, PROPOSAL_FIELD_PATHS } = require('./engine/conversation-decision-semantic-proposal-contract.cjs');

let count = 0;
function test(name, fn) { try { fn(); count++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
function clone(value) { return structuredClone(value); }
function proposal(fieldPath = 'resolved.concernContext', value = 'psoriasis') {
  return {
    proposalVersion: 1, proposalId: 'proposal-1', conversationId: 'conversation-1', turnId: 'turn-1',
    producerId: 'fixture:producer', fieldPath, disposition: 'SET', value,
    provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'user-1', sourceTurnId: 'turn-1' },
    evidenceIds: ['user-1'], evidence: [{ evidenceId: 'user-1', sourceType: 'USER_EXPLICIT', fieldPath,
      sourceTurnId: 'turn-1', sourceReference: 'fixture:conversation-1/turn-1/input' }]
  };
}
function inputFromProposal(p = proposal()) {
  const { proposalVersion, proposalId, conversationId, turnId, producerId, ...fact } = p;
  assert.equal(proposalVersion, 1);
  return { proposalId, conversationId, turnId, producerId, fact };
}
function produce(p = proposal()) { return producer.produceSemanticProposal(inputFromProposal(p)); }
function good(p = proposal(), status = 'PRODUCED') {
  const output = produce(p);
  assert.equal(output.status, status);
  assert.deepEqual(validateSemanticProposal(output.proposal), {
    valid: true, admissible: status === 'PRODUCED', errors: []
  });
  return output;
}
function rejected(p, fragment) {
  const output = produce(p);
  assert.equal(output.status, 'REJECTED'); assert.equal(output.reasonCode, 'INVALID_PROPOSAL');
  assert.equal(output.proposal, null); assert.ok(output.errors.length > 0);
  if (fragment) assert.ok(output.errors.some((error) => error.includes(fragment)), output.errors.join('\n'));
  return output;
}
function clear() {
  const p = proposal('resolved.applicationArea'); delete p.value; p.disposition = 'CLEAR'; p.evidence[0].disposition = 'CLEAR'; return p;
}
function conflict() {
  const p = proposal('resolved.applicationArea'); delete p.value; p.disposition = 'CONFLICT';
  p.evidence.push({ ...p.evidence[0], evidenceId: 'user-2', sourceReference: 'fixture:second-assertion' });
  p.candidates = [{ value: 'scalp', evidenceIds: ['user-1'] }, { value: 'neck', evidenceIds: ['user-2'] }]; return p;
}
function unresolved(sourceType = 'USER_EXPLICIT') {
  const p = proposal('resolved.productFocus'); delete p.value; p.disposition = 'UNRESOLVED'; p.referenceResolutionStatus = 'unresolved';
  p.provenance.sourceType = p.evidence[0].sourceType = sourceType;
  if (sourceType !== 'USER_EXPLICIT') p.provenance.sourceTurnId = p.evidence[0].sourceTurnId = null;
  return p;
}
function product(field = 'resolved.productFocus', suffix = 'A') {
  const id = `fixture-product-${suffix}`, userId = `user-${suffix}`, identityId = `identity-${suffix}`, resolutionId = `resolution-${suffix}`;
  const p = proposal(field, field === 'resolved.productFocus' ? id : [{ value: id, evidenceIds: [resolutionId] }]);
  p.proposalId = `proposal-${suffix}`;
  p.provenance = { sourceType: 'CANONICAL_RESOLUTION', evidenceId: resolutionId, sourceTurnId: 'turn-1' };
  p.evidenceIds = [resolutionId];
  p.evidence = [
    { evidenceId: userId, sourceType: 'USER_EXPLICIT', fieldPath: field, sourceTurnId: 'turn-1', sourceReference: `fixture:input/${suffix}` },
    { evidenceId: identityId, sourceType: 'APPROVED_PRODUCT_FACT', fieldPath: field, sourceTurnId: null,
      sourceReference: `fixture:identity/${suffix}`, productId: id },
    { evidenceId: resolutionId, sourceType: 'CANONICAL_RESOLUTION', fieldPath: field, sourceTurnId: 'turn-1',
      sourceReference: `fixture:resolution/${suffix}`, productId: id, producerId: 'fixture:resolver-producer',
      resolverId: 'fixture:identity-resolver', supportEvidenceIds: [userId, identityId] }
  ];
  p.referenceResolutionStatus = 'resolved';
  p.productResolutions = [{ productId: id, status: 'resolved', resolverId: 'fixture:identity-resolver',
    sourceReference: `fixture:resolution/${suffix}`, evidenceIds: [resolutionId], identityEvidenceId: identityId }];
  return p;
}
function productConflict() {
  const a = product('resolved.productFocus', 'A'), b = product('resolved.productFocus', 'B');
  a.disposition = 'CONFLICT'; delete a.value; a.referenceResolutionStatus = 'ambiguous';
  a.evidence.push(...b.evidence); a.candidates = [
    { value: 'fixture-product-A', evidenceIds: ['resolution-A'] },
    { value: 'fixture-product-B', evidenceIds: ['resolution-B'] }
  ];
  a.productResolutions.push(b.productResolutions[0]); return a;
}

test('exact exports and frozen vocabularies', () => {
  assert.deepEqual(Object.keys(producer).sort(), ['produceSemanticProposal', 'SEMANTIC_PROPOSAL_PRODUCER_VERSION', 'PRODUCTION_STATUSES', 'PRODUCTION_REASON_CODES'].sort());
  assert.equal(producer.SEMANTIC_PROPOSAL_PRODUCER_VERSION, 1);
  assert.deepEqual(producer.PRODUCTION_STATUSES, ['PRODUCED', 'UNRESOLVED', 'REJECTED']);
  assert.deepEqual(producer.PRODUCTION_REASON_CODES, ['INVALID_INPUT', 'INVALID_IDENTIFIERS', 'INVALID_ESTABLISHED_FACT', 'INVALID_PROPOSAL', 'UNRESOLVED_FACT']);
  assert.ok(Object.isFrozen(producer.PRODUCTION_STATUSES) && Object.isFrozen(producer.PRODUCTION_REASON_CODES));
});
test('stable result shapes', () => {
  for (const output of [good(), good(unresolved(), 'UNRESOLVED'), producer.produceSemanticProposal(null)]) {
    assert.deepEqual(Object.keys(output), ['status', 'reasonCode', 'proposal', 'errors']); assert.ok(Array.isArray(output.errors));
  }
});
test('unknown top-level key rejected', () => assert.equal(producer.produceSemanticProposal({ ...inputFromProposal(), routing: {} }).reasonCode, 'INVALID_INPUT'));
test('unknown fact key rejected', () => { const input = inputFromProposal(); input.fact.targetProductId = 'fixture-product-A'; assert.equal(producer.produceSemanticProposal(input).reasonCode, 'INVALID_ESTABLISHED_FACT'); });
test('missing fact key rejected without inferred disposition', () => { const input = inputFromProposal(); delete input.fact.disposition; assert.equal(producer.produceSemanticProposal(input).reasonCode, 'INVALID_ESTABLISHED_FACT'); });
test('identifier failures have stable reason', () => { for (const key of ['proposalId', 'conversationId', 'turnId', 'producerId']) { const input = inputFromProposal(); input[key] = ' '; assert.equal(producer.produceSemanticProposal(input).reasonCode, 'INVALID_IDENTIFIERS'); } });
test('caller identifiers are preserved exactly and never generated', () => { const p = proposal(); p.proposalId = 'caller-proposal'; p.conversationId = 'caller-conversation'; p.turnId = 'caller-turn'; p.producerId = 'caller:producer'; p.provenance.sourceTurnId = p.evidence[0].sourceTurnId = p.turnId; const output = good(p); assert.deepEqual([output.proposal.proposalId, output.proposal.conversationId, output.proposal.turnId, output.proposal.producerId], ['caller-proposal', 'caller-conversation', 'caller-turn', 'caller:producer']); });

const fieldFixtures = {
  'resolved.concernContext': () => proposal('resolved.concernContext', 'acne'),
  'resolved.applicationArea': () => proposal('resolved.applicationArea', 'neck'),
  'resolved.requestedProductType': () => proposal('resolved.requestedProductType', 'solid_shampoo'),
  'resolved.productFocus': () => product('resolved.productFocus'),
  'resolved.referencedProducts': () => product('resolved.referencedProducts'),
  'explicit.concerns': () => proposal('explicit.concerns', [{ value: 'eczema', evidenceIds: ['user-1'] }]),
  'explicit.applicationAreas': () => proposal('explicit.applicationAreas', [{ value: 'face', evidenceIds: ['user-1'] }]),
  'explicit.products': () => product('explicit.products'),
  'explicit.goal': () => proposal('explicit.goal', [{ value: 'selection', evidenceIds: ['user-1'] }]),
  'explicit.qualifiers': () => proposal('explicit.qualifiers', [{ key: 'dry', value: true, evidenceIds: ['user-1'] }]),
  'derived.ownershipState': () => { const p = proposal('derived.ownershipState', 'UNRESOLVED'); p.provenance.sourceType = p.evidence[0].sourceType = 'PROBLEM_DOMAIN_DECISION'; p.evidence[0].producerId = 'fixture:domain'; p.evidence[0].supportEvidenceIds = ['support-1']; p.evidence.push({ evidenceId: 'support-1', sourceType: 'USER_EXPLICIT', fieldPath: p.fieldPath, sourceTurnId: 'turn-1', sourceReference: 'fixture:input' }); return p; }
};
test('fixtures cover every canonical proposal field', () => assert.deepEqual(Object.keys(fieldFixtures), PROPOSAL_FIELD_PATHS));
for (const [field, make] of Object.entries(fieldFixtures)) test(`packages supported field ${field}`, () => { const output = good(make()); assert.equal(output.proposal.fieldPath, field); });

test('SET is explicitly preserved', () => assert.equal(good().proposal.disposition, 'SET'));
test('CLEAR is explicitly preserved', () => assert.equal(good(clear()).proposal.disposition, 'CLEAR'));
test('CONFLICT is explicitly preserved', () => assert.equal(good(conflict()).proposal.disposition, 'CONFLICT'));
test('UNRESOLVED remains non-authoritative and canonical-valid', () => { const output = good(unresolved(), 'UNRESOLVED'); assert.equal(output.reasonCode, 'UNRESOLVED_FACT'); assert.equal(output.proposal.disposition, 'UNRESOLVED'); assert.equal(output.proposal.value, undefined); });
test('candidate presence does not infer CONFLICT', () => { const p = proposal(); p.candidates = conflict().candidates; rejected(p, 'not allowed for SET'); });
test('ambiguity does not infer UNRESOLVED', () => { const p = proposal(); p.referenceResolutionStatus = 'ambiguous'; rejected(p); });
test('missing SET value does not become CLEAR', () => { const p = proposal(); delete p.value; rejected(p, 'SET requires a value'); });
test('null SET value does not become CLEAR', () => { const p = proposal(); p.value = null; rejected(p, 'SET requires a value'); });
test('CLEAR retains explicit current-turn removal requirement', () => { const p = clear(); delete p.evidence[0].disposition; rejected(p, 'removal evidence'); });
test('payload and evidence are preserved exactly', () => { const p = fieldFixtures['explicit.qualifiers'](), output = good(p); assert.deepEqual(output.proposal, p); });

test('valid product SET preserves complete proof', () => { const p = product(), output = good(p); assert.deepEqual(output.proposal.productResolutions, p.productResolutions); });
test('valid product CONFLICT preserves both proofs without winner', () => { const output = good(productConflict()); assert.equal(output.proposal.candidates.length, 2); assert.equal(output.proposal.productResolutions.length, 2); assert.equal('value' in output.proposal, false); });
test('product identity without proof rejected', () => rejected(proposal('resolved.productFocus', 'fixture-product-A'), 'product establishment requires proof'));
test('incomplete product proof rejected', () => { const p = product(); delete p.productResolutions[0].identityEvidenceId; rejected(p); });
test('user-only product claim rejected', () => rejected(proposal('explicit.products', [{ value: 'fixture-product-A', evidenceIds: ['user-1'] }]), 'product establishment requires proof'));
test('candidate object cannot be promoted to product focus', () => { const input = inputFromProposal(); input.fact.value = { targetProductId: 'fixture-product-A' }; assert.equal(producer.produceSemanticProposal(input).status, 'REJECTED'); });
test('routing target cannot enter closed fact', () => { const input = inputFromProposal(product()); input.fact.targetProductId = 'fixture-product-A'; assert.equal(producer.produceSemanticProposal(input).reasonCode, 'INVALID_ESTABLISHED_FACT'); });
test('page observation cannot enter closed fact', () => { const input = inputFromProposal(product()); input.fact.pageObservation = { productId: 'fixture-product-A' }; assert.equal(producer.produceSemanticProposal(input).reasonCode, 'INVALID_ESTABLISHED_FACT'); });

test('valid controlled vocabulary is byte-preserved', () => assert.equal(good(proposal('resolved.requestedProductType', 'shampoo_soap')).proposal.value, 'shampoo_soap'));
for (const value of ['body_lotion', 'facial_cream']) test(`unsupported ${value} is rejected without remapping`, () => { const output = rejected(proposal('resolved.requestedProductType', value)); assert.equal(output.proposal, null); });
test('unsupported concern is rejected without normalization', () => rejected(proposal('resolved.concernContext', 'dry_skin')));
test('dangling evidence rejected', () => { const p = proposal(); p.evidenceIds.push('missing'); rejected(p, 'dangling'); });
test('detached evidence rejected', () => { const p = proposal(); p.evidence.push({ ...p.evidence[0], evidenceId: 'unused' }); rejected(p, 'detached'); });
test('cyclic evidence rejected', () => { const p = proposal(); p.evidence[0].sourceType = p.provenance.sourceType = 'CANONICAL_RESOLUTION'; p.evidence[0].producerId = 'fixture:p'; p.evidence[0].resolverId = 'fixture:r'; p.evidence[0].supportEvidenceIds = ['user-1']; rejected(p, 'cycle'); });
test('unsupported source type rejected without upgrade', () => { const p = proposal(); p.provenance.sourceType = p.evidence[0].sourceType = 'PAGE'; rejected(p, 'invalid source'); });
for (const source of ['ASSISTANT_OUTPUT_RECOVERY', 'LEGACY_TEXT_RECOVERY', 'UNKNOWN']) {
  test(`${source} cannot establish authority`, () => { const p = proposal(); p.provenance.sourceType = p.evidence[0].sourceType = source; rejected(p); });
  test(`${source} remains diagnostic when supplied as such`, () => assert.equal(good(unresolved(source), 'UNRESOLVED').proposal.provenance.sourceType, source));
}
test('current-turn USER_EXPLICIT correlation enforced', () => { const p = proposal(); p.provenance.sourceTurnId = p.evidence[0].sourceTurnId = 'old-turn'; rejected(p, 'current turn'); });

for (const value of [null, undefined, true, 1, 'fact', [], () => {}, 1n, new Date(), new Map(), new Set(), new Uint8Array()]) {
  test(`hostile top-level ${Object.prototype.toString.call(value)}`, () => assert.equal(producer.produceSemanticProposal(value).status, 'REJECTED'));
}
test('top-level getter is rejected without invocation', () => { let calls = 0; const value = {}; Object.defineProperty(value, 'fact', { enumerable: true, get() { calls++; throw new Error('getter'); } }); assert.equal(producer.produceSemanticProposal(value).status, 'REJECTED'); assert.equal(calls, 0); });
test('nested getter is rejected without invocation', () => { let calls = 0; const value = inputFromProposal(); Object.defineProperty(value.fact, 'value', { enumerable: true, get() { calls++; return 'psoriasis'; } }); assert.equal(producer.produceSemanticProposal(value).status, 'REJECTED'); assert.equal(calls, 0); });
test('stateful getter is never invoked', () => { let calls = 0; const value = inputFromProposal(); Object.defineProperty(value.fact.evidence[0], 'sourceReference', { enumerable: true, get() { calls++; if (calls > 1) throw new Error('later'); return 'x'; } }); assert.equal(producer.produceSemanticProposal(value).status, 'REJECTED'); assert.equal(calls, 0); });
test('proxy get failure is caught', () => { const value = new Proxy(inputFromProposal(), { get() { throw new Error('get'); } }); assert.doesNotThrow(() => producer.produceSemanticProposal(value)); });
test('proxy ownKeys failure is caught', () => { const value = new Proxy(inputFromProposal(), { ownKeys() { throw new Error('keys'); } }); assert.equal(producer.produceSemanticProposal(value).status, 'REJECTED'); });
test('proxy descriptor failure is caught', () => { const value = new Proxy(inputFromProposal(), { getOwnPropertyDescriptor() { throw new Error('descriptor'); } }); assert.equal(producer.produceSemanticProposal(value).status, 'REJECTED'); });
test('cycle rejected', () => { const value = inputFromProposal(); value.fact.loop = value; assert.equal(producer.produceSemanticProposal(value).status, 'REJECTED'); });
test('symbol key rejected', () => { const value = inputFromProposal(); value[Symbol('x')] = true; assert.equal(producer.produceSemanticProposal(value).status, 'REJECTED'); });
test('sparse array rejected', () => { const value = inputFromProposal(); value.fact.evidence = new Array(2); value.fact.evidence[1] = proposal().evidence[0]; assert.equal(producer.produceSemanticProposal(value).status, 'REJECTED'); });
test('custom prototype rejected', () => { const value = inputFromProposal(); Object.setPrototypeOf(value.fact, { poisoned: true }); assert.equal(producer.produceSemanticProposal(value).status, 'REJECTED'); });
for (const value of [NaN, Infinity, -Infinity]) test(`nonfinite nested value ${value}`, () => { const input = inputFromProposal(fieldFixtures['explicit.qualifiers']()); input.fact.value[0].value = value; assert.equal(producer.produceSemanticProposal(input).status, 'REJECTED'); });
test('negative zero is handled deterministically without exception or coordinate semantics', () => { const p = proposal('explicit.qualifiers', [{ key: 'severity', value: -0, evidenceIds: ['user-1'] }]); const output = good(p); assert.ok(Object.is(output.proposal.value[0].value, -0)); });
test('poisoned product proof rejected without getter invocation', () => { let calls = 0; const input = inputFromProposal(product()); Object.defineProperty(input.fact.productResolutions[0], 'productId', { enumerable: true, get() { calls++; throw new Error('poison'); } }); assert.equal(producer.produceSemanticProposal(input).status, 'REJECTED'); assert.equal(calls, 0); });

test('input remains unchanged', () => { const input = inputFromProposal(product()), before = clone(input); producer.produceSemanticProposal(input); assert.deepEqual(input, before); });
test('returned proposal has no caller aliases', () => { const input = inputFromProposal(product()), output = producer.produceSemanticProposal(input); output.proposal.evidence[0].sourceReference = 'changed'; output.proposal.productResolutions[0].productId = 'changed'; assert.notEqual(input.fact.evidence[0].sourceReference, 'changed'); assert.notEqual(input.fact.productResolutions[0].productId, 'changed'); });
test('returned proposal mutation cannot affect later call', () => { const input = inputFromProposal(product()), first = producer.produceSemanticProposal(input); first.proposal.evidence.length = 0; const second = producer.produceSemanticProposal(input); assert.ok(second.proposal.evidence.length > 0); });
test('results and errors are fresh', () => { const a = producer.produceSemanticProposal(null), b = producer.produceSemanticProposal(null); assert.notEqual(a, b); assert.notEqual(a.errors, b.errors); a.errors.push('changed'); assert.equal(b.errors.includes('changed'), false); });
test('deeply equivalent inputs produce deeply equal fresh outputs', () => { const input = inputFromProposal(product()); const a = producer.produceSemanticProposal(input), b = producer.produceSemanticProposal(clone(input)); assert.deepEqual(a, b); assert.notEqual(a.proposal, b.proposal); });

test('producer imports only canonical proposal contract', () => {
  const source = fs.readFileSync(producerPath, 'utf8');
  assert.deepEqual([...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]), ['./conversation-decision-semantic-proposal-contract.cjs']);
});
test('source has no I/O clock randomness environment lookup authorization or downstream R4 coupling', () => {
  const source = fs.readFileSync(producerPath, 'utf8');
  assert.doesNotMatch(source, /\b(?:fs|http|https|net|fetch|XMLHttpRequest|process\.env|Date\.now|new Date|Math\.random|crypto|supabase|sql|jsonl)\b/i);
  assert.doesNotMatch(source, /answer-service|answer-router|answer-planner|conversation-memory|page-context|semantic-route-guard|semantic-guard-enforcement|product-catalog|product-search|product-facts|product-registry|recommendation-authorization|governance|proposal-adapter|transition-validator|decision-reducer|state-lifecycle|state-snapshot|turn-orchestrator/i);
});
test('no production/runtime module imports producer', () => {
  const target = 'conversation-decision-semantic-proposal-producer.cjs';
  const roots = fs.readdirSync(__dirname).filter((name) => /\.(?:cjs|js)$/.test(name) && !name.startsWith('TEST_'));
  const engines = fs.readdirSync(path.join(__dirname, 'engine')).filter((name) => /\.(?:cjs|js)$/.test(name) && name !== target).map((name) => `engine/${name}`);
  assert.deepEqual([...roots, ...engines].filter((name) => fs.readFileSync(path.join(__dirname, name), 'utf8').includes(target)), []);
});

console.log(`PASS TEST_CONVERSATION_DECISION_SEMANTIC_PROPOSAL_PRODUCER_R4A2G (${count} cases)`);
