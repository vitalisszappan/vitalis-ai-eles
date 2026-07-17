const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

/* =========================================================
   ALAPBEÁLLÍTÁSOK
========================================================= */

const ROOT = __dirname;

const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const LOG_DIR = path.join(DATA_DIR, 'logs');

const KNOWLEDGE_PATH = path.join(
  DATA_DIR,
  'knowledge.json'
);

const RULE_PATH = path.join(
  DATA_DIR,
  'rules',
  'expert-rules.json'
);

const CONVERSATION_LOG = path.join(
  LOG_DIR,
  'conversations.jsonl'
);

const KNOWLEDGE_GAP_LOG = path.join(
  LOG_DIR,
  'knowledge-gaps.jsonl'
);

const PORT = Number(
  process.env.PORT || 3218
);

const HOST =
  process.env.HOST || '0.0.0.0';

const ADMIN_TOKEN = String(
  process.env.ADMIN_TOKEN || ''
).trim();

const SUPABASE_URL = String(
  process.env.SUPABASE_URL || ''
)
  .trim()
  .replace(/\/+$/, '');

const SUPABASE_SERVICE_ROLE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
).trim();

/* =========================================================
   UNAS SZINKRON MODUL
========================================================= */

const {
  testUnasConnection
} = require('./unas-sync.cjs');

/* =========================================================
   MAPPÁK
========================================================= */

for (const dir of [
  DATA_DIR,
  BACKUP_DIR,
  LOG_DIR
]) {
  fs.mkdirSync(
    dir,
    { recursive: true }
  );
}

/* =========================================================
   TUDÁSBÁZIS
========================================================= */

let knowledge = [];
let loadedAt = null;

function loadKnowledge() {
  if (!fs.existsSync(KNOWLEDGE_PATH)) {
    throw new Error(
      'A data/knowledge.json fájl nem található.'
    );
  }

  const rawText =
    fs.readFileSync(
      KNOWLEDGE_PATH,
      'utf8'
    );

  const raw =
    JSON.parse(rawText);

  const items =
    Array.isArray(raw)
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

  loadedAt =
    new Date().toISOString();

  console.log(
    `Tudásbázis betöltve: ${knowledge.length} elem`
  );
}

loadKnowledge();

/* =========================================================
   VÁLASZMOTOR
========================================================= */

const {
  ExpertRuleEngine
} = require(
  './engine/rule-engine.cjs'
);

const {
  createAnswer
} = require(
  './engine/answer-service.cjs'
);

const ruleEngine =
  new ExpertRuleEngine(
    RULE_PATH
  );

/* =========================================================
   SEGÉDFÜGGVÉNYEK
========================================================= */

function cleanText(
  value,
  maxLength = 4000
) {
  return String(
    value || ''
  )
    .replace(
      /[\r\n]+/g,
      ' '
    )
    .trim()
    .slice(
      0,
      maxLength
    );
}

function normalizeMatchedIds(
  result
) {
  const ids =
    result?.matchedKnowledgeIds ??
    result?.ids ??
    [];

  return Array.isArray(ids)
    ? ids
        .filter(Boolean)
        .slice(0, 30)
    : [];
}

function normalizeConfidence(
  result
) {
  const value =
    result?.confidence ??
    result?.score;

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function supabaseConfigured() {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_SERVICE_ROLE_KEY
  );
}

function getSupabaseKeyType() {
  if (
    SUPABASE_SERVICE_ROLE_KEY
      .startsWith('sb_secret_')
  ) {
    return 'secret';
  }

  if (
    SUPABASE_SERVICE_ROLE_KEY
      .startsWith('eyJ')
  ) {
    return 'legacy-service-role';
  }

  if (
    SUPABASE_SERVICE_ROLE_KEY
  ) {
    return 'unknown';
  }

  return 'missing';
}

function getSupabaseHost() {
  try {
    return SUPABASE_URL
      ? new URL(
          SUPABASE_URL
        ).hostname
      : null;
  } catch {
    return null;
  }
}

/* =========================================================
   ADMIN AZONOSÍTÁS
========================================================= */

function getSuppliedAdminToken(
  req,
  url
) {
  return String(
    req.headers[
      'x-admin-token'
    ] ||
    url.searchParams.get(
      'token'
    ) ||
    ''
  ).trim();
}

function authorizeAdmin(
  req,
  res,
  url
) {
  if (!ADMIN_TOKEN) {
    sendJson(
      res,
      503,
      {
        ok: false,
        error:
          'Az admin felület nincs engedélyezve.'
      }
    );

    return false;
  }

  const supplied =
    getSuppliedAdminToken(
      req,
      url
    );

  if (
    supplied !==
    ADMIN_TOKEN
  ) {
    sendJson(
      res,
      401,
      {
        ok: false,
        error:
          'Hibás admin kulcs.'
      }
    );

    return false;
  }

  return true;
}

