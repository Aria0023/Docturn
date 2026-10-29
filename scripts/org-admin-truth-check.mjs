/**
 * Org-admin screens truthfulness, measured in REAL Chromium on emulated
 * iPhones (375×667 / 390×844 / 430×932, DPR 3, touch, iPhone Safari UA).
 * Each block re-runs a finder reproduction (A.CON org-admin #1–#17) against
 * the fixed client and checks the SERVER's answer, not the screen's claim:
 *
 *   A. People (director / ER director): the roster is the session org's
 *      /api/accounts — never "Mayo" or the demo users; tiles count the
 *      server's accounts; Add person creates a real account (POST
 *      /api/director/hospitalists) that the server lists; the row controls
 *      are offered only where the server allows them, and they work.
 *   B. Roles: no create / edit / delete, no invented roles or counts; the
 *      per-role counts equal the server's.
 *   C. Settings → Shift types: the server's routable set; a director's switch
 *      is persisted (another session sees it); read-only for an ER director.
 *   D. Appearance: the navigation card says "on this device"; the workspace
 *      name copy is honest; a theme change and Reset reach the server and
 *      another user sees them.
 *   E. platform.appearance off: no Appearance tab; the screen says so; a
 *      theme write is refused, surfaced and rolled back.
 *   F. Consult services: the add toast follows the server; a 503 adds nothing
 *      and says "Not saved"; two admins adding concurrently both keep theirs.
 *   G. Developer: Platform has no Rules / Permissions / Platform & mobile /
 *      Clear logs; an org's Rules are the server's values with no
 *      Inherited/Custom/Reset or On-call-only / Active-only rows; "Sign out
 *      all" ends another browser's session.
 *   H. Compliance (director): no "Clear logs".
 *   L. Layout: no horizontal overflow, every visible control ≥ 44×44 CSS px,
 *      text inputs ≥ 16 px, on every screen above at 375 / 390 / 430.
 *   Z. Zero CSP violations and zero page errors across the run.
 *   R. (REAL_BASE_URL) a SYNTHETIC_DATA=false server: a fresh org's director
 *      sees only the real accounts, no demo consult services, default theme.
 *
 *   BASE_URL=http://127.0.0.1:8300 [REAL_BASE_URL=http://127.0.0.1:8301 REAL_DEV_PASSWORD=…] \
 *     node scripts/org-admin-truth-check.mjs
 * Needs a seeded synthetic server with RATE_LIMIT=off. Exits non-zero on failure.
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
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const csp = [];
const pageErrors = [];
const DEMO_NAMES = /Lena Ortiz|Karen Vance|Priya Shah|Ruth Osei|Paul Okafor|Mayo General|Super Admin|Technician/;
// Unique per run, so the check can be re-run against the same server.
const RUN = Date.now().toString(36).slice(-5);
const NEW_USER = "sweep.t" + RUN;

async function open(base, width, org, username, password = PW, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const apiLog = [];
  page.on("pageerror", (e) => pageErrors.push(username + "@" + width + ": " + String((e && e.message) || e)));
  page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(username + ": " + t.slice(0, 160)); });
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) apiLog.push(r.method() + " " + u.pathname); });
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.log("Refused to load (CSP) " + e.violatedDirective + " " + e.blockedURI)); });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  if (opts.seedStorage) await page.evaluate((v) => { try { localStorage.setItem("docturn:store:v6", v); } catch (e) {} }, opts.seedStorage);
  else await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle" });
  const inputs = await page.locator("input").all();
  await inputs[0].fill(org);
  await inputs[1].fill(username);
  await inputs[2].fill(password);
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 20000 });
  await sleep(1200);
  const api = (method, path, body) => page.evaluate(([m, p, b]) => fetch(p, { method: m, credentials: "include", headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })), [method, path, body]);
  return { ctx, page, apiLog, api };
}
const nav = async (page, id, settle = 900) => { await page.evaluate((n) => window.DT.actions.setNav(n), id); await sleep(settle); };
const clickText = async (page, sel, re) => { const el = page.locator(sel).filter({ hasText: re }).first(); await el.click(); };
const toast = (page) => page.evaluate(() => { const t = document.querySelector("[data-toast]"); return t ? t.textContent : ""; });
const text = (page) => page.evaluate(() => document.querySelector("main").innerText);

// Layout: horizontal overflow, ≥44×44 controls, ≥16px inputs — in <main>.
async function layout(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const out = { overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw, small: [], tinyInputs: [], offscreen: [] };
    const main = document.querySelector("main");
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    for (const el of main.querySelectorAll('button, [role="button"], select, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"])')) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).trim().slice(0, 30);
      const isInput = el.tagName === "INPUT" || el.tagName === "SELECT";
      if (r.height < 43.5 || (!isInput && r.width < 43.5)) out.small.push(label + " " + Math.round(r.width) + "x" + Math.round(r.height));
      if (isInput && parseFloat(getComputedStyle(el).fontSize) < 16) out.tinyInputs.push(label);
      // Off the right edge (and not inside a horizontally scrolling strip).
      let p = el.parentElement, scroller = false;
      while (p && p !== main) { const cs = getComputedStyle(p); if (cs.overflowX === "auto" || cs.overflowX === "scroll") { scroller = true; break; } p = p.parentElement; }
      if (!scroller && r.right > vw + 0.5) out.offscreen.push(label + " right=" + Math.round(r.right));
    }
    return out;
  });
}
async function checkLayout(page, label) {
  const m = await layout(page);
  rec(`L: ${label} — no horizontal overflow`, m.overflow <= 0, "overflow=" + m.overflow + "px");
  rec(`L: ${label} — every control ≥ 44×44`, m.small.length === 0, m.small.slice(0, 6).join(" | "));
  rec(`L: ${label} — text inputs ≥ 16px`, m.tinyInputs.length === 0, m.tinyInputs.slice(0, 4).join(" | "));
  rec(`L: ${label} — nothing past the right edge`, m.offscreen.length === 0, m.offscreen.slice(0, 4).join(" | "));
}
async function openPeople(page) {
  await nav(page, "directory");
  await clickText(page, "button", /^People$/);
  await page.waitForSelector("[data-people-list] [data-person], [data-people-list]", { timeout: 15000 });
  await page.waitForFunction(() => !/Loading people/.test(document.querySelector("[data-people-list]").textContent), null, { timeout: 15000 });
  await sleep(500);
}
const cat = (u) => (u.role === "hospitalist" && /^(PA|NP|RN)$/.test(u.credential || "") ? "consultant" : u.role);

// ── A/B. Director: People + Roles, every phone width ──────────────────────
for (const width of [375, 390, 430]) {
  // A device previously signed in elsewhere: the persisted store says "MAYO".
  const stale = JSON.stringify({ v: 11, selectedOrg: "MAYO", theme: { appName: "Elsewhere", accent: "#DB2777", radius: 8, sidebar: "expanded", contentWidth: "standard" } });
  const { ctx, page, api, apiLog } = await open(BASE, width, "ISPN", "director", PW, { seedStorage: stale });
  const cfg = (await api("GET", "/api/org/config")).json;
  const accounts = (await api("GET", "/api/accounts")).json;
  await openPeople(page);
  const sub = await page.locator("[data-people-sub]").textContent();
  rec(`A@${width}: header names the session's org (server), not Mayo`, sub.includes(cfg.name) && !/Mayo/.test(sub), sub.slice(0, 90));
  const rows = await page.$$eval("[data-person]", (els) => els.map((e) => e.getAttribute("data-person")));
  const serverNames = accounts.filter((u) => u.role !== "developer").map((u) => u.username).sort();
  rec(`A@${width}: rows are exactly /api/accounts (${serverNames.length})`, JSON.stringify(rows.slice().sort()) === JSON.stringify(serverNames), "ui=" + rows.length + " server=" + serverNames.length);
  rec(`A@${width}: no demo people or orgs on screen`, !DEMO_NAMES.test(await text(page)));
  const shownTheme = await page.evaluate(() => window.DT.getState().theme.accent);
  rec(`A@${width}: the theme is the org's, not this device's previous one`, shownTheme === ((cfg.theme && cfg.theme.accent) || "#2563EB"), shownTheme);
  const tiles = await page.$$eval("[data-role-count]", (els) => Object.fromEntries(els.map((e) => [e.getAttribute("data-role-count"), Number(e.textContent)])));
  const want = {};
  for (const u of accounts) if (!u.disabled && u.role !== "developer") want[cat(u)] = (want[cat(u)] || 0) + 1;
  rec(`A@${width}: role tiles equal the server's active counts`, Object.keys(tiles).every((k) => (want[k] || 0) === tiles[k]), JSON.stringify(tiles) + " vs " + JSON.stringify(want));
  const selfRowCtl = await page.locator('[data-person="director"] button[aria-label^="Reset password"]').count();
  rec(`A@${width}: no account controls on the director's own row`, selfRowCtl === 0);
  if (width === 390) {
    // Add person → a real account.
    await clickText(page, "button", /^Add person$/);
    await sleep(300);
    await clickText(page, "button[aria-pressed]", /PA \/ NP/);
    await page.getByLabel("Full name").fill("Sweep Tester, NP");
    await page.getByLabel("Username (for sign-in)").fill(NEW_USER);
    await checkLayout(page, "People add form @390");
    const before = apiLog.length;
    await page.locator("button").filter({ hasText: /^Add person$/ }).last().click();
    await sleep(1500);
    const posted = apiLog.slice(before);
    const after = (await api("GET", "/api/accounts")).json;
    const made = after.find((u) => u.username === NEW_USER);
    rec("A: Add person POSTs the director route (never /api/dev/users)", posted.includes("POST /api/director/hospitalists") && !posted.includes("POST /api/dev/users"), posted.join(", "));
    rec("A: the server lists the new PA/NP account", !!made && made.credential === "NP" && made.role === "hospitalist", JSON.stringify(made));
    const reveal = await page.evaluate(() => (window.DT.getState().__credentialReveal || {}).temporaryPassword || "");
    rec("A: the one-time password is shown once", reveal.length >= 8);
    await page.evaluate(() => window.DT.actions.dismissCredentialReveal());
    await sleep(800);
    const newRow = await page.locator(`[data-person="${NEW_USER}"]`).count();
    rec("A: the new person appears in the roster", newRow === 1);
    // Reset password on the new account → server 200 + a fresh one-time password.
    const b2 = apiLog.length;
    await page.locator(`[data-person="${NEW_USER}"] button[aria-label^="Reset password"]`).click();
    await sleep(1200);
    const r2 = apiLog.slice(b2).find((x) => /reset-password$/.test(x));
    const reveal2 = await page.evaluate(() => (window.DT.getState().__credentialReveal || {}).temporaryPassword || "");
    rec("A: Reset password reaches the server for a real account and reveals a new password", !!r2 && reveal2.length >= 8 && reveal2 !== reveal, String(r2));
    await page.evaluate(() => window.DT.actions.dismissCredentialReveal());
    // Remove access → server says disabled.
    await page.locator(`[data-person="${NEW_USER}"] button[aria-label^="Remove access"]`).click();
    await sleep(1200);
    const dis = (await api("GET", "/api/accounts")).json.find((u) => u.username === NEW_USER);
    rec("A: Remove access is the server's (account disabled)", !!dis && dis.disabled === true);
  }
  await checkLayout(page, `People @${width}`);
  // Roles
  await clickText(page, "button", /^Roles$/);
  await sleep(900);
  const roleTxt = await text(page);
  rec(`B@${width}: no create/edit/delete role controls`, !/Create new role|Edit role|Delete role|Custom roles|Users assigned/.test(roleTxt));
  rec(`B@${width}: no invented roles (Super Admin, Technician)`, !DEMO_NAMES.test(roleTxt));
  const roleCounts = await page.$$eval("[data-org-role]", (els) => Object.fromEntries(els.map((e) => [e.getAttribute("data-org-role"), Number((e.querySelector("[data-role-accounts]").textContent.match(/^(\d+)/) || [])[1])])));
  const acc2 = (await api("GET", "/api/accounts")).json;
  const want2 = {};
  for (const u of acc2) if (!u.disabled && u.role !== "developer") want2[cat(u)] = (want2[cat(u)] || 0) + 1;
  rec(`B@${width}: per-role counts equal the server's`, Object.keys(roleCounts).length === 5 && Object.keys(roleCounts).every((k) => (want2[k] || 0) === roleCounts[k]), JSON.stringify(roleCounts) + " vs " + JSON.stringify(want2));
  await checkLayout(page, `Roles @${width}`);
  // Directory → Consult services tab and the director's Roles nav item.
  await nav(page, "roles");
  await checkLayout(page, `Roles nav @${width}`);
  await ctx.close();
}

// ── A (ER director) ────────────────────────────────────────────────────────
{
  const { ctx, page, api } = await open(BASE, 375, "ISPN", "er.director");
  await openPeople(page);
  const accounts = (await api("GET", "/api/accounts")).json;
  const rows = await page.$$eval("[data-person]", (els) => els.map((e) => e.getAttribute("data-person")));
  const want = accounts.filter((u) => u.role === "er_doctor" || u.role === "er_director").map((u) => u.username).sort();
  rec("A(ER): rows are the server's ER staff", JSON.stringify(rows.slice().sort()) === JSON.stringify(want), rows.join(","));
  const ctl = await page.$$eval("[data-person]", (els) => els.map((e) => [e.getAttribute("data-person"), !!e.querySelector('button[aria-label^="Remove access"], button[aria-label^="Restore access"]')]));
  const ok = ctl.every(([u, has]) => { const a = accounts.find((x) => x.username === u); return a && has === (a.role === "er_doctor"); });
  rec("A(ER): account controls only on ER physicians (the server's rule)", ok, JSON.stringify(ctl));
  await clickText(page, "button", /^Add person$/);
  await sleep(300);
  const chips = await page.$$eval("button[aria-pressed]", (els) => els.map((e) => e.textContent.trim()).filter((t) => /physician|director|Hospitalist|PA/.test(t)));
  rec("A(ER): Add person offers only ER physician", JSON.stringify(chips) === JSON.stringify(["ER physician"]), JSON.stringify(chips));
  await checkLayout(page, "People (ER director) @375");
  await ctx.close();
}

// ── C. Shift types ──────────────────────────────────────────────────────────
{
  const { ctx, page, api } = await open(BASE, 390, "ISPN", "director");
  await nav(page, "settings", 1500);
  await page.waitForSelector("[data-shift-type]", { timeout: 15000 });
  const shown = await page.$$eval("[data-shift-type]", (els) => els.map((e) => [e.getAttribute("data-shift-type"), e.getAttribute("data-routable")]));
  const cfg = (await api("GET", "/api/org/config")).json;
  rec("C: Shift types are the server's (day/swing/night, routable from /api/org/config)", JSON.stringify(shown.map((x) => x[0])) === '["day","swing","night"]' && shown.every(([id, r]) => (r === "yes") === cfg.roundRobinShiftTypes.includes(id)), JSON.stringify(shown) + " server=" + JSON.stringify(cfg.roundRobinShiftTypes));
  rec("C: no demo shift names (Rounding / Nocturnist)", !/Rounding|Nocturnist/.test(await text(page)));
  await page.locator('[data-shift-type="swing"] [role="switch"]').click();
  await sleep(1500);
  const cfg2 = (await api("GET", "/api/org/config")).json;
  rec("C: switching Swing on is saved on the server", cfg2.roundRobinShiftTypes.includes("swing"), JSON.stringify(cfg2.roundRobinShiftTypes));
  const er = await open(BASE, 390, "ISPN", "er.director");
  await nav(er.page, "settings", 1500);
  await er.page.waitForSelector("[data-shift-type]", { timeout: 15000 });
  const erShown = await er.page.$$eval("[data-shift-type]", (els) => els.map((e) => [e.getAttribute("data-shift-type"), e.getAttribute("data-routable"), e.querySelector('[role="switch"]').disabled]));
  rec("C: another session (ER director) sees Swing in rotation, read-only", erShown.find((x) => x[0] === "swing")[1] === "yes" && erShown.every((x) => x[2] === true), JSON.stringify(erShown));
  await er.ctx.close();
  await page.locator('[data-shift-type="swing"] [role="switch"]').click(); // restore
  await sleep(1200);
  await checkLayout(page, "Settings → Organization @390");
  await ctx.close();
}

// ── D. Appearance (theme reaches the server; honest labels) ────────────────
{
  const { ctx, page, api } = await open(BASE, 430, "ISPN", "director");
  await nav(page, "appearance", 1200);
  const t = await text(page);
  rec("D: navigation structure is labelled as this device's", /Navigation structure[\s\S]*on this device only/.test(t) && /kept on this device only/.test(t) && !/saved per role/.test(t));
  rec("D: workspace name copy is honest about the sign-in screen", /only after someone from your organization has signed in on it/.test(t) && !/Shown in the sidebar and on login\./.test(t));
  await page.locator('button[title="Violet"]').click();
  await sleep(1500);
  const cfg = (await api("GET", "/api/org/config")).json;
  rec("D: an accent change is saved on the server", cfg.theme && cfg.theme.accent === "#7C3AED", JSON.stringify(cfg.theme));
  const chen = await open(BASE, 375, "ISPN", "chen");
  const chenAccent = await chen.page.evaluate(() => window.DT.getState().theme.accent);
  rec("D: another user (chen) gets the org's accent", chenAccent === "#7C3AED", chenAccent);
  await chen.ctx.close();
  await checkLayout(page, "Appearance @430");
  await clickText(page, "button", /^Reset to defaults$/);
  await sleep(1500);
  const cfg2 = (await api("GET", "/api/org/config")).json;
  rec("D: Reset to defaults writes the defaults on the server", cfg2.theme && cfg2.theme.accent === "#2563EB" && cfg2.theme.appName === "DocTurn", JSON.stringify(cfg2.theme));
  rec("D: the Reset toast follows the server", /Appearance reset/.test(await toast(page)));
  for (const w of [375, 390]) { await page.setViewportSize({ width: w, height: SIZES[w] }); await sleep(500); await checkLayout(page, `Appearance @${w}`); }
  await ctx.close();
}

// ── E. platform.appearance off ──────────────────────────────────────────────
{
  const dev = await open(BASE, 390, "DOCTURN", "dev");
  const orgs = (await dev.api("GET", "/api/dev/organizations")).json;
  const ispn = orgs.find((o) => o.code === "ISPN");
  await dev.api("PATCH", "/api/dev/modules/" + ispn.id, { id: "platform.appearance", enabled: false });
  await sleep(5200); // the server's module cache
  const { ctx, page, api } = await open(BASE, 390, "ISPN", "director");
  await nav(page, "settings", 1200);
  const tabs = await page.$$eval("button", (els) => els.map((e) => e.textContent.trim()).filter((x) => x === "Appearance"));
  rec("E: the Appearance tab is gone while the module is off", tabs.length === 0, JSON.stringify(tabs));
  await nav(page, "appearance", 1000);
  const off = await page.locator("[data-appearance-off]").count();
  const swatches = await page.locator('button[title="Violet"]').count();
  rec("E: the screen says Appearance is switched off and offers no theme controls", off === 1 && swatches === 0);
  const before = await page.evaluate(() => window.DT.getState().theme.accent);
  await page.evaluate(() => window.DT.actions.setTheme({ accent: "#DC2626" }));
  await sleep(1500);
  const after = await page.evaluate(() => window.DT.getState().theme.accent);
  const cfg = (await api("GET", "/api/org/config")).json;
  rec("E: a theme write is refused (server keeps its accent) and rolled back on screen", after === before && cfg.theme.accent !== "#DC2626", `ui ${before}→${after} server=${cfg.theme.accent}`);
  rec("E: the refusal is shown", /Appearance not saved/.test(await toast(page)) && /switched off/.test(await toast(page)), await toast(page));
  await checkLayout(page, "Appearance (module off) @390");
  await dev.api("PATCH", "/api/dev/modules/" + ispn.id, { id: "platform.appearance", enabled: true });
  await ctx.close(); await dev.ctx.close();
}

// ── F. Consult services ─────────────────────────────────────────────────────
{
  const d = await open(BASE, 390, "ISPN", "director");
  const e = await open(BASE, 390, "ISPN", "er.director");
  // The ER director opens the screen FIRST (the race in the finding).
  await nav(e.page, "directory"); await clickText(e.page, "button", /^Consult services$/); await sleep(900);
  await nav(d.page, "consult", 1200);
  const addVia = async (s, name) => {
    await s.page.getByLabel("Add a consult service").fill(name);
    await s.page.locator("button").filter({ hasText: /^Add service$/ }).click();
    await sleep(1400);
  };
  const RD = "Race From Director " + RUN, RE = "Race From ER Director " + RUN, UNSAVED = "Unsaved Toxicology " + RUN;
  await addVia(d, RD);
  rec("F: the director's add toast came after the server saved it", /Consult service added/.test(await toast(d.page)));
  await addVia(e, RE);
  const list = (await d.api("GET", "/api/org/consult-services")).json.services.map((s) => s.name);
  rec("F: both concurrent admins keep their service on the server", list.includes(RD) && list.includes(RE), JSON.stringify(list));
  const eShows = await e.page.evaluate(() => window.DT.getState().consultServices.map((s) => s.name));
  rec("F: the ER director's screen shows the server's list (incl. the director's)", eShows.includes(RD) && eShows.includes(RE), JSON.stringify(eShows));
  await d.page.reload({ waitUntil: "networkidle" }); await sleep(1500); await nav(d.page, "consult", 1500);
  const dShows = await d.page.evaluate(() => window.DT.getState().consultServices.map((s) => s.name));
  rec("F: after reload the director still sees both", dShows.includes(RD) && dShows.includes(RE), JSON.stringify(dShows));
  // A failed save (503) must not look saved.
  await d.page.route("**/api/org/consult-services", (route) => route.request().method() === "POST" ? route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }) : route.continue());
  await addVia(d, UNSAVED);
  const shown = await d.page.evaluate(() => window.DT.getState().consultServices.map((s) => s.name));
  const srv = (await d.api("GET", "/api/org/consult-services")).json.services.map((s) => s.name);
  rec("F: a 503 adds nothing on screen or server, and says Not saved", !shown.includes(UNSAVED) && !srv.includes(UNSAVED) && /Not saved/.test(await toast(d.page)), await toast(d.page));
  const field = await d.page.getByLabel("Add a consult service").inputValue();
  rec("F: the unsaved name stays in the field for a retry", field === UNSAVED, field);
  await d.page.unroute("**/api/org/consult-services");
  for (const w of [375, 390, 430]) { await d.page.setViewportSize({ width: w, height: SIZES[w] }); await sleep(400); await checkLayout(d.page, `Consult services @${w}`); }
  await d.ctx.close(); await e.ctx.close();
}

