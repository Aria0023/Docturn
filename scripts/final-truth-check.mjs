/**
 * Final verification fix-ups, measured in REAL Chromium on emulated iPhones
 * (375×667 / 390×844 / 430×932, DPR 3, touch, iPhone Safari UA). Each block
 * re-runs the verifier's reproduction against the fixed client and checks the
 * SERVER's answer, not the screen's claim:
 *
 *   D. developer #6 — Org config → Rules: after a director and a second
 *      developer change the org's rules, navigating away and back (the org's
 *      "Config" route) shows the server's current values with their read
 *      time; a focus re-reads; the switch writes the opposite of the SERVER's
 *      value and the screen then shows what the server holds; a refused
 *      timeout rolls back. Also on a SYNTHETIC_DATA=false server (Q).
 *   S. schedule #1 — on a server with an Amion env feed and
 *      AMION_SYNC_INTERVAL_MIN=1: with Manual list picked, a director's Off
 *      (the dashboard's own switch) survives the scheduled pull; with the
 *      on-call board off, hospitalist #2's Off survives it too; with Amion
 *      selected and the board on, the pull applies again. The server log
 *      shows each skipped tick and its reason.
 *   A. schedule #6 — Clear all removes the log rows but not the count; the
 *      line names the removed admissions and the auto-clean window; no "the
 *      log keeps every admission" anywhere.
 *   E. clinical #1 — broadcasts off: the confirm says nobody will be alerted,
 *      the banner says nobody was (also in a second browser and after a
 *      reload); broadcasts on: the banner gives the server's recipient count.
 *   C. clinical #4 — Wu (on Chen's unit, no rotation profile) gets Chen's
 *      request on Home, accepts it for Chen (the server's accept), sees the
 *      patient; Off call → nothing; Link offers only accounts that can accept.
 *   L. Layout of the changed panels; Z. zero CSP violations / page errors.
 *
 *   BASE_URL=http://127.0.0.1:8500 [REAL_BASE_URL=… REAL_DEV_PASSWORD=…]
 *   [AMION_BASE_URL=… AMION_SERVER_LOG=<its stdout file>] node scripts/final-truth-check.mjs
 * BASE_URL: a seeded synthetic server with RATE_LIMIT=off. Exits non-zero on failure.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const REAL = process.env.REAL_BASE_URL || "";
const AMION = process.env.AMION_BASE_URL || "";
const AMION_LOG = process.env.AMION_SERVER_LOG || "";
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
const RUN = Date.now().toString(36).slice(-4).toUpperCase().replace(/[^A-Z]/g, "Q");

async function open(base, width, org, username, password = PW) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const apiLog = [];
  const dialogs = [];
  page.on("pageerror", (e) => pageErrors.push(username + "@" + width + ": " + String((e && e.message) || e)));
  page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(username + ": " + t.slice(0, 160)); });
  page.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) apiLog.push({ m: r.request().method(), p: u.pathname, s: r.status(), body: r.request().postData() }); });
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
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
  return { ctx, page, apiLog, api, base, width, dialogs };
}
const nav = async (page, id, settle = 1000) => { await page.evaluate((n) => window.DT.actions.setNav(n), id); await sleep(settle); };
async function reload(page) {
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
  await sleep(2000);
}
const writes = (log, from = 0) => log.slice(from).filter((r) => r.m !== "GET");
const text = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.innerText.replace(/\s+/g, " ").trim() : null; }, sel);
const mainText = (page) => page.evaluate(() => (document.querySelector("main") || document.body).innerText);
const toast = (page) => page.evaluate(() => { const t = document.querySelector("[data-toast]"); return t ? t.textContent : ""; });
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
    const roots = [...new Set(sels.flatMap((s) => {
      const card = s.startsWith("card:");
      return [...document.querySelectorAll(card ? s.slice(5) : s)].map((el) => (card ? el.closest('div[style*="radius-lg"]') || el : el));
    }))];
    for (const root of roots) {
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

// ── D. developer #6: Org config → Rules ───────────────────────────────────
const rulesOnScreen = (page) => page.evaluate(() => {
  const g = (s) => document.querySelector(s);
  const t = g('button[aria-label="Auto-reassign on decline"]');
  const read = g("[data-rules-read]");
  return t ? {
    timeout: g('input[aria-label="Assignment timeout in minutes"]').value,
    mode: g('select[aria-label="Rotation mode"]').value,
    autoReassign: t.getAttribute("aria-checked") === "true",
    clean: g('input[aria-label="Auto-clean after hours"]').value,
    read: read ? read.getAttribute("data-rules-read") : null,
    readText: read ? read.innerText : "",
    disabled: t.disabled,
  } : null;
});
const serverRules = async (P, id) => {
  const d = (await P.api("GET", `/api/dev/organizations/${id}/settings`)).json;
  return { timeout: String(d.org.assignmentTimeoutMin), mode: d.org.rotationMode, autoReassign: d.settings.autoReassignOnDecline === true, clean: d.settings.autoCleanHours == null ? "" : String(d.settings.autoCleanHours) };
};
const same = (a, b) => a && b && a.timeout === b.timeout && a.mode === b.mode && a.autoReassign === b.autoReassign && a.clean === b.clean;
async function openRules(P, code, settleMs = 8000) {
  await P.page.evaluate((c) => { window.DT.actions.selectOrg(c); window.DT.actions.setNav("settings"); }, code);
  return waitFor(async () => { const r = await rulesOnScreen(P.page); return r && r.read === "fresh" ? r : null; }, settleMs);
}

async function rulesScenario(base, devPw, code, orgId, director, label) {
  // Known starting values, set by a second operator before the sign-in.
  const op = await open(base, 430, "DOCTURN", "dev", devPw);
  await op.api("PATCH", `/api/dev/organizations/${orgId}`, { assignmentTimeoutMin: 37, rotationMode: "sequential" });
  await op.api("PATCH", `/api/dev/organizations/${orgId}/settings`, { key: "autoReassignOnDecline", value: true });
  await op.api("PATCH", `/api/dev/organizations/${orgId}/settings`, { key: "autoCleanHours", value: 48 });
  const A = await open(base, 390, "DOCTURN", "dev", devPw);
  const first = await openRules(A, code);
  rec(`D ${label}: first open shows the server's values`, same(first, await serverRules(A, orgId)), JSON.stringify(first));
  // Changes by a director (when there is one) and the second developer.
  if (director) {
    const r1 = await director.api("PATCH", "/api/org/config", { assignmentTimeoutMin: 22, rotationMode: "lowest_census" });
    const r2 = await director.api("PATCH", "/api/settings/org", { key: "autoReassignOnDecline", value: false });
    rec(`D ${label}: (setup) director's changes accepted`, r1.status === 200 && r2.status === 200, r1.status + "/" + r2.status);
  } else {
    await op.api("PATCH", `/api/dev/organizations/${orgId}`, { assignmentTimeoutMin: 22, rotationMode: "lowest_census" });
    await op.api("PATCH", `/api/dev/organizations/${orgId}/settings`, { key: "autoReassignOnDecline", value: false });
  }
  const r3 = await op.api("PATCH", `/api/dev/organizations/${orgId}/settings`, { key: "autoCleanHours", value: 72 });
  rec(`D ${label}: (setup) second developer's change accepted`, r3.status === 200, "status=" + r3.status);
  const srv = await serverRules(A, orgId);
  // Away and back (the org list's Config button does exactly this).
  await nav(A.page, "dashboard", 1200);
  const mark = A.apiLog.length;
  const back = await openRules(A, code);
  rec(`D ${label}: away and back re-reads the org (GET …/settings)`, A.apiLog.slice(mark).some((r) => r.m === "GET" && r.p === `/api/dev/organizations/${orgId}/settings`));
  rec(`D ${label}: away and back shows the server's current values {22, lowest_census, off, 72}`, same(back, srv) && back.timeout === "22" && back.mode === "lowest_census" && back.autoReassign === false && back.clean === "72", JSON.stringify(back) + " vs " + JSON.stringify(srv));
  rec(`D ${label}: the read time is on screen`, back && /Read from the server at/.test(back.readText), back && back.readText);
  // A change while the page stays open: coming back to the tab re-reads.
  await op.api("PATCH", `/api/dev/organizations/${orgId}`, { assignmentTimeoutMin: 19 });
  await A.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const focused = await waitFor(async () => { const r = await rulesOnScreen(A.page); return r && r.timeout === "19" ? r : null; }, 6000);
  rec(`D ${label}: returning to the page re-reads (19 shown)`, !!focused, JSON.stringify(focused));
  // The switch writes the opposite of the SERVER's value; then the screen = server.
  const m2 = A.apiLog.length;
  await A.page.locator('button[aria-label="Auto-reassign on decline"]').click();
  await sleep(1800);
  const w = writes(A.apiLog, m2);
  rec(`D ${label}: the switch sends the opposite of the server's off (value:true), once`, w.length === 1 && /autoReassignOnDecline/.test(w[0].body || "") && /"value":true/.test(w[0].body || "") && w[0].s === 200, w.map((x) => x.m + " " + x.p + " " + x.s + " " + x.body).join(", "));
  const after = await rulesOnScreen(A.page);
  rec(`D ${label}: after the save the screen is the server's`, same(after, await serverRules(A, orgId)), JSON.stringify(after));
  // A refused write rolls back to the server's value.
  await A.page.locator('input[aria-label="Assignment timeout in minutes"]').fill("500");
  await sleep(2200);
  const refused = await rulesOnScreen(A.page);
  rec(`D ${label}: timeout 500 is refused and rolled back to the server's`, refused && refused.timeout === (await serverRules(A, orgId)).timeout && /Not saved/.test(await toast(A.page)), JSON.stringify(refused) + " toast=" + (await toast(A.page)));
  await checkLayout(A.page, `${label} rules @390`, ["card:[data-rules-read]"]);
  for (const width of [375, 430]) {
    const P = await open(base, width, "DOCTURN", "dev", devPw);
    const r = await openRules(P, code);
    rec(`D ${label} @${width}: fresh read = server`, same(r, await serverRules(P, orgId)), JSON.stringify(r));
    await checkLayout(P.page, `${label} rules @${width}`, ["card:[data-rules-read]"]);
    await P.ctx.close();
  }
  await A.ctx.close(); await op.ctx.close();
}

console.log("== synthetic server " + BASE);
{
  const dir = await open(BASE, 390, "ISPN", "director");
  const orgs = (await (await open(BASE, 430, "DOCTURN", "dev")).api("GET", "/api/dev/organizations")).json;
  const ispn = orgs.find((o) => o.code === "ISPN");
  await rulesScenario(BASE, PW, "ISPN", ispn.id, dir, "synthetic ISPN");
  // Leave ISPN with sane defaults for the later blocks.
  await dir.api("PATCH", "/api/org/config", { assignmentTimeoutMin: 15 });
  await dir.ctx.close();
}

// ── C. clinical #4: care team ─────────────────────────────────────────────
{
  const dev = await open(BASE, 430, "DOCTURN", "dev");
  const er = await open(BASE, 430, "ISPN", "er.doc");
  const chen = await open(BASE, 390, "ISPN", "chen");
  const users = (await chen.api("GET", "/api/care-team/candidates")).json;
  const team = (await chen.api("GET", "/api/care-team")).json.members;
  const wuId = (team.find((m) => /Wu/.test(m.displayName)) || users.find((u) => /Wu/.test(u.displayName))).userId;
  const erId = users.find((u) => u.role === "er_doctor").userId;
  await chen.api("PATCH", `/api/care-team/members/${wuId}`, { onCall: true });
  const hosps = (await chen.api("GET", "/api/hospitalists")).json;
  const meId = (await chen.api("GET", "/api/user")).json.id;
  const chenH = hosps.find((x) => x.userId === meId).id;
  const route = async (initials) => {
    const p = await er.api("POST", "/api/patients", { initials, roomNumber: "C" + RUN, issueSummary: "synthetic care-team check", specialty: "Cardiology" });
    const a = await er.api("POST", "/api/assignments", { patientId: p.json.id, mode: "manual", hospitalistId: chenH });
    return { pid: p.json.id, aid: a.json.id, status: a.status };
  };
  for (const width of [375, 390, 430]) {
    const wu = await open(BASE, width, "ISPN", "wu");
    const uv = await route("U" + String.fromCharCode(64 + (width % 26)));
    rec(`C @${width}: (setup) ER routed a patient to Chen`, uv.status === 201, "status=" + uv.status);
    const card = await waitFor(() => wu.page.evaluate((id) => { const el = document.querySelector(`[data-pending-id="${id}"]`); return el ? { for: el.getAttribute("data-pending-for"), text: el.innerText, buttons: [...el.querySelectorAll("button")].map((b) => b.innerText.trim()) } : null; }, uv.aid), 20000, 300);
    const srvPending = (await wu.api("GET", "/api/assignments/pending")).json;
    rec(`C @${width}: the server lists Chen's request for Wu (onBehalfOf Chen)`, srvPending.some((x) => x.id === uv.aid && x.onBehalfOf && x.onBehalfOf.userId === meId), JSON.stringify(srvPending.map((x) => [x.id, x.onBehalfOf && x.onBehalfOf.userId])));
    rec(`C @${width}: Wu's Home shows it 'For Dr. Nathan Alyesh' with Accept only`, card && card.for === String(meId) && /For Dr\. Nathan Alyesh/.test(card.text) && JSON.stringify(card.buttons) === JSON.stringify(["Accept for Dr. Nathan Alyesh"]), JSON.stringify(card));
    await checkLayout(wu.page, `care-team request card @${width}`, [`card:[data-pending-id="${uv.aid}"]`]);
    const mark = wu.apiLog.length;
    await wu.page.locator(`[data-pending-id="${uv.aid}"] button`).first().click();
    await sleep(2000);
    const w = writes(wu.apiLog, mark);
    rec(`C @${width}: Accept is ONE server accept (PATCH …/${uv.aid}/accept 200)`, w.length === 1 && w[0].p === `/api/assignments/${uv.aid}/accept` && w[0].s === 200, w.map((x) => x.m + " " + x.p + " " + x.s).join(", "));
    const board = (await chen.api("GET", "/api/assignments/my")).json;
    rec(`C @${width}: the patient is on Chen's census, accepted by Wu`, board.some((x) => x.id === uv.aid && x.acceptedByUserId === wuId), "");
    const acc = await waitFor(() => wu.page.evaluate(() => { const el = document.querySelector("[data-accepted-obo]"); return el ? el.innerText : null; }), 8000);
    rec(`C @${width}: Wu sees it under accepted ('Accepted for Dr. Nathan Alyesh')`, acc && /Accepted for Dr\. Nathan Alyesh/.test(acc), acc);
    rec(`C @${width}: no 'No pending assignments' claim while it was waiting`, !!card);
    await wu.ctx.close();
  }
  // Off call → no longer listed, accept refused by the server.
  await chen.api("PATCH", `/api/care-team/members/${wuId}`, { onCall: false });
  const wu = await open(BASE, 390, "ISPN", "wu");
  const wx = await route("WX");
  await sleep(3000);
  const srvP = (await wu.api("GET", "/api/assignments/pending")).json;
  const shown = await wu.page.evaluate((id) => !!document.querySelector(`[data-pending-id="${id}"]`), wx.aid);
  rec("C: Off call → the server no longer lists Chen's request for Wu, nor does the screen", !srvP.some((x) => x.id === wx.aid) && !shown);
  rec("C: Off call → the server refuses Wu's accept (403)", (await wu.api("PATCH", `/api/assignments/${wx.aid}/accept`)).status === 403);
  await chen.api("PATCH", `/api/care-team/members/${wuId}`, { onCall: true });
  // Linking: only accounts that can accept.
  await nav(chen.page, "team", 1500);
  await chen.page.locator('button:has-text("Add member")').click();
  await sleep(800);
  const cands = await chen.page.evaluate(() => [...document.querySelectorAll("[data-candidate]")].map((e) => e.getAttribute("data-candidate")));
  rec("C: Add member never offers the ER physician (can't accept a request)", cands.length > 0 && !cands.includes(String(erId)), "offered=" + cands.join(","));
  const refused = await chen.api("POST", "/api/care-team/members", { memberUserId: erId });
  rec("C: the server refuses linking an ER physician (409 member_cannot_accept)", refused.status === 409 && refused.json.error === "member_cannot_accept", JSON.stringify(refused));
  rec("C: the screen's explainer matches the server ('shows in their Incoming list')", /shows in their Incoming list/.test(await mainText(chen.page)));
  await checkLayout(chen.page, "care team @390", ["card:[data-candidate]"]);
  await wu.ctx.close(); await chen.ctx.close(); await er.ctx.close(); await dev.ctx.close();
}

// ── E. clinical #1: diversion banner ──────────────────────────────────────
{
  const dev = await open(BASE, 430, "DOCTURN", "dev");
  const ispn = (await dev.api("GET", "/api/dev/organizations")).json.find((o) => o.code === "ISPN");
  const modOff = await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "broadcasts", enabled: false });
  rec("E: (setup) broadcasts switched off for ISPN", modOff.status === 200, "status=" + modOff.status);
  const X = await open(BASE, 375, "ISPN", "er.director");
  const Y = await open(BASE, 430, "ISPN", "er.director");
  await X.api("PUT", "/api/er/diversion", { active: false });
  await reload(X.page); await reload(Y.page);
  await waitFor(() => X.page.evaluate(() => !!document.querySelector('[data-diversion="off"]')), 8000);
  await X.page.locator('button:has-text("Declare diversion")').click();
  await sleep(2500);
  rec("E off: the confirm says nobody will be alerted (no 'Everyone … gets a critical broadcast')", X.dialogs.length > 0 && /Broadcasts are switched off/.test(X.dialogs[0]) && !/Everyone/.test(X.dialogs[0]), X.dialogs[0]);
  const srv = (await X.api("GET", "/api/er/diversion")).json;
  rec("E off: the server recorded alert {sent:false, reason:module_disabled}", srv.active && srv.alert && srv.alert.sent === false && srv.alert.reason === "module_disabled", JSON.stringify(srv.alert));
  const lineX = await text(X.page, "[data-diversion-line]");
  rec("E off: the banner says nobody was alerted", /alerted nobody/.test(lineX || "") && !/was sent a broadcast|Everyone in your organization/.test(lineX || ""), lineX);
  const lineY = await waitFor(async () => { const t = await text(Y.page, '[data-diversion="on"] [data-diversion-line]'); return t; }, 20000, 500);
  rec("E off: a second ER-director browser flips without a reload and says the same", /alerted nobody/.test(lineY || ""), lineY);
  await reload(X.page);
  const lineR = await waitFor(() => text(X.page, '[data-diversion="on"] [data-diversion-line]'), 8000);
  rec("E off: after a reload, still 'alerted nobody'", /alerted nobody/.test(lineR || ""), lineR);
  await checkLayout(X.page, "diversion banner @375", ["[data-diversion]"]);
  await X.page.locator('button:has-text("Lift diversion")').click();
  await sleep(2000);
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "broadcasts", enabled: true });
  await reload(X.page);
  X.dialogs.length = 0;
  const mark = X.apiLog.length;
  await waitFor(() => X.page.evaluate(() => !!document.querySelector('[data-diversion="off"]')), 8000);
  await X.page.locator('button:has-text("Declare diversion")').click();
  await sleep(2500);
  const put = writes(X.apiLog, mark).find((r) => r.p === "/api/er/diversion");
  const srv2 = (await X.api("GET", "/api/er/diversion")).json;
  rec("E on: the confirm promises the broadcast", /Everyone else in your organization gets a critical broadcast/.test(X.dialogs[0] || ""), X.dialogs[0]);
  rec("E on: one PUT 200; the server recorded sent:true with its recipient count", put && put.s === 200 && srv2.alert && srv2.alert.sent === true && srv2.alert.recipients > 0, JSON.stringify(srv2.alert));
  const line2 = await text(X.page, "[data-diversion-line]");
  rec(`E on: the banner gives the server's count (${srv2.alert && srv2.alert.recipients})`, new RegExp("went to " + (srv2.alert && srv2.alert.recipients) + " people").test(line2 || ""), line2);
  await X.page.locator('button:has-text("Lift diversion")').click();
  await sleep(1500);
  await X.ctx.close(); await Y.ctx.close(); await dev.ctx.close();
}

// ── A. schedule #6: the admissions counter vs Clear / auto-clean ──────────
{
  const er = await open(BASE, 430, "ISPN", "er.doc");
  const D = await open(BASE, 390, "ISPN", "director");
  for (const i of [1, 2]) {
    const p = await er.api("POST", "/api/patients", { initials: "A" + String.fromCharCode(64 + i), roomNumber: "A" + i, issueSummary: "synthetic counter check", specialty: "Cardiology" });
    await er.api("POST", "/api/assignments", { patientId: p.json.id, mode: "round_robin" });
  }
  const before = (await D.api("GET", "/api/admissions")).json;
  const sinceEl = () => D.page.evaluate(() => { const el = document.querySelector("[data-admissions-since]"); return el ? el.textContent.trim() : null; });
  await waitFor(async () => (await sinceEl()) === String(before.sinceReset), 20000, 500);
  rec("A: counter = server's sinceReset", (await sinceEl()) === String(before.sinceReset), (await sinceEl()) + " vs " + before.sinceReset);
  await nav(D.page, "admissions", 1500);
  await D.page.locator('button:has-text("Clear all")').click();
  await sleep(2500);
  const after = (await D.api("GET", "/api/admissions")).json;
  rec("A: Clear all empties the log on the server, the count stays", after.total === 0 && after.sinceReset === before.sinceReset && after.sinceResetRemoved >= 2, JSON.stringify({ total: after.total, sinceReset: after.sinceReset, removed: after.sinceResetRemoved }));
  const keep = await text(D.page, "[data-adm-keep]");
  rec("A: the log says auto-clean removes patients (and their rows) after the org's window", new RegExp("after " + after.autoCleanHours + " h").test(keep || ""), keep);
  await nav(D.page, "dashboard", 1500);
  await reload(D.page);
  const line = await waitFor(() => text(D.page, "[data-admissions-reset-line]"), 8000);
  rec("A: counter still the server's after Clear all", (await sinceEl()) === String(after.sinceReset), await sinceEl());
  rec("A: the line names the admissions no longer in the log, and the auto-clean window", new RegExp(after.sinceResetRemoved + " of these are no longer in the log").test(line || "") && /auto-clean removes them after/.test(line || ""), line);
  rec("A: no 'the log keeps every admission' anywhere", !/keeps every admission/.test(await mainText(D.page)));
  await D.page.locator('button:has-text("Reset count")').click();
  await sleep(1500);
  const t = await toast(D.page);
  rec("A: the reset toast makes no 'log keeps every admission' claim", /Admissions count reset/.test(t) && !/keeps every admission/.test(t), t);
  for (const width of [375, 430]) {
    const P = await open(BASE, width, "ISPN", "director");
    await checkLayout(P.page, `dashboard admissions + schedule panels @${width}`, ["card:[data-admissions-since]", "card:[data-schedule-panel]"]);
    await nav(P.page, "admissions", 1500);
    await checkLayout(P.page, `admissions log @${width}`, ["[data-adm-keep]"]);
    await P.ctx.close();
  }
  await D.ctx.close(); await er.ctx.close();
}

// ── S. schedule #1: Amion pulls follow the selected source and the board ──
if (AMION) {
  console.log("== amion server " + AMION);
  const logTail = () => { try { return readFileSync(AMION_LOG, "utf8"); } catch { return ""; } };
  const D = await open(AMION, 390, "ISPN", "director");
  const dev = await open(AMION, 430, "DOCTURN", "dev");
  const ispn = (await dev.api("GET", "/api/dev/organizations")).json.find((o) => o.code === "ISPN");
  const st0 = await waitFor(async () => { const s = (await D.api("GET", "/api/amion/status")).json; return s && s.lastSyncAt ? s : null; }, 30000, 1000);
  rec("S: (setup) the Amion feed has synced once", !!st0, JSON.stringify(st0 && { at: st0.lastSyncAt, rows: st0.rowCount }));
  const dir = (await D.api("GET", "/api/physicians/directory")).json;
  const idOf = (name) => (dir.find((d) => d.displayName === name) || {}).id;
  const working = async (name) => { const list = (await D.api("GET", "/api/hospitalists")).json; const h = list.find((x) => x.id === idOf(name)); return h ? h.working : null; };
  // The loop logs a pause once per paused period (not every tick), so the
  // evidence is: the reason is in the server log, and ≥ 65 s (more than one
  // 1-minute tick) passed after the director's change.
  const TICK_MS = 65000;

  // Manual list picked → the director's own switch holds through a pull.
  const r1 = await D.api("PATCH", "/api/oncall/source", { source: "manual" });
  rec("S manual: (setup) director picks the Manual list", r1.status === 200, "status=" + r1.status);
  await reload(D.page);
  const pm = await waitFor(() => D.page.evaluate(() => { const el = document.querySelector('[data-schedule-panel="manual"]'); return el ? el.innerText.replace(/\s+/g, " ") : null; }), 10000);
  rec("S manual: the panel says Manual list and that Amion is connected but not pulled", pm && /Manual list/.test(pm) && /Amion is connected but not pulled while Manual list is selected/.test(pm), pm);
  if (!(await working("Dr. Nathan Alyesh"))) await D.api("PATCH", `/api/hospitalists/${idOf("Dr. Nathan Alyesh")}/working-status`, { working: true });
  await reload(D.page);
  const mark = D.apiLog.length;
  await D.page.evaluate((name) => {
    const btn = [...document.querySelectorAll('button[title="Toggle shift"]')].find((b) => { let p = b; for (let i = 0; i < 6 && p; i++) { p = p.parentElement; if (p && p.innerText && p.innerText.includes(name)) return true; } return false; });
    if (btn) btn.setAttribute("data-fx-toggle", "1");
  }, "Dr. Nathan Alyesh");
  await D.page.locator('[data-fx-toggle="1"]').click();
  await sleep(2000);
  rec("S manual: the dashboard's switch took Dr. Alyesh off shift on the server", (await working("Dr. Nathan Alyesh")) === false && writes(D.apiLog, mark).some((r) => /working-status/.test(r.p) && r.s === 200), writes(D.apiLog, mark).map((r) => r.p + " " + r.s).join(", "));
  await sleep(TICK_MS); // at least one scheduled tick (interval 1 min) after the Off
  rec("S manual: the server log shows the scheduled pull paused for ISPN (another source selected)", new RegExp("scheduled sync paused for org " + ispn.id + " — another schedule source is selected").test(logTail()));
  rec("S manual: after the scheduled pull Dr. Alyesh is STILL off shift", (await working("Dr. Nathan Alyesh")) === false);
  const pm2 = await text(D.page, "[data-schedule-panel]");
  rec("S manual: the panel still says Manual list", /Manual list/.test(pm2 || ""), pm2);

  // Board off (Amion selected) → still no pull.
  await D.api("PATCH", "/api/oncall/source", { source: "amion" });
  const off = await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "oncall.board", enabled: false });
  rec("S board off: (setup) oncall.board switched off", off.status === 200, "status=" + off.status);
  await D.api("PATCH", `/api/hospitalists/${idOf("Dr. Sharon George")}/working-status`, { working: false });
  await reload(D.page);
  const pb = await text(D.page, "[data-schedule-line]");
  rec("S board off: the panel says no schedule source is read and no feed changes shifts", /no schedule source is read and no feed changes who is on shift/.test(pb || ""), pb);
  await sleep(TICK_MS);
  rec("S board off: the server log shows the scheduled pull paused for ISPN (board off)", new RegExp("scheduled sync paused for org " + ispn.id + " — the on-call board is switched off").test(logTail()));
  rec("S board off: hospitalist #2 (Dr. George) is STILL off shift after the pull", (await working("Dr. Sharon George")) === false);

  // Board back on with Amion selected → the pull applies (so the panel's Amion line is true).
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "oncall.board", enabled: true });
  const back = await waitFor(async () => (await working("Dr. Sharon George")) === true, 140000, 3000);
  rec("S amion: board on + Amion selected → the scheduled pull puts Dr. George back on shift", !!back);
  await reload(D.page);
  const pa = await text(D.page, "[data-schedule-panel]");
  rec("S amion: the panel says it syncs from Amion and that each pull sets shifts", /Amion/.test(pa || "") && /Each (successful )?Amion pull puts everyone on the grid on shift/.test(pa || ""), pa);
  await checkLayout(D.page, "amion dashboard panel @390", ["card:[data-schedule-panel]"]);
  await D.ctx.close(); await dev.ctx.close();
}

// ── Q. SYNTHETIC_DATA=false server: Org config → Rules ────────────────────
if (REAL) {
  console.log("== real-mode server " + REAL);
  const op = await open(REAL, 430, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD);
  const code = "FX" + RUN;
  const made = await op.api("POST", "/api/dev/organizations", { name: "Fixup Verify " + RUN, code, timezone: "America/Chicago" });
  rec("Q: (setup) a tenant created on the real-mode server", made.status === 201, "status=" + made.status);
  await op.ctx.close();
  await rulesScenario(REAL, process.env.REAL_DEV_PASSWORD, code, made.json.id, null, "real " + code);
}

await browser.close();
rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
