# Vitalis Revenue Attribution Core 1.0 — Design Gate

Status: design only. This document does not authorize a migration, production write, deployment, polling job, storefront change, or revenue calculation in production.

## Proven baseline and source of truth

The Browser → Order proof remains unchanged and carries only `orderKey`, `attributionId`, `schemaVersion`, and `timestamp`. Every monetary value, currency, quantity, order line, and raw order status used by Revenue Core must come from a fresh server-side UNAS `getOrder` response after a verified order proof. Browser payloads, chatbot payloads, DOM content, URLs, GA4, product cards, client prices, and browser storage are forbidden revenue sources.

The live preflight evidence for order `99212-962676` established HUF, order gross 4950, product SKU `VDVSZ` with quantity 1 and gross 2700, shipping 1850, payment fee 400, and available status/status ID/status type fields. The equality `2700 + 1850 + 400 = 4950` is evidence for this order only, not a universal allocation rule.

## KPI and attribution models

The primary KPI is **AI Attributed Product Revenue**, calculated under `RECOMMENDED_PRODUCT_ATTRIBUTED`: gross revenue of genuine product lines whose SKU has both a prior `product_recommended` and a prior `product_clicked` event in the verified attribution, and whose SKU matches the server-side UNAS order. This is the recommended headline KPI because it proves the complete recommendation → click → verified order → order SKU chain.

The secondary KPI is **AI Assisted Order Revenue**, calculated under `ORDER_ASSISTED`: the complete verified UNAS order gross total when at least one SKU qualifies under the selected product attribution model. It is reporting-only and must never be presented as direct AI product revenue. Shipping, payment fees, discounts, and unmatched products may affect this order-level value but never become attributed product revenue.

Three models remain distinct:

- `PRODUCT_ATTRIBUTED`: prior `product_clicked` plus verified matching product SKU; recommendation is not required. This is a broader diagnostic model, not the headline KPI.
- `RECOMMENDED_PRODUCT_ATTRIBUTED`: prior recommendation and click for the same SKU plus verified matching product SKU. This drives the primary KPI.
- `ORDER_ASSISTED`: full order gross when at least one product SKU qualifies; reporting-only.

Events must precede the proof timestamp. Duplicate recommendations and clicks collapse to boolean evidence per attribution and SKU. Missing recommendation disqualifies only `RECOMMENDED_PRODUCT_ATTRIBUTED`; missing click disqualifies both product models. An SKU/order/model combination is recognized at most once.

## Deterministic line classification

Classification is based on exact, audited server-side UNAS fields, never item names:

| Class | Rule |
|---|---|
| `SHIPPING` | exact item `Id` equals `shipping-cost` |
| `PAYMENT_FEE` | exact item `Id` equals the live-proven UNAS value `handel-cost` |
| `DISCOUNT` | exact item `Id` equals `discount-amount` or `discount-percent`; these are documentation-backed candidates and require live evidence before monetary treatment |
| `PRODUCT` | a non-special line with valid nonempty SKU, valid positive quantity, valid nonnegative price evidence, and no known technical identifier |
| `UNKNOWN_TECHNICAL_LINE` | anything ambiguous, malformed, or apparently technical that does not match an audited exact rule |

`UNKNOWN_TECHNICAL_LINE` is never product revenue and moves the order to `needs_review` if it could affect product/order reconciliation. New technical IDs require explicit evidence and a reviewed rule change. The historical spelling `handel-cost` must be matched exactly; it must not be silently normalized to guessed variants.

## Product revenue formula and multiple lines

For every qualifying SKU, attributed product revenue is the sum of its qualifying `PRODUCT` line gross amounts exactly once within the order and attribution model. Multiple clicks or recommendations do not multiply money. Multiple order lines with the same SKU are each validated, then summed once into that SKU's model result. Matching and nonmatching product lines coexist; only matching lines enter product revenue. Multiple qualifying SKUs are summed independently.

An explicit, proven line-gross field is preferred. The current preflight proves `Items.Item.PriceGross` and quantity, but does not prove a separate line-gross field. Until a line-gross path is proven, Revenue Core may derive a line amount only as exact `quantity × unit gross`, provided both values are valid and their semantics have been confirmed. If both explicit and derived line values later exist, they must match exactly in minor units; otherwise the line and order become `needs_review`. No tolerance based on binary floating point is allowed.

