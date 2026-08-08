# Vitalis Commerce Attribution — Production Hardening 1.0

## Health and status

`GET /api/status` exposes an aggregate `commerceHealth` object. It contains storage availability and kind, whether both stores are authoritative Supabase adapters, durability, last successful event/proof timestamps, and rolling 24-hour counts for events, product clicks, verified proofs and categorized failures.

The response never contains attribution IDs, order keys, SKUs, chat session IDs, customer data or other PII. Database metrics use aggregate counts and latest timestamps only. Failure counters are process-local operational telemetry; a process restart resets those counters, while event/proof counts and timestamps remain database-backed.

Health levels:

- `INFO`: both stores respond, no tracked correlation or storage failures in the process-local 24-hour window.
- `WARNING`: one or more `attribution_not_found` or `product_clicked_not_found` results occurred, but both stores remain reachable.
- `ERROR`: a store health query failed or a commerce/proof storage failure occurred.

Recommended alerts:

- Immediate alert: `ERROR`, either store unavailable, `productionDurable != true`, or `supabaseAuthoritative != true` in production.
- Investigation alert: repeated attribution/product-click prerequisite failures or an unexpected sustained fall to zero events while webshop traffic continues.
- Informational only: isolated invalid browser requests, duplicates handled by database constraints, or a zero count during a genuinely inactive period.

No external notification integration is included in this phase.

## Retention recommendation

- `commerce_events`: 90 days. This covers typical purchase consideration and operational investigation windows while limiting persistent pseudonymous browsing metadata.
- `commerce_order_proofs`: 180 days. Proofs are much lower volume and may be required longer for technical attribution audits and duplicate-callback investigation.

Retention should use `received_at` for events and `created_at` for proofs. Before automation, confirm legal/privacy requirements, backup behavior and deletion auditing. This phase performs no `DELETE`, creates no cleanup job and changes no production rows.

## Privacy and governance audit

Stored event fields are technical correlation metadata: random event/attribution identifiers, chat session identifier, event type, product identifiers/SKU, recommendation metadata, route/intent, timestamps and schema version. Proof storage contains a random proof ID, attribution ID, order key, boolean verification result, timestamps and schema version.

No direct PII, chat content, customer object, address, contact detail, payment data, price or revenue is stored. Attribution IDs, chat session IDs, order keys and product interaction histories are pseudonymous identifiers and can create indirect identification/linkability risk when combined with other systems. Access must therefore remain purpose-limited to technical attribution verification, incident investigation and approved aggregate monitoring.

RLS remains enabled. `anon` and `authenticated` have no access; the server-side service role has only `SELECT` and `INSERT`. Secrets remain server-side. Access and retention decisions should be reviewed whenever the purpose expands.

## Regression gate

Hardening does not change the four event types, browser lifecycle, SKU-bearing `product_clicked` prerequisite, server-side UNAS verification, exact SKU match, four-field browser proof contract, database idempotency, Supabase-authoritative production selection or production JSONL fallback prohibition.

Explicitly out of scope: revenue attribution/calculation, `purchase_attributed`, marketing dashboards, GA4 revenue linking, Search Console integration, webhooks, polling and new commerce business events.
