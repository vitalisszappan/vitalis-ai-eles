# Commerce Attribution Retention and Governance 1.0

## Monitoring audit

The current `/api/status` health model is safe for public operational status because it exposes only aggregate counts, timestamps, storage type/availability and a categorical level.

- `INFO`: both stores are available; no tracked storage or correlation-prerequisite failure exists in the process-local 24-hour window.
- `WARNING`: at least one `attribution_not_found` or `product_clicked_not_found` occurred while both stores remained available.
- `ERROR`: either store health query failed, or at least one commerce/proof storage error was recorded.

Production should additionally treat `supabaseAuthoritative != true` or `productionDurable != true` as an alert even if the categorical level has not been evaluated externally. Database event/proof counts and last-success timestamps survive restart. Failure counters are deliberately process-local and reset on restart; they are diagnostic signals, not an audit ledger.

## Retention design

- `commerce_events`: 90 days, based exclusively on `received_at`.
- `commerce_order_proofs`: 180 days, based exclusively on `created_at`.
- The cutoff is exclusive (`timestamp < cutoff`), so a row exactly on the boundary is retained.

`SUPABASE_COMMERCE_RETENTION_PLAN.sql` is read-only by default. It reports candidate counts and timestamp ranges inside a transaction that ends with `ROLLBACK`. Disabled comments show the future manual deletion shape, but no active DELETE, cron, scheduled function or cleanup task is included.

Before any later deletion approval: verify backups, export audit results, record operator/time/cutoffs and affected counts, run the candidate audit again, and require an explicit COMMIT decision. Re-running the timestamp-based deletion would be idempotent because already-deleted rows cannot be selected again.

## Privacy and governance

- `attribution_id`: pseudonymous cross-event link; indirect identification/linkability risk.
- `chat_session_id`: pseudonymous conversation-session link; correlation risk even without chat text.
- `order_key`: commerce-system reference; may become identifying when joined with restricted UNAS/customer systems.
- timestamps: behavioral timing and linkage risk.
- product identifiers/SKU and interaction types: preference and behavior profiling risk.

Purpose limitation: technical Browser → Order verification, incident diagnosis and aggregate health only. These identifiers must not be exported into marketing profiles or joined to customer data without a separately approved legal, privacy and technical design.

Data minimization remains appropriate for the current purpose, but the risk is not zero. The 90/180-day windows limit linkability while retaining enough time for operational investigation and duplicate-proof audit.

## Access-control audit

Both tables have RLS enabled. `anon` and `authenticated` have all table privileges revoked. `service_role` has only `SELECT` and `INSERT`; no browser credential exposes it. This phase changes no grants, policies, roles or environment secrets.

## Regression boundary

Retention candidate selection references only `public.commerce_events.received_at` and `public.commerce_order_proofs.created_at`. It does not reference Knowledge, chat/conversation or other tables, and does not change the event/proof contracts or runtime attribution logic.
