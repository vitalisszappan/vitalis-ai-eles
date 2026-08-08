'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { STORAGE_KEY, DEFAULT_TTL_MS, createLifecycle, isUuid } = require('./engine/attribution-lifecycle.cjs');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

class FakeChannel {
  static channels = new Set();
  constructor() { FakeChannel.channels.add(this); this.onmessage = null; }
  postMessage(data) { for (const channel of FakeChannel.channels) if (channel !== this) channel.onmessage?.({ data }); }
  close() { FakeChannel.channels.delete(this); }
}

class FakeEventTarget {
  constructor() { this.listeners = new Set(); }
  addEventListener(type, listener) { if (type === 'storage') this.listeners.add(listener); }
  removeEventListener(type, listener) { if (type === 'storage') this.listeners.delete(listener); }
  dispatch(event) { for (const listener of this.listeners) listener(event); }
}

let time = Date.parse('2026-08-07T10:00:00Z');
const storage = memoryStorage();
const first = createLifecycle({ storage, crypto, now: () => time, BroadcastChannel: FakeChannel });
const state = first.get();
assert(isUuid(state.attributionId));
assert.equal(state.expiresAt - state.createdAt, DEFAULT_TTL_MS);
assert.equal(first.get().attributionId, state.attributionId);

const second = createLifecycle({ storage, crypto, now: () => time, BroadcastChannel: FakeChannel });
assert.equal(second.get().attributionId, state.attributionId, 'A másik lap ugyanazt az ID-t kapja.');
const rotated = first.rotate();
assert.notEqual(rotated.attributionId, state.attributionId);
assert.equal(second.get().attributionId, rotated.attributionId, 'BroadcastChannel szinkronizál.');

const eventTarget = new FakeEventTarget();
const storageSynced = createLifecycle({ storage, crypto, now: () => time, eventTarget });
const storageEventState = first.rotate();
eventTarget.dispatch({ key: STORAGE_KEY, newValue: JSON.stringify(storageEventState) });
assert.equal(storageSynced.get().attributionId, storageEventState.attributionId, 'A storage event szinkronizál.');

storage.setItem(STORAGE_KEY, '{broken');
const broken = createLifecycle({ storage, crypto, now: () => time });
assert(isUuid(broken.get().attributionId), 'Sérült localStorage után új biztonságos ID készül.');

const throwingStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
assert(isUuid(createLifecycle({ storage: throwingStorage, crypto, now: () => time }).get().attributionId));

const beforeExpiry = broken.get().attributionId;
time += DEFAULT_TTL_MS + 1;
assert.notEqual(broken.get().attributionId, beforeExpiry, 'TTL után rotáció történik.');

first.close(); second.close(); storageSynced.close(); broken.close();
console.log('Browser Attribution Lifecycle tesztek: OK');
