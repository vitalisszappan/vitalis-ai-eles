'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('public/admin.html', 'utf8');
const css = fs.readFileSync('public/admin.css', 'utf8');
const js = fs.readFileSync('public/admin.js', 'utf8');

for (const view of ['overview', 'conversations', 'knowledge', 'system']) {
  assert.match(html, new RegExp(`data-admin-view-target="${view}"`), `Hiányzó admin nézet: ${view}`);
}

assert.match(html, /Betöltött beszélgetések/);
assert.doesNotMatch(html, /Összes beszélgetés/);
assert.match(html, /Beszélgetések megnyitása/);
assert.match(html, /Tudásfejlesztés megnyitása/);
assert.match(html, /Rendszer megnyitása/);
assert.match(html, /<details class="filter-panel"[\s\S]*?<nav id="knowledgeTaskFilters"/);
assert.match(html, /<details class="advanced-panel"[\s\S]*?id="knowledgeClusterList"/);
assert.match(html, /id="downloadUnasSnapshotButton"/);

for (const id of [
  'totalCount', 'todayCount', 'knowledgeGapCount', 'searchInput', 'statusMessage',
  'conversationList', 'knowledgeGapStatusMessage', 'knowledgeGapList',
  'knowledgeTaskFilters', 'knowledgeTaskStatus', 'knowledgeTaskList',
  'knowledgeClusterStatus', 'knowledgeClusterList', 'unasStatusMessage',
  'unasSyncStatusMessage', 'unasOrderPreflightButton', 'commerceOutcomeStatus',
  'revenueStatus', 'revenueTable'
]) {
  assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} nem pontosan egyszer szerepel`);
}

assert.match(css, /\.admin-view-hidden\s*\{/);
assert.match(css, /\.admin-view-group\s*\{/);
assert.match(css, /\.quick-entry-grid\s*\{/);
assert.match(css, /details\.conversation-card\s*\{/);
assert.match(js, /document\.createElement\('details'\)/);
assert.match(js, /setActiveAdminView\('overview'\)/);
assert.match(js, /organizeAdminViews\(\);[\s\S]*setActiveAdminView\('overview'\)/);
assert.match(js, /view === 'knowledge'[\s\S]*loadKnowledgeTasks\(\), loadKnowledgeClusters\(\)/);
assert.match(js, /view === 'system'[\s\S]*loadCommerceOutcomes\(\), loadRevenue\(\)/);

for (const eagerCall of ['loadKnowledgeTasks', 'loadKnowledgeClusters', 'loadCommerceOutcomes', 'loadRevenue']) {
  assert.doesNotMatch(js, new RegExp(`^${eagerCall}\\(\\);`, 'm'), `${eagerCall} nem futhat automatikusan induláskor`);
}

for (const endpoint of [
  '/api/admin/conversations?limit=500', '/api/admin/conversations/export',
  '/api/admin/knowledge-gaps?limit=500', '/api/admin/knowledge-gaps/approve',
  '/api/admin/knowledge-gaps/dismiss', '/api/admin/knowledge-tasks?limit=500',
  '/api/admin/knowledge-tasks/update', '/api/admin/knowledge-clusters',
  '/api/admin/knowledge-clusters/rebuild', '/api/admin/unas/permission-preflight',
  '/api/admin/unas/sync', '/api/admin/unas/snapshot',
  '/api/admin/commerce/unas-order-preflight', '/api/admin/commerce/outcomes?limit=100',
  '/api/admin/commerce/revenue/summary', '/api/admin/commerce/revenue/orders?limit=50'
]) {
  assert.ok(js.includes(endpoint), `Hiányzó admin endpoint: ${endpoint}`);
}

assert.match(js, /'X-Admin-Token':\s*adminToken/);
assert.match(js, /window\.confirm\([\s\S]*?azonnal aktiválod ezt a tudáselemet/);
assert.match(js, /window\.confirm\([\s\S]*?UNAS termék- és kategóriaadatok szinkronizálását/);
assert.match(js, /\/api\/admin\/knowledge-gaps\/approve'[\s\S]*?method:\s*'POST'/);
assert.match(js, /\/api\/admin\/unas\/sync'[\s\S]*?method:\s*'POST'/);

console.log('Admin Cleanup Phase 1 UI regresszió: PASS');