/* =========================================================
   SUPABASE
========================================================= */

function getSupabaseHeaders(
  extra = {}
) {
  const headers = {
    apikey:
      SUPABASE_SERVICE_ROLE_KEY,
    ...extra
  };

  if (
    SUPABASE_SERVICE_ROLE_KEY
      .startsWith('eyJ')
  ) {
    headers.Authorization =
      `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  }

  return headers;
}

function supabaseRequest({
  method = 'GET',
  pathname,
  body = null
}) {
  return new Promise(
    (
      resolve,
      reject
    ) => {

      if (
        !supabaseConfigured()
      ) {
        reject(
          new Error(
            'SUPABASE_URL vagy SUPABASE_SERVICE_ROLE_KEY hiányzik.'
          )
        );

        return;
      }

      let baseUrl;

      try {
        baseUrl =
          new URL(
            SUPABASE_URL
          );
      } catch (error) {
        reject(
          new Error(
            `Hibás SUPABASE_URL: ${error.message}`
          )
        );

        return;
      }

      const bodyText =
        body === null
          ? null
          : JSON.stringify(
              body
            );

      const headers =
        getSupabaseHeaders({
          Accept:
            'application/json'
        });

      if (
        bodyText !== null
      ) {
        headers[
          'Content-Type'
        ] =
          'application/json';

        headers[
          'Content-Length'
        ] =
          Buffer.byteLength(
            bodyText
          );

        headers.Prefer =
          'return=minimal';
      }

      const options = {
        protocol:
          baseUrl.protocol,

        hostname:
          baseUrl.hostname,

        port:
          baseUrl.port ||
          (
            baseUrl.protocol ===
            'https:'
              ? 443
              : 80
          ),

        path:
          pathname,

        method,

        headers,

        timeout:
          15000
      };

      const transport =
        baseUrl.protocol ===
        'https:'
          ? https
          : http;

      const request =
        transport.request(
          options,
          (
            response
          ) => {
            let responseBody =
              '';

            response.setEncoding(
              'utf8'
            );

            response.on(
              'data',
              (
                chunk
              ) => {
                responseBody +=
                  chunk;
              }
            );

            response.on(
              'end',
              () => {
                const status =
                  response
                    .statusCode ||
                  0;

                if (
                  status >=
                    200 &&
                  status <
                    300
                ) {
                  resolve({
                    ok: true,
                    status,
                    body:
                      responseBody
                  });

                  return;
                }

                reject(
                  new Error(
                    `Supabase HTTP ${status}: ${
                      responseBody ||
                      response
                        .statusMessage ||
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
        (
          error
        ) => {
          console.error(
            'SUPABASE KAPCSOLATI HIBA'
          );

          console.error(
            'Host:',
            baseUrl.hostname
          );

          console.error(
            'Hibakód:',
            error.code ||
              'nincs'
          );

          console.error(
            'Hibaüzenet:',
            error.message
          );

          reject(
            error
          );
        }
      );

      if (
        bodyText !== null
      ) {
        request.write(
          bodyText
        );
      }

      request.end();
    }
  );
}

/* =========================================================
   BESZÉLGETÉSEK MENTÉSE
========================================================= */

async function persistConversation(
  record
) {
  const safe = {

    created_at:
      record.created_at ||
      new Date()
        .toISOString(),

    session_id:
      cleanText(
        record.session_id,
        120
      ) ||
      'unknown',

    question:
      cleanText(
        record.question,
        4000
      ),

    answer:
      cleanText(
        record.answer,
        12000
      ),

    confidence:
      Number.isFinite(
        Number(
          record.confidence
        )
      )
        ? Number(
            record.confidence
          )
        : null,

    matched_knowledge_ids:
      Array.isArray(
        record
          .matched_knowledge_ids
      )
        ? record
            .matched_knowledge_ids
            .filter(Boolean)
            .slice(0, 30)
        : [],

    source:
      cleanText(
        record.source,
        80
      ),

    response_ms:
      Number.isFinite(
        Number(
          record.response_ms
        )
      )
        ? Number(
            record.response_ms
          )
        : null,

    user_agent:
      cleanText(
        record.user_agent,
        300
      ),

    page_url:
      cleanText(
        record.page_url,
        1000
      )
  };

  try {
    fs.appendFileSync(
      CONVERSATION_LOG,
      JSON.stringify(
        safe
      ) + '\n',
      'utf8'
    );
  } catch (
    error
  ) {
    console.error(
      'Helyi naplózási hiba:',
      error.message
    );
  }

  if (
    !supabaseConfigured()
  ) {
    console.warn(
      'Supabase naplózás kihagyva: beállítás hiányzik.'
    );

    return;
  }

  try {
    await supabaseRequest({
      method:
        'POST',

      pathname:
        '/rest/v1/chat_conversations',

      body:
        safe
    });

    console.log(
      'SUPABASE MENTÉS SIKERES:',
      safe.question
        .slice(
          0,
          100
        )
    );

  } catch (
    error
  ) {

    console.error(
      'SUPABASE MENTÉS SIKERTELEN'
    );

    console.error(
      'Hiba:',
      error.message
    );

    if (
      error.code
    ) {
      console.error(
        'Hibakód:',
        error.code
      );
    }
  }
}

