'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DELETE_ALL_CONFIRMATION,
  createConversationDeletionService,
  createAdminConversationDeletionHandler,
  removeSessionFromVisibleList
} = require('./engine/conversation-deletion.cjs');
const { rehydrateSessionHistory, validSessionId } = require('./engine/conversation-memory.cjs');

const sessionA = 'session-delete-0001';
const sessionB = 'session-keep-000002';
const customerRows = [
  { id: 1, session_id: sessionA, question: 'első', answer: 'válasz', history_event: { kind: 'none' } },
  { id: 2, session_id: sessionA, question: 'második', answer: 'válasz', history_event: { kind: 'none' } },
  { id: 3, session_id: sessionB, question: 'marad', answer: 'válasz' },
  { id: 4, session_id: 'admin-knowledge-builder', source: 'approved-knowledge', question: 'tudás', answer: 'megmarad' }
];

function writeRows(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}

function readRows(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

async function main() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-conversation-delete-'));
  try {
    const localPath = path.join(temporaryDirectory, 'conversations.jsonl');
    writeRows(localPath, customerRows);
    const service = createConversationDeletionService({ localPath, validSessionId });

    const single = await service.deleteSession(sessionA);
    assert.equal(single.deletedCount, 2, 'A teljes session történetét törölni kell');
    assert.deepEqual(readRows(localPath).map((row) => row.id), [3, 4], 'Csak a cél-session törlődhet');

    const memory = await rehydrateSessionHistory({
      sessionId: sessionA,
      clientHistory: [],
      loadRows: async (sessionId) => readRows(localPath).filter((row) => row.session_id === sessionId)
    });
    assert.deepEqual(memory.history, [], 'A törölt session nem hidratálódhat vissza');

    await assert.rejects(() => service.deleteSession('rossz'), /invalid_conversation_session_id/);
    assert.deepEqual(readRows(localPath).map((row) => row.id), [3, 4], 'Hibás ID nem törölhet mást');
    await assert.rejects(() => service.deleteSession('session-missing-999'), /conversation_not_found/);
    assert.deepEqual(readRows(localPath).map((row) => row.id), [3, 4], 'Nem létező ID nem törölhet mást');

    const all = await service.deleteAll();
    assert.equal(all.deletedCount, 1);
    assert.deepEqual(readRows(localPath), [customerRows[3]], 'A tudásrekordot a delete-allnak meg kell őriznie');

    writeRows(localPath, customerRows);
    const failing = createConversationDeletionService({
      localPath,
      validSessionId,
      remote: { async deleteSession() { throw new Error('supabase_down'); }, async deleteAll() { return []; } }
    });
    await assert.rejects(() => failing.deleteSession(sessionA), /supabase_down/);
    assert.equal(readRows(localPath).length, customerRows.length, 'Távoli hiba előtt a helyi lista nem változhat');

    let called = 0;
    let response = null;
    const handler = createAdminConversationDeletionHandler({
      authorize: () => false,
      service: { async deleteSession() { called += 1; }, async deleteAll() { called += 1; } },
      parseBody: async () => '{}',
      sendJson: (_res, status, body) => { response = { status, body }; },
      logger: { error() {} }
    });
    await handler({}, {}, new URL('http://localhost/api/admin/conversations/x'), sessionA);
    assert.equal(called, 0, 'Jogosulatlan kérés nem érheti el a törlési szolgáltatást');

    const confirmHandler = createAdminConversationDeletionHandler({
      authorize: () => true,
      service: { async deleteAll() { called += 1; return { deletedCount: 2 }; } },
      parseBody: async () => JSON.stringify({ confirmation: 'TORLES' }),
      sendJson: (_res, status, body) => { response = { status, body }; },
      logger: { error() {} }
    });
    await confirmHandler({}, {}, new URL('http://localhost/api/admin/conversations'));
    assert.equal(response.status, 400);
    assert.equal(called, 0, 'Pontatlan megerősítés nem indíthat delete-all műveletet');
    assert.equal(DELETE_ALL_CONFIRMATION, 'TÖRLÉS');

    assert.deepEqual(removeSessionFromVisibleList(customerRows, sessionA).map((row) => row.id), [3, 4], 'Siker után a UI session-szinten frissül');

    const html = fs.readFileSync('public/admin.html', 'utf8');
    const js = fs.readFileSync('public/admin.js', 'utf8');
    assert.match(html, /id="deleteAllConversationsButton"/);
    assert.match(html, /id="conversationDeleteDialog"/);
    assert.match(html, /id="cancelConversationDeleteButton"/);
    assert.match(js, /cancelConversationDeleteButton\.addEventListener\('click', closeConversationDeleteDialog\)/, 'A Mégse nem indít API-kérést');
    assert.match(js, /deleteConfirmationInput\?\.value !== 'TÖRLÉS'/, 'A végleges gomb pontos megerősítést igényel');
    assert.match(js, /conversations\.filter\(\(item\) => item\.session_id !== target\.sessionId\)/, 'Siker után frissül a lista és a számláló');

    console.log('TEST_CONVERSATION_DELETION: PASS');
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
