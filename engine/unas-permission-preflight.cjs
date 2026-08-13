'use strict';

const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { loginToUnas } = require('../unas-sync.cjs');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: true, processEntities: false });

function scalar(value) {
  if (value == null) return null;
  if (typeof value === 'object') return Object.prototype.hasOwnProperty.call(value, '#text') ? scalar(value['#text']) : null;
  const text = String(value).trim();
  return text || null;
}

function allowedValue(value) {
  const text = scalar(value);
  if (text == null) return true;
  return !/^(0|false|no|disabled|denied)$/i.test(text);
}

function permissionNames(permissions) {
  if (permissions == null) return [];
  if (Array.isArray(permissions)) return permissions.flatMap(permissionNames);
  if (typeof permissions !== 'object') return String(permissions).split(/[\s,;|]+/).map((item) => item.trim()).filter(Boolean);
  if (Object.prototype.hasOwnProperty.call(permissions, 'Permission')) return permissionNames(permissions.Permission);

  const explicitName = scalar(permissions.Name) || scalar(permissions.Code) || scalar(permissions['#text']);
  if (explicitName) {
    const enabled = permissions.Allowed ?? permissions.Enabled ?? permissions.Active;
    return allowedValue(enabled) ? [explicitName] : [];
  }

  return Object.entries(permissions).flatMap(([name, value]) => {
    if (name.startsWith('@_')) return [];
    if (/^(get[A-Z].*|set[A-Z].*)$/.test(name) && allowedValue(value)) return [name];
    return permissionNames(value);
  });
}

function identityValue(value) {
  const text = scalar(value);
  if (!text || text.length > 100 || !/^[A-Za-z0-9._:\/ -]+$/.test(text)) throw new Error('invalid_unas_identity');
  return text;
}

function parseLoginPermissions(xml) {
  const source = String(xml || '').trim();
  if (XMLValidator.validate(source) !== true) throw new Error('invalid_unas_login_xml');
  const parsed = parser.parse(source);
  if (!parsed?.Login || typeof parsed.Login !== 'object') throw new Error('invalid_unas_login_xml');
  return {
    shopId: identityValue(parsed.Login.ShopId),
    subscription: identityValue(parsed.Login.Subscription),
    getOrderAllowed: permissionNames(parsed.Login.Permissions).some((name) => name === 'getOrder')
  };
}

async function runUnasPermissionPreflight(options = {}) {
  if (!options.unasConfigured) {
    const error = new Error('unas_not_configured');
    error.code = 'unas_not_configured';
    throw error;
  }
  const login = await (options.loginFn || loginToUnas)();
  const result = parseLoginPermissions(login?.raw);
  return { unasConfigured: true, loginOk: true, shopId: result.shopId, subscription: result.subscription, getOrderAllowed: result.getOrderAllowed };
}

function createPermissionPreflightHandler(options = {}) {
  if (typeof options.sendJson !== 'function') throw new Error('send_json_required');
  const logger = typeof options.logger === 'function' ? options.logger : () => {};
  return async function handle(req, res) {
    const supplied = String(req.headers['x-admin-token'] || '').trim();
    if (!options.adminToken || supplied !== options.adminToken) {
      options.sendJson(res, options.adminToken ? 401 : 503, { ok: false, error: options.adminToken ? 'unauthorized' : 'admin_unavailable' });
      return;
    }
    try {
      const result = await runUnasPermissionPreflight({ unasConfigured: options.unasConfigured(), loginFn: options.loginFn });
      logger({ operation: 'unas_permission_preflight', loginOk: true, permissionChecked: true, getOrderAllowed: result.getOrderAllowed, status: 200, code: 'ok' });
      options.sendJson(res, 200, result);
    } catch (error) {
      const code = error?.code === 'unas_not_configured' ? 'unas_not_configured' : 'login_or_permissions_failed';
      const status = code === 'unas_not_configured' ? 503 : 502;
      logger({ operation: 'unas_permission_preflight', loginOk: false, permissionChecked: false, getOrderAllowed: false, status, code });
      options.sendJson(res, status, { ok: false, error: 'unas_permission_preflight_failed' });
    }
  };
}

module.exports = { parseLoginPermissions, runUnasPermissionPreflight, createPermissionPreflightHandler };
