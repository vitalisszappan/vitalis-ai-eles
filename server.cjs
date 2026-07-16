const http = require('http');
const https = require('https');
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
  .replace(/\/+$/, '');

const SUPABASE_SERVICE_ROLE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
).trim();

const CONVERSATION_LOG = path.join(
  LOG_DIR,
  'conversations.jsonl'
);

for (const dir of [DATA_DIR, BACKUP_DIR, LOG_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

let knowledge = [];
let loadedAt = null;

/* =========================================================
   TUDÁSBÁZIS
========================================================= */

function loadKnowledge() {
  const raw = JSON.parse(
    fs.readFileSync(KNOWLEDGE_PATH, 'utf8')
  );

  const items = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.items)
      ? raw.items
      : null;

  if (!items) {
    throw new Error(
      'A knowledge.json nem megfelelő formátumú.'
    );
  }

  knowledge = items.filter(
    (item) =>
      item &&
      typeof item === 'object' &&
      item.id
  );

  loadedAt = new Date().toISOString();
}

loadKnowledge();

const {
  ExpertRuleEngine
} = require('./engine/rule-engine.cjs');

const {
  createAnswer
} = require('./engine/answer-service.cjs');

const RULE_PATH = path.join(
  DATA_DIR,
  'rules',
  'expert-rules.json'
);

const ruleEngine = new ExpertRuleEngine(RULE_PATH);

/* =========================================================
   SEGÉDFÜGGVÉNYEK
========================================================= */

function anonymizeText(value, max = 4000) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max);
}

function supabaseConfigured() {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_SERVICE_ROLE_KEY
  );
}

