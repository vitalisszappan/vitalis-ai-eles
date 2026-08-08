const messagesEl = document.getElementById('messages');
const form = document.getElementById('form');
const input = document.getElementById('input');
const send = document.getElementById('send');
const typing = document.getElementById('typing');
const suggestionsEl = document.getElementById('suggestions');
const restoreNotice = document.getElementById('restore-notice');
const history = [];
const STORAGE_KEY = 'vitalis-chat-state/v2';
const STATE_VERSION = 2;
const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STORED_MESSAGES = 40;
const parentOrigin = (() => {
  try { return document.referrer ? new URL(document.referrer).origin : ''; } catch { return ''; }
})();
let sessionId = createSessionId();
let storedMessages = [];
let stateReady = false;
let pending = false;
let attributionId = '';
const pendingCommerceEvents = [];

function createSessionId() {
  return crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeState(value) {
  if (!value || typeof value !== 'object' || value.version !== STATE_VERSION) return null;
  if (!Number.isFinite(value.updatedAt) || Date.now() - value.updatedAt > STATE_TTL_MS) return null;
  if (typeof value.sessionId !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(value.sessionId)) return null;
  if (!Array.isArray(value.messages)) return null;
  const messages = value.messages.slice(-MAX_STORED_MESSAGES).filter((item) =>
    item && (item.role === 'user' || item.role === 'bot') && typeof item.content === 'string' && item.content.length <= 5000
  ).map((item) => ({
    role: item.role,
    content: item.content,
    links: Array.isArray(item.links) ? item.links.slice(0, 3).map(normalizeProduct).filter(Boolean) : [],
    route: safeText(item.route),
    intent: safeText(item.intent),
    domain: safeText(item.domain),
    responseType: safeText(item.responseType)
  }));
  return { version: STATE_VERSION, updatedAt: value.updatedAt, sessionId: value.sessionId, messages };
}

function readFallbackState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = normalizeState(JSON.parse(raw));
    if (!state) localStorage.removeItem(STORAGE_KEY);
    return state;
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    return null;
  }
}

function currentState() {
  return { version: STATE_VERSION, updatedAt: Date.now(), sessionId, messages: storedMessages.slice(-MAX_STORED_MESSAGES) };
}

function persistState() {
  const state = currentState();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  if (parentOrigin && window.parent !== window) {
    window.parent.postMessage({ type: 'vitalis-chat-state-save', state }, parentOrigin);
  }
}

function restoreState(value) {
  const state = normalizeState(value);
  if (!state) return false;
  sessionId = state.sessionId;
  storedMessages = [];
  history.length = 0;
  messagesEl.querySelectorAll('.bubble:not(.welcome)').forEach((item) => item.remove());
  for (const item of state.messages) add(item.content, item.role, {
    links: item.links,
    route: item.route,
    intent: item.intent,
    domain: item.domain,
    responseType: item.responseType,
    persist: false
  });
  stateReady = true;
  return true;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addTextWithLinks(container, text) {
  const regex = /(https?:\/\/[^\s]+)/g;
  let last = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    container.append(document.createTextNode(text.slice(last, match.index)));
    const link = document.createElement('a');
    const safeUrl = safeProductUrl(match[0]);
    if (safeUrl) {
      link.href = safeUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Termék megtekintése';
      container.append(link);
    } else {
      container.append(document.createTextNode(match[0]));
    }
    last = regex.lastIndex;
  }
  container.append(document.createTextNode(text.slice(last)));
}

function safeText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  if (!text || /^(undefined|null)$/i.test(text)) return fallback;
  return text;
}

function safeProductUrl(value) {
  const text = safeText(value);
  if (!text) return '';

  try {
    const url = new URL(text, window.location.href);
    const host = url.hostname.toLowerCase();
    const approvedHost = host === 'vitalis-szappan.hu' || host.endsWith('.vitalis-szappan.hu');
    return url.protocol === 'https:' && approvedHost ? url.href : '';
  } catch {
    return '';
  }
}

function safeProductPrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function formatProductPrice(price) {
  if (price === null) return '';
  const amount = String(Math.round(price)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${amount} Ft`;
}

function normalizeProduct(item, index) {
  if (!item || typeof item !== 'object') return null;
  const name = safeText(item.name) || safeText(item.title) || safeText(item.label) || 'Vitalis termék';
  return {
    id: safeText(item.id, `product-${index + 1}`),
    canonicalProductId: safeText(item.canonicalProductId, safeText(item.id)),
    unasProductId: safeText(item.unasProductId, safeText(item.commerce?.unasId)),
    sku: safeText(item.sku, safeText(item.commerce?.sku)),
    name,
    description: safeText(item.description),
    url: safeProductUrl(item.url),
    image: safeText(item.image),
    price: safeProductPrice(item.price),
    currency: safeText(item.currency),
    recommendationType: item.recommendationType === 'related'
      ? 'related'
      : item.recommendationType === 'secondary' ? 'secondary' : (index === 0 ? 'primary' : 'secondary'),
    recommendationLabel: safeText(item.recommendationLabel),
    reason: safeText(item.reason)
  };
}

function sendCommerceEvent(eventType, details = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attributionId)) {
    if (pendingCommerceEvents.length < 20) pendingCommerceEvents.push([eventType, details]);
    return;
  }
  const payload = {
    eventId: crypto.randomUUID(), attributionId, chatSessionId: sessionId,
    eventType, route: safeText(details.route) || null, intent: safeText(details.intent) || null,
    canonicalProductId: safeText(details.canonicalProductId) || null,
    unasProductId: safeText(details.unasProductId) || null, sku: safeText(details.sku) || null,
    recommendationType: safeText(details.recommendationType) || null,
    recommendationRank: Number.isInteger(details.recommendationRank) ? details.recommendationRank : null,
    occurredAt: new Date().toISOString(), schemaVersion: 1
  };
  fetch('/api/commerce/event', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), keepalive: true
  }).catch(() => {});
}

function addProductCards(article, links = [], context = {}) {
  if (!Array.isArray(links) || !links.length) return;

  const validItems = links.map(normalizeProduct).filter(Boolean);
  if (!validItems.length) return;

  const section = document.createElement('section');
  section.className = 'product-section';

  const heading = document.createElement('div');
  heading.className = 'product-section-title';
  heading.textContent = validItems.length > 1 ? 'Ajánlott termékek' : 'Ajánlott termék';
  section.append(heading);

  const cards = document.createElement('div');
  cards.className = 'product-cards';

  for (const [index, item] of validItems.slice(0, 3).entries()) {
    const hasUrl = Boolean(item.url);
    const card = document.createElement(hasUrl ? 'a' : 'div');
    card.className = `product-card ${item.recommendationType === 'primary' ? 'is-primary' : item.recommendationType === 'related' ? 'is-related' : 'is-secondary'}`;

    if (hasUrl) {
      card.href = item.url;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.addEventListener('click', () => sendCommerceEvent('product_clicked', {
        ...context, ...item, recommendationRank: index + 1
      }));
    } else {
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', item.name);
    }

    const badgeText = item.recommendationLabel || (item.recommendationType === 'primary'
      ? 'Vitalis ajánlása'
      : item.recommendationType === 'related' ? 'Kapcsolódó termék' : 'Alternatíva');
    const media = item.image
      ? `<img class="product-image" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">`
      : `<span class="product-mark" aria-hidden="true">V</span>`;
    const priceText = formatProductPrice(item.price);

    card.innerHTML = `
      ${media}
      <span class="product-content">
        <span class="product-badge">${badgeText}</span>
        <strong>${escapeHtml(item.name)}</strong>
        ${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}
        ${item.reason ? `<small class="product-reason"><b>Miért ezt?</b> ${escapeHtml(item.reason)}</small>` : ''}
        ${priceText ? `<small class="product-price">Ár: ${escapeHtml(priceText)}</small>` : ''}
        ${hasUrl
          ? '<small class="product-open">Termékoldal megnyitása →</small>'
          : '<small class="product-unavailable">A termékoldal linkje hamarosan elérhető.</small>'}
      </span>`;

    cards.append(card);
  }

  section.append(cards);
  article.append(section);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function add(text, role, options = {}) {
  const article = document.createElement('article');
  article.className = `bubble ${role}`;
  addTextWithLinks(article, text);
  if (role === 'bot') addProductCards(article, options.links, options);
  messagesEl.appendChild(article);
  scrollToBottom();
  history.push({
    role: role === 'user' ? 'user' : 'assistant',
    content: text,
    ...(role === 'bot' ? {
      route: safeText(options.route),
      intent: safeText(options.intent),
      domain: safeText(options.domain),
      responseType: safeText(options.responseType, options.route)
    } : {})
  });
  storedMessages.push({
    role: role === 'user' ? 'user' : 'bot',
    content: String(text),
    links: Array.isArray(options.links) ? options.links.map(normalizeProduct).filter(Boolean).slice(0, 3) : [],
    route: safeText(options.route),
    intent: safeText(options.intent),
    domain: safeText(options.domain),
    responseType: safeText(options.responseType, options.route)
  });
  storedMessages = storedMessages.slice(-MAX_STORED_MESSAGES);
  if (options.persist !== false) persistState();
}

function setSuggestions(items) {
  suggestionsEl.replaceChildren();

  if (
    !Array.isArray(items) ||
    !items.length
  ) {
    return;
  }

  for (
    const item of
    items.slice(0, 7)
  ) {

    let label = '';
    let question = '';

    /*
      Egyszerű szöveges javaslat:
      "PsoriVital csomag"
    */

    if (
      typeof item === 'string'
    ) {
      label =
        safeText(item);

      question =
        label;
    }

    /*
      Objektum formátum:
      {
        label: "...",
        question: "..."
      }
    */

    if (
      item &&
      typeof item === 'object'
    ) {
      label =
        safeText(
          item.label
        ) ||
        safeText(
          item.question
        );

      question =
        safeText(
          item.question
        ) ||
        safeText(
          item.label
        );
    }

    /*
      Hibás vagy üres javaslatot
      nem jelenítünk meg.
    */

    if (
      !label ||
      !question
    ) {
      continue;
    }

    const button =
      document.createElement(
        'button'
      );

    button.type =
      'button';

    button.textContent =
      label;

    button.dataset.question =
      question;

    button.addEventListener(
      'click',
      () => {

        const value =
          safeText(
            button.dataset.question
          );

        if (
          value
        ) {
          ask(
            value
          );
        }
      }
    );

    suggestionsEl.append(
      button
    );
  }
}

function setPending(value) {
  pending = value;
  input.disabled = value;
  send.disabled = value;
  typing.hidden = !value;
  if (value) scrollToBottom();
}

function autoResize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
}

