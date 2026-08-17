'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  ORDER_FIELDS,
  ITEM_FIELDS,
  validatePreflightOrderKey,
  parseRevenuePreflightResponse,
  preflightUnasOrder,
  toPreflightDiagnostic
} = require('./engine/unas-revenue-preflight.cjs');

const ROOT = __dirname;
const PORT = 3412;
const ADMIN_TOKEN = 'revenue-preflight-admin-token';
const CATALOG_FIXTURE_PATH = path.join(ROOT, 'test', 'fixtures', 'knowledge-builder-catalog.json');
const CATALOG_FIXTURE_PRELOAD = path.join(ROOT, 'test', 'helpers', 'install-catalog-fixture.cjs');
const adminHtml=fs.readFileSync('./public/admin.html','utf8'),adminJs=fs.readFileSync('./public/admin.js','utf8');
for(const id of ['unasOrderPreflightKey','unasOrderPreflightButton','unasOrderPreflightResult'])assert.equal(adminHtml.includes(`id="${id}"`),true);
assert.match(adminHtml,/id="unasOrderPreflightKey"[^>]*value="99212-298722"/);assert.match(adminJs,/\/api\/admin\/commerce\/unas-order-preflight\?orderKey=/);
for(const label of ['Response order count:','Order.Key:','Order.Id:','Status:','StatusID:','StatusType:','Currency:','SumPriceGross:','Product SKU-k:'])assert.equal(adminJs.includes(label),true);
for(const forbidden of ['Customer','Contact','Address','Email','Phone','Comments','raw XML','response.body'])assert.equal(adminJs.includes(forbidden),false);

