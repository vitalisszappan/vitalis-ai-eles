# Vitalis browser origin audit

Production canonical origin recommendation: `https://www.vitalis-szappan.hu`.

Live read-only audit on 2026-08-08: the `www` origin returned `200`, while `https://vitalis-szappan.hu/` returned `301 Location: https://www.vitalis-szappan.hu/`. The current canonical redirect is therefore already aligned with this recommendation; no redirect change is part of this patch.

The product URLs and the current primary commerce allowlist already use the `www` host. Browser `localStorage`, `sessionStorage`, storage events and `BroadcastChannel` are origin-scoped, so they cannot carry an attribution ID between `www.vitalis-szappan.hu` and `vitalis-szappan.hu`.

The server continues to allow both HTTPS origins during migration so existing traffic is not broken. The UNAS configuration should later enforce a single HTTPS redirect from the apex host to `www` before the attribution lifecycle runs. No live redirect or UNAS configuration is changed by this patch.

Acceptance check after that operational change:

- product, cart, checkout and `order_send` all report `location.origin === 'https://www.vitalis-szappan.hu'`;
- the lifecycle attribution ID is identical before and after navigation;
- no ScriptTag is installed on an HTTP or alternate-host page.
