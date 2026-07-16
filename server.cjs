const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const KNOWLEDGE_PATH = path.join(DATA_DIR, 'knowledge.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const LOG_DIR = path.join(DATA_DIR, 'logs');

const PORT = Number(process.env.PORT || 3218);
const HOST = process.env.HOST || '0.0.0.0';

const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim();

const SUPABASE_URL = String(process.env.SUPABASE_URL || '')
  .trim()
  .replace(/\/$/, '');

const SUPABASE_SERVICE_ROLE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
).trim();

const CONVERSATION_LOG = path.join(LOG_DIR, 'conversations.jsonl');

for (const dir of [DATA_DIR, BACKUP_DIR, LOG_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

let knowledge = [];
let loadedAt = null;

function loadKnowledge() {
  const raw = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8'));

  const items = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.items)
      ? raw.items
      : null;

  if (!items) {
    throw new Error('A knowledge.json nem megfelelő formátumú.');
  }

  knowledge = items.filter(
    (item) => item && typeof item === 'object' && item.id
  );

  loadedAt = new Date().toISOString();
}

loadKnowledge();

const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { createAnswer } = require('./engine/answer-service.cjs');

const RULE_PATH = path.join(DATA_DIR, 'rules', 'expert-rules.json');
const ruleEngine = new ExpertRuleEngine(RULE_PATH);

function anonymizeText(value, max = 4000) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max);
}

function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

async function persistConversation(record) {
  const safe = {
    created_at: record.created_at || new Date().toISOString(),
    session_id: anonymizeText(record.session_id, 120) || 'unknown',
    question: anonymizeText(record.question),
    answer: anonymizeText(record.answer, 12000),

    confidence: Number.isFinite(Number(record.confidence))
      ? Number(record.confidence)
      : null,

    matched_knowledge_ids: Array.isArray(record.matched_knowledge_ids)
      ? record.matched_knowledge_ids.slice(0, 30)
      : [],

    source: anonymizeText(record.source, 80),

    response_ms: Number.isFinite(Number(record.response_ms))
      ? Number(record.response_ms)
      : null,

    user_agent: anonymizeText(record.user_agent, 300),
    page_url: anonymizeText(record.page_url, 1000)
  };

  // Helyi biztonsági mentés
  try {
    fs.appendFileSync(
      CONVERSATION_LOG,
      JSON.stringify(safe) + '\n',
      'utf8'
    );
  } catch (error) {
    console.error('Helyi naplózási hiba:', error.message);
  }

  if (!supabaseConfigured()) {
    console.warn(
      'Supabase naplózás kihagyva: SUPABASE_URL vagy SUPABASE_SERVICE_ROLE_KEY hiányzik.'
    );
    return;
  }

  try {
    const endpoint = `${SUPABASE_URL}/rest/v1/chat_conversations`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(safe)
    });

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        'Supabase naplózási hiba:',
        response.status,
        errorText
      );

      return;
    }

    console.log(
      'Supabase naplózás sikeres:',
      safe.session_id,
      safe.question.slice(0, 80)
    );
  } catch (error) {
    console.error(
      'Supabase naplózási kivétel:',
      error.message
    );
  }
}

