/**
 * Offline PWA shell regression check in REAL Chromium (A.CON-SHO-43).
 *
 * Runs the real app in-process on a private copy of webapp/ (so it can edit
 * files and rebuild without touching the repository) and drives an emulated
 * iPhone through, in each serving mode (dev = in-browser Babel, bundle = the
 * precompiled build from scripts/build-webapp.mjs):
 *
 *   1. fresh install: first online load → the service worker precaches the
 *      COMPLETE shell (every URL /sw.js lists, api-bridge.js included);
 *      sign in and out online → nothing under /api or /ws is ever cached;
 *   2. offline (server stopped): reload → the login screen renders from the
 *      cache with api-bridge.js loaded, and no shell file fails;
 *   3. version bump: a shell file changes (and, in bundle mode, is rebuilt) →
 *      the new worker installs, precaches the new shell and activates, the old
 *      cache is gone → offline reload runs the NEW shell (not a blank page);
 *   4. failed precache: the next version's install hits a 503 on one shell
 *      file → that worker is discarded, the previous worker and its complete
 *      cache stay → offline reload still runs the previous shell;
 *   5. zero CSP violations and zero uncaught page errors throughout (in bundle
 *      mode the shell's script-src has no 'unsafe-inline').
 *
 * Run:  npx tsx scripts/pwa-offline-check.mjs      (npm run test:offline)
 * Options: MODES=dev,bundle  PORT=5093  CHROME_PATH=/opt/pw-browsers/chromium
 * Exits non-zero on any failure.
 */
import http from "node:http";
import { appendFile, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createApp } from "../server/app.ts";
import { createTestDb, setHandle } from "../server/db.ts";
import { DatabaseStorage, setStorage } from "../server/storage.ts";
import { seed } from "../server/seed.ts";
import { configureNotifications, NoopPush } from "../server/services/notifications.ts";
import { attachWebSocket } from "../server/ws/index.ts";
import { buildWebapp } from "./build-webapp.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 5093);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const MODES = (process.env.MODES || "dev,bundle").split(",").map((s) => s.trim()).filter(Boolean);
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const results = [];
const rec = (name, ok, note = "") => {
  results.push([name, !!ok]);
  console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  ↳ " + note : ""));
};
const isApiOrWs = (p) => p === "/api" || p.startsWith("/api/") || p === "/ws" || p.startsWith("/ws/");

/* ── server ─────────────────────────────────────────────────────────────── */

const handle = await createTestDb();
setHandle(handle);
const storage = new DatabaseStorage(handle.db);
setStorage(storage);
configureNotifications({ push: new NoopPush() });
await seed(storage);

async function startServer(dir, mode, { failPath } = {}) {
  const app = createApp({ sessionSecret: "pwa-offline-check", rateLimiting: false, webapp: { dir, mode } });
  const server = http.createServer((req, res) => {
    if (failPath && (req.url || "").split("?")[0] === failPath) {
      res.statusCode = 503;
      res.end("unavailable");
      return;
    }
    app(req, res);
  });
  attachWebSocket(server, app.locals.sessionMiddleware);
  const sockets = new Set();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  return {
    // "Offline": the origin becomes unreachable (connection refused), exactly
    // what the worker sees with no network.
    stop: () =>
      new Promise((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}

/* ── page helpers ───────────────────────────────────────────────────────── */

async function waitLogin(page, timeout = 30000) {
  return page
    .waitForFunction(
      () =>
        document.querySelectorAll("input").length >= 3 &&
        Array.prototype.some.call(document.querySelectorAll("button"), (b) => /Sign in/.test(b.textContent || "")),
      null,
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
}

async function swSettled(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), 30000);
        navigator.serviceWorker.ready.then((reg) => {
          const done = () => {
            if (navigator.serviceWorker.controller && reg.active && reg.active.state === "activated" && !reg.installing && !reg.waiting) {
              clearTimeout(t);
              resolve(true);
            } else setTimeout(done, 100);
          };
          done();
        });
      }),
  );
}

