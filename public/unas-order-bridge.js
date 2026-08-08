(function (root) {
  'use strict';

  const loadedScript = root.document && root.document.currentScript;
  const scriptOrigin = (() => {
    try { return loadedScript?.src ? new URL(loadedScript.src).origin : ''; }
    catch (_) { return ''; }
  })();

  function runOrderBridge(options = {}) {
    const UNAS = options.UNAS || root.UNAS;
    const lifecycleApi = options.lifecycleApi || root.VitalisAttributionLifecycle;
    const storage = options.storage || root.localStorage;
    const cryptoObject = options.crypto || root.crypto;
    const fetchFn = options.fetch || root.fetch;
    const endpoint = options.endpoint || (scriptOrigin ? `${scriptOrigin}/api/commerce/order-proof` : '/api/commerce/order-proof');
    if (!UNAS || typeof UNAS.getOrder !== 'function') return Promise.resolve({ ok: false, reason: 'unas_get_order_unavailable' });
    if (!lifecycleApi || typeof lifecycleApi.createLifecycle !== 'function') return Promise.resolve({ ok: false, reason: 'attribution_lifecycle_unavailable' });
    if (!fetchFn || !cryptoObject) return Promise.resolve({ ok: false, reason: 'browser_api_unavailable' });

    const attributionId = lifecycleApi.createLifecycle({ storage, crypto: cryptoObject }).get().attributionId;
    return new Promise((resolve) => {
      UNAS.getOrder((result) => {
        const orderKey = String(result?.key || result?.Key || '').trim();
        if (!orderKey || orderKey.length > 100) return resolve({ ok: false, reason: 'order_key_unavailable' });
        const payload = { orderKey, attributionId, schemaVersion: 1, timestamp: new Date().toISOString() };
        fetchFn(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), keepalive: true
        }).then(async (response) => {
          let reason = null;
          try {
            const body = await response.json();
            if (typeof body?.error === 'string' && /^[a-z_]{1,60}$/.test(body.error)) reason = body.error;
          } catch (_) {}
          resolve({ ok: response.ok, status: response.status, ...(reason ? { reason } : {}) });
        })
          .catch(() => resolve({ ok: false, reason: 'server_callback_failed' }));
      }, { lang: 'base' });
    });
  }

  root.VitalisUnasOrderBridge = { runOrderBridge };
})(typeof globalThis !== 'undefined' ? globalThis : this);
