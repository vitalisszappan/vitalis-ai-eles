# Verified Commerce Outcome

## Audit és működő adatfolyam

- Az `attributionId` a browser lifecycle-ban keletkezik, majd minden commerce eseményben szerepel.
- A widget ugyanabban az eseményben küldi a `chatSessionId` értéket; ez a `chat_conversations.session_id` technikai kulcsához kapcsolható.
- Az AI-ajánlás `product_recommended`, a kattintás `product_clicked` esemény. Mindkettő tartalmazhat canonical product ID-t, UNAS product ID-t és SKU-t.
- A szerveroldali order proof az UNAS Order Key, Order ID és rendelési SKU alapján ellenőriz.
- A nyers proof és a knowledge adatok között korábban nem volt üzleti outcome-réteg. Ezt a `commerce_outcomes` vezeti be; a knowledge rendszer nem módosul automatikusan.

## `verified_order` jelentése

A `verified_order` azt jelenti, hogy egy korábbi `product_clicked` SKU legalább egy valós terméktétel SKU-jával megegyezett egy szerveroldali UNAS `getOrder` lekérésben, az Order Key egyezik és az Order ID nem üres. Az outcome PII-, price- és revenue-mentes.

Nem jelenti azt, hogy az AI okozta a vásárlást, hogy pénzügyi/revenue attribution történt, vagy hogy egy termék általánosan jobb ajánlás. Nem módosít Decision Engine-, knowledge-, draft- vagy expert-rule adatot.

## Conversation kapcsolat

Az outcome a releváns recommendation/click commerce események `chat_session_id` értékeit tartalmazza. Ezek determinisztikusan visszakereshetők a conversation store `session_id` mezőjével. Pontos message/conversation-row ID jelenleg nincs a commerce event contractban, ezért ilyen kapcsolatot a rendszer nem talál ki. Hiányzó session esetén az outcome érvényes marad üres `conversationSessionIds` listával.

## Learning signal

A `recommendation_converted` signal kizárólag tárolt `verified_order` outcome-ból vezethető le. Jelentése: clicked SKU egyezett szerveroldalon igazolt rendelési SKU-val. `autonomousActionAllowed=false`; a signal review-evidence, nem automatikus tudásmódosítás.

## Persistence és idempotencia

Az outcome determinisztikus ID-t kap az Order Key alapján, és a production tábla `UNIQUE(schema_version, order_key)` kényszert használ. A JSONL adapter LOCAL/POC ONLY.

A `public.commerce_outcomes` tartós production persistence PRODUCTION PROVEN a Render runtime tényleges, `pupbsyzijirixcvbjbgp` refű Supabase projektjében. A lezáró evidence: Order Key `99212-636298`, attribution ID `4738e0e8-315a-435a-9a7c-cf025c3e8992`, outcome ID `6a59f8a4-0bea-5ea0-be36-b5e3e712a542`, UNAS Order ID `365099806`, outcome type `verified_order`, matched SKU `VEM02`. A korábban vizsgált másik Supabase projekt nem a Render production adatbázisa.

## Admin ellenőrzés

Az admin felület „Igazolt kereskedelmi eredmények” szekciója a hitelesített `GET /api/admin/commerce/outcomes` endpointból mutatja az order reference-t, attributiont, Order ID-t, matched SKU-kat, sessionöket, recommendation/click evidence darabszámát, timestampet és learning signalt.

## Revenue gate

Revenue attribution csak külön production evidence után tervezhető: bizonyított UNAS PriceGross unit/line szemantika, bizonyított business-status mapping, visszatérítés/törlés kezelése, pénzügyi adatmodell és külön jóváhagyott idempotens persistence szükséges.
