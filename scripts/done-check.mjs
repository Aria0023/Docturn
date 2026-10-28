/**
 * Done (PerfectServe parity #3), measured in REAL Chromium on emulated iPhones
 * (375×667 / 390×844 / 430×932, DPR 3, touch, iPhone Safari UA) against the
 * server's answer:
 *
 *   D. Mark done (the thread header's toggle) is ONE server write; the server
 *      lists the thread done with unreadCount 0; it leaves the Inbox for the
 *      Done filter, shows no unread badge and stops counting in the unread
 *      total; a second device of the same person follows over the WS hub
 *      without a reload; a new message from the other person re-opens it on
 *      both devices (and on the server) with no write; "Move back to inbox"
 *      from the Done filter is one DELETE.
 *   M. messaging.done off: no filter, no toggle, nothing Done; 404.
 *   Q. (REAL_BASE_URL) SYNTHETIC_DATA=false: the same round trip on a fresh tenant.
 *   L. Layout at every width; Z. zero CSP violations / page errors.
 *
 *   BASE_URL=http://127.0.0.1:8821 [REAL_BASE_URL=… REAL_DEV_PASSWORD=…] node scripts/done-check.mjs
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
const srvRow = async (P, id) => ((await P.api("GET", "/api/messaging/conversations")).json || []).find((c) => c.id === id);
const srvUnread = async (P) => ((await P.api("GET", "/api/messaging/conversations")).json || []).reduce((a, c) => a + (c.unreadCount || 0), 0);
const view = (P, id) => P.page.evaluate((cid) => {
  const s = window.DT.getState();
  const c = (s.conversations || []).find((x) => x.id === cid);
  const row = document.querySelector(`[data-convo-row="${cid}"]`);
  const box = document.querySelector("[data-box][aria-pressed=true]");
  return {
    done: c ? window.DT.convoDone(c) : null,
    total: window.DT.unreadMessages(),
    row: !!row, badge: row ? !!row.querySelector("[data-unread-badge]") : null,
    box: box ? box.getAttribute("data-box") : null,
    toggle: (document.querySelector("[data-done-toggle]") || { getAttribute: () => null }).getAttribute("data-done-toggle"),
  };
}, id);
const openRow = async (P, id) => { await P.page.locator(`[data-convo-row="${id}"]`).click(); await sleep(1500); };
const pickBox = async (P, b) => { await P.page.locator(`[data-box="${b}"]`).click(); await sleep(400); };
const back = async (P) => { const b = P.page.locator('button[aria-label="Back to conversations"]'); if (await b.count()) { await b.click(); await sleep(500); } };

async function roundTrip(base, org, sender, receiver, pw, width, label) {
  const S = await open(base, 430, org, sender, pw);
  const meR = await open(base, width, org, receiver, pw);
  const rId = (await meR.api("GET", "/api/user")).json.id;
  const conv = (await S.api("POST", "/api/messaging/conversations", { type: "direct", participantIds: [rId] })).json;
  // A fresh pair each time: a conversation re-used from an earlier width keeps
  // its own history, which is fine — Done is through the newest message.
  await S.api("POST", "/api/messaging/send", { conversationId: conv.id, content: "done check one " + RUN });
  await S.api("POST", "/api/messaging/send", { conversationId: conv.id, content: "done check two " + RUN });
  await meR.page.reload({ waitUntil: "networkidle" });
  await meR.page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
  await sleep(2000);
  const R2 = await open(base, width === 375 ? 430 : 375, org, receiver, pw);
  await nav(meR.page, "messages", 1500); await nav(R2.page, "messages", 1500);
  let v = await waitFor(async () => { const x = await view(meR, conv.id); return x.row ? x : null; }, 10000);
  const unread0 = await srvUnread(meR);
  rec(`D ${label}: before — in the Inbox with its unread badge; total = the server's unread (${unread0})`, v && v.row && v.badge && v.done === false && v.total === unread0, JSON.stringify(v));
  await checkLayout(meR.page, `${label} message list`, ["[data-message-boxes]"]);
  await openRow(meR, conv.id);
  await checkLayout(meR.page, `${label} thread header`, ["[data-done-toggle]"]);
  let mark = meR.apiLog.length;
  await meR.page.locator('[data-done-toggle="open"] button').click();
  await sleep(1800);
  let w = writes(meR.apiLog, mark);
  const s1 = await srvRow(meR, conv.id);
  rec(`D ${label}: Mark done is ONE write (PUT …/done 200) and the server lists it done, unreadCount 0`, w.length === 1 && w[0].m === "PUT" && w[0].p === `/api/messaging/conversations/${conv.id}/done` && w[0].s === 200 && s1.done === true && s1.unreadCount === 0, w.map((x) => x.m + " " + x.p + " " + x.s).join(", ") + " " + JSON.stringify({ done: s1.done, u: s1.unreadCount }));
  await back(meR);
  v = await view(meR, conv.id);
  const unread1 = await srvUnread(meR);
  rec(`D ${label}: it left the Inbox, and the unread total = the server's (${unread1})`, v.done === true && v.box === "inbox" && !v.row && v.total === unread1, JSON.stringify(v));
  await pickBox(meR, "done");
  v = await view(meR, conv.id);
  rec(`D ${label}: it is in the Done filter, with no unread badge`, v.row && v.badge === false, JSON.stringify(v));
  const v2 = await waitFor(async () => { const x = await view(R2, conv.id); return x.done === true ? x : null; }, 10000);
  rec(`D ${label}: the second device follows without a reload (WS)`, !!v2, JSON.stringify(v2));

  // A new message re-opens it everywhere, with no write by the receiver.
  mark = meR.apiLog.length;
  await S.api("POST", "/api/messaging/send", { conversationId: conv.id, content: "done check three " + RUN });
  await pickBox(meR, "inbox");
  v = await waitFor(async () => { const x = await view(meR, conv.id); return x.done === false && x.row ? x : null; }, 10000);
  const v3 = await waitFor(async () => { const x = await view(R2, conv.id); return x.done === false ? x : null; }, 10000);
  const s2 = await srvRow(meR, conv.id);
  rec(`D ${label}: a new message re-opens it on the server, this device and the second — no write`, v && v3 && s2.done === false && s2.unreadCount > 0 && writes(meR.apiLog, mark).length === 0, JSON.stringify({ v, srv: { d: s2.done, u: s2.unreadCount } }));
  rec(`D ${label}: back in the Inbox with its badge`, v && v.badge === true);

  // Move back from the Done filter is one DELETE.
  await openRow(meR, conv.id);
  await meR.page.locator('[data-done-toggle="open"] button').click();
  await sleep(1500);
  await back(meR);
  await pickBox(meR, "done");
  await openRow(meR, conv.id);
  mark = meR.apiLog.length;
  await meR.page.locator('[data-done-toggle="done"] button').click();
  await sleep(1500);
  w = writes(meR.apiLog, mark);
  const s3 = await srvRow(meR, conv.id);
  rec(`D ${label}: "Move back to inbox" is ONE DELETE 200; the server agrees`, w.length === 1 && w[0].m === "DELETE" && w[0].s === 200 && s3.done === false, w.map((x) => x.m + " " + x.s).join(", "));
  await S.ctx.close(); await meR.ctx.close(); await R2.ctx.close();
  return conv.id;
}

console.log("== synthetic server " + BASE);
{
  const dev = await open(BASE, 430, "DOCTURN", "dev");
  const ispn = (await dev.api("GET", "/api/dev/organizations")).json.find((o) => o.code === "ISPN");
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "messaging.done", enabled: true });
  let cid = null;
  for (const width of [375, 390, 430]) cid = await roundTrip(BASE, "ISPN", "er.doc", "chen", PW, width, "@" + width);

  // M. module off.
  const C = await open(BASE, 390, "ISPN", "chen");
  await C.api("PUT", `/api/messaging/conversations/${cid}/done`);
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "messaging.done", enabled: false });
  await reload(C.page);
  await nav(C.page, "messages", 1500);
  const m = await C.page.evaluate((id) => ({ boxes: !!document.querySelector("[data-message-boxes]"), row: !!document.querySelector(`[data-convo-row="${id}"]`) }), cid);
  await openRow(C, cid);
  const toggle = await C.page.evaluate(() => !!document.querySelector("[data-done-toggle]"));
  const srv = await C.api("PUT", `/api/messaging/conversations/${cid}/done`);
  const row = await srvRow(C, cid);
  rec("M messaging.done off: no filter, no toggle, the stored Done thread is back in the list; PUT 404 module_disabled", !m.boxes && m.row && !toggle && srv.status === 404 && srv.json.module === "messaging.done" && row.done === false, JSON.stringify({ m, toggle, status: srv.status, done: row.done }));
  await checkLayout(C.page, "messages with Done off @390", ["main"]);
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "messaging.done", enabled: true });
  await C.ctx.close(); await dev.ctx.close();
}

if (REAL) {
  console.log("== real server " + REAL);
  const dev = await open(REAL, 390, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD);
  const cfg = (await dev.api("GET", "/api/config")).json;
  rec("Q (setup) server is SYNTHETIC_DATA=false", cfg && cfg.syntheticData === false);
  const NEWPW = "Done-Check-2026!";
  const code = "DN" + RUN;
  const o = (await dev.api("POST", "/api/dev/organizations", { name: "Done Check " + RUN, code, timezone: "America/Chicago" })).json;
  for (const u of [
    { role: "er_doctor", username: "dn.er", displayName: "Dr. Dn Er", credential: "MD" },
    { role: "hospitalist", username: "dn.hosp", displayName: "Dr. Dn Hospitalist", credential: "MD", specialty: "Hospital Medicine", shiftType: "day", patientCap: 12 },
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
  const H = await open(REAL, 390, code, "dn.hosp", NEWPW);
  await nav(H.page, "messages", 1500);
  const empty = await H.page.evaluate(() => ({ convos: (window.DT.getState().conversations || []).length, text: (document.querySelector("[data-empty-box]") || {}).textContent || "" }));
  rec("Q: a fresh tenant has no threads (nothing demo) and says so", empty.convos === 0 && /No conversations yet/.test(empty.text), JSON.stringify(empty));
  await H.ctx.close();
  await roundTrip(REAL, code, "dn.er", "dn.hosp", NEWPW, 390, "real @390");
}

await browser.close();
rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