The live quantity-1 example is internally consistent but does not prove quantity-greater-than-one semantics. That case is an implementation gate test.

## Exact money model

Persist money as signed 64-bit integer minor units plus ISO-style uppercase currency and an audited currency exponent. Parse source decimals as strings with an exact decimal parser; never convert through JavaScript `Number`. HUF currently uses exponent 0 only after the live HUF evidence, while every other currency requires an explicit exponent rule before recognition.

Rules are fail-closed:

- missing/malformed currency, amount, quantity, or exponent → `needs_review`, no recognition;
- empty or noncanonical numeric strings → `needs_review`;
- negative product or fee line → `needs_review`; only audited discount/reversal sources may be negative;
- zero product amount → valid evidence may be retained, but it adds zero and is flagged for review unless a zero-price business rule is approved;
- quantity must be a positive exact decimal with bounded precision;
- multiplication overflow, fractional minor-unit result, or total inconsistency → `needs_review`;
- currencies are stored, aggregated, and reported separately; no conversion is implicit.

## Status state machine

Raw UNAS statuses are data, not business rules. Mapping is an audited configuration keyed by the exact tuple `(statusType, statusId, status)`, with effective date/version and reviewer evidence. No status value is guessed or hardcoded from its label.

```text
verified proof + valid monetary evidence
                 |
                 v
            provisional
              /  |  \
 audited fulfilled | audited cancel/full-refund
            v      |          v
        confirmed  |       reversed
                   v
             needs_review

unmapped/missing status -> unknown (excluded from confirmed revenue)
malformed/conflicting evidence -> needs_review
```

A verified order begins as `provisional`; verification never implies fulfillment. `confirmed` requires a separately approved Vitalis status mapping. `reversed` requires an audited cancel or full-refund source and reverses the previously confirmed amount without deleting attribution evidence. Invalid transitions, confirmed amount changes without an audited correction source, and any partial refund go to `needs_review`.

## Read-only status reconciliation interface

No cron or polling is part of V1. A future service interface may expose:

```text
reconcileOrderStatus(attributedOrderId)
  -> load immutable order identity/evidence
  -> server-side read-only UNAS getOrder
  -> validate order identity, currency, lines, totals, and raw status
  -> resolve audited status mapping
  -> transactionally append transition and update current state
  -> return {previousState, currentState, changed, needsReview}
```

Repeated reconciliation with identical evidence is a no-op. A state/version compare-and-set or row lock prevents concurrent lost updates. Every accepted state transition is appended before current state changes in the same database transaction.

## Cancel and refund V1 scope

- Cancel: supported only after the exact Vitalis UNAS raw status tuple is audited and approved.
- Full refund: supported only when a live-proven UNAS source unambiguously proves the full refund and amount.
- Partial refund, item return, quantity correction, and partial monetary correction: not implemented in V1; route to `needs_review` without inventing an amount.
- Attribution evidence is never removed on cancellation or reversal.

## Proposed Supabase schema

The migration is intentionally not included or executed in this design gate.

### `commerce_attributed_orders`

One immutable evidence row plus mutable current-state columns per verified order. Recommended minimum:

