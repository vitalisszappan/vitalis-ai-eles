'use strict';

const crypto = require('crypto');

const STATUSES = Object.freeze(['open', 'in_review', 'draft_ready', 'resolved', 'dismissed']);
const PRIORITY_RANK = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });
const SAFETY_RANK = Object.freeze({ standard: 0, caution: 1, high: 2 });
const STOP_WORDS = new Set(['a','az','egy','es','hogy','van','vagy','mit','milyen','hogyan','lehet','termek','termeket','kapcsolatban','kerdes','kerdeznek']);

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sortedUnique(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))].sort();
}

function domainFor(task) {
  const text = normalize([task.topic, task.productFamily, task.normalizedQuestionKey, task.question,
    task.classification, task.rootCause, task.repairTarget, task.detectedIntent].join(' '));
  const rules = [
    ['canonical_review', /canonical (not approved|needs review)|canonical_not_approved|outdated knowledge|needs review/],
    ['missing_product_data', /product data missing|product_data_missing|product missing|product_missing|hianyzo termekadat/],
    ['wrong_topic_answer', /wrong answer|wrong_answer|intent routing error|intent_routing_error|rossz temaju/],
    ['complaint', /reklam|panaszkezeles|visszaterit|serult csomag/],
    ['payment', /fizet|bankkart|tranzakcio/],
    ['shipping', /szallit|kiszallit|csomag|futar/],
    ['child_safety', /gyerek|gyermek|[0-9]+ eves|eletkor/],
    ['psoriasis_scalp', /pikkelysomor.*fejbor|fejbor.*pikkelysomor|psorivital.*sampon/],
    ['psoriasis', /pikkelysomor|psorivital/],
    ['eczema', /ekcema|dermavital/],
    ['usage_order', /hasznalati sorrend|milyen sorrend|eloszor.*utana|egyutt.*hasznal/],
    ['medical', /egeszseg|orvos|borgyogy|gyullad|borproblem|irrit|allerg/],
    ['uncertain_product', /bizonytalan|melyik termek|mit ajanl|termekvalaszt/]
  ];
  return (rules.find(([, pattern]) => pattern.test(text)) || [null])[0];
}

function safetyFor(task, domain) {
  if (domain === 'child_safety' || domain === 'medical') return 'high';
  if (['psoriasis','psoriasis_scalp','eczema','canonical_review'].includes(domain) || task.repairTarget === 'safety_policy') return 'caution';
  return 'standard';
}

function safeKeywords(task) {
  return sortedUnique(normalize(`${task.normalizedQuestionKey || ''} ${task.question || ''}`).split(' ')
    .filter(word => word.length >= 4 && !STOP_WORDS.has(word))).slice(0, 8);
}

function clusterKeyFor(task) {
  const domain = domainFor(task);
  const safety = safetyFor(task, domain);
  const canonicalIds = sortedUnique(task.canonicalIds);
  const topic = normalize(task.topic);
  const family = normalize(task.productFamily);
  const classification = normalize(task.classification);
  const rootCause = normalize(task.rootCause);
  const repairTarget = normalize(task.repairTarget);
  if (domain) return `domain:${domain}|safety:${safety}|class:${classification || 'unknown'}|root:${rootCause || 'unknown'}|canonical:${canonicalIds.join(',') || '-'}`;
  if (canonicalIds.length) return `canonical:${canonicalIds.join(',')}|safety:${safety}|class:${classification || 'unknown'}|root:${rootCause || 'unknown'}`;
  if (topic && family) return `topic-family:${topic}|${family}|safety:${safety}|class:${classification || 'unknown'}|repair:${repairTarget || 'unknown'}`;
  const exact = normalize(task.normalizedQuestionKey) || safeKeywords(task).join('-') || `task-${normalize(task.id)}`;
  return `exact:${exact}|safety:${safety}|class:${classification || 'unknown'}|root:${rootCause || 'unknown'}`;
}

