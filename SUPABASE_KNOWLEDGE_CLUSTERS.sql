-- Vitalis Knowledge Clustering 1.0 - kézzel futtatandó, idempotens migráció.
-- Szándékosan nincs publikus RLS policy: csak a service-role szerver fér hozzá.

create table if not exists public.knowledge_clusters (
  id text primary key,
  cluster_key text not null unique,
  title text not null,
  summary text not null default '',
  topic text not null,
  product_family text,
  classification_summary jsonb not null default '{}'::jsonb,
  priority text not null check (priority in ('critical','high','medium','low')),
  business_value integer not null check (business_value between 1 and 5),
  estimated_impact integer not null check (estimated_impact between 0 and 100),
  safety_level text not null check (safety_level in ('standard','caution','high')),
  task_count integer not null check (task_count >= 0),
  occurrence_count integer not null check (occurrence_count >= 0),
  task_ids jsonb not null default '[]'::jsonb,
  canonical_ids jsonb not null default '[]'::jsonb,
  representative_question text not null default '',
  suggested_action text not null default '',
  status text not null check (status in ('open','in_review','draft_ready','resolved','dismissed')),
  reviewer_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_clusters_review_queue_idx
  on public.knowledge_clusters (status, priority, estimated_impact desc, updated_at desc);
create index if not exists knowledge_clusters_topic_idx
  on public.knowledge_clusters (topic, safety_level, status);
create index if not exists knowledge_clusters_task_ids_gin_idx
  on public.knowledge_clusters using gin (task_ids);

alter table public.knowledge_clusters enable row level security;
