/**
 * Clinical screens truthfulness (A.CON clinical #1–#23), measured in REAL
 * Chromium on emulated iPhones (375×667 / 390×844 / 430×932, DPR 3, touch,
 * iPhone Safari UA). Each block re-runs a finder reproduction against the
 * fixed client and checks the SERVER's answer — what it stored, what a second
 * browser sees, what survives a reload — not the screen's claim.
 *
 *   1  ER diversion: Declare / Lift = PUT /api/er/diversion; org-wide (second
 *      browser, reload), a real broadcast every clinician reads, no EMS claim.
 *   2  ER roster = the org's er_doctor accounts; On/Off + shift persisted.
 *   3  ER throughput tiles = GET /api/reports/er (ER director + ER doctor).
 *   4  Care team = GET /api/care-team; On call / Link / Remove are writes the
 *      routing fan-out uses.
 *   5  "Message team" on an accepted patient = POST /api/messaging/patient-thread.
 *   6  "Current census" = the server's census.
 *   7–10 schedule panel / admissions counter / Reset / shifts (fixed earlier):
 *      re-checked against the server.
 *   11 provider rename = PATCH /api/hospitalists/:id/profile (reload, 2nd browser).
 *   12 refused provider removal (409) is said; the provider stays.
 *   13 board room edit = PATCH /api/patients/:id; status is not editable.
 *   14 Add admission = POST /api/patients + POST /api/assignments (on every board).
 *   15 Remove admission = DELETE /api/patients/:id (gone after reload).
 *   16 no EHR/FHIR bar, no invented patients.
 *   17/18 Extract = POST /api/patients/extract; empty note → nothing.
 *   19–21 consults sent with the named team; PA/NP picker = real accounts; no
 *      paging pills.
 *   22 ER doctor is not offered "Add a specialty".
 *   23 "+ Consult" toast follows the server's answer.
 *   R  SYNTHETIC_DATA=false server: no demo roster / care team / metrics / PA/NP.
 *   L  Layout of the changed panels: no overflow, controls ≥ 44×44, inputs ≥ 16px.
 *   Z  Zero CSP violations, zero page errors.
 *
 *   BASE_URL=http://127.0.0.1:8300 [REAL_BASE_URL=http://127.0.0.1:8301 REAL_DEV_PASSWORD=…]
 *   node scripts/clinical-truth-check.mjs
 * BASE_URL: a seeded synthetic server with RATE_LIMIT=off. Exits non-zero on failure.
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
const DEMO = /Ruth Osei|Paul Okafor|Dana Reyes|Sam Iyer|Nina Roy|Omar Haddad|Priya Shah|Marcus Bell|Lena Ortiz|Sam Cole|Dr\. Amir Patel|Dr\. Maria Lopez|fhir\.mayo|EHR1|EHR2/;
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
const toast = (page) => page.evaluate(() => { const t = document.querySelector("[data-toast]"); return t ? t.textContent : ""; });
const lastToast = (page) => page.evaluate(() => { const t = window.DT.getState().__toast; return t ? (t.title || "") + " — " + (t.msg || "") : ""; });
async function waitFor(fn, ms = 8000) { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(200); } return v; }
const tapButton = async (page, re, scope = "main") => {
  const ok = await page.evaluate(([src, sc]) => {
    const rx = new RegExp(src);
    const b = [...document.querySelectorAll(sc + " button")].find((x) => rx.test((x.textContent || "").trim()));
    if (!b) return false; b.scrollIntoView({ block: "center" }); b.click(); return true;
  }, [re.source, scope]);
  return ok;
};

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
  rec(`L: ${label} — inputs/selects ≥ 16px`, m.tinyInputs.length === 0, m.tinyInputs.slice(0, 4).join(" | "));
  rec(`L: ${label} — nothing past the right edge`, m.offscreen.length === 0, m.offscreen.slice(0, 4).join(" | "));
}
const fmtMin = (min) => { if (min == null) return "—"; const sec = Math.round(min * 60); return Math.floor(sec / 60) + "m " + String(sec % 60).padStart(2, "0") + "s"; };

// ── synthetic server ──────────────────────────────────────────────────────
console.log("== synthetic server " + BASE);
const E1 = await open(BASE, 375, "ISPN", "er.director");
const E2 = await open(BASE, 390, "ISPN", "er.director");
const banner = (page) => page.evaluate(() => { const el = document.querySelector("[data-diversion]"); return el ? { state: el.getAttribute("data-diversion"), text: el.innerText.replace(/\s+/g, " ") } : null; });

// #1 diversion
{
  const b0 = await waitFor(async () => { const b = await banner(E1.page); return b && b.state !== "loading" ? b : null; });
  const srv0 = (await E1.api("GET", "/api/er/diversion")).json;
  rec("#1 banner is the server's state", b0 && b0.state === (srv0.active ? "on" : "off"), JSON.stringify(b0) + " server=" + JSON.stringify(srv0));
  if (srv0.active) await E1.api("PUT", "/api/er/diversion", { active: false });
  const mark = E1.apiLog.length;
  const bcBefore = (await E1.api("GET", "/api/broadcasts")).json.length;
  await tapButton(E1.page, /^Declare diversion$/);
  const b1 = await waitFor(async () => { const b = await banner(E1.page); return b && b.state === "on" ? b : null; });
  const w = writes(E1.apiLog, mark);
  rec("#1 Declare is ONE server write (PUT /api/er/diversion 200)", w.length === 1 && /PUT \/api\/er\/diversion 200/.test(w[0]), w.join(", "));
  rec("#1 banner says declared (by whom), not 'EMS and all providers were notified'", b1 && /Declared by Dr\. Evan Marsh/.test(b1.text) && !/EMS and all providers were notified/.test(b1.text) && /DocTurn does not notify EMS/.test(b1.text), b1 && b1.text);
  const t = await lastToast(E1.page);
  rec("#1 toast = server's answer (broadcast count), says EMS is NOT notified", /Diversion declared/.test(t) && /Critical broadcast sent to \d+ (people|person)/.test(t) && /does not notify EMS/.test(t), t);
  const chen = await open(BASE, 430, "ISPN", "chen");
  const list = (await chen.api("GET", "/api/broadcasts")).json;
  rec("#1 a real broadcast every clinician reads (critical, ack), no EMS claim", list.length === bcBefore + 1 && list[0].severity === "critical" && /DIVERSION/i.test(list[0].message) && !/EMS/.test(list[0].message), JSON.stringify(list[0]));
  rec("#1 the hospitalist reads the org's diversion state", (await chen.api("GET", "/api/er/diversion")).json.active === true);
  await chen.ctx.close();
  const b2 = await waitFor(async () => { const b = await banner(E2.page); return b && b.state === "on" ? b : null; }, 6000);
  rec("#1 a second ER-director browser shows it live (DIVERSION_UPDATED)", !!b2, JSON.stringify(await banner(E2.page)));
  await reload(E1.page);
  rec("#1 survives a reload", (await banner(E1.page) || {}).state === "on", JSON.stringify(await banner(E1.page)));
  const aud = (await E1.api("GET", "/api/audit")).json;
  rec("#1 declare is in the server audit (high risk)", (aud.audit || []).some((r) => r.action === "er.diversion_declare" && r.riskLevel === "high"));
  await checkLayout(E1.page, "ER director diversion banner @375", ["[data-diversion]"]);
  const mark2 = E1.apiLog.length;
  await tapButton(E1.page, /^Lift diversion$/);
  const b3 = await waitFor(async () => { const b = await banner(E1.page); return b && b.state === "off" ? b : null; });
  rec("#1 Lift = PUT 200; banner back to accepting; server says not diverting", !!b3 && writes(E1.apiLog, mark2).some((x) => /PUT \/api\/er\/diversion 200/.test(x)) && (await E1.api("GET", "/api/er/diversion")).json.active === false, writes(E1.apiLog, mark2).join(", "));
}

// #2 roster, #3 ER director tiles
{
  const roster = (await E1.api("GET", "/api/er/roster")).json;
  const rows = await E1.page.evaluate(() => [...document.querySelectorAll("[data-er-physician]")].map((r) => r.getAttribute("data-er-physician")));
  rec("#2 roster rows = the server's ER physician accounts", JSON.stringify(rows) === JSON.stringify(roster.physicians.map((p) => String(p.userId))), JSON.stringify(rows) + " vs " + JSON.stringify(roster.physicians.map((p) => p.userId)));
  const txt = await mainText(E1.page);
  rec("#2 no demo ER physicians; the real one is listed", !DEMO.test(txt) && /Dr\. Erin Reyes/.test(txt));
  rec("#2 no local Add / Remove / rename on the roster", await E1.page.evaluate(() => !document.querySelector("[data-er-physician] button[title='Remove']") && !document.querySelector("[data-er-physician] span[title='Click to edit']")));
  const uid = roster.physicians[0].userId;
  const was = roster.physicians[0].onShift;
  const mark = E1.apiLog.length;
  await E1.page.locator(`[data-er-physician="${uid}"] button[aria-pressed]`).click();
  await sleep(1500);
  rec("#2 On/Off is PATCH /api/er/roster/:id 200 and the server flips", writes(E1.apiLog, mark).some((x) => new RegExp(`PATCH /api/er/roster/${uid} 200`).test(x)) && (await E1.api("GET", "/api/er/roster")).json.physicians[0].onShift === !was, writes(E1.apiLog, mark).join(", "));
  await E1.page.locator(`[data-er-physician="${uid}"] select`).selectOption("night");
  await sleep(1500);
  rec("#2 shift select persists on the server", (await E1.api("GET", "/api/er/roster")).json.physicians[0].shiftType === "night");
  await reload(E2.page);
  const e2row = await E2.page.evaluate((u) => { const r = document.querySelector(`[data-er-physician="${u}"]`); return r ? { on: r.querySelector("button[aria-pressed]").getAttribute("aria-pressed"), sel: r.querySelector("select").value } : null; }, uid);
  rec("#2 a second browser shows the server's On/Off and shift", e2row && e2row.on === String(!was) && e2row.sel === "night", JSON.stringify(e2row));
  // restore
  await E1.api("PATCH", `/api/er/roster/${uid}`, { onShift: was });
  const rep = (await E1.api("GET", "/api/reports/er")).json;
  const t3 = await mainText(E1.page);
  rec("#3 ER director 'Avg time-to-accept' = server (" + fmtMin(rep.assignments.timeToAcceptMinAvg) + ")", t3.includes(fmtMin(rep.assignments.timeToAcceptMinAvg)) && (rep.assignments.timeToAcceptMinAvg != null || !/4m 12s/.test(t3)), "server=" + JSON.stringify(rep.assignments));
  const admitsTile = await E1.page.evaluate(() => { const all = [...document.querySelectorAll("main *")]; const lab = all.find((e) => e.children.length === 0 && e.textContent.trim() === "Admits (24 h)"); if (!lab) return null; let c = lab; for (let i = 0; i < 4 && c; i++) { c = c.parentElement; if (c && /\d|—/.test(c.textContent.replace("Admits (24 h)", ""))) break; } return c ? c.innerText : null; });
  rec("#3 'Admits (24 h)' = server's " + rep.admits24h + " (no demo 15)", admitsTile && new RegExp("\\b" + rep.admits24h + "\\b").test(admitsTile), admitsTile);
  await checkLayout(E1.page, "ER director roster @375", ["card:[data-er-physician]"]);
}
await E1.ctx.close(); await E2.ctx.close();

// #3 ER doctor, #17-#22 intake
{
  const D = await open(BASE, 430, "ISPN", "er.doc");
  const rep = (await D.api("GET", "/api/reports/er")).json;
  const t = await mainText(D.page);
  rec("#3 ER doctor 'My shift' time-to-accept = server scope 'mine' (" + fmtMin(rep.assignments.timeToAcceptMinAvg) + ")", rep.scope === "mine" && t.includes(fmtMin(rep.assignments.timeToAcceptMinAvg)) && (rep.assignments.timeToAcceptMinAvg != null || !/4m 12s/.test(t)), JSON.stringify(rep.assignments));
  // #18 empty note
  let mark = D.apiLog.length;
  await tapButton(D.page, /^Extract fields$/);
  await sleep(800);
  const f0 = await D.page.evaluate(() => { const lab = (t) => { const l = [...document.querySelectorAll("label")].find((x) => x.textContent.trim() === t); return l ? document.getElementById(l.htmlFor).value : null; }; return [lab("Patient initials"), lab("Room / location"), lab("Chief complaint")]; });
  rec("#18 empty note: no extract request, nothing invented", D.apiLog.slice(mark).every((r) => r.p !== "/api/patients/extract") && JSON.stringify(f0) === JSON.stringify(["", "", ""]) && !/Chest pain, SOB on exertion/.test(await mainText(D.page)), JSON.stringify(f0));
  rec("#17 no 'Extract with AI' / 'AI-suggested' claim", !/Extract with AI|AI-suggested/.test(await mainText(D.page)));
  // #17 server extraction
  await D.page.locator("textarea").first().fill("Patient J.K. room 612 with crushing chest pain");
  mark = D.apiLog.length;
  await tapButton(D.page, /^Extract fields$/);
  await sleep(1500);
  const f1 = await D.page.evaluate(() => { const lab = (t) => { const l = [...document.querySelectorAll("label")].find((x) => x.textContent.trim() === t); return l ? document.getElementById(l.htmlFor).value : null; }; return [lab("Patient initials"), lab("Room / location")]; });
  const by = await D.page.evaluate(() => { const e = document.querySelector("[data-extracted-by]"); return e ? e.getAttribute("data-extracted-by") + "|" + e.textContent : null; });
  rec("#17 Extract = POST /api/patients/extract 200; fields = the server's", writes(D.apiLog, mark).some((x) => /POST \/api\/patients\/extract 200/.test(x)) && f1[0] === "JK" && f1[1] === "612", writes(D.apiLog, mark).join(", ") + " " + JSON.stringify(f1));
  rec("#17 label names the engine that ran (local → keyword rules, no AI)", by && /^local\|/.test(by) && /keyword rules \(no AI\)/.test(by), by);
  // #19-#21 consult with a real PA
  await tapButton(D.page, /^Cardiology$/);
  await sleep(500);
  const ptxt = await D.page.evaluate(() => { const p = document.querySelector('[data-consult-panel="Cardiology"]'); return p ? p.innerText : null; });
  rec("#21 no 'App push' / 'Text / SMS' / 'Won't be paged' pills", ptxt && !/App push|Text \/ SMS|Won't be paged/.test(ptxt), ptxt);
  await tapButton(D.page, /^Add PA \/ NP$/);
  await sleep(400);
  const picker = await D.page.evaluate(() => { const p = document.querySelector("[data-midlevel-picker]"); return p ? p.innerText : null; });
  rec("#20 PA/NP picker = the org's real PA/NP accounts (Jordan Wu), no demo pool", picker && /Jordan Wu/.test(picker) && !DEMO.test(picker), picker);
  await D.page.evaluate(() => { const b = [...document.querySelectorAll("[data-midlevel-picker] button")].find((x) => /Jordan Wu/.test(x.textContent)); if (b) b.click(); });
  await sleep(300);
  const alerts = await D.page.evaluate(() => { const e = document.querySelector("[data-consult-alerts]"); return e ? e.textContent : null; });
  rec("#20 the panel says who will be alerted (real accounts)", alerts && /Alerted in DocTurn: .*Jordan Wu/.test(alerts), alerts);
  await checkLayout(D.page, "ER intake consult panel @430", ['[data-consult-panel="Cardiology"]']);
  const ini = "C" + RUN.slice(0, 1);
  await D.page.evaluate((v) => { const l = [...document.querySelectorAll("label")].find((x) => x.textContent.trim() === "Patient initials"); const i = document.getElementById(l.htmlFor); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, v); i.dispatchEvent(new Event("input", { bubbles: true })); }, ini);
  await sleep(1200);
  mark = D.apiLog.length;
  const sent = await tapButton(D.page, /^Send assignment \+ 1 consult$/);
  // The toast lives ~2.8 s: catch the server-answer one while it is up.
  const t2 = await waitFor(async () => { const t = await lastToast(D.page); return /Consults:/.test(t) ? t : null; }, 6000);
  await sleep(500);
  const w = writes(D.apiLog, mark);
  const consultPost = w.find((x) => /POST \/api\/patients\/\d+\/consults 201/.test(x));
  rec("#19 'Send assignment + 1 consult' = POST patient + POST assignment + POST consults (201)", sent && /POST \/api\/patients 201/.test(w[0] || "") && w.some((x) => /POST \/api\/assignments 201/.test(x)) && !!consultPost, w.join(", "));
  const pid = consultPost ? Number(consultPost.match(/patients\/(\d+)/)[1]) : null;
  const consults = pid ? (await D.api("GET", `/api/patients/${pid}/consults`)).json : [];
  const wuId = ((await D.api("GET", "/api/care-team/candidates")).json || []).find((c) => /Jordan Wu/.test(c.displayName));
  rec("#19 the server stored the Cardiology consult with the named team (incl. Jordan Wu's account)", Array.isArray(consults) && consults.length >= 1 && consults.every((c) => c.specialty === "Cardiology") && consults.some((c) => wuId && c.consultantUserId === wuId.userId), JSON.stringify(consults));
  rec("#19 toast says what each consult did", /Consults: Cardiology → .*Jordan Wu/.test(t2), t2);
  // #22
  await tapButton(D.page, /^Customize$/);
  await sleep(300);
  rec("#22 ER doctor is not offered 'Add a specialty…'", await D.page.evaluate(() => !document.querySelector('input[placeholder="Add a specialty…"]')));
  await D.ctx.close();
}

// #4 care team, #5 Message team, #6 census, #23 consult toast (hospitalist)
{
  const C = await open(BASE, 390, "ISPN", "chen");
  const me = (await C.api("GET", "/api/user")).json;
  const hosps = (await C.api("GET", "/api/hospitalists")).json;
  const myH = hosps.find((h) => h.userId === me.id);
  // #6 director sets chen's census
  const Dir = await open(BASE, 375, "ISPN", "director");
  const cs = await Dir.api("PATCH", `/api/hospitalists/${myH.id}/census`, { currentPatientCount: 9, reason: "clinical-truth-check" });
  rec("#6 (setup) director sets the census to 9 on the server", cs.status === 200, "status=" + cs.status);
  // #5 setup: an accepted patient for chen
  const er = await open(BASE, 430, "ISPN", "er.doc");
  const p = await er.api("POST", "/api/patients", { initials: "M" + RUN.slice(0, 1), roomNumber: "5" + RUN.slice(0, 2), issueSummary: "clinical truth check", specialty: "Cardiology" });
  const a = await er.api("POST", "/api/assignments", { patientId: p.json.id, mode: "manual", hospitalistId: myH.id });
  const acc = await C.api("PATCH", `/api/assignments/${a.json.id}/accept`);
  rec("#5 (setup) chen has an accepted patient on the server", p.status === 201 && a.status === 201 && acc.status === 200, [p.status, a.status, acc.status].join("/"));
  await er.ctx.close();
  await reload(C.page);
  const census = (await C.api("GET", "/api/hospitalists")).json.find((h) => h.id === myH.id);
  const t = await mainText(C.page);
  rec("#6 'Current census' = the server's " + census.currentPatientCount + " / " + census.patientCap, t.includes(census.currentPatientCount + " / " + census.patientCap), "server=" + census.currentPatientCount);
  const convosBefore = ((await C.api("GET", "/api/messaging/conversations")).json || []).length;
  let mark = C.apiLog.length;
  const tapped = await tapButton(C.page, /^Message team$/);
  await sleep(2500);
  const w = writes(C.apiLog, mark);
  const navNow = await C.page.evaluate(() => window.DT.getState().ui.nav);
  const composer = await C.page.evaluate(() => !!document.querySelector("[data-composer]"));
  rec("#5 'Message team' = POST /api/messaging/patient-thread 2xx → Messages with a composer", tapped && w.some((x) => /POST \/api\/messaging\/patient-thread 20[01]/.test(x)) && navNow === "messages" && composer, w.join(", ") + " nav=" + navNow + " composer=" + composer);
  const convosAfter = ((await C.api("GET", "/api/messaging/conversations")).json || []).length;
  rec("#5 the thread exists on the server (survives reload)", convosAfter >= Math.max(1, convosBefore), convosBefore + "→" + convosAfter);
  // #23 consult toast
  await nav(C.page, "dashboard", 1500);
  mark = C.apiLog.length;
  const r23 = await C.page.evaluate((pid) => window.DT.actions.requestConsult(pid, "Nephrology"), p.json.id);
  const t23 = await lastToast(C.page);
  rec("#23 '+ Consult' with nobody covering → 'recorded — nobody alerted', after the server's 201", writes(C.apiLog, mark).some((x) => /POST \/api\/patients\/\d+\/consults 201/.test(x)) && /nobody alerted/.test(t23) && !/has been notified/.test(t23), t23 + " " + JSON.stringify(r23));
  // #4 care team
  await nav(C.page, "team", 1800);
  const team = (await C.api("GET", "/api/care-team")).json;
  const shown = await C.page.evaluate(() => [...document.querySelectorAll("[data-team-member]")].map((x) => x.getAttribute("data-team-member")));
  rec("#4 members = the server's (" + team.members.map((m) => m.displayName).join(", ") + ")", JSON.stringify(shown) === JSON.stringify(team.members.map((m) => String(m.userId))), JSON.stringify(shown));
  rec("#4 no demo members / candidates; badge is the server's count", !DEMO.test(await mainText(C.page)) && !/Connected · 2 on call/.test(await mainText(C.page)));
  const wu = team.members.find((m) => /Jordan Wu/.test(m.displayName));
  if (wu) {
    mark = C.apiLog.length;
    await C.page.locator(`[data-team-member="${wu.userId}"] button[aria-pressed]`).click();
    await sleep(1500);
    const after = (await C.api("GET", "/api/care-team")).json.members.find((m) => m.userId === wu.userId);
    rec("#4 On call → Off call is PATCH 200 and the server holds it", writes(C.apiLog, mark).some((x) => new RegExp(`PATCH /api/care-team/members/${wu.userId} 200`).test(x)) && after.onCall === !wu.onCall, writes(C.apiLog, mark).join(", "));
    const tg = await C.api("GET", "/api/messaging/on-call-targets");
    const routed = (tg.json || []).some((x) => x.kind === "care_team" && x.userId === wu.userId);
    rec("#4 on-call targets follow the server (care_team target " + (after.onCall ? "present" : "gone") + ")", tg.status !== 200 || routed === after.onCall, JSON.stringify((tg.json || []).filter((x) => x.kind === "care_team")));
    await C.page.locator(`[data-team-member="${wu.userId}"] button[aria-pressed]`).click();
    await sleep(1200);
    rec("#4 toggled back on the server", (await C.api("GET", "/api/care-team")).json.members.find((m) => m.userId === wu.userId).onCall === wu.onCall);
  }
  await tapButton(C.page, /^Add member$/);
  await sleep(500);
  const cands = await C.page.evaluate(() => [...document.querySelectorAll("[data-candidate]")].map((x) => x.innerText.split("\n")[0]));
  rec("#4 candidates are the org's real people", cands.length > 0 && cands.every((n) => !DEMO.test(n)), cands.slice(0, 5).join(", "));
  const target = (await C.api("GET", "/api/care-team/candidates")).json.find((c) => c.role === "hospitalist" && c.active !== false);
  mark = C.apiLog.length;
  await C.page.locator(`[data-candidate="${target.userId}"] button`).click();
  await sleep(1800);
  rec("#4 Link = POST /api/care-team/members 201; on the server and on screen", writes(C.apiLog, mark).some((x) => /POST \/api\/care-team\/members 201/.test(x)) && (await C.api("GET", "/api/care-team")).json.members.some((m) => m.userId === target.userId) && await C.page.evaluate((u) => !!document.querySelector(`[data-team-member="${u}"]`), target.userId), writes(C.apiLog, mark).join(", "));
  await checkLayout(C.page, "care team @390", ["[data-team-member]"]);
  await reload(C.page);
  await nav(C.page, "team", 1800);
  rec("#4 the link survives a reload", await C.page.evaluate((u) => !!document.querySelector(`[data-team-member="${u}"]`), target.userId));
  mark = C.apiLog.length;
  await C.page.locator(`[data-team-member="${target.userId}"] button[aria-label^="Remove"]`).click();
  await sleep(1800);
  rec("#4 Remove = DELETE 204; gone on the server", writes(C.apiLog, mark).some((x) => new RegExp(`DELETE /api/care-team/members/${target.userId} 204`).test(x)) && !(await C.api("GET", "/api/care-team")).json.members.some((m) => m.userId === target.userId), writes(C.apiLog, mark).join(", "));
  await C.ctx.close();

  // #7-#10 (fixed earlier) re-checked, #11-#16 director
  const Dir2 = await open(BASE, 390, "ISPN", "director");
  const src = (await Dir.api("GET", "/api/oncall/sources")).json;
  const panel = await Dir.page.evaluate(() => { const el = document.querySelector("[data-schedule-panel]"); return el ? { key: el.getAttribute("data-schedule-panel"), text: el.innerText } : null; });
  rec("#7 schedule panel = server source (" + src.selected + "), no 'Amion · 2m ago'", panel && panel.key === src.selected && !/2m ago/.test(panel.text), panel && panel.text.replace(/\s+/g, " "));
  const adm = (await Dir.api("GET", "/api/admissions")).json;
  const since = await Dir.page.evaluate(() => { const el = document.querySelector("[data-admissions-since]"); return el ? el.textContent.trim() : null; });
  rec("#8 admissions counter = server's sinceReset (" + adm.sinceReset + ")", since === String(adm.sinceReset), since);
  rec("#8 no demo admissions on the director dashboard", !/\b(MJ|RV|DK|LP)\b.*Dr\. (Amir Patel|Maria Lopez)/.test(await mainText(Dir.page)));
  rec("#9 'Reset count' (server reset), not the local 'Reset 24h'", await Dir.page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Reset count") && ![...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Reset 24h")));
  const shifts = (await Dir.api("GET", "/api/org/shifts")).json.shifts;
  const label = await Dir.page.evaluate(() => { const el = document.querySelector('[data-shift-label="day"]'); return el ? el.textContent.trim() : null; });
  rec("#10 shift name = the org's (" + shifts[0].label + ")", label === shifts[0].label, label);

  // #11 rename a provider through the row's inline editor
  const prov = (await Dir.api("GET", "/api/physicians/directory")).json.find((d) => /George/.test(d.displayName));
  const newName = prov.displayName.replace(/ Renamed.*$/, "") + " Renamed " + RUN;
  await nav(Dir.page, "dashboard", 1500);
  mark = Dir.apiLog.length;
  const opened = await Dir.page.evaluate((n) => { const s = [...document.querySelectorAll("span[title='Click to edit']")].find((x) => x.textContent.trim() === n); if (!s) return false; s.scrollIntoView({ block: "center" }); s.click(); return true; }, prov.displayName);
  await sleep(300);
  if (opened) {
    const inp = Dir.page.locator("main input:focus");
    await inp.fill(newName);
    await inp.press("Enter");
  }
  await sleep(2000);
  rec("#11 rename = PATCH /api/hospitalists/:id/profile 200", opened && writes(Dir.apiLog, mark).some((x) => new RegExp(`PATCH /api/hospitalists/${prov.id}/profile 200`).test(x)), writes(Dir.apiLog, mark).join(", "));
  const srvName = (await Dir.api("GET", "/api/physicians/directory")).json.find((d) => d.id === prov.id).displayName;
  rec("#11 the server holds the new name", srvName === newName, srvName);
  await reload(Dir2.page);
  rec("#11 a second browser shows it after reload", (await mainText(Dir2.page)).includes(newName));
  const audit11 = (await Dir.api("GET", "/api/audit")).json.audit || [];
  rec("#11 audited (hospitalist.profile_update)", audit11.some((r) => r.action === "hospitalist.profile_update"));
  await Dir.api("PATCH", `/api/hospitalists/${prov.id}/profile`, { displayName: prov.displayName.replace(/ Renamed.*$/, "") });

  // #12 refused removal
  const erB = await open(BASE, 375, "ISPN", "er.doc");
  const victim = (await Dir.api("GET", "/api/hospitalists")).json.find((h) => h.id !== myH.id && h.working);
  const vName = (await Dir.api("GET", "/api/physicians/directory")).json.find((d) => d.id === victim.id).displayName;
  const pp = await erB.api("POST", "/api/patients", { initials: "P" + RUN.slice(0, 1), roomNumber: "6" + RUN.slice(0, 2), issueSummary: "pending for removal check" });
  const pa = await erB.api("POST", "/api/assignments", { patientId: pp.json.id, mode: "manual", hospitalistId: victim.id });
  rec("#12 (setup) a pending request to " + vName, pa.status === 201, "status=" + pa.status);
  await reload(Dir.page);
  mark = Dir.apiLog.length;
  const trash = await Dir.page.evaluate((n) => { const b = document.querySelector(`button[aria-label="Remove ${n} from the rotation"]`); if (!b) return false; b.scrollIntoView({ block: "center" }); b.click(); return true; }, vName);
  await sleep(2000);
  const t12 = await lastToast(Dir.page);
  rec("#12 removal refused by the server (409) is SAID", trash && writes(Dir.apiLog, mark).some((x) => new RegExp(`DELETE /api/physicians/${victim.id} 409`).test(x)) && /Couldn't remove/.test(t12) && /admission request waiting/.test(t12), writes(Dir.apiLog, mark).join(", ") + " | " + t12);
  rec("#12 the row stays and the server still lists the provider", (await mainText(Dir.page)).includes(vName) && (await Dir.api("GET", "/api/hospitalists")).json.some((h) => h.id === victim.id));
  await erB.ctx.close();

  // #13-#16 patient board
  await nav(Dir.page, "board", 2000);
  const boardTxt = await mainText(Dir.page);
  rec("#16 no EHR/FHIR bar, no 'Connect EHR', no invented EHR patients", !/Connect EHR|synced from Epic FHIR|fhir\.mayo|EHR1|EHR2/.test(boardTxt) && await Dir.page.evaluate(() => !document.querySelector("[data-testid=data-source-banner]")));
  rec("#13 status is not an editable select (no Observation / Transfer)", await Dir.page.evaluate(() => ![...document.querySelectorAll("main select")].some((s) => [...s.options].some((o) => /Observation|Transfer/.test(o.textContent)))));
  const pts = (await Dir.api("GET", "/api/patients")).json;
  const tgt = pts.find((x) => x.id === pp.json.id);
  const newRoom = "9" + RUN.slice(0, 2) + "X";
  mark = Dir.apiLog.length;
  const roomOpened = await Dir.page.evaluate((room) => {
    const s = [...document.querySelectorAll("main span[title='Click to edit']")].find((x) => x.textContent.trim() === room);
    if (!s) return false; s.scrollIntoView({ block: "center" }); s.click(); return true;
  }, tgt.roomNumber);
  await sleep(300);
  if (roomOpened) { const inp = Dir.page.locator("main input:focus"); await inp.fill(newRoom); await inp.press("Enter"); }
  await sleep(2000);
  rec("#13 room edit = PATCH /api/patients/:id 200; the server holds it", roomOpened && writes(Dir.apiLog, mark).some((x) => new RegExp(`PATCH /api/patients/${tgt.id} 200`).test(x)) && (await Dir.api("GET", "/api/patients")).json.find((x) => x.id === tgt.id).roomNumber === newRoom, writes(Dir.apiLog, mark).join(", "));
  await checkLayout(Dir.page, "director patient board @375", ["main"]);
  // #14 Add admission through the modal
  await tapButton(Dir.page, /^Add admission$/);
  await sleep(600);
  const modalHasAdmittedBy = await Dir.page.evaluate(() => [...document.querySelectorAll("label")].some((l) => l.textContent.trim() === "Admitted by"));
  rec("#14 the modal has no free-text 'Admitted by' (the server records who added it)", !modalHasAdmittedBy);
  await checkLayout(Dir.page, "Add admission modal @375", ['div[style*="position: fixed"] div[style*="radius"]']);
  const zz = "Z" + RUN.slice(0, 1);
  await Dir.page.evaluate(([v, issue]) => {
    const set = (label, val) => { const l = [...document.querySelectorAll("label")].find((x) => x.textContent.trim() === label); const i = document.getElementById(l.htmlFor); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; s.call(i, val); i.dispatchEvent(new Event("input", { bubbles: true })); };
    set("Initials", v); set("Room", "555"); set("Presenting issue", issue);
  }, [zz, "Sweep manual admission " + RUN]);
  await sleep(200);
  mark = Dir.apiLog.length;
  await Dir.page.evaluate(() => { const bs = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Add admission"); bs[bs.length - 1].click(); });
  await sleep(2500);
  const w14 = writes(Dir.apiLog, mark);
  rec("#14 Add admission = POST /api/patients 201 + POST /api/assignments 201", w14.some((x) => /POST \/api\/patients 201/.test(x)) && w14.some((x) => /POST \/api\/assignments 201/.test(x)), w14.join(", ") + " | " + await lastToast(Dir.page));
  const erC = await open(BASE, 430, "ISPN", "er.doc");
  const erBoard = (await erC.api("GET", "/api/patient-board")).json;
  const added = erBoard.find((r) => r.patient.initials === zz);
  rec("#14 the admission is on the ER doctor's board (routed: " + (added && added.status) + ")", !!added && added.status === "pending", JSON.stringify(added && added.patient));
  await erC.ctx.close();
  // #15 Remove it from the board
  await reload(Dir.page);
  await nav(Dir.page, "board", 2000);
  mark = Dir.apiLog.length;
  const rm = await Dir.page.evaluate((v) => { const b = document.querySelector(`button[aria-label="Remove patient ${v}"]`); if (!b) return false; b.scrollIntoView({ block: "center" }); b.click(); return true; }, zz);
  await sleep(2500);
  rec("#15 Remove admission = DELETE /api/patients/:id 200; gone on the server", rm && writes(Dir.apiLog, mark).some((x) => /DELETE \/api\/patients\/\d+ 200/.test(x)) && !(await Dir.api("GET", "/api/patients")).json.some((x) => x.initials === zz), writes(Dir.apiLog, mark).join(", "));
  await reload(Dir.page);
  await nav(Dir.page, "board", 2000);
  rec("#15 still gone after a reload", !(await Dir.page.evaluate((v) => !!document.querySelector(`button[aria-label="Remove patient ${v}"]`), zz)));
  const audit15 = (await Dir.api("GET", "/api/audit")).json.audit || [];
  rec("#15 deletion audited (patient.delete, high)", audit15.some((r) => r.action === "patient.delete" && r.riskLevel === "high"));
  await Dir.ctx.close(); await Dir2.ctx.close();
}

// ── SYNTHETIC_DATA=false server: nothing demo, server answers only ────────
if (REAL) {
  console.log("== real server " + REAL);
  const dev = await open(REAL, 390, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD);
  const cfg = (await dev.api("GET", "/api/config")).json;
  rec("R (setup) server is SYNTHETIC_DATA=false", cfg && cfg.syntheticData === false);
  const NEWPW = "Fix-Clinical-2026!";
  let org = ((await dev.api("GET", "/api/dev/organizations")).json || []).find((o) => o.code === "LAKE");
  if (!org) org = (await dev.api("POST", "/api/dev/organizations", { name: "Lake Clinical Hospital", code: "LAKE", timezone: "America/Chicago" })).json;
  const people = [
    { role: "er_director", username: "lk.erdir", displayName: "Dr. Lake ErDirector", credential: "MD" },
    { role: "er_doctor", username: "lk.erdoc", displayName: "Dr. Priya Erdoc", credential: "MD" },
    { role: "hospitalist", username: "lk.hosp", displayName: "Dr. Lake Hospitalist", credential: "MD", specialty: "Hospital Medicine", shiftType: "day", patientCap: 12 },
    { role: "director", username: "lk.dir", displayName: "Dr. Lake Director", credential: "MD" },
  ];
  for (const u of people) {
    const r = await dev.api("POST", "/api/dev/users", { organizationId: org.id, ...u });
    const temp = r.json && r.json.temporaryPassword;
    if (temp) {
      const ctx = await browser.newContext(); const pg = await ctx.newPage();
      await pg.goto(REAL + "/", { waitUntil: "domcontentloaded" });
      await pg.evaluate(async ([t, n, un]) => {
        const j = (m, path, b) => fetch(path, { method: m, credentials: "include", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((x) => x.status);
        return [await j("POST", "/api/login", { orgCode: "LAKE", username: un, password: t }), await j("PATCH", "/api/account/password", { currentPassword: t, newPassword: n }), await j("POST", "/api/logout")];
      }, [temp, NEWPW, u.username]);
      await ctx.close();
    }
  }
  await dev.ctx.close();
  const ED = await open(REAL, 375, "LAKE", "lk.erdir", NEWPW);
  await sleep(800);
  const t1 = await mainText(ED.page);
  const roster = (await ED.api("GET", "/api/er/roster")).json;
  rec("R ER director roster = server (only Dr. Priya Erdoc), no demo names", roster.physicians.length === 1 && /Dr\. Priya Erdoc/.test(t1) && !DEMO.test(t1), roster.physicians.map((p) => p.displayName).join(","));
  rec("R roster header says '0 of 1 on shift' (server)", /0 of 1 on shift/.test(t1));
  const rep = (await ED.api("GET", "/api/reports/er")).json;
  rec("R throughput tiles '—' / 0 from the server, never 4m 12s / 15", rep.assignments.timeToAcceptMinAvg === null && /—/.test(t1) && !/4m 12s/.test(t1) && !/Admits today\s*15/.test(t1), JSON.stringify(rep));
  rec("R diversion banner = server (accepting)", (await banner(ED.page) || {}).state === "off");
  await checkLayout(ED.page, "real ER director dashboard @375", ["[data-diversion]", "card:[data-er-physician]"]);
  await ED.ctx.close();
  const EDoc = await open(REAL, 390, "LAKE", "lk.erdoc", NEWPW);
  const t2 = await mainText(EDoc.page);
  rec("R ER doctor 'My shift' time-to-accept '—' (no constant)", !/4m 12s/.test(t2) && /none of yours accepted yet|—/.test(t2));
  await tapButton(EDoc.page, /^Extract fields$/);
  await sleep(600);
  const f = await EDoc.page.evaluate(() => { const l = [...document.querySelectorAll("label")].find((x) => x.textContent.trim() === "Patient initials"); return l ? document.getElementById(l.htmlFor).value : null; });
  rec("R empty-note extract invents no patient", f === "" && !/Chest pain, SOB on exertion/.test(await mainText(EDoc.page)), f);
  await tapButton(EDoc.page, /^Cardiology$/);
  await sleep(400);
  rec("R no PA/NP picker without PA/NP accounts (no demo pool)", await EDoc.page.evaluate(() => ![...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Add PA / NP")) && !DEMO.test(await mainText(EDoc.page)));
  await checkLayout(EDoc.page, "real ER intake @390", ['[data-consult-panel="Cardiology"]']);
  await EDoc.ctx.close();
  const H = await open(REAL, 430, "LAKE", "lk.hosp", NEWPW);
  await nav(H.page, "team", 1500);
  const t3 = await mainText(H.page);
  rec("R care team empty from the server; no demo members / 'Connected · 2 on call'", /No team members yet/.test(t3) && !/Connected · 2 on call/.test(t3) && !DEMO.test(t3));
  await nav(H.page, "dashboard", 1200);
  rec("R hospitalist census tile = server (0 / 12)", /0 \/ 12/.test(await mainText(H.page)));
  await H.ctx.close();
  const RD = await open(REAL, 390, "LAKE", "lk.dir", NEWPW);
  await nav(RD.page, "board", 1500);
  const t4 = await mainText(RD.page);
  rec("R director board: no FHIR bar, no invented patients", !/Connect EHR|FHIR|fhir\.mayo|EHR1|EHR2/.test(t4) && !DEMO.test(t4));
  await RD.ctx.close();
}

await browser.close();
rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
