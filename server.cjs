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

const COMMERCE_EVENT_LOG = process.env.COMMERCE_EVENT_LOG || path.join(LOG_DIR, 'commerce-events.jsonl');
const ORDER_PROOF_LOG = process.env.ORDER_PROOF_LOG || path.join(LOG_DIR, 'order-proofs-poc.jsonl');
const COMMERCE_OUTCOME_LOG = process.env.COMMERCE_OUTCOME_LOG || path.join(LOG_DIR, 'commerce-outcomes-poc.jsonl');

const KNOWLEDGE_GAP_LOG = path.join(
  LOG_DIR,
  'knowledge-gaps.jsonl'
);

const KNOWLEDGE_TASK_LOG = path.join(LOG_DIR, 'knowledge-tasks.jsonl');
const KNOWLEDGE_DRAFT_LOG = path.join(LOG_DIR, 'knowledge-drafts.jsonl');
const KNOWLEDGE_CLUSTER_LOG = path.join(LOG_DIR, 'knowledge-clusters.jsonl');
const CANONICAL_MAPPING_PATH = path.join(DATA_DIR, 'canonical-unas-mapping.json');

const { STATUSES: KNOWLEDGE_TASK_STATUSES, taskFromConversation, mergeTasks, sortKnowledgeTasks, calculateEstimatedImpact } = require('./engine/knowledge-tasks.cjs');
const { DRAFT_TYPES, GENERATION_STATUSES, SAFETY_STATUSES, contentHash, generateKnowledgeDraft, validateDraft, buildKnowledgeExport } = require('./engine/knowledge-drafts.cjs');
const { STATUSES: KNOWLEDGE_CLUSTER_STATUSES, clusterKnowledgeTasks } = require('./engine/knowledge-clusters.cjs');
const { resolveAdministrativeIntent } = require('./engine/admin-intents.cjs');
const {
  validateEvent: validateCommerceEvent,
  createRateLimiter,
  parseAllowedOrigins
} = require('./engine/commerce-events.cjs');
const { createCommerceEventStore } = require('./engine/commerce-event-store.cjs');
const { DEFAULT_CLOCK_DRIFT_MS, validateOrderProof, processOrderProof, orderProofHttpStatus } = require('./engine/order-proof.cjs');
const { createOrderProofStore } = require('./engine/order-proof-store.cjs');
const { createCommerceOutcomeStore } = require('./engine/commerce-outcome-store.cjs');
const { learningSignalFromOutcome } = require('./engine/commerce-learning-signals.cjs');
const { formatSanitizedRequestError, formatCommerceOutcomeDiagnostic } = require('./engine/technical-error-sanitizer.cjs');
const { createCommerceHealthTracker, buildCommerceHealth } = require('./engine/commerce-health.cjs');
const { verifyUnasOrder } = require('./engine/unas-order-verifier.cjs');
const { createPermissionPreflightHandler } = require('./engine/unas-permission-preflight.cjs');
const { validatePreflightOrderKey, preflightUnasOrder, toPreflightDiagnostic } = require('./engine/unas-revenue-preflight.cjs');

function readCanonicalProductStatuses() {
  try {
    const raw = JSON.parse(fs.readFileSync(CANONICAL_MAPPING_PATH, 'utf8'));
    return Object.fromEntries((raw.mappings || []).map(item => [item.canonicalId, item.mappingStatus]));
  } catch { return {}; }
}

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

function normalizeSupabaseIdentifier(value, fallback) {
  const text = String(value || '').trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(text) ? text : fallback;
}

const CONVERSATION_TABLE = normalizeSupabaseIdentifier(
  process.env.SUPABASE_CONVERSATION_TABLE,
  'chat_conversations'
);

const CONVERSATION_COLUMNS = Object.freeze([
  'id',
  'created_at',
  'session_id',
  'question',
  'answer',
  'confidence',
  'matched_knowledge_ids',
  'source',
  'response_ms',
  'user_agent',
  'page_url'
]);

const CONVERSATION_BACKFILL_SELECT = CONVERSATION_COLUMNS.join(',');

/* =========================================================
   UNAS MODUL
========================================================= */

const {
  testUnasConnection,
  buildUnasKnowledge,
  UNAS_CATALOG_PATH
} = require('./unas-sync.cjs');

const {
  createUnasSyncCoordinator
} = require('./unas-sync-coordinator.cjs');

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

const productionRuntime = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' || Boolean(process.env.RENDER_SERVICE_ID);
const commerceEventStore = createCommerceEventStore({
  supabaseConfigured: supabaseConfigured(), productionRuntime,
  request: supabaseRequest, filePath: COMMERCE_EVENT_LOG
});
const orderProofStore = createOrderProofStore({
  supabaseConfigured: supabaseConfigured(), productionRuntime,
  request: supabaseRequest, filePath: ORDER_PROOF_LOG
});
const commerceOutcomeStore = createCommerceOutcomeStore({
  supabaseConfigured: supabaseConfigured(), productionRuntime,
  request: supabaseRequest, filePath: COMMERCE_OUTCOME_LOG
});
const commerceHealthTracker = createCommerceHealthTracker();
const allowCommerceEvent = createRateLimiter({
  limit: Number(process.env.COMMERCE_EVENT_RATE_LIMIT) || 60,
  windowMs: 60_000
});
const allowOrderProof = createRateLimiter({
  limit: Number(process.env.ORDER_PROOF_RATE_LIMIT) || 20,
  windowMs: 60_000
});
const allowUnasRevenuePreflight = createRateLimiter({
  limit: Number(process.env.UNAS_REVENUE_PREFLIGHT_RATE_LIMIT) || 5,
  windowMs: 60_000
});
const orderProofClockDriftMs = Number.isFinite(Number(process.env.ORDER_PROOF_CLOCK_DRIFT_MS))
  ? Number(process.env.ORDER_PROOF_CLOCK_DRIFT_MS) : DEFAULT_CLOCK_DRIFT_MS;
const configuredCommerceOrigins = parseAllowedOrigins([
  'https://www.vitalis-szappan.hu',
  'https://vitalis-szappan.hu',
  process.env.RENDER_EXTERNAL_URL,
  process.env.COMMERCE_ALLOWED_ORIGINS
].filter(Boolean).join(','));

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
  url,
  allowQueryToken = true
) {
  return String(
    req.headers[
      'x-admin-token'
    ] ||
    (allowQueryToken && url.searchParams.get(
      'token'
    )) ||
    ''
  ).trim();
}

