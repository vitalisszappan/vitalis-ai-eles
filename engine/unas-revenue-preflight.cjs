'use strict';

const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { loginToUnas, unasRequest } = require('../unas-sync.cjs');
const { orderRequestXml } = require('./unas-order-verifier.cjs');

const MAX_XML_BYTES = 2 * 1024 * 1024;
const SAFE_ORDER_KEY_RE = /^\d+(?:-\d+)?$/;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  processEntities: false
});

const ORDER_FIELDS = Object.freeze([
  ['key', 'Key'],
  ['id', 'Id'],
  ['dateTime', 'Date'],
  ['status', 'Status'],
  ['statusId', 'StatusID'],
  ['statusType', 'StatusType'],
  ['currency', 'Currency'],
  ['grossTotal', 'SumPriceGross']
]);

const ITEM_FIELDS = Object.freeze([
  ['itemId', 'Id'],
  ['sku', 'Sku'],
  ['quantity', 'Quantity'],
  ['unitNet', 'PriceNet'],
  ['unitGross', 'PriceGross'],
  ['vat', 'Vat']
]);

function scalar(value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    return Object.prototype.hasOwnProperty.call(value, '#text') ? scalar(value['#text']) : null;
  }
  const text = String(value).trim();
  return text || null;
}

function asArray(value) {
  return value == null ? [] : (Array.isArray(value) ? value : [value]);
}

function validatePreflightOrderKey(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 100 && SAFE_ORDER_KEY_RE.test(value);
}

function field(logicalName, path, value) {
  const sanitized = scalar(value);
  return sanitized === null ? null : { field: logicalName, path, type: 'string', value: sanitized };
}

function compactFields(definitions, source, prefix) {
  return definitions.map(([logicalName, node]) => field(logicalName, `${prefix}.${node}`, source?.[node])).filter(Boolean);
}

function specialItemKind(item) {
  const id = scalar(item?.Id);
  if (id === 'shipping-cost') return 'shipping';
  if (id === 'handel-cost') return 'payment_fee';
  if (id === 'discount-amount' || id === 'discount-percent') return 'discount';
  return null;
}

function parseRevenuePreflightResponse(xml) {
  const source = String(xml || '');
  if (Buffer.byteLength(source, 'utf8') > MAX_XML_BYTES) throw new Error('unas_response_too_large');
  if (XMLValidator.validate(source) !== true) throw new Error('invalid_unas_xml');
  const parsed = parser.parse(source);
  const orders = asArray(parsed?.Orders?.Order);
  if (orders.length !== 1) throw new Error('order_count_invalid');

  const order = orders[0];
  const items = asArray(order?.Items?.Item).map((item, index) => ({
    index,
    kind: specialItemKind(item) || 'product',
    fields: compactFields(ITEM_FIELDS, item, `Orders.Order.Items.Item[${index}]`)
  }));

  return {
    fields: compactFields(ORDER_FIELDS, order, 'Orders.Order'),
    items
  };
}

async function preflightUnasOrder(orderKey, options = {}) {
  if (!validatePreflightOrderKey(orderKey)) throw new Error('invalid_order_key');
  const loginFn = options.loginFn || loginToUnas;
  const requestFn = options.requestFn || unasRequest;
  const login = await loginFn(options);
  const response = await requestFn({ endpoint: 'getOrder', token: login.token, body: orderRequestXml(orderKey) });
  return parseRevenuePreflightResponse(response.body);
}

module.exports = {
  MAX_XML_BYTES,
  ORDER_FIELDS,
  ITEM_FIELDS,
  validatePreflightOrderKey,
  parseRevenuePreflightResponse,
  preflightUnasOrder
};
