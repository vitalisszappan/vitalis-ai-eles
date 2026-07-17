'use strict';

/* =========================================================
   VITALIS AI KÖZPONT – ADMIN.JS
========================================================= */

const totalCountElement =
  document.getElementById('totalCount');

const todayCountElement =
  document.getElementById('todayCount');

const visibleCountElement =
  document.getElementById('visibleCount');

const searchInput =
  document.getElementById('searchInput');

const statusMessage =
  document.getElementById('statusMessage');

const conversationList =
  document.getElementById('conversationList');

const refreshButton =
  document.getElementById('refreshButton');

const unasTestButton =
  document.getElementById('unasTestButton');

const unasTestButtonSecondary =
  document.getElementById('unasTestButtonSecondary');

const unasStatusMessage =
  document.getElementById('unasStatusMessage');


/* =========================================================
   ÁLLAPOT
========================================================= */

let conversations = [];
let adminToken = '';


/* =========================================================
   ADMIN KULCS
========================================================= */

function getStoredAdminToken() {
  return (
    localStorage.getItem(
      'vitalisAdminToken'
    ) || ''
  ).trim();
}


function saveAdminToken(token) {
  localStorage.setItem(
    'vitalisAdminToken',
    String(token || '').trim()
  );
}


function clearAdminToken() {
  localStorage.removeItem(
    'vitalisAdminToken'
  );

  adminToken = '';
}


function ensureAdminToken() {
  adminToken =
    getStoredAdminToken();

  if (adminToken) {
    return true;
  }

  const entered =
    window.prompt(
      'Add meg a Vitalis AI admin kulcsot:'
    );

  if (!entered) {
    return false;
  }

  adminToken =
    String(entered)
      .trim();

  if (!adminToken) {
    return false;
  }

  saveAdminToken(
    adminToken
  );

  return true;
}


/* =========================================================
   SEGÉDFÜGGVÉNYEK
========================================================= */

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


function formatDate(value) {
  if (!value) {
    return '';
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return String(value);
  }

  return date.toLocaleString(
    'hu-HU',
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }
  );
}


function isToday(value) {
  if (!value) {
    return false;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return false;
  }

  const now =
    new Date();

  return (
    date.getFullYear() ===
      now.getFullYear() &&
    date.getMonth() ===
      now.getMonth() &&
    date.getDate() ===
      now.getDate()
  );
}


function getQuestion(item) {
  return String(
    item.question ||
    item.user_message ||
    item.userMessage ||
    item.message ||
    ''
  ).trim();
}


function getAnswer(item) {
  return String(
    item.answer ||
    item.bot_answer ||
    item.botAnswer ||
    item.response ||
    ''
  ).trim();
}


function getCreatedAt(item) {
  return (
    item.created_at ||
    item.createdAt ||
    item.timestamp ||
    item.date ||
    ''
  );
}


function getPageUrl(item) {
  return String(
    item.page_url ||
    item.pageUrl ||
    item.url ||
    ''
  ).trim();
}


/* =========================================================
   STATISZTIKÁK
========================================================= */

function updateStatistics(
  visibleItems
) {
  const todayCount =
    conversations.filter(
      (item) =>
        isToday(
          getCreatedAt(item)
        )
    ).length;

  if (totalCountElement) {
    totalCountElement.textContent =
      String(
        conversations.length
      );
  }

  if (todayCountElement) {
    todayCountElement.textContent =
      String(todayCount);
  }

  if (visibleCountElement) {
    visibleCountElement.textContent =
      String(
        visibleItems.length
      );
  }
}


/* =========================================================
   BESZÉLGETÉSEK MEGJELENÍTÉSE
========================================================= */

function renderConversations(items) {
  if (!conversationList) {
    return;
  }

  conversationList.innerHTML = '';

  updateStatistics(items);

  if (!items.length) {
    conversationList.innerHTML = `
      <div class="status">
        Nincs megjeleníthető beszélgetés.
      </div>
    `;

    return;
  }

  for (const item of items) {
    const question =
      getQuestion(item);

    const answer =
      getAnswer(item);

    const createdAt =
      getCreatedAt(item);

    const pageUrl =
      getPageUrl(item);

    const source =
      String(
        item.source ||
        'ismeretlen'
      );

    const confidence =
      item.confidence !== null &&
      item.confidence !== undefined
        ? String(
            item.confidence
          )
        : '–';

    const article =
      document.createElement(
        'article'
      );

    article.className =
      'conversation-card';

    article.innerHTML = `
      <div class="conversation-meta">

        <span>
          ${escapeHtml(
            formatDate(
              createdAt
            )
          )}
        </span>

        ${
          pageUrl
            ? `
              <span>
                ${escapeHtml(pageUrl)}
              </span>
            `
            : ''
        }

      </div>

      <div class="conversation-question">

        <strong>
          VÁSÁRLÓ KÉRDÉSE
        </strong>

        <p>
          ${escapeHtml(
            question || '–'
          )}
        </p>

      </div>

      <div class="conversation-answer">

        <strong>
          CHATBOT VÁLASZA
        </strong>

        <p>
          ${escapeHtml(
            answer || '–'
          )}
        </p>

      </div>

      <div class="conversation-meta">

        <span>
          Forrás:
          ${escapeHtml(source)}
        </span>

        <span>
          Biztonsági pontszám:
          ${escapeHtml(confidence)}
        </span>

      </div>
    `;

    conversationList.appendChild(
      article
    );
  }
}