const cacheContents = (page) =>
  page.evaluate(async () => {
    const out = {};
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      out[k] = (await c.keys()).map((r) => new URL(r.url).pathname);
    }
    return out;
  });

const shellOf = (page) =>
  page.evaluate(async () => {
    const text = await (await fetch("/sw.js", { cache: "no-store" })).text();
    return JSON.parse(/^self\.__DT_SHELL__ = (\{.*\});$/m.exec(text)[1]);
  });

/** Ask for an update and report what became of the new worker. */
const updateOutcome = (page) =>
  page.evaluate(
    () =>
      new Promise(async (resolve) => {
        const reg = await navigator.serviceWorker.getRegistration();
        const t = setTimeout(() => resolve("timeout"), 30000);
        const watch = (w) => {
          if (!w) return;
          w.addEventListener("statechange", () => {
            if (w.state === "redundant" || w.state === "activated") {
              clearTimeout(t);
              resolve(w.state);
            }
          });
        };
        reg.addEventListener("updatefound", () => watch(reg.installing));
        reg.update().catch(() => {});
      }),
  );

async function bump(dir, mode, n) {
  // Real code (not a comment), so the compiled bundle changes too.
  await appendFile(join(dir, "LoginScreen.jsx"), `\nwindow.__dtShellBump = ${n};\n`);
  if (mode === "bundle") await buildWebapp({ srcDir: dir, log: () => {} });
}

/* ── run ────────────────────────────────────────────────────────────────── */

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

