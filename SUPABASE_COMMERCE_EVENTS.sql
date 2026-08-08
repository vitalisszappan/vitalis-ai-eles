-- Vitalis Browser -> Order attribution events. Review and run manually.
-- Contains technical correlation metadata only; no PII, chat content, price or revenue.
create table if not exists public.commerce_events (
  event_id uuid primary key,
  attribution_id uuid not null,
  chat_session_id text,
  event_type text not null check (event_type in ('chat_open','chat_started','product_recommended','product_clicked')),
  canonical_product_id text,
  unas_product_id text,
  sku text,
  recommendation_type text check (recommendation_type is null or recommendation_type in ('primary','secondary','related')),
  recommendation_rank smallint check (recommendation_rank is null or recommendation_rank between 1 and 3),
  route text,
  intent text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  schema_version smallint not null check (schema_version = 1)
);

create index if not exists commerce_events_attribution_idx
  on public.commerce_events (attribution_id, occurred_at);
create index if not exists commerce_events_attribution_type_idx
  on public.commerce_events (attribution_id, event_type, occurred_at);
create index if not exists commerce_events_received_at_idx
  on public.commerce_events (received_at);

alter table public.commerce_events enable row level security;
revoke all on table public.commerce_events from anon, authenticated;
grant select, insert on table public.commerce_events to service_role;
-- No public RLS policy is created. Only the server-held service role may access it.

create table if not exists public.commerce_order_proofs (
  proof_id uuid primary key default gen_random_uuid(),
  attribution_id uuid not null,
  order_key text not null check (char_length(order_key) between 1 and 100 and order_key ~ '^[A-Za-z0-9._:/-]+$'),
  verified boolean not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  schema_version smallint not null check (schema_version = 1),
  constraint commerce_order_proofs_verification_time_check
    check ((verified and verified_at is not null) or (not verified and verified_at is null)),
  constraint commerce_order_proofs_idempotency_unique
    unique (schema_version, attribution_id, order_key)
);

create index if not exists commerce_order_proofs_attribution_idx
  on public.commerce_order_proofs (attribution_id, created_at);
create index if not exists commerce_order_proofs_created_at_idx
  on public.commerce_order_proofs (created_at);

alter table public.commerce_order_proofs enable row level security;
revoke all on table public.commerce_order_proofs from anon, authenticated;
grant select, insert on table public.commerce_order_proofs to service_role;
-- No public RLS policy is created. Only the server-held service role may access it.

-- Review-only rollback (data-destructive; execute manually only after an export):
-- drop table if exists public.commerce_order_proofs;
-- drop table if exists public.commerce_events;
