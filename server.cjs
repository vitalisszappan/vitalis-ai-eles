'use strict';

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

const UNAS_KNOWLEDGE_PATH = path.join(
  DATA_DIR,
  'unas-knowledge.json'
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
   UNAS MODUL
========================================================= */

const {
  testUnasConnection,
  buildUnasKnowledge
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
    {
      recursive: true
    }
  );
}

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
   TUDÁSBÁZIS
========================================================= */

let knowledge = [];

let knowledgeStats = {
  base: 0,
  unas: 0,
  total: 0
};

let loadedAt = null;

/* Az admin felületen jóváhagyott tudás tartósan Supabase-ben tárolódik. */
let approvedKnowledge = [];

/* ---------------------------------------------------------
   JSON OLVASÁS
--------------------------------------------------------- */

function readJsonFile(
  filePath
) {
  if (
    !fs.existsSync(
      filePath
    )
  ) {
    return null;
  }

  const raw =
    fs.readFileSync(
      filePath,
      'utf8'
    );

  return JSON.parse(
    raw
  );
}

/* ---------------------------------------------------------
   ALAP TUDÁSELEMEK
--------------------------------------------------------- */

function extractKnowledgeItems(
  raw
) {
  if (
    Array.isArray(
      raw
    )
  ) {
    return raw;
  }

  if (
    raw &&
    Array.isArray(
      raw.items
    )
  ) {
    return raw.items;
  }

  return [];
}

/* ---------------------------------------------------------
   UNAS TUDÁSELEM ÁTALAKÍTÁSA
--------------------------------------------------------- */

function normalizeUnasKnowledgeItem(
  item
) {
  if (
    !item ||
    typeof item !== 'object'
  ) {
    return null;
  }

  const title =
    String(
      item.title ||
      item.name ||
      ''
    ).trim();

  const answer =
    String(
      item.fullAnswer ||
      item.shortAnswer ||
      item.answer ||
      ''
    ).trim();

  if (
    !item.id ||
    !title ||
    !answer
  ) {
    return null;
  }

  const canonicalQuestion =
    String(
      item.canonicalQuestion ||
      item.question ||
      `${title} információ`
    ).trim();

  const questionVariants = [
    canonicalQuestion,
    `Mit kell tudni a ${title} termékről?`,
    `Milyen a ${title}?`,
    `${title} használata`,
    `${title} információ`
  ];

  if (
    item.type === 'category' ||
    item.sourceType === 'category'
  ) {
    questionVariants.push(
      `Milyen termékek vannak a ${title} kategóriában?`,
      `Mit ajánlotok a ${title} kategóriából?`
    );
  }

  const keywords = [
    title,
    item.name,
    item.sku,
    item.type,
    item.sourceType
  ]
    .filter(Boolean)
    .map(
      (value) =>
        String(value)
    );

  return {
    id:
      String(item.id),

    title,

    canonicalQuestion,

    questionVariants:
      [...new Set(
        questionVariants
          .filter(Boolean)
      )],

    shortAnswer:
      answer,

    fullAnswer:
      answer,

    category:
      item.type === 'category'
        ? title
        : 'UNAS termék',

    subcategory:
      item.sourceType ||
      item.type ||
      '',

    products:
      item.type === 'product'
        ? [title]
        : [],

    keywords:
      [...new Set(
        keywords
      )],

    intents: [
      item.type === 'category'
        ? 'category-information'
        : 'product-information'
    ],

    source:
      'unas',

    sourceType:
      item.sourceType ||
      item.type ||
      'unknown',

    productId:
      item.productId ||
      '',

    categoryId:
      item.categoryId ||
      '',

    sku:
      item.sku ||
      '',

    price:
      item.price ||
      '',

    unit:
      item.unit ||
      '',

    url:
      item.url ||
      '',

    priority:
      Number(
        item.priority ||
        70
      ),

    active:
      item.active !== false,

    updatedAt:
      item.updatedAt ||
      null
  };
}

/* ---------------------------------------------------------
   TUDÁSBÁZIS BETÖLTÉSE
--------------------------------------------------------- */

