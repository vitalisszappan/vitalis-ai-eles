'use strict';

/* =========================================================
   VITALIS AI KÖZPONT – ADMIN.JS
========================================================= */

/* =========================================================
   DOM ELEMEK
========================================================= */

const totalCountElement =
  document.getElementById(
    'totalCount'
  );

const todayCountElement =
  document.getElementById(
    'todayCount'
  );

const visibleCountElement =
  document.getElementById(
    'visibleCount'
  );

const knowledgeGapCountElement =
  document.getElementById(
    'knowledgeGapCount'
  );

const searchInput =
  document.getElementById(
    'searchInput'
  );

const statusMessage =
  document.getElementById(
    'statusMessage'
  );

const conversationList =
  document.getElementById(
    'conversationList'
  );

const refreshButton =
  document.getElementById(
    'refreshButton'
  );

/* -------------------------
   TUDÁSHIÁNYOK
------------------------- */

const loadKnowledgeGapsButton =
  document.getElementById(
    'loadKnowledgeGapsButton'
  );

const loadKnowledgeGapsButtonSecondary =
  document.getElementById(
    'loadKnowledgeGapsButtonSecondary'
  );

const knowledgeGapStatusMessage =
  document.getElementById(
    'knowledgeGapStatusMessage'
  );

const knowledgeGapList =
  document.getElementById(
    'knowledgeGapList'
  );

/* -------------------------
   UNAS
------------------------- */

const unasTestButton =
  document.getElementById(
    'unasTestButton'
  );

const unasTestButtonSecondary =
  document.getElementById(
    'unasTestButtonSecondary'
  );

const unasStatusMessage =
  document.getElementById(
    'unasStatusMessage'
  );

const unasSyncButton =
  document.getElementById(
    'unasSyncButton'
  );

const unasSyncButtonSecondary =
  document.getElementById(
    'unasSyncButtonSecondary'
  );

const unasSyncStatusMessage =
  document.getElementById(
    'unasSyncStatusMessage'
  );

/* =========================================================
   ÁLLAPOT
========================================================= */

let conversations = [];

let knowledgeGaps = [];

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

function saveAdminToken(
  token
) {
  localStorage.setItem(
    'vitalisAdminToken',
    String(
      token || ''
    ).trim()
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

  if (
    adminToken
  ) {
    return true;
  }

  const entered =
    window.prompt(
      'Add meg a Vitalis AI admin kulcsot:'
    );

  if (
    !entered
  ) {
    return false;
  }

  adminToken =
    String(
      entered
    ).trim();

  if (
    !adminToken
  ) {
    return false;
  }

  saveAdminToken(
    adminToken
  );

  return true;
}

/* =========================================================
   KÖZÖS API KEZELÉS
========================================================= */

async function adminFetch(
  url,
  options = {}
) {
  if (
    !ensureAdminToken()
  ) {
    throw new Error(
      'Admin kulcs szükséges.'
    );
  }

  const headers = {
    ...(options.headers || {}),

    'X-Admin-Token':
      adminToken
  };

  const response =
    await fetch(
      url,
      {
        ...options,

        headers,

        cache:
          'no-store'
      }
    );

  let data;

  try {
    data =
      await response.json();

  } catch {
    throw new Error(
      'A szerver nem érvényes JSON választ adott.'
    );
  }

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
      'A kérés sikertelen.'
    );
  }

  return data;
}

/* =========================================================
   SEGÉDFÜGGVÉNYEK
========================================================= */

function escapeHtml(
  value = ''
) {
  return String(
    value
  )
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&#039;'
    );
}

function formatDate(
  value
) {
  if (
    !value
  ) {
    return '';
  }

  const date =
    new Date(
      value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return String(
      value
    );
  }

  return date.toLocaleString(
    'hu-HU',
    {
      year:
        'numeric',

      month:
        '2-digit',

      day:
        '2-digit',

      hour:
        '2-digit',

      minute:
        '2-digit'
    }
  );
}