/*
  Új Supabase Secret API key:
  sb_secret_...

  Régi service_role kulcs:
  JWT, általában eyJ... kezdetű.
*/
function getSupabaseHeaders(extra = {}) {
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    ...extra
  };

  /*
    Csak a régi JWT-alapú service_role kulcs esetén
    küldünk Authorization Bearer fejlécet.
  */
  if (
    SUPABASE_SERVICE_ROLE_KEY.startsWith('eyJ')
  ) {
    headers.Authorization =
      `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  }

  return headers;
}

/* =========================================================
   SUPABASE HTTP KÉRÉS
   Nem fetch-et használunk.
========================================================= */

function supabaseRequest({
  method = 'GET',
  pathname,
  body = null
}) {
  return new Promise((resolve, reject) => {
    if (!supabaseConfigured()) {
      return reject(
        new Error(
          'SUPABASE_URL vagy SUPABASE_SERVICE_ROLE_KEY hiányzik.'
        )
      );
    }

    let baseUrl;

    try {
      baseUrl = new URL(SUPABASE_URL);
    } catch (error) {
      return reject(
        new Error(
          `Hibás SUPABASE_URL: ${error.message}`
        )
      );
    }

    const bodyText =
      body === null
        ? null
        : JSON.stringify(body);

    const headers = getSupabaseHeaders({
      Accept: 'application/json'
    });

    if (bodyText !== null) {
      headers['Content-Type'] =
        'application/json';

      headers['Content-Length'] =
        Buffer.byteLength(bodyText);

      headers.Prefer = 'return=minimal';
    }

    const options = {
      protocol: baseUrl.protocol,
      hostname: baseUrl.hostname,
      port:
        baseUrl.port ||
        (baseUrl.protocol === 'https:' ? 443 : 80),
      path: pathname,
      method,
      headers,
      timeout: 15000
    };

    const transport =
      baseUrl.protocol === 'https:'
        ? https
        : http;

    const request = transport.request(
      options,
      (response) => {
        let responseBody = '';

        response.setEncoding('utf8');

        response.on(
          'data',
          (chunk) => {
            responseBody += chunk;
          }
        );

        response.on(
          'end',
          () => {
            const status =
              response.statusCode || 0;

            if (
              status >= 200 &&
              status < 300
            ) {
              return resolve({
                ok: true,
                status,
                body: responseBody
              });
            }

            return reject(
              new Error(
                `Supabase HTTP ${status}: ${
                  responseBody ||
                  response.statusMessage ||
                  'Ismeretlen hiba'
                }`
              )
            );
          }
        );
      }
    );

    request.on(
      'timeout',
      () => {
        request.destroy(
          new Error(
            'Supabase kapcsolat időtúllépés.'
          )
        );
      }
    );

    request.on(
      'error',
      (error) => {
        console.error(
          'SUPABASE KAPCSOLATI HIBA'
        );

        console.error(
          'Host:',
          baseUrl.hostname
        );

        console.error(
          'Hibakód:',
          error.code || 'nincs'
        );

        console.error(
          'Hibaüzenet:',
          error.message
        );

        reject(error);
      }
    );

    if (bodyText !== null) {
      request.write(bodyText);
    }

    request.end();
  });
}

/* =========================================================
   BESZÉLGETÉS MENTÉSE
========================================================= */

async function persistConversation(record) {
  const safe = {
    created_at:
      record.created_at ||
      new Date().toISOString(),

    session_id:
      anonymizeText(
        record.session_id,
        120
      ) || 'unknown',

    question:
      anonymizeText(
        record.question
      ),

    answer:
      anonymizeText(
        record.answer,
        12000
      ),

    confidence:
      Number.isFinite(
        Number(record.confidence)
      )
        ? Number(record.confidence)
        : null,

    matched_knowledge_ids:
      Array.isArray(
        record.matched_knowledge_ids
      )
        ? record.matched_knowledge_ids.slice(
            0,
            30
          )
        : [],

    source:
      anonymizeText(
        record.source,
        80
      ),

    response_ms:
      Number.isFinite(
        Number(record.response_ms)
      )
        ? Number(record.response_ms)
        : null,

    user_agent:
      anonymizeText(
        record.user_agent,
        300
      ),

    page_url:
      anonymizeText(
        record.page_url,
        1000
      )
  };

  /*
    Helyi biztonsági napló.
    Ez akkor is megmarad, ha a Supabase
    pillanatnyilag nem elérhető.
  */
  try {
    fs.appendFileSync(
      CONVERSATION_LOG,
      JSON.stringify(safe) + '\n',
      'utf8'
    );
  } catch (error) {
    console.error(
      'Helyi naplózási hiba:',
      error.message
    );
  }

  if (!supabaseConfigured()) {
    console.warn(
      'Supabase naplózás kihagyva: beállítás hiányzik.'
    );

    return;
  }

  try {
    await supabaseRequest({
      method: 'POST',
      pathname:
        '/rest/v1/chat_conversations',
      body: safe
    });

    console.log(
      'SUPABASE MENTÉS SIKERES:',
      safe.question.slice(0, 100)
    );
  } catch (error) {
    console.error(
      'SUPABASE MENTÉS SIKERTELEN'
    );

    console.error(
      'Hiba:',
      error.message
    );

    if (error.code) {
      console.error(
        'Hibakód:',
        error.code
      );
    }
  }
}

/* =========================================================
   HELYI BESZÉLGETÉSEK
========================================================= */

function readLocalConversations(
  limit = 200
) {
  if (
    !fs.existsSync(
      CONVERSATION_LOG
    )
  ) {
    return [];
  }

  const lines = fs
    .readFileSync(
      CONVERSATION_LOG,
      'utf8'
    )
    .split(/\r?\n/)
    .filter(Boolean);

  return lines
    .slice(
      -Math.max(
        1,
        Math.min(limit, 1000)
      )
    )
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

/* =========================================================
   SUPABASE BESZÉLGETÉSEK OLVASÁSA
========================================================= */

async function readSupabaseConversations(
  limit = 200
) {
  if (!supabaseConfigured()) {
    return null;
  }

  const safeLimit = Math.max(
    1,
    Math.min(
      Number(limit) || 200,
      1000
    )
  );

  const pathname =
    '/rest/v1/chat_conversations' +
    '?select=*' +
    '&order=created_at.desc' +
    `&limit=${safeLimit}`;

  const result =
    await supabaseRequest({
      method: 'GET',
      pathname
    });

  if (!result.body) {
    return [];
  }

  return JSON.parse(
    result.body
  );
}

/* =========================================================
   TUDÁSHIÁNY NAPLÓ
========================================================= */

function logGap(
  question,
  score,
  history
) {
  try {
    fs.appendFileSync(
      path.join(
        LOG_DIR,
        'knowledge-gaps.jsonl'
      ),
      JSON.stringify({
        at:
          new Date().toISOString(),
        question,
        score,
        history:
          Array.isArray(history)
            ? history.slice(-5)
            : []
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

/* =========================================================
   HTTP SEGÉDFÜGGVÉNYEK
========================================================= */

function sendJson(
  res,
  status,
  obj
) {
  const body =
    JSON.stringify(obj);

  res.writeHead(
    status,
    {
      'Content-Type':
        'application/json; charset=utf-8',

      'Content-Length':
        Buffer.byteLength(body),

      'Cache-Control':
        'no-store',

      'Access-Control-Allow-Origin':
        '*'
    }
  );

  res.end(body);
}

function serveFile(
  res,
  filePath,
  type,
  cache = 'no-store'
) {
  fs.readFile(
    filePath,
    (error, data) => {
      if (error) {
        res.writeHead(404);
        return res.end(
          'Not found'
        );
      }

      res.writeHead(
        200,
        {
          'Content-Type': type,
          'Cache-Control': cache,
          'Access-Control-Allow-Origin':
            '*'
        }
      );

      res.end(data);
    }
  );
}

function parseBody(
  req,
  limit = 5e6
) {
  return new Promise(
    (resolve, reject) => {
      let body = '';

      req.on(
        'data',
        (chunk) => {
          body += chunk;

          if (
            body.length > limit
          ) {
            reject(
              new Error(
                'Túl nagy kérés.'
              )
            );

            req.destroy();
          }
        }
      );

      req.on(
        'end',
        () => resolve(body)
      );

      req.on(
        'error',
        reject
      );
    }
  );
}

/* =========================================================
   SZERVER
========================================================= */

const server =
  http.createServer(
    async (req, res) => {
      const url =
        new URL(
          req.url,
          `http://${
            req.headers.host ||
            'localhost'
          }`
        );

      try {

        /* -------------------------
           CORS
        ------------------------- */

        if (
          req.method ===
          'OPTIONS'
        ) {
          res.writeHead(
            204,
            {
              'Access-Control-Allow-Origin':
                '*',

              'Access-Control-Allow-Methods':
                'GET,POST,OPTIONS',

              'Access-Control-Allow-Headers':
                'Content-Type,X-Admin-Token'
            }
          );

          return res.end();
        }

        /* -------------------------
           CHAT
        ------------------------- */

        if (
          req.method ===
            'POST' &&
          url.pathname ===
            '/api/chat'
        ) {
          const rawBody =
            await parseBody(req);

          const parsed =
            JSON.parse(
              rawBody || '{}'
            );

          const question =
            String(
              parsed.message ||
              parsed.question ||
              ''
            ).trim();

          if (!question) {
            return sendJson(
              res,
              400,
              {
                success: false,
                answer:
                  'Kérlek, írd be a kérdésedet.'
              }
            );
          }

          const history =
            Array.isArray(
              parsed.history
            )
              ? parsed.history
              : [];

          const started =
            Date.now();

          const result =
            createAnswer({
              question,
              history,
              knowledge,
              ruleEngine,
              logGap
            });

          const responsePayload = {
            success: true,
            ...result,
            matchedKnowledgeIds:
              result.ids || []
          };

          /*
            Nem várjuk meg a mentést,
            hogy a chatbot válasza gyors maradjon.
          */
          persistConversation({
            created_at:
              new Date()
                .toISOString(),

            session_id:
              parsed.sessionId,

            question,

            answer:
              result.answer,

            confidence:
              result.score ??
              result.confidence,

            matched_knowledge_ids:
              result.ids || [],

            source:
              result.source,

            response_ms:
              Date.now() -
              started,

            user_agent:
              req.headers[
                'user-agent'
              ],

            page_url:
              parsed.pageUrl
          }).catch(
            (error) => {
              console.error(
                'Naplózási háttérhiba:',
                error
              );
            }
          );

          return sendJson(
            res,
            200,
            responsePayload
          );
        }

        /* -------------------------
           ADMIN BESZÉLGETÉSEK
        ------------------------- */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/api/admin/conversations'
        ) {
          if (!ADMIN_TOKEN) {
            return sendJson(
              res,
              503,
              {
                ok: false,
                error:
                  'Az admin felület nincs engedélyezve.'
              }
            );
          }

          const supplied =
            String(
              req.headers[
                'x-admin-token'
              ] ||
              url.searchParams.get(
                'token'
              ) ||
              ''
            ).trim();

          if (
            supplied !==
            ADMIN_TOKEN
          ) {
            return sendJson(
              res,
              401,
              {
                ok: false,
                error:
                  'Hibás admin kulcs.'
              }
            );
          }

          const limit =
            Number(
              url.searchParams.get(
                'limit'
              ) || 200
            );

          try {
            const remote =
              await readSupabaseConversations(
                limit
              );

            const items =
              remote ||
              readLocalConversations(
                limit
              );

            return sendJson(
              res,
              200,
              {
                ok: true,
                storage:
                  remote
                    ? 'supabase'
                    : 'local',
                items
              }
            );
          } catch (error) {
            console.error(
              'Admin Supabase olvasási hiba:',
              error
            );

            /*
              Ha a Supabase nem elérhető,
              az admin legalább a helyi
              naplót visszakapja.
            */
            const items =
              readLocalConversations(
                limit
              );

            return sendJson(
              res,
              200,
              {
                ok: true,
                storage:
                  'local-fallback',
                warning:
                  error.message,
                items
              }
            );
          }
        }

        /* -------------------------
           EXPORT
        ------------------------- */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/api/admin/conversations/export'
        ) {
          if (!ADMIN_TOKEN) {
            return sendJson(
              res,
              503,
              {
                ok: false,
                error:
                  'Az admin felület nincs engedélyezve.'
              }
            );
          }

          const supplied =
            String(
              req.headers[
                'x-admin-token'
              ] ||
              url.searchParams.get(
                'token'
              ) ||
              ''
            ).trim();

          if (
            supplied !==
            ADMIN_TOKEN
          ) {
            return sendJson(
              res,
              401,
              {
                ok: false,
                error:
                  'Hibás admin kulcs.'
              }
            );
          }

          let items;

          try {
            items =
              await readSupabaseConversations(
                1000
              );
          } catch {
            items =
              readLocalConversations(
                1000
              );
          }

          const body =
            JSON.stringify(
              items || [],
              null,
              2
            );

          res.writeHead(
            200,
            {
              'Content-Type':
                'application/json; charset=utf-8',

              'Content-Disposition':
                'attachment; filename="vitalis-chat-beszelgetesek.json"',

              'Cache-Control':
                'no-store'
            }
          );

          return res.end(body);
        }

        /* -------------------------
           TUDÁSBÁZIS IMPORT
        ------------------------- */

        if (
          req.method ===
            'POST' &&
          url.pathname ===
            '/api/admin/import'
        ) {
          if (!ADMIN_TOKEN) {
            return sendJson(
              res,
              503,
              {
                ok: false,
                error:
                  'Az admin import nincs engedélyezve.'
              }
            );
          }

          const supplied =
            String(
              req.headers[
                'x-admin-token'
              ] ||
              ''
            ).trim();

          if (
            supplied !==
            ADMIN_TOKEN
          ) {
            return sendJson(
              res,
              401,
              {
                ok: false,
                error:
                  'Hibás admin kulcs.'
              }
            );
          }

          const rawBody =
            await parseBody(req);

          const parsed =
            JSON.parse(
              rawBody || '{}'
            );

          const items =
            Array.isArray(parsed)
              ? parsed
              : Array.isArray(
                  parsed.items
                )
                ? parsed.items
                : null;

          if (!items) {
            return sendJson(
              res,
              400,
              {
                ok: false,
                error:
                  'A fájl nem érvényes knowledge.json.'
              }
            );
          }

          const valid =
            items.filter(
              (item) =>
                item &&
                typeof item ===
                  'object' &&
                item.id &&
                (
                  item.fullAnswer ||
                  item.shortAnswer
                )
            );

          if (!valid.length) {
            return sendJson(
              res,
              400,
              {
                ok: false,
                error:
                  'Nem található érvényes tudáselem.'
              }
            );
          }

          const stamp =
            new Date()
              .toISOString()
              .replace(
                /[:.]/g,
                '-'
              );

          if (
            fs.existsSync(
              KNOWLEDGE_PATH
            )
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
            JSON.stringify(
              valid,
              null,
              2
            ),
            'utf8'
          );

          loadKnowledge();

          return sendJson(
            res,
            200,
            {
              ok: true,
              items:
                knowledge.length,
              loadedAt
            }
          );
        }

        /* -------------------------
           ÁLLAPOT
        ------------------------- */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/api/status'
        ) {
          let supabaseHost =
            null;

          try {
            supabaseHost =
              SUPABASE_URL
                ? new URL(
                    SUPABASE_URL
                  ).hostname
                : null;
          } catch {}

          return sendJson(
            res,
            200,
            {
              ok: true,
              version:
                'Éles 1.9',

              items:
                knowledge.length,

              loadedAt,

              port: PORT,

              rules:
                ruleEngine.status(),

              supabaseConfigured:
                supabaseConfigured(),

              supabaseHost,

              supabaseKeyType:
                SUPABASE_SERVICE_ROLE_KEY
                  .startsWith(
                    'sb_secret_'
                  )
                  ? 'secret'
                  : SUPABASE_SERVICE_ROLE_KEY
                      .startsWith(
                        'eyJ'
                      )
                    ? 'legacy-service-role'
                    : SUPABASE_SERVICE_ROLE_KEY
                      ? 'unknown'
                      : 'missing'
            }
          );
        }

        /* -------------------------
           STATIKUS OLDALAK
        ------------------------- */

        if (
          req.method ===
            'GET' &&
          (
            url.pathname ===
              '/' ||
            url.pathname ===
              '/index.html' ||
            url.pathname ===
              '/widget'
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
          req.method ===
            'GET' &&
          url.pathname ===
            '/demo'
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
          req.method ===
            'GET' &&
          url.pathname ===
            '/admin'
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
          req.method ===
            'GET' &&
          staticMap[
            url.pathname
          ]
        ) {
          const [
            fileName,
            type
          ] =
            staticMap[
              url.pathname
            ];

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

        sendJson(
          res,
          500,
          {
            ok: false,
            success: false,
            error:
              error.message,

            answer:
              'Technikai hiba történt. Kérlek, próbáld meg újra.'
          }
        );
      }
    }
  );

/* =========================================================
   SZERVER INDÍTÁSA
========================================================= */

server.on(
  'error',
  (error) => {
    console.error(
      'Szerverindítási hiba:',
      error
    );

    process.exit(1);
  }
);

server.listen(
  PORT,
  HOST,
  () => {
    try {
      fs.writeFileSync(
        path.join(
          ROOT,
          'chatbot.pid'
        ),
        String(
          process.pid
        )
      );
    } catch {}

    let supabaseHost =
      'nincs';

    try {
      if (SUPABASE_URL) {
        supabaseHost =
          new URL(
            SUPABASE_URL
          ).hostname;
      }
    } catch {
      supabaseHost =
        'HIBÁS URL';
    }

    console.log(
      '=========================================='
    );

    console.log(
      ' Kérdezd a készítőt! – Éles 1.9 elindult'
    );

    console.log(
      ` Chat: http://localhost:${PORT}/widget`
    );

    console.log(
      ` Demo: http://localhost:${PORT}/demo`
    );

    console.log(
      ` Admin: http://localhost:${PORT}/admin`
    );

    console.log(
      ` Tudáselemek: ${knowledge.length}`
    );

    console.log(
      ` Supabase naplózás: ${
        supabaseConfigured()
          ? 'BEKAPCSOLVA'
          : 'KIKAPCSOLVA'
      }`
    );

    console.log(
      ` Supabase host: ${supabaseHost}`
    );

    console.log(
      ` Supabase kulcs típusa: ${
        SUPABASE_SERVICE_ROLE_KEY
          .startsWith(
            'sb_secret_'
          )
          ? 'SECRET API KEY'
          : SUPABASE_SERVICE_ROLE_KEY
              .startsWith(
                'eyJ'
              )
            ? 'LEGACY SERVICE_ROLE'
            : SUPABASE_SERVICE_ROLE_KEY
              ? 'ISMERETLEN'
              : 'HIÁNYZIK'
      }`
    );

    console.log(
      '=========================================='
    );
  }
);

/* =========================================================
   LEÁLLÍTÁS
========================================================= */

function cleanupPid() {
  try {
    const pidPath =
      path.join(
        ROOT,
        'chatbot.pid'
      );

    if (
      fs.existsSync(
        pidPath
      )
    ) {
      fs.unlinkSync(
        pidPath
      );
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
