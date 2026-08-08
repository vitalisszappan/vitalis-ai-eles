# Vitalis Browser → Order Bridge PoC — verified complete

## Status

The Browser → Order correlation PoC was verified successfully in production on 2026-08-08 using a new, clean incognito browser session. This is a technical attribution proof, not revenue attribution.

## Architecture

1. The browser attribution lifecycle creates a UUID v4 `attributionId` and preserves it across the canonical webshop journey.
2. The chat records `chat_open`, `chat_started`, `product_recommended` and `product_clicked` through `/api/commerce/event`.
3. `commerce_events` is the authoritative Supabase event store. The clicked event contains the selected product SKU.
4. On the UNAS `order_send` / **Megrendelés: köszönő oldal**, the external bridge obtains only the `orderKey` from `UNAS.getOrder()`.
5. The browser sends exactly `orderKey`, `attributionId`, `schemaVersion` and `timestamp` to `/api/commerce/order-proof`.
6. The server loads the preceding attribution events, calls the server-side UNAS `getOrder`, and requires at least one clicked SKU to match an order SKU.
7. `commerce_order_proofs` is the authoritative Supabase proof store. Database uniqueness provides durable idempotency.

Production without a configured Supabase connection fails closed; it does not silently use local JSONL storage. JSONL adapters remain local/test-only.

## Production storage

- `public.commerce_events`: durable event chain; `event_id` primary-key idempotency.
- `public.commerce_order_proofs`: durable proof result; `UNIQUE(schema_version, attribution_id, order_key)` idempotency.
- Both tables have RLS enabled, no public policy, and only server-side service-role `SELECT`/`INSERT` access.
- Neither table contains customer data, chat content, prices, payment data or revenue.

## Canonical origin and UNAS integration

- Canonical browser origin: `https://www.vitalis-szappan.hu`.
- The apex origin redirects to `www` with HTTP 301.
- The bridge runs only on the UNAS `order_send` / **Megrendelés: köszönő oldal**.
- It is loaded as an external integration script at body end.
- The UNAS script was not changed during final closure.

## Live E2E evidence

Clean incognito journey:

1. Chat opened and started.
2. A product was recommended.
3. The product was clicked with an SKU-bearing event.
4. The order was completed on UNAS.
5. All four events and the order proof used the same attribution ID.
6. Proof reference: `99212-962676`.
7. Persisted result: `verified = TRUE`.
8. Verification time: `2026-08-08 16:38:25 UTC`.

No customer or contact information is included in this evidence.

## Security boundaries

- The browser cannot submit an Order ID, SKU list, status, price, revenue, customer object or PII in the proof request.
- Unknown fields are rejected.
- Missing attribution or missing SKU-bearing `product_clicked` history is rejected.
- The order is independently retrieved from UNAS by the server.
- An exact SKU match is mandatory; product-name inference is forbidden.
- API keys, service-role credentials and admin tokens remain server-side.
- Duplicate events and proofs are handled by database constraints.

## What this PoC proves

- A single browser attribution ID can be followed from chat engagement through product recommendation and click to a real UNAS order.
- The order key and SKU relationship can be verified independently on the server.
- Events, proof and idempotency survive application restart and deploy because Supabase is authoritative.

## What this PoC does not prove

- It does not calculate or attribute revenue.
- It does not emit `purchase_attributed`.
- It does not provide a Revenue Engine, dashboard, webhook or polling system.
- It is not a general multi-touch attribution model or an accounting record.
- It does not replace operational monitoring, retention policy or privacy review for a later production analytics phase.

## Disable and rollback

To disable collection without changing customer checkout behavior:

1. Disable the `order_send` bridge invocation in the UNAS external integration.
2. Disable the bridge ScriptTag.
3. If the complete attribution PoC must be disabled, remove the attribution lifecycle and chat commerce-event wiring afterward.
4. Preserve the Supabase rows for audit unless an approved retention/deletion procedure requires removal.

Database rollback is deliberately separate and data-destructive. Export required records before using the commented rollback plan in `SUPABASE_COMMERCE_EVENTS.sql`.

## Possible next phases

- Production monitoring and alerting for ingestion/proof failures.
- Documented retention and deletion automation.
- Privacy and data-governance review.
- Only after separate approval: design of revenue attribution or aggregated reporting. Those features are not part of this PoC.
