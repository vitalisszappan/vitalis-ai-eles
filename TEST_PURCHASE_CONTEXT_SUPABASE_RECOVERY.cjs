'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installCatalogFixture } = require('./test/helpers/install-catalog-fixture.cjs');

const restoreCatalogFixture = installCatalogFixture(path.join(__dirname, 'test', 'fixtures', 'knowledge-builder-catalog.json'));
process.once('exit', restoreCatalogFixture);

const { createAnswer } = require('./engine/answer-service.cjs');
const { rehydrateSessionHistory } = require('./engine/conversation-memory.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const knowledge = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'knowledge.json'), 'utf8'));
const ruleEngine = new ExpertRuleEngine(path.join(__dirname, 'data', 'rules', 'expert-rules.json'));
const SESSION_A = 'session-supabase-recovery-a';
const SESSION_B = 'session-supabase-recovery-b';
const row = (created_at, question, answer, source = 'answer') => ({ created_at, question, answer, source });
const recover = (sessionId, rowsBySession) => rehydrateSessionHistory({
  sessionId,
  clientHistory: [],
  loadRows: async (id, limit) => (rowsBySession[id] || []).slice(-limit).reverse()
});
const ask = (question, memory) => createAnswer({ question, history: memory.history, conversationState: memory.state, knowledge, ruleEngine, logGap() {} });

(async () => {
  // 1. Explicit user-termék Supabase-only recoveryből.
  let rows = [row('2026-08-24T10:00:00Z', 'A Dermavital krémet szeretném.', 'Rendben.')];
  let memory = await recover(SESSION_A, { [SESSION_A]: rows });
  let result = ask('Ezt akarom megrendelni.', memory);
  assert.equal(memory.state.purchaseProductId, 'dermavital_krem');
  assert.equal(result.contextTarget, 'dermavital_krem');

  // 2. Explicit sóbalzsam target checkout-problémánál.
  rows = [row('2026-08-24T10:01:00Z', 'A Holt-tengeri só balzsamot kérem.', 'Rendben.')];
  memory = await recover(SESSION_A, { [SESSION_A]: rows });
  result = ask('Nem enged tovább.', memory);
  assert.equal(result.intent, 'checkout_problem');
  assert.equal(result.contextTarget, 'holt_tengeri_so_balzsam');

  // 3. Egyetlen pontos assistant-termék determinisztikusan használható.
  rows = [row('2026-08-24T10:02:00Z', 'Mit ajánlasz?', 'A Dermavital krémet ajánlom.')];
  memory = await recover(SESSION_A, { [SESSION_A]: rows });
  result = ask('Csak ezt kérem.', memory);
  assert.equal(memory.state.productContextStatus, 'resolved');
  assert.equal(result.contextTarget, 'dermavital_krem');

  // 4. Részben mappolható kéttermékes assistant-szöveg fail-closed.
  rows = [row('2026-08-24T10:03:00Z', 'Mit ajánlasz?', 'Dermavital krém vagy kecsketejes testápoló.')];
  memory = await recover(SESSION_A, { [SESSION_A]: rows });
  assert.equal(memory.state.productContextStatus, 'ambiguous');
  assert.equal(memory.state.purchaseProductId, null);
  result = ask('Csak ezt kérem.', memory);
  assert.equal(result.route, 'clarification');

  // 5. Ismeretlen második ID-t számozott szövegből sem talál ki.
  rows = [row('2026-08-24T10:04:00Z', 'Mutass kettőt.', '1. Dermavital krém\n2. Kecsketejes testápoló')];
  memory = await recover(SESSION_A, { [SESSION_A]: rows });
  result = ask('A másodikat kérem.', memory);
  assert.equal(result.route, 'clarification');
  assert.equal(result.contextTarget, 'product');

  // 6. Általános kategórianév nem concrete product evidence.
  rows = [row('2026-08-24T10:05:00Z', 'Krém érdekel.', 'Milyen krémet keresel?')];
  memory = await recover(SESSION_A, { [SESSION_A]: rows });
  assert.equal(memory.state.purchaseProductId, null);
  result = ask('Ezt kérem.', memory);
  assert.equal(result.contextTarget, null);

  // 7. A loader kizárólag az aktuális session sorait használja.
  rows = [row('2026-08-24T10:06:00Z', 'A Dermavital krémet szeretném.', 'Rendben.')];
  memory = await recover(SESSION_B, { [SESSION_A]: rows });
  assert.equal(memory.state.purchaseProductId, null);

  // 8. Új explicit termék felülírja a recoveryből származó régit.
  rows = [row('2026-08-24T10:07:00Z', 'A Holt-tengeri só balzsamot kérem.', 'Rendben.')];
  memory = await recover(SESSION_A, { [SESSION_A]: rows });
  result = ask('Inkább a Dermavital krémet kérem.', memory);
  assert.equal(result.contextTarget, 'dermavital_krem');

  // 9. Külön körök explicit termékei közül a legfrissebb explicit választás nyer.
  rows = [
    row('2026-08-24T10:08:00Z', 'A Dermavital krémet szeretném.', 'Rendben.'),
    row('2026-08-24T10:09:00Z', 'Inkább a Holt-tengeri só balzsamot kérem.', 'Rendben.')
  ];
  memory = await recover(SESSION_A, { [SESSION_A]: rows });
  assert.equal(memory.state.purchaseProductId, 'holt_tengeri_so_balzsam');
  result = ask('Ezt kérem.', memory);
  assert.equal(result.contextTarget, 'holt_tengeri_so_balzsam');

  // 10. A server loader 10 soros ablakán kívüli evidence kiesik.
  rows = [row('2026-08-24T09:00:00Z', 'A Dermavital krémet szeretném.', 'Rendben.')];
  for (let index = 0; index < 10; index += 1) rows.push(row(`2026-08-24T11:${String(index).padStart(2, '0')}:00Z`, `Általános kérdés ${index}.`, `Általános válasz ${index}.`));
  memory = await recover(SESSION_A, { [SESSION_A]: rows });
  assert.equal(memory.history.length, 20);
  assert.equal(memory.state.purchaseProductId, null);

  const schema = fs.readFileSync(path.join(__dirname, 'SUPABASE_BESZELGETES_MENTES.sql'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, 'server.cjs'), 'utf8');
  assert.match(schema, /session_id text not null/);
  assert.match(schema, /question text not null/);
  assert.match(schema, /answer text not null/);
  assert.doesNotMatch(schema, /\blinks\b|product_ids|routing_trace/);
  assert.match(server, /select=created_at,question,answer,source&session_id=eq\./);

  restoreCatalogFixture();
  console.log('Supabase-only purchase context recovery regressions: PASS (10/10)');
})().catch((error) => {
  restoreCatalogFixture();
  console.error(error);
  process.exitCode = 1;
});
