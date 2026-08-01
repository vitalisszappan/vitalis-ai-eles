-- Ezt a vitalis-chat-naplo Supabase projekt SQL Editorában kell kézzel futtatni.
-- Nem automatikus migráció.

create table if not exists public.knowledge_tasks (
  id text primary key,
  normalized_question_key text not null unique,
  conversation_id text,
  conversation_ids jsonb not null default '[]'::jsonb,
  question text not null,
  answer text,
  answer_source text,
  confidence_score numeric,
  detected_intent text,
  canonical_ids jsonb not null default '[]'::jsonb,
  page_url text,
  occurred_at timestamptz,
  classification text not null check (classification in ('solved','missing_knowledge','wrong_answer','outdated_knowledge','needs_review','product_missing','faq_candidate','blog_candidate','irrelevant')),
  classification_reason text,
  priority text not null check (priority in ('critical','high','medium','low')),
  business_value integer not null check (business_value between 1 and 5),
  topic text,
  product_family text,
  suggested_action text,
  status text not null default 'open' check (status in ('open','in_review','approved','rejected','resolved','ignored')),
  occurrence_count integer not null default 1,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  reviewer_note text not null default '',
  reviewed_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.knowledge_tasks
  add column if not exists root_cause text not null default 'unknown',
  add column if not exists root_cause_reason text not null default '',
  add column if not exists repair_target text not null default 'manual_review',
  add column if not exists estimated_impact integer not null default 0,
  add column if not exists impact_breakdown jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.knowledge_tasks'::regclass and conname = 'knowledge_tasks_root_cause_check') then
    alter table public.knowledge_tasks add constraint knowledge_tasks_root_cause_check check (root_cause in ('knowledge_missing','knowledge_outdated','intent_routing_error','expert_rule_missing','expert_rule_bypassed','canonical_product_missing','canonical_mapping_missing','canonical_not_approved','alias_missing','conversation_context_missing','ambiguous_question','admin_flow_missing','unsafe_or_medical_guidance_missing','product_data_missing','irrelevant_or_spam','unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.knowledge_tasks'::regclass and conname = 'knowledge_tasks_repair_target_check') then
    alter table public.knowledge_tasks add constraint knowledge_tasks_repair_target_check check (repair_target in ('knowledge','admin_intent','expert_rule','canonical_catalog','canonical_mapping','alias_registry','conversation_context','product_registry','safety_policy','admin_ui','none','manual_review'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.knowledge_tasks'::regclass and conname = 'knowledge_tasks_estimated_impact_check') then
    alter table public.knowledge_tasks add constraint knowledge_tasks_estimated_impact_check check (estimated_impact between 0 and 100);
  end if;
end $$;

create index if not exists knowledge_tasks_queue_idx on public.knowledge_tasks (status, priority, last_seen_at desc);
create index if not exists knowledge_tasks_impact_queue_idx on public.knowledge_tasks (status, estimated_impact desc, priority, last_seen_at desc);
alter table public.knowledge_tasks enable row level security;

create table if not exists public.knowledge_drafts (
  id text primary key,
  task_id text not null unique references public.knowledge_tasks(id) on delete cascade,
  draft_type text not null check (draft_type in ('faq','knowledge','admin_intent','expert_rule_proposal','canonical_proposal','manual_required')),
  question text not null,
  answer text not null,
  keywords jsonb not null default '[]'::jsonb,
  category text not null,
  canonical_ids jsonb not null default '[]'::jsonb,
  source_conversation_ids jsonb not null default '[]'::jsonb,
  source_knowledge_ids jsonb not null default '[]'::jsonb,
  source_rule_ids jsonb not null default '[]'::jsonb,
  source_summary text not null default '',
  generation_status text not null check (generation_status in ('generated','needs_manual_input','in_review','approved_for_import','rejected','exported')),
  confidence_score integer not null check (confidence_score between 0 and 100),
  safety_status text not null check (safety_status in ('safe','caution','manual_required')),
  generation_reason text not null,
  generated_content_hash text not null,
  manually_edited boolean not null default false,
  reviewer_note text not null default '',
  reviewed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_drafts_status_idx on public.knowledge_drafts (generation_status, updated_at desc);
alter table public.knowledge_drafts enable row level security;

-- Szandekosan nincs publikus RLS policy; ezeket a tablakat csak a service-role szerver eri el.
