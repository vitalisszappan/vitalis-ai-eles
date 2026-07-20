const messagesEl = document.getElementById('messages');
const form = document.getElementById('form');
const input = document.getElementById('input');
const send = document.getElementById('send');
const typing = document.getElementById('typing');
const suggestionsEl = document.getElementById('suggestions');
const history = [];
const sessionId = (() => {
  try {
    const key = 'vitalis-chat-session-id';
    let value = localStorage.getItem(key);
    if (!value) {
      value = (crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      localStorage.setItem(key, value);
    }
    return value;
  } catch {
    return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
})();
let pending = false;

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
    link.href = match[0];
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Termék megtekintése';
    container.append(link);
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
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function normalizeProduct(item, index) {
  if (!item || typeof item !== 'object') return null;
  const name = safeText(item.name) || safeText(item.title) || safeText(item.label) || 'Vitalis termék';
  return {
    id: safeText(item.id, `product-${index + 1}`),
    name,
    description: safeText(item.description),
    url: safeProductUrl(item.url),
    image: safeText(item.image),
    recommendationType: item.recommendationType === 'secondary' ? 'secondary' : (index === 0 ? 'primary' : 'secondary')
  };
}

function addProductCards(article, links = []) {
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

  for (const item of validItems.slice(0, 3)) {
    const hasUrl = Boolean(item.url);
    const card = document.createElement(hasUrl ? 'a' : 'div');
    card.className = `product-card ${item.recommendationType === 'primary' ? 'is-primary' : 'is-secondary'}`;

    if (hasUrl) {
      card.href = item.url;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
    } else {
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', item.name);
    }

    const badgeText = item.recommendationType === 'primary' ? 'Elsődleges ajánlás' : 'Kiegészítő lehetőség';
    const media = item.image
      ? `<img class="product-image" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">`
      : `<span class="product-mark" aria-hidden="true">V</span>`;

    card.innerHTML = `
      ${media}
      <span class="product-content">
        <span class="product-badge">${badgeText}</span>
        <strong>${escapeHtml(item.name)}</strong>
        ${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}
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
  if (role === 'bot') addProductCards(article, options.links);
  messagesEl.appendChild(article);
  scrollToBottom();
  history.push({ role: role === 'user' ? 'user' : 'assistant', content: text });
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
  add(q, 'user');
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
    add(data.answer || 'Nem érkezett válasz.', 'bot', { links: data.links });
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
  window.parent.postMessage({ type: 'vitalis-chat-close' }, '*');
});

window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'vitalis-chat-focus') {
    setTimeout(() => input.focus(), 80);
  }
});

autoResize();
