'use strict';

const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { loginToUnas, unasRequest } = require('../unas-sync.cjs');

const MAX_XML_BYTES = 2 * 1024 * 1024;
const SAFE_ORDER_KEY_RE = /^\d+(?:-\d+)?$/;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: true, processEntities: false });

function scalar(value) {
  if (value == null) return null;
  if (typeof value === 'object') return Object.prototype.hasOwnProperty.call(value, '#text') ? scalar(value['#text']) : null;
  const result = String(value).trim();
  return result || null;
}

function asArray(value) { return value == null ? [] : (Array.isArray(value) ? value : [value]); }

function normalizeOrderLookupKey(orderKey) {
  if (typeof orderKey !== 'string' || !orderKey.length || orderKey.length > 100 || !SAFE_ORDER_KEY_RE.test(orderKey)) {
    throw new Error('invalid_order_key');
  }
  return orderKey.includes('-') ? orderKey.slice(orderKey.lastIndexOf('-') + 1) : orderKey;
}

function orderRequestXml(orderKey) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Params><Key>${normalizeOrderLookupKey(orderKey)}</Key></Params>`;
}

function parseOrderResponse(xml) {
  const source = String(xml || '');
  if (Buffer.byteLength(source, 'utf8') > MAX_XML_BYTES) throw new Error('unas_response_too_large');
  if (XMLValidator.validate(source) !== true) throw new Error('invalid_unas_xml');
  const parsed = parser.parse(source);
  const orders = asArray(parsed?.Orders?.Order);
  return orders.map((order) => ({
    key: scalar(order?.Key),
    id: scalar(order?.Id),
    date: scalar(order?.Date),
    items: asArray(order?.Items?.Item).map((item) => ({
      id: scalar(item?.Id),
      sku: scalar(item?.Sku)
    }))
  }));
}

async function verifyUnasOrder(orderKey, options = {}) {
  const loginFn = options.loginFn || loginToUnas;
  const requestFn = options.requestFn || unasRequest;
  const emit = (step, result, status, category) => { try { options.onDiagnostic?.({ step, result, status: Number.isInteger(status) ? status : null, category }); } catch (_) {} };
  const statusOf = (error) => Number(error?.status) || Number(String(error?.message || '').match(/UNAS HTTP\s+(\d{3})/)?.[1]) || null;
  let login;
  try { login = await loginFn(options); emit('UNAS_LOGIN', 'PASS', null, null); }
  catch (error) { const status=statusOf(error);emit('UNAS_LOGIN','FAIL',status,status?'LOGIN_FAILED':(/timeout|timed|kapcsolat|network|ECONN|ENET|EHOST|EAI_AGAIN|ENOTFOUND/i.test(String(error?.message||''))?'NETWORK_FAILED':'LOGIN_FAILED'));throw error; }
  let response;
  try { response = await requestFn({ endpoint: 'getOrder', token: login.token, body: orderRequestXml(orderKey) });emit('UNAS_GET_ORDER','PASS',Number(response?.status)||null,null); }
  catch (error) { const status=statusOf(error);emit('UNAS_GET_ORDER','FAIL',status,status?'GET_ORDER_FAILED':'NETWORK_FAILED');throw error; }
  let orders;
  try { orders = parseOrderResponse(response.body); }
  catch (error) { emit('ORDER_COUNT','FAIL',null,'MALFORMED_RESPONSE');throw error; }
  if (orders.length !== 1) { emit('ORDER_COUNT','FAIL',null,orders.length===0?'ORDER_NOT_FOUND':'MULTIPLE_ORDERS');return { ok: false, reason: 'order_count_invalid' }; }
  emit('ORDER_COUNT','PASS',null,null);
  if (orders[0].key !== orderKey) { emit('ORDER_KEY_MATCH','FAIL',null,'ORDER_KEY_MISMATCH');return {ok:false,reason:'order_key_mismatch'}; }
  emit('ORDER_KEY_MATCH','PASS',null,null);
  if (!orders[0].id) { emit('ORDER_ID_PRESENT','FAIL',null,'ORDER_ID_MISSING');return {ok:false,reason:'order_id_missing'}; }
  emit('ORDER_ID_PRESENT','PASS',null,null);
  return { ok: true, order: orders[0] };
}

module.exports = { MAX_XML_BYTES, normalizeOrderLookupKey, orderRequestXml, parseOrderResponse, verifyUnasOrder };
