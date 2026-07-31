# Vitalis Knowledge Builder 3.0

## Workflow

1. Az admin megnyit egy Knowledge Queue feladatot és a **Draft megnyitása / létrehozása** műveletet.
2. A szerver determinisztikusan keres használható forrást ebben a sorrendben: pontos admin intent, pontos expert szabály, approved canonical adat, pontos approved knowledge, approved termékhasználati információ.
3. Biztonságos forrás nélkül `manual_required` draft készül `Kiegészítés szükséges.` tartalommal. Ez önmagában nem hagyható jóvá exportra.
4. A reviewer szerkesztheti a kérdést, választ, kulcsszavakat, kategóriát, approved canonical ID-ket, confidence és safety értéket, valamint a belső megjegyzést.
5. A draft `in_review`, majd biztonságos tartalom esetén `approved_for_import` állapotba tehető.
6. Az export kizárólag az `approved_for_import` draftokat tölti le `knowledge-import.json` formában, majd `exported` állapotba teszi őket. A kapcsolódó task nem lesz automatikusan `resolved`.

## Biztonsági szabályok

- Solved és irrelevant taskhoz nem készül új draft.
- Gyermekbiztonsági, egészségügyi, ambiguous, unknown, expert-bypass és nem approved canonical eset automatikusan manual review-t igényel.
- UNAS kereskedelmi leírás, történeti fallback és `needs_review` mapping nem használható tartalmi forrásként.
- A canonical ID-ket a mentéskor is újra validálja a szerver.
- Kézzel módosított draftot az újragenerálás csak explicit megerősítéssel írhat felül.
- Az export nem tartalmaz reviewerNote-ot, titkot vagy nem jóváhagyott draftot, és az e-mail-címeket maszkolja.

## Tárolás és migráció

Élesben a `knowledge_drafts` Supabase-tábla az elsődleges tároló. A [SUPABASE_KNOWLEDGE_DRAFTS.sql](SUPABASE_KNOWLEDGE_DRAFTS.sql) fájlt kézzel kell ellenőrizni és futtatni az 1.0/1.1 Knowledge Task migrációk után. Az alkalmazás nem futtat migrációt.

Supabase nélkül a `data/logs/knowledge-drafts.jsonl` fallback működik. Stabil task/draft ID alapján upsertel, a sérült JSONL-sorokat kihagyja, és nem tárol hitelesítési adatot.

## Amit még nem végez automatikusan

- nem ír `knowledge.json` fájlba;
- nem hoz létre vagy módosít expert szabályt, canonical rekordot vagy alias-regisztert;
- nem importál draftot a chatbot runtime tudásába;
- nem deployol.

A következő biztonságos fejlesztési lépés egy külön import-preview és diff folyamat, amely az exportot séma- és szakmai ellenőrzés után, újabb explicit admin jóváhagyással készíti elő importálásra.
