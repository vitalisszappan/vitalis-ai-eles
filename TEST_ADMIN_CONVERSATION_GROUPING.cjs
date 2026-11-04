'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, 'public', 'admin.js'), 'utf8');
const block = /\/\/ BEGIN CONVERSATION GROUPING\r?\n([\s\S]*?)\/\/ END CONVERSATION GROUPING/.exec(source);
assert.ok(block, 'grouping block missing from public/admin.js');
const {
  groupConversations,
  matchesSearch,
  conversationStatistics,
  deleteTarget
} = new Function(`${block[1]}\nreturn VitalisAdminConversations;`)();

const rows = [
  { session_id: 'session-A', question: 'A kérdés A1', answer: 'Válasz A1', created_at: '2026-11-03T08:00:00.000Z' },
  { session_id: 'session-B', question: 'A kérdés B1', answer: 'Válasz B1', created_at: '2026-11-03T08:01:00.000Z' },
  { session_id: 'session-A', question: 'Különleges keresett kérdés A2', answer: 'Válasz A2', created_at: '2026-11-03T08:02:00.000Z' },
  { session_id: 'session-A', question: 'A kérdés A3', answer: 'Válasz A3', created_at: '2026-11-03T08:03:00.000Z' }
];

const groups = groupConversations(rows);
assert.equal(groups.length, 2);
const sessionA = groups.find((group) => group.sessionId === 'session-A');
assert.equal(sessionA.turns.length, 3);
assert.deepEqual(sessionA.turns.map(({ row }) => row.question), [
  'A kérdés A1',
  'Különleges keresett kérdés A2',
  'A kérdés A3'
]);
assert.equal(matchesSearch(sessionA, 'különleges keresett'), true);
const searchResults = groups.filter((group) => matchesSearch(group, 'különleges keresett'));
assert.equal(searchResults.length, 1);
assert.equal(searchResults[0].turns.length, 3);
assert.equal(deleteTarget(sessionA), 'session-A');
assert.equal(groups.filter((group) => deleteTarget(group) === 'session-A').length, 1);

const legacyGroups = groupConversations([
  { question: 'Örökölt kérdés 1', answer: 'Válasz 1', created_at: '2026-11-03T09:00:00.000Z' },
  { question: 'Örökölt kérdés 2', answer: 'Válasz 2', created_at: '2026-11-03T09:01:00.000Z' }
]);
assert.equal(legacyGroups.length, 2);
assert.notEqual(legacyGroups[0].key, legacyGroups[1].key);
assert.equal(deleteTarget(legacyGroups[0]), null);

const stats = conversationStatistics(groups, searchResults, (timestamp) => timestamp.startsWith('2026-11-03'));
assert.deepEqual(stats, { total: 2, today: 2, visible: 1 });

console.log('TEST_ADMIN_CONVERSATION_GROUPING: PASS (2 sessions, 3-turn search, session deletion, legacy isolation, session stats)');
