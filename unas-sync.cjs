const https = require('https');

const UNAS_API_KEY = String(
  process.env.UNAS_API_KEY || ''
).trim();

const UNAS_API_BASE_URL = String(
  process.env.UNAS_API_BASE_URL || 'https://api.unas.eu/shop'
)
  .trim()
  .replace(/\/+$/, '');

/* =========================================================
   SEGÉDFÜGGVÉNYEK
========================================================= */

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getXmlValue(xml, tagName) {
  const regex = new RegExp(
    `<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    'i'
  );

  const match = String(xml || '').match(regex);

  if (!match) {
    return '';
  }

  return match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .trim();
}

function getXmlBlocks(xml, tagName) {
  const regex = new RegExp(
    `<${tagName}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tagName}>`,
    'gi'
  );

  return String(xml || '').match(regex) || [];
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/* =========================================================
   UNAS HTTP KÉRÉS
========================================================= */

function unasRequest({
  endpoint,
  token = '',
  body = ''
}) {
  return new Promise((resolve, reject) => {
    let target;

    try {
      target = new URL(
        `${UNAS_API_BASE_URL}/${endpoint}`
      );
    } catch (error) {
      reject(
        new Error(
          `Hibás UNAS API URL: ${error.message}`
        )
      );
      return;
    }

    const bodyText = String(body || '');

    const headers = {
      Accept: 'application/xml',
      'Content-Type': 'application/xml; charset=UTF-8',
      'Content-Length': Buffer.byteLength(bodyText)
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const request = https.request(
      {
        hostname: target.hostname,
        port: 443,
        path: target.pathname + target.search,
        method: 'POST',
        headers,
        timeout: 60000
      },
      (response) => {
        let responseBody = '';

        response.setEncoding('utf8');

        response.on('data', (chunk) => {
          responseBody += chunk;
        });

        response.on('end', () => {
          const status = response.statusCode || 0;

          if (status >= 200 && status < 300) {
            resolve({
              ok: true,
              status,
              body: responseBody
            });
            return;
          }

          reject(
            new Error(
              `UNAS HTTP ${status}: ${responseBody.slice(0, 1500)}`
            )
          );
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(
        new Error(
          'Az UNAS API kapcsolat időtúllépett.'
        )
      );
    });

    request.on('error', reject);

    request.write(bodyText);
    request.end();
  });
}

/* =========================================================
   LOGIN
========================================================= */

async function loginToUnas() {
  if (!UNAS_API_KEY) {
    throw new Error(
      'Hiányzik az UNAS_API_KEY környezeti változó.'
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Params>
  <ApiKey>${escapeXml(UNAS_API_KEY)}</ApiKey>
  <WebshopInfo>true</WebshopInfo>
</Params>`;

  const response = await unasRequest({
    endpoint: 'login',
    body: xml
  });

  const token = getXmlValue(
    response.body,
    'Token'
  );

  if (!token) {
    throw new Error(
      `Az UNAS login nem adott vissza tokent. Válasz: ${response.body.slice(0, 1500)}`
    );
  }

  return {
    token,
    raw: response.body
  };
}

/* =========================================================
   TERMÉKEK LEKÉRÉSE – EGY OLDAL
========================================================= */

async function getProductPage(
  token,
  {
    start = 0,
    limit = 100
  } = {}
) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Params>
  <StatusBase>1,2,3</StatusBase>
  <LimitNum>${limit}</LimitNum>
  <LimitStart>${start}</LimitStart>
  <ContentType>full</ContentType>
