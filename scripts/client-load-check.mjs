/**
 * Client load check in REAL Chromium: the web app opens, signs in, navigates
 * and survives a reload with ZERO console errors — from the precompiled bundle
 * (scripts/build-webapp.mjs) or from the unbuilt in-browser-Babel kit.
 *
 * For an iPhone profile at 390x844 and 375x667 and a desktop profile:
 *   1. the shell is the expected kind (EXPECT=bundle: build meta, no
 *      text/babel tags, no Babel runtime, no development React downloaded;
 *      EXPECT=dev: the text/babel kit; unset: whichever the server serves);
 *   2. sign in through the real form (seeded synthetic org ISPN);
 *   3. tap every primary nav entry;
 *   4. reload → the session is restored from the cookie via GET /api/session;
 *   5. the service worker is active;
 *   6. zero uncaught page errors and zero console errors across the run —
 *      including the cold, signed-out start (GET /api/session answers 200
 *      either way; a 401 is logged by the browser as "Failed to load
 *      resource").
 *
 * Run (server up with RATE_LIMIT=off and the synthetic seed):
 *   BASE_URL=http://127.0.0.1:3000 EXPECT=bundle node scripts/client-load-check.mjs
 *   (a dev server serves the bundle with WEBAPP_BUNDLE=on after `npm run build:webapp`)
 * Optional: CHROME_PATH=/path/to/chromium
 * Exits non-zero on any failure.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const EXPECT = (process.env.EXPECT || "").trim().toLowerCase(); // "bundle" | "dev" | ""
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const results = [];
const rec = (name, ok, note = "") => {
  results.push(ok);
  console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  ↳ " + note : ""));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const phone = (width, height) => ({ viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
const PROFILES = [
  { tag: "iphone390", user: "chen", ctx: phone(390, 844) },
  { tag: "iphone375", user: "er.doc", ctx: phone(375, 667) },
  { tag: "desktop", user: "director", ctx: { viewport: { width: 1366, height: 900 } } },
];

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

try {
  for (const p of PROFILES) {
    const ctx = await browser.newContext({ ...p.ctx, serviceWorkers: "allow" });
    const page = await ctx.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const badResponses = [];
    const scripts = [];
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const at = m.location() && m.location().url ? " @ " + m.location().url.replace(BASE, "") : "";
      consoleErrors.push(m.text() + at);
    });
    page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
    page.on("response", (r) => {
      if (r.status() >= 400) badResponses.push(r.request().method() + " " + r.url().replace(BASE, "") + " → " + r.status());
    });
    page.on("request", (r) => {
      if (r.resourceType() === "script") scripts.push(r.url().replace(BASE, ""));
    });

    // 1. Cold, signed-out start.
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await sleep(500);
    const shell = await page.evaluate(() => ({
      build: (document.querySelector('meta[name="docturn-build"]') || {}).content || null,
      babelTags: document.querySelectorAll('script[type="text/babel"]').length,
      hasBabel: typeof window.Babel !== "undefined",
      inputs: document.querySelectorAll("input").length,
    }));
    const served = shell.build ? "bundle" : "dev";
    if (EXPECT === "bundle") {
      rec(`${p.tag}: shell is the compiled bundle (build meta, no text/babel, no Babel runtime)`, !!shell.build && shell.babelTags === 0 && !shell.hasBabel, JSON.stringify(shell));
      rec(`${p.tag}: no Babel standalone or development React downloaded`, !scripts.some((s) => /babel|development/i.test(s)), scripts.join(", "));
    } else if (EXPECT === "dev") {
      rec(`${p.tag}: shell is the unbuilt kit (text/babel + in-browser Babel)`, !shell.build && shell.babelTags > 0 && shell.hasBabel, JSON.stringify(shell));
    } else {
      console.log(`      (${p.tag}: server serves the ${served} client)`);
    }
    rec(`${p.tag}: login form rendered`, shell.inputs >= 3, `${shell.inputs} inputs`);

    // 2. Sign in through the real form.
    const inputs = await page.locator("input").all();
    if (inputs.length >= 3) {
      await inputs[0].fill("ISPN");
      await inputs[1].fill(p.user);
      await inputs[2].fill("docturn");
      await page.locator('button:has-text("Sign in")').last().click();
    }
    const signedIn = await page
      .waitForFunction(() => window.DT && window.DT.getState && !!window.DT.getState().session, null, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    const me = await page.evaluate(() => fetch("/api/user", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)));
    rec(`${p.tag}: signed in as ${p.user} through the form`, signedIn && !!me && me.username === p.user, `me=${me && me.username}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(1000);

    // 3. Every primary nav entry (tab bar on phones, sidebar on desktop).
    const labels = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll("nav button, nav a"))
          .map((b) => (b.getAttribute("aria-label") || b.innerText || "").trim())
          .filter(Boolean),
      )
      .catch(() => []);
    let visited = 0;
    for (const label of [...new Set(labels)].slice(0, 12)) {
      try {
        const q = JSON.stringify(label);
        const loc = page.locator(`nav button:has-text(${q}), nav a:has-text(${q}), nav [aria-label=${q}]`).first();
        if (await loc.isVisible()) {
          await loc.click({ timeout: 3000 });
          visited++;
          await sleep(500);
        }
      } catch {
        /* an entry that re-rendered away is fine */
      }
    }
    rec(`${p.tag}: primary navigation reachable`, visited > 0, `visited ${visited} of ${labels.length}`);

    // 4. Reload → restore from the cookie via GET /api/session.
    const probes = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname === "/api/session" || u.pathname === "/api/user") probes.push(u.pathname);
    });
    await page.reload({ waitUntil: "networkidle" });
    const restored = await page
      .waitForFunction((who) => {
        const s = window.DT && window.DT.getState && window.DT.getState();
        return !!(s && s.session && s.session.user === who);
      }, p.user, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    rec(`${p.tag}: reload restores the session from the cookie (GET /api/session)`, restored && probes.includes("/api/session"), `probes=${probes.join(",")}`);
    await sleep(800);

    // 5. Service worker.
    const sw = await page
      .evaluate(() =>
        Promise.race([
          navigator.serviceWorker.ready.then((r) => ({ ok: true, state: r.active && r.active.state })),
          new Promise((res) => setTimeout(() => res({ ok: false, reason: "timeout" }), 8000)),
        ]),
      )
      .catch((e) => ({ ok: false, reason: String(e) }));
    rec(`${p.tag}: service worker active`, sw.ok && sw.state === "activated", JSON.stringify(sw));

    // 6. Console.
    rec(`${p.tag}: zero uncaught page errors`, pageErrors.length === 0, pageErrors.join(" | "));
    rec(
      `${p.tag}: zero console errors (cold start, sign-in, navigation, reload)`,
      consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.join(" | ") + (badResponses.length ? " — responses: " + badResponses.join(", ") : "") : "",
    );
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} failed, ${results.length} total`);
process.exit(failed ? 1 : 0);
