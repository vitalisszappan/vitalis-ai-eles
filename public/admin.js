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

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
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

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
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

function updateStatistics(visibleItems) {
  const todayCount =
    conversations.filter((item) =>
      isToday(getCreatedAt(item))
    ).length;

  if (totalCountElement) {
    totalCountElement.textContent =
      String(conversations.length);
  }

  if (todayCountElement) {
    todayCountElement.textContent =
      String(todayCount);
  }

  if (visibleCountElement) {
    visibleCountElement.textContent =
      String(visibleItems.length);
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

    const article =
      document.createElement('article');

    article.className =
      'conversation-card';

    const safePageUrl =
      escapeHtml(pageUrl);

    article.innerHTML = `
      <div class="conversation-meta">

        <span>
          ${escapeHtml(formatDate(createdAt))}
        </span>

        ${
          pageUrl
            ? `
              <span>
                ${safePageUrl}
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
          ${escapeHtml(question || '–')}
        </p>

      </div>

      <div class="conversation-answer">

        <strong>
          CHATBOT VÁLASZA
        </strong>

        <p>
          ${escapeHtml(answer || '–')}
        </p>

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
  if (statusMessage) {
    statusMessage.textContent =
      'Beszélgetések betöltése...';
  }

  try {
    const response =
      await fetch(
        '/api/admin/conversations',
        {
          cache: 'no-store'
        }
      );

    const contentType =
      response.headers.get(
        'content-type'
      ) || '';

    if (
      !contentType.includes(
        'application/json'
      )
    ) {
      throw new Error(
        'A szerver nem JSON választ adott a beszélgetésekhez.'
      );
    }

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
        'A beszélgetések betöltése sikertelen.'
      );
    }

    if (Array.isArray(data)) {
      conversations = data;
    } else if (
      Array.isArray(
        data.conversations
      )
    ) {
      conversations =
        data.conversations;
    } else if (
      Array.isArray(data.items)
    ) {
      conversations =
        data.items;
    } else {
      conversations = [];
    }

    renderConversations(
      conversations
    );

    if (statusMessage) {
      const source =
        data.source ||
        'szerver';

      statusMessage.textContent =
        `Betöltve: ${conversations.length} beszélgetés. Forrás: ${source}.`;
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
          getPageUrl(item)
        ]
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
   ADMIN TOKEN
========================================================= */

function getAdminToken() {
  let token =
    sessionStorage.getItem(
      'vitalis_admin_token'
    );

  if (token) {
    return token;
  }

  token = window.prompt(
    'Add meg a Vitalis AI admin kulcsot:'
  );

  token =
    String(token || '').trim();

  if (token) {
    sessionStorage.setItem(
      'vitalis_admin_token',
      token
    );
  }

  return token;
}


function clearAdminToken() {
  sessionStorage.removeItem(
    'vitalis_admin_token'
  );
}


/* =========================================================
   UNAS KAPCSOLAT TESZTELÉSE
========================================================= */

async function testUnasConnection() {
  const token =
    getAdminToken();

  if (!token) {
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
    unasTestButton.disabled = true;
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
            Authorization:
              `Bearer ${token}`,

            'X-Admin-Token':
              token
          },

          cache: 'no-store'
        }
      );

    const contentType =
      response.headers.get(
        'content-type'
      ) || '';

    let data;

    if (
      contentType.includes(
        'application/json'
      )
    ) {
      data =
        await response.json();
    } else {
      const text =
        await response.text();

      throw new Error(
        text ||
        'A szerver nem JSON választ adott.'
      );
    }

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      clearAdminToken();

      throw new Error(
        'Hibás admin kulcs. A mentett kulcs törölve lett; kattints újra a gombra, és add meg a helyes ADMIN_TOKEN értéket.'
      );
    }

    if (!response.ok || data.ok === false) {
      throw new Error(
        data.error ||
        data.message ||
        'Az UNAS kapcsolat tesztelése sikertelen.'
      );
    }

    if (unasStatusMessage) {
      const productCount =
        data.products ??
        data.productCount ??
        null;

      const responseMs =
        data.responseMs ??
        null;

      let message =
        data.message ||
        'Az UNAS API kapcsolat működik.';

      if (
        productCount !== null &&
        !String(message).includes(
          String(productCount)
        )
      ) {
        message +=
          ` Lekért termékek: ${productCount}.`;
      }

      if (responseMs !== null) {
        message +=
          ` Válaszidő: ${responseMs} ms.`;
      }

      unasStatusMessage.textContent =
        message;
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
      unasTestButton.disabled = false;
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
