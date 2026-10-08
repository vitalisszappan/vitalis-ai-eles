'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildMarkdown, buildReview } = require('./scripts/generate-unas-product-review.cjs');

const ROOT = __dirname;
const read = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
const normalizeLineEndings = (value) => String(value).replace(/\r\n/g, '\n');
// The live snapshot is intentionally ignored and may be absent or newer than
// the committed historical review. Generator regression coverage must not
// depend on a developer machine's current UNAS sync state.
const snapshot = read('test/fixtures/knowledge-builder-catalog.json');
const mapping = read('data/canonical-unas-mapping.json');
const knowledge = read('data/knowledge.json');
const rules = read('data/rules/expert-rules.json');
const committedReview = read('data/unas-product-review.json');
const input = { snapshot, mapping, knowledge, rules };
const first = buildReview(input);
const second = buildReview(input);

assert.deepStrictEqual(first, second, 'A generálás nem determinisztikus.');
assert.equal(
  crypto.createHash('sha256').update(JSON.stringify(first)).digest('hex'),
  '09a0d835853fdfa2d2aa4f69793815447e41316121478a35799887da09856650',
  'A fix katalógusfixture review-kimenete megváltozott.'
);
assert.equal(first.records.length, snapshot.products.length);
assert.equal(first.summary.total, snapshot.products.length);

const snapshotIds = snapshot.products.map((product) => String(product.unasId)).sort();
const reviewIds = first.records.map((record) => record.unasId).sort();
assert.deepStrictEqual(reviewIds, snapshotIds, 'Nem minden snapshot-termék szerepel pontosan egyszer.');
assert.equal(new Set(reviewIds).size, reviewIds.length, 'Duplikált UNAS ID van a review-ban.');

const approvedMappings = mapping.mappings.filter((item) => item.mappingStatus === 'approved');
assert.equal(approvedMappings.length, 46);
for (const approved of approvedMappings) {
  const record = first.records.find((item) => item.unasId === String(approved.unasId));
  if (!record) continue;
  assert.equal(record.reviewStatus, 'approved_mapped');
  assert.equal(record.canonicalCandidate, approved.canonicalId);
  assert.equal(record.confidence, 'exact');
}
assert.equal(first.summary.approved_mapped, 13);
assert.ok(first.summary.topNewProductCandidateIds.length <= 20);
for (const unasId of first.summary.topNewProductCandidateIds) {
  assert.equal(first.records.find((record) => record.unasId === unasId).reviewStatus, 'new_product_candidate');
}

const charcoalCanonical = mapping.mappings.find((item) => item.canonicalId === 'aktiv_szenes_szappan');
assert.equal(charcoalCanonical.mappingStatus, 'needs_review');
assert.equal(charcoalCanonical.unasId, undefined);
const charcoalShampoo = first.records.find((item) => item.unasId === '1467818511');
assert.equal(charcoalShampoo.reviewStatus, 'approved_mapped');
assert.equal(charcoalShampoo.canonicalCandidate, 'teafa_aktiv_szen_samponszappan');
assert.equal(charcoalShampoo.confidence, 'exact');

for (const record of first.records) {
  assert.ok(record.reason && record.reason.trim(), `Hiányzó indoklás: ${record.unasId}`);
  if (record.confidence === 'weak') assert.notEqual(record.reviewStatus, 'approved_mapped');
  if (record.reviewStatus === 'approved_mapped') assert.equal(record.confidence, 'exact');
}

const markdown = buildMarkdown(first);
assert.ok(markdown.includes('## Aktív szenes audit'));
assert.equal(first.generation.automaticMappingCreated, false);
assert.equal(first.generation.fuzzyMatchingUsedForApproval, false);

// The committed review remains an internally consistent historical audit
// artifact for its declared source snapshot; it is not regenerated from an
// unrelated ignored live snapshot during tests.
assert.equal(committedReview.summary.total, committedReview.records.length);
assert.equal(committedReview.sourceSnapshotProductCount, committedReview.records.length);
assert.equal(new Set(committedReview.records.map((record) => record.unasId)).size, committedReview.records.length);
assert.equal(
  normalizeLineEndings(fs.readFileSync(path.join(ROOT, 'UNAS_PRODUCT_REVIEW.md'), 'utf8')),
  normalizeLineEndings(buildMarkdown(committedReview))
);

console.log('TEST_UNAS_PRODUCT_REVIEW: minden ellenőrzés sikeres');
