/* DocTurn PWA service worker (root scope "/").
 *
 * Purpose: make the FULL web app installable and push-capable — the same app,
 * on a phone home screen, like TigerConnect/PerfectServe.
 *
 * HIPAA-aware caching: only the static app shell (html/css/js/jsx/vendor/icons)
 * is cached. /api and /ws are NEVER cached and never answered from a cache —
 * those responses can carry PHI and must always go to the network over TLS.
 * Push payloads are content-free.
 *
 * Offline shell (A.CON-SHO-43). The server prepends
 *   self.__DT_SHELL__ = { version, precache: [...], immutable: "/dist/" }
 * to this file (server/webapp-static.ts): the shell's version and EVERY file it
 * needs — index.html, the stylesheet, every script (in dev: vendor React,
 * Babel, lucide, store.js, api-bridge.js and every .jsx; in a build: the
 * hashed bundles), the manifest, icons and the images the screens use. So:
 *   • install precaches the complete shell, all-or-nothing: if any file fails,
 *     the install fails and the previously installed worker — with its own
 *     complete cache — stays in charge (no more silent `.catch(() => {})`);
 *   • every deploy that changes the shell changes these bytes, so the browser
 *     installs a new worker, which precaches the new shell BEFORE it activates
 *     and deletes the old cache — a version bump never leaves a blank shell,
 *     and the cached index.html is always the one matching its scripts;
 *   • a fresh install works offline from the second launch on, i.e. as soon
 *     as the first online load has finished installing the worker.
 */
const SHELL = self.__DT_SHELL__ || {
  // Served without the server (static preview): a minimal, still-honest shell.
  version: "static",
  precache: ["/index.html", "/tokens.css", "/manifest.webmanifest"],
  immutable: null,
};
const CACHE_PREFIX = "docturn-";
const CACHE = CACHE_PREFIX + "shell-" + SHELL.version;
const OFFLINE_SHELL = "/index.html";

// PHI boundary. Exact path segments: "/api-bridge.js" (the app's own script,
// needed offline) is NOT an API path, "/api/..." and "/ws" are.
function isApiOrWs(pathname) {
  return pathname === "/api" || pathname.indexOf("/api/") === 0 || pathname === "/ws" || pathname.indexOf("/ws/") === 0;
}

const PRECACHE = (SHELL.precache || []).filter(function (u) {
  try {
    const url = new URL(u, self.location.origin);
    return url.origin === self.location.origin && !isApiOrWs(url.pathname);
  } catch (e) {
    return false;
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const existed = await caches.has(CACHE);
    const cache = await caches.open(CACHE);
    try {
      // Cache.addAll is atomic: one failed or non-OK response and nothing is
      // stored. The rejection fails this install, so the browser keeps the
      // current worker (and its complete cache) and retries on its next update
      // check. Requests use the normal HTTP cache: unhashed files are served
      // `no-cache` (always revalidated) and hashed ones are immutable, so what
      // lands here is exactly what the server is serving now.
      await cache.addAll(PRECACHE);
    } catch (err) {
      if (!existed) await caches.delete(CACHE);
      throw err;
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Only now — with this version's complete shell in place — drop the old
    // versions (including the pre-versioning "docturn-v2" cache).
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE && k.indexOf(CACHE_PREFIX) === 0).map((k) => caches.delete(k)));
    // Start the navigation request in parallel with worker start-up.
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) { /* optional */ }
    }
    await self.clients.claim();
  })());
});

// The cache is written ONLY by install: it is always exactly one version's
// complete, consistent shell. (Refreshing entries from online responses would
// mix files of a newer deploy — whose own worker may have failed to install —
// into this version's offline shell.)
function fromCache(req) {
  return caches.match(req, { ignoreVary: true });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  // Never touch API/WS — PHI-bearing, always network, never cached.
  if (isApiOrWs(url.pathname)) return;
  if (url.pathname === "/sw.js") return;

  // Navigations: network-first (a deploy shows on the next launch); offline,
  // the precached shell of THIS worker's version, whose scripts are all here.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(req);
      } catch (e) {
        const shell = await caches.match(OFFLINE_SHELL, { cacheName: CACHE, ignoreVary: true }) || await caches.match(OFFLINE_SHELL, { ignoreVary: true });
        return shell || Response.error();
      }
    })());
    return;
  }

  // Content-hashed build files never change under a given URL: cache-first.
  if (SHELL.immutable && url.pathname.indexOf(SHELL.immutable) === 0) {
    event.respondWith(fromCache(req).then((hit) => hit || fetch(req)));
    return;
  }

  // Everything else (unhashed shell files, icons, images): network-first so a
  // pull/deploy is picked up immediately; the cached copy only when the
  // network is unavailable.
  event.respondWith(
    fetch(req).catch(() => fromCache(req).then((hit) => hit || Response.error())),
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
