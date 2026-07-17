const https = require('https');
const fs = require('fs');
const path = require('path');

const UNAS_API_KEY = String(
  process.env.UNAS_API_KEY || ''
).trim();

const UNAS_API_BASE_URL = String(
  process.env.UNAS_API_BASE_URL || 'https://api.unas.eu/shop'
)
  .trim()
  .replace(/\/+$/, '');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');

const UNAS_KNOWLEDGE_PATH = path.join(
  DATA_DIR,
  'unas-knowledge.json'
);

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

function decodeXml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripHtml(value = '') {
  return decodeXml(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getXmlValue(xml, tagName) {
  const regex = new RegExp(
    `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
    'i'
  );

  const match = String(xml || '').match(regex);

  return match
    ? decodeXml(match[1]).trim()
    : '';
}

function getXmlBlocks(xml, tagName) {
  const regex = new RegExp(
    `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
    'gi'
  );

  const blocks = [];
  let match;

  while ((match = regex.exec(String(xml || ''))) !== null) {
    blocks.push(match[1]);
  }

  return blocks;
}

function countXmlItems(xml, tagName) {
  return getXmlBlocks(xml, tagName).length;
}

function normalizeText(value = '') {
  return stripHtml(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureDataDirectory() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    });
  }
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
      'Content-Type':
        'application/xml; charset=UTF-8',
      'Content-Length':
        Buffer.byteLength(bodyText)
    };

    if (token) {
      headers.Authorization =
        `Bearer ${token}`;
    }

    const request = https.request(
      {
        hostname: target.hostname,
        port: 443,
        path:
          target.pathname +
          target.search,
        method: 'POST',
        headers,
        timeout: 30000
      },
      (response) => {
        let responseBody = '';

        response.setEncoding('utf8');

        response.on('data', (chunk) => {
          responseBody += chunk;
        });

        response.on('end', () => {
          const status =
            response.statusCode || 0;

          if (
            status >= 200 &&
            status < 300
          ) {
            resolve({
              ok: true,
              status,
              body: responseBody
            });

            return;
          }

          reject(
            new Error(
              `UNAS HTTP ${status}: ` +
              responseBody.slice(
                0,
                1500
              )
            )
          );
        });
      }
    );

    request.on(
      'timeout',
      () => {
        request.destroy(
          new Error(
            'Az UNAS API kapcsolat időtúllépett.'
          )
        );
      }
    );

    request.on(
      'error',
      (error) => {
        reject(error);
      }
    );

    request.write(bodyText);
    request.end();
  });
}

/* =========================================================
   BEJELENTKEZÉS
========================================================= */

async function loginToUnas() {
  if (!UNAS_API_KEY) {
    throw new Error(
      'Hiányzik az UNAS_API_KEY környezeti változó.'
    );
  }

  const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<Params>
  <ApiKey>${escapeXml(UNAS_API_KEY)}</ApiKey>
  <WebshopInfo>true</WebshopInfo>
</Params>`;

  const response =
    await unasRequest({
      endpoint: 'login',
      body: xml
    });

  const token =
    getXmlValue(
      response.body,
      'Token'
    );

  if (!token) {
    throw new Error(
      'Az UNAS login nem adott vissza tokent. ' +
      'Válasz: ' +
      response.body.slice(
        0,
        1500
      )
    );
  }

  return {
    token,
    raw: response.body
  };
}

/* =========================================================
   TERMÉKEK LEKÉRÉSE
========================================================= */

async function getProducts(token) {
  const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<Params>
  <State>live</State>
  <ContentType>full</ContentType>
  <Lang>hu</Lang>
</Params>`;

  const response =
    await unasRequest({
      endpoint: 'getProduct',
      token,
      body: xml
    });

  return {
    xml: response.body,
    count: countXmlItems(
      response.body,
      'Product'
    )
  };
}

/* =========================================================
   KATEGÓRIÁK LEKÉRÉSE
========================================================= */

