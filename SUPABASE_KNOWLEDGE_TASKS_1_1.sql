-- Knowledge Cleanup 1.1: kézzel futtatandó, az alkalmazás nem migrál automatikusan.
alter table public.knowledge_tasks
  add column if not exists root_cause text not null default 'unknown',
  add column if not exists root_cause_reason text not null default '',
  add column if not exists repair_target text not null default 'manual_review',
  add column if not exists estimated_impact integer not null default 0,
  add column if not exists impact_breakdown jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'knowledge_tasks_root_cause_check') then
    alter table public.knowledge_tasks add constraint knowledge_tasks_root_cause_check check (root_cause in ('knowledge_missing','knowledge_outdated','intent_routing_error','expert_rule_missing','expert_rule_bypassed','canonical_product_missing','canonical_mapping_missing','canonical_not_approved','alias_missing','conversation_context_missing','ambiguous_question','admin_flow_missing','unsafe_or_medical_guidance_missing','product_data_missing','irrelevant_or_spam','unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'knowledge_tasks_repair_target_check') then
    alter table public.knowledge_tasks add constraint knowledge_tasks_repair_target_check check (repair_target in ('knowledge','admin_intent','expert_rule','canonical_catalog','canonical_mapping','alias_registry','conversation_context','product_registry','safety_policy','admin_ui','none','manual_review'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'knowledge_tasks_estimated_impact_check') then
    alter table public.knowledge_tasks add constraint knowledge_tasks_estimated_impact_check check (estimated_impact between 0 and 100);
  end if;
end $$;

create index if not exists knowledge_tasks_impact_queue_idx
  on public.knowledge_tasks (status, estimated_impact desc, priority, last_seen_at desc);
