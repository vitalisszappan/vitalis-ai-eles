'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contractPath = path.join(__dirname, 'engine/conversation-decision-semantic-proposal-contract.cjs');
const { PROPOSAL_VERSION, PROPOSAL_DISPOSITIONS, PROPOSAL_FIELD_PATHS, validateSemanticProposal: validate } = require(contractPath);
const envelope = require('./engine/conversation-decision-envelope-schema.cjs');
const transition = require('./engine/conversation-decision-transition-schema.cjs');
const policy = require('./engine/conversation-decision-field-policy.cjs');

let count = 0;
function test(name, fn) { try { fn(); count++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
function proposal(fieldPath = 'resolved.concernContext', value = 'psoriasis') {
  return {
    proposalVersion: 1, proposalId: 'proposal-1', conversationId: 'conversation-1', turnId: 'turn-1',
    producerId: 'fixture:canonical-producer', fieldPath, disposition: 'SET', value,
    provenance: { sourceType: 'USER_EXPLICIT', evidenceId: 'user-1', sourceTurnId: 'turn-1' },
    evidenceIds: ['user-1'], evidence: [{ evidenceId: 'user-1', sourceType: 'USER_EXPLICIT', fieldPath,
      sourceTurnId: 'turn-1', sourceReference: 'fixture:conversation-1/turn-1/input' }]
  };
}
function diagnostic(sourceType = 'USER_EXPLICIT') {
  const p = proposal('resolved.productFocus');
  delete p.value;
  p.disposition = 'UNRESOLVED';
  p.referenceResolutionStatus = 'unresolved';
  p.provenance.sourceType = p.evidence[0].sourceType = sourceType;
  if (sourceType !== 'USER_EXPLICIT') p.provenance.sourceTurnId = p.evidence[0].sourceTurnId = null;
  return p;
}
function derived(field = 'resolved.concernContext', value = 'psoriasis') {
  const p = proposal(field, value);
  const evidence = { evidenceId: 'derived-1', sourceType: 'PROBLEM_DOMAIN_DECISION', fieldPath: field,
    sourceTurnId: 'turn-1', sourceReference: 'fixture:problem-result-1', producerId: 'fixture:problem-producer',
    supportEvidenceIds: ['user-1'] };
  p.evidence.push(evidence);
  p.evidenceIds = ['derived-1'];
  p.provenance = { sourceType: evidence.sourceType, evidenceId: evidence.evidenceId, sourceTurnId: evidence.sourceTurnId };
  return p;
}
function product(field = 'resolved.productFocus') {
  const p = proposal(field, field === 'resolved.productFocus' ? 'fixture-product-A' : [{ value: 'fixture-product-A', evidenceIds: ['resolution-1'] }]);
  p.evidence.push(
    { evidenceId: 'identity-1', sourceType: 'APPROVED_PRODUCT_FACT', fieldPath: field, sourceTurnId: null,
      sourceReference: 'fixture:canonical-product-definition/A', productId: 'fixture-product-A' },
    { evidenceId: 'resolution-1', sourceType: 'CANONICAL_RESOLUTION', fieldPath: field, sourceTurnId: 'turn-1',
      sourceReference: 'fixture:resolution-result-1', productId: 'fixture-product-A', producerId: 'fixture:semantic-producer',
      resolverId: 'fixture:identity-resolver', supportEvidenceIds: ['user-1', 'identity-1'] }
  );
  p.evidenceIds = ['resolution-1'];
  p.provenance = { sourceType: 'CANONICAL_RESOLUTION', evidenceId: 'resolution-1', sourceTurnId: 'turn-1' };
  p.referenceResolutionStatus = 'resolved';
  p.productResolutions = [{ productId: 'fixture-product-A', status: 'resolved', resolverId: 'fixture:identity-resolver',
    sourceReference: 'fixture:resolution-result-1', evidenceIds: ['resolution-1'], identityEvidenceId: 'identity-1' }];
  return p;
}
function conflict() {
  const p = proposal('resolved.applicationArea');
  delete p.value;
  p.disposition = 'CONFLICT';
  p.evidence.push({ ...p.evidence[0], evidenceId: 'user-2', sourceReference: 'fixture:conversation-1/turn-1/second-assertion' });
  p.candidates = [{ value: 'scalp', evidenceIds: ['user-1'] }, { value: 'neck', evidenceIds: ['user-2'] }];
  return p;
}
function clear() {
  const p = proposal('resolved.applicationArea');
  delete p.value;
  p.disposition = 'CLEAR';
  p.evidence[0].disposition = 'CLEAR';
  return p;
}
function good(p, admissible = true) { assert.deepEqual(validate(p), { valid: true, admissible, errors: [] }); }
function bad(p, fragment) {
  const result = validate(p);
  assert.equal(result.valid, false, 'expected invalid proposal');
  assert.equal(result.admissible, false);
  assert.deepEqual(Object.keys(result).sort(), ['admissible', 'errors', 'valid']);
  assert.ok(result.errors.length > 0);
  if (fragment) assert.ok(result.errors.some((error) => error.includes(fragment)), result.errors.join('\n'));
}
function changed(name, make, mutation, fragment) { test(name, () => { const p = make(); mutation(p); bad(p, fragment); }); }

test('exact exports and vocabulary', () => {
  assert.equal(PROPOSAL_VERSION, 1);
  assert.deepEqual(PROPOSAL_DISPOSITIONS, ['SET', 'CLEAR', 'UNRESOLVED', 'CONFLICT']);
  assert.deepEqual(Object.keys(require(contractPath)).sort(), ['PROPOSAL_DISPOSITIONS', 'PROPOSAL_FIELD_PATHS', 'PROPOSAL_VERSION', 'validateSemanticProposal'].sort());
  assert.deepEqual(PROPOSAL_FIELD_PATHS, ['resolved.concernContext', 'resolved.applicationArea', 'resolved.requestedProductType',
    'resolved.productFocus', 'resolved.referencedProducts', 'explicit.concerns', 'explicit.applicationAreas', 'explicit.products',
    'explicit.goal', 'explicit.qualifiers', 'derived.ownershipState']);
  assert.ok(Object.isFrozen(PROPOSAL_DISPOSITIONS) && Object.isFrozen(PROPOSAL_FIELD_PATHS));
  for (const field of PROPOSAL_FIELD_PATHS) assert.ok(envelope.CLOSED_FIELD_PATHS.includes(field) && transition.TRANSITION_FIELD_PATHS.includes(field));
});
for (const value of envelope.CONCERNS) test(`canonical concern ${value}`, () => good(proposal('resolved.concernContext', value)));
for (const value of envelope.PRODUCT_TYPE_VALUES) test(`canonical product type ${value}`, () => good(proposal('resolved.requestedProductType', value)));
for (const value of envelope.APPLICATION_AREA_VALUES.filter((area) => area !== 'unknown')) test(`canonical area ${value}`, () => good(proposal('resolved.applicationArea', value)));
for (const [field, value] of [['resolved.requestedProductType', 'cream'], ['resolved.requestedProductType', 'balm'],
  ['resolved.concernContext', 'dry_skin'], ['resolved.applicationArea', 'unknown'], ['resolved.applicationArea', 'psoriasis'],
  ['resolved.concernContext', 'scalp'], ['resolved.requestedProductType', ' shampoo']]) {
  test(`reject noncanonical ${field}/${value}`, () => bad(proposal(field, value)));
}
test('three independent proposals; no synthesized fields or events', () => {
  for (const [field, value] of [['resolved.concernContext', 'psoriasis'], ['resolved.applicationArea', 'scalp'], ['resolved.requestedProductType', 'shampoo']]) {
    const p = proposal(field, value), before = JSON.stringify(p);
    good(p);
    assert.equal(JSON.stringify(p), before);
    assert.deepEqual(Object.keys(validate(p)).sort(), ['admissible', 'errors', 'valid']);
  }
});
test('dry stays a qualifier', () => good(proposal('explicit.qualifiers', [{ key: 'dry', value: true, evidenceIds: ['user-1'] }])));
for (const value of [false, 'mild', 0, 1.5]) test(`JSON qualifier scalar ${value}`, () => good(proposal('explicit.qualifiers', [{ key: 'severity', value, evidenceIds: ['user-1'] }])));
for (const value of ['true', null, {}, [], 1]) test(`invalid dry qualifier ${JSON.stringify(value)}`, () => bad(proposal('explicit.qualifiers', [{ key: 'dry', value, evidenceIds: ['user-1'] }])));
test('duplicate qualifier keys', () => bad(proposal('explicit.qualifiers', [1, 2].map(() => ({ key: 'dry', value: true, evidenceIds: ['user-1'] })))));
test('unknown qualifier key', () => bad(proposal('explicit.qualifiers', [{ key: 'invented', value: true, evidenceIds: ['user-1'] }])));
for (const [field, value] of [['explicit.concerns', 'psoriasis'], ['explicit.applicationAreas', 'neck'], ['explicit.goal', 'selection']]) {
  test(`explicit list ${field}`, () => good(proposal(field, [{ value, evidenceIds: ['user-1'] }])));
  test(`empty list ${field}`, () => bad(proposal(field, [])));
  test(`duplicate list ${field}`, () => bad(proposal(field, [1, 2].map(() => ({ value, evidenceIds: ['user-1'] })))));
}
test('neutral ownership after historical safety: current evidence only', () => good(derived('derived.ownershipState', 'NEUTRAL_PRODUCT_FACT')));
test('fresh explicit evidence accepted without current state access', () => good(proposal('resolved.applicationArea', 'neck')));
for (const source of ['LEGACY_TEXT_RECOVERY', 'ASSISTANT_OUTPUT_RECOVERY', 'UNKNOWN']) {
  changed(`${source} SET forbidden`, proposal, (p) => { p.provenance.sourceType = p.evidence[0].sourceType = source; });
  test(`${source} unresolved observation`, () => good(diagnostic(source), false));
  changed(`${source} cannot hide under canonical derivation`, derived, (p) => { p.evidence[0].sourceType = source; p.evidence[0].sourceTurnId = null; });
}
test('unresolved other; no candidate selection', () => good(diagnostic(), false));
test('vague referent remains diagnostic', () => { const p = diagnostic(); p.evidence[0].sourceText = 'I want to try it'; good(p, false); });
test('recovery candidate may remain an unverified diagnostic string', () => {
  const p = diagnostic('LEGACY_TEXT_RECOVERY'); p.candidates = [{ value: 'unverified-product', evidenceIds: ['user-1'] }]; good(p, false);
});
for (const field of ['resolved.productFocus', 'explicit.products', 'resolved.referencedProducts']) {
  test(`complete product proof ${field}`, () => good(product(field)));
  test(`bare product ${field}`, () => bad(proposal(field, field === 'resolved.productFocus' ? 'unknown-product' : [{ value: 'unknown-product', evidenceIds: ['user-1'] }])));
}
test('valid conflict is admissible but returns no winner/state/authorization', () => {
  const p = conflict(), before = JSON.stringify(p); good(p); assert.equal(JSON.stringify(p), before);
  assert.deepEqual(Object.keys(validate(p)).sort(), ['admissible', 'errors', 'valid']);
});
changed('duplicate conflict candidates', conflict, (p) => { p.candidates[1].value = 'scalp'; });
changed('insufficient conflict candidates', conflict, (p) => { p.candidates.pop(); });
changed('noncanonical conflict candidate', conflict, (p) => { p.candidates[1].value = 'unknown'; });
changed('candidate missing evidence', conflict, (p) => { delete p.candidates[1].evidenceIds; });
changed('candidate cannot include a winner flag', conflict, (p) => { p.candidates[0].winner = true; });
changed('structured conflicts rejected', conflict, (p) => { p.fieldPath = 'explicit.concerns'; p.evidence.forEach((e) => { e.fieldPath = p.fieldPath; }); });
test('explicit current removal', () => good(clear()));
changed('CLEAR cannot merely lack value', clear, (p) => { delete p.evidence[0].disposition; });
changed('CLEAR current user only', clear, (p) => { p.provenance.sourceTurnId = p.evidence[0].sourceTurnId = 'old-turn'; });
changed('CLEAR recovery forbidden', clear, (p) => { p.provenance.sourceType = p.evidence[0].sourceType = 'LEGACY_TEXT_RECOVERY'; });
changed('CLEAR rejects null value', clear, (p) => { p.value = null; });
changed('CLEAR rejects candidates', clear, (p) => { p.candidates = []; });
changed('SET missing value is not clear', proposal, (p) => { delete p.value; });
changed('SET null is not clear', proposal, (p) => { p.value = null; });
changed('SET rejects candidate side channel', proposal, (p) => { p.candidates = []; });
changed('UNRESOLVED cannot establish value', diagnostic, (p) => { p.value = 'fixture-product-A'; });
test('greeting caller emits zero proposals; no validator call needed', () => { const proposals = []; assert.equal(proposals.map(validate).length, 0); bad({}); bad([]); });
for (const value of [null, undefined, true, 1, 'psoriasis', [{ fieldPath: 'resolved.concernContext' }]]) test(`invalid top-level ${String(value)}`, () => bad(value));
for (const key of ['fields', 'batch', 'sequence', 'resolved', 'eventId', 'baseEnvelopeVersion', 'baseStateVersion', 'stateVersion', 'envelope', 'authorized', 'extra']) {
  changed(`reject execution/unknown property ${key}`, proposal, (p) => { p[key] = 'not-allowed'; }, 'unknown property');
}
for (const disposition of ['NO_CHANGE', 'NO_DECISION', 'UNSET', 'INVALIDATE', 'INVALID']) changed(`reject ${disposition}`, proposal, (p) => { p.disposition = disposition; });
for (const field of ['governance.authorizationStatus', 'resolved.problemDomain', 'input.rawText', 'constructor', 'not.a.field']) {
  test(`unsupported ${field}`, () => bad(proposal(field)));
}
for (const key of ['proposalVersion', 'proposalId', 'conversationId', 'turnId', 'producerId', 'evidence', 'evidenceIds', 'provenance']) changed(`missing ${key}`, proposal, (p) => { delete p[key]; });
changed('bad schema version', proposal, (p) => { p.proposalVersion = 2; });
changed('dangling root', proposal, (p) => { p.evidenceIds.push('absent'); });
changed('duplicate root', proposal, (p) => { p.evidenceIds.push('user-1'); });
changed('duplicate evidence record', proposal, (p) => { p.evidence.push({ ...p.evidence[0] }); });
changed('unused evidence record', proposal, (p) => { p.evidence.push({ ...p.evidence[0], evidenceId: 'unused' }); });
changed('field evidence mismatch', proposal, (p) => { p.evidence[0].fieldPath = 'resolved.applicationArea'; });
changed('source mismatch', proposal, (p) => { p.provenance.sourceType = 'CANONICAL_RESOLUTION'; });
changed('turn mismatch', proposal, (p) => { p.provenance.sourceTurnId = 'old-turn'; });
changed('primary must be root', derived, (p) => { p.evidenceIds = ['user-1']; });
changed('current user cannot have null turn', proposal, (p) => { p.evidence[0].sourceTurnId = p.provenance.sourceTurnId = null; });
changed('old user turn cannot be relabeled current explicit', proposal, (p) => { p.evidence[0].sourceTurnId = p.provenance.sourceTurnId = 'old-turn'; });
changed('missing source reference', proposal, (p) => { p.evidence[0].sourceReference = ''; });
changed('nested unknown evidence key', proposal, (p) => { p.evidence[0].authoritative = true; });
changed('nested unknown provenance key', proposal, (p) => { p.provenance.rank = 1; });
test('derived evidence closure', () => good(derived()));
changed('missing derived producer', derived, (p) => { delete p.evidence[1].producerId; });
changed('missing derived support', derived, (p) => { delete p.evidence[1].supportEvidenceIds; });
changed('dangling support', derived, (p) => { p.evidence[1].supportEvidenceIds = ['missing']; });
changed('cycle', derived, (p) => { p.evidence[1].supportEvidenceIds.push('derived-1'); });
changed('derived null cannot erase known user turn', derived, (p) => { p.evidence[1].sourceTurnId = p.provenance.sourceTurnId = null; });
test('known historical derived turn is preserved', () => {
  const p = derived(); p.evidence[0].sourceType = 'APPROVED_PRODUCT_FACT'; p.evidence[0].sourceTurnId = null;
  p.evidence[1].sourceTurnId = p.provenance.sourceTurnId = 'known-old-turn'; good(p);
});
test('external derivation can honestly have no turn', () => {
  const p = derived(); p.evidence[0].sourceType = 'APPROVED_PRODUCT_FACT'; p.evidence[0].sourceTurnId = null;
  p.evidence[1].sourceTurnId = p.provenance.sourceTurnId = null; good(p);
});
changed('approved fact cannot establish concern directly', proposal, (p) => { p.evidence[0].sourceType = p.provenance.sourceType = 'APPROVED_PRODUCT_FACT'; });
for (const key of ['productId', 'resolverId', 'sourceReference']) changed(`product proof ${key} mismatch`, product, (p) => { p.productResolutions[0][key] = 'mismatch'; });
changed('missing identity evidence ID', product, (p) => { delete p.productResolutions[0].identityEvidenceId; });
changed('identity product mismatch', product, (p) => { p.evidence[1].productId = 'different-product'; });
changed('missing resolution resolver ID', product, (p) => { delete p.evidence[2].resolverId; });
changed('unresolved proof cannot establish product', product, (p) => { p.productResolutions[0].status = 'unresolved'; });
changed('duplicate product proof', product, (p) => { p.productResolutions.push({ ...p.productResolutions[0] }); });
changed('unresolved reference cannot establish focus', product, (p) => { p.referenceResolutionStatus = 'ambiguous'; });
changed('arbitrary authority flag rejected', product, (p) => { p.productResolutions[0].authoritative = true; });
changed('recovery proof cannot be laundered', product, (p) => { p.evidence[1].sourceType = 'ASSISTANT_OUTPUT_RECOVERY'; });
changed('user claim is not canonical identity backing', product, (p) => {
  p.evidence[1].sourceType = 'USER_EXPLICIT'; p.evidence[1].sourceTurnId = p.turnId;
});
changed('identity backing must support resolution, not merely be bundled', product, (p) => { p.evidence[2].supportEvidenceIds = ['user-1']; });
changed('self-attestation cannot replace identity backing', product, (p) => { p.productResolutions[0].identityEvidenceId = 'resolution-1'; });
test('product scalar conflict requires proof for each known ID', () => {
  const p = product(), second = product();
  delete p.value; p.disposition = 'CONFLICT'; p.referenceResolutionStatus = 'ambiguous';
  for (const record of second.evidence) {
    record.evidenceId += '-B';
    if (record.productId) record.productId = 'fixture-product-B';
    if (record.supportEvidenceIds) record.supportEvidenceIds = record.supportEvidenceIds.map((id) => `${id}-B`);
  }
  p.evidence.push(...second.evidence);
  p.candidates = [{ value: 'fixture-product-A', evidenceIds: ['resolution-1'] }, { value: 'fixture-product-B', evidenceIds: ['resolution-1-B'] }];
  p.productResolutions.push({ ...second.productResolutions[0], productId: 'fixture-product-B', evidenceIds: ['resolution-1-B'], identityEvidenceId: 'identity-1-B' });
  good(p);
  p.productResolutions.pop(); bad(p, 'missing product proof');
});
test('transitive derived support closes', () => {
  const p = derived();
  p.evidence.push({ ...p.evidence[1], evidenceId: 'derived-2', sourceReference: 'fixture:second-result', supportEvidenceIds: ['derived-1'] });
  p.evidenceIds = ['derived-2']; p.provenance.evidenceId = 'derived-2'; good(p);
});
changed('transitive dependency cycle rejected', derived, (p) => {
  p.evidence[1].supportEvidenceIds = ['derived-2'];
  p.evidence.push({ ...p.evidence[1], evidenceId: 'derived-2', supportEvidenceIds: ['derived-1', 'user-1'] });
});
test('optional actual rule identity is preserved', () => { const p = derived(); p.evidence[1].ruleId = 'fixture:rule-1'; good(p); });
changed('empty optional rule ID rejected', derived, (p) => { p.evidence[1].ruleId = ''; });
test('dangling list evidence rejected', () => bad(proposal('explicit.concerns', [{ value: 'psoriasis', evidenceIds: ['missing'] }])));
test('duplicate nested evidence IDs rejected', () => bad(proposal('explicit.concerns', [{ value: 'psoriasis', evidenceIds: ['user-1', 'user-1'] }])));
test('source span exact bounds', () => { const p = proposal(); p.evidence[0].sourceText = 'abc'; p.evidence[0].sourceSpan = { start: 0, end: 3 }; good(p); });
for (const span of [{ start: -1, end: 2 }, { start: 1, end: 0 }, { start: 0, end: 4 }, { start: 0.5, end: 1 }, { start: 0, end: 1, extra: true }]) {
  changed(`invalid source span ${JSON.stringify(span)}`, proposal, (p) => { p.evidence[0].sourceText = 'abc'; p.evidence[0].sourceSpan = span; });
}
changed('span requires supplied text', proposal, (p) => { p.evidence[0].sourceSpan = { start: 0, end: 1 }; });
test('non-JSON data rejected without getters executing', () => {
  const p = proposal(); Object.defineProperty(p, 'trap', { enumerable: true, get() { throw new Error('must not execute'); } }); bad(p, 'plain JSON');
  for (const value of [NaN, Infinity, undefined, () => {}, 1n, new Date(0)]) { const q = proposal(); q.value = value; bad(q); }
  const cycle = proposal(); cycle.loop = cycle; bad(cycle);
  const sparse = proposal(); sparse.evidenceIds = new Array(2); bad(sparse);
  const symbol = proposal(); symbol[Symbol('hidden')] = true; bad(symbol);
  const custom = Object.create({ hidden: true }); Object.assign(custom, proposal()); bad(custom);
});
test('frozen inputs deterministic and fresh results', () => {
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  for (const p of [product(), conflict(), diagnostic('UNKNOWN')]) {
    const before = JSON.stringify(p); freeze(p);
    const a = validate(p), b = validate(p); assert.deepEqual(a, b); assert.notEqual(a, b); assert.notEqual(a.errors, b.errors);
    assert.equal(JSON.stringify(p), before); a.errors.push('caller mutation'); assert.ok(!validate(p).errors.includes('caller mutation'));
  }
});
test('error order independent of unknown property insertion order', () => {
  const a = proposal(), b = proposal(); a.z = 1; a.a = 2; b.a = 2; b.z = 1; assert.deepEqual(validate(a), validate(b));
});
test('only dormant schema/policy dependencies; no I/O or runtime initialization', () => {
  const source = fs.readFileSync(contractPath, 'utf8');
  const allowed = { './conversation-decision-envelope-schema.cjs': envelope,
    './conversation-decision-transition-schema.cjs': transition, './conversation-decision-field-policy.cjs': policy };
  const calls = [];
  const sandbox = { module: { exports: {} }, require(name) { assert.ok(Object.hasOwn(allowed, name), name); calls.push(name); return allowed[name]; } };
  vm.runInNewContext(source, sandbox, { filename: contractPath });
  assert.deepEqual(calls.sort(), Object.keys(allowed).sort());
  assert.equal(/\b(?:process|fetch|Date|Math\.random|randomUUID|setTimeout)\b/.test(source), false);
  // Cross-realm objects are intentionally not accepted; create fixtures inside the module realm.
  const encoded = JSON.stringify(proposal());
  assert.equal(vm.runInNewContext(`module.exports.validateSemanticProposal(${encoded}).valid`, sandbox), true);
  for (const file of ['server.cjs', 'engine/answer-service.cjs', 'engine/answer-router.cjs', 'engine/conversation-memory.cjs']) {
    assert.equal(fs.readFileSync(path.join(__dirname, file), 'utf8').includes('conversation-decision-semantic-proposal-contract'), false, file);
  }
});

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function preserved(p) {
  const before = JSON.stringify(p);
  freeze(p);
  assert.doesNotThrow(() => good(p));
  assert.equal(JSON.stringify(p), before);
  assert.deepEqual(validate(p), { valid: true, admissible: true, errors: [] });
}
function twoProducts(field = 'explicit.products') {
  const p = product(field), second = product(field);
  for (const record of second.evidence) {
    record.evidenceId += '-B';
    if (record.productId) record.productId = 'fixture-product-B';
    if (record.supportEvidenceIds) record.supportEvidenceIds = record.supportEvidenceIds.map((id) => `${id}-B`);
  }
  p.evidence.push(...second.evidence);
  p.productResolutions.push({ ...second.productResolutions[0], productId: 'fixture-product-B',
    evidenceIds: ['resolution-1-B'], identityEvidenceId: 'identity-1-B' });
  p.value.push({ value: 'fixture-product-B', evidenceIds: ['resolution-1-B'] });
  return p;
}
const attacks = [
  ['focus crosswired to B with separate A proof', () => {
    const p = product();
    p.evidence.push({ ...p.evidence[2], evidenceId: 'resolution-B', productId: 'fixture-product-B' });
    p.evidenceIds = ['resolution-B']; p.provenance.evidenceId = 'resolution-B';
    return p;
  }, 'product value evidence'],
  ['two product entries swapped', () => {
    const p = twoProducts();
    [p.value[0].evidenceIds, p.value[1].evidenceIds] = [p.value[1].evidenceIds, p.value[0].evidenceIds];
    return p;
  }, 'product value evidence'],
  ['forbidden concern evidence masked by user root', () => {
    const p = proposal('explicit.concerns', [{ value: 'psoriasis', evidenceIds: ['fact'] }]);
    p.evidence.push({ ...p.evidence[0], evidenceId: 'fact', sourceType: 'APPROVED_PRODUCT_FACT', sourceTurnId: null });
    return p;
  }, 'forbidden direct establishing'],
  ['forbidden conflict candidate masked by user root', () => {
    const p = conflict(); p.evidence[1].sourceType = 'APPROVED_PRODUCT_FACT'; p.evidence[1].sourceTurnId = null;
    return p;
  }, 'forbidden direct establishing'],
  ['SET established by removal', () => {
    const p = proposal(); p.evidence[0].disposition = 'CLEAR'; return p;
  }, 'removal evidence cannot establish']
];
for (const [name, make, fragment] of attacks) test(`T1 attack: ${name}`, () => bad(make(), fragment));
test('T1 bound scalar product', () => preserved(product()));
changed('T1 extra crosswired resolution evidence', twoProducts, (p) => {
  p.productResolutions[0].evidenceIds.push('resolution-1-B');
}, 'product value evidence');
test('T1 product conflict binding', () => {
  const p = twoProducts('resolved.referencedProducts');
  p.fieldPath = 'resolved.productFocus'; p.evidence.forEach((record) => { record.fieldPath = p.fieldPath; });
  p.candidates = p.value; delete p.value; p.disposition = 'CONFLICT'; p.referenceResolutionStatus = 'ambiguous';
  good(p);
  [p.candidates[0].evidenceIds, p.candidates[1].evidenceIds] = [p.candidates[1].evidenceIds, p.candidates[0].evidenceIds];
  bad(p, 'product value evidence');
});
for (const field of ['explicit.products', 'resolved.referencedProducts']) {
  test(`T1 bound two products ${field}`, () => preserved(twoProducts(field)));
  changed(`T1 swapped ${field}`, () => twoProducts(field), (p) => {
    [p.value[0].evidenceIds, p.value[1].evidenceIds] = [p.value[1].evidenceIds, p.value[0].evidenceIds];
  }, 'product value evidence');
}
test('T1 permitted direct derivation with supporting product fact', () => {
  const p = derived('explicit.concerns', [{ value: 'psoriasis', evidenceIds: ['derived-1'] }]);
  p.evidence[0].sourceType = 'APPROVED_PRODUCT_FACT'; p.evidence[0].sourceTurnId = null;
  preserved(p);
});
test('T1 independently permitted conflict candidates', () => preserved(conflict()));
test('T1 genuine removal', () => preserved(clear()));
changed('T1 removal list entry', () => proposal('explicit.concerns', [{ value: 'psoriasis', evidenceIds: ['user-2'] }]), (p) => {
  p.evidence.push({ ...p.evidence[0], evidenceId: 'user-2', disposition: 'CLEAR' });
}, 'removal evidence cannot establish');
changed('T1 removal conflict candidate', conflict, (p) => { p.evidence[1].disposition = 'CLEAR'; }, 'removal evidence cannot establish');
test('T1 neck preservation', () => preserved(proposal('resolved.applicationArea', 'neck')));
test('T1 dry qualifier preservation', () => preserved(proposal('explicit.qualifiers', [{ key: 'dry', value: true, evidenceIds: ['user-1'] }])));
for (const source of ['LEGACY_TEXT_RECOVERY', 'ASSISTANT_OUTPUT_RECOVERY', 'UNKNOWN']) {
  for (const disposition of ['SET', 'CONFLICT']) test(`T1 deep ${source} ${disposition}`, () => {
    const p = derived();
    p.evidence[0].sourceType = source; p.evidence[0].sourceTurnId = null;
    p.evidence.push({ ...p.evidence[1], evidenceId: 'derived-2', supportEvidenceIds: ['derived-1'] });
    p.evidenceIds = ['derived-2']; p.provenance.evidenceId = 'derived-2';
    if (disposition === 'CONFLICT') {
      delete p.value; p.disposition = disposition;
      p.candidates = [{ value: 'psoriasis', evidenceIds: ['derived-2'] }, { value: 'eczema', evidenceIds: ['derived-1'] }];
    }
    bad(freeze(p), 'recovery/unknown support');
  });
}
test('T1 frozen unsorted multi-element IDs', () => {
  const p = conflict(); p.evidenceIds = ['user-2', 'user-1'];
  p.candidates[0].evidenceIds = ['user-2', 'user-1']; preserved(p);
});
for (const disposition of ['NO_CHANGE', 'INVALIDATE', 'NO_DECISION']) test(`T1 isolated ${disposition}`, () => {
  const p = diagnostic(); good(p, false); p.disposition = disposition;
  assert.deepEqual(validate(freeze(p)), { valid: false, admissible: false,
    errors: ['proposal.disposition: unsupported disposition'] });
});
test('T1 diamond and shared-support DAG', () => {
  const p = derived();
  p.evidence.push({ ...p.evidence[1], evidenceId: 'branch', supportEvidenceIds: ['user-1'] },
    { ...p.evidence[1], evidenceId: 'top', supportEvidenceIds: ['branch', 'derived-1'] });
  p.evidenceIds = ['top', 'branch']; p.provenance.evidenceId = 'top'; preserved(p);
});
changed('T1 unreachable cycle', derived, (p) => {
  p.evidence.push({ ...p.evidence[1], evidenceId: 'cycle-a', supportEvidenceIds: ['cycle-b'] },
    { ...p.evidence[1], evidenceId: 'cycle-b', supportEvidenceIds: ['cycle-a'] });
}, 'dependency cycle');
test('T1 frozen invalid deterministic result', () => {
  const p = proposal(); p.extra = true; freeze(p); const before = JSON.stringify(p);
  bad(p, 'unknown property'); assert.deepEqual(validate(p), validate(p)); assert.equal(JSON.stringify(p), before);
});
for (const value of [new Map(), new Set()]) test(`T1 reject ${value.constructor.name}`, () => {
  const p = proposal(); p.value = value; bad(p, 'plain JSON');
});
for (const [name, make, nested] of [
  ['list entry', () => proposal('explicit.concerns', [{ value: 'psoriasis', evidenceIds: ['user-1'] }]), (p) => p.value[0]],
  ['qualifier', () => proposal('explicit.qualifiers', [{ key: 'dry', value: true, evidenceIds: ['user-1'] }]), (p) => p.value[0]],
  ['candidate', conflict, (p) => p.candidates[0]], ['proof', product, (p) => p.productResolutions[0]],
  ['span', () => { const p = proposal(); p.evidence[0].sourceText = 'x'; p.evidence[0].sourceSpan = { start: 0, end: 1 }; return p; }, (p) => p.evidence[0].sourceSpan]
]) changed(`T1 unknown nested ${name}`, make, (p) => { nested(p).extra = true; }, 'unknown property');

console.log(`PASS: ${count} canonical semantic proposal contract tests`);