async function getCategories(token) {
  const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<Params>
  <Lang>hu</Lang>
</Params>`;

  const response =
    await unasRequest({
      endpoint: 'getCategory',
      token,
      body: xml
    });

  return {
    xml: response.body,
    count: countXmlItems(
      response.body,
      'Category'
    )
  };
}

/* =========================================================
   TERMÉKEK FELDOLGOZÁSA
========================================================= */

function parseProducts(xml) {
  const blocks =
    getXmlBlocks(
      xml,
      'Product'
    );

  return blocks
    .map((block, index) => {
      const id =
        getXmlValue(
          block,
          'Id'
        );

      const sku =
        getXmlValue(
          block,
          'Sku'
        );

      const name =
        normalizeText(
          getXmlValue(
            block,
            'Name'
          )
        );

      const shortDescription =
        normalizeText(
          getXmlValue(
            block,
            'ShortDescription'
          )
        );

      const description =
        normalizeText(
          getXmlValue(
            block,
            'Description'
          )
        );

      const price =
        normalizeText(
          getXmlValue(
            block,
            'Price'
          )
        );

      const url =
        normalizeText(
          getXmlValue(
            block,
            'Url'
          )
        );

      const unit =
        normalizeText(
          getXmlValue(
            block,
            'Unit'
          )
        );

      if (!name) {
        return null;
      }

      const answerParts = [];

      if (shortDescription) {
        answerParts.push(
          shortDescription
        );
      }

      if (
        description &&
        description !==
          shortDescription
      ) {
        answerParts.push(
          description
        );
      }

      if (price) {
        answerParts.push(
          `Ár: ${price} Ft.`
        );
      }

      if (unit) {
        answerParts.push(
          `Kiszerelés vagy egység: ${unit}.`
        );
      }

      return {
        id:
          `unas-product-${id || sku || index + 1}`,

        source: 'unas',

        sourceType:
          'product',

        type:
          'product',

        title:
          name,

        question:
          `${name} termékinformáció`,

        answer:
          answerParts.join(
            ' '
          ),

        productId:
          id || '',

        sku:
          sku || '',

        name,

        price:
          price || '',

        unit:
          unit || '',

        url:
          url || '',

        priority:
          90,

        active:
          true,

        updatedAt:
          new Date()
            .toISOString()
      };
    })
    .filter(Boolean);
}

/* =========================================================
   KATEGÓRIÁK FELDOLGOZÁSA
========================================================= */

function parseCategories(xml) {
  const blocks =
    getXmlBlocks(
      xml,
      'Category'
    );

  return blocks
    .map((block, index) => {
      const id =
        getXmlValue(
          block,
          'Id'
        );

      const name =
        normalizeText(
          getXmlValue(
            block,
            'Name'
          )
        );

      const description =
        normalizeText(
          getXmlValue(
            block,
            'Description'
          )
        );

      const url =
        normalizeText(
          getXmlValue(
            block,
            'Url'
          )
        );

      if (!name) {
        return null;
      }

      return {
        id:
          `unas-category-${id || index + 1}`,

        source:
          'unas',

        sourceType:
          'category',

        type:
          'category',

        title:
          name,

        question:
          `${name} kategória`,

        answer:
          description ||
          `A Vitalis webshop ${name} kategóriája.`,

        categoryId:
          id || '',

        name,

        url:
          url || '',

        priority:
          70,

        active:
          true,

        updatedAt:
          new Date()
            .toISOString()
      };
    })
    .filter(Boolean);
}

/* =========================================================
   UNAS TUDÁSBÁZIS ELKÉSZÍTÉSE
========================================================= */

async function buildUnasKnowledge() {
  const started =
    Date.now();

  ensureDataDirectory();

  console.log(
    'UNAS bejelentkezés...'
  );

  const login =
    await loginToUnas();

  console.log(
    'UNAS termékek lekérése...'
  );

  const productsResponse =
    await getProducts(
      login.token
    );

  console.log(
    'UNAS kategóriák lekérése...'
  );

  const categoriesResponse =
    await getCategories(
      login.token
    );

  const products =
    parseProducts(
      productsResponse.xml
    );

  const categories =
    parseCategories(
      categoriesResponse.xml
    );

  const items = [
    ...products,
    ...categories
  ];

  const knowledge = {
    version: 1,

    source:
      'UNAS Vitalis webshop',

    generatedAt:
      new Date()
        .toISOString(),

    stats: {
      products:
        products.length,

      categories:
        categories.length,

      total:
        items.length
    },

    items
  };

  fs.writeFileSync(
    UNAS_KNOWLEDGE_PATH,
    JSON.stringify(
      knowledge,
      null,
      2
    ),
    'utf8'
  );

  return {
    ok: true,

    products:
      products.length,

    categories:
      categories.length,

    total:
      items.length,

    responseMs:
      Date.now() -
      started,

    file:
      UNAS_KNOWLEDGE_PATH,

    knowledge
  };
}

/* =========================================================
   KAPCSOLATTESZT
========================================================= */

async function testUnasConnection() {
  const started =
    Date.now();

  const login =
    await loginToUnas();

  const products =
    await getProducts(
      login.token
    );

  const categories =
    await getCategories(
      login.token
    );

  return {
    ok: true,

    products:
      products.count,

    categories:
      categories.count,

    responseMs:
      Date.now() -
      started,

    message:
      `Az UNAS API kapcsolat működik. ` +
      `Termékek: ${products.count}, ` +
      `kategóriák: ${categories.count}.`
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
    ' Vitalis UNAS tudásbázis szinkronizálás'
  );

  console.log(
    '=========================================='
  );

  try {
    const result =
      await buildUnasKnowledge();

    console.log(
      'UNAS SZINKRON SIKERES'
    );

    console.log(
      `Termékek: ${result.products}`
    );

    console.log(
      `Kategóriák: ${result.categories}`
    );

    console.log(
      `Összes tudáselem: ${result.total}`
    );

    console.log(
      `Fájl: ${result.file}`
    );

    console.log(
      `Futási idő: ${result.responseMs} ms`
    );

    console.log(
      'Az UNAS webshopban semmilyen adat nem lett módosítva.'
    );
  } catch (error) {
    console.error(
      'UNAS SZINKRON HIBA'
    );

    console.error(
      error.message
    );

    process.exitCode = 1;
  }

  console.log(
    '=========================================='
  );
}

if (require.main === module) {
  run();
}

/* =========================================================
   EXPORT A SERVER.CJS SZÁMÁRA
========================================================= */

module.exports = {
  testUnasConnection,
  buildUnasKnowledge,
  loginToUnas,
  getProducts,
  getCategories,
  parseProducts,
  parseCategories
};