function authorizeAdmin(
  req,
  res,
  url,
  options = {}
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
      url,
      options.allowQueryToken !== false
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
  body = null,
  headers: extraHeaders = {},
  operation = 'supabase_request',
  table = getSupabaseTableFromPath(pathname)
}) {

  const addContext = (error) => {
    if (error && typeof error === 'object') {
      error.operation = operation;
      error.table = table;
    }
    return error;
  };

  return new Promise(
    (
      resolve,
      reject
    ) => {

      if (
        !supabaseConfigured()
      ) {

        reject(
          addContext(new Error(
            'SUPABASE_URL vagy SUPABASE_SERVICE_ROLE_KEY hiányzik.'
          ))
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
          addContext(new Error(
            `Hibás SUPABASE_URL: ${error.message}`
          ))
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
            'application/json',
          ...extraHeaders
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

        headers.Prefer = headers.Prefer || 'return=minimal';
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
                      responseBody,

                    headers:
                      response.headers
                  });

                  return;
                }

                reject(
                  createSupabaseRequestError({
                    status,
                    statusMessage:
                      response.statusMessage,
                    responseBody,
                    method,
                    pathname,
                    operation,
                    table
                  })
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
        (error) => reject(addContext(error))
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

function parseSupabaseErrorBody(responseBody) {
  try {
    const parsed = JSON.parse(responseBody || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function createSupabaseRequestError({
  status,
  statusMessage,
  responseBody,
  method,
  pathname,
  operation,
  table
}) {
  const parsed = parseSupabaseErrorBody(responseBody);
  const error = new Error(
    `Supabase HTTP ${status}${parsed.code ? ` ${parsed.code}` : ''}`
  );
  error.name = 'SupabaseRequestError';
  error.status = status;
  error.supabaseCode = parsed.code || null;
  error.supabaseMessage = String(parsed.message || statusMessage || '');
  error.supabaseDetails = String(parsed.details || '');
  error.method = method;
  error.pathname = pathname;
  error.operation = operation;
  error.table = table;
  return error;
}

function getSupabaseTableFromPath(pathname) {
  const match = String(pathname || '').match(/^\/rest\/v1\/([^?]+)/);
  return match ? decodeURIComponent(match[1]) : 'unknown';
}

function getSupabaseMissingColumn(error) {
  const text = [
    error?.supabaseMessage,
    error?.supabaseDetails
  ].filter(Boolean).join(' ');
  const match = text.match(/'([a-z0-9_]+)'\s+column/i);
  return match ? match[1] : null;
}

function logSafeTechnicalError(label, error, metadata = {}) {
  if (metadata.includeRequestContext) {
    console.error(`${label} ${formatSanitizedRequestError(error, metadata)}`);
    return;
  }
  const parts = [
    label,
    `operation=${metadata.operation || error?.operation || 'unknown'}`,
    `table=${metadata.table || error?.table || 'unknown'}`,
    `name=${error?.name || 'Error'}`,
    `status=${error?.status || 'n/a'}`,
    `code=${error?.supabaseCode || error?.code || 'n/a'}`
  ];
  const missingColumn = getSupabaseMissingColumn(error);
  if (missingColumn) parts.push(`missing_column=${missingColumn}`);
  console.error(parts.join(' '));
  if (error?.stack && metadata.includeStack !== false) {
    const safeStack = String(error.stack)
      .split(/\r?\n/)
      .filter(line => !/SUPABASE|ADMIN_TOKEN|X-Admin-Token|session_id|question|answer/i.test(line))
      .slice(0, 8)
      .join('\n');
    if (safeStack) console.error(safeStack);
  }
}

function supabaseTablePath(table, query = '') {
  return `/rest/v1/${table}${query}`;
}

function conversationTablePath(query = '') {
  return supabaseTablePath(CONVERSATION_TABLE, query);
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
      ),

    routing_trace:
      record.routing_trace && typeof record.routing_trace === 'object'
        ? {
            route: cleanText(record.routing_trace.route, 40),
            goal: cleanText(record.routing_trace.goal, 60),
            intent: cleanText(record.routing_trace.intent, 80),
            domain: cleanText(record.routing_trace.domain, 80),
            safetyClass: cleanText(record.routing_trace.safetyClass, 40),
            responseSource: cleanText(record.routing_trace.responseSource, 80),
            matchedRuleId: cleanText(record.routing_trace.matchedRuleId, 120),
            matchedCanonicalIds: Array.isArray(record.routing_trace.matchedCanonicalIds) ? record.routing_trace.matchedCanonicalIds.filter(Boolean).slice(0, 20) : [],
            matchedKnowledgeIds: Array.isArray(record.routing_trace.matchedKnowledgeIds) ? record.routing_trace.matchedKnowledgeIds.filter(Boolean).slice(0, 20) : [],
            confidence: Number.isFinite(Number(record.routing_trace.confidence)) ? Number(record.routing_trace.confidence) : null,
            rejectionReasons: Array.isArray(record.routing_trace.rejectionReasons) ? record.routing_trace.rejectionReasons.filter(Boolean).slice(0, 20) : []
          }
        : null
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
    await upsertKnowledgeTask(taskFromConversation(safe, { productStatuses: readCanonicalProductStatuses() }));
    return;
  }

  try {

    const { routing_trace, ...supabaseSafe } = safe;

    await supabaseRequest({

      method:
        'POST',

      pathname:
        conversationTablePath(),

      body:
        supabaseSafe,
      operation: 'conversation_write',
      table: CONVERSATION_TABLE
    });

    console.log(
      `SUPABASE MENTES SIKERES: operation=conversation_write table=${CONVERSATION_TABLE}`
    );

  } catch (
    error
  ) {

    logSafeTechnicalError('SUPABASE MENTES SIKERTELEN.', error, {
      operation: 'conversation_write',
      table: CONVERSATION_TABLE
    });
  }

  await upsertKnowledgeTask(taskFromConversation(safe, { productStatuses: readCanonicalProductStatuses() }));
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
        conversationTablePath(
          '?select=*' +
          '&order=created_at.desc' +
          `&limit=${safeLimit}`
        ),
      operation: 'conversation_list_read',
      table: CONVERSATION_TABLE
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

async function readApprovedKnowledgeRows(limit = 1000) {
  if (!supabaseConfigured()) return [];

  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  const result = await supabaseRequest({
    method: 'GET',
    pathname:
      conversationTablePath(
        '?select=created_at,question,answer,matched_knowledge_ids,source' +
        '&source=eq.approved-knowledge' +
        '&order=created_at.asc' +
        `&limit=${safeLimit}`
      ),
    operation: 'approved_knowledge_read',
    table: CONVERSATION_TABLE
  });

  return result.body ? JSON.parse(result.body) : [];
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
      conversationTablePath(
        '?select=created_at,session_id,question,answer,confidence,page_url,source' +
        '&source=eq.gap' +
        '&order=created_at.desc' +
        `&limit=${safeLimit}`
      ),
    operation: 'knowledge_gap_read',
    table: CONVERSATION_TABLE
  });

  return result.body ? JSON.parse(result.body) : [];
}

async function readSupabaseDismissedGaps(limit = 2000) {
  if (!supabaseConfigured()) return [];

  const safeLimit = Math.max(1, Math.min(Number(limit) || 2000, 5000));
  const result = await supabaseRequest({
    method: 'GET',
    pathname:
      conversationTablePath(
        '?select=question,source' +
        '&source=eq.dismissed-gap' +
        `&limit=${safeLimit}`
      ),
    operation: 'dismissed_gap_read',
    table: CONVERSATION_TABLE
  });

  return result.body ? JSON.parse(result.body) : [];
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
  if (!authorizeAdmin(req, res, url, { allowQueryToken: false })) return;

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
      pathname: conversationTablePath(),
      body: row,
      operation: 'approved_knowledge_write',
      table: CONVERSATION_TABLE
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
  if (!authorizeAdmin(req, res, url, { allowQueryToken: false })) return;

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
      pathname: conversationTablePath(),
      body: row,
      operation: 'dismissed_gap_write',
      table: CONVERSATION_TABLE
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
            Buffer.byteLength(body, 'utf8') >
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

function commerceOriginAllowed(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return false;
  let normalized;
  try { normalized = new URL(origin).origin; } catch { return false; }
  if (configuredCommerceOrigins.has(normalized)) return true;
  const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProtocol || (req.socket.encrypted ? 'https' : 'http');
  const ownOrigin = `${protocol}://${req.headers.host || ''}`;
  return normalized === ownOrigin;
}

function configuredCommerceOriginAllowed(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return false;
  try { return configuredCommerceOrigins.has(new URL(origin).origin); }
  catch { return false; }
}

async function handleCommerceEvent(req, res) {
  if (!commerceOriginAllowed(req)) return sendJson(res, 403, { ok: false, error: 'origin_not_allowed' });
  if (!/^application\/json(?:;|$)/i.test(String(req.headers['content-type'] || ''))) {
    return sendJson(res, 415, { ok: false, error: 'content_type_required' });
  }
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > 4096) {
    return sendJson(res, 413, { ok: false, error: 'payload_too_large' });
  }
  const rateKey = `${req.socket.remoteAddress || 'unknown'}:${req.headers.origin}`;
  if (!allowCommerceEvent(rateKey)) return sendJson(res, 429, { ok: false, error: 'rate_limited' });

  let parsed;
  try { parsed = JSON.parse((await parseBody(req, 4096)) || '{}'); }
  catch { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }
  const validation = validateCommerceEvent(parsed);
  if (!validation.ok) return sendJson(res, 400, { ok: false, error: validation.error });
  let stored;
  try { stored = await commerceEventStore.insertEvent(validation.event); }
  catch (error) {
    commerceHealthTracker.recordFailure('commerce_event_store_unavailable');
    logSafeTechnicalError('Commerce event storage failed.', error, { operation: 'commerce_event_insert', table: 'commerce_events' });
    return sendJson(res, 503, { ok: false, error: 'commerce_event_store_unavailable' });
  }
  return sendJson(res, stored.duplicate ? 200 : 201, {
    ok: true,
    eventId: validation.event.event_id,
    duplicate: stored.duplicate
  });
}

async function handleOrderProof(req, res) {
  const reject = (status, error) => {
    console.warn('[order-proof] rejected', JSON.stringify({
      status,
      error,
      originPresent: Boolean(String(req.headers.origin || '').trim()),
      contentTypeJson: /^application\/json(?:;|$)/i.test(String(req.headers['content-type'] || ''))
    }));
    return sendJson(res, status, { ok: false, error });
  };
  if (!configuredCommerceOriginAllowed(req)) return reject(403, 'origin_not_allowed');
  if (!/^application\/json(?:;|$)/i.test(String(req.headers['content-type'] || ''))) return reject(415, 'content_type_required');
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > 2048) return reject(413, 'payload_too_large');
  const rateKey = `${req.socket.remoteAddress || 'unknown'}:${req.headers.origin}:order-proof`;
  if (!allowOrderProof(rateKey)) return reject(429, 'rate_limited');
  let parsed;
  try { parsed = JSON.parse((await parseBody(req, 2048)) || '{}'); }
  catch (error) {
    const tooLarge = /nagy/i.test(String(error?.message));
    return reject(tooLarge ? 413 : 400, tooLarge ? 'payload_too_large' : 'invalid_json');
  }
  const validation = validateOrderProof(parsed, { clockDriftMs: orderProofClockDriftMs });
  if (!validation.ok) return reject(400, validation.error);
  const result = await processOrderProof(validation.proof, {
    eventStore: commerceEventStore,
    proofStore: orderProofStore,
    verifyOrder: (orderKey) => verifyUnasOrder(orderKey)
  });
  const status = orderProofHttpStatus(result);
  if (!result.ok) {
    commerceHealthTracker.recordFailure(result.error);
    console.warn('[order-proof] rejected', JSON.stringify({ status, error: result.error || 'proof_failed', originPresent: true, contentTypeJson: true }));
  }
  return sendJson(res, status, result);
}

async function handleAdminCommerceOutcomes(req, res, url) {
  if (!authorizeAdmin(req, res, url, { allowQueryToken: false })) return;
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);
  try {
    const outcomes = await commerceOutcomeStore.listOutcomes(limit);
    return sendJson(res, 200, { ok: true, storage: commerceOutcomeStore.kind, items: outcomes.map((outcome) => ({
      ...outcome, learningSignal: learningSignalFromOutcome(outcome), duplicate: false
    })) });
  } catch (error) {
    logSafeTechnicalError('Commerce outcome listing failed.', error, { operation: 'commerce_outcome_list', table: 'commerce_outcomes' });
    return sendJson(res, 503, { ok: false, error: 'commerce_outcome_store_unavailable' });
  }
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
    ,

    routing_trace:
      result.routing

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
      url,
      { allowQueryToken: false }
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

async function handleUnasRevenuePreflight(req, res, url) {
  if (!authorizeAdmin(req, res, url, { allowQueryToken: false })) return;
  const rateKey = `${req.socket.remoteAddress || 'unknown'}:unas-revenue-preflight`;
  if (!allowUnasRevenuePreflight(rateKey)) {
    sendJson(res, 429, { ok: false, error: 'rate_limited' });
    return;
  }
  const orderKey = String(url.searchParams.get('orderKey') || '').trim();
  if (!validatePreflightOrderKey(orderKey)) {
    sendJson(res, 400, { ok: false, error: 'invalid_order_key' });
    return;
  }
  try {
    const evidence = await preflightUnasOrder(orderKey);
    sendJson(res, 200, { ok: true, evidence });
  } catch (error) {
    // The upstream error and raw XML may contain order data, so neither is logged nor returned.
    console.info(JSON.stringify(toPreflightDiagnostic(error)));
    sendJson(res, 502, { ok: false, error: 'unas_preflight_failed' });
  }
}

const handleUnasPermissionPreflight = createPermissionPreflightHandler({
  adminToken: ADMIN_TOKEN,
  unasConfigured,
  sendJson,
  logger: (event) => console.info('[unas-permission-preflight]', JSON.stringify(event))
});

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
      url,
      { allowQueryToken: false }
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
      await unasSyncCoordinator.run('admin');

    console.log(
      `UNAS szinkron sikeres. Termékek: ${result.products}`
    );

    console.log(
      `Kategóriák: ${result.categories}`
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

        audit:
          result.audit,

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
      'UNAS TUDÁSSZINKRON SIKERTELEN'
    );

    sendJson(
      res,
      500,
      {

        ok:
          false,

        error:
          'Az UNAS katalógusszinkron sikertelen.'
      }
    );
  }
}

