/**
 * End shift / Start shift (PerfectServe parity #4, module shift.handoff),
 * measured in REAL Chromium on emulated iPhones (375×667 / 390×844 / 430×932,
 * DPR 3, touch, iPhone Safari UA) against the server's answer:
 *
 *   E. Settings → Rotation shows End shift with the server's pending count; the
 *      confirm dialog states the rule (accepted patients stay; pending go to
 *      the covering provider) with the server's numbers; End shift cannot be
 *      confirmed without a covering provider while requests are pending (no
 *      write); with one chosen it is ONE POST /api/shift/end 200 and the server
 *      agrees (off shift, covering + DND + away stored, the pending request now
 *      waits on the covering provider, the accepted patient still mine).
 *   S. Start shift is ONE POST /api/shift/start 200; on shift, DND off.
 *   W. A hospitalist with no rotation profile gets no End shift button.
 *   M. shift.handoff off: no End shift row (the plain On shift switch is back); 404.
 *   Q. (REAL_BASE_URL) SYNTHETIC_DATA=false: a fresh tenant, no pending → ends
 *      with no covering provider; the dialog says there are no pending requests.
 *   L. Layout at every width; Z. zero CSP violations / page errors.
 *
 *   BASE_URL=http://127.0.0.1:8831 [REAL_BASE_URL=… REAL_DEV_PASSWORD=…] node scripts/shift-handoff-check.mjs
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
      for (const el of root.querySelectorAll('button, [role="button"], select, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"])' + (root.matches("[data-end-shift-dialog]") ? ", label" : ""))) {
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).trim().slice(0, 30);
        const isInput = el.tagName === "INPUT" || el.tagName === "SELECT";
        if (r.height < 43.5 || (!isInput && el.tagName !== "LABEL" && r.width < 43.5)) out.small.push(label + " " + Math.round(r.width) + "x" + Math.round(r.height));
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
  const row = document.querySelector("[data-shift-row]");
  const dlg = document.querySelector("[data-end-shift-dialog]");
  const confirm = document.querySelector("[data-shift-confirm]");
  return {
    row: row ? row.getAttribute("data-shift-row") : null,
    rowText: row ? row.textContent : "",
    onshiftRow: (document.querySelector("[data-onshift-row]") || { getAttribute: () => null }).getAttribute("data-onshift-row"),
    dialog: !!dlg,
    rule: (document.querySelector("[data-shift-rule]") || {}).textContent || "",
    confirmDisabled: confirm ? confirm.getAttribute("aria-disabled") === "true" : null,
    dndBox: !!document.querySelector("[data-shift-dnd]"),
  };
});

async function endStartRound(ER, width, ids, profiles) {
  const label = "@" + width;
  const C = await open(BASE, width, "ISPN", "chen");
  // Setup through the API: on shift, no covering preference, DND off, one
  // ACCEPTED patient and one PENDING request on my profile.
  await C.api("POST", "/api/shift/start", {});
  await C.api("PATCH", "/api/settings/me", { key: "coveringUserId", value: null });
  await C.api("PATCH", "/api/settings/me", { key: "dnd", value: false });
  const pa = (await ER.api("POST", "/api/patients", { initials: "SA", roomNumber: "S" + width, issueSummary: "synthetic shift check", specialty: "General" })).json;
  const aa = (await ER.api("POST", "/api/assignments", { patientId: pa.id, mode: "manual", hospitalistId: profiles.chen })).json;
  await C.api("PATCH", `/api/assignments/${aa.id}/accept`);
  const pp = (await ER.api("POST", "/api/patients", { initials: "SP", roomNumber: "P" + width, issueSummary: "synthetic shift check", specialty: "General" })).json;
  await ER.api("POST", "/api/assignments", { patientId: pp.id, mode: "manual", hospitalistId: profiles.chen });
  const srv0 = (await C.api("GET", "/api/shift")).json;
  await reload(C.page);
  await nav(C.page, "account", 2000);
  let v = await waitFor(async () => { const x = await ui(C); return x.row === "on" && new RegExp(srv0.pendingCount + " pending request").test(x.rowText) ? x : null; }, 10000);
  rec(`E ${label}: Settings → End shift, with the server's pending count (${srv0.pendingCount})`, !!v && srv0.pendingCount >= 1, JSON.stringify(v || (await ui(C))));
  await checkLayout(C.page, `${label} Rotation row`, ["[data-shift-row]"]);

  await C.page.locator('[data-shift-action="end"]').click();
  await sleep(1200);
  v = await ui(C);
  const ruleOk = /Accepted patients stay with you/.test(v.rule) && /never re-routes/.test(v.rule) && new RegExp(srv0.pendingCount + " pending request").test(v.rule) && new RegExp(srv0.acceptedCount + " accepted patient").test(v.rule);
  rec(`E ${label}: the dialog states the rule with the server's numbers (accepted ${srv0.acceptedCount} stay, pending ${srv0.pendingCount} go to the covering provider)`, v.dialog && ruleOk, v.rule.slice(0, 200));
  rec(`E ${label}: while requests are pending, End shift is disabled until a covering provider is chosen`, v.confirmDisabled === true);
  let mark = C.apiLog.length;
  await C.page.locator("[data-shift-confirm]").click({ force: true });
  await sleep(600);
  rec(`E ${label}: tapping the disabled End shift writes nothing`, writes(C.apiLog, mark).length === 0);
  await checkLayout(C.page, `${label} End shift dialog`, ["[data-end-shift-dialog]"]);

  await C.page.locator(`[data-shift-cover="${ids.patel}"]`).click();
  await sleep(200);
  if (v.dndBox) await C.page.locator("[data-shift-dnd]").check();
  await C.page.locator("[data-shift-away]").fill("Back at 7 " + RUN);
  v = await ui(C);
  rec(`E ${label}: with a covering provider chosen, End shift is enabled`, v.confirmDisabled === false);
  mark = C.apiLog.length;
  await C.page.locator("[data-shift-confirm]").click();
  await sleep(2000);
  const w = writes(C.apiLog, mark);
  const body = w[0] && w[0].body ? JSON.parse(w[0].body) : null;
  rec(`E ${label}: End shift is ONE write (POST /api/shift/end 200) carrying covering + DND + away`, w.length === 1 && w[0].p === "/api/shift/end" && w[0].s === 200 && body && body.coveringUserId === ids.patel && body.dnd === true && /Back at 7/.test(body.awayMessage), w.map((x) => x.m + " " + x.p + " " + x.s).join(", ") + " " + (w[0] && w[0].body));
  const srv1 = (await C.api("GET", "/api/shift")).json;
  const P = await open(BASE, 430, "ISPN", "patel");
  const patelPending = ((await P.api("GET", "/api/assignments/pending")).json || []);
  const handed = Array.isArray(patelPending) && patelPending.some((a) => (a.patientId ?? (a.patient && a.patient.id)) === pp.id);
  const accepted = ((await ER.api("GET", "/api/patients")).json || []).find((x) => x.id === pa.id);
  rec(`E ${label}: the server agrees — off shift, covering = patel, DND on, away stored, no pending left on me`, srv1.working === false && srv1.coveringUserId === ids.patel && srv1.dnd === true && /Back at 7/.test(srv1.awayMessage || "") && srv1.pendingCount === 0, JSON.stringify(srv1));
  rec(`E ${label}: the pending request now waits on the covering provider; the accepted patient is still mine`, handed && accepted && accepted.assignedHospitalistId === profiles.chen, JSON.stringify({ handed, assigned: accepted && accepted.assignedHospitalistId }));
  await P.ctx.close();
  v = await waitFor(async () => { const x = await ui(C); return x.row === "off" && !x.dialog ? x : null; }, 6000);
  rec(`E ${label}: the dialog closed and the row shows Start shift (the server's off shift)`, !!v, JSON.stringify(v || (await ui(C))));

  mark = C.apiLog.length;
  await C.page.locator('[data-shift-action="start"]').click();
  await sleep(1800);
  const w2 = writes(C.apiLog, mark);
  const srv2 = (await C.api("GET", "/api/shift")).json;
  v = await ui(C);
  rec(`S ${label}: Start shift is ONE write (POST /api/shift/start 200); on shift, DND off; the row follows`, w2.length === 1 && w2[0].p === "/api/shift/start" && w2[0].s === 200 && srv2.working === true && srv2.dnd === false && v.row === "on", w2.map((x) => x.m + " " + x.p + " " + x.s).join(", ") + " " + JSON.stringify({ srv2, row: v.row }));
  // Leave the accepted patient's pending sibling for the next round's covering
  // provider to ignore — it is theirs now.
  await C.ctx.close();
}

console.log("== synthetic server " + BASE);
{
  const dev = await open(BASE, 430, "DOCTURN", "dev");
  const ispn = (await dev.api("GET", "/api/dev/organizations")).json.find((o) => o.code === "ISPN");
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "shift.handoff", enabled: true });
  const ER = await open(BASE, 430, "ISPN", "er.doc");
  const dir = (await ER.api("GET", "/api/physicians/directory")).json;
  const byName = (u) => dir.find((d) => d.userId === u);
  // Each account's id from its own /api/user.
  const ids = {};
  for (const un of ["chen", "patel"]) { const X = await open(BASE, 430, "ISPN", un); ids[un] = (await X.api("GET", "/api/user")).json.id; await X.ctx.close(); }
  const profiles = { chen: byName(ids.chen).id, patel: byName(ids.patel).id };
  // The covering provider must be on shift to take pending requests.
  const Pt = await open(BASE, 430, "ISPN", "patel");
  await Pt.api("POST", "/api/shift/start", {});
  await Pt.ctx.close();
  for (const width of [375, 390, 430]) await endStartRound(ER, width, ids, profiles);

  // W. no rotation profile → no End shift button (the truthful "Not in the rotation").
  const W = await open(BASE, 390, "ISPN", "wu");
  await nav(W.page, "account", 2000);
  const wv = await ui(W);
  rec("W: a hospitalist with no rotation profile gets no End shift button, and is told why", wv.row === null && wv.onshiftRow === "none", JSON.stringify(wv));
  await W.ctx.close();

  // M. module off.
  const C = await open(BASE, 390, "ISPN", "chen");
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "shift.handoff", enabled: false });
  await reload(C.page);
  await nav(C.page, "account", 2000);
  const mv = await ui(C);
  const srv = await C.api("POST", "/api/shift/end", {});
  rec("M shift.handoff off: no End shift row (the On shift switch is back); POST /api/shift/end 404 module_disabled", mv.row === null && (mv.onshiftRow === "on" || mv.onshiftRow === "off") && srv.status === 404 && srv.json.module === "shift.handoff", JSON.stringify({ mv, status: srv.status }));
  await checkLayout(C.page, "Settings with shift.handoff off @390", ["main"]);
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "shift.handoff", enabled: true });
  await C.ctx.close(); await ER.ctx.close(); await dev.ctx.close();
}

if (REAL) {
  console.log("== real server " + REAL);
  const dev = await open(REAL, 390, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD);
  const cfg = (await dev.api("GET", "/api/config")).json;
  rec("Q (setup) server is SYNTHETIC_DATA=false", cfg && cfg.syntheticData === false);
  const NEWPW = "Shift-Check-2026!";
  const code = "SH" + RUN;
  const o = (await dev.api("POST", "/api/dev/organizations", { name: "Shift Check " + RUN, code, timezone: "America/Chicago" })).json;
  for (const u of [
    { role: "hospitalist", username: "sh.one", displayName: "Dr. Sh One", credential: "MD", specialty: "Hospital Medicine", shiftType: "day", patientCap: 12 },
    { role: "hospitalist", username: "sh.two", displayName: "Dr. Sh Two", credential: "MD", specialty: "Hospital Medicine", shiftType: "day", patientCap: 12 },
  ]) {
    const r = await dev.api("POST", "/api/dev/users", { organizationId: o.id, ...u });
    const temp = r.json && r.json.temporaryPassword;
    if (temp) {
      const ctx = await browser.newContext(); const pg = await ctx.newPage();
      await pg.goto(REAL + "/", { waitUntil: "domcontentloaded" });
      await pg.evaluate(async ([t, n, un, oc]) => {
        const j = (m, path, b) => fetch(path, { method: m, credentials: "include", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((x) => x.status);
        return [await j("POST", "/api/login", { orgCode: oc, username: un, password: t }), await j("PATCH", "/api/account/password", { currentPassword: t, newPassword: n }), await j("POST", "/api/logout")];
      }, [temp, NEWPW, u.username, code]);
      await ctx.close();
    }
  }
  await dev.ctx.close();
  const H = await open(REAL, 390, code, "sh.one", NEWPW);
  const s0 = (await H.api("GET", "/api/shift")).json;
  if (s0 && s0.hasProfile && !s0.working) { await H.api("POST", "/api/shift/start", {}); await reload(H.page); }
  const s1 = (await H.api("GET", "/api/shift")).json;
  rec("Q: a fresh tenant's hospitalist has a rotation profile, no pending, nothing accepted (nothing demo)", s1 && s1.hasProfile && s1.pendingCount === 0 && s1.acceptedCount === 0, JSON.stringify(s1));
  await nav(H.page, "account", 2000);
  await H.page.locator('[data-shift-action="end"]').click();
  await sleep(1200);
  const v = await ui(H);
  rec("Q: the dialog says there are no pending requests; End shift is enabled with no covering provider", /no pending requests/.test(v.rule) && v.confirmDisabled === false, v.rule.slice(0, 160));
  await checkLayout(H.page, "real End shift dialog @390", ["[data-end-shift-dialog]"]);
  const mark = H.apiLog.length;
  await H.page.locator("[data-shift-confirm]").click();
  await sleep(1800);
  const w = writes(H.apiLog, mark);
  const s2 = (await H.api("GET", "/api/shift")).json;
  rec("Q: End shift is ONE write and the server has me off shift", w.length === 1 && w[0].p === "/api/shift/end" && w[0].s === 200 && s2.working === false, w.map((x) => x.m + " " + x.p + " " + x.s).join(", "));
  await H.ctx.close();
}

await browser.close();
rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