function isToday(
  value
) {
  if (
    !value
  ) {
    return false;
  }

  const date =
    new Date(
      value
    );

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

function getQuestion(
  item
) {
  return String(
    item.question ||
    item.user_message ||
    item.userMessage ||
    item.message ||
    ''
  ).trim();
}

function getAnswer(
  item
) {
  return String(
    item.answer ||
    item.bot_answer ||
    item.botAnswer ||
    item.response ||
    ''
  ).trim();
}

function getCreatedAt(
  item
) {
  return (
    item.created_at ||
    item.createdAt ||
    item.timestamp ||
    item.date ||
    ''
  );
}

function getPageUrl(
  item
) {
  return String(
    item.page_url ||
    item.pageUrl ||
    item.url ||
    ''
  ).trim();
}

function setStatus(
  element,
  message,
  isError = false
) {
  if (
    !element
  ) {
    return;
  }

  element.textContent =
    message;

  element.classList.toggle(
    'error',
    Boolean(
      isError
    )
  );
}

/* =========================================================
   TUDÁSHIÁNY SEGÉDFÜGGVÉNYEK
========================================================= */

function getKnowledgeGapQuestion(
  item
) {
  const question =
    String(
      item?.question ||
      item?.user_message ||
      item?.userMessage ||
      item?.message ||
      ''
    ).trim();

  if (
    !question ||
    /^(undefined|null)$/i.test(
      question
    )
  ) {
    return '';
  }

  return question;
}

function isValidKnowledgeGap(
  item
) {
  return Boolean(
    getKnowledgeGapQuestion(
      item
    )
  );
}

/* =========================================================
   STATISZTIKÁK
========================================================= */

function updateConversationStatistics(
  visibleItems
) {
  const todayCount =
    conversations.filter(
      (
        item
      ) =>
        isToday(
          getCreatedAt(
            item
          )
        )
    ).length;

  if (
    totalCountElement
  ) {
    totalCountElement.textContent =
      String(
        conversations.length
      );
  }

  if (
    todayCountElement
  ) {
    todayCountElement.textContent =
      String(
        todayCount
      );
  }

  if (
    visibleCountElement
  ) {
    visibleCountElement.textContent =
      String(
        visibleItems.length
      );
  }
}

function updateKnowledgeGapCount() {
  if (
    knowledgeGapCountElement
  ) {
    knowledgeGapCountElement.textContent =
      String(
        knowledgeGaps.length
      );
  }
}

/* =========================================================
   BESZÉLGETÉSEK MEGJELENÍTÉSE
========================================================= */

function renderConversations(
  items
) {
  if (
    !conversationList
  ) {
    return;
  }

  conversationList.innerHTML =
    '';

  updateConversationStatistics(
    items
  );

  if (
    !items.length
  ) {
    conversationList.innerHTML = `
      <div class="empty-state">
        Nincs megjeleníthető beszélgetés.
      </div>
    `;

    return;
  }

  for (
    const item of
    items
  ) {
    const question =
      getQuestion(
        item
      );

    const answer =
      getAnswer(
        item
      );

    const createdAt =
      getCreatedAt(
        item
      );

    const pageUrl =
      getPageUrl(
        item
      );

    const source =
      String(
        item.source ||
        'ismeretlen'
      );

    const confidence =
      item.confidence !==
        null &&
      item.confidence !==
        undefined
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
                ${escapeHtml(
                  pageUrl
                )}
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
            question ||
            '–'
          )}
        </p>

      </div>

      <div class="conversation-answer">

        <strong>
          CHATBOT VÁLASZA
        </strong>

        <p>
          ${escapeHtml(
            answer ||
            '–'
          )}
        </p>

      </div>

      <div class="conversation-meta">

        <span>
          Forrás:
          ${escapeHtml(
            source
          )}
        </span>

        <span>
          Biztonsági pontszám:
          ${escapeHtml(
            confidence
          )}
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
  setStatus(
    statusMessage,
    'Beszélgetések betöltése...'
  );

  try {
    const data =
      await adminFetch(
        '/api/admin/conversations?limit=500'
      );

    conversations =
      Array.isArray(
        data.items
      )
        ? data.items
        : [];

    renderConversations(
      conversations
    );

    setStatus(
      statusMessage,
      `Betöltve: ${conversations.length} beszélgetés. Forrás: ${
        data.storage ||
        'ismeretlen'
      }.`
    );

  } catch (
    error
  ) {
    console.error(
      'Beszélgetések betöltési hiba:',
      error
    );

    setStatus(
      statusMessage,
      `Hiba a beszélgetések betöltésekor: ${error.message}`,
      true
    );

    updateConversationStatistics(
      []
    );
  }
}

/* =========================================================
   BESZÉLGETÉSKERESÉS
========================================================= */

