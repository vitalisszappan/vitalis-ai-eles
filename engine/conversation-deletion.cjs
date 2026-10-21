'use strict';

const fs = require('fs');
const path = require('path');

const PROTECTED_SESSION_IDS = new Set(['admin-knowledge-builder']);
const DELETE_ALL_CONFIRMATION = 'TÖRLÉS';

function isDeletableSessionId(value, validSessionId) {
  const sessionId = String(value || '');
  return Boolean(validSessionId(sessionId)) && !PROTECTED_SESSION_IDS.has(sessionId);
}

function isCustomerConversationRow(row) {
  return row && row.session_id !== 'admin-knowledge-builder'
    && !['approved-knowledge', 'dismissed-gap'].includes(row.source);
}

function parseJsonLines(text) {
  return String(text || '').split(/\r?\n/).filter(Boolean).map((line) => {
    try { return { line, row: JSON.parse(line) }; }
    catch { return { line, row: null }; }
  });
}

function planLocalDeletion(filePath, shouldDelete, fsImpl = fs) {
  if (!fsImpl.existsSync(filePath)) return { deletedCount: 0, apply() {} };
  const original = fsImpl.readFileSync(filePath, 'utf8');
  const entries = parseJsonLines(original);
  const kept = entries.filter(({ row }) => !row || !shouldDelete(row));
  const deletedCount = entries.length - kept.length;
  const next = kept.length ? `${kept.map(({ line }) => line).join('\n')}\n` : '';

  return {
    deletedCount,
    apply() {
      if (!deletedCount) return;
      const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
      try {
        fsImpl.writeFileSync(temporary, next, 'utf8');
        fsImpl.renameSync(temporary, filePath);
      } catch (error) {
        try { if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary); } catch {}
        throw error;
      }
    }
  };
}

function createConversationDeletionService({ localPath, validSessionId, remote = null, fsImpl = fs } = {}) {
  if (!localPath || typeof validSessionId !== 'function') throw new Error('conversation_deletion_configuration_invalid');

  async function execute({ sessionId = null, all = false } = {}) {
    if (!all && !isDeletableSessionId(sessionId, validSessionId)) {
      const error = new Error('invalid_conversation_session_id');
      error.code = 'invalid_conversation_session_id';
      throw error;
    }

    const matches = all
      ? isCustomerConversationRow
      : (row) => row?.session_id === sessionId && isDeletableSessionId(row.session_id, validSessionId);
    const localPlan = planLocalDeletion(localPath, matches, fsImpl);
    let remoteRows = [];

    try {
      if (remote) remoteRows = await (all ? remote.deleteAll() : remote.deleteSession(sessionId));
      if (!Array.isArray(remoteRows)) throw new Error('invalid_conversation_delete_response');
      localPlan.apply();
    } catch (error) {
      if (remoteRows.length && remote?.restore) {
        try { await remote.restore(remoteRows); }
        catch (rollbackError) { error.rollbackFailed = true; error.rollbackError = rollbackError; }
      }
      throw error;
    }

    const deletedCount = remote ? remoteRows.length : localPlan.deletedCount;
    if (!all && deletedCount === 0 && localPlan.deletedCount === 0) {
      const error = new Error('conversation_not_found');
      error.code = 'conversation_not_found';
      throw error;
    }
    return { deletedCount: Math.max(deletedCount, localPlan.deletedCount), sessionId: all ? null : sessionId };
  }

  return {
    deleteSession: (sessionId) => execute({ sessionId }),
    deleteAll: () => execute({ all: true })
  };
}

function createAdminConversationDeletionHandler({ authorize, service, parseBody, sendJson, logger = console } = {}) {
  return async function handle(req, res, url, sessionId = null) {
    if (!authorize(req, res, url, { allowQueryToken: false })) return;
    try {
      let result;
      if (sessionId === null) {
        let parsed;
        try { parsed = JSON.parse((await parseBody(req, 4096)) || '{}'); }
        catch { return sendJson(res, 400, { ok: false, error: 'Hibás megerősítés.' }); }
        if (parsed.confirmation !== DELETE_ALL_CONFIRMATION) {
          return sendJson(res, 400, { ok: false, error: `A megerősítéshez pontosan ezt írd be: ${DELETE_ALL_CONFIRMATION}` });
        }
        result = await service.deleteAll();
      } else {
        result = await service.deleteSession(sessionId);
      }
      return sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      logger.error('CONVERSATION DELETE FAILED', {
        operation: sessionId === null ? 'conversation_delete_all' : 'conversation_delete_session',
        code: error?.code || 'delete_failed',
        rollbackFailed: error?.rollbackFailed === true
      });
      if (error?.code === 'invalid_conversation_session_id') return sendJson(res, 400, { ok: false, error: 'Érvénytelen beszélgetés-azonosító.' });
      if (error?.code === 'conversation_not_found') return sendJson(res, 404, { ok: false, error: 'A beszélgetés nem található.' });
      return sendJson(res, 500, { ok: false, error: 'A törlés nem sikerült. A lista nem változott.' });
    }
  };
}

function removeSessionFromVisibleList(items, sessionId) {
  return (Array.isArray(items) ? items : []).filter((item) => item?.session_id !== sessionId);
}

module.exports = {
  DELETE_ALL_CONFIRMATION,
  PROTECTED_SESSION_IDS,
  isDeletableSessionId,
  isCustomerConversationRow,
  planLocalDeletion,
  createConversationDeletionService,
  createAdminConversationDeletionHandler,
  removeSessionFromVisibleList
};