function loadKnowledge() {

  if (
    !fs.existsSync(
      KNOWLEDGE_PATH
    )
  ) {
    throw new Error(
      'A data/knowledge.json fájl nem található.'
    );
  }

  const baseRaw =
    readJsonFile(
      KNOWLEDGE_PATH
    );

  const baseItems =
    extractKnowledgeItems(
      baseRaw
    )
      .filter(
        (item) =>
          item &&
          typeof item === 'object' &&
          item.id
      );

  let unasItems = [];

  if (
    fs.existsSync(
      UNAS_KNOWLEDGE_PATH
    )
  ) {
    try {

      const unasRaw =
        readJsonFile(
          UNAS_KNOWLEDGE_PATH
        );

      unasItems =
        extractKnowledgeItems(
          unasRaw
        )
          .map(
            normalizeUnasKnowledgeItem
          )
          .filter(Boolean);

    } catch (
      error
    ) {

      console.error(
        'UNAS tudásbázis betöltési hiba:',
        error.message
      );
    }
  }

  /*
    Az UNAS aktuális termékadatai kerülnek előre,
    hogy aktuális webshopadat esetén ez legyen erősebb.
  */

  knowledge = [
    ...approvedKnowledge,
    ...unasItems,
    ...baseItems
  ];

  knowledgeStats = {
    base:
      baseItems.length,

    unas:
      unasItems.length,

    approved:
      approvedKnowledge.length,

    total:
      knowledge.length
  };

  loadedAt =
    new Date()
      .toISOString();

  console.log(
    `Alap tudáselemek: ${knowledgeStats.base}`
  );

  console.log(
    `UNAS tudáselemek: ${knowledgeStats.unas}`
  );

  console.log(
    `Összes tudáselem: ${knowledgeStats.total}`
  );
}

loadKnowledge();

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

  return Array.isArray(
    ids
  )
    ? ids
        .filter(Boolean)
        .slice(
          0,
          30
        )
    : [];
}

function normalizeConfidence(
  result
) {
  const value =
    result?.confidence ??
    result?.score;

  const number =
    Number(
      value
    );

  return Number.isFinite(
    number
  )
    ? number
    : null;
}

function supabaseConfigured() {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_SERVICE_ROLE_KEY
  );
}

function unasConfigured() {
  return Boolean(
    String(
      process.env.UNAS_API_KEY ||
      ''
    ).trim()
  );
}

