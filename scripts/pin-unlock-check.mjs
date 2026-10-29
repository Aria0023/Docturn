/**
 * PIN unlock (PerfectServe parity #7, module security.pin — default off),
 * measured in REAL Chromium on emulated iPhones (375×667 / 390×844 /
 * 430×932, DPR 3, touch, iPhone Safari UA) against the server's answer:
 *
 *   S. Settings → Security → PIN unlock: Set PIN is ONE PUT with the
 *      password re-entered (a wrong password changes nothing); the row shows
 *      the server's answer.
 *   U. Lock app now → the lock screen offers the PIN because the SERVER says
 *      so (GET /api/user pinUnlock); a wrong PIN stays locked (data routes
 *      423) and says how many attempts are left; the right PIN re-opens the
 *      same session (data 200, socket back) with no sign-in; a reload while
 *      locked still offers the PIN; nothing about the PIN in localStorage.
 *   F. 5 wrong PINs → the screen falls back to the password; the right PIN is
 *      refused by the server (pin_disabled); the password unlocks.
 *   I. The idle auto-lock (back-dated 15 min) is still a logoff: the PIN
 *      route answers 401 and a reload shows the sign-in screen.
 *   M. security.pin off: no PIN row; the lock screen is password-only; the
 *      PIN routes answer 404 module_disabled.
 *   Q. (REAL_BASE_URL) SYNTHETIC_DATA=false: off by default for a fresh
 *      tenant; switched on, its user has no PIN until they set one.
 *   L. Layout at every width; Z. zero CSP violations / page errors.
 *
 *   BASE_URL=http://127.0.0.1:8865 [REAL_BASE_URL=… REAL_DEV_PASSWORD=…] node scripts/pin-unlock-check.mjs
 */
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
  page.on("dialog", (d) => d.accept().catch(() => {}));
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
        // A control inside a sideways-scrolling strip (the chip bar) may sit
        // past the edge — it is reached by scrolling the strip, whose own box
        // must be on-screen (checked as "panel" above / by the C rows).
        let sc = el.parentElement, inStrip = false;
        while (sc && sc !== document.body) { const ox = getComputedStyle(sc).overflowX; if (ox === "auto" || ox === "scroll") { inStrip = sc.getBoundingClientRect().right <= vw + 0.5; break; } sc = sc.parentElement; }
        if (r.right > vw + 0.5 && !inStrip) out.offscreen.push(label + " right=" + Math.round(r.right));
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
const PIN = "4826";
const lockState = (P) => P.page.evaluate(() => {
  const f = document.querySelector("form[data-lock-mode]");
  const alert = document.querySelector('[role="dialog"] [role="alert"]');
  return { locked: !!f, mode: f ? f.getAttribute("data-lock-mode") : null, switcher: !!document.querySelector("[data-lock-switch]"), alert: alert ? alert.textContent.trim() : "" };
});
const pinRow = (P) => P.page.evaluate(() => { const r = document.querySelector("[data-pin-row]"); return r ? r.getAttribute("data-pin-row") : null; });
const storageDump = (P) => P.page.evaluate(() => { const o = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } } catch (e) {} try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); o["ss:" + k] = sessionStorage.getItem(k); } } catch (e) {} return JSON.stringify(o); });
const status = async (P, path) => (await P.api("GET", path)).status;
async function lockNow(P) {
  await nav(P.page, "account", 1500);
  await P.page.locator("text=Lock app now").first().click();
  // The PIN is offered once the server answers; give it that long, then read.
  await waitFor(async () => { const s = await lockState(P); return s.locked && s.mode === "pin" ? s : null; }, 4000);
  return lockState(P);
}
async function typePin(P, pin) {
  await P.page.locator("[data-lock-pin]").fill(pin);
  await P.page.locator('form[data-lock-mode] button[type="submit"]').click();
  await sleep(1200);
}
async function setPinViaSettings(P, label, password = PW) {
  await nav(P.page, "account", 1800);
  const row = await waitFor(async () => { const r = await pinRow(P); return r && r !== "loading" ? r : null; }, 8000);
  rec(`S ${label}: Settings → Security shows PIN unlock (server says not set)`, row === "unset", String(row));
  await P.page.locator("[data-pin-set]").click();
  await sleep(500);
  await checkLayout(P.page, `${label} Set PIN dialog`, ["[data-pin-dialog]"]);
  // Wrong password first: refused, nothing stored.
  await P.page.locator("[data-pin-password]").fill("not-my-password");
  await P.page.locator("[data-pin-new]").fill(PIN);
  await P.page.locator("[data-pin-confirm]").fill(PIN);
  let mark = P.apiLog.length;
  await P.page.locator("[data-pin-save]").click();
  await sleep(1500);
  let w = writes(P.apiLog, mark);
  const srv1 = (await P.api("GET", "/api/security/pin")).json;
  rec(`S ${label}: a wrong password is ONE PUT 403 and no PIN is stored`, w.length === 1 && w[0].s === 403 && srv1 && srv1.set === false && !!(await P.page.locator("[data-pin-dialog]").count()), w.map((x) => x.m + " " + x.s).join(", "));
  await P.page.locator("[data-pin-password]").fill(password);
  mark = P.apiLog.length;
  await P.page.locator("[data-pin-save]").click();
  await sleep(1500);
  w = writes(P.apiLog, mark);
  const srv2 = (await P.api("GET", "/api/security/pin")).json;
  const body = w[0] && JSON.parse(w[0].body || "{}");
  rec(`S ${label}: Set PIN is ONE PUT 200 {currentPassword, pin}; the row shows the server's answer`, w.length === 1 && w[0].m === "PUT" && w[0].s === 200 && body.pin === PIN && !!body.currentPassword
    && srv2.set === true && (await pinRow(P)) === "set" && (await P.page.locator("[data-pin-dialog]").count()) === 0, w.map((x) => x.m + " " + x.s).join(", "));
  await checkLayout(P.page, `${label} Security settings`, ["[data-pin-row]"]);
}
function writes(log, from = 0) { return log.slice(from).filter((r) => r.m !== "GET"); }

