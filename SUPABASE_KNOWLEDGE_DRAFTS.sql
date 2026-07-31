-- Vitalis Knowledge Builder 3.0. Kézzel futtatandó; az alkalmazás nem migrál automatikusan.
create table if not exists public.knowledge_drafts (
  id text primary key, task_id text not null unique references public.knowledge_tasks(id) on delete cascade,
  draft_type text not null check (draft_type in ('faq','knowledge','admin_intent','expert_rule_proposal','canonical_proposal','manual_required')),
  question text not null, answer text not null, keywords jsonb not null default '[]'::jsonb, category text not null,
  canonical_ids jsonb not null default '[]'::jsonb, source_conversation_ids jsonb not null default '[]'::jsonb,
  source_knowledge_ids jsonb not null default '[]'::jsonb, source_rule_ids jsonb not null default '[]'::jsonb,
  source_summary text not null default '', generation_status text not null check (generation_status in ('generated','needs_manual_input','in_review','approved_for_import','rejected','exported')),
  confidence_score integer not null check (confidence_score between 0 and 100), safety_status text not null check (safety_status in ('safe','caution','manual_required')),
  generation_reason text not null, generated_content_hash text not null, manually_edited boolean not null default false,
  reviewer_note text not null default '', reviewed_at timestamptz, approved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists knowledge_drafts_status_idx on public.knowledge_drafts (generation_status, updated_at desc);
alter table public.knowledge_drafts enable row level security;
-- Nincs publikus policy; csak a service-role szerver éri el admin-hitelesítés után.
