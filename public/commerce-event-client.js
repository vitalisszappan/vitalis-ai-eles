(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VitalisCommerceEventClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function text(value) { if (typeof value !== 'string') return null; const result=value.trim();return result&&!/^(?:undefined|null)$/i.test(result)?result:null; }
  function createClient(options = {}) {
    const pending = [], handledClicks = new WeakSet(); let attributionId = '';
    function payload(eventType, details) { return {eventId:options.crypto.randomUUID(),attributionId,chatSessionId:options.getChatSessionId(),eventType,route:text(details.route),intent:text(details.intent),canonicalProductId:text(details.canonicalProductId),unasProductId:text(details.unasProductId),sku:text(details.sku),recommendationType:text(details.recommendationType),recommendationRank:Number.isInteger(details.recommendationRank)?details.recommendationRank:null,occurredAt:new Date().toISOString(),schemaVersion:1}; }
    function dispatch(eventType, details = {}) {
      if (!UUID_V4_RE.test(attributionId)) { if(pending.length<20)pending.push([eventType,details]);if(typeof options.requestAttribution==='function')options.requestAttribution();return false; }
      options.fetch('/api/commerce/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload(eventType,details)),keepalive:true}).catch(()=>{});return true;
    }
    return {send:dispatch,productClick(event,details){if(event&&typeof event==='object'){if(handledClicks.has(event))return false;handledClicks.add(event);}return dispatch('product_clicked',details);},setAttributionId(value){if(!UUID_V4_RE.test(value||''))return false;attributionId=value;pending.splice(0).forEach(([type,details])=>dispatch(type,details));return true;}};
  }
  return { createClient };
});
