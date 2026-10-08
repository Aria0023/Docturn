/* DocTurn PWA service worker (root scope "/").
 *
 * Purpose: make the FULL web app installable and push-capable — the same app,
 * on a phone home screen, like TigerConnect/PerfectServe.
 *
 * HIPAA-aware caching: only the static app shell (html/css/js/jsx/vendor/icons)
 * is cached. /api and /ws are NEVER cached — those responses can carry PHI and
 * must always go to the network over TLS. Push payloads are content-free.
 */
const VERSION = "docturn-v2";

// Core shell so the app opens offline. Unhashed dev files → we revalidate in the
// background (stale-while-revalidate) so a pull is picked up on next load.
const SHELL = ["/", "/index.html", "/tokens.css", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  // Never touch API/WS — PHI-bearing, always network.
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/ws")) return;

  // SPA navigations: network-first, fall back to cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html").then((r) => r || caches.match("/"))),
    );
    return;
  }

  // Static assets: NETWORK-FIRST. The dev files (index.html scripts, .jsx, css)
  // are unhashed, so serving cache-first / stale-while-revalidate meant a deploy
  // only showed up on the SECOND load — installed PWAs would sit on stale code
  // indefinitely. Fetch fresh when online (and refresh the cache), fall back to
  // the cached copy only when the network is unavailable.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});

/* ── Web Push ─────────────────────────────────────────────────────────────────
 * Content-free by design — a generic title only (push services have no BAA, so
 * no PHI ever transits them). Tapping focuses/opens the app, which fetches the
 * real content over TLS. */
// Message wake-ups ("New secure message", "STAT secure message", "Escalated
// STAT message needs attention", …) open the Messages screen when tapped.
const isMessagePush = (title) => /message/i.test(title || "");

self.addEventListener("push", (event) => {
  let title = "DocTurn";
  try {
    const data = event.data ? event.data.json() : null;
    if (data && data.title) title = data.title;
  } catch (e) { /* keep generic title */ }
  const nav = isMessagePush(title) ? "messages" : null;
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: "Open DocTurn to view.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "docturn-msg",
      data: { nav },
    }),
    // App-icon badge (A.CON-MIN-17) while the app is not in front: the payload
    // is content-free and carries no count, so this is a plain "something new"
    // flag; the app replaces it with the real unread count (or clears it) as
    // soon as it is visible again.
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const inFront = list.some((c) => c.visibilityState === "visible");
      if (!inFront && nav && self.navigator && typeof self.navigator.setAppBadge === "function") {
        return self.navigator.setAppBadge().catch(() => {});
      }
      return undefined;
    }).catch(() => {}),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const nav = (event.notification.data && event.notification.data.nav) || null;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // Prefer a window of this app that is already open: bring it forward and
      // ask it to show Messages (api-bridge listens for "docturn:open").
      const client = list.find((c) => "focus" in c);
      if (client) {
        if (nav) { try { client.postMessage({ type: "docturn:open", nav }); } catch (e) { /* focus anyway */ } }
        return client.focus();
      }
      // Nothing open: start the app straight on Messages (api-bridge reads and
      // strips ?open=messages after sign-in / session restore).
      return self.clients.openWindow(nav ? "/?open=" + nav : "/");
    }),
  );
});