/* =========================================================
   BESZÉLGETÉSEK OLVASÁSA
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

  const safeLimit =
    Math.max(
      1,
      Math.min(
        Number(
          limit
        ) || 200,
        1000
      )
    );

  const lines =
    fs
      .readFileSync(
        CONVERSATION_LOG,
        'utf8'
      )
      .split(
        /\r?\n/
      )
      .filter(
        Boolean
      );

  return lines
    .slice(
      -safeLimit
    )
    .reverse()
    .map(
      (
        line
      ) => {
        try {
          return JSON.parse(
            line
          );
        } catch {
          return null;
        }
      }
    )
    .filter(
      Boolean
    );
}

async function readSupabaseConversations(
  limit = 200
) {
  if (
    !supabaseConfigured()
  ) {
    return null;
  }

  const safeLimit =
    Math.max(
      1,
      Math.min(
        Number(
          limit
        ) || 200,
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
      method:
        'GET',

      pathname
    });

  if (
    !result.body
  ) {
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
  const entry = {

    at:
      new Date()
        .toISOString(),

    question:
      cleanText(
        question,
        4000
      ),

    score:
      Number.isFinite(
        Number(
          score
        )
      )
        ? Number(
            score
          )
        : 0,

    history:
      Array.isArray(
        history
      )
        ? history
            .slice(
              -5
            )
        : []
  };

  try {
    fs.appendFileSync(
      KNOWLEDGE_GAP_LOG,
      JSON.stringify(
        entry
      ) + '\n',
      'utf8'
    );
  } catch (
    error
  ) {
    console.error(
      'Knowledge gap naplózási hiba:',
      error.message
    );
  }
}

/* =========================================================
   HTTP SEGÉDEK
========================================================= */

function sendJson(
  res,
  status,
  object
) {
  const body =
    JSON.stringify(
      object
    );

  res.writeHead(
    status,
    {
      'Content-Type':
        'application/json; charset=utf-8',

      'Content-Length':
        Buffer.byteLength(
          body
        ),

      'Cache-Control':
        'no-store',

      'Access-Control-Allow-Origin':
        '*'
    }
  );

  res.end(
    body
  );
}

function serveFile(
  res,
  filePath,
  contentType,
  cache =
    'no-store'
) {
  fs.readFile(
    filePath,
    (
      error,
      data
    ) => {

      if (
        error
      ) {
        res.writeHead(
          404
        );

        res.end(
          'Not found'
        );

        return;
      }

      res.writeHead(
        200,
        {
          'Content-Type':
            contentType,

          'Cache-Control':
            cache,

          'Access-Control-Allow-Origin':
            '*'
        }
      );

      res.end(
        data
      );
    }
  );
}