</Params>`;

  const response = await unasRequest({
    endpoint: 'getProduct',
    token,
    body: xml
  });

  const blocks = getXmlBlocks(
    response.body,
    'Product'
  );

  return {
    xml: response.body,
    blocks,
    count: blocks.length
  };
}

/* =========================================================
   ÖSSZES AKTÍV TERMÉK LEKÉRÉSE
========================================================= */

async function getAllProducts(
  token,
  {
    pageSize = 100,
    maxPages = 100
  } = {}
) {
  const allBlocks = [];

  for (
    let page = 0;
    page < maxPages;
    page += 1
  ) {
    const start =
      page * pageSize;

    const result =
      await getProductPage(
        token,
        {
          start,
          limit: pageSize
        }
      );

    allBlocks.push(
      ...result.blocks
    );

    if (
      result.count <
      pageSize
    ) {
      break;
    }
  }

  return {
    count: allBlocks.length,
    blocks: allBlocks
  };
}

/* =========================================================
   TERMÉKADATOK KINYERÉSE
========================================================= */

function parseProductBlock(block) {
  const name =
    getXmlValue(
      block,
      'Name'
    );

  const sku =
    getXmlValue(
      block,
      'Sku'
    );

  const id =
    getXmlValue(
      block,
      'Id'
    );

  const url =
    getXmlValue(
      block,
      'Url'
    );

  const description =
    stripHtml(
      getXmlValue(
        block,
        'Description'
      )
    );

  const descriptionLong =
    stripHtml(
      getXmlValue(
        block,
        'DescriptionLong'
      )
    );

  const category =
    getXmlValue(
      block,
      'Category'
    );

  const price =
    getXmlValue(
      block,
      'Price'
    );

  return {
    id,
    sku,
    name,
    url,
    category,
    price,
    description,
    descriptionLong
  };
}

/* =========================================================
   KATEGÓRIÁK LEKÉRÉSE
========================================================= */

async function getCategories(
  token
) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Params>
</Params>`;

  const response =
    await unasRequest({
      endpoint:
        'getCategory',

      token,

      body:
        xml
    });

  const blocks =
    getXmlBlocks(
      response.body,
      'Category'
    );

  return {
    xml:
      response.body,

    count:
      blocks.length,

    blocks
  };
}

/* =========================================================
   KATEGÓRIAADATOK KINYERÉSE
========================================================= */

function parseCategoryBlock(
  block
) {
  return {
    id:
      getXmlValue(
        block,
        'Id'
      ),

    name:
      getXmlValue(
        block,
        'Name'
      ),

    parent:
      getXmlValue(
        block,
        'Parent'
      ),

    url:
      getXmlValue(
        block,
        'Url'
      ),

    description:
      stripHtml(
        getXmlValue(
          block,
          'Description'
        )
      )
  };
}

/* =========================================================
   TELJES UNAS ADATLEKÉRÉS
========================================================= */

async function fetchUnasKnowledgeSource() {
  const started =
    Date.now();

  const login =
    await loginToUnas();

  const [
    productResult,
    categoryResult
  ] =
    await Promise.all([
      getAllProducts(
        login.token
      ),

      getCategories(
        login.token
      )
    ]);

  const products =
    productResult.blocks
      .map(
        parseProductBlock
      )
      .filter(
        (item) =>
          item.name
      );

  const categories =
    categoryResult.blocks
      .map(
        parseCategoryBlock
      )
      .filter(
        (item) =>
          item.name
      );

  return {
    ok:
      true,

    products,

    categories,

    counts: {
      products:
        products.length,

      categories:
        categories.length
    },

    responseMs:
      Date.now() -
      started
  };
}

/* =========================================================
   KAPCSOLATTESZT
========================================================= */

async function testUnasConnection() {
  const result =
    await fetchUnasKnowledgeSource();

  return {
    ok:
      true,

    products:
      result.counts.products,

    categories:
      result.counts.categories,

    responseMs:
      result.responseMs,

    message:
      `Az UNAS API kapcsolat működik. Termékek: ${result.counts.products}, kategóriák: ${result.counts.categories}.`
  };
}

/* =========================================================
   KÉZI FUTTATÁS
========================================================= */

async function run() {
  console.log(
    '=========================================='
  );

  console.log(
    ' Vitalis UNAS teljes adatlekérés'
  );

  console.log(
    '=========================================='
  );

  try {
    const result =
      await fetchUnasKnowledgeSource();

    console.log(
      'UNAS KAPCSOLAT SIKERES'
    );

    console.log(
      `Termékek száma: ${result.counts.products}`
    );

    console.log(
      `Kategóriák száma: ${result.counts.categories}`
    );

    console.log(
      `Válaszidő: ${result.responseMs} ms`
    );

    console.log(
      'A lekérés semmilyen adatot nem módosított az UNAS webshopban.'
    );

  } catch (
    error
  ) {
    console.error(
      'UNAS ADATLEKÉRÉSI HIBA'
    );

    console.error(
      error.message
    );

    process.exitCode =
      1;
  }

  console.log(
    '=========================================='
  );
}

if (
  require.main ===
  module
) {
  run();
}

/* =========================================================
   EXPORT
========================================================= */

module.exports = {
  loginToUnas,
  getProductPage,
  getAllProducts,
  getCategories,
  fetchUnasKnowledgeSource,
  testUnasConnection
};