for (const mode of MODES) {
  const tmp = await mkdtemp(join(tmpdir(), "docturn-offline-"));
  const dir = join(tmp, "webapp");
  await cp(join(ROOT, "webapp"), dir, { recursive: true, filter: (src) => !/[\\/]webapp[\\/]\.?dist/.test(src) });
  if (mode === "bundle") await buildWebapp({ srcDir: dir, log: () => {} });
  let srv = await startServer(dir, mode);

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: UA,
    serviceWorkers: "allow",
  });
  const page = await ctx.newPage();
  const csp = [];
  const pageErrors = [];
  let failedShell = [];
  page.on("console", (m) => {
    if (/Content.Security.Policy|Refused to|violates the following/i.test(m.text())) csp.push(m.text());
  });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  page.on("requestfailed", (r) => {
    const p = new URL(r.url()).pathname;
    if (!isApiOrWs(p)) failedShell.push(p + " (" + (r.failure() && r.failure().errorText) + ")");
  });
  const tag = `[${mode}]`;

  // 1. fresh install, online
  await page.goto(BASE + "/");
  rec(`${tag} online first load renders the login screen`, await waitLogin(page));
  const buildMeta = await page.evaluate(() => (document.querySelector('meta[name="docturn-build"]') || {}).content || null);
  rec(`${tag} serving mode is ${mode}`, mode === "bundle" ? !!buildMeta : !buildMeta, `build=${buildMeta}`);
  rec(`${tag} service worker installed, activated and controlling`, await swSettled(page));
  const shell1 = await shellOf(page);
  let cached = await cacheContents(page);
  const cache1 = "docturn-shell-" + shell1.version;
  const missing = shell1.precache.filter((p) => !(cached[cache1] || []).includes(p));
  rec(`${tag} precache holds the COMPLETE shell (${shell1.precache.length} files)`, cached[cache1] && missing.length === 0, missing.slice(0, 5).join(", "));
  // dev: the file itself; bundle: the runtime bundle that contains it
  const bridge = mode === "bundle" ? shell1.precache.find((p) => /^\/dist\/runtime\.[0-9a-f]+\.js$/.test(p)) : "/api-bridge.js";
  rec(`${tag} api-bridge is precached (${bridge})`, !!bridge && (cached[cache1] || []).includes(bridge));

  // sign in and out online: /api traffic flows through the page, never into a cache
  const inputs = await page.locator("input").all();
  await inputs[0].fill("ISPN");
  await inputs[1].fill("chen");
  await inputs[2].fill("docturn");
  await page.locator('button:has-text("Sign in")').last().click();
  const signedIn = await page
    .waitForFunction(() => window.DT && window.DT.getState && !!window.DT.getState().session && !!window.DT.getState().me, null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  rec(`${tag} signs in online`, signedIn);
  await page.waitForTimeout(1500);
  cached = await cacheContents(page);
  const apiCached = Object.values(cached).flat().filter(isApiOrWs);
  rec(`${tag} nothing under /api or /ws is in any cache`, apiCached.length === 0, apiCached.slice(0, 3).join(", "));
  await page.evaluate(() => window.DT.actions.logout());
  rec(`${tag} signs out back to the login screen`, await waitLogin(page, 15000));

  // 2. offline reload
  await srv.stop();
  failedShell = [];
  await page.reload({ waitUntil: "load" }).catch(() => {});
  rec(`${tag} OFFLINE reload renders the login screen from the cache`, await waitLogin(page));
  rec(`${tag} OFFLINE: api-bridge.js ran (window.DT_LIVE)`, await page.evaluate(() => window.DT_LIVE === true));
  rec(`${tag} OFFLINE: no shell file failed to load`, failedShell.length === 0, failedShell.slice(0, 3).join(", "));

  // 3. version bump
  await bump(dir, mode, 1);
  srv = await startServer(dir, mode);
  await page.reload({ waitUntil: "load" });
  await waitLogin(page);
  const outcome2 = await updateOutcome(page);
  const shell2 = await shellOf(page);
  rec(`${tag} a changed shell gets a new version`, shell2.version !== shell1.version, `${shell1.version} → ${shell2.version}`);
  rec(`${tag} the new worker installs and activates`, outcome2 === "activated" || (await swSettled(page)), outcome2);
  await swSettled(page);
  cached = await cacheContents(page);
  const cache2 = "docturn-shell-" + shell2.version;
  rec(`${tag} new cache complete, old cache deleted`, cached[cache2] && shell2.precache.every((p) => cached[cache2].includes(p)) && !cached[cache1], Object.keys(cached).join(", "));
  await srv.stop();
  failedShell = [];
  await page.reload({ waitUntil: "load" }).catch(() => {});
  rec(`${tag} OFFLINE after the bump: the shell renders (not blank)`, await waitLogin(page));
  rec(`${tag} OFFLINE after the bump: it is the NEW shell`, (await page.evaluate(() => window.__dtShellBump)) === 1);
  rec(`${tag} OFFLINE after the bump: no shell file failed`, failedShell.length === 0, failedShell.slice(0, 3).join(", "));

  // 4. failed precache keeps the previous worker + cache
  await bump(dir, mode, 2);
  srv = await startServer(dir, mode, { failPath: "/icons/icon-512-maskable.png" });
  await page.reload({ waitUntil: "load" });
  await waitLogin(page);
  const outcome3 = await updateOutcome(page);
  const shell3 = await shellOf(page);
  rec(`${tag} an install whose precache hits a 503 is discarded`, outcome3 === "redundant", outcome3);
  cached = await cacheContents(page);
  rec(
    `${tag} the previous version's complete cache is kept, no partial new cache`,
    cached[cache2] && shell2.precache.every((p) => cached[cache2].includes(p)) && !cached["docturn-shell-" + shell3.version],
    Object.keys(cached).join(", "),
  );
  await srv.stop();
  failedShell = [];
  await page.reload({ waitUntil: "load" }).catch(() => {});
  rec(`${tag} OFFLINE after a failed update: the previous shell still renders`, await waitLogin(page));
  rec(`${tag} OFFLINE after a failed update: it is the previous (complete) version`, (await page.evaluate(() => window.__dtShellBump)) === 1);

  rec(`${tag} ZERO CSP violations`, csp.length === 0, csp.slice(0, 2).join(" | "));
  rec(`${tag} no uncaught page errors`, pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  await ctx.close();
  await rm(tmp, { recursive: true, force: true });
}

await browser.close();
await handle.close();
const failed = results.filter((r) => !r[1]).length;
console.log("\n" + (results.length - failed) + " passed, " + failed + " failed, " + results.length + " total");
process.exit(failed ? 1 : 0);