console.log("== synthetic server " + BASE);
{
  const dev = await open(BASE, 430, "DOCTURN", "dev");
  const ispn = (await dev.api("GET", "/api/dev/organizations")).json.find((o) => o.code === "ISPN");
  // M first: off by default.
  {
    const C = await open(BASE, 390, "ISPN", "patel");
    const mods = (await C.api("GET", "/api/modules")).json;
    rec("M (setup) security.pin is off by default", mods && mods.modules && mods.modules["security.pin"] === false);
    await nav(C.page, "account", 1500);
    const row = await pinRow(C);
    const put = await C.api("PUT", "/api/security/pin", { currentPassword: PW, pin: PIN });
    const s = await lockNow(C);
    rec("M security.pin off: no PIN row, PUT 404 module_disabled, the lock screen is password-only", row === null && put.status === 404 && put.json && put.json.module === "security.pin" && s && s.mode === "password" && !s.switcher, JSON.stringify({ row, put: put.status, s }));
    await checkLayout(C.page, "lock screen (password only) @390", ["form[data-lock-mode]"]);
    await C.ctx.close();
  }
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "security.pin", enabled: true });
  for (const width of [375, 390, 430]) {
    const C = await open(BASE, width, "ISPN", "chen");
    await C.api("DELETE", "/api/security/pin");
    await reload(C.page);
    const label = "@" + width;
    await setPinViaSettings(C, label);
    // U. lock, wrong PIN, right PIN.
    const meBefore = (await C.api("GET", "/api/user")).json;
    let s = await lockNow(C);
    rec(`U ${label}: Lock app now → the lock screen offers the PIN (the server said so)`, s && s.mode === "pin" && s.switcher, JSON.stringify(s));
    await checkLayout(C.page, `${label} lock screen (PIN)`, ["form[data-lock-mode]"]);
    const lockedMe = (await C.api("GET", "/api/user")).json;
    rec(`U ${label}: the server reports the session locked with pinUnlock`, lockedMe && lockedMe.locked === true && lockedMe.pinUnlock === true);
    await typePin(C, "0000");
    s = await lockState(C);
    rec(`U ${label}: a wrong PIN stays locked (data 423) and says 4 attempts are left`, s.locked && s.mode === "pin" && /4 attempts left/.test(s.alert) && (await status(C, "/api/patients")) === 423, JSON.stringify(s));
    if (width === 390) {
      await reload(C.page);
      s = await waitFor(async () => { const x = await lockState(C); return x.locked && x.mode === "pin" ? x : null; }, 8000);
      rec(`U ${label}: a reload while locked still lands on the lock screen offering the PIN`, !!s, JSON.stringify(await lockState(C)));
    }
    const sockMark = C.apiLog.length;
    await typePin(C, PIN);
    s = await waitFor(async () => { const x = await lockState(C); return !x.locked ? x : null; }, 8000);
    const meAfter = (await C.api("GET", "/api/user")).json;
    const loginCalls = C.apiLog.slice(sockMark).filter((r) => r.p === "/api/login").length;
    rec(`U ${label}: the right PIN re-opens the SAME session — data 200, no sign-in request`, !!s && (await status(C, "/api/patients")) === 200 && meAfter && meAfter.id === meBefore.id && !meAfter.locked && loginCalls === 0, JSON.stringify({ s, loginCalls }));
    const wsBack = await waitFor(() => C.page.evaluate(() => { const st = window.DT.getState(); return !!(st && st.session); }), 5000);
    rec(`U ${label}: back in the app with the session restored`, !!wsBack);
    const dump = await storageDump(C);
    rec(`U ${label}: nothing about the PIN in browser storage`, !dump.includes(PIN) && !/pinUnlock|pinStatus|"set":true/.test(dump), dump.length + " chars");
    if (width === 430) {
      // F. five wrong PINs.
      await lockNow(C);
      for (let i = 0; i < 5; i++) { if ((await lockState(C)).mode !== "pin") break; await typePin(C, "0000"); }
      s = await lockState(C);
      const right = await C.api("POST", "/api/session/unlock-pin", { pin: PIN });
      rec("F @430: 5 wrong PINs → the screen asks for the password; the server refuses even the right PIN", s.locked && s.mode === "password" && /Too many wrong PINs/.test(s.alert) && right.status === 403 && right.json && right.json.error === "pin_disabled", JSON.stringify({ s, right: right.json }));
      await C.page.locator('form[data-lock-mode="password"] input[type="password"]').fill(PW);
      await C.page.locator('form[data-lock-mode] button[type="submit"]').click();
      s = await waitFor(async () => { const x = await lockState(C); return !x.locked ? x : null; }, 10000);
      rec("F @430: the password unlocks", !!s && (await status(C, "/api/patients")) === 200);
      // I. the idle auto-lock is a logoff.
      const lk = await C.api("POST", "/api/session/lock", { idleMs: 15 * 60 * 1000 });
      const pinAfterIdle = await C.api("POST", "/api/session/unlock-pin", { pin: PIN });
      await C.page.reload({ waitUntil: "networkidle" });
      await sleep(3000);
      // The tab's own lock flag may still show the lock screen — but it can
      // only take the password (a full sign-in): no PIN is offered and the
      // server has no session left.
      const after = await lockState(C);
      const signIn = (await C.page.locator('button:has-text("Sign in")').count()) > 0;
      const me401 = (await status(C, "/api/user")) === 401;
      rec("I @430: the idle auto-lock still ends the session — PIN 401, server signed out, a reload offers no PIN", lk.status === 200 && pinAfterIdle.status === 401 && me401 && (signIn || (after.locked && after.mode === "password" && !after.switcher)), JSON.stringify({ lk: lk.status, pin: pinAfterIdle.status, me401, signIn, after }));
    }
    await C.api("DELETE", "/api/security/pin").catch(() => null);
    await C.ctx.close();
  }
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "security.pin", enabled: false });
  await dev.ctx.close();
}

