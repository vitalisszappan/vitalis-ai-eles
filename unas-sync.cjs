const https = require('https');
const fs = require('fs');
const path = require('path');
const { XMLParser, XMLValidator } = require('fast-xml-parser');

const UNAS_API_KEY = String(process.env.UNAS_API_KEY || '').trim();
const UNAS_API_BASE_URL = String(
  process.env.UNAS_API_BASE_URL || 'https://api.unas.eu/shop'
).trim().replace(/\/+$/, '');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UNAS_CATALOG_PATH = path.join(DATA_DIR, 'unas-catalog-snapshot.json');
const DEFAULT_PAGE_SIZE = positiveInteger(process.env.UNAS_PAGE_SIZE, 100);
const DEFAULT_MAX_PAGES = positiveInteger(process.env.UNAS_MAX_PAGES, 1000);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  processEntities: true
});

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function scalar(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') {
    if ('#text' in value) return scalar(value['#text']);
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function cleanText(value) {
  const text = scalar(value);
  if (!text) return null;
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim() || null;
}

function nullableNumber(value) {
  const text = scalar(value);
  if (text === null) return null;
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function nullableBoolean(value) {
  const text = scalar(value);
  if (text === null) return null;
  if (/^(1|true|yes|igen|active)$/i.test(text)) return true;
  if (/^(0|false|no|nem|inactive)$/i.test(text)) return false;
  return null;
}

function parseXml(xml, expectedRoot) {
  const source = String(xml || '').trim();
  const validation = XMLValidator.validate(source);
  if (validation !== true) {
    const message = validation?.err?.msg || 'ismeretlen XML-hiba';
    throw new Error(`Hibás UNAS XML: ${message}`);
  }
  const parsed = xmlParser.parse(source);
  if (expectedRoot && !Object.prototype.hasOwnProperty.call(parsed || {}, expectedRoot)) {
    throw new Error(`Érvénytelen UNAS XML: hiányzik a(z) ${expectedRoot} gyökérelem.`);
  }
  return parsed;
}

function ensureDataDirectory(directory = DATA_DIR) {
  fs.mkdirSync(directory, { recursive: true });
}

function unasRequest({ endpoint, token = '', body = '' }) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(`${UNAS_API_BASE_URL}/${endpoint}`);
    } catch (error) {
      reject(new Error(`Hibás UNAS API URL: ${error.message}`));
      return;
    }

    const bodyText = String(body || '');
    const headers = {
      Accept: 'application/xml',
      'Content-Type': 'application/xml; charset=UTF-8',
      'Content-Length': Buffer.byteLength(bodyText)
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const request = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method: 'POST',
      headers,
      timeout: 30000
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        const status = response.statusCode || 0;
        if (status >= 200 && status < 300) {
          resolve({ ok: true, status, body: responseBody });
          return;
        }
        reject(new Error(`UNAS HTTP ${status}: ${responseBody.slice(0, 1500)}`));
      });
    });
    request.on('timeout', () => request.destroy(new Error('Az UNAS API kapcsolat időtúllépett.')));
    request.on('error', reject);
    request.write(bodyText);
    request.end();
  });
}

async function loginToUnas(options = {}) {
  const apiKey = options.apiKey === undefined ? UNAS_API_KEY : String(options.apiKey).trim();
  const requestFn = options.requestFn || unasRequest;
  if (!apiKey) throw new Error('Hiányzik az UNAS_API_KEY környezeti változó.');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Params><ApiKey>${escapeXml(apiKey)}</ApiKey><WebshopInfo>true</WebshopInfo></Params>`;
  const response = await requestFn({ endpoint: 'login', body: xml });
  const parsed = parseXml(response.body, 'Login');
  const token = scalar(parsed.Login.Token);
  if (!token) throw new Error('Az UNAS login nem adott vissza tokent.');
  return { token, raw: response.body };
}

function productRequestXml(limitNum, limitStart) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Params>
  <State>live</State>
  <ContentType>full</ContentType>
  <Lang>hu</Lang>
  <LimitNum>${limitNum}</LimitNum>
  <LimitStart>${limitStart}</LimitStart>
</Params>`;
}

function findPrice(product, wantedType) {
  const prices = asArray(product?.Prices?.Price);
  return prices.find((price) => String(scalar(price?.Type) || '').toLowerCase() === wantedType) || null;
}

function parseImage(product) {
  const images = product?.Images;
  if (!images) return null;
  const imageList = asArray(images.Image);
  const base = imageList.find((item) => String(scalar(item?.Type) || '').toLowerCase() === 'base') || imageList[0] || null;
  const filename = scalar(base?.Filename) || scalar(images.DefaultFilename);
  const url = scalar(base?.Url) || scalar(images.Url);
  const sefUrl = scalar(base?.SefUrl);
  if (!filename && !url && !sefUrl) return null;
  return { filename, url, sefUrl };
}