/* =========================================================
   RENDSZERÁLLAPOT
========================================================= */

async function handleUnasSnapshot(
  req,
  res,
  url
) {

  if (
    !authorizeAdmin(
      req,
      res,
      url,
      { allowQueryToken: false }
    )
  ) {

    return;
  }

  try {

    const body =
      await fs.promises.readFile(
        UNAS_CATALOG_PATH
      );

    // Sérült vagy részlegesen írt snapshotot ne szolgáljunk ki.
    JSON.parse(
      body.toString('utf8')
    );

    res.writeHead(
      200,
      {
        'Content-Type':
          'application/json; charset=utf-8',
        'Content-Length':
          body.length,
        'Cache-Control':
          'no-store',
        'X-Content-Type-Options':
          'nosniff'
      }
    );

    res.end(body);

  } catch (error) {

    if (error && error.code === 'ENOENT') {
      sendJson(
        res,
        404,
        {
          ok: false,
          error: 'Az UNAS katalógussnapshot nem található.'
        }
      );
      return;
    }

    console.error(
      'UNAS KATALOGUSSNAPSHOT LETOLTESI HIBA'
    );

    sendJson(
      res,
      500,
      {
        ok: false,
        error: 'Az UNAS katalógussnapshot nem tölthető le.'
      }
    );
  }

}

/* =========================================================
   KNOWLEDGE QUEUE
========================================================= */