function labelFor(domain, task) {
  const labels = { child_safety:'Gyermekek használata és életkor', eczema:'Ekcéma / Dermavital', psoriasis:'Pikkelysömör / PsoriVital',
    psoriasis_scalp:'Pikkelysömörös fejbőr', usage_order:'Termékhasználati sorrend', shipping:'Szállítás', payment:'Bankkártyás fizetés',
    complaint:'Reklamáció', missing_product_data:'Hiányzó termékadat', canonical_review:'Felülvizsgálandó canonical hivatkozás',
    wrong_topic_answer:'Rossz témájú válasz', uncertain_product:'Bizonytalan termékválasztás', medical:'Egészségügyi kérdés' };
  return labels[domain] || String(task.topic || task.productFamily || task.question || 'Egyedi tudásfeladat').slice(0, 160);
}

function summarize(items, field) {
  const result = {};
  for (const item of items) { const key = String(item[field] || 'unknown'); result[key] = (result[key] || 0) + 1; }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function createCluster(items, key, now) {
  const tasks = [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const representative = [...tasks].sort((a,b) => (Number(b.occurrenceCount)||1)-(Number(a.occurrenceCount)||1) || String(a.id).localeCompare(String(b.id)))[0];
  const domain = domainFor(representative);
  const priorities = tasks.map(task => task.priority).filter(value => value in PRIORITY_RANK);
  const safetyLevels = tasks.map(task => safetyFor(task, domain));
  const priority = priorities.sort((a,b) => PRIORITY_RANK[b]-PRIORITY_RANK[a])[0] || 'low';
  const safetyLevel = safetyLevels.sort((a,b) => SAFETY_RANK[b]-SAFETY_RANK[a])[0] || 'standard';
  const taskIds = tasks.map(task => String(task.id));
  const occurrenceCount = tasks.reduce((sum, task) => sum + Math.max(1, Number(task.occurrenceCount) || 1), 0);
  const classificationSummary = summarize(tasks, 'classification');
  return {
    id: crypto.createHash('sha256').update(`knowledge-cluster:v1:${key}`).digest('hex').slice(0, 32), clusterKey: key,
    title: labelFor(domain, representative), summary: `${tasks.length} Knowledge Task, összesen ${occurrenceCount} előfordulás.`,
    topic: domain || representative.topic || 'egyéb', productFamily: representative.productFamily || null,
    classificationSummary, priority, businessValue: Math.max(...tasks.map(task => Number(task.businessValue) || 1)),
    estimatedImpact: Math.max(...tasks.map(task => Number(task.estimatedImpact) || 0)), safetyLevel,
    taskCount: tasks.length, occurrenceCount, taskIds, canonicalIds: sortedUnique(tasks.flatMap(task => task.canonicalIds || [])),
    representativeQuestion: String(representative.question || '').slice(0, 1000),
    suggestedAction: String(representative.suggestedAction || 'Kézi felülvizsgálat szükséges.').slice(0, 1000),
    status: 'open', reviewerNote: '', createdAt: now, updatedAt: now
  };
}

function clusterKnowledgeTasks(tasks, options = {}) {
  const unique = new Map();
  for (const task of tasks || []) if (task && task.id != null && !unique.has(String(task.id))) unique.set(String(task.id), task);
  const inputTimes = [...unique.values()].flatMap(task => [task.updatedAt, task.createdAt, task.lastSeenAt]).filter(Boolean).sort();
  const now = options.now || inputTimes.at(-1) || '1970-01-01T00:00:00.000Z';
  const groups = new Map();
  for (const task of [...unique.values()].sort((a,b) => String(a.id).localeCompare(String(b.id)))) {
    const key = clusterKeyFor(task); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(task);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, items]) => createCluster(items, key, now));
}

module.exports = { STATUSES, normalize, domainFor, clusterKeyFor, clusterKnowledgeTasks };