function readLocalConversations(limit = 200) {
  if (!fs.existsSync(CONVERSATION_LOG)) {
    return [];
  }

  const lines = fs
    .readFileSync(CONVERSATION_LOG, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean);

  return lines
    .slice(-Math.max(1, Math.min(limit, 1000)))
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function readSupabaseConversations(limit = 200) {
  if (!supabaseConfigured()) {
    return null;
  }

  const safeLimit = Math.max(
    1,
    Math.min(Number(limit) || 200, 1000)
  );

  const endpoint =
    `${SUPABASE_URL}/rest/v1/chat_conversations` +
    `?select=*&order=created_at.desc&limit=${safeLimit}`;

  const response = await fetch(endpoint, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY
    }
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Supabase lekérdezési hiba: ${response.status} ${errorText}`
    );
  }

  return response.json();
}

function logGap(question, score, history) {
  try {
    fs.appendFileSync(
      path.join(LOG_DIR, 'knowledge-gaps.jsonl'),
      JSON.stringify({
        at: new Date().toISOString(),
        question,
        score,
        history: history.slice(-5)
      }) + '\n',
      'utf8'
    );
  } catch (error) {
    console.error(
      'Knowledge gap naplózási hiba:',
      error.message
    );
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });

  res.end(body);
}

function serveFile(
  res,
  filePath,
  type,
  cache = 'no-store'
) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': cache,
      'Access-Control-Allow-Origin': '*'
    });

    res.end(data);
  });
}

function parseBody(req, limit = 5e6) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;

      if (body.length > limit) {
        reject(new Error('Túl nagy kérés.'));
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(
  async (req, res) => {
    const url = new URL(
      req.url,
      `http://${req.headers.host || 'localhost'}`
    );

    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods':
            'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type,X-Admin-Token'
        });

        return res.end();
      }

      // CHAT
      if (
        req.method === 'POST' &&
        url.pathname === '/api/chat'
      ) {
        const rawBody = await parseBody(req);
        const parsed = JSON.parse(rawBody || '{}');

        const question = String(
          parsed.message || parsed.question || ''
        ).trim();

        if (!question) {
          return sendJson(res, 400, {
            success: false,
            answer: 'Kérlek, írd be a kérdésedet.'
          });
        }

        const history = Array.isArray(parsed.history)
          ? parsed.history
          : [];

        const started = Date.now();

        const result = createAnswer({
          question,
          history,
          knowledge,
          ruleEngine,
          logGap
        });

        const responsePayload = {
          success: true,
          ...result,
          matchedKnowledgeIds: result.ids
        };

        // A válasz küldését nem blokkoljuk a naplózás miatt.
        persistConversation({
          created_at: new Date().toISOString(),
          session_id: parsed.sessionId,
          question,
          answer: result.answer,
          confidence:
            result.score ?? result.confidence,
          matched_knowledge_ids: result.ids,
          source: result.source,
          response_ms: Date.now() - started,
          user_agent: req.headers['user-agent'],
          page_url: parsed.pageUrl
        }).catch((error) => {
          console.error(
            'Naplózási háttérhiba:',
            error.message
          );
        });

        return sendJson(
          res,
          200,
          responsePayload
        );
      }

      // BESZÉLGETÉSEK BETÖLTÉSE
      if (
        req.method === 'GET' &&
        url.pathname === '/api/admin/conversations'
      ) {
        if (!ADMIN_TOKEN) {
          return sendJson(res, 503, {
            ok: false,
            error:
              'Az admin felület nincs engedélyezve.'
          });
        }

        const supplied = String(
          req.headers['x-admin-token'] ||
          url.searchParams.get('token') ||
          ''
        ).trim();

        if (supplied !== ADMIN_TOKEN) {
          return sendJson(res, 401, {
            ok: false,
            error: 'Hibás admin kulcs.'
          });
        }

        const limit = Number(
          url.searchParams.get('limit') || 200
        );

        try {
          const remote =
            await readSupabaseConversations(limit);

          const items =
            remote ||
            readLocalConversations(limit);

          return sendJson(res, 200, {
            ok: true,
            storage: remote
              ? 'supabase'
              : 'local',
            items
          });
        } catch (error) {
          console.error(
            'Admin beszélgetésbetöltési hiba:',
            error.message
          );

          return sendJson(res, 500, {
            ok: false,
            error: error.message
          });
        }
      }

      // BESZÉLGETÉSEK EXPORT
      if (
        req.method === 'GET' &&
        url.pathname ===
          '/api/admin/conversations/export'
      ) {
        if (!ADMIN_TOKEN) {
          return sendJson(res, 503, {
            ok: false,
            error:
              'Az admin felület nincs engedélyezve.'
          });
        }

        const supplied = String(
          req.headers['x-admin-token'] ||
          url.searchParams.get('token') ||
          ''
        ).trim();

        if (supplied !== ADMIN_TOKEN) {
          return sendJson(res, 401, {
            ok: false,
            error: 'Hibás admin kulcs.'
          });
        }

        const items =
          (await readSupabaseConversations(1000)) ||
          readLocalConversations(1000);

        const body = JSON.stringify(
          items,
          null,
          2
        );

        res.writeHead(200, {
          'Content-Type':
            'application/json; charset=utf-8',
          'Content-Disposition':
            'attachment; filename="vitalis-chat-beszelgetesek.json"',
          'Cache-Control': 'no-store'
        });

        return res.end(body);
      }

      // TUDÁSBÁZIS IMPORT
      if (
        req.method === 'POST' &&
        url.pathname === '/api/admin/import'
      ) {
        if (!ADMIN_TOKEN) {
          return sendJson(res, 503, {
            ok: false,
            error:
              'Az admin import éles környezetben nincs engedélyezve.'
          });
        }

        const supplied = String(
          req.headers['x-admin-token'] || ''
        ).trim();

        if (supplied !== ADMIN_TOKEN) {
          return sendJson(res, 401, {
            ok: false,
            error: 'Hibás admin kulcs.'
          });
        }

        const rawBody = await parseBody(req);
        const parsed = JSON.parse(rawBody || '{}');

        const items = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.items)
            ? parsed.items
            : null;

        if (!items) {
          return sendJson(res, 400, {
            ok: false,
            error:
              'A fájl nem érvényes knowledge.json.'
          });
        }

        const valid = items.filter(
          (item) =>
            item &&
            typeof item === 'object' &&
            item.id &&
            (
              item.fullAnswer ||
              item.shortAnswer
            )
        );

        if (!valid.length) {
          return sendJson(res, 400, {
            ok: false,
            error:
              'Nem található érvényes tudáselem.'
          });
        }

        const stamp = new Date()
          .toISOString()
          .replace(/[:.]/g, '-');

        if (
          fs.existsSync(KNOWLEDGE_PATH)
        ) {
          fs.copyFileSync(
            KNOWLEDGE_PATH,
            path.join(
              BACKUP_DIR,
              `knowledge-${stamp}.json`
            )
          );
        }

        fs.writeFileSync(
          KNOWLEDGE_PATH,
          JSON.stringify(valid, null, 2),
          'utf8'
        );

        loadKnowledge();

        return sendJson(res, 200, {
          ok: true,
          items: knowledge.length,
          loadedAt
        });
      }

      // ÁLLAPOT
      if (
        req.method === 'GET' &&
        url.pathname === '/api/status'
      ) {
        return sendJson(res, 200, {
          ok: true,
          version: 'Éles 1.9',
          items: knowledge.length,
          loadedAt,
          port: PORT,
          rules: ruleEngine.status(),
          supabaseConfigured:
            supabaseConfigured()
        });
      }

      // OLDALAK
      if (
        req.method === 'GET' &&
        (
          url.pathname === '/' ||
          url.pathname === '/index.html' ||
          url.pathname === '/widget'
        )
      ) {
        return serveFile(
          res,
          path.join(
            PUBLIC_DIR,
            'widget.html'
          ),
          'text/html; charset=utf-8'
        );
      }

      if (
        req.method === 'GET' &&
        url.pathname === '/demo'
      ) {
        return serveFile(
          res,
          path.join(
            PUBLIC_DIR,
            'demo.html'
          ),
          'text/html; charset=utf-8'
        );
      }

      if (
        req.method === 'GET' &&
        url.pathname === '/admin'
      ) {
        return serveFile(
          res,
          path.join(
            PUBLIC_DIR,
            'admin.html'
          ),
          'text/html; charset=utf-8'
        );
      }

      const staticMap = {
        '/embed.js': [
          'embed.js',
          'text/javascript; charset=utf-8'
        ],

        '/widget.js': [
          'widget.js',
          'text/javascript; charset=utf-8'
        ],

        '/admin.js': [
          'admin.js',
          'text/javascript; charset=utf-8'
        ],

        '/widget.css': [
          'widget.css',
          'text/css; charset=utf-8'
        ],

        '/admin.css': [
          'admin.css',
          'text/css; charset=utf-8'
        ],

        '/vitalis-logo.jpg': [
          'vitalis-logo.jpg',
          'image/jpeg'
        ]
      };

      if (
        req.method === 'GET' &&
        staticMap[url.pathname]
      ) {
        const [fileName, type] =
          staticMap[url.pathname];

        return serveFile(
          res,
          path.join(
            PUBLIC_DIR,
            fileName
          ),
          type,
          'no-store'
        );
      }

      res.writeHead(404);
      res.end('Not found');
    } catch (error) {
      console.error(
        'Szerverhiba:',
        error
      );

      sendJson(res, 500, {
        ok: false,
        success: false,
        error: error.message,
        answer:
          'Technikai hiba történt. Kérlek, próbáld meg újra.'
      });
    }
  }
);

