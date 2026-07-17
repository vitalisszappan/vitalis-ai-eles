const https = require('https');

const API_KEY = String(
  process.env.UNAS_API_KEY || ''
).trim();

const API_BASE = 'https://api.unas.eu/shop';

/* =========================================================
   HTTP KÉRÉS
========================================================= */

function request({
  method = 'GET',
  url,
  headers = {},
  body = null
}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);

    const bodyText =
      body === null
        ? null
        : String(body);

    const requestHeaders = {
      Accept: 'application/xml',
      ...headers
    };

    if (bodyText !== null) {
      requestHeaders['Content-Type'] =
        'application/xml';

      requestHeaders['Content-Length'] =
        Buffer.byteLength(bodyText);
    }

    const req = https.request(
      {
        hostname: target.hostname,
        port: 443,
        path:
          target.pathname +
          target.search,
        method,
        headers: requestHeaders,
        timeout: 30000
      },
      (res) => {
        let responseBody = '';

        res.setEncoding('utf8');

        res.on(
          'data',
          (chunk) => {
            responseBody += chunk;
          }
        );

        res.on(
          'end',
          () => {
            const status =
              res.statusCode || 0;

            if (
              status >= 200 &&
              status < 300
            ) {
              resolve({
                status,
                body: responseBody
              });

              return;
            }

            reject(
              new Error(
                `UNAS HTTP ${status}: ${responseBody.slice(0, 1000)}`
              )
            );
          }
        );
      }
    );

    req.on(
      'timeout',
      () => {
        req.destroy(
          new Error(
            'Az UNAS API kapcsolat időtúllépett.'
          )
        );
      }
    );

    req.on(
      'error',
      reject
    );

    if (bodyText !== null) {
      req.write(bodyText);
    }

    req.end();
  });
}

/* =========================================================
   XML SEGÉDFÜGGVÉNYEK
========================================================= */

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getXmlValue(
  xml,
  tag
) {
  const match =
    xml.match(
      new RegExp(
        `<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
        'i'
      )
    );

  return match
    ? match[1].trim()
    : '';
}

function countXmlTags(
  xml,
  tag
) {
  const matches =
    xml.match(
      new RegExp(
        `<${tag}(?:\\s|>)`,
        'gi'
      )
    );

  return matches
    ? matches.length
    : 0;
}

/* =========================================================
   UNAS LOGIN
========================================================= */

async function login() {
  if (!API_KEY) {
    throw new Error(
      'Hiányzik az UNAS_API_KEY környezeti változó.'
    );
  }

  console.log(
    'UNAS: bejelentkezés indul...'
  );

  const loginXml = `
<?xml version="1.0" encoding="UTF-8"?>
<Params>
  <ApiKey>${escapeXml(API_KEY)}</ApiKey>
</Params>
`.trim();

  const response =
    await request({
      method: 'POST',
      url: `${API_BASE}/login`,
      body: loginXml
    });

  const token =
    getXmlValue(
      response.body,
      'Token'
    );

  if (!token) {
    throw new Error(
      `Az UNAS nem adott vissza tokent. Válasz: ${response.body.slice(0, 1500)}`
    );
  }

  console.log(
    'UNAS: sikeres bejelentkezés.'
  );

  return token;
}

/* =========================================================
   TERMÉKEK LEKÉRÉSE
========================================================= */

async function getProducts(
  token
) {
  console.log(
    'UNAS: termékek lekérése indul...'
  );

  const response =
    await request({
      method: 'GET',
      url: `${API_BASE}/getProduct`,
      headers: {
        Authorization:
          `Bearer ${token}`
      }
    });

  return response.body;
}

/* =========================================================
   SZINKRON TESZT
========================================================= */

async function run() {
  console.log(
    '=========================================='
  );

  console.log(
    ' Vitalis UNAS szinkron – kapcsolat teszt'
  );

  console.log(
    '=========================================='
  );

  try {
    const token =
      await login();

    const productsXml =
      await getProducts(
        token
      );

    const productCount =
      countXmlTags(
        productsXml,
        'Product'
      );

    console.log(
      `UNAS kapcsolat sikeres.`
    );

    console.log(
      `Lekért termékek száma: ${productCount}`
    );

    console.log(
      `Kapott adatmennyiség: ${productsXml.length} karakter`
    );

    console.log(
      'A teszt nem módosított semmit az UNAS webshopban.'
    );

  } catch (error) {
    console.error(
      'UNAS SZINKRON HIBA:'
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

run();
