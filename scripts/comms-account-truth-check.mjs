/**
 * Comms / account screens truthfulness (A.CON comms-account #1–#15), measured
 * in REAL Chromium on emulated iPhones (375×667 / 390×844 / 430×932, DPR 3,
 * touch, iPhone Safari UA). Each block re-runs a finder reproduction (t1–t8)
 * against the fixed client and checks the SERVER's answer — what it stored,
 * what a second browser and another role see, what survives a reload — not
 * the screen's claim.
 *
 *   1  Settings → On shift = PATCH /api/hospitalists/:id/working-status; the
 *      director, a reload and a second browser agree; a director's change
 *      shows in the clinician's Settings; audited; no profile → no switch.
 *   2  The profile name is read-only (no edit, no write).
 *   3–6 Compliance shows no Clear logs / Security incidents / Open incidents /
 *      Denied access / Allowed / Purpose / System logs.
 *   7  Tiles = the trails' TRUE sizes (after 110 sign-ins: > 100 audit rows).
 *   8  Export = the server's CSV: every row, ISO UTC times, actor + role.
 *   9  A clinician's Compliance = their own trail (GET /api/audit/mine).
 *   10 Broadcast audience: only the chosen roles get it (banner, list, ack).
 *   11 No Require-ack switch; Info is stored as info with no ack.
 *   12 No Emergency level.
 *   13 "Online" = a live socket (another browser signing in / out), never shift.
 *   14 Thread details state no message count.
 *   15 A failed DND save leaves DND on (screen and server agree).
 *   R  SYNTHETIC_DATA=false server: no demo threads / broadcasts / trail.
 *   L  Layout of the changed screens: no overflow, controls ≥ 44×44, inputs ≥ 16px.
 *   Z  Zero CSP violations, zero page errors.
 *
 *   BASE_URL=http://127.0.0.1:8300 [REAL_BASE_URL=http://127.0.0.1:8301 REAL_DEV_PASSWORD=…]
 *   node scripts/comms-account-truth-check.mjs
 * BASE_URL: a freshly seeded synthetic server with RATE_LIMIT=off. Exits non-zero on failure.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const REAL = process.env.REAL_BASE_URL || "";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const PW = process.env.DEV_PASSWORD || "docturn";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const SIZES = { 375: 667, 390: 844, 430: 932 };
const results = [];
const rec = (name, ok, note = "") => { results.push([name, !!ok]); console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  ↳ " + String(note).slice(0, 300) : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const csp = [];
const pageErrors = [];
const DEMO = /Dr\. Sarah Chen|ICU Care Team|Code stroke — Bed 4 ICU|Mass casualty drill|Diversion lifted — accepting transfers/;
const RUN = Date.now().toString(36).slice(-4);

async function open(base, width, org, username, password = PW) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA, acceptDownloads: true });
  const page = await ctx.newPage();
  const apiLog = [];
  page.on("pageerror", (e) => pageErrors.push(username + "@" + width + ": " + String((e && e.message) || e)));
  page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(username + ": " + t.slice(0, 160)); });
  page.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) apiLog.push({ m: r.request().method(), p: u.pathname + u.search, s: r.status(), body: r.request().postData() }); });
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
  await sleep(1800);
  const api = (method, path, body) => page.evaluate(([m, p, b]) => fetch(p, { method: m, credentials: "include", headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })), [method, path, body]);
  return { ctx, page, apiLog, api, base, width, username };
}
const nav = async (page, id, settle = 1200) => { await page.evaluate((n) => window.DT.actions.setNav(n), id); await sleep(settle); };
async function reload(page) {
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
  await sleep(2200);
}
const writes = (log, from = 0) => log.slice(from).filter((r) => r.m !== "GET").map((r) => `${r.m} ${r.p} ${r.s}`);
const mainText = (page) => page.evaluate(() => (document.querySelector("main") || document.body).innerText);
const lastToast = (page) => page.evaluate(() => { const t = window.DT.getState().__toast; return t ? (t.title || "") + " — " + (t.msg || "") : ""; });
async function waitFor(fn, ms = 8000) { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(200); } return v; }
const tap = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s); if (!b) return false; b.scrollIntoView({ block: "center" }); b.click(); return true; }, sel);
const tapButton = (page, re, scope = "main") => page.evaluate(([src, sc]) => {
  const rx = new RegExp(src);
  const b = [...document.querySelectorAll(sc + " button")].find((x) => rx.test((x.textContent || "").trim()));
  if (!b) return false; b.scrollIntoView({ block: "center" }); b.click(); return true;
}, [re.source, scope]);
// A sign-in from a throwaway context (API only) — e.g. to grow the trail.
async function apiLogin(base, org, username, password = PW) {
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgCode: org, username, password }) });
  return r.status;
}

async function layout(page, selectors) {
  return page.evaluate((sels) => {
    const vw = window.innerWidth;
    const out = { overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw, small: [], tinyInputs: [], offscreen: [], found: 0 };
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    const roots = [...new Set(sels.flatMap((s) => [...document.querySelectorAll(s)]))];
    for (const root of roots) {
      out.found++;
      const rr = root.getBoundingClientRect();
      if (rr.right > vw + 0.5) out.offscreen.push("panel right=" + Math.round(rr.right));
      for (const el of root.querySelectorAll('button, [role="button"], select, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]), textarea')) {
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).trim().slice(0, 30);
        const isInput = el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA";
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
  rec(`L: ${label} — inputs ≥ 16px`, m.tinyInputs.length === 0, m.tinyInputs.slice(0, 4).join(" | "));
  rec(`L: ${label} — nothing past the right edge`, m.offscreen.length === 0, m.offscreen.slice(0, 4).join(" | "));
}

// ── synthetic server ──────────────────────────────────────────────────────
console.log("== synthetic server " + BASE);
const Dir = await open(BASE, 390, "ISPN", "director");
const accounts = (await Dir.api("GET", "/api/accounts")).json || [];
const idOf = (u) => (accounts.find((a) => a.username === u) || {}).id;
const hosps = (await Dir.api("GET", "/api/hospitalists")).json || [];
const chenH = hosps.find((h) => h.userId === idOf("chen"));
rec("(setup) director reads accounts + chen's rotation profile", !!chenH && !!idOf("patel"), "chen h=" + (chenH && chenH.id));

// ── #1 On shift (t1) ──
const C1 = await open(BASE, 375, "ISPN", "chen");
await nav(C1.page, "account", 1500);
const sw = (page) => page.evaluate(() => { const b = document.querySelector('button[aria-label="On shift"]'); return b ? { pressed: b.getAttribute("aria-pressed"), w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height, row: (document.querySelector("[data-onshift-row]") || {}).innerText || "" } : null; });
let s1 = await sw(C1.page);
rec("#1 switch reads the server (chen working:true → pressed)", s1 && s1.pressed === "true" && /On shift — round-robin can send you new admissions/.test(s1.row), JSON.stringify(s1));
rec("#1 switch is a 44×44 target", s1 && s1.w >= 44 && s1.h >= 44, s1 && `${s1.w}x${s1.h}`);
let mark = C1.apiLog.length;
await tap(C1.page, 'button[aria-label="On shift"]');
await waitFor(async () => (await sw(C1.page) || {}).pressed === "false");
rec("#1 tap = PATCH /api/hospitalists/:id/working-status 200", writes(C1.apiLog, mark).some((x) => new RegExp(`PATCH /api/hospitalists/${chenH.id}/working-status 200`).test(x)), writes(C1.apiLog, mark).join(", "));
const dSee = ((await Dir.api("GET", "/api/hospitalists")).json || []).find((h) => h.id === chenH.id);
rec("#1 the director's GET /api/hospitalists now says working:false", dSee && dSee.working === false);
s1 = await sw(C1.page);
rec("#1 Settings says Off shift (from the server's answer)", s1 && s1.pressed === "false" && /Off shift — round-robin skips you/.test(s1.row), s1 && s1.row);
await reload(C1.page);
await nav(C1.page, "account", 1500);
rec("#1 still Off after a reload", ((await sw(C1.page)) || {}).pressed === "false");
const C1b = await open(BASE, 430, "ISPN", "chen");
await nav(C1b.page, "account", 1500);
rec("#1 a second browser for chen also says Off", ((await sw(C1b.page)) || {}).pressed === "false");
await C1b.ctx.close();
// Reverse: the director puts chen back on shift; chen's fresh Settings follows.
await Dir.api("PATCH", `/api/hospitalists/${chenH.id}/working-status`, { working: true });
await reload(C1.page);
await nav(C1.page, "account", 1500);
s1 = await sw(C1.page);
rec("#1 the director's change shows in chen's Settings (On, pressed)", s1 && s1.pressed === "true" && /On shift/.test(s1.row), JSON.stringify(s1));
const aud1 = ((await Dir.api("GET", "/api/audit")).json || {}).audit || [];
rec("#1 both changes audited (hospitalist.working_status: self + director)", aud1.filter((r) => r.action === "hospitalist.working_status").length >= 2 && aud1.some((r) => r.action === "hospitalist.working_status" && r.details && r.details.self === true), aud1.filter((r) => r.action === "hospitalist.working_status").map((r) => r.actorName).join(","));
await checkLayout(C1.page, "chen Settings @375", ["main"]);

// ── #2 name is read-only ──
mark = C1.apiLog.length;
const nameTap = await C1.page.evaluate(() => {
  const el = document.querySelector("[data-profile-name]");
  if (!el) return null;
  const before = document.querySelectorAll("main input").length;
  el.click();
  return { before, rename: typeof window.DT.actions.renameMe };
});
await sleep(400);
const inputsAfter = await C1.page.evaluate(() => document.querySelectorAll("main input").length);
rec("#2 tapping the profile name opens no editor and writes nothing", nameTap && inputsAfter === nameTap.before && writes(C1.apiLog, mark).length === 0 && nameTap.rename === "undefined", JSON.stringify(nameTap));
const sideEditable = await C1.page.evaluate(() => { window.DT.actions.setNav("account"); return !!document.querySelector("aside input"); });
rec("#2 no editable name in the sidebar/drawer", !sideEditable);

// ── wu (no rotation profile) on iPhone (t8) ──
const W = await open(BASE, 430, "ISPN", "wu");
await nav(W.page, "account", 1500);
const wuRow = await W.page.evaluate(() => { const r = document.querySelector("[data-onshift-row]"); return r ? { kind: r.getAttribute("data-onshift-row"), sw: !!document.querySelector('button[aria-label="On shift"]') } : null; });
rec("#1 wu (no rotation profile): told so, no switch", wuRow && wuRow.kind === "none" && !wuRow.sw, JSON.stringify(wuRow));

// ── #9 clinician's own trail (t2 / t8) ──
for (const P of [C1, W]) {
  await nav(P.page, "compliance", 2000);
  const mine = (await P.api("GET", "/api/audit/mine")).json || {};
  const t = await mainText(P.page);
  const re = new RegExp("Your audit events\\s*" + Number(mine.auditCount).toLocaleString("en-US").replace(/,/g, ",?"));
  rec(`#9 ${P.username}: tiles = GET /api/audit/mine (audit ${mine.auditCount}, PHI ${mine.phiAccessCount}), not zeros`, mine.scope === "mine" && mine.auditCount > 0 && re.test(t), t.slice(0, 160).replace(/\s+/g, " "));
  rec(`#9 ${P.username}: no 403 from /api/audit on the way`, !P.apiLog.some((r) => r.p === "/api/audit" && r.s === 403));
  rec(`#9 ${P.username}: only their own rows`, (mine.audit || []).every((r) => r.userId === idOf(P.username)) && (mine.phiAccess || []).every((r) => r.userId === idOf(P.username)));
}
const [dlMine] = await Promise.all([C1.page.waitForEvent("download", { timeout: 15000 }).catch(() => null), tap(C1.page, "[data-compliance-export] button")]);
let mineCsv = "";
if (dlMine) { const p = await dlMine.path(); mineCsv = p ? (await import("node:fs")).readFileSync(p, "utf8") : ""; }
const mineRows = mineCsv.trim().split(/\r?\n/).slice(1);
rec("#9 chen's Export = scope=mine CSV of chen's rows only", !!dlMine && /docturn-audit-ISPN-mine-/.test(dlMine.suggestedFilename()) && mineRows.length > 0 && mineRows.every((l) => l.includes('"chen"')), dlMine ? dlMine.suggestedFilename() + " rows=" + mineRows.length : "no download");
await checkLayout(C1.page, "chen My audit trail @375", ["main"]);
await checkLayout(W.page, "wu My audit trail @430", ["main"]);

// ── #7 / #8 org trail (t2 / t7) ──
for (let i = 0; i < 4; i++) await apiLogin(BASE, "ISPN", "chen", "wrong-password-" + i);
for (let i = 0; i < 110; i++) await apiLogin(BASE, "ISPN", "er.doc");
await nav(Dir.page, "compliance", 2500);
const org = (await Dir.api("GET", "/api/audit")).json || {};
const td = await mainText(Dir.page);
const fmt = (n) => Number(n).toLocaleString("en-US");
rec("#7 after 110 sign-ins the Audit events tile is the TRUE total (> 100)", org.auditCount > 110 && td.includes("Audit events\n" + fmt(org.auditCount)) || new RegExp("Audit events\\s*" + fmt(org.auditCount)).test(td), "auditCount=" + org.auditCount);
rec("#7 PHI accesses tile = phiAccessCount", new RegExp("PHI accesses\\s*" + fmt(org.phiAccessCount)).test(td), "phiAccessCount=" + org.phiAccessCount);
rec("#7 the table says it is the newest page of the total", new RegExp("newest 100 of " + fmt(org.auditCount)).test(td));
rec("#3–#6 no Clear logs / Security incidents / Open incidents / Denied access / System logs", !/Clear logs|Security incidents|Open incidents|Denied access|System logs/.test(td));
rec("#7 rows name actor + role (no 'User N')", /Dr\. Erin Reyes/.test(td) && !/\bUser \d+\b/.test(td));
await Dir.page.evaluate(() => { const b = document.querySelector('[data-compliance-tab="phi"]'); if (b) b.click(); });
await sleep(400);
const tp = await mainText(Dir.page);
rec("#5 PHI tab: no Allowed / Denied / Purpose; shows method + IP", !/Allowed|Denied|Purpose/.test(tp) && /GET/.test(tp) && /(\d+\.\d+\.\d+\.\d+|::)/.test(tp), tp.slice(0, 200).replace(/\s+/g, " "));
await Dir.page.evaluate(() => { const b = document.querySelector('[data-compliance-tab="audit"]'); if (b) b.click(); });
await sleep(300);
const before8 = (await Dir.api("GET", "/api/audit")).json.auditCount;
const [dl] = await Promise.all([Dir.page.waitForEvent("download", { timeout: 15000 }).catch(() => null), tap(Dir.page, "[data-compliance-export] button")]);
let csv = "";
if (dl) { const p = await dl.path(); csv = p ? (await import("node:fs")).readFileSync(p, "utf8") : ""; }
const lines = csv.trim().split(/\r?\n/);
rec("#8 Export downloads the server's CSV (GET /api/audit/export)", !!dl && /docturn-audit-ISPN-\d{4}-\d{2}-\d{2}\.csv/.test(dl.suggestedFilename()) && Dir.apiLog.some((r) => r.p === "/api/audit/export?trail=audit&scope=org" && r.s === 200), dl ? dl.suggestedFilename() : "none");
rec("#8 every row of the trail (not the 100 on screen)", lines.length - 1 >= before8 && lines.length - 1 > 100, `rows=${lines.length - 1} auditCount=${before8}`);
rec("#8 header + ISO UTC timestamps + actor/username/role", lines[0] === '"occurred_at_utc","actor","actor_username","actor_role","operator","action","resource_type","resource_id","risk","details"' && /^"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z","Dr\. Erin Reyes","er\.doc","er_doctor"/m.test(csv), lines[1]);
rec("#8 the toast reports the row count", /Exported [\d,]+ rows/.test(await lastToast(Dir.page)), await lastToast(Dir.page));
rec("#8 the export is itself an audit row", ((await Dir.api("GET", "/api/audit")).json.audit || []).some((r) => r.action === "audit.export" && r.details && r.details.trail === "audit"));
const [dlp] = await Promise.all([Dir.page.waitForEvent("download", { timeout: 15000 }).catch(() => null), (async () => { await Dir.page.evaluate(() => document.querySelector('[data-compliance-tab="phi"]').click()); await sleep(200); await tap(Dir.page, "[data-compliance-export] button"); })()]);
let pcsv = "";
if (dlp) { const p = await dlp.path(); pcsv = p ? (await import("node:fs")).readFileSync(p, "utf8") : ""; }
rec("#8 PHI export: method/resource/ids/IP, no allowed/purpose", /^"occurred_at_utc","actor","actor_username","actor_role","operator","method","resource","resource_id","patient_id","ip","user_agent"/.test(pcsv) && !/allowed|purpose/i.test(pcsv.split(/\r?\n/)[0]), pcsv.split(/\r?\n/)[0]);
await checkLayout(Dir.page, "director Compliance @390", ["main"]);
const ED = await open(BASE, 430, "ISPN", "er.director");
await nav(ED.page, "compliance", 2500);
rec("#7 ER director sees the same true total", new RegExp("Audit events\\s*" + fmt(((await ED.api("GET", "/api/audit")).json || {}).auditCount)).test(await mainText(ED.page)));
await checkLayout(ED.page, "ER director Compliance @430", ["main"]);

// ── #10–#12 broadcasts (t3) ──
await nav(Dir.page, "broadcasts", 1500);
const comp = await Dir.page.evaluate(() => ({
  sev: [...document.querySelectorAll("[data-broadcast-severity]")].map((b) => b.getAttribute("data-broadcast-severity")),
  aud: [...document.querySelectorAll("[data-broadcast-audience]")].map((b) => b.getAttribute("data-broadcast-audience")),
  ackSwitch: /Require acknowledgement/.test(document.querySelector("main").innerText),
}));
rec("#12 no Emergency level (info / warning / critical only)", comp.sev.join(",") === "info,warning,critical", comp.sev.join(","));
rec("#11 no Require-acknowledgement switch; the ack rule is stated", !comp.ackSwitch && !!(await Dir.page.$("[data-broadcast-ack-rule]")));
const title10 = "ER directors only " + RUN;
await Dir.page.locator('input[placeholder="Short, scannable headline"]').fill(title10);
await tap(Dir.page, '[data-broadcast-audience="er_director"]');
await sleep(200);
mark = Dir.apiLog.length;
await tapButton(Dir.page, /^Send broadcast$/);
await waitFor(async () => /Broadcast sent/.test(await lastToast(Dir.page)));
const post = Dir.apiLog.slice(mark).find((r) => r.m === "POST" && r.p === "/api/broadcasts");
rec("#10 POST carries the audience", post && post.s === 201 && JSON.parse(post.body).audience.join(",") === "er_director", post && post.body);
rec("#10 toast = the server's count and roles", /Sent to 1 person \(ER directors\)/.test(await lastToast(Dir.page)), await lastToast(Dir.page));
const bList = (await C1.api("GET", "/api/broadcasts")).json || [];
rec("#10 chen (hospitalist) never receives it", !bList.some((b) => b.message === title10));
rec("#10 chen gets no banner for it", !(await C1.page.evaluate((t) => [...document.querySelectorAll(".dt-broadcast-banner-item")].some((x) => x.textContent.includes(t)), title10)));
await sleep(800);
const banner = await waitFor(() => ED.page.evaluate((t) => [...document.querySelectorAll(".dt-broadcast-banner-item")].some((x) => x.textContent.includes(t)), title10), 6000);
rec("#10 the ER director gets the pinned banner with Acknowledge", banner);
await ED.page.evaluate((t) => { const it = [...document.querySelectorAll(".dt-broadcast-banner-item")].find((x) => x.textContent.includes(t)); if (it) it.querySelector("button").click(); }, title10);
await sleep(1200);
const tally = ((await Dir.api("GET", "/api/broadcasts")).json || []).find((b) => b.message === title10);
rec("#10 tally counts only the audience (1/1 after their ack)", tally && tally.total === 1 && tally.ackCount === 1 && tally.audience.join(",") === "er_director", tally && JSON.stringify({ total: tally.total, ack: tally.ackCount }));
await reload(Dir.page);
await nav(Dir.page, "broadcasts", 1500);
rec("#10 after reload the card says who it went to", /To: ER directors/.test(await mainText(Dir.page)));
// Info: stored as info, no ack, nobody gets an Acknowledge button.
const title11 = "Info only " + RUN;
await Dir.page.locator('input[placeholder="Short, scannable headline"]').fill(title11);
await tap(Dir.page, '[data-broadcast-severity="info"]');
await sleep(200);
rec("#11 Info → the ack rule reads 'No acknowledgement'", (await Dir.page.getAttribute("[data-broadcast-ack-rule]", "data-broadcast-ack-rule")) === "none");
await tapButton(Dir.page, /^Send broadcast$/);
await waitFor(async () => /Broadcast sent/.test(await lastToast(Dir.page)));
const info = ((await C1.api("GET", "/api/broadcasts")).json || []).find((b) => b.message === title11);
rec("#11 the server stored info with ackRequired:false (no promotion)", info && info.severity === "info" && info.ackRequired === false, info && JSON.stringify({ sev: info.severity, ack: info.ackRequired }));
await checkLayout(Dir.page, "director Broadcasts @390", ["main"]);

// ── #13 / #14 presence (t4) ──
const patelId = idOf("patel"), dirId = idOf("director");
const mk = async (other) => { const r = await C1.api("POST", "/api/messaging/conversations", { type: "direct", participantIds: [other] }); return r.json && r.json.id; };
const cvP = await mk(patelId);
const cvD = await mk(dirId);
await C1.api("POST", "/api/messaging/send", { conversationId: cvP, content: "presence probe " + RUN });
await reload(C1.page);
await nav(C1.page, "messages", 1500);
const openThread = async (page, name) => { await page.evaluate((n) => { const b = [...document.querySelectorAll("main button")].find((x) => x.textContent.includes(n)); if (b) b.click(); }, name); await sleep(1200); };
const status = (page) => page.evaluate(() => { const s = document.querySelector("[data-thread-status]"); return s ? { st: s.getAttribute("data-thread-status"), text: s.textContent } : null; });
await openThread(C1.page, "Dr. Sharon George");
let st13 = await status(C1.page);
rec("#13 patel (on shift, NOT signed in) is not 'Online'", st13 && st13.st === "offline" && !/Online/.test(st13.text), JSON.stringify(st13));
const P = await open(BASE, 390, "ISPN", "patel");
st13 = await waitFor(async () => { const s = await status(C1.page); return s && s.st === "online" ? s : null; }, 8000);
rec("#13 patel signs in → chen's header says Online (live frame)", st13 && /Online/.test(st13.text), JSON.stringify(st13));
await P.ctx.close();
st13 = await waitFor(async () => { const s = await status(C1.page); return s && s.st === "offline" ? s : null; }, 8000);
rec("#13 patel's browser closes → no longer Online", !!st13, JSON.stringify(await status(C1.page)));
await C1.page.evaluate(() => { const b = document.querySelector('button[aria-label="Back to conversations"]'); if (b) b.click(); });
await sleep(400);
await openThread(C1.page, "Dr. Dana Director");
st13 = await waitFor(async () => { const s = await status(C1.page); return s && s.st === "online" ? s : null; }, 6000);
rec("#13 the signed-in director (not a hospitalist) shows Online", !!st13, JSON.stringify(await status(C1.page)));
await C1.page.evaluate(() => { const b = document.querySelector("[data-thread-details] button"); if (b) b.click(); });
await sleep(300);
rec("#14 details toast states no message count", !/\d+ messages/.test(await lastToast(C1.page)), await lastToast(C1.page));
await checkLayout(C1.page, "chen thread header @375", ["main [data-thread-pane]"]);

// ── #15 DND failure (t5) ──
const P5 = await open(BASE, 390, "ISPN", "patel");
await P5.api("PATCH", "/api/settings/me", { key: "coveringUserId", value: idOf("chen") });
await P5.api("PATCH", "/api/settings/me", { key: "dnd", value: true });
await reload(P5.page);
await nav(P5.page, "account", 1500);
const dndRow = (page) => page.evaluate(() => { const b = document.querySelector("main [data-dnd-button]"); const row = b && b.closest('[style*="border-top"]'); return b ? { pressed: b.getAttribute("aria-pressed"), text: row ? row.innerText.replace(/\s+/g, " ") : "" } : null; });
let d15 = await dndRow(P5.page);
rec("#15 (setup) patel's Settings: DND on, covering chen", d15 && d15.pressed === "true" && /On · covering: Dr\. Nathan Alyesh/.test(d15.text), JSON.stringify(d15));
await P5.page.route("**/api/settings/me", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }));
await tap(P5.page, "main [data-dnd-button]");
const notSaved = await waitFor(async () => /Setting not saved/.test(await lastToast(P5.page)), 4000);
rec("#15 failed 'off' says 'Setting not saved' (no 'Do not disturb off' toast)", notSaved && !/Do not disturb off/.test(await lastToast(P5.page)), await lastToast(P5.page));
await sleep(5000);
d15 = await dndRow(P5.page);
const avail = (await C1.api("GET", "/api/messaging/availability/" + patelId)).json || {};
rec("#15 5 s later the row still says On · covering and the button is pressed", d15 && d15.pressed === "true" && /On · covering/.test(d15.text), JSON.stringify(d15));
rec("#15 …and the server agrees (still DND)", avail.dnd === true, JSON.stringify(avail).slice(0, 120));
await P5.page.unroute("**/api/settings/me");
await tap(P5.page, "main [data-dnd-button]");
d15 = await waitFor(async () => { const d = await dndRow(P5.page); return d && d.pressed === "false" ? d : null; }, 6000);
const avail2 = (await C1.api("GET", "/api/messaging/availability/" + patelId)).json || {};
rec("#15 a real 'off': row says Off only after the server stored it", !!d15 && /Off — you receive messages/.test(d15.text) && avail2.dnd === false && /Do not disturb off/.test(await lastToast(P5.page)), JSON.stringify(d15));
await checkLayout(P5.page, "patel Settings @390", ["main"]);
await P5.ctx.close();
await C1.ctx.close(); await W.ctx.close(); await ED.ctx.close(); await Dir.ctx.close();

