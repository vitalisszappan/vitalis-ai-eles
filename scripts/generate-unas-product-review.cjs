'use strict';

const fs = require('fs');
const path = require('path');
const { PRODUCTS } = require('../engine/product-catalog.cjs');
const { PRODUCT_ALIASES } = require('../engine/product-faq.cjs');

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_PATH = path.join(ROOT, 'data', 'unas-catalog-snapshot.json');
const MAPPING_PATH = path.join(ROOT, 'data', 'canonical-unas-mapping.json');
const KNOWLEDGE_PATH = path.join(ROOT, 'data', 'knowledge.json');
const RULES_PATH = path.join(ROOT, 'data', 'rules', 'expert-rules.json');
const JSON_OUTPUT_PATH = path.join(ROOT, 'data', 'unas-product-review.json');
const MARKDOWN_OUTPUT_PATH = path.join(ROOT, 'UNAS_PRODUCT_REVIEW.md');

const REVIEW_STATUSES = [
  'approved_mapped',
  'mapping_candidate',
  'new_product_candidate',
  'needs_review',
  'excluded_or_non_product'
];

const PRODUCT_FAMILIES = [
  'szappanok',
  'samponszappanok',
  'samponok',
  'krémek és balzsamok',
  'testápolók',
  'dezodorok',
  'fürdősók',
  'fürdőbombák',
  'ajakápolók',
  'fogápolás',
  'illóolajok',
  'csomagok',
  'egyéb'
];

// Kézzel ellenőrzött kapcsolatok a jóváhagyott canonical mappingen kívüli,
// a meglévő Vitalis tudásanyagban név szerint szereplő termékekhez.
// Ez szándékosan nem fuzzy keresési eredmény és nem runtime mapping.
const KNOWLEDGE_CANDIDATES = Object.freeze({});

const NEEDS_REVIEW = Object.freeze({
  '1467818511': {
    canonicalCandidate: 'aktiv_szenes_szappan',
    confidence: 'medium',
    reason: 'A névben aktív szén szerepel, de az UNAS rekord samponszappan, a canonical termék pedig bőrtisztító szappan.',
    note: 'Nem azonosítható az aktiv_szenes_szappan termékkel; eltérő terméktípus, automatikus mapping tilos.'
  },
  '111374991': {
    canonicalCandidate: null,
    confidence: 'medium',
    reason: 'Sószappan variáns, miközben a kínálatban külön Parajdi sószappan/sótömb is található.',
    note: 'A két sótermék rendeltetése és terméktípusa kézi ellenőrzést igényel.'
  }
});