| Column | Type / rule | Purpose |
|---|---|---|
| `id` | uuid PK | ledger identifier |
| `proof_id` | uuid NOT NULL UNIQUE FK → `commerce_order_proofs.proof_id` | binds to verified proof |
| `attribution_id` | uuid NOT NULL | binds immutable event evidence |
| `order_key_hmac` | bytea NOT NULL | HMAC-SHA-256 of normalized raw order key |
| `hmac_key_version` | smallint NOT NULL | identifies the stable ledger identity key generation |
| `currency` | text NOT NULL CHECK canonical uppercase code | currency isolation |
| `currency_exponent` | smallint NOT NULL CHECK 0..6 | exact minor-unit interpretation |
| `order_gross_minor` | bigint NOT NULL CHECK >= 0 | immutable assisted-order evidence |
| `product_attributed_minor` | bigint NOT NULL CHECK >= 0 | click-based diagnostic KPI |
| `recommended_product_minor` | bigint NOT NULL CHECK >= 0 | primary KPI |
| `initial_status`, `initial_status_id`, `initial_status_type` | text nullable | immutable raw status at verification |
| `revenue_state` | constrained text NOT NULL | current provisional/confirmed/reversed/unknown/needs_review |
| `current_status`, `current_status_id`, `current_status_type` | text nullable | latest audited raw state |
| `ordered_at`, `verified_at` | timestamptz NOT NULL | source chronology |
| `confirmed_at`, `reversed_at` | timestamptz nullable with state checks | state timestamps |
| `created_at`, `updated_at` | timestamptz NOT NULL | ledger chronology |
| `schema_version`, `state_version` | smallint/integer NOT NULL | schema and optimistic concurrency |

Constraints: `UNIQUE(order_key_hmac)`, unique `proof_id`, verified-proof eligibility enforced transactionally before insert (and preferably by a reviewed database trigger), state/timestamp consistency checks, and nonnegative amounts. Assisted order revenue is `order_gross_minor`; it does not need a duplicate column.

### `commerce_attributed_items`

Immutable sanitized line evidence:

| Column | Type / rule |
|---|---|
| `id` uuid PK; `attributed_order_id` uuid NOT NULL FK |
| `line_ordinal` integer NOT NULL CHECK >= 0 |
| `line_class` constrained text NOT NULL |
| `sku` text nullable; required only for `PRODUCT` |
| `quantity` numeric(20,6) nullable |
| `unit_gross_minor`, `line_gross_minor` bigint nullable |
| `was_recommended`, `was_clicked` boolean NOT NULL |
| `product_attributed`, `recommended_product_attributed` boolean NOT NULL |
| `created_at` timestamptz NOT NULL |

Use `UNIQUE(attributed_order_id, line_ordinal)`. Do not store item names. The order row contains each model's single aggregate; item booleans preserve why a line qualified without duplicating the line for each model.

### `commerce_revenue_state_transitions`

Append-only audit log: `id`, `attributed_order_id`, `from_state`, `to_state`, sanitized raw status tuple, `reason_code`, `observed_at`, `created_at`, and unique reconciliation fingerprint. No monetary or customer payload is required. This separates immutable history from the current state.

All tables: RLS enabled; revoke all from `anon` and `authenticated`; no browser policies. Production server service role receives only required operations. Ledger creation needs SELECT/INSERT; current-state reconciliation additionally needs narrowly scoped UPDATE and transition INSERT. Admin reporting returns aggregates by default.

## Order key privacy and idempotency

The revenue ledger stores no raw order key. Compute `HMAC-SHA-256(server secret, canonical order key)` server-side; a plain hash is insufficient because order keys have a guessable domain. The HMAC secret is separate from admin/UNAS/Supabase credentials and never enters the database. Canonicalization must be minimal and deterministic—validate and use the exact accepted order key, with no case folding unless UNAS semantics prove it safe. V1 uses one stable ledger identity key and `UNIQUE(order_key_hmac)`. Key rotation is not a normal runtime operation: it requires a controlled maintenance window that atomically re-HMACs every row, advances `hmac_key_version`, verifies uniqueness, and prevents old-key writers. Merely switching the key for new writes is forbidden because it would break cross-version idempotency.

Database uniqueness and transactions provide restart/deploy/multi-tab safety:

- one proof creates at most one attributed order (`UNIQUE proof_id`);
- one normalized order creates at most one ledger row (`UNIQUE order_key_hmac` under the single active identity key);
- one source line is stored once (`UNIQUE attributed_order_id, line_ordinal`);
- model totals are fixed columns, not increment operations;
- insert uses conflict-safe create/read semantics;
- reconciliation uses a unique fingerprint and state-version compare-and-set in one transaction;
- repeated proof/callback/page refresh and concurrent workers return the existing result;
- reversal changes state, never appends the revenue amount again.

## Immutable evidence versus current state

