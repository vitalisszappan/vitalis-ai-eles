const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseProducts,
  getProducts,
  createAudit,
  buildUnasKnowledge,
  productRequestXml
} = require('./unas-sync.cjs');

const fixturePath = path.join(__dirname, 'test', 'fixtures', 'unas-products.xml');
const fixture = fs.readFileSync(fixturePath, 'utf8');

function productsXml(products) {
  return `<?xml version="1.0" encoding="UTF-8"?><Products>${products.join('')}</Products>`;
}

function productXml(id, sku) {
  return `<Product><State>live</State><Id>${id}</Id><Sku>${sku}</Sku><Name>Termék ${id}</Name><StatusBase>1</StatusBase><NoList>0</NoList></Product>`;
}

function categoriesResult() {
  return { categories: [{ unasId: '10', name: 'Teszt kategória' }], count: 1 };
}

async function main() {
  const products = parseProducts(fixture);
  assert.equal(products.length, 6);

  const normal = products[0];
  assert.equal(normal.unasId, '1001');
  assert.equal(normal.sku, 'SOAP-001');
  assert.equal(normal.name, 'Anonim normál szappan');
  assert.equal(normal.shortDescription, 'Rövid leírás.');
  assert.equal(normal.longDescription, 'Hosszú leírás.');
  assert.equal(normal.priceGross, 1490);
  assert.equal(normal.actualPriceGross, 1490);
  assert.equal(normal.currency, 'HUF');
  assert.deepEqual(normal.categoryIds, ['10', '20']);
  assert.deepEqual(normal.categoryNames, ['Szappanok', 'Problémás bőr']);
  assert.deepEqual(normal.image, {
    filename: 'anonim-1001.jpg',
    url: 'https://cdn.invalid/anonim-1001.jpg',
    sefUrl: 'anonim-kep'
  });
  assert.equal(normal.stockQty, 12);
  assert.equal(normal.active, true);
  assert.equal(normal.public, true);
  assert.equal(normal.orderable, true);

  const sale = products[1];
  assert.equal(sale.priceGross, 1990);
  assert.equal(sale.actualPriceGross, 1590);
  assert.equal(sale.stockQty, 0);
  assert.equal(sale.image, null);

  const incomplete = products[2];
  assert.equal(incomplete.sku, null);
  assert.equal(incomplete.priceGross, null);
  assert.equal(incomplete.stockQty, null);
  assert.equal(incomplete.active, false);
  assert.equal(incomplete.public, false);
  assert.equal(incomplete.orderable, null);

  const audit = createAudit(products);
  assert.equal(audit.totalRecords, 6);
  assert.equal(audit.uniqueUnasIds, 5);
  assert.equal(audit.missingSku, 1);
  assert.deepEqual(audit.duplicateUnasIds, [{ value: '1005', count: 2 }]);
  assert.deepEqual(audit.duplicateSkus, [{ value: 'DUP-SKU', count: 3 }]);
  assert.equal(audit.missingUrl, 5);
  assert.equal(audit.missingImage, 5);
  assert.equal(audit.unmappedProducts, null);

  assert.throws(() => parseProducts('<Products><Product></Products>'), /Hibás UNAS XML/);
  assert.match(productRequestXml(25, 50), /<LimitNum>25<\/LimitNum>[\s\S]*<LimitStart>50<\/LimitStart>/);

  const pageBodies = [
    productsXml([productXml('1', 'A'), productXml('2', 'B')]),
    productsXml([productXml('2', 'B'), productXml('3', 'C')]),
    productsXml([])
  ];
  const starts = [];
  const paged = await getProducts('token', {
    pageSize: 2,
    requestFn: async ({ body }) => {
      starts.push(Number(body.match(/<LimitStart>(\d+)<\/LimitStart>/)[1]));
      return { body: pageBodies.shift() };
    }
  });
  assert.deepEqual(starts, [0, 2, 4]);
  assert.equal(paged.pages, 3);
  assert.equal(paged.rawCount, 4);
  assert.deepEqual(paged.products.map((item) => item.unasId), ['1', '2', '3']);

  await assert.rejects(
    getProducts('token', {
      pageSize: 1,
      requestFn: async () => ({ body: productsXml([productXml('1', 'A')]) })
    }),
    /ismétlődő oldalt/
  );
  await assert.rejects(
    getProducts('token', { requestFn: async () => { throw new Error('API hiba'); } }),
    /API hiba/
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-unas-'));
  try {
    const snapshotPath = path.join(tempDir, 'snapshot.json');
    fs.writeFileSync(snapshotPath, '{"lastGood":true}', 'utf8');
    const successfulOptions = {
      snapshotPath,
      loginFn: async () => ({ token: 'anonim-token' }),
      productsFn: async () => ({ products: products.slice(0, 5), rawProducts: products, pages: 2, pageSize: 3 }),
      categoriesFn: async () => categoriesResult()
    };
    const result = await buildUnasKnowledge(successfulOptions);
    const saved = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    assert.equal(result.products, 5);
    assert.equal(saved.schema, 'vitalis-unas-commerce-catalog/v1');
    assert.equal(saved.products.length, 5);
    assert.equal(saved.audit.duplicateUnasIds.length, 1);
    assert.equal(fs.readdirSync(tempDir).some((name) => name.endsWith('.tmp')), false);

    const lastGood = fs.readFileSync(snapshotPath, 'utf8');
    await assert.rejects(
      buildUnasKnowledge({
        ...successfulOptions,
        productsFn: async () => { throw new Error('részleges termékhiba'); }
      }),
      /részleges termékhiba/
    );
    assert.equal(fs.readFileSync(snapshotPath, 'utf8'), lastGood);

    await assert.rejects(
      buildUnasKnowledge({
        ...successfulOptions,
        categoriesFn: async () => { throw new Error('részleges kategóriahiba'); }
      }),
      /részleges kategóriahiba/
    );
    assert.equal(fs.readFileSync(snapshotPath, 'utf8'), lastGood);

    await assert.rejects(
      buildUnasKnowledge({
        ...successfulOptions,
        productsFn: async () => ({ products: [], rawProducts: [], pages: 1, pageSize: 100 })
      }),
      /nem adott vissza terméket/
    );
    assert.equal(fs.readFileSync(snapshotPath, 'utf8'), lastGood);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('TEST_UNAS_SYNC: minden ellenőrzés sikeres');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
