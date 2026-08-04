'use strict';
const assert=require('assert');
const fs=require('fs');
const {clusterKnowledgeTasks,clusterKeyFor,normalize}=require('./engine/knowledge-clusters.cjs');
const now='2026-08-04T00:00:00.000Z';
const task=(id,question,extra={})=>({id,question,normalizedQuestionKey:normalize(question),classification:'missing_knowledge',rootCause:'knowledge_missing',repairTarget:'knowledge',priority:'high',businessValue:3,estimatedImpact:60,occurrenceCount:1,canonicalIds:[],...extra});
const tasks=[
  task('child-1','8 éves gyermek használhatja?'),task('child-2','8 eves gyerek hasznalhatja?'),
  task('pay','Sikertelen bankkártyás fizetés'),task('ship','Mennyi a szállítás?'),
  task('eczema','Ekcémára Dermavital krém'),task('psoriasis','Pikkelysömörre PsoriVital'),
  task('scalp','Pikkelysömörös fejbőrre sampon'),task('review','Régi termék', {classification:'needs_review',rootCause:'canonical_not_approved',canonicalIds:['old_product']}),
  task('single','Teljesen egyedi kérdés')
];
const first=clusterKnowledgeTasks(tasks,{now}),second=clusterKnowledgeTasks([...tasks].reverse(),{now});
assert.deepEqual(first,second);assert.equal(JSON.stringify(first),JSON.stringify(second));
assert.equal(normalize('Árvíz, TŰRŐ!'),'arviz turo');
const ids=first.flatMap(cluster=>cluster.taskIds);assert.equal(ids.length,tasks.length);assert.equal(new Set(ids).size,tasks.length);
assert.deepEqual([...ids].sort(),tasks.map(item=>item.id).sort());
assert.equal(first.find(cluster=>cluster.taskIds.includes('child-1')).id,first.find(cluster=>cluster.taskIds.includes('child-2')).id);
assert.notEqual(clusterKeyFor(tasks[2]),clusterKeyFor(tasks[3]));
assert.notEqual(clusterKeyFor(tasks[4]),clusterKeyFor(tasks[5]));
assert.notEqual(clusterKeyFor(tasks[4]),clusterKeyFor({...tasks[4],productFamily:'PsoriVital',question:'PsoriVital pikkelysömör',normalizedQuestionKey:'psorivital pikkelysomor'}));
assert.equal(first.find(cluster=>cluster.taskIds.includes('review')).topic,'canonical_review');
assert.equal(first.find(cluster=>cluster.taskIds.includes('single')).taskCount,1);
for(const cluster of first)assert.equal(cluster.id,clusterKnowledgeTasks(tasks,{now}).find(item=>item.clusterKey===cluster.clusterKey).id);
const migration=fs.readFileSync('./SUPABASE_KNOWLEDGE_CLUSTERS.sql','utf8');
for(const marker of ['create table if not exists public.knowledge_clusters','enable row level security','knowledge_clusters_task_ids_gin_idx'])assert(migration.includes(marker));
assert.equal(/create\s+policy/i.test(migration),false);
console.log('Knowledge Clustering 1.0 regressziótesztek: OK');
