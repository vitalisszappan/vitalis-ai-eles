(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VitalisAttributionLifecycle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'vitalis-browser-attribution/v1';
  const CHANNEL_NAME = 'vitalis-browser-attribution';
  const SCHEMA_VERSION = 1;
  const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  function isUuid(value) {
    return typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  function randomUuid(cryptoObject) {
    if (!cryptoObject || typeof cryptoObject.randomUUID !== 'function') {
      throw new Error('secure_random_uuid_unavailable');
    }
    return cryptoObject.randomUUID();
  }

  function normalize(value, now, ttlMs) {
    if (!value || typeof value !== 'object' || value.schemaVersion !== SCHEMA_VERSION) return null;
    if (!isUuid(value.attributionId) || !Number.isFinite(value.createdAt) || !Number.isFinite(value.expiresAt)) return null;
    if (value.createdAt > now + 5 * 60 * 1000 || value.expiresAt <= now || value.expiresAt - value.createdAt !== ttlMs) return null;
    return {
      schemaVersion: SCHEMA_VERSION,
      attributionId: value.attributionId,
      createdAt: value.createdAt,
      expiresAt: value.expiresAt
    };
  }

  function createLifecycle(options = {}) {
    const storage = options.storage;
    const cryptoObject = options.crypto;
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : DEFAULT_TTL_MS;
    const eventTarget = options.eventTarget || null;
    const BroadcastChannelClass = options.BroadcastChannel || null;
    let current = null;
    let channel = null;
    const listeners = new Set();

    function notify() {
      for (const listener of listeners) listener({ ...current });
    }

    function write(state, broadcast = true) {
      current = state;
      try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
      if (broadcast && channel) {
        try { channel.postMessage(state); } catch (_) {}
      }
      notify();
      return { ...state };
    }

    function fresh() {
      const createdAt = now();
      return write({
        schemaVersion: SCHEMA_VERSION,
        attributionId: randomUuid(cryptoObject),
        createdAt,
        expiresAt: createdAt + ttlMs
      });
    }

    function read() {
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const state = normalize(JSON.parse(raw), now(), ttlMs);
        if (!state) storage.removeItem(STORAGE_KEY);
        return state;
      } catch (_) {
        try { storage.removeItem(STORAGE_KEY); } catch (_) {}
        return null;
      }
    }

    function get() {
      const state = current && normalize(current, now(), ttlMs);
      if (state) return { ...state };
      const stored = read();
      return stored ? write(stored, false) : fresh();
    }

    function rotate() {
      return fresh();
    }

    function accept(value) {
      const incoming = normalize(value, now(), ttlMs);
      if (!incoming) return false;
      const own = current && normalize(current, now(), ttlMs);
      if (own && own.createdAt > incoming.createdAt) return false;
      write(incoming, false);
      return true;
    }

    function onStorage(event) {
      if (!event || event.key !== STORAGE_KEY || !event.newValue) return;
      try { accept(JSON.parse(event.newValue)); } catch (_) {}
    }

    if (BroadcastChannelClass) {
      try {
        channel = new BroadcastChannelClass(CHANNEL_NAME);
        channel.onmessage = (event) => accept(event && event.data);
      } catch (_) { channel = null; }
    }
    if (eventTarget && typeof eventTarget.addEventListener === 'function') {
      eventTarget.addEventListener('storage', onStorage);
    }

    function close() {
      if (eventTarget && typeof eventTarget.removeEventListener === 'function') {
        eventTarget.removeEventListener('storage', onStorage);
      }
      if (channel && typeof channel.close === 'function') channel.close();
      channel = null;
      listeners.clear();
    }

    return {
      get,
      rotate,
      close,
      subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    };
  }

  return { STORAGE_KEY, CHANNEL_NAME, SCHEMA_VERSION, DEFAULT_TTL_MS, isUuid, normalize, createLifecycle };
});
