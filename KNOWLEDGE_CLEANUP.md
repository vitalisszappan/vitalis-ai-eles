# Vitalis Knowledge Cleanup 1.0

## Adatút és tárolás

A chatbot a beszélgetést a `data/logs/conversations.jsonl` fájlba menti, és konfigurált Supabase esetén a `chat_conversations` táblába is. Ugyanebből a biztonságosan szűkített rekordból készül a determinisztikus Knowledge Task. Supabase mellett a `knowledge_tasks` az elsődleges tároló; nélküle a `data/logs/knowledge-tasks.jsonl` fejlesztői fallback használatos.

Az új queue csak review-metaadatot kezel. Nem ír a `knowledge.json`, az expert rules, a canonical mapping vagy a product registry fájlokba, és nem indít deployt.

## Supabase migráció (kézi)

1. Nyisd meg a Supabase projekt SQL Editorát.
2. Ellenőrizd, majd kézzel futtasd a `SUPABASE_KNOWLEDGE_TASKS.sql` tartalmát.
3. Indítsd újra az alkalmazást a már meglévő `SUPABASE_URL` és `SUPABASE_SERVICE_ROLE_KEY` beállításokkal.

A fájl nem tartalmaz projektazonosítót vagy kulcsot. A tábla RLS-sel védett, publikus policy nélkül.

A Knowledge Cleanup 1.1 új mezőihez ezután kézzel futtasd a `SUPABASE_KNOWLEDGE_TASKS_1_1.sql` fájlt. Az elkülönített migráció biztonságosan alkalmazható akkor is, ha az 1.0 séma időközben már létrejött.

## Backfill

Helyi előnézet (alapértelmezett, nem ír):

```powershell
node scripts/backfill-knowledge-tasks.cjs
```

Helyi JSONL kiírás csak kifejezett kapcsolóval:

```powershell
node scripts/backfill-knowledge-tasks.cjs --write
```

Az admin API `POST /api/admin/knowledge-tasks/backfill` végpontja szintén dry-run, amíg a JSON body nem `{ "write": true }`. Az admin token kötelező. A stabil normalizált kulcs és az upsert miatt a futás idempotens; az eredeti beszélgetéseket nem módosítja.
