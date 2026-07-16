const API_URL = '/api/admin/conversations?limit=500';

const refreshButton = document.getElementById('refreshButton');
const searchInput = document.getElementById('searchInput');
const statusMessage = document.getElementById('statusMessage');
const conversationList = document.getElementById('conversationList');

const totalCount = document.getElementById('totalCount');
const todayCount = document.getElementById('todayCount');
const visibleCount = document.getElementById('visibleCount');

let conversations = [];
let adminToken = '';

function getStoredToken() {
  return localStorage.getItem('vitalisAdminToken') || '';
}

function saveToken(token) {
  localStorage.setItem('vitalisAdminToken', token);
}

function ensureAdminToken() {
  adminToken = getStoredToken();

  if (adminToken) {
    return true;
  }

  const entered = window.prompt(
    'Add meg a Vitalis admin kulcsot:'
  );

  if (!entered) {
    showError('Admin kulcs nélkül a beszélgetések nem tölthetők be.');
    return false;
  }

  adminToken = entered.trim();
  saveToken(adminToken);

  return true;
}

function showStatus(message) {
  statusMessage.textContent = message;
  statusMessage.classList.remove('error');
}

function showError(message) {
  statusMessage.textContent = message;
  statusMessage.classList.add('error');
}

function formatDate(value) {
  if (!value) {
    return 'Ismeretlen időpont';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('hu-HU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function isToday(value) {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function createConversationCard(item) {
  const pageText = item.page_url
    ? escapeHtml(item.page_url)
    : 'Oldal nem rögzítve';

  return `
    <article class="conversation-card">
      <div class="conversation-header">
        <div class="conversation-date">
          ${escapeHtml(formatDate(item.created_at))}
        </div>

        <div class="conversation-page">
          ${pageText}
        </div>
      </div>

      <div class="conversation-body">
        <div class="message-block question">
          <span class="message-label">Vásárló kérdése</span>
          <p class="message-text">
            ${escapeHtml(item.question || 'Nincs kérdés rögzítve.')}
          </p>
        </div>

        <div class="message-block answer">
          <span class="message-label">Chatbot válasza</span>
          <p class="message-text">
            ${escapeHtml(item.answer || 'Nincs válasz rögzítve.')}
          </p>
        </div>
      </div>
    </article>
  `;
}

function renderConversations() {
  const searchTerm = searchInput.value
    .trim()
    .toLowerCase();

  const filtered = conversations.filter((item) => {
    if (!searchTerm) {
      return true;
    }

    const haystack = [
      item.question,
      item.answer,
      item.page_url,
      item.source,
      item.session_id
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(searchTerm);
  });

  totalCount.textContent = String(conversations.length);

  todayCount.textContent = String(
    conversations.filter((item) => isToday(item.created_at)).length
  );

  visibleCount.textContent = String(filtered.length);

  if (!filtered.length) {
    conversationList.innerHTML = `
      <div class="empty-state">
        Nincs megjeleníthető beszélgetés.
      </div>
    `;
    return;
  }

  conversationList.innerHTML = filtered
    .map(createConversationCard)
    .join('');
}

async function loadConversations() {
  if (!ensureAdminToken()) {
    return;
  }

  showStatus('Beszélgetések betöltése...');

  try {
    const response = await fetch(API_URL, {
      headers: {
        'X-Admin-Token': adminToken
      },
      cache: 'no-store'
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      if (response.status === 401) {
        localStorage.removeItem('vitalisAdminToken');
        adminToken = '';
        throw new Error(
          'Hibás admin kulcs. Frissítsd az oldalt, és add meg újra.'
        );
      }

      throw new Error(
        data.error || 'Nem sikerült betölteni a beszélgetéseket.'
      );
    }

    conversations = Array.isArray(data.items)
      ? data.items
      : [];

    renderConversations();

    showStatus(
      `Betöltve: ${conversations.length} beszélgetés. Forrás: ${
        data.storage || 'ismeretlen'
      }.`
    );
  } catch (error) {
    console.error(error);
    showError(error.message);
  }
}

refreshButton.addEventListener('click', loadConversations);

searchInput.addEventListener('input', renderConversations);

loadConversations();
