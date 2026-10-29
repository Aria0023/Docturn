/**
 * CSP / Permissions-Policy regression check in REAL Chromium.
 *
 * The server now emits a Content-Security-Policy and a Permissions-Policy
 * (server/config.ts). The web client is a no-build React kit (inline <script>,
 * in-browser Babel, same-origin WebSocket, blob: URLs for attachments and voice
 * clips, a service worker), so a directive that is one notch too tight breaks
 * the app silently in the console. This script drives the real UI on an
 * emulated iPhone and FAILS on any CSP violation, page error or missing
 * capability:
 *
 *   1. headers present on the shell (CSP + Permissions-Policy, no
 *      upgrade-insecure-requests);
 *   2. sign in through the real form;
 *   3. service worker registers and becomes active;
 *   4. the WebSocket connects (window.DT realtime hook);
 *   5. open Messages, record a voice message with the fake mic, stop → the
 *      pending clip is attached (blob/MediaRecorder path), send it, and the
 *      <audio> element loads (media-src);
 *   6. zero "Content Security Policy" / "Refused to" console messages across
 *      the whole run, and zero uncaught page errors.
 *
 * Run (server must be up with RATE_LIMIT=off and the synthetic seed):
 *   BASE_URL=http://127.0.0.1:3000 node scripts/csp-check.mjs
 * Optional: VIEWPORTS=390x844,375x667,430x932  CHROME_PATH=/path/to/chromium
 * Exits non-zero on any failure.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const VIEWPORTS = (process.env.VIEWPORTS || "390x844,375x667,430x932")
  .split(",")
  .map((s) => s.trim().split("x").map(Number));
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const results = [];
const rec = (name, ok, note = "") => {
  results.push([name, ok]);
  console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  ↳ " + note : ""));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

for (const [width, height] of VIEWPORTS) {
  const tag = `${width}x${height}`;
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: UA,
    permissions: ["microphone"],
    serviceWorkers: "allow",
  });
  const page = await ctx.newPage();

  const cspMessages = [];
  const pageErrors = [];
  const consoleErrors = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/Content.Security.Policy|Refused to|Permissions.Policy|violates the following/i.test(t)) cspMessages.push(t);
    else if (m.type() === "error") consoleErrors.push(t);
  });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));

  // 1. Headers on the shell.
  const shell = await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const h = shell.headers();
  rec(`${tag}: CSP header emitted on the shell`, /default-src 'self'/.test(h["content-security-policy"] || ""), (h["content-security-policy"] || "").slice(0, 80) + "…");
  rec(`${tag}: CSP has no upgrade-insecure-requests (plain-http trial access must work)`, !/upgrade-insecure-requests/.test(h["content-security-policy"] || ""));
  rec(`${tag}: Permissions-Policy allows microphone=(self) only`, /microphone=\(self\)/.test(h["permissions-policy"] || "") && /camera=\(\)/.test(h["permissions-policy"] || ""), h["permissions-policy"]);
  await sleep(800);

  // 2. Sign in through the real form (typed credentials).
  const inputs = await page.locator("input").all();
  rec(`${tag}: login form rendered (Babel-compiled JSX executed under CSP)`, inputs.length >= 3, `${inputs.length} inputs`);
  if (inputs.length >= 3) {
    await inputs[0].fill("ISPN");
    await inputs[1].fill("chen");
    await inputs[2].fill("docturn");
    await page.locator('button:has-text("Sign in")').last().click();
  }
  const signedIn = await page
    .waitForFunction(() => window.DT && window.DT.getState && !!window.DT.getState().session, null, { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const me = await page.evaluate(() => fetch("/api/user", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)));
  rec(`${tag}: signed in as chen`, signedIn && me && me.username === "chen", `me=${me && me.username}`);

  // 3. Service worker active (worker-src 'self').
  const sw = await page
    .evaluate(() =>
      Promise.race([
        navigator.serviceWorker.ready.then((r) => ({ ok: true, scope: r.scope, state: r.active && r.active.state })),
        new Promise((res) => setTimeout(() => res({ ok: false, reason: "timeout" }), 8000)),
      ]),
    )
    .catch((e) => ({ ok: false, reason: String(e) }));
  rec(`${tag}: service worker registered and active`, sw.ok && sw.state === "activated", JSON.stringify(sw));

  // 4. WebSocket connected (connect-src ws://host).
  const wsOk = await page
    .waitForFunction(
      () => {
        const s = window.DT && window.DT.getState && window.DT.getState();
        return !!(s && s.realtime && s.realtime.connected) || !!(s && s.ui && s.ui.realtime && window.__dtWsOpen);
      },
      null,
      { timeout: 1000 },
    )
    .then(() => true)
    .catch(() => false);
  // Fallback measurement: open our own same-origin socket from the page — this
  // is exactly what api-bridge does and what connect-src must allow.
  const wsProbe = await page.evaluate(
    () =>
      new Promise((resolve) => {
        try {
          const proto = location.protocol === "https:" ? "wss:" : "ws:";
          const s = new WebSocket(proto + "//" + location.host + "/ws");
          const t = setTimeout(() => resolve({ ok: false, reason: "timeout" }), 5000);
          s.onopen = () => {
            clearTimeout(t);
            s.close();
            resolve({ ok: true });
          };
          s.onerror = () => {
            clearTimeout(t);
            resolve({ ok: false, reason: "error" });
          };
        } catch (e) {
          resolve({ ok: false, reason: String(e) });
        }
      }),
  );
  rec(`${tag}: same-origin WebSocket opens under connect-src`, wsOk || wsProbe.ok, JSON.stringify(wsProbe));

  // 5. Messages → open a thread → record a voice clip with the fake mic.
  await page.evaluate(() => window.DT.actions.setNav("messages"));
  await sleep(900);
  // The seeded account starts with no threads, so open one the way a user does:
  // the pencil (compose) button → directory search → tap a colleague.
  let opened = false;
  const compose = page.locator('button:has(svg.lucide-pen-square), button:has([data-lucide="pen-square"])').first();
  if (await compose.count()) {
    await compose.click();
    await sleep(800);
    // Every directory row (and the on-call role row above them) carries a
    // "Message" button; take the first PERSON row when there is more than one.
    const messageButtons = page.locator('button:has-text("Message")');
    const n = await messageButtons.count();
    if (n > 0) {
      await messageButtons.nth(n > 1 ? 1 : 0).click();
      opened = true;
    }
  }
  await sleep(900);
  const recBtn = page.locator('button[title="Record a voice message"]');
  const hasRec = (await recBtn.count()) > 0;
  rec(`${tag}: a conversation is open with the voice-record control`, opened && hasRec);
  if (hasRec) {
    await recBtn.first().click();
    await sleep(1500);
    const recording = await page.locator("text=/Recording…/").count();
    rec(`${tag}: MediaRecorder started (getUserMedia allowed by Permissions-Policy microphone=(self))`, recording > 0);
    const stop = page.locator('button[title="Stop & attach"]');
    if (await stop.count()) await stop.first().click();
    const attached = await page
      .waitForSelector("text=/Voice message/", { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    rec(`${tag}: clip uploaded and attached as a pending voice message`, attached);
    if (attached) {
      const send = page.locator('button[title="Send"], button:has-text("Send")').last();
      await send.click();
      const audio = await page
        .waitForSelector("audio", { timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      rec(`${tag}: sent voice message renders an <audio> element`, audio);
      if (audio) {
        // Force the element to load its same-origin source (media-src 'self').
        const loaded = await page.evaluate(
          () =>
            new Promise((resolve) => {
              const a = document.querySelector("audio");
              if (!a) return resolve({ ok: false, reason: "no element" });
              const t = setTimeout(() => resolve({ ok: false, reason: "timeout", readyState: a.readyState, err: a.error && a.error.code }), 6000);
              a.addEventListener("loadedmetadata", () => { clearTimeout(t); resolve({ ok: true, duration: a.duration }); }, { once: true });
              a.addEventListener("error", () => { clearTimeout(t); resolve({ ok: false, reason: "error", err: a.error && a.error.code }); }, { once: true });
              a.preload = "metadata";
              a.load();
            }),
        );
        rec(`${tag}: audio source loads (media-src/connect-src allow it)`, loaded.ok, JSON.stringify(loaded));
      }
    }
  }

  // A blob: URL image (attachment previews / CSV exports use blob: too).
  const blobImg = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const png =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        const img = new Image();
        const t = setTimeout(() => resolve({ ok: false, reason: "timeout" }), 4000);
        img.onload = () => { clearTimeout(t); resolve({ ok: true }); };
        img.onerror = () => { clearTimeout(t); resolve({ ok: false, reason: "error" }); };
        img.src = url;
        document.body.appendChild(img);
      }),
  );
  rec(`${tag}: blob: image renders under img-src`, blobImg.ok, JSON.stringify(blobImg));

  await sleep(500);
  // 6. Zero violations, zero page errors.
  rec(`${tag}: ZERO CSP / Permissions-Policy violations in the console`, cspMessages.length === 0, cspMessages.slice(0, 3).join(" | "));
  rec(`${tag}: no uncaught page errors`, pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  if (consoleErrors.length) console.log(`      (${tag}: ${consoleErrors.length} other console error line(s): ${consoleErrors.slice(0, 2).join(" | ")})`);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r[1]).length;
console.log("\n" + (results.length - failed) + " passed, " + failed + " failed, " + results.length + " total");
process.exit(failed ? 1 : 0);