function parseStock(product) {
  const stocks = product?.Stocks;
  if (!stocks) return { stockQty: null, stockStatus: null };
  const quantities = asArray(stocks.Stock)
    .map((stock) => nullableNumber(stock?.Qty))
    .filter((qty) => qty !== null);
  return {
    stockQty: quantities.length ? quantities.reduce((sum, qty) => sum + qty, 0) : null,
    stockStatus: {
      active: nullableBoolean(stocks?.Status?.Active),
      empty: nullableBoolean(stocks?.Status?.Empty),
      variant: nullableBoolean(stocks?.Status?.Variant)
    }
  };
}

function parseProduct(product) {
  const categories = asArray(product?.Categories?.Category);
  const normalPrice = findPrice(product, 'normal');
  const activePrice = asArray(product?.Prices?.Price).find((price) => nullableBoolean(price?.Actual) === true);
  const salePrice = findPrice(product, 'sale') || findPrice(product, 'special');
  const currentPrice = activePrice || salePrice;
  const noList = nullableBoolean(product?.NoList);
  const active = nullableBoolean(product?.StatusBase);
  const explicitPublic = nullableBoolean(product?.Public);
  const explicitOrderable = nullableBoolean(product?.Orderable);
  const { stockQty, stockStatus } = parseStock(product);

  return {
    unasId: scalar(product?.Id),
    sku: scalar(product?.Sku),
    name: cleanText(product?.Name),
    shortDescription: cleanText(product?.Description?.Short),
    longDescription: cleanText(product?.Description?.Long),
    priceGross: nullableNumber(normalPrice?.Gross),
    actualPriceGross: nullableNumber(currentPrice?.Gross),
    currency: scalar(currentPrice?.Currency) || scalar(normalPrice?.Currency) || scalar(product?.Currency),
    unit: cleanText(product?.Unit),
    url: scalar(product?.Url),
    image: parseImage(product),
    categoryIds: categories.map((category) => scalar(category?.Id)).filter(Boolean),
    categoryNames: categories.map((category) => cleanText(category?.Name)).filter(Boolean),
    stockQty,
    stockStatus,
    status: {
      state: scalar(product?.State),
      statusBase: scalar(product?.StatusBase)
    },
    visibility: {
      noList,
      publicFrom: scalar(product?.PublicInterval?.Start),
      publicTo: scalar(product?.PublicInterval?.End)
    },
    active,
    public: explicitPublic !== null ? explicitPublic : (noList === null ? null : !noList),
    orderable: explicitOrderable
  };
}

function parseProducts(xml) {
  const parsed = parseXml(xml, 'Products');
  return asArray(parsed.Products?.Product).map(parseProduct);
}

function parseCategories(xml) {
  const parsed = parseXml(xml, 'Categories');
  return asArray(parsed.Categories?.Category).map((category) => ({
    unasId: scalar(category?.Id),
    name: cleanText(category?.Name),
    description: cleanText(category?.Description),
    url: scalar(category?.Url),
    parentId: scalar(category?.Parent?.Id) || scalar(category?.ParentId),
    image: scalar(category?.Image?.Url) ? { url: scalar(category.Image.Url) } : null
  }));
}

function recordSignature(products) {
  return products.map((product) => `${product.unasId || ''}:${product.sku || ''}:${product.name || ''}`).join('|');
}

function deduplicateByUnasId(products) {
  const seen = new Set();
  return products.filter((product) => {
    if (!product.unasId) return true;
    if (seen.has(product.unasId)) return false;
    seen.add(product.unasId);
    return true;
  });
}

async function getProducts(token, options = {}) {
  const requestFn = options.requestFn || unasRequest;
  const pageSize = positiveInteger(options.pageSize, DEFAULT_PAGE_SIZE);
  const maxPages = positiveInteger(options.maxPages, DEFAULT_MAX_PAGES);
  const allProducts = [];
  const signatures = new Set();

  for (let page = 0; page < maxPages; page += 1) {
    const limitStart = page * pageSize;
    const response = await requestFn({
      endpoint: 'getProduct',
      token,
      body: productRequestXml(pageSize, limitStart)
    });
    const products = parseProducts(response.body);
    if (products.length) {
      const signature = recordSignature(products);
      if (signatures.has(signature)) throw new Error('Az UNAS lapozás ismétlődő oldalt adott vissza.');
      signatures.add(signature);
      allProducts.push(...products);
    }
    if (products.length < pageSize) {
      return {
        products: deduplicateByUnasId(allProducts),
        rawProducts: allProducts,
        count: deduplicateByUnasId(allProducts).length,
        rawCount: allProducts.length,
        pages: page + 1,
        pageSize
      };
    }
  }
  throw new Error(`Az UNAS lapozás elérte a biztonsági maximumot (${maxPages} oldal).`);
}