const fixture = `<?xml version="1.0" encoding="UTF-8"?>
<Orders><Order>
  <Key>99212-962676</Key><Id>42</Id><Date>2026.08.08 16:38:25</Date>
  <Status>Feldolgozás alatt</Status><StatusID>100</StatusID><StatusType>base</StatusType>
  <Currency>HUF</Currency><SumPriceGross>12700</SumPriceGross>
  <Customer><Id>999</Id><Email>private@example.invalid</Email><Contact><Name>Private Person</Name><Phone>+360000000</Phone></Contact><Addresses><Shipping><Street>Secret street</Street></Shipping></Addresses></Customer>
  <Comments><Comment><Text>private comment</Text></Comment></Comments>
  <Payment><Name>Private payment label</Name><Transactions><Transaction><AuthCode>SECRET-AUTH</AuthCode></Transaction></Transactions></Payment>
  <Items>
    <Item><Id>product-1</Id><Sku>SKU-1</Sku><Name>Private product name</Name><Quantity>2</Quantity><PriceNet>1000</PriceNet><PriceGross>1270</PriceGross><Vat>27%</Vat></Item>
    <Item><Id>shipping-cost</Id><Sku>shipping-cost</Sku><Name>Private shipping name</Name><Quantity>1</Quantity><PriceNet>1000</PriceNet><PriceGross>1270</PriceGross><Vat>27%</Vat></Item>
    <Item><Id>handel-cost</Id><Sku>handel-cost</Sku><Quantity>1</Quantity><PriceNet>100</PriceNet><PriceGross>127</PriceGross><Vat>27%</Vat></Item>
    <Item><Id>discount-amount</Id><Sku>discount-amount</Sku><Quantity>1</Quantity><PriceNet>-100</PriceNet><PriceGross>-127</PriceGross><Vat>27%</Vat></Item>
  </Items>
</Order></Orders>`;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path: pathname,
      method: options.method || 'GET', headers: options.headers || {}
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`test_server_exit_${child.exitCode}`);
    try { if ((await request('/api/status')).status === 200) return; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('test_server_start_timeout');
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
  assert.equal(validatePreflightOrderKey('99212-962676'), true);
  for (const invalid of ['', '<xml>', 'A&B', 'a\nb', 'ORDER-123', '-636298', '99212-', '99212--636298', '1-2-3', 'x'.repeat(101)]) assert.equal(validatePreflightOrderKey(invalid), false);

  const evidence = parseRevenuePreflightResponse(fixture);
  assert.deepEqual(ORDER_FIELDS.map(([name]) => name), ['key', 'id', 'dateTime', 'status', 'statusId', 'statusType', 'currency', 'grossTotal']);
  assert.deepEqual(ITEM_FIELDS.map(([name]) => name), ['itemId', 'sku', 'quantity', 'unitNet', 'unitGross', 'vat']);
  assert.deepEqual(evidence.items.map((item) => item.kind), ['product', 'shipping', 'payment_fee', 'discount']);
  assert.equal(evidence.fields.find((item) => item.field === 'currency').value, 'HUF');
  assert.equal(evidence.fields.find((item) => item.field === 'grossTotal').value, '12700');
  assert.equal(evidence.items[0].fields.find((item) => item.field === 'quantity').value, '2');
  const serialized = JSON.stringify(evidence);
  for (const forbidden of ['Customer', 'private@example.invalid', 'Private Person', '+360000000', 'Secret street', 'private comment', 'SECRET-AUTH', 'Private product name', '<Orders>']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(serialized.includes('lineGross'), false);
  assert.equal(serialized.includes('lineNet'), false);

  const missing = parseRevenuePreflightResponse('<Orders><Order><Key>X</Key><Items><Item><Id>1</Id></Item></Items></Order></Orders>');
  assert.deepEqual(missing.fields, [{ field: 'key', path: 'Orders.Order.Key', type: 'string', value: 'X' }]);
  assert.deepEqual(missing.items[0].fields, [{ field: 'itemId', path: 'Orders.Order.Items.Item[0].Id', type: 'string', value: '1' }]);
  assert.throws(() => parseRevenuePreflightResponse('<Orders>'), /invalid_unas_xml/);
  assert.throws(() => parseRevenuePreflightResponse('<Orders><Order/><Order/></Orders>'), /order_count_invalid/);

  const calls = [];
  const probed = await preflightUnasOrder('99212-962676', {
    loginFn: async () => ({ token: 'server-only-token' }),
    requestFn: async (call) => { calls.push(call); return { body: fixture }; }
  });
  assert.equal(probed.fields[0].value, '99212-962676');
  assert.deepEqual(calls.map((call) => call.endpoint), ['getOrder']);
  assert.match(calls[0].body, /<Key>962676<\/Key>/);
  assert.equal(calls[0].body.includes('<Key>99212-962676</Key>'), false);
  assert.equal(calls.some((call) => /setOrder/i.test(call.endpoint)), false);

  const secret='SECRET-ORDER-XML-API-TOKEN';
  const failures=[
    ['login',()=>preflightUnasOrder('99212-962676',{loginFn:async()=>{throw Error(secret)}})],
    ['getOrder_http',()=>preflightUnasOrder('99212-962676',{loginFn:async()=>({token:secret}),requestFn:async()=>{throw Error(`UNAS HTTP 400: <Error>${secret}</Error>`)}})],
    ['getOrder_empty',()=>preflightUnasOrder('99212-962676',{loginFn:async()=>({token:secret}),requestFn:async()=>({body:''})})],
    ['xml_parse',()=>preflightUnasOrder('99212-962676',{loginFn:async()=>({token:secret}),requestFn:async()=>({body:'<Orders>'})})],
    ['order_match',()=>preflightUnasOrder('99212-962676',{loginFn:async()=>({token:secret}),requestFn:async()=>({body:'<Orders><Order/><Order/></Orders>'})})],
    ['evidence_build',()=>preflightUnasOrder('99212-962676',{loginFn:async()=>({token:secret}),requestFn:async()=>({body:fixture}),parseFn:()=>{throw Error(secret)}})]
  ];
  for(const [stage,run] of failures){let caught;try{await run();}catch(error){caught=error;}const diagnostic=toPreflightDiagnostic(caught);assert.deepEqual(Object.keys(diagnostic),['operation','stage','status','code']);assert.equal(diagnostic.stage,stage);const logged=JSON.stringify(diagnostic);for(const forbidden of [secret,'<Error>','99212-962676','private@example.invalid'])assert.equal(logged.includes(forbidden),false);}

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-unas-preflight-'));
  const eventLog = path.join(temp, 'events.jsonl');
  const proofLog = path.join(temp, 'proofs.jsonl');
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ADMIN_TOKEN,
      UNAS_API_KEY: 'test-only-key', UNAS_API_BASE_URL: 'https://127.0.0.1:9',
      UNAS_SYNC_INTERVAL_MS: '0', COMMERCE_EVENT_LOG: eventLog, ORDER_PROOF_LOG: proofLog,
      SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '',
      VITALIS_TEST_CATALOG_FIXTURE: CATALOG_FIXTURE_PATH,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${CATALOG_FIXTURE_PRELOAD}`.trim()
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  try {
    await waitForServer(child);
    const endpoint = '/api/admin/commerce/unas-order-preflight?orderKey=99212-962676';
    assert.equal((await request(endpoint)).status, 401);
    assert.equal((await request(`${endpoint}&token=${encodeURIComponent(ADMIN_TOKEN)}`)).status, 401);
    assert.equal((await request('/api/admin/commerce/unas-order-preflight?orderKey=%3Cxml%3E', { headers: { 'X-Admin-Token': ADMIN_TOKEN } })).status, 400);
    const foreignOrigin = await request(endpoint, { headers: { 'X-Admin-Token': ADMIN_TOKEN, Origin: 'https://foreign.example' } });
    assert.equal(foreignOrigin.status, 502);
    assert.equal(foreignOrigin.headers['cache-control'], 'no-store');
    assert.deepEqual(JSON.parse(foreignOrigin.text), { ok: false, error: 'unas_preflight_failed' });
    assert.equal(foreignOrigin.text.includes('test-only-key'), false);
    assert.equal((await request(endpoint, { method: 'POST', headers: { 'X-Admin-Token': ADMIN_TOKEN } })).status, 405);
    for (let count = 0; count < 3; count += 1) {
      assert.equal((await request(endpoint, { headers: { 'X-Admin-Token': ADMIN_TOKEN } })).status, 502);
    }
    assert.equal((await request(endpoint, { headers: { 'X-Admin-Token': ADMIN_TOKEN } })).status, 429);
    assert.equal(fs.existsSync(eventLog), false);
    assert.equal(fs.existsSync(proofLog), false);
  } finally {
    await stopServer(child);
    fs.rmSync(temp, { recursive: true, force: true });
  }
  assert.equal(stderr, '');
  console.log('UNAS revenue preflight allowlist, auth es read-only security: OK');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
