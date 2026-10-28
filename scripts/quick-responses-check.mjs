/**
 * Quick responses (PerfectServe parity #6 — the existing message templates,
 * module messaging.templates), measured in REAL Chromium on emulated iPhones
 * (375×667 / 390×844 / 430×932, DPR 3, touch, iPhone Safari UA) against the
 * server's answer:
 *
 *   S. Settings → Quick responses: the page lists MY personal templates from
 *      the server (the org's read-only); Add is ONE POST (scope mine), Edit ONE
 *      PATCH, Delete ONE DELETE; after a reload the page shows what the server
 *      stores.
 *   C. The phone composer shows tap-to-insert chips — mine first, then the
 *      org's; a tap inserts the text into the message box (no request); a STAT
 *      template presets the STAT priority; the Edit chip opens the page.
 *   M. messaging.templates off: no chips, no Settings row, the page says so;
 *      POST 404 module_disabled.
 *   Q. (REAL_BASE_URL) SYNTHETIC_DATA=false: a fresh tenant's user has no
 *      quick responses and no demo ones — only "Add quick response".
 *   L. Layout at every width; Z. zero CSP violations / page errors.
 *
 *   BASE_URL=http://127.0.0.1:8861 [REAL_BASE_URL=… REAL_DEV_PASSWORD=…] node scripts/quick-responses-check.mjs
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
const writes = (log, from = 0) => log.slice(from).filter((r) => r.m !== "GET");
const srvMine = async (P) => ((await P.api("GET", "/api/messaging/templates")).json || []).filter((t) => t.scope === "mine");
const page = (P) => P.page.evaluate(() => ({
  state: (document.querySelector("[data-quick-responses-page]") || { getAttribute: () => null }).getAttribute("data-quick-responses-page"),
  items: [...document.querySelectorAll("[data-qr-item]")].map((e) => ({ id: Number(e.getAttribute("data-qr-item")), scope: e.getAttribute("data-qr-scope"), text: e.textContent })),
  row: !!document.querySelector("[data-qr-row]"),
}));
const chips = (P) => P.page.evaluate(() => {
  const bar = document.querySelector("[data-quick-responses]");
  return {
    bar: !!bar,
    ids: [...document.querySelectorAll("[data-quick-response]")].map((b) => Number(b.getAttribute("data-quick-response"))),
    labels: [...document.querySelectorAll("[data-quick-response]")].map((b) => b.textContent.trim()),
    manage: (document.querySelector("[data-quick-response-manage]") || { textContent: "" }).textContent.trim(),
    barOverflowsPage: bar ? bar.getBoundingClientRect().right > window.innerWidth + 0.5 : false,
    draft: (document.querySelector('input[aria-label="Message"]') || { value: null }).value,
    prio: (document.querySelector('[role="radiogroup"][aria-label="Priority"] [aria-checked=true]') || { textContent: null }).textContent,
  };
});
async function openThread(P, convId) {
  await nav(P.page, "messages", 1500);
  await P.page.locator(`[data-convo-row="${convId}"]`).click();
  await sleep(1500);
}

async function settingsRound(C, label) {
  // Start from a clean personal list (server truth).
  for (const t of await srvMine(C)) await C.api("DELETE", `/api/messaging/templates/${t.id}`);
  await nav(C.page, "account", 1800);
  rec(`S ${label}: Settings → Notifications has the Quick responses row`, (await page(C)).row);
  await C.page.locator("[data-qr-row]").click();
  await sleep(1500);
  let v = await waitFor(async () => { const x = await page(C); return x.state === "on" ? x : null; }, 8000);
  const orgRows = ((await C.api("GET", "/api/messaging/templates")).json || []).filter((t) => t.scope === "org");
  rec(`S ${label}: the page lists no personal ones, and the org's ${orgRows.length} read-only`, v && v.items.filter((i) => i.scope === "mine").length === 0 && v.items.filter((i) => i.scope === "org").length === orgRows.length
    && (await C.page.locator("[data-qr-item][data-qr-scope=org] [data-qr-edit]").count()) === 0, JSON.stringify(v && v.items.map((i) => i.scope)));
  await checkLayout(C.page, `${label} Quick responses page`, ["[data-quick-responses-page]"]);
  // Add.
  await C.page.locator("[data-qr-add]").click();
  await sleep(400);
  await C.page.locator("[data-qr-title]").fill("On my way " + RUN);
  await C.page.locator("[data-qr-body]").fill("On my way — 5 minutes.");
  await checkLayout(C.page, `${label} add form`, ["[data-qr-form]"]);
  let mark = C.apiLog.length;
  await C.page.locator("[data-qr-save]").click();
  await sleep(1500);
  let w = writes(C.apiLog, mark);
  let mine = await srvMine(C);
  v = await page(C);
  rec(`S ${label}: Add is ONE POST 201 (scope mine) and the page shows the server's row`, w.length === 1 && w[0].m === "POST" && w[0].p === "/api/messaging/templates" && w[0].s === 201 && JSON.parse(w[0].body).scope === "mine"
    && mine.length === 1 && v.items.some((i) => i.id === mine[0].id && i.scope === "mine"), w.map((x) => x.m + " " + x.p + " " + x.s).join(", "));
  // Edit (STAT priority, if the priority module is on).
  const id = mine[0].id;
  await C.page.locator(`[data-qr-edit="${id}"]`).click();
  await sleep(400);
  await C.page.locator("[data-qr-body]").fill("Coming now.");
  const hasPrio = (await C.page.locator('[data-qr-priority="stat"]').count()) > 0;
  if (hasPrio) await C.page.locator('[data-qr-priority="stat"]').click();
  mark = C.apiLog.length;
  await C.page.locator("[data-qr-save]").click();
  await sleep(1500);
  w = writes(C.apiLog, mark);
  mine = await srvMine(C);
  rec(`S ${label}: Edit is ONE PATCH 200 and the server stores it`, w.length === 1 && w[0].m === "PATCH" && w[0].s === 200 && mine[0].body === "Coming now." && (!hasPrio || mine[0].priority === "stat"), w.map((x) => x.m + " " + x.s).join(", ") + " " + JSON.stringify(mine[0]));
  await reload(C.page);
  await nav(C.page, "quick-responses", 2000);
  v = await waitFor(async () => { const x = await page(C); return x.items.some((i) => i.id === id && /Coming now\./.test(i.text)) ? x : null; }, 8000);
  rec(`S ${label}: after a reload the page shows what the server stores`, !!v);
  return id;
}

async function composerRound(C, convId, qrId, label) {
  await openThread(C, convId);
  const all = (await C.api("GET", "/api/messaging/templates")).json || [];
  const expectIds = all.filter((t) => t.scope === "mine").map((t) => t.id).concat(all.filter((t) => t.scope !== "mine").map((t) => t.id));
  let v = await waitFor(async () => { const x = await chips(C); return x.bar && x.ids.length === expectIds.length ? x : null; }, 8000);
  rec(`C ${label}: the composer shows the server's templates as chips, mine first`, v && JSON.stringify(v.ids) === JSON.stringify(expectIds), JSON.stringify({ got: v && v.ids, want: expectIds }));
  rec(`C ${label}: the chip strip scrolls inside itself (not past the page edge)`, v && !v.barOverflowsPage);
  await checkLayout(C.page, `${label} composer with chips`, ["[data-quick-responses]", "[data-composer]"]);
  const mark = C.apiLog.length;
  await C.page.locator(`[data-quick-response="${qrId}"]`).click();
  await sleep(500);
  v = await chips(C);
  const t = all.find((x) => x.id === qrId);
  rec(`C ${label}: a tap inserts the text into the message box — no request`, v.draft === t.body && writes(C.apiLog, mark).length === 0, JSON.stringify({ draft: v.draft }));
  rec(`C ${label}: a STAT quick response presets STAT`, t.priority !== "stat" || v.prio === "STAT", JSON.stringify({ prio: v.prio, tp: t.priority }));
  // Not sent: clear the draft, then the Edit chip opens the page.
  await C.page.locator('input[aria-label="Message"]').fill("");
  await C.page.locator("[data-quick-response-manage]").click();
  await sleep(1200);
  rec(`C ${label}: the Edit chip opens Settings → Quick responses`, (await page(C)).state === "on");
}

console.log("== synthetic server " + BASE);
{
  const dev = await open(BASE, 430, "DOCTURN", "dev");
  const ispn = (await dev.api("GET", "/api/dev/organizations")).json.find((o) => o.code === "ISPN");
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "messaging.templates", enabled: true });
  const ER = await open(BASE, 430, "ISPN", "er.doc");
  for (const width of [375, 390, 430]) {
    const C = await open(BASE, width, "ISPN", "chen");
    const me = (await C.api("GET", "/api/user")).json.id;
    const cv = (await ER.api("POST", "/api/messaging/conversations", { type: "direct", participantIds: [me] })).json;
    await ER.api("POST", "/api/messaging/send", { conversationId: cv.id, content: "quick response check " + RUN });
    await reload(C.page);
    const qrId = await settingsRound(C, "@" + width);
    await composerRound(C, cv.id, qrId, "@" + width);
    if (width === 430) {
      const mark = C.apiLog.length;
      await nav(C.page, "quick-responses", 1500);
      await C.page.locator(`[data-qr-delete="${qrId}"]`).click();
      await sleep(1500);
      const w = writes(C.apiLog, mark);
      const mine = await srvMine(C);
      rec("S @430: Delete is ONE DELETE 204 and the server no longer has it", w.length === 1 && w[0].m === "DELETE" && w[0].s === 204 && !mine.some((t) => t.id === qrId) && !(await page(C)).items.some((i) => i.id === qrId), w.map((x) => x.m + " " + x.s).join(", "));
    }
    await C.ctx.close();
  }

  // M. module off.
  const C = await open(BASE, 390, "ISPN", "chen");
  const me = (await C.api("GET", "/api/user")).json.id;
  const cv = (await ER.api("POST", "/api/messaging/conversations", { type: "direct", participantIds: [me] })).json;
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "messaging.templates", enabled: false });
  await reload(C.page);
  await openThread(C, cv.id);
  const cm = await chips(C);
  await nav(C.page, "account", 1500);
  const row = (await page(C)).row;
  await nav(C.page, "quick-responses", 1500);
  const pg = await page(C);
  const post = await C.api("POST", "/api/messaging/templates", { title: "x", body: "y" });
  rec("M messaging.templates off: no chips, no Settings row, the page says it is off; POST 404 module_disabled",
    !cm.bar && !row && pg.state === "off" && post.status === 404 && post.json && post.json.module === "messaging.templates", JSON.stringify({ bar: cm.bar, row, pg: pg.state, status: post.status }));
  await checkLayout(C.page, "Quick responses page (module off) @390", ["[data-quick-responses-page]"]);
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "messaging.templates", enabled: true });
  await C.ctx.close(); await ER.ctx.close(); await dev.ctx.close();
}

if (REAL) {
  console.log("== real server " + REAL);
  const dev = await open(REAL, 390, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD);
  const cfg = (await dev.api("GET", "/api/config")).json;
  rec("Q (setup) server is SYNTHETIC_DATA=false", cfg && cfg.syntheticData === false);
  const NEWPW = "Quick-Check-2026!";
  const code = "QR" + RUN;
  const o = (await dev.api("POST", "/api/dev/organizations", { name: "Quick Check " + RUN, code, timezone: "America/Chicago" })).json;
  const users = [];
  for (const [role, username] of [["hospitalist", "qr.hosp"], ["er_doctor", "qr.er"]]) {
    const r = await dev.api("POST", "/api/dev/users", { organizationId: o.id, role, username, displayName: "Dr. Qr " + role, credential: "MD", specialty: "Hospital Medicine", shiftType: "day", patientCap: 12 });
    users.push([username, r.json && r.json.temporaryPassword]);
  }
  for (const [un, temp] of users) {
    if (!temp) continue;
    const ctx = await browser.newContext(); const pg = await ctx.newPage();
    await pg.goto(REAL + "/", { waitUntil: "domcontentloaded" });
    await pg.evaluate(async ([t, n, u, oc]) => {
      const j = (m, path, b) => fetch(path, { method: m, credentials: "include", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((x) => x.status);
      return [await j("POST", "/api/login", { orgCode: oc, username: u, password: t }), await j("PATCH", "/api/account/password", { currentPassword: t, newPassword: n }), await j("POST", "/api/logout")];
    }, [temp, NEWPW, un, code]);
    await ctx.close();
  }
  await dev.ctx.close();
  const H = await open(REAL, 390, code, "qr.hosp", NEWPW);
  const E = await open(REAL, 430, code, "qr.er", NEWPW);
  const hid = (await H.api("GET", "/api/user")).json.id;
  const list = (await H.api("GET", "/api/messaging/templates")).json;
  rec("Q: a fresh tenant's user has no quick responses / templates at all (no demo rows)", Array.isArray(list) && list.length === 0, JSON.stringify(list));
  const cv = (await E.api("POST", "/api/messaging/conversations", { type: "direct", participantIds: [hid] })).json;
  await E.api("POST", "/api/messaging/send", { conversationId: cv.id, content: "real check" });
  await reload(H.page);
  await openThread(H, cv.id);
  const c = await chips(H);
  rec("Q: the composer offers only \"Add quick response\"", c.bar && c.ids.length === 0 && /Add quick response/.test(c.manage), JSON.stringify(c));
  await nav(H.page, "quick-responses", 1500);
  const p = await page(H);
  rec("Q: the page shows none yet, nothing from any demo", p.state === "on" && p.items.length === 0, JSON.stringify(p));
  await H.ctx.close(); await E.ctx.close();
}

await browser.close();
rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