// ── SYNTHETIC_DATA=false server ───────────────────────────────────────────
if (REAL) {
  console.log("== real server " + REAL);
  const dev = await open(REAL, 390, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD);
  const cfg = (await dev.api("GET", "/api/config")).json;
  rec("R (setup) server is SYNTHETIC_DATA=false", cfg && cfg.syntheticData === false);
  const NEWPW = "Fix-Comms-2026!";
  let o = ((await dev.api("GET", "/api/dev/organizations")).json || []).find((x) => x.code === "PINE");
  if (!o) o = (await dev.api("POST", "/api/dev/organizations", { name: "Pine Valley Hospital", code: "PINE", timezone: "America/Chicago" })).json;
  const people = [
    { role: "director", username: "pv.dir", displayName: "Dr. Pine Director", credential: "MD" },
    { role: "hospitalist", username: "pv.hosp", displayName: "Dr. Pine Hospitalist", credential: "MD", specialty: "Hospital Medicine", shiftType: "day", patientCap: 12 },
  ];
  for (const u of people) {
    const r = await dev.api("POST", "/api/dev/users", { organizationId: o.id, ...u });
    const temp = r.json && r.json.temporaryPassword;
    if (temp) {
      const ctx = await browser.newContext(); const pg = await ctx.newPage();
      await pg.goto(REAL + "/", { waitUntil: "domcontentloaded" });
      await pg.evaluate(async ([t, n, un]) => {
        const j = (m, path, b) => fetch(path, { method: m, credentials: "include", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((x) => x.status);
        return [await j("POST", "/api/login", { orgCode: "PINE", username: un, password: t }), await j("PATCH", "/api/account/password", { currentPassword: t, newPassword: n }), await j("POST", "/api/logout")];
      }, [temp, NEWPW, u.username]);
      await ctx.close();
    }
  }
  await dev.ctx.close();
  const RD = await open(REAL, 375, "PINE", "pv.dir", NEWPW);
  const stR = await RD.page.evaluate(() => { const s = window.DT.getState(); return { b: (s.broadcasts || []).map((x) => x.title), c: (s.conversations || []).map((x) => x.name) }; });
  rec("R director: no demo broadcasts or threads in the store", !stR.b.some((t) => DEMO.test(t)) && !stR.c.some((t) => DEMO.test(t)), JSON.stringify(stR).slice(0, 200));
  await nav(RD.page, "broadcasts", 1500);
  const tb = await mainText(RD.page);
  const srvB = (await RD.api("GET", "/api/broadcasts")).json || [];
  rec("R Broadcasts: only the server's broadcasts (none → 'No broadcasts sent yet'), no demo cards", !DEMO.test(tb) && (srvB.length ? srvB.every((b) => tb.includes(b.message)) : /No broadcasts sent yet/.test(tb)), "server=" + srvB.length);
  await RD.page.locator('input[placeholder="Short, scannable headline"]').fill("Pine drill " + RUN);
  await tap(RD.page, '[data-broadcast-audience="hospitalist"]');
  await sleep(200);
  await tapButton(RD.page, /^Send broadcast$/);
  await waitFor(async () => /Broadcast sent|not delivered/.test(await lastToast(RD.page)));
  rec("R targeted send reaches exactly the org's one hospitalist", /Sent to 1 person \(hospitalists\)/.test(await lastToast(RD.page)), await lastToast(RD.page));
  await checkLayout(RD.page, "real director Broadcasts @375", ["main"]);
  await nav(RD.page, "compliance", 2000);
  const ra = (await RD.api("GET", "/api/audit")).json || {};
  rec("R Compliance tiles = this org's server totals", new RegExp("Audit events\\s*" + Number(ra.auditCount).toLocaleString("en-US")).test(await mainText(RD.page)) && !/Open incidents|System logs/.test(await mainText(RD.page)), "auditCount=" + ra.auditCount);
  await nav(RD.page, "messages", 1200);
  rec("R Messages: no demo threads", !DEMO.test(await mainText(RD.page)));
  await RD.ctx.close();
  const RH = await open(REAL, 430, "PINE", "pv.hosp", NEWPW);
  await nav(RH.page, "account", 1500);
  const rs = await RH.page.evaluate(() => { const b = document.querySelector('button[aria-label="On shift"]'); return b ? b.getAttribute("aria-pressed") : null; });
  const rh = ((await RH.api("GET", "/api/hospitalists")).json || [])[0];
  rec("R hospitalist On shift = their rotation profile", rh && rs === String(!!rh.working), `switch=${rs} server=${rh && rh.working}`);
  const rb = ((await RH.api("GET", "/api/broadcasts")).json || []).find((b) => /Pine drill/.test(b.message));
  rec("R the hospitalist received the targeted broadcast", !!rb && rb.recipient === true);
  await nav(RH.page, "compliance", 1500);
  const rm = (await RH.api("GET", "/api/audit/mine")).json || {};
  rec("R hospitalist's own trail from the server", new RegExp("Your audit events\\s*" + rm.auditCount).test(await mainText(RH.page)) && rm.auditCount > 0, "mine=" + rm.auditCount);
  await checkLayout(RH.page, "real hospitalist My audit trail @430", ["main"]);
  await RH.ctx.close();
}

await browser.close();
rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
