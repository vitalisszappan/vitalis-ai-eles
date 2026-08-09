-- Run manually before enabling durable verified commerce outcomes in production.
-- Contains technical commerce evidence only: no PII, price or revenue.
create table if not exists public.commerce_outcomes (
  outcome_id uuid primary key,
  schema_version smallint not null check (schema_version = 1),
  attribution_id uuid not null,
  order_key text not null check (char_length(order_key) between 1 and 100),
  order_id text not null check (char_length(order_id) between 1 and 100),
  outcome_type text not null check (outcome_type = 'verified_order'),
  matched_skus jsonb not null check (jsonb_typeof(matched_skus) = 'array' and jsonb_array_length(matched_skus) > 0),
  clicked_skus jsonb not null check (jsonb_typeof(clicked_skus) = 'array' and jsonb_array_length(clicked_skus) > 0),
  conversation_session_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(conversation_session_ids) = 'array'),
  recommendation_evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(recommendation_evidence) = 'array'),
  click_evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(click_evidence) = 'array'),
  verified_at timestamptz not null,
  source text not null check (source = 'unas_server_verified'),
  created_at timestamptz not null default now(),
  constraint commerce_outcomes_order_unique unique (schema_version, order_key)
);
create index if not exists commerce_outcomes_attribution_idx on public.commerce_outcomes (attribution_id, verified_at desc);
alter table public.commerce_outcomes enable row level security;
revoke all on table public.commerce_outcomes from anon, authenticated;
grant select, insert on table public.commerce_outcomes to service_role;
