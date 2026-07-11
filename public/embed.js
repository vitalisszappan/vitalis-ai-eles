(function () {
  if (window.__vitalisChatLoaded) return;
  window.__vitalisChatLoaded = true;

  const current = document.currentScript;
  const base = current && current.src ? new URL(current.src).origin : window.location.origin;

  const style = document.createElement('style');
  style.textContent = `
    #vitalis-chat-launcher,
    #vitalis-chat-frame-wrap { box-sizing: border-box; }

    #vitalis-chat-launcher {
      position: fixed;
      right: 22px;
      bottom: 22px;
      z-index: 2147483000;
      border: 0;
      border-radius: 999px;
      background: #0f684f;
      color: #fff;
      box-shadow: 0 14px 38px rgba(12, 71, 54, .30);
      padding: 10px 16px 10px 10px;
      display: flex;
      align-items: center;
      gap: 11px;
      font: 700 15px/1.15 Arial, Helvetica, sans-serif;
      cursor: pointer;
      transition: transform .2s ease, box-shadow .2s ease, background .2s ease;
      isolation: isolate;
    }

    #vitalis-chat-launcher::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      box-shadow: 0 0 0 0 rgba(18, 128, 95, .28);
      animation: vitalis-chat-breathe 4.8s ease-out infinite;
      z-index: -1;
      pointer-events: none;
    }

    #vitalis-chat-launcher:hover {
      transform: translateY(-2px);
      box-shadow: 0 18px 46px rgba(12, 71, 54, .34);
      background: #0c5d46;
    }

    #vitalis-chat-launcher:focus-visible {
      outline: 3px solid rgba(32, 151, 112, .34);
      outline-offset: 3px;
    }

    #vitalis-chat-launcher img {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      object-fit: contain;
      background: #fff;
      border: 2px solid rgba(255,255,255,.95);
      padding: 3px;
      flex: 0 0 auto;
    }

    #vitalis-chat-launcher .vitalis-chat-label {
      display: block;
      text-align: left;
      white-space: nowrap;
    }

    #vitalis-chat-launcher small {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 400;
      font-size: 11px;
      color: #def2ea;
      margin-top: 3px;
    }

    #vitalis-chat-launcher small::before {
      content: '';
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #71e592;
      box-shadow: 0 0 0 3px rgba(113,229,146,.16);
    }

    #vitalis-chat-frame-wrap {
      position: fixed;
      right: 22px;
      bottom: 22px;
      width: min(420px, calc(100vw - 24px));
      height: min(620px, calc(100vh - 44px));
      z-index: 2147482999;
      opacity: 0;
      visibility: hidden;
      transform: translateY(14px) scale(.985);
      transform-origin: right bottom;
      transition: opacity .2s ease, transform .2s ease, visibility .2s;
      pointer-events: none;
    }

    #vitalis-chat-frame-wrap.open {
      opacity: 1;
      visibility: visible;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    #vitalis-chat-frame {
      width: 100%;
      height: 100%;
      border: 0;
      border-radius: 24px;
      background: transparent;
      filter: drop-shadow(0 22px 48px rgba(12, 71, 54, .23));
    }

    @keyframes vitalis-chat-breathe {
      0%, 72%, 100% { box-shadow: 0 0 0 0 rgba(18, 128, 95, 0); }
      82% { box-shadow: 0 0 0 10px rgba(18, 128, 95, .14); }
      92% { box-shadow: 0 0 0 18px rgba(18, 128, 95, 0); }
    }

    @media (prefers-reduced-motion: reduce) {
      #vitalis-chat-launcher::after { animation: none; }
      #vitalis-chat-launcher,
      #vitalis-chat-frame-wrap { transition: none; }
    }

    @media (max-width: 520px) {
      #vitalis-chat-launcher {
        right: 12px;
        bottom: 12px;
        padding-right: 14px;
      }
      #vitalis-chat-frame-wrap {
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100dvh;
      }
      #vitalis-chat-frame { border-radius: 0; }
    }
  `;
  document.head.appendChild(style);

  const launcher = document.createElement('button');
  launcher.id = 'vitalis-chat-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Kérdezd a készítőt chat megnyitása');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.innerHTML = `
    <img src="${base}/vitalis-logo.jpg" alt="">
    <span class="vitalis-chat-label">
      Kérdezd a készítőt!
      <small>Azonnali válaszok</small>
    </span>
  `;

  const wrap = document.createElement('div');
  wrap.id = 'vitalis-chat-frame-wrap';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `<iframe id="vitalis-chat-frame" title="Kérdezd a készítőt – azonnali válaszok" src="${base}/widget" loading="lazy" allow="clipboard-write"></iframe>`;

  document.body.appendChild(wrap);
  document.body.appendChild(launcher);

  const frame = wrap.querySelector('#vitalis-chat-frame');

  function toggle(force) {
    const open = typeof force === 'boolean' ? force : !wrap.classList.contains('open');
    wrap.classList.toggle('open', open);
    wrap.setAttribute('aria-hidden', String(!open));
    launcher.setAttribute('aria-expanded', String(open));
    launcher.style.display = open ? 'none' : 'flex';
    if (open) {
      setTimeout(() => {
        try { frame.contentWindow.postMessage({ type: 'vitalis-chat-focus' }, '*'); } catch (_) {}
      }, 180);
    }
  }

  launcher.addEventListener('click', () => toggle(true));
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'vitalis-chat-close') toggle(false);
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && wrap.classList.contains('open')) toggle(false);
  });
})();
