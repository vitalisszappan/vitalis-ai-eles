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

function countXmlItems(xml, tagName) {
  const regex = new RegExp(
    `<${tagName}(?:\\s|>)`,
    'gi'
  );

  const matches = String(xml || '').match(regex);

  return matches ? matches.length : 0;
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
        path: target.pathname,
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

    request.on('error', (error) => {
      reject(error);
    });

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
   TERMÉKEK LEKÉRÉSE
========================================================= */

async function getProducts(token) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Params>
  <State>live</State>
  <ContentType>minimal</ContentType>
  <Lang>hu</Lang>
</Params>`;

  const response = await unasRequest({
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
   UNAS KAPCSOLATTESZT
========================================================= */

async function testUnasConnection() {
  const started = Date.now();

  const login = await loginToUnas();

  const products = await getProducts(
    login.token
  );

  return {
    ok: true,
    products: products.count,
    responseMs: Date.now() - started,
    message:
      `Az UNAS API kapcsolat működik. Lekért termékek: ${products.count}.`
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
    ' Vitalis UNAS API kapcsolat teszt'
  );

  console.log(
    '=========================================='
  );

  try {
    const result =
      await testUnasConnection();

    console.log(
      'UNAS KAPCSOLAT SIKERES'
    );

    console.log(
      `Termékek száma: ${result.products}`
    );

    console.log(
      `Válaszidő: ${result.responseMs} ms`
    );

    console.log(
      'A teszt semmilyen adatot nem módosított az UNAS webshopban.'
    );
  } catch (error) {
    console.error(
      'UNAS KAPCSOLATI HIBA'
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
  loginToUnas,
  getProducts
};
