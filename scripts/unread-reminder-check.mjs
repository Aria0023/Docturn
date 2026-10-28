/**
 * Unread-message reminder (PerfectServe parity #5, module
 * messaging.unreadReminder), measured in REAL Chromium on emulated iPhones
 * (375×667 / 390×844 / 430×932, DPR 3, touch, iPhone Safari UA) against the
 * server's answer:
 *
 *   R. Settings → Notifications shows the server's stored preference (off for a
 *      user who never opted in); the switch is ONE PUT and the server agrees;
 *      the interval chips (5/10/15/30) are ONE PUT each; a reload shows the
 *      stored value; switching off is ONE PUT.
 *   T. (TIMER=1) the real server's own per-process sweep fires: opt in at 5 min,
 *      leave a message unread, and the server logs "[unread-reminder] N
 *      reminder(s) sent" within ~6.5 min (SERVER_LOG = that server's log file).
 *   M. messaging.unreadReminder off: no row; PUT 404 module_disabled.
 *   Q. (REAL_BASE_URL) SYNTHETIC_DATA=false: a fresh tenant's user starts off.
 *   L. Layout at every width; Z. zero CSP violations / page errors.
 *
 *   BASE_URL=http://127.0.0.1:8831 [TIMER=1 SERVER_LOG=…] [REAL_BASE_URL=… REAL_DEV_PASSWORD=…] node scripts/unread-reminder-check.mjs
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const REAL = process.env.REAL_BASE_URL || "";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const PW = process.env.DEV_PASSWORD || "docturn";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const SIZES = { 375: 667, 390: 844, 430: 932 };
const results = [];
const rec = (name, ok, note = "") => { results.push([name, !!ok]); console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  ↳ " + note : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const csp = [];
const pageErrors = [];
const RUN = Date.now().toString(36).slice(-4).toUpperCase().replace(/[^A-Z]/g, "Q");

async function open(base, width, org, username, password = PW) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const apiLog = [];
  page.on("pageerror", (e) => pageErrors.push(username + "@" + width + ": " + String((e && e.message) || e)));
  page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(username + ": " + t.slice(0, 160)); });
  page.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) apiLog.push({ m: r.request().method(), p: u.pathname, s: r.status(), body: r.request().postData() }); });
  await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.log("Refused to load (CSP) " + e.violatedDirective + " " + e.blockedURI)); });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle" });
  const inputs = await page.locator("input").all();
  await inputs[0].fill(org);
  await inputs[1].fill(username);
  await inputs[2].fill(password);
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
  await sleep(1500);
  const api = (method, path, body) => page.evaluate(([m, p, b]) => fetch(p, { method: m, credentials: "include", headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })), [method, path, body]);
  return { ctx, page, apiLog, api, base, width, username };
}
const nav = async (page, id, settle = 1500) => { await page.evaluate((n) => window.DT.actions.setNav(n), id); await sleep(settle); };
async function reload(page) {
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
  await sleep(2000);
}
async function waitFor(fn, ms = 10000, step = 200) {
  const t = Date.now();
  let v;
  while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(step); }
  return v;
}
async function layout(page, selectors) {
  return page.evaluate((sels) => {
    const vw = window.innerWidth;
    const out = { overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw, small: [], tinyInputs: [], offscreen: [], found: 0 };
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    for (const root of sels.flatMap((s) => [...document.querySelectorAll(s)])) {
      out.found++;
      const rr = root.getBoundingClientRect();
      if (rr.right > vw + 0.5) out.offscreen.push("panel right=" + Math.round(rr.right));
      for (const el of root.querySelectorAll('button, [role="button"], select, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"])')) {
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).trim().slice(0, 30);
        const isInput = el.tagName === "INPUT" || el.tagName === "SELECT";
        if (r.height < 43.5 || (!isInput && r.width < 43.5)) out.small.push(label + " " + Math.round(r.width) + "x" + Math.round(r.height));
        if (isInput && parseFloat(getComputedStyle(el).fontSize) < 16) out.tinyInputs.push(label);
        if (r.right > vw + 0.5) out.offscreen.push(label + " right=" + Math.round(r.right));
      }
    }
    return out;
  }, selectors);
}
async function checkLayout(page, label, selectors) {
  const m = await layout(page, selectors);
  rec(`L: ${label} — panels present`, m.found > 0, "found=" + m.found);
  rec(`L: ${label} — no horizontal page overflow`, m.overflow <= 0, "overflow=" + m.overflow + "px");
  rec(`L: ${label} — every control ≥ 44×44`, m.small.length === 0, m.small.slice(0, 6).join(" | "));
  rec(`L: ${label} — inputs/selects ≥ 16px`, m.tinyInputs.length === 0, m.tinyInputs.slice(0, 4).join(" | "));
  rec(`L: ${label} — nothing past the right edge`, m.offscreen.length === 0, m.offscreen.slice(0, 4).join(" | "));
}
const writes = (log, from = 0) => log.slice(from).filter((r) => r.m !== "GET");
const ui = (P) => P.page.evaluate(() => {
  const row = document.querySelector("[data-reminder-row]");
  const sw = document.querySelector('button[aria-label="Unread-message reminder"]');
  const pressed = document.querySelector("[data-reminder-interval][aria-pressed=true]");
  return {
    row: row ? row.getAttribute("data-reminder-row") : null,
    text: row ? row.textContent : "",
    sw: sw ? sw.getAttribute("aria-pressed") : null,
    chips: [...document.querySelectorAll("[data-reminder-interval]")].map((b) => Number(b.getAttribute("data-reminder-interval"))),
    pressed: pressed ? Number(pressed.getAttribute("data-reminder-interval")) : null,
  };
});
const srv = async (P) => (await P.api("GET", "/api/messaging/unread-reminder")).json;

async function round(base, org, username, pw, width, label) {
  const C = await open(base, width, org, username, pw);
  await C.api("PUT", "/api/messaging/unread-reminder", { enabled: false, intervalMin: 10 });
  await reload(C.page);
  await nav(C.page, "account", 2000);
  let v = await waitFor(async () => { const x = await ui(C); return x.row ? x : null; }, 8000);
  const s0 = await srv(C);
  rec(`R ${label}: Settings shows the server's preference (off)`, v && v.row === "off" && v.sw === "false" && s0.enabled === false && v.chips.length === 0, JSON.stringify(v));
  await checkLayout(C.page, `${label} reminder row (off)`, ["[data-reminder-row]"]);
  let mark = C.apiLog.length;
  await C.page.locator('button[aria-label="Unread-message reminder"]').click();
  await sleep(1500);
  let w = writes(C.apiLog, mark);
  let s1 = await srv(C);
  v = await ui(C);
  rec(`R ${label}: the switch is ONE PUT 200 and the server stores it on`, w.length === 1 && w[0].m === "PUT" && w[0].p === "/api/messaging/unread-reminder" && w[0].s === 200 && s1.enabled === true && v.row === "on" && v.sw === "true", w.map((x) => x.m + " " + x.p + " " + x.s + " " + x.body).join(", "));
  rec(`R ${label}: the interval chips are the server's choices with the stored one pressed`, JSON.stringify(v.chips) === JSON.stringify(s1.intervals) && v.pressed === s1.intervalMin, JSON.stringify({ chips: v.chips, pressed: v.pressed, srv: s1 }));
  rec(`R ${label}: the row says the push is content-free and DND-aware`, /says only that you have unread messages/.test(v.text) && /not while do not disturb/.test(v.text), v.text.slice(0, 200));
  await checkLayout(C.page, `${label} reminder row + chips (on)`, ["[data-reminder-row]", "[data-reminder-intervals]"]);
  mark = C.apiLog.length;
  await C.page.locator('[data-reminder-interval="5"]').click();
  await sleep(1500);
  w = writes(C.apiLog, mark);
  s1 = await srv(C);
  rec(`R ${label}: "5 min" is ONE PUT { enabled, intervalMin: 5 } and the server agrees`, w.length === 1 && w[0].s === 200 && JSON.parse(w[0].body).intervalMin === 5 && s1.intervalMin === 5 && (await ui(C)).pressed === 5, w.map((x) => x.m + " " + x.s + " " + x.body).join(", "));
  await reload(C.page);
  await nav(C.page, "account", 2000);
  v = await waitFor(async () => { const x = await ui(C); return x.row === "on" && x.pressed === 5 ? x : null; }, 8000);
  rec(`R ${label}: after a reload it is still on, every 5 min (from the server)`, !!v, JSON.stringify(v || (await ui(C))));
  mark = C.apiLog.length;
  await C.page.locator('button[aria-label="Unread-message reminder"]').click();
  await sleep(1500);
  w = writes(C.apiLog, mark);
  s1 = await srv(C);
  rec(`R ${label}: switching off is ONE PUT and the server stores it off`, w.length === 1 && w[0].s === 200 && s1.enabled === false && (await ui(C)).row === "off", w.map((x) => x.m + " " + x.s).join(", "));
  await C.ctx.close();
}

console.log("== synthetic server " + BASE);
{
  const dev = await open(BASE, 430, "DOCTURN", "dev");
  const ispn = (await dev.api("GET", "/api/dev/organizations")).json.find((o) => o.code === "ISPN");
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "messaging.unreadReminder", enabled: true });
  for (const width of [375, 390, 430]) await round(BASE, "ISPN", "chen", PW, width, "@" + width);

  // M. module off.
  const C = await open(BASE, 390, "ISPN", "chen");
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "messaging.unreadReminder", enabled: false });
  await reload(C.page);
  await nav(C.page, "account", 2000);
  const mv = await ui(C);
  const put = await C.api("PUT", "/api/messaging/unread-reminder", { enabled: true, intervalMin: 5 });
  rec("M messaging.unreadReminder off: no reminder row; PUT 404 module_disabled", mv.row === null && put.status === 404 && put.json && put.json.module === "messaging.unreadReminder", JSON.stringify({ row: mv.row, status: put.status }));
  await checkLayout(C.page, "Settings with the reminder off @390", ["main"]);
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "messaging.unreadReminder", enabled: true });
  await C.ctx.close();

  // T. The real server's own timer (per-process sweep, 60 s tick).
  if (process.env.TIMER === "1" && process.env.SERVER_LOG) {
    const P = await open(BASE, 430, "ISPN", "patel");
    const ER = await open(BASE, 430, "ISPN", "er.doc");
    const pid = (await P.api("GET", "/api/user")).json.id;
    await P.api("PUT", "/api/messaging/unread-reminder", { enabled: true, intervalMin: 5 });
    await P.api("PATCH", "/api/settings/me", { key: "dnd", value: false });
    const cv = (await ER.api("POST", "/api/messaging/conversations", { type: "direct", participantIds: [pid] })).json;
    await ER.api("POST", "/api/messaging/send", { conversationId: cv.id, content: "timer check " + RUN });
    await P.ctx.close(); await ER.ctx.close();
    const before = (readFileSync(process.env.SERVER_LOG, "utf8").match(/\[unread-reminder\] \d+ reminder\(s\) sent/g) || []).length;
    const t0 = Date.now();
    const hit = await waitFor(async () => {
      const n = (readFileSync(process.env.SERVER_LOG, "utf8").match(/\[unread-reminder\] \d+ reminder\(s\) sent/g) || []).length;
      return n > before;
    }, 8 * 60_000, 5000);
    rec("T: the server's own sweep sent the reminder (logged as a count only) after the 5-min interval", !!hit, "after " + Math.round((Date.now() - t0) / 1000) + "s");
    const leak = /timer check|Reyes|George/.test(readFileSync(process.env.SERVER_LOG, "utf8").split("\n").filter((l) => /unread-reminder/.test(l)).join("\n"));
    rec("T: the sweep's log lines carry no content or names", !leak);
  }
  await dev.ctx.close();
}

if (REAL) {
  console.log("== real server " + REAL);
  const dev = await open(REAL, 390, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD);
  const cfg = (await dev.api("GET", "/api/config")).json;
  rec("Q (setup) server is SYNTHETIC_DATA=false", cfg && cfg.syntheticData === false);
  const NEWPW = "Remind-Check-2026!";
  const code = "RM" + RUN;
  const o = (await dev.api("POST", "/api/dev/organizations", { name: "Reminder Check " + RUN, code, timezone: "America/Chicago" })).json;
  const r = await dev.api("POST", "/api/dev/users", { organizationId: o.id, role: "hospitalist", username: "rm.hosp", displayName: "Dr. Rm Hospitalist", credential: "MD", specialty: "Hospital Medicine", shiftType: "day", patientCap: 12 });
  const temp = r.json && r.json.temporaryPassword;
  if (temp) {
    const ctx = await browser.newContext(); const pg = await ctx.newPage();
    await pg.goto(REAL + "/", { waitUntil: "domcontentloaded" });
    await pg.evaluate(async ([t, n, un, oc]) => {
      const j = (m, path, b) => fetch(path, { method: m, credentials: "include", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((x) => x.status);
      return [await j("POST", "/api/login", { orgCode: oc, username: un, password: t }), await j("PATCH", "/api/account/password", { currentPassword: t, newPassword: n }), await j("POST", "/api/logout")];
    }, [temp, NEWPW, "rm.hosp", code]);
    await ctx.close();
  }
  await dev.ctx.close();
  const H = await open(REAL, 390, code, "rm.hosp", NEWPW);
  const s0 = await srv(H);
  rec("Q: a fresh tenant's user starts with no reminder (off, the default interval)", s0 && s0.enabled === false && s0.intervalMin === 10, JSON.stringify(s0));
  await H.ctx.close();
  await round(REAL, code, "rm.hosp", NEWPW, 390, "real @390");
}

await browser.close();
rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