const TOP_NEW_PRODUCT_IDS = [
  '1229782139', '1229849469', '1462215016', '1462205581', '1462229441',
  '163834530', '163833777', '864855961', '449056663', '1080620650',
  '111374978', '111374975', '111374976', '111374977', '1423171731',
  '1511229416', '423469634', '111374995', '111374983', '111374968'
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function familyFor(product) {
  const text = normalize([product.name, ...(product.categoryNames || [])].join(' '));
  if (text.includes('samponszappan') || text.includes('hajmosasra ajanlott szappan')) return 'samponszappanok';
  if (text.includes('szilard sampon') || /(^|\s)sampon(\s|$)/.test(text)) return 'samponok';
  if (text.includes('furdo bomba') || text.includes('furdobomba')) return 'fürdőbombák';
  if (text.includes('furdoso')) return 'fürdősók';
  if (text.includes('ajakbalzsam') || text.includes('ajakapolas') || text.includes('ajakkaland')) return 'ajakápolók';
  if (text.includes('dezodor')) return 'dezodorok';
  if (text.includes('fogkrem') || text.includes('fogfeher') || text.includes('szajapolas')) return 'fogápolás';
  if (text.includes('illo olaj')) return 'illóolajok';
  if (text.includes('csomag') || text.includes('duo')) return 'csomagok';
  if (text.includes('testapolo')) return 'testápolók';
  if (text.includes('krem') || text.includes('balzsam')) return 'krémek és balzsamok';
  if (text.includes('szappan')) return 'szappanok';
  return 'egyéb';
}

function imageUrl(product) {
  return product.image?.url || product.image?.sefUrl || null;
}

function approvedRecord(product, mapping) {
  return {
    canonicalCandidate: mapping.canonicalId,
    confidence: 'exact',
    reviewStatus: 'approved_mapped',
    reason: 'Meglévő, kézzel jóváhagyott canonical–UNAS mapping egyező UNAS ID-val.',
    note: `Jóváhagyott mapping; canonical név: ${PRODUCTS[mapping.canonicalId]?.name || mapping.verifiedName}.`
  };
}

function classify(product, approvedByUnasId) {
  const approved = approvedByUnasId.get(String(product.unasId));
  if (approved) return approvedRecord(product, approved);

  const special = NEEDS_REVIEW[String(product.unasId)];
  if (special) return { ...special, reviewStatus: 'needs_review' };

  const family = familyFor(product);
  if (family === 'csomagok') {
    return {
      canonicalCandidate: null,
      confidence: 'none',
      reviewStatus: 'needs_review',
      reason: 'Csomagtermék; összetevői, időszakossága és esetleges átfedései kézi ellenőrzést igényelnek.',
      note: 'Önálló canonical termékként vagy csomagként történő későbbi kezelésről külön döntés szükséges.'
    };
  }

  const knowledgeName = KNOWLEDGE_CANDIDATES[String(product.unasId)];
  if (knowledgeName) {
    return {
      canonicalCandidate: null,
      knowledgeCandidate: knowledgeName,
      confidence: 'strong',
      reviewStatus: 'mapping_candidate',
      reason: `A termék név szerint szerepel a jóváhagyott Vitalis tudásanyagban: ${knowledgeName}.`,
      note: 'Nincs hozzá jelenleg canonical rekord; kézi jóváhagyás és külön canonical tervezés szükséges.'
    };
  }

  if (product.public !== true) {
    return {
      canonicalCandidate: null,
      confidence: 'none',
      reviewStatus: 'excluded_or_non_product',
      reason: 'Az UNAS snapshot szerint a rekord nem publikus.',
      note: 'Nem ajánlható normál, publikus webshoptermékként.'
    };
  }

  return {
    canonicalCandidate: null,
    confidence: 'none',
    reviewStatus: 'new_product_candidate',
    reason: 'Publikus, valós UNAS-termék, amelyhez nincs approved mapping vagy meglévő canonical rekord.',
    note: 'Csak felülvizsgálati jelölt; nem része az éles chatbot ajánlási rendszerének.'
  };
}

function buildReview({ snapshot, mapping, knowledge, rules }) {
  if (!Array.isArray(snapshot.products)) throw new Error('A snapshot products mezője hiányzik.');
  const approvedMappings = mapping.mappings.filter((item) => item.mappingStatus === 'approved');
  const approvedByUnasId = new Map(approvedMappings.map((item) => [String(item.unasId), item]));
  const knownCanonicalIds = Object.keys(PRODUCTS);
  const aliasCanonicalIds = PRODUCT_ALIASES.map(([canonicalId]) => canonicalId);
  const ruleCanonicalIds = [...new Set(rules.flatMap((rule) => [rule.primaryProduct, ...(rule.secondaryProducts || [])]).filter(Boolean))];

  const records = snapshot.products.map((product) => ({
    unasId: String(product.unasId),
    sku: product.sku || null,
    officialName: product.name || null,
    url: product.url || null,
    image: imageUrl(product),
    price: product.actualPriceGross ?? product.priceGross ?? null,
    currency: product.currency ?? null,
    categories: [...(product.categoryNames || [])],
    publication: {
      public: product.public ?? null,
      active: product.active ?? null,
      orderable: product.orderable ?? null,
      state: product.status?.state ?? null
    },
    productFamily: familyFor(product),
    ...classify(product, approvedByUnasId)
  }));

  const counts = Object.fromEntries(REVIEW_STATUSES.map((status) => [status, records.filter((record) => record.reviewStatus === status).length]));
  const families = PRODUCT_FAMILIES.map((family) => {
      const familyRecords = records.filter((record) => record.productFamily === family);
      const mapped = familyRecords.filter((record) => record.reviewStatus === 'approved_mapped').length;
      return { family, total: familyRecords.length, mapped, unmapped: familyRecords.length - mapped };
    });
  const byId = new Map(records.map((record) => [record.unasId, record]));

  return {
    schema: 'vitalis-unas-product-review/v1',
    sourceSnapshotGeneratedAt: snapshot.generatedAt,
    sourceSnapshotProductCount: snapshot.products.length,
    generation: {
      deterministic: true,
      automaticMappingCreated: false,
      fuzzyMatchingUsedForApproval: false,
      sourceFiles: [
        'data/unas-catalog-snapshot.json',
        'data/canonical-unas-mapping.json',
        'engine/product-catalog.cjs',
        'engine/product-faq.cjs',
        'data/knowledge.json',
        'data/rules/expert-rules.json'
      ],
      sourceEvidence: {
        canonicalProductCount: knownCanonicalIds.length,
        aliasCanonicalCount: new Set(aliasCanonicalIds).size,
        knowledgeEntryCount: Array.isArray(knowledge) ? knowledge.length : Object.keys(knowledge).length,
        expertRuleCount: rules.length,
        ruleCanonicalIds
      }
    },
    summary: {
      total: records.length,
      ...counts,
      families,
      topNewProductCandidateIds: TOP_NEW_PRODUCT_IDS.filter((id) => byId.has(id)),
      needsReviewIds: records.filter((record) => record.reviewStatus === 'needs_review').map((record) => record.unasId)
    },
    records
  };
}

function escapeCell(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function table(records) {
  const lines = [
    '| UNAS ID | SKU | Termék | Család | Canonical / tudásjelölt | Bizonyosság | Ár | Publikus | Indoklás |',
    '|---|---|---|---|---|---|---:|:---:|---|'
  ];
  for (const record of records) {
    const candidate = record.canonicalCandidate || record.knowledgeCandidate || '—';
    lines.push(`| ${escapeCell(record.unasId)} | ${escapeCell(record.sku)} | [${escapeCell(record.officialName)}](${escapeCell(record.url)}) | ${escapeCell(record.productFamily)} | ${escapeCell(candidate)} | ${escapeCell(record.confidence)} | ${escapeCell(record.price)} | ${record.publication.public === true ? 'igen' : 'nem'} | ${escapeCell(record.reason)} ${escapeCell(record.note)} |`);
  }
  return lines.join('\n');
}

function buildMarkdown(review) {
  const sections = [
    ['Már jóváhagyott', 'approved_mapped'],
    ['Erős mapping-jelöltek', 'mapping_candidate'],
    ['Új termékjelöltek', 'new_product_candidate'],
    ['Bizonytalan esetek', 'needs_review'],
    ['Kizárt rekordok', 'excluded_or_non_product']
  ];
  const lines = [
    '# UNAS termékkatalógus felülvizsgálat',
    '',
    `Forrás snapshot: ${review.sourceSnapshotGeneratedAt}; összes rekord: **${review.summary.total}**.`,
    '',
    '> Ez kizárólag audit- és review-anyag. Nem hoz létre mappinget, canonical ID-t, és nincs bekötve az éles chatbotba.',
    '',
    '## Összesítés',
    '',
    ...REVIEW_STATUSES.map((status) => `- ${status}: **${review.summary[status]}**`),
    '',
    '## Termékcsaládok',
    '',
    '| Család | Összes | Mapped | Unmapped |',
    '|---|---:|---:|---:|',
    ...review.summary.families.map((item) => `| ${item.family} | ${item.total} | ${item.mapped} | ${item.unmapped} |`),
    ''
  ];

  for (const [title, status] of sections) {
    const records = review.records.filter((record) => record.reviewStatus === status);
    lines.push(`## ${title}`, '', table(records), '');
  }

  const byId = new Map(review.records.map((record) => [record.unasId, record]));
  const top = review.summary.topNewProductCandidateIds.map((id) => byId.get(id)).filter(Boolean);
  lines.push('## Top 20 további feldolgozásra javasolt termék', '', table(top), '');
  lines.push('## Aktív szenes audit', '');
  lines.push('- A snapshotban nincs egyértelmű, bőrtisztító „Aktív szenes szappan” rekord.');
  lines.push('- A „Samponszappan – Teafa & Aktív szén 110 g” eltérő terméktípus, ezért `needs_review`, és nem kapcsolódik automatikusan az `aktiv_szenes_szappan` canonical ID-hoz.');
  lines.push('- Aktív szenet tartalmaz még a fogápolási „Fogfehérítő por – Aktív kókusz szénnel” és az azt tartalmazó „Vitalis Szájápolási Duo”; ezek nem bőrtisztító szappanok.');
  return `${lines.join('\n')}\n`;
}

function generate() {
  const review = buildReview({
    snapshot: readJson(SNAPSHOT_PATH),
    mapping: readJson(MAPPING_PATH),
    knowledge: readJson(KNOWLEDGE_PATH),
    rules: readJson(RULES_PATH)
  });
  fs.writeFileSync(JSON_OUTPUT_PATH, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
  fs.writeFileSync(MARKDOWN_OUTPUT_PATH, buildMarkdown(review), 'utf8');
  return review;
}

if (require.main === module) {
  const review = generate();
  console.log(`UNAS review elkészült: ${review.summary.total} rekord.`);
}

module.exports = {
  PRODUCT_FAMILIES,
  REVIEW_STATUSES,
  buildMarkdown,
  buildReview,
  familyFor,
  generate
};
