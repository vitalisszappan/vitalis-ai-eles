'use strict';

const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { loginToUnas, unasRequest } = require('../unas-sync.cjs');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: true });

function scalar(value) {
  if (value == null) return null;
  if (typeof value === 'object') return Object.prototype.hasOwnProperty.call(value, '#text') ? scalar(value['#text']) : null;
  const result = String(value).trim();
  return result || null;
}

function asArray(value) { return value == null ? [] : (Array.isArray(value) ? value : [value]); }

function orderRequestXml(orderKey) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Params><Key>${orderKey}</Key></Params>`;
}

function parseOrderResponse(xml) {
  if (XMLValidator.validate(String(xml || '')) !== true) throw new Error('invalid_unas_xml');
  const parsed = parser.parse(String(xml));
  const orders = asArray(parsed?.Orders?.Order);
  return orders.map((order) => ({
    key: scalar(order?.Key),
    id: scalar(order?.Id),
    date: scalar(order?.Date),
    items: asArray(order?.Items?.Item).map((item) => ({ id: scalar(item?.Id), sku: scalar(item?.Sku) }))
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

module.exports = { orderRequestXml, parseOrderResponse, verifyUnasOrder };