server.on(
  'error',
  (error) => {
    if (
      error.code === 'EADDRINUSE'
    ) {
      console.error(
        `A ${PORT}-es port foglalt.`
      );
    } else {
      console.error(error);
    }

    process.exit(1);
  }
);

server.listen(
  PORT,
  HOST,
  () => {
    fs.writeFileSync(
      path.join(
        ROOT,
        'chatbot.pid'
      ),
      String(process.pid)
    );

    console.log(
      '=========================================='
    );

    console.log(
      ' Kérdezd a készítőt! – Éles 1.9 elindult'
    );

    console.log(
      ` Chat:  http://localhost:${PORT}/widget`
    );

    console.log(
      ` Demo:  http://localhost:${PORT}/demo`
    );

    console.log(
      ` Admin: http://localhost:${PORT}/admin`
    );

    console.log(
      ` Tudaselemek: ${knowledge.length}`
    );

    console.log(
      ` Supabase naplózás: ${
        supabaseConfigured()
          ? 'BEKAPCSOLVA'
          : 'KIKAPCSOLVA'
      }`
    );

    console.log(
      '=========================================='
    );
  }
);

function cleanupPid() {
  try {
    const pidPath =
      path.join(
        ROOT,
        'chatbot.pid'
      );

    if (
      fs.existsSync(pidPath)
    ) {
      fs.unlinkSync(pidPath);
    }
  } catch {}
}

process.on(
  'exit',
  cleanupPid
);

process.on(
  'SIGINT',
  () => {
    cleanupPid();
    process.exit(0);
  }
);

process.on(
  'SIGTERM',
  () => {
    cleanupPid();
    process.exit(0);
  }
);