/* =========================================================
   BESZÉLGETÉSEK BETÖLTÉSE
========================================================= */

async function loadConversations() {
  if (!ensureAdminToken()) {
    if (statusMessage) {
      statusMessage.textContent =
        'Admin kulcs nélkül a beszélgetések nem tölthetők be.';
    }

    return;
  }

  if (statusMessage) {
    statusMessage.textContent =
      'Beszélgetések betöltése...';
  }

  try {
    const response =
      await fetch(
        '/api/admin/conversations?limit=500',
        {
          headers: {
            'X-Admin-Token':
              adminToken
          },

          cache:
            'no-store'
        }
      );

    const data =
      await response.json();

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      clearAdminToken();

      throw new Error(
        'Hibás admin kulcs. Frissítsd az oldalt, és add meg újra.'
      );
    }

    if (
      !response.ok ||
      data.ok === false
    ) {
      throw new Error(
        data.error ||
        'A beszélgetések betöltése sikertelen.'
      );
    }

    conversations =
      Array.isArray(
        data.items
      )
        ? data.items
        : [];

    renderConversations(
      conversations
    );

    if (statusMessage) {
      statusMessage.textContent =
        `Betöltve: ${conversations.length} beszélgetés. Forrás: ${
          data.storage ||
          'ismeretlen'
        }.`;
    }

  } catch (error) {
    console.error(
      'Beszélgetések betöltési hiba:',
      error
    );

    if (statusMessage) {
      statusMessage.textContent =
        `Hiba a beszélgetések betöltésekor: ${error.message}`;
    }

    updateStatistics([]);
  }
}


/* =========================================================
   KERESÉS
========================================================= */

function filterConversations() {
  const query =
    String(
      searchInput?.value || ''
    )
      .trim()
      .toLowerCase();

  if (!query) {
    renderConversations(
      conversations
    );

    return;
  }

  const filtered =
    conversations.filter(
      (item) => {
        const searchableText = [
          getQuestion(item),
          getAnswer(item),
          getPageUrl(item),
          item.source
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return searchableText.includes(
          query
        );
      }
    );

  renderConversations(
    filtered
  );
}


/* =========================================================
   UNAS KAPCSOLAT TESZTELÉSE
========================================================= */

async function testUnasConnection() {
  if (!ensureAdminToken()) {
    if (unasStatusMessage) {
      unasStatusMessage.textContent =
        'Az UNAS teszt megszakadt: nincs megadva admin kulcs.';
    }

    return;
  }

  if (unasStatusMessage) {
    unasStatusMessage.textContent =
      'UNAS kapcsolat ellenőrzése folyamatban...';
  }

  if (unasTestButton) {
    unasTestButton.disabled =
      true;
  }

  if (unasTestButtonSecondary) {
    unasTestButtonSecondary.disabled =
      true;
  }

  try {
    const response =
      await fetch(
        '/api/admin/unas/test',
        {
          method: 'GET',

          headers: {
            'X-Admin-Token':
              adminToken
          },

          cache:
            'no-store'
        }
      );

    const data =
      await response.json();

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      clearAdminToken();

      throw new Error(
        'Hibás admin kulcs. Frissítsd az oldalt, és add meg újra.'
      );
    }

    if (
      !response.ok ||
      data.ok === false
    ) {
      throw new Error(
        data.error ||
        data.message ||
        'Az UNAS kapcsolat tesztelése sikertelen.'
      );
    }

    if (unasStatusMessage) {
      unasStatusMessage.textContent =
        data.message ||
        `Az UNAS API kapcsolat működik. Termékek: ${
          data.products ?? '–'
        }, kategóriák: ${
          data.categories ?? '–'
        }. Válaszidő: ${
          data.responseMs ?? '–'
        } ms.`;
    }

  } catch (error) {
    console.error(
      'UNAS kapcsolat tesztelési hiba:',
      error
    );

    if (unasStatusMessage) {
      unasStatusMessage.textContent =
        `UNAS kapcsolati hiba: ${error.message}`;
    }

  } finally {
    if (unasTestButton) {
      unasTestButton.disabled =
        false;
    }

    if (unasTestButtonSecondary) {
      unasTestButtonSecondary.disabled =
        false;
    }
  }
}


/* =========================================================
   ESEMÉNYKEZELŐK
========================================================= */

if (searchInput) {
  searchInput.addEventListener(
    'input',
    filterConversations
  );
}


if (refreshButton) {
  refreshButton.addEventListener(
    'click',
    loadConversations
  );
}


if (unasTestButton) {
  unasTestButton.addEventListener(
    'click',
    testUnasConnection
  );
}


if (unasTestButtonSecondary) {
  unasTestButtonSecondary.addEventListener(
    'click',
    testUnasConnection
  );
}


/* =========================================================
   INDÍTÁS
========================================================= */

loadConversations();