function filterConversations() {
  const query =
    String(
      searchInput?.value ||
      ''
    )
      .trim()
      .toLowerCase();

  if (
    !query
  ) {
    renderConversations(
      conversations
    );

    return;
  }

  const filtered =
    conversations.filter(
      (
        item
      ) => {

        const searchableText = [
          getQuestion(
            item
          ),

          getAnswer(
            item
          ),

          getPageUrl(
            item
          ),

          item.source
        ]
          .filter(
            Boolean
          )
          .join(
            ' '
          )
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
   TUDÁSHIÁNY KÁRTYA
========================================================= */

function createKnowledgeGapCard(
  gap,
  index
) {
  const wrapper =
    document.createElement(
      'article'
    );

  wrapper.className =
    'conversation-card knowledge-gap-card';

  const question =
    getKnowledgeGapQuestion(
      gap
    );

  if (
    !question
  ) {
    return document.createDocumentFragment();
  }

  const chatbotAnswer =
    String(
      gap.answer ||
      gap.bot_answer ||
      gap.botAnswer ||
      gap.response ||
      ''
    ).trim();

  const pageUrl =
    String(
      gap.page_url ||
      gap.pageUrl ||
      gap.url ||
      ''
    ).trim();

  const date =
    formatDate(
      gap.created_at ||
      gap.createdAt ||
      gap.timestamp ||
      gap.date
    );

  const score =
    gap.confidence ??
    gap.score ??
    '–';

  wrapper.innerHTML = `
    <div class="conversation-meta">

      <span>
        ${escapeHtml(
          date ||
          'Ismeretlen időpont'
        )}
      </span>

      <span>
        Pontszám:
        ${escapeHtml(
          score
        )}
      </span>

    </div>

    <div class="conversation-question">

      <strong>
        VÁSÁRLÓ KÉRDÉSE
      </strong>

      <p>
        ${escapeHtml(
          question
        )}
      </p>

    </div>

    ${
      chatbotAnswer
        ? `
          <div class="conversation-answer">

            <strong>
              JELENLEGI CHATBOT VÁLASZ
            </strong>

            <p>
              ${escapeHtml(
                chatbotAnswer
              )}
            </p>

          </div>
        `
        : ''
    }

    ${
      pageUrl
        ? `
          <div class="conversation-meta">
            <span>
              Oldal:
              ${escapeHtml(
                pageUrl
              )}
            </span>
          </div>
        `
        : ''
    }

    <div class="knowledge-gap-editor">

      <label
        for="knowledgeGapAnswer-${index}"
      >
        <strong>
          Jóváhagyott Vitalis válasz
        </strong>
      </label>

      <textarea
        id="knowledgeGapAnswer-${index}"
        class="knowledge-gap-answer"
        rows="6"
        placeholder="Írd ide azt a választ, amelyet a chatbotnak a jövőben használnia kell..."
      ></textarea>

      <div class="knowledge-gap-actions">

        <button
          type="button"
          class="approve-knowledge-gap-button"
        >
          Jóváhagyás és aktiválás
        </button>

        <button
          type="button"
          class="dismiss-knowledge-gap-button"
        >
          Lezárás tudáselem nélkül
        </button>

      </div>

      <div
        class="knowledge-gap-item-status"
      >
      </div>

    </div>
  `;

  const approveButton =
    wrapper.querySelector(
      '.approve-knowledge-gap-button'
    );

  const dismissButton =
    wrapper.querySelector(
      '.dismiss-knowledge-gap-button'
    );

  const textarea =
    wrapper.querySelector(
      '.knowledge-gap-answer'
    );

  const itemStatus =
    wrapper.querySelector(
      '.knowledge-gap-item-status'
    );

  approveButton.addEventListener(
    'click',
    async () => {

      const answer =
        String(
          textarea.value ||
          ''
        ).trim();

      if (
        !answer
      ) {
        itemStatus.textContent =
          'Írd be előbb a jóváhagyott választ.';

        return;
      }

      const confirmed =
        window.confirm(
          'Biztosan jóváhagyod és azonnal aktiválod ezt a tudáselemet?'
        );

      if (
        !confirmed
      ) {
        return;
      }

      approveButton.disabled =
        true;

      dismissButton.disabled =
        true;

      textarea.disabled =
        true;

      itemStatus.textContent =
        'Mentés és aktiválás folyamatban...';

      try {
        const data =
          await adminFetch(
            '/api/admin/knowledge-gaps/approve',
            {
              method:
                'POST',

              headers: {
                'Content-Type':
                  'application/json'
              },

              body:
                JSON.stringify({
                  question,

                  answer
                })
            }
          );

        itemStatus.textContent =
          data.message ||
          'A tudáselem jóváhagyva és aktiválva.';

        wrapper.remove();

        knowledgeGaps =
          knowledgeGaps.filter(
            (
              item
            ) =>
              item !==
              gap
          );

        updateKnowledgeGapCount();

      } catch (
        error
      ) {
        console.error(
          'Tudáselem jóváhagyási hiba:',
          error
        );

        itemStatus.textContent =
          `Hiba: ${error.message}`;

        approveButton.disabled =
          false;

        dismissButton.disabled =
          false;

        textarea.disabled =
          false;
      }
    }
  );

  dismissButton.addEventListener(
    'click',
    async () => {

      const confirmed =
        window.confirm(
          'Biztosan lezárod ezt a kérdést új tudáselem létrehozása nélkül?'
        );

      if (
        !confirmed
      ) {
        return;
      }

      approveButton.disabled =
        true;

      dismissButton.disabled =
        true;

      textarea.disabled =
        true;

      itemStatus.textContent =
        'Lezárás folyamatban...';

      try {
        const data =
          await adminFetch(
            '/api/admin/knowledge-gaps/dismiss',
            {
              method:
                'POST',

              headers: {
                'Content-Type':
                  'application/json'
              },

              body:
                JSON.stringify({
                  question,

                  reason:
                    'Admin felületen lezárva.'
                })
            }
          );

        itemStatus.textContent =
          data.message ||
          'A tudáshiány lezárva.';

        wrapper.remove();

        knowledgeGaps =
          knowledgeGaps.filter(
            (
              item
            ) =>
              item !==
              gap
          );

        updateKnowledgeGapCount();

      } catch (
        error
      ) {
        console.error(
          'Tudáshiány lezárási hiba:',
          error
        );

        itemStatus.textContent =
          `Hiba: ${error.message}`;

        approveButton.disabled =
          false;

        dismissButton.disabled =
          false;

        textarea.disabled =
          false;
      }
    }
  );

  return wrapper;
}

/* =========================================================
   TUDÁSHIÁNYOK MEGJELENÍTÉSE
========================================================= */

function renderKnowledgeGaps() {
  if (
    !knowledgeGapList
  ) {
    return;
  }

  knowledgeGapList.innerHTML =
    '';

  updateKnowledgeGapCount();

  if (
    !knowledgeGaps.length
  ) {
    knowledgeGapList.innerHTML = `
      <div class="empty-state">
        Jelenleg nincs nyitott tudáshiány.
      </div>
    `;

    return;
  }

  knowledgeGaps.forEach(
    (
      gap,
      index
    ) => {

      const card =
        createKnowledgeGapCard(
          gap,
          index
        );

      knowledgeGapList.appendChild(
        card
      );
    }
  );
}

/* =========================================================
   TUDÁSHIÁNYOK BETÖLTÉSE
========================================================= */

async function loadKnowledgeGaps() {
  setStatus(
    knowledgeGapStatusMessage,
    'Tudáshiányok betöltése...'
  );

  if (
    loadKnowledgeGapsButton
  ) {
    loadKnowledgeGapsButton.disabled =
      true;
  }

  if (
    loadKnowledgeGapsButtonSecondary
  ) {
    loadKnowledgeGapsButtonSecondary.disabled =
      true;
  }

  try {
    const data =
      await adminFetch(
        '/api/admin/knowledge-gaps?limit=500'
      );

    knowledgeGaps =
      Array.isArray(
        data.items
      )
        ? data.items.filter(
            isValidKnowledgeGap
          )
        : [];

    renderKnowledgeGaps();

    setStatus(
      knowledgeGapStatusMessage,
      `Nyitott tudáshiányok: ${knowledgeGaps.length}. Forrás: ${
        data.storage ||
        'ismeretlen'
      }.`
    );

  } catch (
    error
  ) {
    console.error(
      'Tudáshiányok betöltési hiba:',
      error
    );

    setStatus(
      knowledgeGapStatusMessage,
      `Hiba a tudáshiányok betöltésekor: ${error.message}`,
      true
    );

  } finally {
    if (
      loadKnowledgeGapsButton
    ) {
      loadKnowledgeGapsButton.disabled =
        false;
    }

    if (
      loadKnowledgeGapsButtonSecondary
    ) {
      loadKnowledgeGapsButtonSecondary.disabled =
        false;
    }
  }
}

/* =========================================================
   UNAS KAPCSOLAT TESZTELÉSE
========================================================= */

async function testUnasConnection() {
  setStatus(
    unasStatusMessage,
    'UNAS kapcsolat ellenőrzése folyamatban...'
  );

  if (
    unasTestButton
  ) {
    unasTestButton.disabled =
      true;
  }

  if (
    unasTestButtonSecondary
  ) {
    unasTestButtonSecondary.disabled =
      true;
  }

  try {
    const data =
      await adminFetch(
        '/api/admin/unas/test'
      );

    setStatus(
      unasStatusMessage,
      data.message ||
      `Az UNAS API kapcsolat működik. Termékek: ${
        data.products ??
        '–'
      }, kategóriák: ${
        data.categories ??
        '–'
      }.`
    );

  } catch (
    error
  ) {
    console.error(
      'UNAS kapcsolat tesztelési hiba:',
      error
    );

    setStatus(
      unasStatusMessage,
      `UNAS kapcsolati hiba: ${error.message}`,
      true
    );

  } finally {
    if (
      unasTestButton
    ) {
      unasTestButton.disabled =
        false;
    }

    if (
      unasTestButtonSecondary
    ) {
      unasTestButtonSecondary.disabled =
        false;
    }
  }
}

/* =========================================================
   UNAS TUDÁSSZINKRON
========================================================= */

async function syncUnasKnowledge() {
  if (
    !ensureAdminToken()
  ) {
    return;
  }

  const confirmed =
    window.confirm(
      'Elindítsuk az UNAS termék- és kategóriaadatok szinkronizálását a Vitalis AI tudásbázisába?'
    );

  if (
    !confirmed
  ) {
    return;
  }

  setStatus(
    unasSyncStatusMessage,
    'UNAS tudásszinkron folyamatban... Ez néhány másodpercig tarthat.'
  );

  if (
    unasSyncButton
  ) {
    unasSyncButton.disabled =
      true;
  }

  if (
    unasSyncButtonSecondary
  ) {
    unasSyncButtonSecondary.disabled =
      true;
  }

  try {
    const data =
      await adminFetch(
        '/api/admin/unas/sync',
        {
          method:
            'POST'
        }
      );

    const baseItems =
      data.knowledgeStats?.base ??
      '–';

    const unasItems =
      data.knowledgeStats?.unas ??
      data.unasItems ??
      '–';

    const approvedItems =
      data.knowledgeStats?.approved ??
      0;

    const totalItems =
      data.knowledgeStats?.total ??
      '–';

    setStatus(
      unasSyncStatusMessage,
      `Szinkron sikeres. Alap tudáselemek: ${baseItems}. UNAS tudáselemek: ${unasItems}. Jóváhagyott tudáselemek: ${approvedItems}. Összes aktív tudáselem: ${totalItems}.`
    );

  } catch (
    error
  ) {
    console.error(
      'UNAS tudásszinkron hiba:',
      error
    );

    setStatus(
      unasSyncStatusMessage,
      `UNAS tudásszinkron hiba: ${error.message}`,
      true
    );

  } finally {
    if (
      unasSyncButton
    ) {
      unasSyncButton.disabled =
        false;
    }

    if (
      unasSyncButtonSecondary
    ) {
      unasSyncButtonSecondary.disabled =
        false;
    }
  }
}

/* =========================================================
   TELJES FRISSÍTÉS
========================================================= */

async function refreshEverything() {
  if (
    refreshButton
  ) {
    refreshButton.disabled =
      true;
  }

  try {
    await Promise.all([
      loadConversations(),
      loadKnowledgeGaps()
    ]);

  } finally {
    if (
      refreshButton
    ) {
      refreshButton.disabled =
        false;
    }
  }
}

/* =========================================================
   ESEMÉNYKEZELŐK
========================================================= */

if (
  searchInput
) {
  searchInput.addEventListener(
    'input',
    filterConversations
  );
}

if (
  refreshButton
) {
  refreshButton.addEventListener(
    'click',
    refreshEverything
  );
}

if (
  loadKnowledgeGapsButton
) {
  loadKnowledgeGapsButton.addEventListener(
    'click',
    loadKnowledgeGaps
  );
}

if (
  loadKnowledgeGapsButtonSecondary
) {
  loadKnowledgeGapsButtonSecondary.addEventListener(
    'click',
    loadKnowledgeGaps
  );
}

if (
  unasTestButton
) {
  unasTestButton.addEventListener(
    'click',
    testUnasConnection
  );
}

if (
  unasTestButtonSecondary
) {
  unasTestButtonSecondary.addEventListener(
    'click',
    testUnasConnection
  );
}

if (
  unasSyncButton
) {
  unasSyncButton.addEventListener(
    'click',
    syncUnasKnowledge
  );
}

if (
  unasSyncButtonSecondary
) {
  unasSyncButtonSecondary.addEventListener(
    'click',
    syncUnasKnowledge
  );
}

/* =========================================================
   INDÍTÁS
========================================================= */

refreshEverything();
