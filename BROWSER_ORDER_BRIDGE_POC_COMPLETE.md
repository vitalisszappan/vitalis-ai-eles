# Vitalis Browser → Order → Commerce Outcome — production E2E bizonyított

## Státusz

A teljes Browser → Order → Commerce Outcome lánc valódi UNAS rendeléssel productionben bizonyított. A lezáró production evidence rendelési referenciája `99212-636298`, attribution azonosítója `4738e0e8-315a-435a-9a7c-cf025c3e8992`. A szerveroldali proof verified, a tartós outcome `verified_order` típussal, `6a59f8a4-0bea-5ea0-be36-b5e3e712a542` outcome ID-val, `365099806` Order ID-val és `VEM02` matched SKU-val létrejött.

A Render production runtime tényleges Supabase projektje: `pupbsyzijirixcvbjbgp`. A korábban vizsgált másik Supabase projekt nem a Render production adatbázisa, ezért annak objektumállapota nem tekinthető production evidence-nek.

A megoldás továbbra sem számol revenue-t, nem hoz létre `purchase_attributed` eseményt, és nem jelent production-ready revenue attributiont vagy bizonyított kauzalitást.

## Előkészített lánc

1. A böngésző UUID v4 `attributionId`-t tart fenn az attribution lifecycle-ban.
2. A chat a `/api/commerce/event` endpointon naplózza a commerce eseményeket és a `product_clicked` SKU-t.
3. Az UNAS `order_send` oldalon a bridge az `UNAS.getOrder()` eredményéből kizárólag az `orderKey`-t olvassa.
4. A browser pontosan `orderKey`, `attributionId`, `schemaVersion`, `timestamp` mezőket küld a `/api/commerce/order-proof` endpointnak.
5. A szerver a korábbi eseményeket betölti, saját UNAS hitelesítéssel lekéri a rendelést, majd Order Key, Order ID, valós terméktétel és pontos SKU-egyezés alapján ellenőriz.

## Production persistence

A `public.commerce_order_proofs` production persistence és a `UNIQUE(schema_version, attribution_id, order_key)` adatbázis-alapú idempotencia PRODUCTION PROVEN. A `public.commerce_outcomes` production persistence és a `UNIQUE(schema_version, order_key)` outcome-idempotencia szintén PRODUCTION PROVEN. Mindkettő a `pupbsyzijirixcvbjbgp` Supabase projektben bizonyított. A JSONL adapterek változatlanul LOCAL/POC ONLY megoldások; a Render ephemeral filesystem nem production persistence.

## Biztonsági határ

A browser nem küldhet Order ID-t, SKU-t, terméklistát, mennyiséget, árat, revenue-t, státuszt, PII-t, chat-tartalmat, URL/query adatot vagy titkot. Ismeretlen mező 400 választ kap. Az UNAS teljes order objektuma és PII-mezői nem kerülnek proof storage-ba.

## Production-proven lánc

A bizonyított lánc: chat → `product_recommended` → `product_clicked` → checkout → `order_send` → szerveroldali UNAS `getOrder` → Order Key / Order ID / SKU-egyezés → tartós verified proof → `verified_order` commerce outcome → tartós Supabase persistence.

## Gate státusz

### PRODUCTION PROVEN

- Browser attribution és commerce event lánc valós storefront használatban.
- Szerveroldali UNAS Order Key / Order ID / SKU verification.
- `commerce_order_proofs` tartós Supabase persistence és duplicate/idempotent út.
- `commerce_outcomes` tartós Supabase persistence.
- PII-, price- és revenue-mentes `verified_order` outcome.

### CODE PROVEN

- Outcome determinisztikus ID-képzése és `UNIQUE(schema_version, order_key)` konfliktuskezelése.
- Sanitizált, fázisonkénti commerce outcome diagnosztika.
- Outcome-alapú, nem autonóm `recommendation_converted` learning signal.
- Admin outcome read modell és kliensoldali belsőhiba-szigetelés.

### NOT PROVEN

- Külső riasztás és tartós operációs monitorozás a commerce/outcome storage hibáira.
- Automatizált retention végrehajtás, törlési audit és production backup/restore próba.
- Nagyobb volumenű, konkurens production retry/idempotencia terhelés.
- Hosszabb időablakú production stabilitás és outcome reconciliation.

### Nem része ennek a PoC-nak

- Kauzalitás bizonyítása és pénzügyi/revenue attribution.
- `purchase_attributed`, GA4 revenue linking és marketing dashboardok.
- Refund, cancellation, partial return és revenue state reconciliation.
- Automatikus knowledge-, Decision Engine- vagy expert-rule módosítás.
