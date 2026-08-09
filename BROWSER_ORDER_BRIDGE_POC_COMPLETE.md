# Vitalis Browser → Order Bridge — E2E bizonyított

## Státusz

A Browser → Order kapcsolat valódi UNAS rendeléssel PoC szinten bizonyított. Rendelési referencia: `99212-377031`. A kontrollált újratöltés válasza `ok:true`, `verified:true`, `duplicate:true` volt; az első oldalbetöltés már létrehozta a proofot. A megoldás nem számol revenue-t, nem hoz létre `purchase_attributed` eseményt, és nem jelent production-ready revenue attributiont.

## Előkészített lánc

1. A böngésző UUID v4 `attributionId`-t tart fenn az attribution lifecycle-ban.
2. A chat a `/api/commerce/event` endpointon naplózza a commerce eseményeket és a `product_clicked` SKU-t.
3. Az UNAS `order_send` oldalon a bridge az `UNAS.getOrder()` eredményéből kizárólag az `orderKey`-t olvassa.
4. A browser pontosan `orderKey`, `attributionId`, `schemaVersion`, `timestamp` mezőket küld a `/api/commerce/order-proof` endpointnak.
5. A szerver a korábbi eseményeket betölti, saját UNAS hitelesítéssel lekéri a rendelést, majd Order Key, Order ID, valós terméktétel és pontos SKU-egyezés alapján ellenőriz.

## Storage gate

A JSONL proof store kizárólag LOCAL/POC ONLY; a Render ephemeral filesystem nem production persistence. Production használathoz tartós Supabase storage és `UNIQUE(schema_version, attribution_id, order_key)` adatbázis-kényszer szükséges. Ebben a körben Supabase séma nem módosult.

## Biztonsági határ

A browser nem küldhet Order ID-t, SKU-t, terméklistát, mennyiséget, árat, revenue-t, státuszt, PII-t, chat-tartalmat, URL/query adatot vagy titkot. Ismeretlen mező 400 választ kap. Az UNAS teljes order objektuma és PII-mezői nem kerülnek proof storage-ba.

## Bizonyított scope

A bizonyított lánc: browser attribution → `product_clicked` → checkout → valós UNAS order → szerveroldali `getOrder` → Order Key / Order ID / SKU-egyezés → idempotens proof. Ez nem bizonyít kauzalitást vagy pénzügyi attributiont.
