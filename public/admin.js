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

let knowledgeTasks = [];
let knowledgeTaskFilter = 'open';
let knowledgeClusters = [];
const knowledgeClusterFilter = { topic:'', priority:'', status:'', safetyLevel:'' };

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
      loadKnowledgeGaps(),
      loadCommerceOutcomes()
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

const knowledgeTaskList = document.getElementById('knowledgeTaskList');
const knowledgeTaskStatus = document.getElementById('knowledgeTaskStatus');
const knowledgeTaskFilters = document.getElementById('knowledgeTaskFilters');
const loadKnowledgeTasksButton = document.getElementById('loadKnowledgeTasksButton');
const exportKnowledgeDraftsButton = document.getElementById('exportKnowledgeDraftsButton');

function renderDraftPanel(panel, task, draft) {
  if (!draft) {
    panel.innerHTML = '<p>Nincs draft ehhez a feladathoz.</p><button class="draft-generate" type="button">Draft létrehozása</button>';
  } else {
    panel.innerHTML = `<div class="draft-grid"><label>Draft típusa<select class="draft-type">${['faq','knowledge','admin_intent','expert_rule_proposal','canonical_proposal','manual_required'].map(value=>`<option ${value===draft.draftType?'selected':''}>${value}</option>`).join('')}</select></label><label>Kategória<input class="draft-category" value="${escapeHtml(draft.category||'egyéb')}"></label><label>Kérdés<textarea class="draft-question">${escapeHtml(draft.question||'')}</textarea></label><label>Javasolt válasz<textarea class="draft-answer">${escapeHtml(draft.answer||'')}</textarea></label><label>Kulcsszavak<input class="draft-keywords" value="${escapeHtml((draft.keywords||[]).join(', '))}"></label><label>Canonical termékek<input class="draft-canonical" value="${escapeHtml((draft.canonicalIds||[]).join(', '))}"></label><label>Bizonyosság<input class="draft-confidence" type="number" min="0" max="100" value="${Number(draft.confidenceScore)||0}"></label><label>Biztonsági státusz<select class="draft-safety">${['safe','caution','manual_required'].map(value=>`<option ${value===draft.safetyStatus?'selected':''}>${value}</option>`).join('')}</select></label></div><div><strong>Draft státusza:</strong> ${escapeHtml(draft.generationStatus)}</div><div><strong>Generálási indok:</strong> ${escapeHtml(draft.generationReason||'')}</div><div class="draft-sources"><strong>Források:</strong> ${escapeHtml(draft.sourceSummary||'Nincs approved tartalmi forrás.')}<br>Beszélgetések: ${escapeHtml((draft.sourceConversationIds||[]).join(', '))}</div><label>Reviewer megjegyzés<textarea class="draft-note">${escapeHtml(draft.reviewerNote||'')}</textarea></label><div class="draft-actions"><button class="draft-regenerate" type="button">Újragenerálás</button><button class="draft-save" type="button">Mentés</button><button data-draft-status="in_review" type="button">Review megnyitása</button><button data-draft-status="approved_for_import" type="button">Jóváhagyás exportra</button><button data-draft-status="rejected" type="button">Elutasítás</button></div>`;
  }
  const generate = panel.querySelector('.draft-generate');
  if (generate) generate.addEventListener('click', async()=>{ try{const data=await adminFetch('/api/admin/knowledge-drafts/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:task.id})});renderDraftPanel(panel,task,data.draft);}catch(error){knowledgeTaskStatus.textContent=`Draft generálási hiba: ${error.message}`;} });
  const regenerate = panel.querySelector('.draft-regenerate');
  if (regenerate) regenerate.addEventListener('click',async()=>{const overwrite=draft.manuallyEdited?window.confirm('A draft kézzel módosult. Biztosan felülírod a generált változattal?'):false;if(draft.manuallyEdited&&!overwrite)return;try{const data=await adminFetch('/api/admin/knowledge-drafts/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:task.id,overwriteEdited:overwrite})});renderDraftPanel(panel,task,data.draft);}catch(error){knowledgeTaskStatus.textContent=`Újragenerálási hiba: ${error.message}`;} });
  const save=panel.querySelector('.draft-save');
  if(save)save.addEventListener('click',async()=>{try{const data=await adminFetch('/api/admin/knowledge-drafts/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:draft.id,draftType:panel.querySelector('.draft-type').value,question:panel.querySelector('.draft-question').value,answer:panel.querySelector('.draft-answer').value,keywords:panel.querySelector('.draft-keywords').value.split(',').map(x=>x.trim()).filter(Boolean),category:panel.querySelector('.draft-category').value,canonicalIds:panel.querySelector('.draft-canonical').value.split(',').map(x=>x.trim()).filter(Boolean),confidenceScore:Number(panel.querySelector('.draft-confidence').value),safetyStatus:panel.querySelector('.draft-safety').value,reviewerNote:panel.querySelector('.draft-note').value})});renderDraftPanel(panel,task,data.draft);knowledgeTaskStatus.textContent='A draft mentve.';}catch(error){knowledgeTaskStatus.textContent=`Draft mentési hiba: ${error.message}`;} });
  panel.querySelectorAll('[data-draft-status]').forEach(button=>button.addEventListener('click',async()=>{try{const data=await adminFetch('/api/admin/knowledge-drafts/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:draft.id,generationStatus:button.dataset.draftStatus})});renderDraftPanel(panel,task,data.draft);knowledgeTaskStatus.textContent='A draft státusza mentve.';}catch(error){knowledgeTaskStatus.textContent=`Draft státuszhiba: ${error.message}`;} }));
}

async function openDraftPanel(card, task) {
  let panel=card.querySelector('.draft-panel'); if(panel){panel.remove();return;}
  panel=document.createElement('section');panel.className='draft-panel';panel.textContent='Draft betöltése...';card.appendChild(panel);
  try{const data=await adminFetch(`/api/admin/knowledge-drafts?taskId=${encodeURIComponent(task.id)}`);renderDraftPanel(panel,task,data.draft);}catch(error){panel.textContent=`Draft betöltési hiba: ${error.message}`;}
}

function renderKnowledgeTasks() {
  if (!knowledgeTaskList) return;
  const rootGroups = { expert: ['expert_rule_missing','expert_rule_bypassed'], canonical: ['canonical_product_missing','canonical_mapping_missing','canonical_not_approved'] };
  const filtered = knowledgeTasks.filter(task => {
    if (knowledgeTaskFilter === 'all') return true;
    if (knowledgeTaskFilter === 'open') return task.status === 'open';
    if (knowledgeTaskFilter === 'critical') return task.priority === 'critical';
    if (knowledgeTaskFilter === 'ignored') return task.status === 'ignored';
    if (knowledgeTaskFilter === 'impact:high') return Number(task.estimatedImpact) >= 70;
    if (knowledgeTaskFilter.startsWith('root:')) { const value = knowledgeTaskFilter.slice(5); return rootGroups[value] ? rootGroups[value].includes(task.rootCause) : task.rootCause === value; }
    return task.classification === knowledgeTaskFilter;
  });
  knowledgeTaskList.innerHTML = '';
  if (!filtered.length) { knowledgeTaskList.innerHTML = '<div class="empty-state">Nincs a szűrőnek megfelelő feladat.</div>'; return; }
  filtered.forEach(task => {
    const card = document.createElement('details'); card.className = 'knowledge-task-card'; card.dataset.priority = task.priority;
    const rootLabels = { knowledge_missing:'Tudáshiány', intent_routing_error:'Routing hiba', expert_rule_bypassed:'Expert szabály megkerülve', canonical_not_approved:'Nem approved canonical termék', unsafe_or_medical_guidance_missing:'Biztonsági tudás hiánya', unknown:'Ismeretlen' };
    const impact = task.impactBreakdown || {};
    card.innerHTML = `<summary class="task-summary">${escapeHtml(task.question || task.topic || 'Névtelen feladat')}</summary><div class="task-badges"><strong>Hatás: ${Number(task.estimatedImpact)||0}/100</strong><span>${escapeHtml(rootLabels[task.rootCause] || task.rootCause || 'Ismeretlen')}</span><span>javítás: ${escapeHtml(task.repairTarget || 'manual_review')}</span><span>${escapeHtml(task.classification)}</span><span>${escapeHtml(task.priority)}</span><span>${task.occurrenceCount || 1} előfordulás</span><span>üzleti érték: ${task.businessValue}/5</span><span>${escapeHtml(task.status)}</span></div><div class="task-detail"><strong>Eredeti kérdés</strong><blockquote>${escapeHtml(task.question || '')}</blockquote><strong>Eredeti válasz</strong><blockquote>${escapeHtml(task.answer || '')}</blockquote><div><strong>Root cause:</strong> ${escapeHtml(rootLabels[task.rootCause] || task.rootCause || '')}</div><div><strong>Root cause indoklása:</strong> ${escapeHtml(task.rootCauseReason || '')}</div><div><strong>Javítás helye:</strong> ${escapeHtml(task.repairTarget || '')}</div><div><strong>Estimated impact:</strong> ${Number(task.estimatedImpact)||0}/100 — priority ${impact.priority||0}, businessValue ${impact.businessValue||0}, occurrenceCount ${impact.occurrenceCount||0}, classification ${impact.classification||0}, biztonsági kiegészítés ${impact.safety||0}</div><div><strong>Besorolás indoka:</strong> ${escapeHtml(task.classificationReason || '')}</div><div><strong>Javasolt teendő:</strong> ${escapeHtml(task.suggestedAction || '')}</div><div><strong>Canonical termékek:</strong> ${escapeHtml((task.canonicalIds || []).join(', ') || '–')}</div><div><strong>Kapcsolódó beszélgetések:</strong> ${escapeHtml((task.conversationIds || []).join(', '))}</div><div class="task-editor"><label>Státusz<select class="task-status">${['open','in_review','approved','rejected','resolved','ignored'].map(status => `<option ${status === task.status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><label>Reviewer note<textarea class="task-note">${escapeHtml(task.reviewerNote || '')}</textarea></label><button class="task-save" type="button">Mentés</button></div></div>`;
    const draftButton=document.createElement('button');draftButton.type='button';draftButton.className='draft-open';draftButton.textContent='Draft megnyitása / létrehozása';card.querySelector('.task-detail').appendChild(draftButton);draftButton.addEventListener('click',()=>openDraftPanel(card,task));
    card.querySelector('.task-save').addEventListener('click', async () => {
      const button = card.querySelector('.task-save'); button.disabled = true;
      try { const data = await adminFetch('/api/admin/knowledge-tasks/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: task.id, status: card.querySelector('.task-status').value, reviewerNote: card.querySelector('.task-note').value }) }); Object.assign(task, { status: data.status, reviewerNote: data.reviewerNote }); knowledgeTaskStatus.textContent = 'A feladat mentve.'; renderKnowledgeTasks(); }
      catch (error) { knowledgeTaskStatus.textContent = `Mentési hiba: ${error.message}`; } finally { button.disabled = false; }
    });
    knowledgeTaskList.appendChild(card);
  });
}

async function loadKnowledgeTasks() {
  if (!knowledgeTaskStatus) return;
  knowledgeTaskStatus.textContent = 'Knowledge Queue betöltése...';
  try { const data = await adminFetch('/api/admin/knowledge-tasks?limit=500'); knowledgeTasks = data.items || []; knowledgeTaskStatus.textContent = `${knowledgeTasks.length} feladat betöltve (${data.storage}).`; renderKnowledgeTasks(); }
  catch (error) { knowledgeTaskStatus.textContent = `Knowledge Queue betöltési hiba: ${error.message}`; }
}

if (knowledgeTaskFilters) knowledgeTaskFilters.addEventListener('click', event => { const button = event.target.closest('[data-filter]'); if (!button) return; knowledgeTaskFilter = button.dataset.filter; knowledgeTaskFilters.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button)); renderKnowledgeTasks(); });
if (loadKnowledgeTasksButton) loadKnowledgeTasksButton.addEventListener('click', loadKnowledgeTasks);
if (exportKnowledgeDraftsButton) exportKnowledgeDraftsButton.addEventListener('click',async()=>{if(!ensureAdminToken())return;try{const response=await fetch('/api/admin/knowledge-drafts/export',{method:'POST',headers:{'X-Admin-Token':adminToken}});if(!response.ok)throw new Error((await response.json()).error||'Export hiba.');const blob=await response.blob(),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='knowledge-import.json';link.click();URL.revokeObjectURL(link.href);}catch(error){knowledgeTaskStatus.textContent=`Export hiba: ${error.message}`;}});

const knowledgeClusterList=document.getElementById('knowledgeClusterList');
const knowledgeClusterStatus=document.getElementById('knowledgeClusterStatus');
const knowledgeClusterFilters=document.getElementById('knowledgeClusterFilters');
const loadKnowledgeClustersButton=document.getElementById('loadKnowledgeClustersButton');
const rebuildKnowledgeClustersButton=document.getElementById('rebuildKnowledgeClustersButton');

function renderKnowledgeClusters(){
  if(!knowledgeClusterList)return;
  const filtered=knowledgeClusters.filter(cluster=>Object.entries(knowledgeClusterFilter).every(([key,value])=>!value||cluster[key]===value));
  knowledgeClusterList.innerHTML='';
  if(!filtered.length){knowledgeClusterList.innerHTML='<div class="empty-state">Nincs a szűrőknek megfelelő klaszter.</div>';return;}
  filtered.sort((a,b)=>(Number(b.estimatedImpact)||0)-(Number(a.estimatedImpact)||0)||String(a.title).localeCompare(String(b.title),'hu')).forEach(cluster=>{
    const card=document.createElement('details');card.className='knowledge-cluster-card';card.dataset.safety=cluster.safetyLevel;
    card.innerHTML=`<summary>${escapeHtml(cluster.title)}</summary><div class="cluster-badges"><span>${escapeHtml(cluster.topic)}</span><span>${cluster.taskCount} task</span><span>${cluster.occurrenceCount} előfordulás</span><span>${escapeHtml(cluster.priority)}</span><span>üzleti érték: ${cluster.businessValue}/5</span><span>hatás: ${cluster.estimatedImpact}/100</span><span>${escapeHtml(cluster.safetyLevel)}</span><span>${escapeHtml(cluster.status)}</span></div><div class="cluster-detail"><p>${escapeHtml(cluster.summary||'')}</p><div><strong>Classification:</strong> ${escapeHtml(Object.entries(cluster.classificationSummary||{}).map(([key,value])=>`${key}: ${value}`).join(', '))}</div><div><strong>Canonical ID-k:</strong> ${escapeHtml((cluster.canonicalIds||[]).join(', ')||'–')}</div><div><strong>Reprezentatív kérdés:</strong> ${escapeHtml(cluster.representativeQuestion||'')}</div><div><strong>Javasolt teendő:</strong> ${escapeHtml(cluster.suggestedAction||'')}</div><details class="cluster-tasks"><summary>Kapcsolódó taskok megnyitása</summary><div>${(cluster.taskIds||[]).map(id=>{const task=knowledgeTasks.find(item=>item.id===id);return task?`<article><strong>${escapeHtml(task.question||id)}</strong><br><small>${escapeHtml(task.classification||'')} · ${escapeHtml(task.topic||'')}</small></article>`:`<article>${escapeHtml(id)}</article>`;}).join('')}</div></details><div class="task-editor"><label>Státusz<select class="cluster-status">${['open','in_review','draft_ready','resolved','dismissed'].map(status=>`<option ${status===cluster.status?'selected':''}>${status}</option>`).join('')}</select></label><label>Reviewer note<textarea class="cluster-note">${escapeHtml(cluster.reviewerNote||'')}</textarea></label><button class="cluster-save" type="button">Mentés</button></div></div>`;
    card.querySelector('.cluster-save').addEventListener('click',async()=>{const button=card.querySelector('.cluster-save');button.disabled=true;try{const data=await adminFetch('/api/admin/knowledge-clusters/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:cluster.id,status:card.querySelector('.cluster-status').value,reviewerNote:card.querySelector('.cluster-note').value})});Object.assign(cluster,{status:data.status,reviewerNote:data.reviewerNote});knowledgeClusterStatus.textContent='A klaszter mentve.';renderKnowledgeClusters();}catch(error){knowledgeClusterStatus.textContent=`Mentési hiba: ${error.message}`;}finally{button.disabled=false;}});
    knowledgeClusterList.appendChild(card);
  });
}

function refreshClusterTopicFilter(){
  const select=knowledgeClusterFilters?.querySelector('[data-cluster-filter="topic"]');if(!select)return;
  const selected=select.value;select.innerHTML='<option value="">Mind</option>'+[...new Set(knowledgeClusters.map(cluster=>cluster.topic).filter(Boolean))].sort().map(topic=>`<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`).join('');select.value=selected;
}

async function loadKnowledgeClusters(){
  if(!knowledgeClusterStatus)return;knowledgeClusterStatus.textContent='Knowledge Clusters betöltése...';
  try{const data=await adminFetch('/api/admin/knowledge-clusters');knowledgeClusters=data.items||[];refreshClusterTopicFilter();renderKnowledgeClusters();knowledgeClusterStatus.textContent=`${knowledgeClusters.length} klaszter betöltve (${data.storage}).`;}
  catch(error){knowledgeClusterStatus.textContent=`Knowledge Clusters betöltési hiba: ${error.message}`;}
}

if(knowledgeClusterFilters)knowledgeClusterFilters.addEventListener('change',event=>{const key=event.target.dataset.clusterFilter;if(!key)return;knowledgeClusterFilter[key]=event.target.value;renderKnowledgeClusters();});
if(loadKnowledgeClustersButton)loadKnowledgeClustersButton.addEventListener('click',loadKnowledgeClusters);
if(rebuildKnowledgeClustersButton)rebuildKnowledgeClustersButton.addEventListener('click',async()=>{rebuildKnowledgeClustersButton.disabled=true;try{const preview=await adminFetch('/api/admin/knowledge-clusters/rebuild',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});knowledgeClusterStatus.textContent=`Dry-run: ${preview.tasksRead} taskból ${preview.clustersGenerated} klaszter; új ${preview.clustersCreated}, frissül ${preview.clustersUpdated}, változatlan ${preview.clustersUnchanged}.`;if(!window.confirm(`${knowledgeClusterStatus.textContent}\n\nBiztosan elmented az újraépítést?`))return;const result=await adminFetch('/api/admin/knowledge-clusters/rebuild',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({write:true})});knowledgeClusterStatus.textContent=`Mentve: ${result.clustersGenerated} klaszter.`;await loadKnowledgeClusters();}catch(error){knowledgeClusterStatus.textContent=`Újraépítési hiba: ${error.message}`;}finally{rebuildKnowledgeClustersButton.disabled=false;}});

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
loadKnowledgeTasks();
loadKnowledgeClusters();

const loadCommerceOutcomesButton=document.getElementById('loadCommerceOutcomesButton');
const commerceOutcomeStatus=document.getElementById('commerceOutcomeStatus');
const commerceOutcomeList=document.getElementById('commerceOutcomeList');
async function loadCommerceOutcomes(){
  if(!commerceOutcomeStatus||!commerceOutcomeList)return;
  commerceOutcomeStatus.textContent='Az igazolt eredmények betöltése...';
  try{
    const data=await adminFetch('/api/admin/commerce/outcomes?limit=100');
    const items=data.items||[];commerceOutcomeList.innerHTML='';
    if(!items.length)commerceOutcomeList.innerHTML='<div class="empty-state">Még nincs verified_order outcome.</div>';
    for(const outcome of items){
      const card=document.createElement('article');card.className='commerce-outcome-card';
      card.innerHTML=`<h3>${escapeHtml(outcome.orderKey||'Ismeretlen rendelés')}</h3><div><strong>Outcome:</strong> ${escapeHtml(outcome.outcomeType||'')}</div><div><strong>Attribution:</strong> ${escapeHtml(outcome.attributionId||'')}</div><div><strong>Order ID:</strong> ${escapeHtml(outcome.orderId||'')}</div><div><strong>Egyező SKU:</strong> ${escapeHtml((outcome.matchedSkus||[]).join(', '))}</div><div><strong>Session:</strong> ${escapeHtml((outcome.conversationSessionIds||[]).join(', ')||'Nem ismert')}</div><div><strong>Ajánlási evidence:</strong> ${escapeHtml(String((outcome.recommendationEvidence||[]).length))} esemény</div><div><strong>Click evidence:</strong> ${escapeHtml(String((outcome.clickEvidence||[]).length))} esemény</div><div><strong>Learning signal:</strong> ${escapeHtml(outcome.learningSignal?.signalType||'Nincs')}</div><div><strong>Verified:</strong> ${escapeHtml(outcome.verifiedAt||'')}</div><div><strong>Idempotencia:</strong> ${escapeHtml(outcome.outcomeId||'')}</div>`;
      commerceOutcomeList.appendChild(card);
    }
    commerceOutcomeStatus.textContent=`${items.length} igazolt outcome betöltve (${data.storage}).`;
  }catch(error){commerceOutcomeStatus.textContent=`Outcome betöltési hiba: ${error.message}`;}
}
if(loadCommerceOutcomesButton)loadCommerceOutcomesButton.addEventListener('click',loadCommerceOutcomes);
loadCommerceOutcomes();