// ── G. Developer console ────────────────────────────────────────────────────
{
  const dev = await open(BASE, 390, "DOCTURN", "dev");
  await nav(dev.page, "enterprise", 1200);
  const tabs = await dev.page.$$eval("button[aria-pressed]", (els) => els.map((e) => e.textContent.trim()));
  rec("G: Platform tabs are Security / Integrations / Compliance only", JSON.stringify(tabs) === '["Security","Integrations","Compliance"]', JSON.stringify(tabs));
  const allText = [];
  for (const t of ["Security", "Integrations", "Compliance"]) { await clickText(dev.page, "button[aria-pressed]", new RegExp("^" + t + "$")); await sleep(900); allText.push(await text(dev.page)); }
  const joined = allText.join("\n");
  rec("G: no enterprise defaults / permissions / platform toggles / Clear logs", !/Clear logs|Inherited|Enterprise defaults|Enforce two-factor|Minimum app version|View census|Approve registrations|Auto-clean old patients/.test(joined));
  await checkLayout(dev.page, "Platform @390");
  await dev.page.evaluate(() => window.DT.actions.selectOrg("ISPN"));
  await nav(dev.page, "settings", 2000);
  const orgTxt = await text(dev.page);
  rec("G: org Rules have no On-call only / Active only / Inherited / Custom / Reset", !/On-call providers only|Active \(working\) only|Inherited|Custom|Reset|Overrides enterprise|Permissions/.test(orgTxt));
  const orgs = (await dev.api("GET", "/api/dev/organizations")).json;
  const ispn = orgs.find((o) => o.code === "ISPN");
  const srv = (await dev.api("GET", "/api/dev/organizations/" + ispn.id + "/settings")).json;
  const tmo = await dev.page.getByLabel("Assignment timeout in minutes").inputValue();
  rec("G: the org page shows the server's timeout", Number(tmo) === srv.org.assignmentTimeoutMin, `ui=${tmo} server=${srv.org.assignmentTimeoutMin}`);
  await checkLayout(dev.page, "Organization config @390");
  // Sign out all ends another browser's session.
  const victim = await open(BASE, 375, "ISPN", "director");
  rec("G: (before) the other session is live", (await victim.api("GET", "/api/user")).status === 200);
  await nav(dev.page, "enterprise", 900);
  await clickText(dev.page, "button[aria-pressed]", /^Security$/);
  await sleep(400);
  await dev.page.locator("button").filter({ hasText: /^Sign out all$/ }).click();
  await sleep(1500);
  rec("G: Sign out all → the other browser is signed out (GET /api/user 401)", (await victim.api("GET", "/api/user")).status === 401);
  rec("G: the operator stays signed in", (await dev.api("GET", "/api/user")).status === 200);
  rec("G: the toast follows the server", /Everyone else is signed out/.test(await toast(dev.page)), await toast(dev.page));
  await victim.ctx.close(); await dev.ctx.close();
}