if (REAL) {
  console.log("== real server " + REAL);
  const dev = await open(REAL, 390, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD);
  const cfg = (await dev.api("GET", "/api/config")).json;
  rec("Q (setup) server is SYNTHETIC_DATA=false", cfg && cfg.syntheticData === false);
  const NEWPW = "Pin-Check-2026!";
  const code = "PN" + RUN;
  const o = (await dev.api("POST", "/api/dev/organizations", { name: "Pin Check " + RUN, code, timezone: "America/Chicago" })).json;
  const r = await dev.api("POST", "/api/dev/users", { organizationId: o.id, role: "hospitalist", username: "pin.hosp", displayName: "Dr. Pin Check", credential: "MD", specialty: "Hospital Medicine", shiftType: "day", patientCap: 12 });
  const temp = r.json && r.json.temporaryPassword;
  {
    const ctx = await browser.newContext(); const pg = await ctx.newPage();
    await pg.goto(REAL + "/", { waitUntil: "domcontentloaded" });
    await pg.evaluate(async ([t, n, oc]) => {
      const j = (m, path, b) => fetch(path, { method: m, credentials: "include", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((x) => x.status);
      return [await j("POST", "/api/login", { orgCode: oc, username: "pin.hosp", password: t }), await j("PATCH", "/api/account/password", { currentPassword: t, newPassword: n }), await j("POST", "/api/logout")];
    }, [temp, NEWPW, code]);
    await ctx.close();
  }
  const H = await open(REAL, 390, code, "pin.hosp", NEWPW);
  const off = await H.api("GET", "/api/security/pin");
  rec("Q: a fresh tenant has PIN unlock off (404 module_disabled)", off.status === 404);
  await dev.api("PATCH", `/api/dev/modules/${o.id}`, { id: "security.pin", enabled: true });
  await reload(H.page);
  await nav(H.page, "account", 1800);
  const row = await waitFor(async () => { const x = await pinRow(H); return x && x !== "loading" ? x : null; }, 8000);
  const srv = (await H.api("GET", "/api/security/pin")).json;
  rec("Q: switched on, the user has no PIN until they set one (no demo PIN)", row === "unset" && srv && srv.set === false, JSON.stringify({ row, srv }));
  await setPinViaSettings(H, "Q@390", NEWPW);
  const s = await lockNow(H);
  rec("Q: the real tenant's lock screen offers the PIN", s && s.mode === "pin");
  await typePin(H, PIN);
  rec("Q: and the PIN re-opens it", !(await lockState(H)).locked && (await status(H, "/api/user")) === 200);
  await H.ctx.close(); await dev.ctx.close();
}

await browser.close();
rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
