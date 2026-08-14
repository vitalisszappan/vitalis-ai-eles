'use strict';

const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { loginToUnas, unasRequest } = require('../unas-sync.cjs');
const { orderRequestXml } = require('./unas-order-verifier.cjs');

const MAX_XML_BYTES = 2 * 1024 * 1024;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  processEntities: false
});

function scalar(value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    return Object.prototype.hasOwnProperty.call(value, '#text') ? scalar(value['#text']) : null;
  }
  const result = String(value).trim();
  return result || null;
}

function asArray(value) {
  return value == null ? [] : (Array.isArray(value) ? value : [value]);
}

function parseRevenueOrderResponse(xml) {
  const source = String(xml || '');
  if (Buffer.byteLength(source, 'utf8') > MAX_XML_BYTES) throw new Error('unas_response_too_large');
  if (XMLValidator.validate(source) !== true) throw new Error('invalid_unas_xml');
  const parsed = parser.parse(source);
  return asArray(parsed?.Orders?.Order).map((order) => ({
    key: scalar(order?.Key),
    id: scalar(order?.Id),
    date: scalar(order?.Date),
    currency: scalar(order?.Currency),
    status: scalar(order?.Status),
    statusId: scalar(order?.StatusID),
    statusType: scalar(order?.StatusType),
    items: asArray(order?.Items?.Item).map((item) => ({
      id: scalar(item?.Id),
      sku: scalar(item?.Sku),
      quantity: scalar(item?.Quantity),
      priceGross: scalar(item?.PriceGross)
    }))
  }));
}

async function fetchUnasRevenueEvidence(orderKey, options = {}) {
  const loginFn = options.loginFn || loginToUnas;
  const requestFn = options.requestFn || unasRequest;
  let orders;
  try {
    const login = await loginFn(options);
    const response = await requestFn({
      endpoint: 'getOrder',
      token: login.token,
      body: orderRequestXml(orderKey)
    });
    orders = parseRevenueOrderResponse(response.body);
  } catch (_) {
    const error = new Error('unas_revenue_fetch_failed');
    error.code = 'UNAS_REVENUE_FETCH_FAILED';
    throw error;
  }
  if (orders.length === 0) return { ok: false, reason: 'order_not_found' };
  if (orders.length !== 1) return { ok: false, reason: 'multiple_orders' };
  const order = orders[0];
  if (order.key !== orderKey) return { ok: false, reason: 'order_key_mismatch' };
  if (!order.id) return { ok: false, reason: 'order_id_missing' };
  return { ok: true, readOnly: true, order };
}

module.exports = {
  MAX_XML_BYTES,
  parseRevenueOrderResponse,
  fetchUnasRevenueEvidence
};