function readLocalKnowledgeTasks() {
  if (!fs.existsSync(KNOWLEDGE_TASK_LOG)) return [];
  return fs.readFileSync(KNOWLEDGE_TASK_LOG, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function writeLocalKnowledgeTasks(items) {
  fs.writeFileSync(KNOWLEDGE_TASK_LOG, items.map(item => JSON.stringify(item)).join('\n') + (items.length ? '\n' : ''), 'utf8');
}

const KNOWLEDGE_TASK_TABLE = 'knowledge_tasks';
const KNOWLEDGE_TASK_COLUMNS = Object.freeze([
  'id', 'normalized_question_key', 'conversation_id', 'conversation_ids', 'question', 'answer', 'answer_source',
  'confidence_score', 'detected_intent', 'canonical_ids', 'page_url', 'occurred_at', 'classification',
  'classification_reason', 'root_cause', 'root_cause_reason', 'repair_target', 'estimated_impact',
  'impact_breakdown', 'priority', 'business_value', 'topic', 'product_family', 'suggested_action', 'status',
  'occurrence_count', 'first_seen_at', 'last_seen_at', 'reviewer_note', 'reviewed_at', 'resolved_at',
  'created_at', 'updated_at'
]);
const KNOWLEDGE_TASK_LEGACY_COLUMNS = Object.freeze([
  'id', 'normalized_question_key', 'conversation_id', 'conversation_ids', 'question', 'answer', 'answer_source',
  'confidence_score', 'detected_intent', 'canonical_ids', 'page_url', 'occurred_at', 'classification',
  'classification_reason', 'priority', 'business_value', 'topic', 'product_family', 'suggested_action', 'status',
  'occurrence_count', 'first_seen_at', 'last_seen_at', 'reviewer_note', 'reviewed_at', 'resolved_at',
  'created_at', 'updated_at'
]);
const KNOWLEDGE_TASK_NEW_SCHEMA_COLUMNS = new Set(KNOWLEDGE_TASK_COLUMNS.filter(column => !KNOWLEDGE_TASK_LEGACY_COLUMNS.includes(column)));

function pickKnowledgeTaskColumns(row, columns) {
  return Object.fromEntries(columns.map(column => [column, row[column]]));
}

function taskToRow(task, columns = KNOWLEDGE_TASK_COLUMNS) {
  const row = {
    id: task.id, normalized_question_key: task.normalizedQuestionKey, conversation_id: task.conversationId,
    conversation_ids: task.conversationIds, question: task.question, answer: task.answer, answer_source: task.answerSource,
    confidence_score: task.confidenceScore, detected_intent: task.detectedIntent, canonical_ids: task.canonicalIds,
    page_url: task.pageUrl, occurred_at: task.occurredAt, classification: task.classification,
    classification_reason: task.classificationReason, root_cause: task.rootCause, root_cause_reason: task.rootCauseReason,
    repair_target: task.repairTarget, estimated_impact: task.estimatedImpact, impact_breakdown: task.impactBreakdown,
    priority: task.priority, business_value: task.businessValue,
    topic: task.topic, product_family: task.productFamily, suggested_action: task.suggestedAction, status: task.status,
    occurrence_count: task.occurrenceCount, first_seen_at: task.firstSeenAt, last_seen_at: task.lastSeenAt,
    reviewer_note: task.reviewerNote, reviewed_at: task.reviewedAt, resolved_at: task.resolvedAt,
    created_at: task.createdAt, updated_at: task.updatedAt
  };
  return pickKnowledgeTaskColumns(row, columns);
}

function rowToTask(row) {
  const task = {};
  for (const [key, value] of Object.entries(row)) task[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  return task;
}

async function readKnowledgeTasks(limit = 500) {
  if (!supabaseConfigured()) return { storage: 'local', items: sortKnowledgeTasks(readLocalKnowledgeTasks()).slice(0, limit) };
  const result = await supabaseRequest({ method: 'GET', pathname: `/rest/v1/knowledge_tasks?select=*&limit=${Math.min(Math.max(Number(limit) || 500, 1), 1000)}`, operation: 'knowledge_tasks_read', table: KNOWLEDGE_TASK_TABLE });
  return { storage: 'supabase', items: sortKnowledgeTasks(JSON.parse(result.body || '[]').map(rowToTask)) };
}

async function upsertKnowledgeTask(incoming) {
  if (!supabaseConfigured()) {
    const items = readLocalKnowledgeTasks();
    const index = items.findIndex(item => item.id === incoming.id);
    if (index >= 0) {
      const old = items[index];
      const ids = [...new Set([...(old.conversationIds || []), ...incoming.conversationIds])];
      items[index] = { ...incoming, status: old.status, reviewerNote: old.reviewerNote, reviewedAt: old.reviewedAt, resolvedAt: old.resolvedAt, createdAt: old.createdAt, conversationIds: ids, occurrenceCount: ids.length, firstSeenAt: old.firstSeenAt < incoming.firstSeenAt ? old.firstSeenAt : incoming.firstSeenAt, updatedAt: new Date().toISOString() };
      const impact = calculateEstimatedImpact(items[index]); items[index].estimatedImpact = impact.total; items[index].impactBreakdown = impact.breakdown;
    } else items.push(incoming);
    writeLocalKnowledgeTasks(items);
    return;
  }
  let existing = [];
  try {
    const found = await supabaseRequest({ method: 'GET', pathname: `/rest/v1/knowledge_tasks?id=eq.${encodeURIComponent(incoming.id)}&select=*`, operation: 'knowledge_task_upsert_existing_read', table: KNOWLEDGE_TASK_TABLE });
    existing = JSON.parse(found.body || '[]');
  } catch (error) {
    logSafeTechnicalError('Knowledge Task Supabase olvasasi hiba; az upsert uj rekordkent folytatodik.', error);
  }
  const old = existing[0] ? rowToTask(existing[0]) : null;
  const ids = [...new Set([...(old?.conversationIds || []), ...incoming.conversationIds])];
  const task = old ? { ...incoming, status: old.status, reviewerNote: old.reviewerNote, reviewedAt: old.reviewedAt, resolvedAt: old.resolvedAt, createdAt: old.createdAt, conversationIds: ids, occurrenceCount: ids.length, firstSeenAt: old.firstSeenAt < incoming.firstSeenAt ? old.firstSeenAt : incoming.firstSeenAt, updatedAt: new Date().toISOString() } : incoming;
  const impact = calculateEstimatedImpact(task); task.estimatedImpact = impact.total; task.impactBreakdown = impact.breakdown;
  await upsertSupabaseKnowledgeTaskRow(task);
}

async function handleAdminKnowledgeTasks(req, res, url) {
  if (!authorizeAdmin(req, res, url)) return;
  try { sendJson(res, 200, { ok: true, ...(await readKnowledgeTasks(url.searchParams.get('limit') || 500)) }); }
  catch (error) { console.error('Knowledge Queue read failed.'); sendJson(res, 500, { ok: false, error: 'A Knowledge Queue jelenleg nem tölthető be.' }); }
}

let knowledgeTaskBackfillInFlight = false;

function mergeKnowledgeTaskForBackfill(incoming, old) {
  if (!old) return incoming;
  const conversationIds = [...new Set([...(old.conversationIds || []), ...(incoming.conversationIds || [])])];
  const task = { ...incoming, status: old.status, reviewerNote: old.reviewerNote, reviewedAt: old.reviewedAt,
    resolvedAt: old.resolvedAt, createdAt: old.createdAt, conversationIds, occurrenceCount: conversationIds.length,
    firstSeenAt: old.firstSeenAt < incoming.firstSeenAt ? old.firstSeenAt : incoming.firstSeenAt,
    updatedAt: new Date().toISOString() };
  const impact = calculateEstimatedImpact(task);
  task.estimatedImpact = impact.total;
  task.impactBreakdown = impact.breakdown;
  return task;
}

function summarizeTaskClassifications(tasks) {
  const summary = {};
  for (const task of tasks) summary[task.classification] = (summary[task.classification] || 0) + 1;
  return summary;
}

function isKnowledgeTaskSchemaFallbackError(error) {
  return error?.supabaseCode === 'PGRST204' &&
    KNOWLEDGE_TASK_NEW_SCHEMA_COLUMNS.has(getSupabaseMissingColumn(error));
}

async function upsertSupabaseKnowledgeTaskRow(task) {
  const pathname = `/rest/v1/${KNOWLEDGE_TASK_TABLE}?on_conflict=id`;
  const headers = { Prefer: 'resolution=merge-duplicates' };
  try {
    await supabaseRequest({ method: 'POST', pathname, body: taskToRow(task), headers, operation: 'knowledge_task_upsert', table: KNOWLEDGE_TASK_TABLE });
  } catch (error) {
    if (!isKnowledgeTaskSchemaFallbackError(error)) throw error;
    logSafeTechnicalError('Knowledge Task Supabase schema fallback used.', error);
    await supabaseRequest({ method: 'POST', pathname, body: taskToRow(task, KNOWLEDGE_TASK_LEGACY_COLUMNS), headers, operation: 'knowledge_task_upsert_legacy_fallback', table: KNOWLEDGE_TASK_TABLE });
  }
}

async function readAllSupabaseRows(pathname, { orderBy = 'id.asc', operation, table } = {}) {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const separator = pathname.includes('?') ? '&' : '?';
    const result = await supabaseRequest({ method: 'GET', pathname: `${pathname}${separator}order=${orderBy}&limit=${pageSize}&offset=${offset}`, operation, table });
    const page = JSON.parse(result.body || '[]');
    if (!Array.isArray(page)) throw new Error('invalid_supabase_response');
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function executeSupabaseKnowledgeTaskBackfill(write) {
  if (!supabaseConfigured()) throw new Error('supabase_not_configured');
  const conversations = await readAllSupabaseRows(
    conversationTablePath(`?select=${CONVERSATION_BACKFILL_SELECT}`),
    { operation: 'backfill_conversations_read', table: CONVERSATION_TABLE }
  );
  const tasks = mergeTasks(conversations, { productStatuses: readCanonicalProductStatuses() });
  const existingRows = await readAllSupabaseRows('/rest/v1/knowledge_tasks?select=*', { operation: 'backfill_knowledge_tasks_read', table: KNOWLEDGE_TASK_TABLE });
  const existingById = new Map(existingRows.map(row => [row.id, rowToTask(row)]));
  const result = { storageUsed: 'supabase', conversationsRead: conversations.length, tasksCreated: 0,
    tasksUpdated: 0, skipped: 0, classificationSummary: summarizeTaskClassifications(tasks), dryRun: !write };
  for (const incoming of tasks) {
    const old = existingById.get(incoming.id) || null;
    const oldConversationIds = new Set(old?.conversationIds || []);
    const hasNewConversation = (incoming.conversationIds || []).some(id => !oldConversationIds.has(id));
    if (!old) result.tasksCreated += 1;
    else if (hasNewConversation) result.tasksUpdated += 1;
    else { result.skipped += 1; continue; }
    if (!write) continue;
    const task = mergeKnowledgeTaskForBackfill(incoming, old);
    await upsertSupabaseKnowledgeTaskRow(task);
    existingById.set(task.id, task);
  }
  return result;
}

async function handleUpdateKnowledgeTask(req, res, url) {
  if (!authorizeAdmin(req, res, url, { allowQueryToken: false })) return;
  let parsed;
  try { parsed = JSON.parse((await parseBody(req)) || '{}'); } catch { return sendJson(res, 400, { ok: false, error: 'Hibás JSON.' }); }
  const id = cleanText(parsed.id, 80); const status = cleanText(parsed.status, 30); const reviewerNote = cleanText(parsed.reviewerNote, 4000) || '';
  if (!id || !KNOWLEDGE_TASK_STATUSES.includes(status)) return sendJson(res, 400, { ok: false, error: 'Érvénytelen id vagy státusz.' });
  const now = new Date().toISOString();
  try {
    if (supabaseConfigured()) {
      await supabaseRequest({ method: 'PATCH', pathname: `/rest/v1/knowledge_tasks?id=eq.${encodeURIComponent(id)}`, body: { status, reviewer_note: reviewerNote, reviewed_at: now, resolved_at: status === 'resolved' ? now : null, updated_at: now }, operation: 'knowledge_task_status_update', table: KNOWLEDGE_TASK_TABLE });
    } else {
      const items = readLocalKnowledgeTasks(); const item = items.find(entry => entry.id === id);
      if (!item) return sendJson(res, 404, { ok: false, error: 'A feladat nem található.' });
      Object.assign(item, { status, reviewerNote, reviewedAt: now, resolvedAt: status === 'resolved' ? now : null, updatedAt: now }); writeLocalKnowledgeTasks(items);
    }
    sendJson(res, 200, { ok: true, id, status, reviewerNote });
  } catch (error) { logSafeTechnicalError('Knowledge Task update failed.', error); sendJson(res, 500, { ok: false, error: 'A Knowledge Task jelenleg nem menthető.' }); }
}

async function handleKnowledgeTaskBackfill(req, res, url) {
  if (!authorizeAdmin(req, res, url, { allowQueryToken: false })) return;
  let parsed = {}; try { parsed = JSON.parse((await parseBody(req)) || '{}'); } catch { return sendJson(res, 400, { ok: false, error: 'Hibás JSON.' }); }
  if (knowledgeTaskBackfillInFlight) return sendJson(res, 409, { ok: false, error: 'A Knowledge Task backfill már folyamatban van.' });
  knowledgeTaskBackfillInFlight = true;
  try {
    sendJson(res, 200, { ok: true, ...(await executeSupabaseKnowledgeTaskBackfill(parsed.write === true)) });
  } catch (error) {
    logSafeTechnicalError('Knowledge Task Supabase backfill failed.', error);
    sendJson(res, 500, { ok: false, error: 'A Knowledge Task backfill jelenleg nem futtatható.' });
  } finally {
    knowledgeTaskBackfillInFlight = false;
  }
}

/* =========================================================
   KNOWLEDGE CLUSTERS
========================================================= */

const KNOWLEDGE_CLUSTER_TABLE = 'knowledge_clusters';
let knowledgeClusterRebuildInFlight = false;

function readLocalKnowledgeClusters() {
  if (!fs.existsSync(KNOWLEDGE_CLUSTER_LOG)) return [];
  return fs.readFileSync(KNOWLEDGE_CLUSTER_LOG, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function writeLocalKnowledgeClusters(items) {
  fs.writeFileSync(KNOWLEDGE_CLUSTER_LOG, items.map(item => JSON.stringify(item)).join('\n') + (items.length ? '\n' : ''), 'utf8');
}

function clusterToRow(cluster) {
  return {
    id:cluster.id, cluster_key:cluster.clusterKey, title:cluster.title, summary:cluster.summary, topic:cluster.topic,
    product_family:cluster.productFamily, classification_summary:cluster.classificationSummary, priority:cluster.priority,
    business_value:cluster.businessValue, estimated_impact:cluster.estimatedImpact, safety_level:cluster.safetyLevel,
    task_count:cluster.taskCount, occurrence_count:cluster.occurrenceCount, task_ids:cluster.taskIds,
    canonical_ids:cluster.canonicalIds, representative_question:cluster.representativeQuestion,
    suggested_action:cluster.suggestedAction, status:cluster.status, reviewer_note:cluster.reviewerNote,
    created_at:cluster.createdAt, updated_at:cluster.updatedAt
  };
}

async function readKnowledgeClusters() {
  if (!supabaseConfigured()) return { storage:'local', items:readLocalKnowledgeClusters() };
  const rows = await readAllSupabaseRows('/rest/v1/knowledge_clusters?select=*', { operation:'knowledge_clusters_read', table:KNOWLEDGE_CLUSTER_TABLE });
  return { storage:'supabase', items:rows.map(rowToTask) };
}

function clusterComparable(cluster) {
  const copy = { ...cluster }; delete copy.status; delete copy.reviewerNote; delete copy.createdAt; delete copy.updatedAt;
  return JSON.stringify(copy);
}

function mergeGeneratedClusters(generated, existing, now) {
  const existingById = new Map(existing.map(item => [item.id, item]));
  const generatedIds = new Set(generated.map(item => item.id));
  const merged = generated.map(cluster => {
    const old = existingById.get(cluster.id);
    if (!old) return cluster;
    return { ...cluster, status:old.status || 'open', reviewerNote:old.reviewerNote || '', createdAt:old.createdAt || cluster.createdAt,
      updatedAt:clusterComparable(old) === clusterComparable(cluster) ? (old.updatedAt || now) : now };
  });
  for (const old of existing) if (!generatedIds.has(old.id)) merged.push({ ...old, status:'dismissed', updatedAt:old.status === 'dismissed' ? old.updatedAt : now });
  return merged.sort((a,b) => String(a.id).localeCompare(String(b.id)));
}

async function executeKnowledgeClusterRebuild(write) {
  const now = new Date().toISOString();
  let tasks, existing, storageUsed;
  if (supabaseConfigured()) {
    const taskRows = await readAllSupabaseRows('/rest/v1/knowledge_tasks?select=*', { operation:'knowledge_cluster_tasks_read', table:KNOWLEDGE_TASK_TABLE });
    tasks = taskRows.map(rowToTask);
    const clusterRows = await readAllSupabaseRows('/rest/v1/knowledge_clusters?select=*', { operation:'knowledge_clusters_existing_read', table:KNOWLEDGE_CLUSTER_TABLE });
    existing = clusterRows.map(rowToTask); storageUsed = 'supabase';
  } else { tasks = readLocalKnowledgeTasks(); existing = readLocalKnowledgeClusters(); storageUsed = 'local'; }
  const generated = clusterKnowledgeTasks(tasks, { now });
  const existingById = new Map(existing.map(item => [item.id, item]));
  let clustersCreated = 0, clustersUpdated = 0, clustersUnchanged = 0;
  for (const cluster of generated) {
    const old = existingById.get(cluster.id);
    if (!old) clustersCreated += 1;
    else if (clusterComparable(old) === clusterComparable(cluster)) clustersUnchanged += 1;
    else clustersUpdated += 1;
  }
  clustersUpdated += existing.filter(item => !generated.some(cluster => cluster.id === item.id) && item.status !== 'dismissed').length;
  const merged = mergeGeneratedClusters(generated, existing, now);
  if (write) {
    if (storageUsed === 'supabase') await supabaseRequest({ method:'POST', pathname:'/rest/v1/knowledge_clusters?on_conflict=id', body:merged.map(clusterToRow), headers:{ Prefer:'resolution=merge-duplicates' }, operation:'knowledge_clusters_upsert', table:KNOWLEDGE_CLUSTER_TABLE });
    else writeLocalKnowledgeClusters(merged);
  }
  return { storageUsed, tasksRead:tasks.length, clustersGenerated:generated.length, clustersCreated, clustersUpdated,
    clustersUnchanged, singleTaskClusters:generated.filter(cluster => cluster.taskCount === 1).length,
    classificationSummary:summarizeTaskClassifications(tasks), topicSummary:summarizeTaskClassifications(tasks.map(task => ({ classification:task.topic || 'egyéb' }))), dryRun:!write };
}

async function handleKnowledgeClusterRebuild(req, res, url) {
  if (!authorizeAdmin(req, res, url, { allowQueryToken:false })) return;
  let parsed = {}; try { parsed = JSON.parse((await parseBody(req)) || '{}'); } catch { return sendJson(res, 400, { ok:false, error:'Hibás JSON.' }); }
  if (knowledgeClusterRebuildInFlight) return sendJson(res, 409, { ok:false, error:'A klaszterek újraépítése már folyamatban van.' });
  knowledgeClusterRebuildInFlight = true;
  try { sendJson(res, 200, { ok:true, ...(await executeKnowledgeClusterRebuild(parsed.write === true && Object.keys(parsed).length === 1)) }); }
  catch (error) { logSafeTechnicalError('Knowledge Cluster rebuild failed.', error); sendJson(res, 500, { ok:false, error:'A Knowledge Clusters újraépítése jelenleg nem futtatható.' }); }
  finally { knowledgeClusterRebuildInFlight = false; }
}

async function handleAdminKnowledgeClusters(req, res, url) {
  if (!authorizeAdmin(req, res, url, { allowQueryToken:false })) return;
  try { sendJson(res, 200, { ok:true, ...(await readKnowledgeClusters()) }); }
  catch (error) { logSafeTechnicalError('Knowledge Cluster read failed.', error); sendJson(res, 500, { ok:false, error:'A Knowledge Clusters jelenleg nem tölthető be.' }); }
}

async function handleUpdateKnowledgeCluster(req, res, url) {
  if (!authorizeAdmin(req, res, url, { allowQueryToken:false })) return;
  let parsed; try { parsed = JSON.parse((await parseBody(req)) || '{}'); } catch { return sendJson(res, 400, { ok:false, error:'Hibás JSON.' }); }
  const allowed = new Set(['id','status','reviewerNote']);
  if (Object.keys(parsed).some(key => !allowed.has(key))) return sendJson(res, 400, { ok:false, error:'Csak a státusz és a reviewerNote módosítható.' });
  const id = cleanText(parsed.id, 80), status = cleanText(parsed.status, 30), reviewerNote = cleanText(parsed.reviewerNote, 4000) || '';
  if (!id || !KNOWLEDGE_CLUSTER_STATUSES.includes(status)) return sendJson(res, 400, { ok:false, error:'Érvénytelen id vagy státusz.' });
  const updatedAt = new Date().toISOString();
  try {
    if (supabaseConfigured()) await supabaseRequest({ method:'PATCH', pathname:`/rest/v1/knowledge_clusters?id=eq.${encodeURIComponent(id)}`, body:{ status, reviewer_note:reviewerNote, updated_at:updatedAt }, operation:'knowledge_cluster_update', table:KNOWLEDGE_CLUSTER_TABLE });
    else { const items=readLocalKnowledgeClusters(), item=items.find(entry=>entry.id===id); if(!item)return sendJson(res,404,{ok:false,error:'A klaszter nem található.'}); Object.assign(item,{status,reviewerNote,updatedAt}); writeLocalKnowledgeClusters(items); }
    sendJson(res, 200, { ok:true, id, status, reviewerNote });
  } catch (error) { logSafeTechnicalError('Knowledge Cluster update failed.', error); sendJson(res, 500, { ok:false, error:'A Knowledge Cluster jelenleg nem menthető.' }); }
}

/* =========================================================
   KNOWLEDGE DRAFTS
========================================================= */

function readLocalKnowledgeDrafts() {
  if (!fs.existsSync(KNOWLEDGE_DRAFT_LOG)) return [];
  return fs.readFileSync(KNOWLEDGE_DRAFT_LOG, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function writeLocalKnowledgeDrafts(items) {
  fs.writeFileSync(KNOWLEDGE_DRAFT_LOG, items.map(item => JSON.stringify(item)).join('\n') + (items.length ? '\n' : ''), 'utf8');
}

function draftToRow(draft) {
  return {
    id:draft.id,task_id:draft.taskId,draft_type:draft.draftType,question:draft.question,answer:draft.answer,
    keywords:draft.keywords,category:draft.category,canonical_ids:draft.canonicalIds,source_conversation_ids:draft.sourceConversationIds,
    source_knowledge_ids:draft.sourceKnowledgeIds,source_rule_ids:draft.sourceRuleIds,source_summary:draft.sourceSummary,
    generation_status:draft.generationStatus,confidence_score:draft.confidenceScore,safety_status:draft.safetyStatus,
    generation_reason:draft.generationReason,generated_content_hash:draft.generatedContentHash,manually_edited:Boolean(draft.manuallyEdited),
    reviewer_note:draft.reviewerNote,reviewed_at:draft.reviewedAt,approved_at:draft.approvedAt,created_at:draft.createdAt,updated_at:draft.updatedAt
  };
}

async function readKnowledgeDrafts() {
  if (!supabaseConfigured()) return readLocalKnowledgeDrafts();
  const result = await supabaseRequest({method:'GET',pathname:'/rest/v1/knowledge_drafts?select=*',operation:'knowledge_drafts_read',table:'knowledge_drafts'});
  return JSON.parse(result.body||'[]').map(rowToTask);
}

async function upsertKnowledgeDraft(draft) {
  if (!supabaseConfigured()) {
    const items=readLocalKnowledgeDrafts(), index=items.findIndex(item=>item.id===draft.id||item.taskId===draft.taskId);
    if(index>=0) items[index]=draft; else items.push(draft);
    writeLocalKnowledgeDrafts(items); return;
  }
  await supabaseRequest({method:'POST',pathname:'/rest/v1/knowledge_drafts?on_conflict=id',body:draftToRow(draft),headers:{Prefer:'resolution=merge-duplicates'},operation:'knowledge_draft_upsert',table:'knowledge_drafts'});
}

async function findKnowledgeTask(taskId) {
  if (!supabaseConfigured()) return readLocalKnowledgeTasks().find(task=>task.id===taskId)||null;
  const result=await supabaseRequest({method:'GET',pathname:`/rest/v1/knowledge_tasks?id=eq.${encodeURIComponent(taskId)}&select=*`,operation:'knowledge_draft_task_read',table:KNOWLEDGE_TASK_TABLE});
  const rows=JSON.parse(result.body||'[]'); return rows[0]?rowToTask(rows[0]):null;
}

async function setKnowledgeTaskLifecycle(taskId,status) {
  const now=new Date().toISOString();
  if (!supabaseConfigured()) { const items=readLocalKnowledgeTasks(),task=items.find(item=>item.id===taskId); if(task){task.status=status;task.reviewedAt=now;task.updatedAt=now;writeLocalKnowledgeTasks(items);} return; }
  await supabaseRequest({method:'PATCH',pathname:`/rest/v1/knowledge_tasks?id=eq.${encodeURIComponent(taskId)}`,body:{status,reviewed_at:now,updated_at:now},operation:'knowledge_draft_task_status_update',table:KNOWLEDGE_TASK_TABLE});
}

function draftGenerationSources(task) {
  const approvedBase=knowledge.filter(item=>item&&item.source!=='unas'&&item.sourceType!=='product'&&item.sourceType!=='category');
  return {adminIntent:resolveAdministrativeIntent(task.question),expertRule:ruleEngine.resolve(task.question,[]),approvedKnowledge:approvedBase,productStatuses:readCanonicalProductStatuses()};
}

async function handleGetKnowledgeDraft(req,res,url) {
  if(!authorizeAdmin(req,res,url,{allowQueryToken:false})) return;
  const taskId=cleanText(url.searchParams.get('taskId'),80);
  try { const draft=(await readKnowledgeDrafts()).find(item=>item.taskId===taskId)||null; sendJson(res,200,{ok:true,draft}); }
  catch { console.error('Knowledge Draft read failed.'); sendJson(res,500,{ok:false,error:'A Knowledge Draft jelenleg nem tölthető be.'}); }
}

async function handleGenerateKnowledgeDraft(req,res,url) {
  if(!authorizeAdmin(req,res,url,{allowQueryToken:false})) return;
  let parsed={};try{parsed=JSON.parse((await parseBody(req))||'{}');}catch{return sendJson(res,400,{ok:false,error:'Hibás JSON.'});}
  const taskId=cleanText(parsed.taskId,80);
  try {
    const task=await findKnowledgeTask(taskId); if(!task)return sendJson(res,404,{ok:false,error:'A Knowledge Task nem található.'});
    const existing=(await readKnowledgeDrafts()).find(item=>item.taskId===taskId)||null;
    if(existing?.manuallyEdited&&parsed.overwriteEdited!==true)return sendJson(res,409,{ok:false,error:'A draft kézzel módosult. Az újrageneráláshoz explicit felülírási megerősítés szükséges.',requiresOverwriteConfirmation:true});
    let draft=generateKnowledgeDraft(task,draftGenerationSources(task));
    if(!draft)return sendJson(res,422,{ok:false,error:'Ehhez a megoldott vagy irreleváns feladathoz nem készül új draft.'});
    if(existing) draft={...draft,id:existing.id,createdAt:existing.createdAt,reviewerNote:existing.reviewerNote||''};
    await upsertKnowledgeDraft(draft); sendJson(res,200,{ok:true,draft});
  } catch { console.error('Knowledge Draft generation failed.'); sendJson(res,500,{ok:false,error:'A Knowledge Draft jelenleg nem generálható.'}); }
}

async function handleSaveKnowledgeDraft(req,res,url) {
  if(!authorizeAdmin(req,res,url,{allowQueryToken:false})) return;
  let parsed={};try{parsed=JSON.parse((await parseBody(req))||'{}');}catch{return sendJson(res,400,{ok:false,error:'Hibás JSON.'});}
  try {
    const drafts=await readKnowledgeDrafts(), old=drafts.find(item=>item.id===cleanText(parsed.id,80)); if(!old)return sendJson(res,404,{ok:false,error:'A draft nem található.'});
    const statuses=readCanonicalProductStatuses(), canonicalIds=Array.isArray(parsed.canonicalIds)?[...new Set(parsed.canonicalIds.map(id=>cleanText(id,120)).filter(Boolean))]:old.canonicalIds;
    if(canonicalIds.some(id=>statuses[id]!=='approved'))return sendJson(res,400,{ok:false,error:'Csak approved canonical termék menthető a draftba.'});
    const draft={...old,draftType:cleanText(parsed.draftType,40)||old.draftType,question:cleanText(parsed.question,4000),answer:cleanText(parsed.answer,12000),keywords:Array.isArray(parsed.keywords)?parsed.keywords.map(word=>cleanText(word,80)).filter(Boolean).slice(0,10):old.keywords,category:cleanText(parsed.category,80)||old.category,canonicalIds,confidenceScore:Number(parsed.confidenceScore),safetyStatus:cleanText(parsed.safetyStatus,40)||old.safetyStatus,reviewerNote:cleanText(parsed.reviewerNote,4000)||'',updatedAt:new Date().toISOString()};
    draft.manuallyEdited=contentHash(draft)!==draft.generatedContentHash;
    if(!DRAFT_TYPES.includes(draft.draftType)||!SAFETY_STATUSES.includes(draft.safetyStatus)||!validateDraft(draft))return sendJson(res,400,{ok:false,error:'Érvénytelen draft mező vagy enum.'});
    await upsertKnowledgeDraft(draft);sendJson(res,200,{ok:true,draft});
  } catch { console.error('Knowledge Draft save failed.');sendJson(res,500,{ok:false,error:'A Knowledge Draft jelenleg nem menthető.'}); }
}

async function handleKnowledgeDraftStatus(req,res,url) {
  if(!authorizeAdmin(req,res,url,{allowQueryToken:false})) return;
  let parsed={};try{parsed=JSON.parse((await parseBody(req))||'{}');}catch{return sendJson(res,400,{ok:false,error:'Hibás JSON.'});}
  try {
    const drafts=await readKnowledgeDrafts(),draft=drafts.find(item=>item.id===cleanText(parsed.id,80)),status=cleanText(parsed.generationStatus,40);
    if(!draft)return sendJson(res,404,{ok:false,error:'A draft nem található.'}); if(!GENERATION_STATUSES.includes(status)||status==='exported')return sendJson(res,400,{ok:false,error:'Érvénytelen draft státusz.'});
    if(status==='approved_for_import'&&(draft.draftType==='manual_required'||draft.safetyStatus==='manual_required'||!draft.answer||draft.answer==='Kiegészítés szükséges.'))return sendJson(res,400,{ok:false,error:'A manual_required draft nem hagyható jóvá biztonságos tartalom nélkül.'});
    const now=new Date().toISOString();Object.assign(draft,{generationStatus:status,reviewedAt:['in_review','approved_for_import','rejected'].includes(status)?now:draft.reviewedAt,approvedAt:status==='approved_for_import'?now:null,updatedAt:now});
    await upsertKnowledgeDraft(draft);if(status==='in_review')await setKnowledgeTaskLifecycle(draft.taskId,'in_review');if(status==='approved_for_import')await setKnowledgeTaskLifecycle(draft.taskId,'approved');sendJson(res,200,{ok:true,draft});
  } catch { console.error('Knowledge Draft status update failed.');sendJson(res,500,{ok:false,error:'A Knowledge Draft státusza jelenleg nem menthető.'}); }
}

async function handleKnowledgeDraftExport(req,res,url) {
  if(!authorizeAdmin(req,res,url,{allowQueryToken:false})) return;
  try {
    const drafts=await readKnowledgeDrafts(),payload=buildKnowledgeExport(drafts);
    for(const draft of drafts.filter(item=>item.generationStatus==='approved_for_import')){draft.generationStatus='exported';draft.updatedAt=new Date().toISOString();await upsertKnowledgeDraft(draft);}
    const body=JSON.stringify(payload,null,2);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="knowledge-import.json"','Cache-Control':'no-store'});res.end(body);
  } catch { console.error('Knowledge Draft export failed.');sendJson(res,500,{ok:false,error:'A Knowledge Draft export jelenleg nem készíthető el.'}); }
}

const unasSyncCoordinator = createUnasSyncCoordinator({
  buildSync: () => buildUnasKnowledge(),
  snapshotPath: UNAS_CATALOG_PATH,
  apiConfigured: unasConfigured
});

async function handleStatus(
  res
) {

  const commerceHealth = await buildCommerceHealth({ eventStore: commerceEventStore, proofStore: orderProofStore, tracker: commerceHealthTracker });
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
        unasConfigured(),

      commerceEventStorage: {
        kind: commerceEventStore.kind,
        productionDurable: commerceEventStore.productionDurable,
        idempotencyScope: commerceEventStore.idempotencyScope
      },

      orderProofStorage: {
        kind: orderProofStore.kind,
        productionDurable: orderProofStore.productionDurable,
        idempotencyScope: orderProofStore.idempotencyScope
      },

      commerceOutcomeStorage: {
        kind: commerceOutcomeStore.kind,
        productionDurable: commerceOutcomeStore.productionDurable,
        idempotencyScope: commerceOutcomeStore.idempotencyScope
      },

      commerceHealth,

      ...unasSyncCoordinator.status()
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

  '/attribution-lifecycle.js': {
    file: 'attribution-lifecycle.js',
    type: 'text/javascript; charset=utf-8'
  },

  '/commerce-event-client.js': {
    file: 'commerce-event-client.js',
    type: 'text/javascript; charset=utf-8'
  },

  '/unas-order-bridge.js': {
    file: 'unas-order-bridge.js',
    type: 'text/javascript; charset=utf-8'
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

        if (url.pathname === '/api/admin/commerce/outcomes') {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
          await handleAdminCommerceOutcomes(req, res, url);
          return;
        }

        /* -------------------------
           CHAT
        ------------------------- */

        if (req.method === 'POST' && url.pathname === '/api/commerce/event') {
          await handleCommerceEvent(req, res);
          return;
        }

        if (url.pathname === '/api/commerce/order-proof') {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
          await handleOrderProof(req, res);
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

        if (req.method === 'GET' && url.pathname === '/api/admin/knowledge-tasks') {
          await handleAdminKnowledgeTasks(req, res, url);
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/admin/knowledge-tasks/update') {
          await handleUpdateKnowledgeTask(req, res, url);
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/admin/knowledge-tasks/backfill') {
          await handleKnowledgeTaskBackfill(req, res, url);
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/knowledge-clusters') {
          await handleAdminKnowledgeClusters(req, res, url); return;
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/knowledge-clusters/rebuild') {
          await handleKnowledgeClusterRebuild(req, res, url); return;
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/knowledge-clusters/update') {
          await handleUpdateKnowledgeCluster(req, res, url); return;
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/knowledge-drafts') {
          await handleGetKnowledgeDraft(req,res,url); return;
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/knowledge-drafts/generate') {
          await handleGenerateKnowledgeDraft(req,res,url); return;
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/knowledge-drafts/save') {
          await handleSaveKnowledgeDraft(req,res,url); return;
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/knowledge-drafts/status') {
          await handleKnowledgeDraftStatus(req,res,url); return;
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/knowledge-drafts/export') {
          await handleKnowledgeDraftExport(req,res,url); return;
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

        if (url.pathname === '/api/admin/commerce/unas-order-preflight') {
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
            return;
          }
          await handleUnasRevenuePreflight(req, res, url);
          return;
        }

        if (url.pathname === '/api/admin/unas/permission-preflight') {
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
            return;
          }
          await handleUnasPermissionPreflight(req, res);
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
           UNAS SNAPSHOT LETOLTES
        ------------------------- */

        if (
          req.method ===
          'GET' &&
          url.pathname ===
          '/api/admin/unas/snapshot'
        ) {

          await handleUnasSnapshot(
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

          await handleStatus(
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

  if (typeof readApprovedKnowledgeRows !== 'function') {
    throw new Error('approved_knowledge_reader_missing');
  }

  console.log('Jóváhagyott tudás olvasó: ELÉRHETŐ');

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
        ' Vitalis AI Asszisztens – Éles 2.3 elindult'
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

      unasSyncCoordinator.start();
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

  unasSyncCoordinator.stop();

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
