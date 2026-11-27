/**
 * Settings → Organization "Message retention" truthfulness check
 * (A.CON-SHO-23 / A.CON-SHO-37) — web client, iPhone profiles.
 *
 * The card configures the window the hourly purge applies. It must never
 * promise a purge the server is not running:
 *   - ops.retention ON: choosing 30 days saves it, and the toast describes the
 *     hourly purge from the server's answer.
 *   - ops.retention OFF (flipped by the developer through PATCH
 *     /api/dev/modules): the card says the purge is switched off and that the
 *     saved window is NOT enforced; the API refuses a new window
 *     (404 module_disabled); the only choice offered is "Keep everything",
 *     which clears the saved window.
 *   - a page loaded while the module was on, then switched off underneath it:
 *     choosing a window is refused, the toast says why, the old value comes
 *     back, and the card flips to the "off" state.
 *   - a window under the 7-day floor (API only) is shown as itself, flagged,
 *     and the msg-retention-policy control warns rather than passes.
 * Measures that the card causes no horizontal overflow at 375 / 390 / 430 px.
 *
 * Drives the real app in headless Chromium against a seeded SYNTHETIC server
 * (org ISPN, operator dev on DOCTURN). It RESTORES ops.retention=on and
 * messageRetentionDays=0 at the end.
 *
 * Usage:  BASE_URL=http://127.0.0.1:6300 node scripts/retention-card-check.mjs
 * Exits non-zero on any failed check.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const SIZES = { 390: 844, 375: 667, 430: 932 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const rec = (name, ok, note = "") => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  -> " + note : "")); };

async function apiSession(orgCode, username) {
  const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgCode, username, password: "docturn" }) });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  if (!r.ok) throw new Error("login " + username + " " + r.status);
  return async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
    const t = await res.text();
    return { status: res.status, body: t ? JSON.parse(t) : null };
  };
}
const director = await apiSession("ISPN", "director");
const dev = await apiSession("DOCTURN", "dev");
const orgId = (await director("GET", "/api/user")).body.organizationId;
const setModule = async (enabled) => {
  const r = await dev("PATCH", "/api/dev/modules/" + orgId, { id: "ops.retention", enabled });
  if (r.status !== 200) throw new Error("module flip " + r.status);
};
const settings = async () => (await director("GET", "/api/settings")).body.org;
const control = async () => (await director("GET", "/api/compliance/status")).body.controls.find((c) => c.id === "msg-retention-policy");

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
async function phone(width) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!(window.DT && window.DT.actions && window.DT_LIVE), null, { timeout: 60000 });
  await page.evaluate(() => window.DT.actions.login("director", "ISPN", "director", "docturn"));
  await page.waitForFunction(() => { const s = window.DT.getState(); return !!(s.session && s.session.role === "director" && s.modules); }, null, { timeout: 30000 });
  await page.evaluate(() => window.DT.actions.setNav("settings"));
  await page.waitForSelector("[data-retention-state]", { timeout: 30000 });
  await sleep(600);
  return { ctx, page };
}
async function card(page) {
  return page.evaluate(() => {
    const el = document.querySelector("[data-retention-state]");
    const sel = el && el.querySelector("select");
    const box = el ? el.parentElement.getBoundingClientRect() : null;
    return {
      state: el && el.getAttribute("data-retention-state"),
      text: el ? el.innerText.replace(/\s+/g, " ").trim() : null,
      value: sel ? sel.value : null,
      selected: sel ? sel.options[sel.selectedIndex].text : null,
      options: sel ? [...sel.options].map((o) => o.text) : [],
      disabled: sel ? sel.disabled : null,
      cardRight: box ? Math.round(box.right) : null,
      vw: innerWidth,
      doc: document.documentElement.scrollWidth,
    };
  });
}
async function choose(page, value) {
  await page.evaluate(() => { window.DT.set((s) => { s.__toast = null; return s; }); });
  await page.selectOption("[data-retention-state] select", String(value));
  await page.waitForFunction(() => !!window.DT.getState().__toast, null, { timeout: 10000 });
  await sleep(300);
  return page.evaluate(() => {
    const t = window.DT.getState().__toast;
    return { title: t.title, msg: t.msg, onScreen: document.body.innerText.includes(t.title) };
  });
}

try {
  // ---- 1. Module ON: a window is saved and described from the server's answer.
  await setModule(true);
  await director("PATCH", "/api/settings/org", { key: "messageRetentionDays", value: 0 });
  console.log("\n=== ops.retention ON (iPhone 390) ===");
  let { ctx, page } = await phone(390);
  let c = await card(page);
  rec("card is in the 'on' state", c.state === "on", c.state);
  rec("card describes the hourly purge", /permanently deleted, with their attachments, by an hourly, audited purge/.test(c.text || ""), c.text);
  let t = await choose(page, 30);
  rec("choosing 30 days: toast is the server's word", t.title === "Retention updated" && /older than 30 days are permanently deleted by the hourly purge/.test(t.msg) && t.onScreen, JSON.stringify(t));
  let s = await settings();
  rec("server: 30 days saved and enforced", s.messageRetentionDays === 30 && s.messageRetention.enforced === true, JSON.stringify(s.messageRetention));
  rec("control: pass at 30 days", (await control()).status === "pass");

  // ---- 2. Switched off underneath an open page: the choice is refused, truthfully.
  console.log("\n=== ops.retention switched OFF under an open page ===");
  await setModule(false);
  t = await choose(page, 90);
  rec("refused choice: toast says the purge is switched off (no auto-delete claim)", t.title === "Not saved" && /retention purge is switched off/.test(t.msg) && !/auto-delete|permanently deleted/.test(t.msg) && t.onScreen, JSON.stringify(t));
  s = await settings();
  rec("server value unchanged (30), not enforced", s.messageRetentionDays === 30 && s.messageRetention.moduleEnabled === false && s.messageRetention.enforced === false, JSON.stringify(s.messageRetention));
  await page.waitForFunction(() => { const el = document.querySelector("[data-retention-state]"); return el && el.getAttribute("data-retention-state") === "off"; }, null, { timeout: 10000 }).catch(() => {});
  c = await card(page);
  rec("card flips to 'off' after the refusal (module map re-read)", c.state === "off" && c.value === "30", JSON.stringify({ state: c.state, value: c.value }));
  await ctx.close();

  // ---- 3. Module OFF, fresh page: the card says so; only clearing is offered.
  for (const width of [390, 375, 430]) {
    console.log(`\n=== ops.retention OFF (iPhone ${width}) ===`);
    ({ ctx, page } = await phone(width));
    c = await card(page);
    rec(`[${width}] card is in the 'off' state`, c.state === "off", c.state);
    rec(`[${width}] says the purge is switched off and nothing is deleted`, /retention purge is switched off/.test(c.text) && /Nothing is deleted/.test(c.text), c.text);
    rec(`[${width}] says the saved 30-day window is NOT enforced`, /A 30-day window is saved but NOT enforced/.test(c.text), c.text);
    rec(`[${width}] never claims a purge`, !/permanently deleted, with their attachments, by an hourly/.test(c.text) && !/auto-delete/.test(c.text), c.text);
    rec(`[${width}] options: the saved window (not enforced) and Keep everything only`, JSON.stringify(c.options) === JSON.stringify(["30 days — saved, not enforced", "Keep everything"]), JSON.stringify(c.options));
    rec(`[${width}] no horizontal overflow`, c.doc <= c.vw && (c.cardRight == null || c.cardRight <= c.vw), JSON.stringify({ doc: c.doc, vw: c.vw, cardRight: c.cardRight }));
    if (width !== 430) await ctx.close();
  }
  const refused = await director("PATCH", "/api/settings/org", { key: "messageRetentionDays", value: 90 });
  rec("API: a new window with the module off is refused 404 module_disabled", refused.status === 404 && refused.body.error === "module_disabled" && refused.body.module === "ops.retention", JSON.stringify(refused));
  rec("control: warns (configured, not enforced)", (await control()).status === "warn");
  // Clearing through the UI is allowed and says what is true.
  t = await choose(page, 0);
  rec("Keep everything with the module off: 'Messages are kept indefinitely.'", t.title === "Retention updated" && t.msg === "Messages are kept indefinitely.", JSON.stringify(t));
  s = await settings();
  rec("server: window cleared to 0", s.messageRetentionDays === 0, String(s.messageRetentionDays));
  await sleep(300);
  c = await card(page);
  rec("card: nothing saved, select disabled, says a window can be set once switched on", c.state === "off" && c.disabled === true && /can be set once the purge is switched on/.test(c.text), JSON.stringify({ disabled: c.disabled, text: c.text }));
  await ctx.close();

  // ---- 4. A window under the floor (API only) is shown as itself and flagged.
  console.log("\n=== 3-day window (below the 7-day floor) ===");
  await setModule(true);
  const low = await director("PATCH", "/api/settings/org", { key: "messageRetentionDays", value: 3 });
  rec("API accepts 3 and flags it", low.status === 200 && low.body.retention.belowRecommendedFloor === true && low.body.retention.enforced === true, JSON.stringify(low.body));
  const ctl = await control();
  rec("control warns at 3 days (never a plain pass)", ctl.status === "warn" && /below the 7-day minimum/.test(ctl.detail), ctl.status + " " + ctl.detail);
  for (const width of [390, 375]) {
    ({ ctx, page } = await phone(width));
    c = await card(page);
    rec(`[${width}] card shows '3 days', not 'Keep everything'`, c.value === "3" && /^3 days/.test(c.selected), JSON.stringify({ value: c.value, selected: c.selected }));
    rec(`[${width}] card flags the window below the 7-day minimum`, /3 days is below the 7-day minimum/.test(c.text), c.text);
    rec(`[${width}] no horizontal overflow`, c.doc <= c.vw && (c.cardRight == null || c.cardRight <= c.vw), JSON.stringify({ doc: c.doc, vw: c.vw, cardRight: c.cardRight }));
    if (width === 390) {
      // The Compliance monitor screen shows the same warning, not a green row.
      await page.evaluate(() => window.DT.actions.setNav("compliance-monitor"));
      await page.waitForFunction(() => /below the 7-day minimum/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
      const mon = await page.evaluate(() => {
        const txt = document.body.innerText;
        const i = txt.indexOf("older than 3 day(s)");
        return { found: /below the 7-day minimum this control expects/.test(txt), excerpt: i >= 0 ? txt.slice(Math.max(0, i - 120), i + 160).replace(/\s+/g, " ") : null };
      });
      rec(`[${width}] Compliance monitor shows the below-floor warning`, mon.found, mon.excerpt || "(not found)");
    }
    await ctx.close();
  }

  // ---- 5. The developer console blurb says what OFF does.
  const reg = (await dev("GET", "/api/dev/modules/" + orgId)).body.registry || [];
  const blurb = (reg.find((m) => m.id === "ops.retention") || {}).blurb || "";
  rec("ops.retention blurb says what switching it off does", /Off: nothing is purged, messages are kept indefinitely/.test(blurb), blurb);
} finally {
  await setModule(true).catch(() => {});
  await director("PATCH", "/api/settings/org", { key: "messageRetentionDays", value: 0 }).catch(() => {});
  await browser.close();
}
console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
