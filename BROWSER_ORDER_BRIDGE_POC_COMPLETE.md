# Vitalis Browser → Order Bridge — E2E proof előkészítés

## Státusz

Az E2E proof technikai előkészítése elkészült. A Browser → Order kapcsolat még nincs PoC szinten bizonyítva: ehhez egy valódi UNAS tesztrendelés sikeres, dokumentált E2E futása szükséges.

Ez a kör nem számol revenue-t, nem hoz létre `purchase_attributed` eseményt, és nem állítja, hogy production-ready revenue attribution készült.

## Browser contract

`POST /api/commerce/order-proof`, `application/json`, legfeljebb 2048 byte. A body pontosan négy mezőből áll:

```json
{
  "orderKey": "...",
  "attributionId": "...",
  "schemaVersion": 1,
  "timestamp": "..."
}
```

Ismeretlen vagy hiányzó mező hibás kérés. A kliens nem küldhet Order ID-t, SKU-t, terméklistát, quantity/price/revenue/status adatot, PII-t, chat-tartalmat, URL/query adatot vagy titkot.

## Szerveroldali ellenőrzés

Az `engine/unas-order-verifier.cjs` a meglévő szerveroldali UNAS login használatával `getOrder` kérést küld a megadott Key-re. A válaszból kizárólag az Order Key, Id, Date, valamint az Item Id és Sku mezőket tartja meg; Customer, Contact, cím, megjegyzés és más PII nem kerül a proof modellbe vagy storage-ba.

`verified=true` csak akkor lehet, ha a request érvényes, van korábbi attribution és `product_clicked` esemény, a szerveroldali UNAS kérés pontosan egy azonos Key-jű, nem üres Id-jű rendelést ad, van valós terméktétel SKU-val, és legalább egy rendelési SKU pontosan egyezik egy korábban kattintott SKU-val. Terméknév-alapú következtetés nincs.

## Idempotencia és persistence gate

Az idempotency key: `schemaVersion + attributionId + orderKey`. Az első sikeres proof `duplicate:false`, az ismétlés `duplicate:true`, második rekord nélkül.

A JSONL proof store **LOCAL/POC ONLY**. A Render ephemeral filesystem nem production persistence. A production gate változatlanul tartós Supabase storage és adatbázis-szintű UNIQUE constraint; ebben a körben Supabase séma nem módosult.

## Biztonsági korlátok

A proof endpoint kizárólag POST és JSON, szigorú Vitalis webshop-origin allowlistet, byte-alapú méretkorlátot, rate limitet, UUID v4-et, XML-biztos legfeljebb 100 karakteres order Key-t, valamint egy helyen konfigurált, alapértelmezetten ±5 perces timestamp toleranciát használ. A technikai hibák nem jelennek meg a vásárlónak, és a bridge nem logolja az UNAS válaszát.