function parseBody(
  req,
  limit =
    5e6
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {

      let body =
        '';

      req.on(
        'data',
        (
          chunk
        ) => {

          body +=
            chunk;

          if (
            body.length >
            limit
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
        () => {
          resolve(
            body
          );
        }
      );

      req.on(
        'error',
        reject
      );
    }
  );
}

/* =========================================================
   CHAT
========================================================= */

async function handleChat(
  req,
  res
) {
  const rawBody =
    await parseBody(
      req
    );

  const parsed =
    JSON.parse(
      rawBody ||
      '{}'
    );

  const question =
    String(
      parsed.message ||
      parsed.question ||
      ''
    ).trim();

  if (
    !question
  ) {
    sendJson(
      res,
      400,
      {
        success:
          false,

        answer:
          'Kérlek, írd be a kérdésedet.'
      }
    );

    return;
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

  const matchedKnowledgeIds =
    normalizeMatchedIds(
      result
    );

  const confidence =
    normalizeConfidence(
      result
    );

  const responsePayload = {
    success:
      true,

    ...result,

    confidence,

    matchedKnowledgeIds
  };

  persistConversation({

    created_at:
      new Date()
        .toISOString(),

    session_id:
      parsed.sessionId,

    question,

    answer:
      result.answer,

    confidence,

    matched_knowledge_ids:
      matchedKnowledgeIds,

    source:
      result.source ||
      'unknown',

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
    (
      error
    ) => {
      console.error(
        'Naplózási háttérhiba:',
        error.message
      );
    }
  );

  sendJson(
    res,
    200,
    responsePayload
  );
}

/* =========================================================
   ADMIN BESZÉLGETÉSEK
========================================================= */

async function handleAdminConversations(
  req,
  res,
  url
) {
  if (
    !authorizeAdmin(
      req,
      res,
      url
    )
  ) {
    return;
  }

  const limit =
    Number(
      url
        .searchParams
        .get(
          'limit'
        ) ||
      200
    );

  try {

    const remote =
      await readSupabaseConversations(
        limit
      );

    const items =
      remote ??
      readLocalConversations(
        limit
      );

    sendJson(
      res,
      200,
      {
        ok:
          true,

        storage:
          remote !== null
            ? 'supabase'
            : 'local',

        items
      }
    );

  } catch (
    error
  ) {

    console.error(
      'Admin Supabase olvasási hiba:',
      error.message
    );

    const items =
      readLocalConversations(
        limit
      );

    sendJson(
      res,
      200,
      {
        ok:
          true,

        storage:
          'local-fallback',

        warning:
          error.message,

        items
      }
    );
  }
}

/* =========================================================
   EXPORT
========================================================= */

async function handleConversationExport(
  req,
  res,
  url
) {
  if (
    !authorizeAdmin(
      req,
      res,
      url
    )
  ) {
    return;
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

  res.end(
    body
  );
}

/* =========================================================
   TUDÁSBÁZIS IMPORT
========================================================= */

async function handleKnowledgeImport(
  req,
  res,
  url
) {
  if (
    !authorizeAdmin(
      req,
      res,
      url
    )
  ) {
    return;
  }

  const rawBody =
    await parseBody(
      req
    );

  const parsed =
    JSON.parse(
      rawBody ||
      '{}'
    );

  const items =
    Array.isArray(
      parsed
    )
      ? parsed
      : Array.isArray(
          parsed.items
        )
        ? parsed.items
        : null;

  if (
    !items
  ) {
    sendJson(
      res,
      400,
      {
        ok:
          false,

        error:
          'A fájl nem érvényes knowledge.json.'
      }
    );

    return;
  }

  const valid =
    items.filter(
      (
        item
      ) =>
        item &&
        typeof item ===
          'object' &&
        item.id &&
        (
          item.fullAnswer ||
          item.shortAnswer
        )
    );

  if (
    !valid.length
  ) {
    sendJson(
      res,
      400,
      {
        ok:
          false,

        error:
          'Nem található érvényes tudáselem.'
      }
    );

    return;
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

  sendJson(
    res,
    200,
    {
      ok:
        true,

      items:
        knowledge.length,

      loadedAt
    }
  );
}

/* =========================================================
   UNAS KAPCSOLATTESZT
========================================================= */

async function handleUnasTest(
  req,
  res,
  url
) {
  if (
    !authorizeAdmin(
      req,
      res,
      url
    )
  ) {
    return;
  }

  try {

    console.log(
      'UNAS kapcsolat teszt indul...'
    );

    const result =
      await testUnasConnection();

    console.log(
      `UNAS kapcsolat sikeres. Termékek: ${result.products}`
    );

    sendJson(
      res,
      200,
      {
        ok:
          true,

        products:
          result.products,

        responseMs:
          result.responseMs,

        message:
          result.message
      }
    );

  } catch (
    error
  ) {

    console.error(
      'UNAS kapcsolat teszt sikertelen:',
      error.message
    );

    sendJson(
      res,
      500,
      {
        ok:
          false,

        error:
          error.message
      }
    );
  }
}

/* =========================================================
   RENDSZERÁLLAPOT
========================================================= */

function handleStatus(
  res
) {
  sendJson(
    res,
    200,
    {
      ok:
        true,

      version:
        'Éles 2.1',

      items:
        knowledge.length,

      loadedAt,

      port:
        PORT,

      rules:
        ruleEngine.status(),

      adminEnabled:
        Boolean(
          ADMIN_TOKEN
        ),

      supabaseConfigured:
        supabaseConfigured(),

      supabaseHost:
        getSupabaseHost(),

      supabaseKeyType:
        getSupabaseKeyType(),

      unasConfigured:
        Boolean(
          String(
            process.env.UNAS_API_KEY ||
            ''
          ).trim()
        )
    }
  );
}

/* =========================================================
   STATIKUS FÁJLOK
========================================================= */

const staticFiles = {

  '/embed.js': {
    file:
      'embed.js',
    type:
      'text/javascript; charset=utf-8'
  },

  '/widget.js': {
    file:
      'widget.js',
    type:
      'text/javascript; charset=utf-8'
  },

  '/admin.js': {
    file:
      'admin.js',
    type:
      'text/javascript; charset=utf-8'
  },

  '/widget.css': {
    file:
      'widget.css',
    type:
      'text/css; charset=utf-8'
  },

  '/admin.css': {
    file:
      'admin.css',
    type:
      'text/css; charset=utf-8'
  },

  '/vitalis-logo.jpg': {
    file:
      'vitalis-logo.jpg',
    type:
      'image/jpeg'
  }
};

/* =========================================================
   HTTP SZERVER
========================================================= */

const server =
  http.createServer(
    async (
      req,
      res
    ) => {

      const url =
        new URL(
          req.url,
          `http://${
            req.headers.host ||
            'localhost'
          }`
        );

      try {

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

          res.end();

          return;
        }

        if (
          req.method ===
            'POST' &&
          url.pathname ===
            '/api/chat'
        ) {
          await handleChat(
            req,
            res
          );

          return;
        }

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/api/admin/conversations'
        ) {
          await handleAdminConversations(
            req,
            res,
            url
          );

          return;
        }

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/api/admin/conversations/export'
        ) {
          await handleConversationExport(
            req,
            res,
            url
          );

          return;
        }

        if (
          req.method ===
            'POST' &&
          url.pathname ===
            '/api/admin/import'
        ) {
          await handleKnowledgeImport(
            req,
            res,
            url
          );

          return;
        }

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/api/admin/unas/test'
        ) {
          await handleUnasTest(
            req,
            res,
            url
          );

          return;
        }

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/api/status'
        ) {
          handleStatus(
            res
          );

          return;
        }

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
          serveFile(
            res,

            path.join(
              PUBLIC_DIR,
              'widget.html'
            ),

            'text/html; charset=utf-8'
          );

          return;
        }

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/demo'
        ) {
          serveFile(
            res,

            path.join(
              PUBLIC_DIR,
              'demo.html'
            ),

            'text/html; charset=utf-8'
          );

          return;
        }

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/admin'
        ) {
          serveFile(
            res,

            path.join(
              PUBLIC_DIR,
              'admin.html'
            ),

            'text/html; charset=utf-8'
          );

          return;
        }

        if (
          req.method ===
            'GET' &&
          staticFiles[
            url.pathname
          ]
        ) {

          const staticFile =
            staticFiles[
              url.pathname
            ];

          serveFile(
            res,

            path.join(
              PUBLIC_DIR,
              staticFile.file
            ),

            staticFile.type
          );

          return;
        }

        res.writeHead(
          404
        );

        res.end(
          'Not found'
        );

      } catch (
        error
      ) {

        console.error(
          'Szerverhiba:',
          error
        );

        if (
          !res.headersSent
        ) {
          sendJson(
            res,
            500,
            {
              ok:
                false,

              success:
                false,

              error:
                error.message,

              answer:
                'Technikai hiba történt. Kérlek, próbáld meg újra.'
            }
          );
        }
      }
    }
  );

/* =========================================================
   SZERVER INDÍTÁS
========================================================= */

server.on(
  'error',
  (
    error
  ) => {

    console.error(
      'Szerverindítási hiba:',
      error
    );

    process.exit(
      1
    );
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

    console.log(
      '=========================================='
    );

    console.log(
      ' Kérdezd a készítőt! – Éles 2.1 elindult'
    );

    console.log(
      ` Tudáselemek: ${knowledge.length}`
    );

    console.log(
      ` Admin: ${
        ADMIN_TOKEN
          ? 'BEKAPCSOLVA'
          : 'KIKAPCSOLVA'
      }`
    );

    console.log(
      ` Supabase naplózás: ${
        supabaseConfigured()
          ? 'BEKAPCSOLVA'
          : 'KIKAPCSOLVA'
      }`
    );

    console.log(
      ` UNAS API: ${
        String(
          process.env.UNAS_API_KEY ||
          ''
        ).trim()
          ? 'BEKAPCSOLVA'
          : 'KIKAPCSOLVA'
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