// ── H. Director Compliance: no Clear logs ──────────────────────────────────
{
  const { ctx, page } = await open(BASE, 390, "ISPN", "director");
  await nav(page, "compliance", 1500);
  rec("H: Compliance has no Clear logs", (await page.locator("button").filter({ hasText: /Clear logs/ }).count()) === 0);
  await ctx.close();
}

// ── R. SYNTHETIC_DATA=false server ─────────────────────────────────────────
if (REAL) {
  const devPw = process.env.REAL_DEV_PASSWORD;
  const dev = await open(REAL, 390, "DOCTURN", "dev", devPw);
  let orgs = (await dev.api("GET", "/api/dev/organizations")).json;
  let org = orgs.find((o) => o.code === "SWPGEN");
  if (!org) org = (await dev.api("POST", "/api/dev/organizations", { name: "Sweep General", code: "SWPGEN", timezone: "America/Chicago" })).json;
  const mk = async (username, role, displayName) => {
    const r = await dev.api("POST", "/api/dev/users", { organizationId: org.id, role, displayName, username });
    return r.json && r.json.temporaryPassword;
  };
  const NEWPW = "Real-Org-Pass-2026!";
  const temps = { "real.director": await mk("real.director", "director", "Dr. Real Director"), "real.erd": await mk("real.erd", "er_director", "Dr. Real ER Director"), "real.hosp": await mk("real.hosp", "hospitalist", "Dr. Real Hospitalist") };
  await dev.ctx.close();
  // First sign-in: replace the one-time password.
  for (const [u, tmp] of Object.entries(temps)) {
    if (!tmp) continue;
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(REAL + "/");
    await p.evaluate(async ([u, tmp, pw]) => {
      await fetch("/api/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgCode: "SWPGEN", username: u, password: tmp }) });
      await fetch("/api/account/password", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: tmp, newPassword: pw }) });
    }, [u, tmp, NEWPW]);
    await ctx.close();
  }
  const stale = JSON.stringify({ v: 11, selectedOrg: "MAYO", consultServices: [{ id: "cs_card", name: "Cardiology", onCall: null, members: [] }], theme: { appName: "Elsewhere", accent: "#DB2777", radius: 8, sidebar: "expanded", contentWidth: "standard" } });
  const { ctx, page, api } = await open(REAL, 390, "SWPGEN", "real.director", NEWPW, { seedStorage: stale });
  await openPeople(page);
  const rows = await page.$$eval("[data-person]", (els) => els.map((e) => e.getAttribute("data-person")).sort());
  const accounts = (await api("GET", "/api/accounts")).json.map((u) => u.username).sort();
  rec("R: real-mode director sees exactly the org's real accounts", JSON.stringify(rows) === JSON.stringify(accounts) && rows.length === 3, rows.join(","));
  const t = await text(page);
  rec("R: no Mayo / demo people", !DEMO_NAMES.test(t) && /Sweep General/.test(await page.locator("[data-people-sub]").textContent()));
  await nav(page, "consult", 1500);
  const cs = await page.evaluate(() => window.DT.getState().consultServices.map((s) => s.name));
  rec("R: no demo consult services (the org has none)", cs.length === 0 && /No consult services yet/.test(await text(page)), JSON.stringify(cs));
  const theme = await page.evaluate(() => window.DT.getState().theme);
  rec("R: the theme is the org's (defaults), not this device's previous one", theme.accent === "#2563EB" && theme.appName === "DocTurn", JSON.stringify(theme));
  await nav(page, "settings", 1500);
  await page.waitForSelector("[data-shift-type]", { timeout: 15000 });
  rec("R: Shift types show Day/Swing/Night, not demo names", !/Rounding|Nocturnist/.test(await text(page)));
  await nav(page, "roles", 1200);
  rec("R: Roles show no invented roles or counts", !DEMO_NAMES.test(await text(page)) && !/Users assigned/.test(await text(page)));
  await ctx.close();
}

rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await browser.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