Attribution linkage, source amounts, currency, initial status, line classification, recommendation/click evidence, and model qualification are immutable after ledger creation. Corrections require new reviewed evidence/versioning, not silent overwrite. Current raw status, normalized revenue state, and transition timestamps may change through reconciliation. The append-only transition log preserves every accepted change.

## Reporting contract

Every response is grouped by currency and never converted or summed across currencies:

```text
{
  window: {from, to},
  groups: [{
    currency,
    attributedProductRevenueMinor,
    recommendedProductRevenueMinor,
    assistedOrderRevenueMinor,
    provisionalRevenueMinor,
    confirmedRevenueMinor,
    reversedRevenueMinor,
    attributedOrderCount,
    confirmedOrderCount,
    averageAttributedOrderValueMinor,
    topAttributedSkus: [{sku, revenueMinor, orderCount}]
  }]
}
```

`attributedProductRevenue` means `PRODUCT_ATTRIBUTED`; `recommendedProductRevenue` is the primary `RECOMMENDED_PRODUCT_ATTRIBUTED` KPI. State-specific revenue must declare which model it applies to; the default is the primary model. `assistedOrderRevenue` remains visibly separate. Average is computed within one currency using an explicit exact rounding rule. Admin output should be aggregate-first; SKU is permitted only in authorized technical reporting.

## Test matrix and acceptance expectations

| Case | Expected result |
|---|---|
| one matched recommended+clicked product | primary and product model recognize line once |
| matched product + shipping/payment fee | fees excluded from product KPIs; included only in assisted gross |
| multiple matched products | each line once; exact sum |
| matched + unmatched product | only matched product attributed; full gross assisted |
| duplicate click/recommendation | no monetary duplication |
| repeated proof/callback/page refresh/multiple tabs | existing ledger row returned |
| concurrent recognition | one DB winner, identical readback |
| restart/deploy | durable identical result |
| same SKU quantity > 1 / multiple lines | exact validated line sum once per line |
| recommendation without click | neither product model recognizes |
| click without recommendation | product model only; primary model does not recognize |
| unknown technical line | excluded; `needs_review` when totals are affected |
| malformed/missing quantity or price | fail closed / `needs_review` |
| zero product amount | zero contribution plus reviewed flag |
| negative product amount | fail closed / `needs_review` |
| missing currency | no recognition / `needs_review` |
| audited foreign currency | separate currency group; exact exponent |
| provisional status | stored but excluded from confirmed totals |
| audited confirmed status | provisional → confirmed once |
| audited canceled/full-refund status | eligible state → reversed once |
| unknown status | `unknown`, excluded from confirmed totals |
| malformed/conflicting status | `needs_review` |
| repeated reconciliation | no-op and no duplicate transition |
| invalid transition | rejected / `needs_review` |
| partial refund/return/correction | `needs_review`; no invented amount |
| explicit vs derived line mismatch | `needs_review` |
| order gross vs classified line inconsistency | `needs_review` |
| PII/raw XML/browser monetary field | rejected/not persisted/not returned |

Tests must cover pure exact-decimal parsing and classification, model qualification, database uniqueness under concurrency, adapter restart, state transitions, RLS/grants, API authorization, PII absence, and full existing attribution/order-proof regression.

## V1 / V2 boundary

V1 may implement server-side UNAS monetary parsing, exact classification for audited line IDs, immutable ledger creation, the three separated models, provisional state, manually invoked read-only reconciliation interface, audited confirmed/cancel/full-refund mappings, aggregate currency-separated reporting, and DB idempotency. Implementation remains blocked until quantity-greater-than-one price semantics and the concrete Vitalis confirmed/cancel status mappings are audited.

V2 contains partial refunds, partial returns, quantity/price corrections, allocation of order-level discounts, automated polling/cron, currency conversion, advanced multi-touch attribution, and external analytics/dashboard integrations. None is implicitly enabled by V1.

## Privacy and security gate

Forbidden everywhere in the ledger: customer name/ID, email, phone, billing/shipping address, payment instrument or transaction identifier, chat content, client price, raw order key, and full/raw UNAS XML. Indirect identifiers (`attribution_id`, SKU, timestamps, order HMAC) require retention, access logging, purpose limitation, and aggregate-first reporting. No browser access is permitted.