async function getCategories(token, options = {}) {
  const requestFn = options.requestFn || unasRequest;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Params><ContentType>full</ContentType><Lang>hu</Lang></Params>`;
  const response = await requestFn({ endpoint: 'getCategory', token, body: xml });
  const categories = parseCategories(response.body);
  return { xml: response.body, categories, count: categories.length };
}

function duplicateValues(products, field) {
  const counts = new Map();
  for (const product of products) {
    const value = product[field];
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

function createAudit(products, options = {}) {
  const duplicateUnasIds = duplicateValues(products, 'unasId');
  const duplicateSkus = duplicateValues(products, 'sku');
  const uniqueIds = new Set(products.map((item) => item.unasId).filter(Boolean));
  return {
    totalRecords: products.length,
    uniqueUnasIds: uniqueIds.size,
    missingSku: products.filter((item) => !item.sku).length,
    duplicateUnasIds,
    duplicateSkus,
    missingUrl: products.filter((item) => !item.url).length,
    missingImage: products.filter((item) => !item.image).length,
    uncertainStatus: products.filter((item) => item.active === null || item.public === null).length,
    publicRecords: products.filter((item) => item.public === true).length,
    nonPublicRecords: products.filter((item) => item.public === false).length,
    unknownPublicRecords: products.filter((item) => item.public === null).length,
    unmappedProducts: options.unmappedProducts === undefined ? null : options.unmappedProducts
  };
}

function validateSnapshot(snapshot, options = {}) {
  if (!snapshot || snapshot.schema !== 'vitalis-unas-commerce-catalog/v1') {
    throw new Error('Érvénytelen UNAS snapshot séma.');
  }
  if (!Array.isArray(snapshot.products) || !Array.isArray(snapshot.categories)) {
    throw new Error('Érvénytelen UNAS snapshot: hiányzó termék- vagy kategórialista.');
  }
  if (!options.allowEmpty && snapshot.products.length === 0) {
    throw new Error('Az UNAS szinkron nem adott vissza terméket; a snapshot nem cserélhető le.');
  }
  if (snapshot.products.some((product) => !product || typeof product !== 'object')) {
    throw new Error('Érvénytelen termékrekord az UNAS snapshotban.');
  }
  return true;
}

function writeSnapshotAtomic(snapshot, targetPath = UNAS_CATALOG_PATH, options = {}) {
  validateSnapshot(snapshot, options);
  ensureDataDirectory(path.dirname(targetPath));
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', flag: 'wx' });
    const parsed = JSON.parse(fs.readFileSync(temporaryPath, 'utf8'));
    validateSnapshot(parsed, options);
    fs.renameSync(temporaryPath, targetPath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
  return targetPath;
}

async function buildUnasKnowledge(options = {}) {
  const started = Date.now();
  const loginFn = options.loginFn || loginToUnas;
  const productsFn = options.productsFn || getProducts;
  const categoriesFn = options.categoriesFn || getCategories;
  const login = await loginFn(options);
  const productsResponse = await productsFn(login.token, options);
  const categoriesResponse = await categoriesFn(login.token, options);
  const rawProducts = productsResponse.rawProducts || productsResponse.products;
  const audit = createAudit(rawProducts);
  const products = deduplicateByUnasId(productsResponse.products || rawProducts);
  const snapshot = {
    schema: 'vitalis-unas-commerce-catalog/v1',
    generatedAt: new Date().toISOString(),
    source: 'UNAS Vitalis webshop',
    pagination: {
      pages: productsResponse.pages || 1,
      pageSize: productsResponse.pageSize || null,
      rawRecords: rawProducts.length
    },
    audit,
    products,
    categories: categoriesResponse.categories || []
  };
  validateSnapshot(snapshot, options);
  const file = writeSnapshotAtomic(snapshot, options.snapshotPath || UNAS_CATALOG_PATH, options);
  return {
    ok: true,
    products: products.length,
    categories: snapshot.categories.length,
    total: products.length + snapshot.categories.length,
    responseMs: Date.now() - started,
    file,
    audit,
    snapshot
  };
}

async function testUnasConnection(options = {}) {
  const started = Date.now();
  const login = await loginToUnas(options);
  const products = await getProducts(login.token, options);
  const categories = await getCategories(login.token, options);
  return {
    ok: true,
    products: products.count,
    categories: categories.count,
    responseMs: Date.now() - started,
    message: `Az UNAS API kapcsolat működik. Termékek: ${products.count}, kategóriák: ${categories.count}.`
  };
}

async function run() {
  try {
    const result = await buildUnasKnowledge();
    console.log('UNAS KATALÓGUSSZINKRON SIKERES');
    console.log(JSON.stringify({
      products: result.products,
      categories: result.categories,
      responseMs: result.responseMs,
      file: result.file,
      audit: result.audit
    }, null, 2));
    console.log('A snapshot nincs bekötve a chatbot válaszadási útvonalába.');
  } catch (error) {
    console.error('UNAS KATALÓGUSSZINKRON HIBA');
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) run();

module.exports = {
  DEFAULT_PAGE_SIZE,
  UNAS_CATALOG_PATH,
  testUnasConnection,
  buildUnasKnowledge,
  loginToUnas,
  getProducts,
  getCategories,
  parseProducts,
  parseCategories,
  createAudit,
  validateSnapshot,
  writeSnapshotAtomic,
  deduplicateByUnasId,
  productRequestXml
};
