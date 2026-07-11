/* DocTurn PWA service worker (root scope "/").
 *
 * Purpose: make the FULL web app installable and push-capable — the same app,
 * on a phone home screen, like TigerConnect/PerfectServe.
 *
 * HIPAA-aware caching: only the static app shell (html/css/js/jsx/vendor/icons)
 * is cached. /api and /ws are NEVER cached — those responses can carry PHI and
 * must always go to the network over TLS. Push payloads are content-free.
 */
const VERSION = "docturn-v1";

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

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

/* ── Web Push ─────────────────────────────────────────────────────────────────
 * Content-free by design — a generic title only (push services have no BAA, so
 * no PHI ever transits them). Tapping focuses/opens the app, which fetches the
 * real content over TLS. */
self.addEventListener("push", (event) => {
  let title = "DocTurn";
  try {
    const data = event.data ? event.data.json() : null;
    if (data && data.title) title = data.title;
  } catch (e) { /* keep generic title */ }
  event.waitUntil(
    self.registration.showNotification(title, {
      body: "Open DocTurn to view.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "docturn-msg",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    }),
  );
});