function getSupabaseKeyType() {

  if (
    SUPABASE_SERVICE_ROLE_KEY
      .startsWith(
        'sb_secret_'
      )
  ) {
    return 'secret';
  }

  if (
    SUPABASE_SERVICE_ROLE_KEY
      .startsWith(
        'eyJ'
      )
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

  if (
    !ADMIN_TOKEN
  ) {

    sendJson(
      res,
      503,
      {
        ok:
          false,

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
        ok:
          false,

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
      .startsWith(
        'eyJ'
      )
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

      } catch (
        error
      ) {

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
                  status >= 200 &&
                  status < 300
                ) {

                  resolve({
                    ok:
                      true,

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
        reject
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
   BESZÉLGETÉS MENTÉSE
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
            .slice(
              0,
              30
            )
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
      'SUPABASE MENTÉS SIKERTELEN:',
      error.message
    );
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
        ) ||
        200,
        1000
      )
    );

  return fs
    .readFileSync(
      CONVERSATION_LOG,
      'utf8'
    )
    .split(
      /\r?\n/
    )
    .filter(Boolean)
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
    .filter(Boolean);
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
        ) ||
        200,
        1000
      )
    );

  const result =
    await supabaseRequest({

      method:
        'GET',

      pathname:
        '/rest/v1/chat_conversations' +
        '?select=*' +
        '&order=created_at.desc' +
        `&limit=${safeLimit}`
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
   TUDÁSHIÁNY
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
   JÓVÁHAGYOTT TUDÁS / TUDÁSHIÁNY KEZELÉS
========================================================= */

function normalizeGapKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugifyKnowledgeId(value) {
  return normalizeGapKey(value)
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'tudaselem';
}

function buildApprovedKnowledgeItem(row) {
  if (!row || !row.question || !row.answer) return null;

  const id = Array.isArray(row.matched_knowledge_ids) && row.matched_knowledge_ids[0]
    ? String(row.matched_knowledge_ids[0])
    : `approved-${slugifyKnowledgeId(row.question)}`;

  const question = cleanText(row.question, 4000);
  const answer = cleanText(row.answer, 12000);

  return {
    id,
    title: cleanText(row.question, 180),
    canonicalQuestion: question,
    questionVariants: [question],
    shortAnswer: answer,
    fullAnswer: answer,
    category: 'Jóváhagyott Vitalis tudás',
    subcategory: 'admin',
    products: [],
    keywords: normalizeGapKey(question).split(' ').filter((token) => token.length >= 3),
    intents: ['approved-knowledge'],
    source: 'approved-knowledge',
    sourceType: 'admin',
    priority: 200,
    active: true,
    updatedAt: row.created_at || new Date().toISOString()
  };
}

async function getOpenKnowledgeGaps(limit = 500) {
  let gaps;

  try {
    gaps = await readSupabaseKnowledgeGaps(limit);
  } catch (error) {
    console.error(
      'Supabase gap olvasási hiba:',
      error.message
    );

    gaps = null;
  }

  if (gaps === null) {
    gaps = readLocalKnowledgeGaps(limit);
  }

  let approvedRows = [];
  let dismissedRows = [];

  if (supabaseConfigured()) {
    try {
      approvedRows =
        await readApprovedKnowledgeRows();

      dismissedRows =
        await readSupabaseDismissedGaps();

    } catch (error) {
      console.error(
        'Gap státusz olvasási hiba:',
        error.message
      );
    }
  }

  const resolvedKeys =
    new Set([
      ...approvedRows.map(
        (row) =>
          normalizeGapKey(
            row.question
          )
      ),

      ...dismissedRows.map(
        (row) =>
          normalizeGapKey(
            row.question
          )
      )
    ]);

  const unique =
    new Map();

  for (const gap of gaps) {

    const question =
      String(
        gap?.question ||
        ''
      ).trim();

    /*
      Hibás technikai bejegyzések
      nem kerülhetnek a Tudáshiányok közé.
    */

    if (
      !question ||
      /^(undefined|null)$/i.test(
        question
      )
    ) {
      continue;
    }

    const key =
      normalizeGapKey(
        question
      );

    if (
      !key ||
      key === 'undefined' ||
      key === 'null' ||
      resolvedKeys.has(
        key
      ) ||
      unique.has(
        key
      )
    ) {
      continue;
    }

    unique.set(
      key,
      {
        ...gap,

        question,

        key
      }
    );
  }

  return Array.from(
    unique.values()
  );
}

async function hydrateApprovedKnowledge() {
  if (!supabaseConfigured()) {
    approvedKnowledge = [];
    loadKnowledge();
    return;
  }

  try {
    const rows = await readApprovedKnowledgeRows();
    const byQuestion = new Map();

    for (const row of rows) {
      const item = buildApprovedKnowledgeItem(row);
      if (!item) continue;
      byQuestion.set(normalizeGapKey(item.canonicalQuestion), item);
    }

    approvedKnowledge = Array.from(byQuestion.values());
    loadKnowledge();
    console.log(`Jóváhagyott admin tudáselemek: ${approvedKnowledge.length}`);
  } catch (error) {
    console.error('Jóváhagyott tudás visszatöltési hiba:', error.message);
  }
}

function readLocalKnowledgeGaps(limit = 200) {
  if (!fs.existsSync(KNOWLEDGE_GAP_LOG)) return [];
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 2000));

  return fs.readFileSync(KNOWLEDGE_GAP_LOG, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .reverse()
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean)
    .slice(0, safeLimit)
    .map((item) => ({
      created_at: item.at || null,
      question: item.question || '',
      answer: '',
      score: Number(item.score || 0),
      history: Array.isArray(item.history) ? item.history : [],
      source: 'gap'
    }));
}

async function readSupabaseKnowledgeGaps(limit = 500) {
  if (!supabaseConfigured()) return null;

  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const result = await supabaseRequest({
    method: 'GET',
    pathname:
      '/rest/v1/chat_conversations' +
      '?select=created_at,session_id,question,answer,confidence,page_url,source' +
      '&source=eq.gap' +
      '&order=created_at.desc' +
      `&limit=${safeLimit}`
  });

  return result.body ? JSON.parse(result.body) : [];
}

async function readSupabaseDismissedGaps(limit = 2000) {
  if (!supabaseConfigured()) return [];

  const safeLimit = Math.max(1, Math.min(Number(limit) || 2000, 5000));
  const result = await supabaseRequest({
    method: 'GET',
    pathname:
      '/rest/v1/chat_conversations' +
      '?select=question,source' +
      '&source=eq.dismissed-gap' +
      `&limit=${safeLimit}`
  });

  return result.body ? JSON.parse(result.body) : [];
}

