/**
 * Director schedule screens truthfulness (A.CON schedule #1–#7), measured in
 * REAL Chromium on emulated iPhones (375×667 / 390×844 / 430×932, DPR 3,
 * touch, iPhone Safari UA). Each block re-runs a finder reproduction against
 * the fixed client and checks the SERVER's answer, not the screen's claim:
 *
 *   1. Dashboard schedule panel = GET /api/oncall/sources (selected source,
 *      real last sync). Never "Amion · 2m ago"; a server change (PATCH to
 *      Epic, or a real Amion sync) is what the panel shows, in every browser.
 *   2. Settings → On-call schedule sync offers only Amion / Epic / Manual;
 *      no vendor or "Not configured" choice; a pick is a server write.
 *   3. No per-browser source map: localStorage never holds one; real-mode
 *      orgs named MAYO / PINE read the server's source.
 *   4. Renaming a shift (phone: Rename button → 16px field) is
 *      PATCH /api/org/shifts/:id — survives a reload, shows in a second
 *      browser, audited.
 *   5. Shift hours: none shown until set (no demo hours, also in real mode);
 *      a set hour survives a reload and shows in a second browser.
 *   6. "Reset count" is POST /api/admissions/reset — the server's count and
 *      audit row (admissions.counter_reset); no made-up audit row/IP.
 *   7. Admissions log = GET /api/admissions — an ER admission appears for the
 *      director after a reload; Clear all empties it; no demo rows anywhere,
 *      also on a SYNTHETIC_DATA=false server.
 *   L. Layout of the changed panels: no horizontal overflow, controls ≥ 44×44,
 *      inputs ≥ 16 px, nothing past the right edge.
 *   Z. Zero CSP violations and zero page errors.
 *
 *   BASE_URL=http://127.0.0.1:8300 [REAL_BASE_URL=http://127.0.0.1:8301 REAL_DEV_PASSWORD=…]
 *   [AMION_BASE_URL=http://127.0.0.1:8302] node scripts/schedule-truth-check.mjs
 * BASE_URL: a seeded synthetic server with RATE_LIMIT=off. AMION_BASE_URL: a
 * seeded server whose ISPN has an Amion feed (AMION_OCS_URL). Exits non-zero
 * on failure.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const REAL = process.env.REAL_BASE_URL || "";
const AMION = process.env.AMION_BASE_URL || "";
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
const DEMO = /\b(MJ|RV|DK|LP)\b.*(Amir Patel|Maria Lopez|Sarah Chen|Omar Haddad)|Dr\. Amir Patel|Dr\. Maria Lopez|Dr\. Omar Haddad|Day call|07:00|15:00|23:00/;
const RUN = Date.now().toString(36).slice(-4).toUpperCase().replace(/[^A-Z]/g, "Q");

async function open(base, width, org, username, password = PW) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const apiLog = [];
  page.on("pageerror", (e) => pageErrors.push(username + "@" + width + ": " + String((e && e.message) || e)));
  page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(username + ": " + t.slice(0, 160)); });
  page.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) apiLog.push({ m: r.request().method(), p: u.pathname, s: r.status() }); });
  page.on("dialog", (d) => d.accept());
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
  return { ctx, page, apiLog, api, base, width };
}
const nav = async (page, id, settle = 1000) => { await page.evaluate((n) => window.DT.actions.setNav(n), id); await sleep(settle); };
async function reload(page) {
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
  await sleep(2000);
}
const writes = (log, from = 0) => log.slice(from).filter((r) => r.m !== "GET").map((r) => `${r.m} ${r.p} ${r.s}`);
const panel = (page) => page.evaluate(() => { const el = document.querySelector("[data-schedule-panel]"); return el ? { key: el.getAttribute("data-schedule-panel"), text: el.innerText.replace(/\s+/g, " ").trim() } : null; });
async function waitPanel(page, key, ms = 8000) {
  const t = Date.now();
  let p = null;
  while (Date.now() - t < ms) { p = await panel(page); if (p && p.key === key) return p; await sleep(150); }
  return p;
}
const since = (page) => page.evaluate(() => { const el = document.querySelector("[data-admissions-since]"); return el ? el.textContent.trim() : null; });
const shiftLabel = (page, id) => page.evaluate((i) => { const el = document.querySelector(`[data-shift-label="${i}"]`); return el ? el.textContent.replace(/\s+/g, " ").trim() : null; }, id);
const hours = (page, id) => page.evaluate((i) => [...document.querySelectorAll(`[data-shift-hours="${i}"] input`)].map((x) => x.value), id);
const allHours = (page) => page.evaluate(() => [...document.querySelectorAll("[data-shift-hours] input")].map((x) => x.value));
const logRows = (page) => page.evaluate(() => [...document.querySelectorAll("[data-adm-row]")].map((r) => r.getAttribute("data-adm-row")));
const tile = (page, k) => page.evaluate((key) => { const el = document.querySelector(`[data-adm-tile="${key}"]`); return el ? el.textContent.trim() : null; }, k);
const mainText = (page) => page.evaluate(() => (document.querySelector("main") || document.body).innerText);
const toast = (page) => page.evaluate(() => { const t = document.querySelector("[data-toast]"); return t ? t.textContent : ""; });

async function layout(page, selectors) {
  return page.evaluate((sels) => {
    const vw = window.innerWidth;
    const out = { overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw, small: [], tinyInputs: [], offscreen: [], found: 0 };
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    // Each marker → the Card it sits in (the kit's Card has the large radius), deduped.
    // "card:<sel>" → the Card that marker sits in (the kit's Card has the large
    // radius); "<sel>" → the element itself. Deduped.
    const roots = [...new Set(sels.flatMap((s) => {
      const card = s.startsWith("card:");
      return [...document.querySelectorAll(card ? s.slice(5) : s)].map((el) => (card ? el.closest('div[style*="radius-lg"]') || el : el));
    }))];
    for (const root of roots) {
      out.found++;
      const rr = root.getBoundingClientRect();
      if (rr.right > vw + 0.5) out.offscreen.push("panel " + (root.getAttribute("data-schedule-panel") || root.tagName) + " right=" + Math.round(rr.right));
      for (const el of root.querySelectorAll('button, [role="button"], select, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"])')) {
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).trim().slice(0, 30);
        const isInput = el.tagName === "INPUT" || el.tagName === "SELECT";
        if (r.height < 43.5 || (!isInput && r.width < 43.5)) out.small.push(label + " " + Math.round(r.width) + "x" + Math.round(r.height));
        if (isInput && parseFloat(getComputedStyle(el).fontSize) < 16) out.tinyInputs.push(label);
        let p = el.parentElement, scroller = false;
        while (p && p !== document.body) { const cs = getComputedStyle(p); if (cs.overflowX === "auto" || cs.overflowX === "scroll") { scroller = true; break; } p = p.parentElement; }
        if (!scroller && r.right > vw + 0.5) out.offscreen.push(label + " right=" + Math.round(r.right));
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
// Markers of the changed dashboard panels (layout is checked on their Cards,
// and on the shift header rows).
const DASH_PANELS = ["card:[data-schedule-panel]", "card:[data-admissions-since]"];

// ── synthetic server ──────────────────────────────────────────────────────
console.log("== synthetic server " + BASE);
const A = await open(BASE, 375, "ISPN", "director");
const B = await open(BASE, 390, "ISPN", "director");

// #1 — the panel is the server's source
{
  const src = (await A.api("GET", "/api/oncall/sources")).json;
  const pa = await waitPanel(A.page, src.selected);
  const pb = await waitPanel(B.page, src.selected);
  rec("#1 panel names the server's selected source (" + src.selected + ")", pa && pa.key === src.selected && pb && pb.key === src.selected, JSON.stringify(pa));
  rec("#1 panel never says '2m ago' / 'synced' when the server has no sync", pa && !/2m ago/.test(pa.text) && !(src.sources[src.selected].lastSyncAt === null && /synced/i.test(pa.text)), pa && pa.text);
  rec("#1 Manual org is not called Amion", src.selected !== "manual" || (pa && !/Amion/.test(pa.text)), pa && pa.text);
  // A server-side change made in ANOTHER browser is what this one shows.
  const mark = A.apiLog.length;
  const r = await B.api("PATCH", "/api/oncall/source", { source: "amion" });
  rec("#1 (setup) server accepts PATCH source=amion from another browser", r.status === 200, "status=" + r.status);
  await A.page.evaluate(() => window.DT.actions.loadOnCallSources());
  const pe = await waitPanel(A.page, "amion");
  rec("#1 panel follows the server (Amion chosen, no feed → not connected, nothing 'synced')", pe && pe.key === "amion" && /Amion not connected/.test(pe.text) && !/synced|2m ago/i.test(pe.text), pe && pe.text);
  rec("#1 reading the panel wrote nothing", writes(A.apiLog, mark).length === 0, writes(A.apiLog, mark).join(", "));
  await B.api("PATCH", "/api/oncall/source", { source: "manual" });
  await A.page.evaluate(() => window.DT.actions.loadOnCallSources());
  const pm = await waitPanel(A.page, "manual");
  rec("#1 back to Manual: panel says Manual list", pm && pm.key === "manual" && /Manual list/.test(pm.text), pm && pm.text);
}

// #2 / #3 — Settings source picker
for (const P of [A, B]) {
  await nav(P.page, "settings", 1800);
  const sel = await P.page.evaluate(() => { const s = document.querySelector("#ss-source"); return s ? { value: s.value, options: [...s.options].map((o) => o.value), text: s.closest("[data-schedule-sync]").innerText } : null; });
  const server = (await P.api("GET", "/api/oncall/sources")).json.selected;
  rec(`#2 @${P.width} picker offers only amion/epic/manual`, sel && JSON.stringify(sel.options) === JSON.stringify(["amion", "epic", "manual"]), sel && sel.options.join(","));
  rec(`#2 @${P.width} picker shows the server's source`, sel && sel.value === server, (sel && sel.value) + " vs " + server);
  rec(`#2 @${P.width} no "Not configured" / "No schedule source" claim`, sel && !/Not configured|No schedule source for/.test(sel.text));
  rec(`#2 @${P.width} vendors named only as information`, sel && /no connector for QGenda/.test(sel.text));
  const mods = (await P.api("GET", "/api/oncall/sources")).json.modules;
  const epicOpt = await P.page.evaluate(() => { const o = document.querySelector('#ss-source option[value="epic"]'); return o ? { disabled: o.disabled, text: o.textContent } : null; });
  rec(`#2 @${P.width} Epic option follows the server's module switch (${mods.epic ? "on" : "off"})`, epicOpt && epicOpt.disabled === !mods.epic && (/switched off/.test(epicOpt.text) === !mods.epic), JSON.stringify(epicOpt));
  await checkLayout(P.page, `settings schedule sync @${P.width}`, ["card:[data-schedule-sync]"]);
}
{
  const mark = A.apiLog.length;
  await A.page.selectOption("#ss-source", "amion");
  await sleep(1500);
  const w = writes(A.apiLog, mark);
  const server = (await A.api("GET", "/api/oncall/sources")).json.selected;
  rec("#2 picking Amion is ONE server write and the server now reads Amion", w.length === 1 && /PATCH \/api\/oncall\/source 200/.test(w[0]) && server === "amion", w.join(", ") + " server=" + server);
  await nav(B.page, "dashboard", 300);
  await B.page.evaluate(() => window.DT.actions.loadOnCallSources());
  const pb = await waitPanel(B.page, "amion");
  rec("#2 the other browser's dashboard shows the server's Amion (not connected)", pb && pb.key === "amion" && /not connected/.test(pb.text), pb && pb.text);
  await A.page.selectOption("#ss-source", "manual");
  await sleep(1200);
  rec("#2 back to Manual on the server", (await A.api("GET", "/api/oncall/sources")).json.selected === "manual");
  const ls = await A.page.evaluate(() => { try { return localStorage.getItem("docturn:store:v6") || ""; } catch (e) { return ""; } });
  rec("#3 nothing about the schedule source is kept in this browser", !/scheduleSources/.test(ls) && (await A.page.evaluate(() => window.DT.getState().scheduleSources)) === undefined);
}

// #4 / #5 — shift names and hours
{
  await nav(A.page, "dashboard", 1500);
  await nav(B.page, "dashboard", 1500);
  const label0 = await shiftLabel(A.page, "day");
  rec("#4 shift label is the server's", label0 === (await A.api("GET", "/api/org/shifts")).json.shifts[0].label, label0);
  const name = "Day Team " + RUN;
  const mark = A.apiLog.length;
  await A.page.locator('[data-shift-label="day"] button').click();
  const field = A.page.locator('[data-shift-label-input="day"]');
  const fs = await field.evaluate((el) => ({ font: parseFloat(getComputedStyle(el).fontSize), h: el.getBoundingClientRect().height }));
  rec("#4 phone rename field is ≥16px and ≥44px tall", fs.font >= 16 && fs.h >= 43.5, JSON.stringify(fs));
  await field.fill(name);
  await field.press("Enter");
  await sleep(1500);
  const w = writes(A.apiLog, mark);
  rec("#4 rename is a server write (PATCH /api/org/shifts/day 200)", w.length === 1 && /PATCH \/api\/org\/shifts\/day 200/.test(w[0]), w.join(", "));
  rec("#4 success toast only after the server", /Shift renamed/.test(await toast(A.page)), await toast(A.page));
  await reload(A.page);
  rec("#4 rename survives a reload", (await shiftLabel(A.page, "day")) === name, await shiftLabel(A.page, "day"));
  await reload(B.page);
  rec("#4 a second browser shows the rename", (await shiftLabel(B.page, "day")) === name, await shiftLabel(B.page, "day"));
  const shiftSel = await A.page.evaluate(() => [...document.querySelectorAll("main select")].some((s) => [...s.options].some((o) => o.textContent === document.querySelector('[data-shift-label="day"]').textContent.trim())));
  rec("#4 provider shift selects use the org's name", shiftSel);

  // #5 hours
  const before = await hours(A.page, "day");
  const mark2 = A.apiLog.length;
  const start = A.page.locator('[data-shift-hours="day"] input').first();
  await start.fill("06:30");
  await start.blur();
  await sleep(1500);
  const w2 = writes(A.apiLog, mark2);
  rec("#5 setting the start hour is a server write", w2.length === 1 && /PATCH \/api\/org\/shifts\/day 200/.test(w2[0]), "before=" + before + " " + w2.join(", "));
  await reload(A.page);
  rec("#5 the hour survives a reload", (await hours(A.page, "day"))[0] === "06:30", JSON.stringify(await hours(A.page, "day")));
  await reload(B.page);
  rec("#5 a second browser shows the hour", (await hours(B.page, "day"))[0] === "06:30", JSON.stringify(await hours(B.page, "day")));
  const others = await A.page.evaluate(() => [...document.querySelectorAll('[data-shift-hours="swing"] input, [data-shift-hours="night"] input')].map((x) => x.value));
  rec("#5 shifts nobody timed show no hours (no demo 15:00/23:00/07:00)", others.every((v) => v === ""), JSON.stringify(others));
  const aud = (await A.api("GET", "/api/audit")).json;
  const rows = (aud.audit || []).filter((r) => r.action === "org.shift_update");
  rec("#4/#5 both changes are in the server audit", rows.length >= 2, "rows=" + rows.length);
  for (const P of [A, B]) await checkLayout(P.page, `dashboard schedule/shift/admissions panels @${P.width}`, DASH_PANELS.concat(["[data-shift-hours]", "[data-shift-label]"]));
}

// #6 / #7 — admissions
{
  const er = await open(BASE, 430, "ISPN", "er.doc");
  const p = await er.api("POST", "/api/patients", { initials: RUN.slice(0, 2), roomNumber: "Bay " + RUN, issueSummary: "synthetic schedule check", specialty: "Cardiology" });
  const as = await er.api("POST", "/api/assignments", { patientId: p.json && p.json.id, mode: "round_robin" });
  rec("#7 (setup) ER admission accepted by the server", p.status === 201 && as.status === 201, p.status + "/" + as.status);
  await reload(A.page);
  await nav(A.page, "admissions", 1800);
  const srv = (await A.api("GET", "/api/admissions")).json;
  const rows = await logRows(A.page);
  rec("#7 log rows are exactly the server's", JSON.stringify(rows) === JSON.stringify(srv.rows.map((r) => r.initials)), JSON.stringify(rows) + " vs " + JSON.stringify(srv.rows.map((r) => r.initials)));
  rec("#7 the ER's new admission is in the director's log after a reload", rows.includes(RUN.slice(0, 2)));
  rec("#7 tiles are the server's counts", (await tile(A.page, "total")) === String(srv.total) && (await tile(A.page, "last24h")) === String(srv.last24h) && (await tile(A.page, "sinceReset")) === String(srv.sinceReset),
    [await tile(A.page, "total"), await tile(A.page, "last24h"), await tile(A.page, "sinceReset")].join("/") + " vs " + [srv.total, srv.last24h, srv.sinceReset].join("/"));
  rec("#7 no demo admissions", !DEMO.test(await mainText(A.page)));
  await checkLayout(A.page, "admissions log @375", ["main"]);
  await er.ctx.close();

  // #6 Reset count
  await nav(A.page, "dashboard", 1500);
  const c0 = await since(A.page);
  rec("#6 counter is the server's sinceReset", c0 === String(srv.sinceReset), c0 + " vs " + srv.sinceReset);
  const mark = A.apiLog.length;
  await A.page.locator('button:has-text("Reset count")').click();
  await sleep(1500);
  const w = writes(A.apiLog, mark);
  rec("#6 Reset count is ONE server write (POST /api/admissions/reset 200)", w.length === 1 && /POST \/api\/admissions\/reset 200/.test(w[0]), w.join(", "));
  rec("#6 counter shows the server's 0", (await since(A.page)) === "0", await since(A.page));
  const aud = (await A.api("GET", "/api/audit")).json;
  rec("#6 the reset is in the server's audit trail", (aud.audit || []).some((r) => r.action === "admissions.counter_reset"));
  await reload(A.page);
  rec("#6 the reset survives a reload", (await since(A.page)) === "0", await since(A.page));
  await reload(B.page);
  rec("#6 a second browser shows the reset", (await since(B.page)) === "0", await since(B.page));
  await nav(A.page, "compliance", 2000);
  const audit = await A.page.evaluate(() => window.DT.getState().audit || []);
  rec("#6 Compliance shows the server row, no made-up local row / IP", audit.some((r) => r.action === "admissions.counter_reset") && !audit.some((r) => r.action === "reset_admissions_counter" || r.ip === "10.2.7.40"),
    "rows=" + audit.filter((r) => /admissions/.test(r.action)).map((r) => r.action + "@" + r.ip).join(","));

  // #7 Clear all empties the server and the log follows
  await nav(A.page, "admissions", 1500);
  await A.page.locator('button:has-text("Clear all")').click();
  await sleep(2000);
  await reload(A.page);
  await nav(A.page, "admissions", 1800);
  const after = (await A.api("GET", "/api/admissions")).json;
  rec("#7 Clear all: server log empty, screen empty, Total logged 0, no demo rows",
    after.total === 0 && (await logRows(A.page)).length === 0 && (await tile(A.page, "total")) === "0" && !DEMO.test(await mainText(A.page)),
    "server=" + after.total + " rows=" + (await logRows(A.page)).length + " total=" + (await tile(A.page, "total")));
}
await A.ctx.close(); await B.ctx.close();

// ── Amion server: a real sync is what the panel says ─────────────────────
if (AMION) {
  console.log("== amion server " + AMION);
  const D = await open(AMION, 390, "ISPN", "director");
  const s = await D.api("POST", "/api/amion/sync-now", {});
  rec("A (setup) Amion sync-now ok", s.status === 200, "status=" + s.status);
  const src = (await D.api("GET", "/api/oncall/sources")).json;
  await D.page.evaluate(() => window.DT.actions.loadOnCallSources());
  const p = await waitPanel(D.page, "amion");
  const rc = src.sources.amion.rowCount;
  rec("A panel: synced from Amion with the server's time and slot count", p && p.key === "amion" && /synced from Amion/.test(p.text) && new RegExp("Synced (just now|1 min ago) · " + rc + " slot").test(p.text) && !/2m ago/.test(p.text), p && p.text);
  rec("A the line says what an Amion pull really does", p && /Each Amion pull puts everyone on the grid on shift/.test(p.text), p && p.text);
  await checkLayout(D.page, "amion dashboard @390", ["card:[data-schedule-panel]"]);
  await D.ctx.close();
}

// ── SYNTHETIC_DATA=false server: no demo data, server answers only ───────
if (REAL) {
  console.log("== real server " + REAL);
  const dev = await open(REAL, 390, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD);
  const cfg = (await dev.api("GET", "/api/config")).json;
  rec("R (setup) server is SYNTHETIC_DATA=false", cfg && cfg.syntheticData === false);
  const NEWPW = "Fix-Director-2026!";
  for (const [code, name] of [["SWPGEN", "Sweep General Hospital"], ["MAYO", "Mayo Fix Medical Center"], ["PINE", "Pine Fix Hospital"]]) {
    let org = ((await dev.api("GET", "/api/dev/organizations")).json || []).find((o) => o.code === code);
    if (!org) org = (await dev.api("POST", "/api/dev/organizations", { name, code, timezone: "America/Chicago" })).json;
    const u = await dev.api("POST", "/api/dev/users", { organizationId: org.id, role: "director", username: "fx.director", displayName: "Dr. Real Director " + code });
    const temp = u.json && u.json.temporaryPassword;
    if (temp) {
      const ctx = await browser.newContext(); const pg = await ctx.newPage();
      await pg.goto(REAL + "/", { waitUntil: "domcontentloaded" });
      await pg.evaluate(async ([c, t, n]) => {
        const j = (m, path, b) => fetch(path, { method: m, credentials: "include", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.status);
        return [await j("POST", "/api/login", { orgCode: c, username: "fx.director", password: t }), await j("PATCH", "/api/account/password", { currentPassword: t, newPassword: n }), await j("POST", "/api/logout")];
      }, [code, temp, NEWPW]);
      await ctx.close();
    }
  }
  await dev.ctx.close();
  for (const [code, width] of [["SWPGEN", 375], ["MAYO", 390], ["PINE", 430]]) {
    const P = await open(REAL, width, code, "fx.director", NEWPW);
    const src = (await P.api("GET", "/api/oncall/sources")).json;
    const p = await waitPanel(P.page, src.selected);
    rec(`R ${code} panel = server source (${src.selected}), no '2m ago', no vendor`, p && p.key === src.selected && !/2m ago|QGenda|Not configured|synced/i.test(p.text), p && p.text);
    rec(`R ${code} no demo shift hours`, (await allHours(P.page)).every((v) => v === ""), JSON.stringify(await allHours(P.page)));
    const srv = (await P.api("GET", "/api/admissions")).json;
    await sleep(500);
    rec(`R ${code} admissions counter = server (${srv.sinceReset})`, (await since(P.page)) === String(srv.sinceReset), await since(P.page));
    await nav(P.page, "admissions", 1500);
    rec(`R ${code} admissions log = server rows (${srv.total}), no demo rows`, (await logRows(P.page)).length === srv.rows.length && (await tile(P.page, "total")) === String(srv.total) && !DEMO.test(await mainText(P.page)),
      "rows=" + (await logRows(P.page)).length + " total=" + (await tile(P.page, "total")));
    await nav(P.page, "settings", 1800);
    const sel = await P.page.evaluate(() => { const s = document.querySelector("#ss-source"); return s ? { value: s.value, text: s.closest("[data-schedule-sync]").innerText } : null; });
    rec(`R ${code} settings picker = server source; no QGenda/Not-configured claim`, sel && sel.value === src.selected && !/connector yet|No schedule source for|DocTurn has no QGenda connector/.test(sel.text), sel && sel.value);
    await nav(P.page, "dashboard", 1200);
    await checkLayout(P.page, `real ${code} dashboard @${width}`, DASH_PANELS.concat(["[data-shift-hours]"]));
    await P.ctx.close();
  }
}

await browser.close();
rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
