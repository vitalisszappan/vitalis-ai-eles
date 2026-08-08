# UNAS Browser → Order Bridge E2E telepítési csomag

Előkészített, de nem telepített PoC. A helyi/Render fájltárolás nem production persistence. Production gate: Supabase-tárolás és adatbázis `UNIQUE(schema_version, attribution_id, order_key)` constraint.

## Konfiguráció és sorrend

Az UNAS adminban külső JavaScriptként, `defer` betöltéssel add meg a Vitalis backend HTTPS URL-jeit. Az `attribution-lifecycle.js` a termékoldalon, kosárban, checkoutban és `order_send` oldalon fusson. Az `unas-order-bridge.js` és a `VitalisUnasOrderBridge.runOrderBridge()` hívás kizárólag az `order_send` oldalon fusson.

1. `https://<VITALIS_BACKEND>/attribution-lifecycle.js`
2. meglévő Vitalis embed/widget script
3. csak `order_send`: `https://<VITALIS_BACKEND>/unas-order-bridge.js`
4. csak `order_send`: `VitalisUnasOrderBridge.runOrderBridge()`

Az endpoint allowlistjének tartalmaznia kell a tényleges webshop origint. Ebben a körben Render environment változó nem módosítható.

## Rollback

Először tiltsd le/távolítsd el az `order_send` indító snippetet, majd a bridge ScriptTaget. A teljes PoC visszavonásakor utána távolítsd el a lifecycle és widget ScriptTaget is. A proof logot őrizd meg auditálásra.

## Első valódi rendelés checklist

- Minden automatikus teszt PASS; a backend HTTPS-en elérhető, az origin engedélyezett és a szerveroldali UNAS API-kulcs működik.
- Privát böngészőben: chat megnyitása → ajánlás → termékkártya-kattintás.
- Ellenőrizd, hogy a `product_clicked` esemény ugyanahhoz az `attributionId`-hoz és a kattintott SKU-hoz került be.
- Pontosan ezt a terméket tedd kosárba, majd fejezd be az elkülöníthető tesztrendelést.
- Ellenőrizd, hogy az `order_send` bridge egyszer fut, és csak `orderKey`, `attributionId`, `schemaVersion`, `timestamp` mezőt küld.
- Első válasz: `ok:true, verified:true, duplicate:false`; ismétlés: `ok:true, verified:true, duplicate:true`, második rekord nélkül.
- Ellenőrizd szerveroldalon az Order ID-t és legalább egy egyező SKU-t.
- Ne értelmezd a tesztet revenue attributionként vagy production bizonyítékként.
