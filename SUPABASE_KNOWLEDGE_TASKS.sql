-- Kézzel futtatandó a Supabase SQL Editorban. A migrációt az alkalmazás nem futtatja.
create table if not exists public.knowledge_tasks (
  id text primary key, normalized_question_key text not null unique,
  conversation_id text, conversation_ids jsonb not null default '[]'::jsonb,
  question text not null, answer text, answer_source text, confidence_score numeric,
  detected_intent text, canonical_ids jsonb not null default '[]'::jsonb, page_url text, occurred_at timestamptz,
  classification text not null check (classification in ('solved','missing_knowledge','wrong_answer','outdated_knowledge','needs_review','product_missing','faq_candidate','blog_candidate','irrelevant')),
  classification_reason text, priority text not null check (priority in ('critical','high','medium','low')),
  business_value integer not null check (business_value between 1 and 5), topic text, product_family text, suggested_action text,
  status text not null default 'open' check (status in ('open','in_review','approved','rejected','resolved','ignored')),
  occurrence_count integer not null default 1, first_seen_at timestamptz, last_seen_at timestamptz,
  reviewer_note text not null default '', reviewed_at timestamptz, resolved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists knowledge_tasks_queue_idx on public.knowledge_tasks (status, priority, last_seen_at desc);
alter table public.knowledge_tasks enable row level security;
-- Nincs publikus policy: a szerver kizárólag service role-lal, admin-hitelesítés után éri el.
