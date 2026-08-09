# UNAS Browser → Order Bridge — telepítési és rollback csomag

Ez a jelenleg aktív, sikeres E2E rendelésben bizonyított konfiguráció. Aktív: Vitalis Attribution Lifecycle, Vitalis UNAS Order Bridge és Vitalis Order Bridge Runner. A két régi E2E TEST ScriptTag inaktív; az aktív telepítést ne bontsd vissza.

## Pontos script-konfiguráció és sorrend

Az UNAS admin külső JavaScript/script-oldal funkciójában HTTPS URL-lel, `defer` betöltéssel:

1. Termékoldal, kosár, checkout és `order_send`: `https://<VITALIS_BACKEND>/attribution-lifecycle.js`
2. Azokon az oldalakon, ahol a chatnak meg kell jelennie: a meglévő Vitalis embed/widget script, a lifecycle után.
3. Kizárólag `order_send`: `https://<VITALIS_BACKEND>/unas-order-bridge.js`, a lifecycle után.
4. Kizárólag `order_send`: a body-end runner `DOMContentLoaded` után hívja a `VitalisUnasOrderBridge.runOrderBridge()` függvényt, így a deferred lifecycle és bridge már inicializálódott.

Más oldalon a bridge scriptet és az indító hívást ne add meg. Az endpoint origin allowlistjének tartalmaznia kell a tényleges webshop origint; Render environment változót ebben a körben nem módosítottunk.

## Rollback / eltávolítás

1. Tiltsd le az `order_send` indító hívást.
2. Távolítsd el az `order_send` bridge ScriptTaget.
3. Teljes visszavonáskor ezután távolítsd el a lifecycle és a kapcsolódó widget ScriptTaget.
4. A meglévő proof/event adatot ne töröld automatikusan; megőrzéséről külön adatkezelési döntés szükséges.

## Első valódi tesztrendelés checklist

- Minden automatikus teszt PASS, a backend HTTPS-en elérhető, a webshop origin engedélyezett, a szerveroldali UNAS hitelesítés működik.
- Privát böngészőben: chat megnyitás → ajánlás → termékkártya-kattintás.
- Ellenőrizd, hogy azonos `attributionId` alatt létrejött a SKU-t tartalmazó `product_clicked` esemény.
- Pontosan a kattintott SKU-jú terméket tedd kosárba, és fejezd be az elkülöníthető tesztrendelést.
- A böngésző Network paneljén ellenőrizd: az `order_send` callback egyszer fut, és pontosan a négy engedélyezett mezőt küldi.
- Első válasz elvárt eredménye: `{ "ok": true, "verified": true, "duplicate": false }`.
- Kontrollált ismétlés elvárt eredménye: `{ "ok": true, "verified": true, "duplicate": true }`, második proof rekord nélkül.
- Szerveroldalon igazold az UNAS Order Key egyezést, a nem üres Order ID-t és legalább egy, a kattintott SKU-val egyező valódi rendelési tételt.
- A rendelés után távolítsd el vagy tiltsd le a teszt bridge-et, ha nem maradhat aktív.
- Az eredményt kizárólag Browser → Order technikai korrelációként dokumentáld; revenue attributionként ne.