async function ask(question) {
  const q = String(question || '').trim();
  if (!q || pending) return;

  const priorHistory = history.slice(-10);
  const isFirstQuestion = !history.some((item) => item.role === 'user');
  add(q, 'user');
  if (isFirstQuestion) sendCommerceEvent('chat_started');
  input.value = '';
  autoResize();
  setPending(true);

  try {
    const started = Date.now();
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: q, history: priorHistory, sessionId, pageUrl: document.referrer || window.location.href })
    });
    const data = await response.json();
    const minimumWait = 550;
    const remaining = minimumWait - (Date.now() - started);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    add(data.answer || 'Nem érkezett válasz.', 'bot', {
      links: data.links,
      route: data.route,
      intent: data.intent,
      domain: data.domain,
      responseType: data.responseSource || data.route
    });
    (Array.isArray(data.links) ? data.links : []).slice(0, 3).forEach((item, index) => {
      const product = normalizeProduct(item, index);
      if (product) sendCommerceEvent('product_recommended', {
        route: data.route, intent: data.intent, ...product, recommendationRank: index + 1
      });
    });
    setSuggestions(data.suggestions);
  } catch (error) {
    add('A chat most nem érhető el. Kérlek, próbáld meg egy kicsit később.', 'bot');
  } finally {
    setPending(false);
    input.focus();
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  ask(input.value);
});

input.addEventListener('input', autoResize);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll('.suggestions button').forEach((button) => {
  button.addEventListener('click', () => ask(button.dataset.question || button.textContent));
});

document.getElementById('minimize').addEventListener('click', () => {
  if (parentOrigin) window.parent.postMessage({ type: 'vitalis-chat-close' }, parentOrigin);
});

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || (parentOrigin && event.origin !== parentOrigin) || !event.data) return;
  if (event.data.type === 'vitalis-chat-focus') {
    sendCommerceEvent('chat_open');
    setTimeout(() => input.focus(), 80);
  }
  if (event.data.type === 'vitalis-chat-state') {
    if (!restoreState(event.data.state) && !stateReady) {
      const fallback = readFallbackState();
      if (fallback) restoreState(fallback);
      else stateReady = true;
    }
    if (event.data.restoreFailed) restoreNotice.hidden = false;
  }
  if (event.data.type === 'vitalis-chat-attribution' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.data.attributionId || '')) {
    attributionId = event.data.attributionId;
    pendingCommerceEvents.splice(0).forEach(([eventType, details]) => sendCommerceEvent(eventType, details));
  }
});

document.getElementById('new-conversation').addEventListener('click', () => {
  if (!window.confirm('Biztosan új beszélgetést indítasz? A jelenlegi helyi előzmény törlődik.')) return;
  sessionId = createSessionId();
  storedMessages = [];
  history.length = 0;
  messagesEl.querySelectorAll('.bubble:not(.welcome)').forEach((item) => item.remove());
  suggestionsEl.replaceChildren();
  restoreNotice.hidden = true;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  if (parentOrigin) window.parent.postMessage({ type: 'vitalis-chat-state-clear' }, parentOrigin);
  persistState();
  input.focus();
});

const fallbackState = readFallbackState();
if (fallbackState) restoreState(fallbackState);
if (parentOrigin && window.parent !== window) {
  window.parent.postMessage({ type: 'vitalis-chat-state-ready' }, parentOrigin);
} else {
  stateReady = true;
}

autoResize();
