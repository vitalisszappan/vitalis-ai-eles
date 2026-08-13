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
    currency: scalar(order?.Currency),
    status: scalar(order?.Status),
    statusId: scalar(order?.StatusID),
    statusType: scalar(order?.StatusType),
    items: asArray(order?.Items?.Item).map((item) => ({ id: scalar(item?.Id), sku: scalar(item?.Sku), quantity: scalar(item?.Quantity), priceGross: scalar(item?.PriceGross) }))
  }));
}

async function verifyUnasOrder(orderKey, options = {}) {
  const loginFn = options.loginFn || loginToUnas;
  const requestFn = options.requestFn || unasRequest;
  const login = await loginFn(options);
  const response = await requestFn({ endpoint: 'getOrder', token: login.token, body: orderRequestXml(orderKey) });
  const orders = parseOrderResponse(response.body);
  if (orders.length !== 1) return { ok: false, reason: 'order_count_invalid' };
  return { ok: true, order: orders[0] };
}

module.exports = { MAX_XML_BYTES, normalizeOrderLookupKey, orderRequestXml, parseOrderResponse, verifyUnasOrder };
