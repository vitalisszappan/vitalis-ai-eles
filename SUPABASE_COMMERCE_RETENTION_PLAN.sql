-- REVIEW-ONLY retention candidate audit. Safe default: read-only and ROLLBACK.
-- Do not enable deletion or scheduling without separate approval and a backup review.
begin;

select
  'commerce_events' as target_table,
  now() - interval '90 days' as cutoff_exclusive,
  count(*) as candidate_count,
  min(received_at) as oldest_candidate_at,
  max(received_at) as newest_candidate_at
from public.commerce_events
where received_at < now() - interval '90 days';

select
  'commerce_order_proofs' as target_table,
  now() - interval '180 days' as cutoff_exclusive,
  count(*) as candidate_count,
  min(created_at) as oldest_candidate_at,
  max(created_at) as newest_candidate_at
from public.commerce_order_proofs
where created_at < now() - interval '180 days';

rollback;

-- FUTURE MANUAL EXECUTION TEMPLATE — intentionally disabled:
-- begin;
-- delete from public.commerce_events
-- where received_at < now() - interval '90 days';
-- delete from public.commerce_order_proofs
-- where created_at < now() - interval '180 days';
-- Review affected row counts and explicitly choose COMMIT or ROLLBACK.
-- rollback;
