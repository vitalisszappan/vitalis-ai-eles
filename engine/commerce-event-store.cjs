'use strict';

const { createLocalPocEventStore } = require('./commerce-events.cjs');

const TABLE = 'commerce_events';
const SELECT_FIELDS = 'event_id,attribution_id,chat_session_id,event_type,canonical_product_id,unas_product_id,sku,recommendation_type,recommendation_rank,route,intent,occurred_at,received_at,schema_version';

function parseRows(response) {
  const rows = JSON.parse(response?.body || '[]');
  if (!Array.isArray(rows)) throw new Error('invalid_commerce_event_store_response');
  return rows;
}

function createSupabaseCommerceEventStore(options = {}) {
  const request = options.request;
  if (typeof request !== 'function') throw new Error('supabase_request_required');
  return {
    kind: 'supabase', productionDurable: true, idempotencyScope: 'event_id_unique_constraint',
    async insertEvent(event) {
      const response = await request({
        method: 'POST',
        pathname: `/rest/v1/${TABLE}?on_conflict=event_id&select=event_id`,
        body: event,
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        operation: 'commerce_event_insert', table: TABLE
      });
      return { duplicate: parseRows(response).length === 0 };
    },
    async hasEventId(eventId) {
      const response = await request({ pathname: `/rest/v1/${TABLE}?select=event_id&event_id=eq.${encodeURIComponent(eventId)}&limit=1`, operation: 'commerce_event_id_lookup', table: TABLE });
      return parseRows(response).length === 1;
    },
    async findAttribution(attributionId, beforeIso) {
      const before = beforeIso ? `&occurred_at=lte.${encodeURIComponent(beforeIso)}` : '';
      const response = await request({ pathname: `/rest/v1/${TABLE}?select=${SELECT_FIELDS}&attribution_id=eq.${encodeURIComponent(attributionId)}${before}&order=occurred_at.asc`, operation: 'commerce_attribution_lookup', table: TABLE });
      return parseRows(response);
    },
    async findProductClickedByAttribution(attributionId, beforeIso) {
      const before = beforeIso ? `&occurred_at=lte.${encodeURIComponent(beforeIso)}` : '';
      const response = await request({ pathname: `/rest/v1/${TABLE}?select=${SELECT_FIELDS}&attribution_id=eq.${encodeURIComponent(attributionId)}&event_type=eq.product_clicked&sku=not.is.null${before}&order=occurred_at.asc`, operation: 'commerce_product_clicked_lookup', table: TABLE });
      return parseRows(response);
    },
    async loadRecentEventIds(limit = 1000) {
      const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 5000 ? limit : 1000;
      const response = await request({ pathname: `/rest/v1/${TABLE}?select=event_id&order=received_at.desc&limit=${safeLimit}`, operation: 'commerce_recent_event_ids', table: TABLE });
      return parseRows(response).map((row) => row.event_id);
    }
  };
}

function createLocalCommerceEventStore(filePath) {
  const local = createLocalPocEventStore(filePath);
  return {
    ...local,
    async insertEvent(event) { return local.append(event); },
    async hasEventId(eventId) { return local.hasEventId(eventId); },
    async findAttribution(attributionId, beforeIso) { return local.findAttribution(attributionId, beforeIso); },
    async findProductClickedByAttribution(attributionId, beforeIso) { return local.findProductClickedByAttribution(attributionId, beforeIso); },
    async loadRecentEventIds(limit) { return local.loadRecentEventIds(limit); }
  };
}

function createUnavailableProductionStore() {
  const unavailable = async () => { throw new Error('production_commerce_event_store_unavailable'); };
  return { kind: 'unavailable', productionDurable: false, idempotencyScope: 'none', insertEvent: unavailable, hasEventId: unavailable, findAttribution: unavailable, findProductClickedByAttribution: unavailable, loadRecentEventIds: unavailable };
}

function createCommerceEventStore(options = {}) {
  if (options.supabaseConfigured) return createSupabaseCommerceEventStore({ request: options.request });
  if (options.productionRuntime) return createUnavailableProductionStore();
  return createLocalCommerceEventStore(options.filePath);
}

module.exports = { TABLE, SELECT_FIELDS, createCommerceEventStore, createSupabaseCommerceEventStore, createLocalCommerceEventStore, createUnavailableProductionStore };