async function getOpenKnowledgeGaps(limit = 500) {
  let gaps;

  try {
    gaps = await readSupabaseKnowledgeGaps(limit);
  } catch (error) {
    console.error('Supabase gap olvasási hiba:', error.message);
    gaps = null;
  }

  if (gaps === null) gaps = readLocalKnowledgeGaps(limit);

  let approvedRows = [];
  let dismissedRows = [];

  if (supabaseConfigured()) {
    try {
      approvedRows = await readApprovedKnowledgeRows();
      dismissedRows = await readSupabaseDismissedGaps();
    } catch (error) {
      console.error('Gap státusz olvasási hiba:', error.message);
    }
  }

  const resolvedKeys = new Set([
    ...approvedRows.map((row) => normalizeGapKey(row.question)),
    ...dismissedRows.map((row) => normalizeGapKey(row.question))
  ]);

  const unique = new Map();
  for (const gap of gaps) {
    const key = normalizeGapKey(gap.question);
    if (!key || resolvedKeys.has(key) || unique.has(key)) continue;
    unique.set(key, { ...gap, key });
  }

  return Array.from(unique.values());
}

async function handleAdminKnowledgeGaps(req, res, url) {
  if (!authorizeAdmin(req, res, url)) return;

  const limit = Number(url.searchParams.get('limit') || 500);

  try {
    const items = await getOpenKnowledgeGaps(limit);
    sendJson(res, 200, {
      ok: true,
      items,
      count: items.length,
      storage: supabaseConfigured() ? 'supabase' : 'local'
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

async function handleApproveKnowledgeGap(req, res, url) {
  if (!authorizeAdmin(req, res, url)) return;

  const rawBody = await parseBody(req);
  const parsed = JSON.parse(rawBody || '{}');
  const question = cleanText(parsed.question, 4000);
  const answer = cleanText(parsed.answer, 12000);

  if (!question || !answer) {
    sendJson(res, 400, {
      ok: false,
      error: 'A kérdés és a jóváhagyott válasz is kötelező.'
    });
    return;
  }

  const knowledgeId = `approved-${Date.now()}-${slugifyKnowledgeId(question)}`;
  const row = {
    created_at: new Date().toISOString(),
    session_id: 'admin-knowledge-builder',
    question,
    answer,
    confidence: 100,
    matched_knowledge_ids: [knowledgeId],
    source: 'approved-knowledge',
    response_ms: 0,
    user_agent: 'Vitalis AI Központ',
    page_url: ''
  };

  if (supabaseConfigured()) {
    await supabaseRequest({
      method: 'POST',
      pathname: '/rest/v1/chat_conversations',
      body: row
    });
  } else {
    fs.appendFileSync(CONVERSATION_LOG, JSON.stringify(row) + '\n', 'utf8');
  }

  const item = buildApprovedKnowledgeItem(row);
  approvedKnowledge = approvedKnowledge.filter(
    (existing) => normalizeGapKey(existing.canonicalQuestion) !== normalizeGapKey(question)
  );
  approvedKnowledge.unshift(item);
  loadKnowledge();

  sendJson(res, 200, {
    ok: true,
    item,
    knowledgeStats,
    loadedAt,
    message: 'A tudáselem jóváhagyva és azonnal aktiválva.'
  });
}

async function handleDismissKnowledgeGap(req, res, url) {
  if (!authorizeAdmin(req, res, url)) return;

  const rawBody = await parseBody(req);
  const parsed = JSON.parse(rawBody || '{}');
  const question = cleanText(parsed.question, 4000);

  if (!question) {
    sendJson(res, 400, { ok: false, error: 'A lezárandó kérdés hiányzik.' });
    return;
  }

  const row = {
    created_at: new Date().toISOString(),
    session_id: 'admin-knowledge-builder',
    question,
    answer: cleanText(parsed.reason || 'Lezárva tudáselem létrehozása nélkül.', 1000),
    confidence: 100,
    matched_knowledge_ids: [],
    source: 'dismissed-gap',
    response_ms: 0,
    user_agent: 'Vitalis AI Központ',
    page_url: ''
  };

  if (supabaseConfigured()) {
    await supabaseRequest({
      method: 'POST',
      pathname: '/rest/v1/chat_conversations',
      body: row
    });
  } else {
    fs.appendFileSync(CONVERSATION_LOG, JSON.stringify(row) + '\n', 'utf8');
  }

  sendJson(res, 200, { ok: true, message: 'A tudáshiány lezárva.' });
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
  cache = 'no-store'
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
  limit = 5e6
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
    {

      success:
        true,

      ...result,

      confidence,

      matchedKnowledgeIds
    }
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
      url.searchParams.get(
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
      items ||
      [],
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
    extractKnowledgeItems(
      parsed
    );

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

      stats:
        knowledgeStats,

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
      `UNAS kapcsolat sikeres. Termékek: ${result.products}, kategóriák: ${result.categories}`
    );

    sendJson(
      res,
      200,
      {

        ok:
          true,

        products:
          result.products,

        categories:
          result.categories,

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
   UNAS TUDÁSSZINKRON
========================================================= */

async function handleUnasSync(
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
      '=========================================='
    );

    console.log(
      'UNAS TUDÁSSZINKRON INDUL'
    );

    const result =
      await buildUnasKnowledge();

    // A kereskedelmi katalógussnapshot ebben a fejlesztési körben
    // szándékosan nincs bekötve a chatbot válaszadási útvonalába.

    console.log(
      `UNAS szinkron sikeres. Termékek: ${result.products}`
    );

    console.log(
      `Kategóriák: ${result.categories}`
    );

    console.log(
      `UNAS katalógussnapshot: ${result.file}`
    );

    console.log(
      '=========================================='
    );

    sendJson(
      res,
      200,
      {

        ok:
          true,

        products:
          result.products,

        categories:
          result.categories,

        unasItems:
          result.total,

        knowledgeStats,

        responseMs:
          result.responseMs,

        loadedAt,

        message:
          `UNAS katalógusszinkron sikeres. ${result.products} termék és ${result.categories} kategória került a külön snapshotba; a chatbot aktív tudása nem változott.`
      }
    );

  } catch (
    error
  ) {

    console.error(
      'UNAS TUDÁSSZINKRON SIKERTELEN:',
      error
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
        'Éles 2.3',

      knowledge:
        knowledgeStats,

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
        unasConfigured()
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

          res.end();

          return;
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

          await handleChat(
            req,
            res
          );

          return;
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

          await handleAdminConversations(
            req,
            res,
            url
          );

          return;
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

          await handleConversationExport(
            req,
            res,
            url
          );

          return;
        }

        /* -------------------------
           TUDÁSHIÁNYOK
        ------------------------- */

        if (
          req.method ===
          'GET' &&
          url.pathname ===
          '/api/admin/knowledge-gaps'
        ) {

          await handleAdminKnowledgeGaps(
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
          '/api/admin/knowledge-gaps/approve'
        ) {

          await handleApproveKnowledgeGap(
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
          '/api/admin/knowledge-gaps/dismiss'
        ) {

          await handleDismissKnowledgeGap(
            req,
            res,
            url
          );

          return;
        }

        /* -------------------------
           TUDÁS IMPORT
        ------------------------- */

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

        /* -------------------------
           UNAS TESZT
        ------------------------- */

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

        /* -------------------------
           UNAS SZINKRON
        ------------------------- */

        if (
          req.method ===
          'POST' &&
          url.pathname ===
          '/api/admin/unas/sync'
        ) {

          await handleUnasSync(
            req,
            res,
            url
          );

          return;
        }

        /* -------------------------
           STÁTUSZ
        ------------------------- */

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

        /* -------------------------
           CHAT OLDAL
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

        /* -------------------------
           DEMO
        ------------------------- */

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

        /* -------------------------
           ADMIN
        ------------------------- */

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

        /* -------------------------
           STATIKUS FÁJLOK
        ------------------------- */

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
   SZERVERHIBA
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

/* =========================================================
   INDÍTÁS
========================================================= */

async function startServer() {

  await hydrateApprovedKnowledge();

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
        ' Kérdezd a készítőt! – Éles 2.3 elindult'
      );

      console.log(
        ` Alap tudáselemek: ${knowledgeStats.base}`
      );

      console.log(
        ` UNAS tudáselemek: ${knowledgeStats.unas}`
      );

      console.log(
        ` Jóváhagyott admin tudáselemek: ${knowledgeStats.approved || 0}`
      );

      console.log(
        ` Összes tudáselem: ${knowledgeStats.total}`
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
          unasConfigured()
            ? 'BEKAPCSOLVA'
            : 'KIKAPCSOLVA'
        }`
      );

      console.log(
        '=========================================='
      );
    }
  );
}

startServer()
  .catch(
    (
      error
    ) => {

      console.error(
        'Indítási hiba:',
        error
      );

      process.exit(
        1
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

    process.exit(
      0
    );
  }
);

process.on(
  'SIGTERM',

  () => {

    cleanupPid();

    process.exit(
      0
    );
  }
);
