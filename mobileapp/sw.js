/* DocTurn mobile PWA service worker.
 *
 * Caching policy (HIPAA-aware):
 *   - STATIC app-shell assets (html/css/jsx/js/icons/vendor): cache-first with
 *     background refresh, so the app opens instantly and works offline.
 *   - /api and /ws: NEVER touched by this worker. API responses can carry PHI
 *     (patient initials, message content) and MUST NOT be written to the
 *     service-worker cache. WebSockets bypass fetch handlers anyway; API
 *     requests fall through to the network untouched.
 */
const VERSION = "docturn-m-v1";
const SHELL = [
  "/m/",
  "/m/index.html",
  "/m/tokens.css",
  "/m/screens.jsx",
  "/m/api.js",
  "/m/app.jsx",
  "/m/manifest.webmanifest",
  "/m/assets/docturn-glyph.svg",
  "/m/assets/vendor/react.js",
  "/m/assets/vendor/react-dom.js",
  "/m/assets/vendor/babel.min.js",
  "/m/assets/vendor/lucide.min.js",
  "/m/icons/icon-192.png",
  "/m/icons/icon-512.png",
  "/m/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Network-only, no caching, for anything that could carry PHI or auth:
  // API calls, websocket upgrades, login/session — and any cross-origin request.
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/ws") ||
    event.request.method !== "GET"
  ) {
    return; // default browser behavior; never cached
  }

  // App-shell navigation: serve the cached index for /m/* so the installed app
  // opens offline; refresh from network when available.
  if (event.request.mode === "navigate" && url.pathname.startsWith("/m")) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put("/m/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/m/index.html")),
    );
    return;
  }

  // Static assets under /m: cache-first with background revalidate.
  if (url.pathname.startsWith("/m/")) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const refresh = fetch(event.request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(event.request, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || refresh;
      }),
    );
  }
});

/* ── Web Push ─────────────────────────────────────────────────────────────────
 * Payloads are CONTENT-FREE by design (a generic title only — never message
 * text or patient data; push services have no BAA). Tapping the notification
 * focuses or opens the app, which then fetches the real content over TLS. */
self.addEventListener("push", (event) => {
  let title = "DocTurn";
  try {
    const data = event.data ? event.data.json() : null;
    if (data && data.title) title = data.title;
  } catch (e) { /* keep generic title */ }
  event.waitUntil(
    self.registration.showNotification(title, {
      body: "Open DocTurn to view.",
      icon: "/m/icons/icon-192.png",
      badge: "/m/icons/icon-192.png",
      tag: "docturn-msg", // collapse repeats instead of stacking
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes("/m") && "focus" in client) return client.focus();
      }
      return self.clients.openWindow("/m/");
    }),
  );
});
