# UNAS Browser → Order Bridge — előkészített telepítési csomag

**NINCS TELEPÍTVE.** Az alábbi konfigurációt csak az automatikus tesztek sikeres futása után, az első valódi tesztrendeléshez kell kézzel létrehozni az UNAS adminban.

## Script-oldalak és pontos sorrend

HTTPS URL-eket és `defer` betöltést használva:

1. Termékoldal, kosár, checkout és `order_send`: `https://<VITALIS_BACKEND>/attribution-lifecycle.js`.
2. A chat megjelenési oldalain: a meglévő Vitalis embed/widget script, a lifecycle után.
3. Kizárólag `order_send`: `https://<VITALIS_BACKEND>/unas-order-bridge.js`, a lifecycle után.
4. Kizárólag `order_send`: body-end runner, amely a DOM elkészülte után egyszer meghívja a `window.VitalisUnasOrderBridge.runOrderBridge()` függvényt.

Javasolt runner:

```html
<script>
  window.addEventListener('DOMContentLoaded', function () {
    if (window.VitalisUnasOrderBridge) {
      window.VitalisUnasOrderBridge.runOrderBridge();
    }
  }, { once: true });
</script>
```

A bridge scriptet és a runnert más oldaltípushoz nem szabad hozzárendelni. Az endpoint allowlistjének már a tényleges, pontos webshop origint kell tartalmaznia; Render environment változót ez a csomag nem módosít.

## Rollback / eltávolítás

1. Tiltsd le vagy töröld az `order_send` runnert.
2. Távolítsd el az `order_send` bridge ScriptTaget.
3. Ha a teljes próbát visszavonod, ezután távolítsd el az új lifecycle hozzárendeléseket is; a korábban működő widget konfigurációt ne változtasd meg indokolatlanul.
4. Proof- és event-adatot ne törölj automatikusan.

## Első valódi tesztrendelés checklist

- Az `npm test`, minden érintett fájl `node --check` vizsgálata és a `git diff --check` PASS.
- A backend HTTPS-en elérhető; a webshop pontos originje engedélyezett; a szerveroldali UNAS login/getOrder működik.
- Privát böngészőben: chat → termékajánlás → termékkártya-kattintás → UNAS termékoldal → kosár → checkout.
- Ugyanahhoz az attribution ID-hoz létrejött a kattintott SKU-t tartalmazó `product_clicked` esemény.
- A kattintott SKU-jú termékkel fejezd be az elkülöníthető tesztrendelést.
- A Network panelen az `order_send` callback egyszer fut, és pontosan a négy engedélyezett mezőt küldi.
- Első válasz: `{ "ok": true, "verified": true, "duplicate": false }`.
- Kontrollált ismétlés: `{ "ok": true, "verified": true, "duplicate": true }`, második proof rekord nélkül.
- Szerveroldalon igazold az Order Key egyezést, a nem üres Order ID-t és legalább egy pontos clicked-SKU egyezést.
- Ne rögzíts vagy publikálj PII-t; az eredményt kizárólag Browser → Order technikai korrelációként dokumentáld.

Sikeres valódi teszt előtt a Browser → Order kapcsolat nem tekinthető PoC szinten bizonyítottnak.
