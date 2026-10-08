/**
 * Realtime / push / sign-out regression check — REAL Chromium, iPhone profile,
 * REAL server. Everything is measured (requests, sockets, storage, geometry):
 *
 *   A  A.CON-SHO-65  a message frame is applied as it arrives: zero GET
 *                    /api/messaging/* requests per incoming message (each thread
 *                    GET is a PHI-access audit row), attachments included;
 *      A.CON-MIN-17  the unread count shows in document.title and on the
 *                    Messages tab, and clears when the thread is read.
 *   B  A.CON-SHO-65  a socket that was down comes back and resyncs ONCE: a
 *                    message sent meanwhile appears; untouched threads are not
 *                    re-read.
 *   C  A.CON-SHO-67  password changed from another session → the server closes
 *                    this socket 1008 "session_revoked" → sign-in with the
 *                    reason, and no reconnect loop.
 *   D  A.CON-SHO-67  server session gone + socket drop → reconnect refused 1008
 *                    → one GET /api/user (401) → sign-in, no loop.
 *   E  A.CON-SHO-62 / A.CON-NEE-1  sign-in and reload never call
 *                    Notification.requestPermission; the Settings "Turn on" tap
 *                    does, inside the user gesture.
 *      A.CON-SHO-63  after sign-out no identity is left in localStorage (also
 *                    after further state changes and a reload) and the server
 *                    session is gone.
 *   F  A.CON-SHO-62 / A.CON-SHO-68  an iPhone Safari tab (no Web Push APIs)
 *                    explains Add to Home Screen instead of "not supported";
 *                    the row fits 375 / 390 / 430 without clipping.
 *   G  A.CON-MIN-14  a developer's sign-in never requests /api/patient-board
 *                    (no 403 in the console).
 *   H  A.CON-MIN-18  one locale-aware clock: dtFmt.hhmm follows the device
 *                    locale (12 h en-US, 24 h en-GB) and matches the On-call
 *                    board's toLocaleTimeString label.
 *
 * Usage (throwaway seeded synthetic server — scenario C provisions a user):
 *   BASE_URL=http://127.0.0.1:5080 node scripts/realtime-e2e.mjs
 * Exits non-zero on any failed check.
 */
import { chromium } from "playwright-core";
import zlib from "node:zlib";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const SIZES = { 375: 667, 390: 844, 430: 932 };

const results = [];
const rec = (name, ok, note = "") => { results.push({ name, ok: !!ok }); console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  ↳ " + note : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- node-side API sessions -------------------------------------------------
async function session(orgCode, username, password = "docturn") {
  const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgCode, username, password }) });
  if (!r.ok) throw new Error(`login ${username}: ${r.status}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await r.json();
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: Object.assign({ cookie }, body ? { "content-type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    const t = await res.text();
    let d = null;
    try { d = t ? JSON.parse(t) : null; } catch { d = t; }
    return { status: res.status, body: d };
  };
  return { me, call };
}
async function directWith(s, otherId) {
  const list = (await s.call("GET", "/api/messaging/conversations")).body || [];
  const c = list.find((x) => x.type === "direct" && x.participantIds.length === 2 && x.participantIds.includes(otherId));
  if (c) return c;
  return (await s.call("POST", "/api/messaging/conversations", { type: "direct", participantIds: [otherId] })).body;
}
const send = (s, conversationId, content, priority = "routine", attachmentIds) =>
  s.call("POST", "/api/messaging/send", Object.assign({ conversationId, content, priority }, attachmentIds ? { attachmentIds } : {}));
function png(w, h) {
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ---- browser helpers --------------------------------------------------------
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
async function phone(width = 390, extra = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA }, extra));
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const log = { reqs: [], sockets: 0, errors: [], responses: [] };
  page.on("request", (r) => { const u = new URL(r.url()); log.reqs.push({ method: r.method(), path: u.pathname }); });
  page.on("response", (r) => { const u = new URL(r.url()); if (r.status() >= 400) log.responses.push(r.status() + " " + u.pathname); });
  page.on("websocket", () => { log.sockets++; });
  page.on("console", (m) => { if (m.type() === "error") log.errors.push(m.text()); });
  page.on("pageerror", (e) => log.errors.push(String(e && e.message)));
  return { ctx, page, log };
}
async function signIn(page, org, user, password = "docturn") {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.DT && window.DT.actions && window.DT.actions.login);
  await page.evaluate(([org, user, password]) => window.DT.actions.login("hospitalist", org, user, password), [org, user, password]);
  await page.waitForFunction((u) => { const s = window.DT.getState(); return !!(s.session && s.session.user === u); }, user, { timeout: 20000 });
  // live conversations (the offline demo seed uses string ids)
  await page.waitForFunction(() => (window.DT.getState().conversations || []).every((c) => typeof c.id === "number"), null, { timeout: 20000 });
  await sleep(800);
}
const msgGets = (log) => log.reqs.filter((r) => r.method === "GET" && r.path.startsWith("/api/messaging/"));
const findMsg = (page, text) => page.evaluate((t) => { for (const c of window.DT.getState().conversations || []) { const m = (c.messages || []).find((x) => x.text === t); if (m) return { convo: c.id, unread: c.unread, attachments: m.attachments, receipt: m.receipt }; } return null; }, text);

const patel = await session("ISPN", "patel");
const tag = Date.now().toString(36);

// ---- A: live frames, no per-event fetch, unread indicators -----------------
{
  const { ctx, page, log } = await phone(390);
  await signIn(page, "ISPN", "chen");
  const chenId = await page.evaluate(() => window.DT.getState().me.id);
  const convo = await directWith(patel, chenId);
  await send(patel, convo.id, "rt-A first " + tag);
  await page.waitForFunction((t) => (window.DT.getState().conversations || []).some((c) => (c.messages || []).some((m) => m.text === t)), "rt-A first " + tag);
  await sleep(600);
  log.reqs.length = 0;
  const up = await patel.call("POST", "/api/messaging/attachments", { fileName: "ecg.png", mimeType: "image/png", dataBase64: png(8, 8).toString("base64") });
  await send(patel, convo.id, "rt-A stat " + tag, "stat", [up.body.id]);
  await page.waitForFunction((t) => (window.DT.getState().conversations || []).some((c) => (c.messages || []).some((m) => m.text === t)), "rt-A stat " + tag);
  await sleep(1200); // past every debounce
  const fetched = msgGets(log);
  rec("A SHO-65: an incoming STAT with an image costs ZERO GET /api/messaging/* requests", fetched.length === 0, fetched.map((r) => r.path).join(", ") || "none");
  const m = await findMsg(page, "rt-A stat " + tag);
  rec("A SHO-65: the frame's attachment metadata is rendered data (id + url, no bytes)", m && m.attachments.length === 1 && m.attachments[0].id === up.body.id && /\/api\/messaging\/attachments\/\d+$/.test(m.attachments[0].url), JSON.stringify(m && m.attachments));
  const unread = await page.evaluate(() => window.DT.unreadMessages());
  const title = await page.title();
  rec("A MIN-17: document.title carries the unread count", unread >= 2 && title === "(" + unread + ") DocTurn", `title="${title}" unread=${unread}`);
  const dot = await page.evaluate(() => { const b = [...document.querySelectorAll('nav[aria-label="Primary"] button')].find((x) => /Messages/.test(x.textContent || "")); const s = b && [...b.querySelectorAll("span")].find((x) => getComputedStyle(x).backgroundColor !== "rgba(0, 0, 0, 0)" && x.getBoundingClientRect().width <= 12); return !!s; });
  rec("A MIN-17: the Messages tab shows the unread dot", dot);
  // Read it: open Messages → the thread; its count leaves the title.
  const threadUnread = await page.evaluate((id) => (window.DT.getState().conversations.find((c) => c.id === id) || {}).unread, convo.id);
  await page.evaluate(() => { window.DT.actions.setNav("messages"); });
  await sleep(500);
  await page.locator("button", { hasText: patel.me.displayName }).first().click();
  await page.waitForFunction((id) => (window.DT.getState().conversations.find((c) => c.id === id) || {}).unread === 0, convo.id, { timeout: 8000 }).catch(() => {});
  await sleep(300);
  const left = await page.evaluate(() => window.DT.unreadMessages());
  const t2 = await page.title();
  rec("A MIN-17: reading the thread takes its count out of the title (cleared when nothing else is unread)", left === unread - threadUnread && t2 === (left > 0 ? "(" + left + ") DocTurn" : "DocTurn"), `title="${t2}" (was ${unread}, thread ${threadUnread})`);
  rec("A: no page errors", log.errors.filter((e) => !/Failed to load resource/.test(e)).length === 0, log.errors.join(" | "));
  await ctx.close();
}

// ---- B: socket down → message sent meanwhile → reconnect resync -------------
{
  const { ctx, page, log } = await phone(390);
  let n = 0; let first = null; let release; const held = new Promise((r) => { release = r; });
  await page.routeWebSocket(/\/ws(\?|$)/, async (ws) => {
    n++;
    if (n === 1) { first = ws; ws.connectToServer(); return; }
    if (n === 2) { await held; }
    ws.connectToServer();
  });
  await signIn(page, "ISPN", "chen");
  const chenId = await page.evaluate(() => window.DT.getState().me.id);
  const convo = await directWith(patel, chenId);
  const others = await page.evaluate(() => (window.DT.getState().conversations || []).length);
  first.close({ code: 4001, reason: "network drop (test)" });
  await sleep(1500); // the client has retried; the route holds the new socket
  await send(patel, convo.id, "rt-B while offline " + tag);
  await sleep(500);
  const before = await findMsg(page, "rt-B while offline " + tag);
  log.reqs.length = 0;
  release();
  await page.waitForFunction((t) => (window.DT.getState().conversations || []).some((c) => (c.messages || []).some((m) => m.text === t)), "rt-B while offline " + tag, { timeout: 10000 }).catch(() => {});
  await sleep(800);
  const after = await findMsg(page, "rt-B while offline " + tag);
  rec("B SHO-65: a message sent while the socket was down appears after the reconnect", !before && !!after, `before=${!!before} after=${!!after}`);
  const g = msgGets(log);
  const lists = g.filter((r) => r.path === "/api/messaging/conversations").length;
  const threads = g.filter((r) => /\/messages$/.test(r.path)).map((r) => r.path);
  rec("B SHO-65: the resync is ONE list request + only the changed thread(s)", lists === 1 && threads.includes("/api/messaging/conversations/" + convo.id + "/messages") && threads.length <= Math.max(1, others), `list=${lists} threads=${threads.join(",")} (of ${others} conversations)`);
  rec("B: exactly one reconnect", n === 2, `sockets=${n}`);
  await ctx.close();
}

// ---- C: password changed elsewhere → 1008 session_revoked → sign-in ---------
{
  const director = await session("ISPN", "director");
  const uname = "rt.revoke." + tag;
  const made = await director.call("POST", "/api/director/hospitalists", { username: uname, displayName: "RT Revoke " + tag, role: "hospitalist", specialty: "Hospital Medicine", patientCap: 12, shiftType: "day" });
  const temp = made.body && made.body.temporaryPassword;
  const P1 = "Rt-first-" + tag + "!", P2 = "Rt-second-" + tag + "!";
  const changer = await session("ISPN", uname, temp);
  const ch1 = await changer.call("PATCH", "/api/account/password", { currentPassword: temp, newPassword: P1 });
  const { ctx, page, log } = await phone(390);
  await signIn(page, "ISPN", uname, P1);
  await sleep(500);
  const socketsBefore = log.sockets;
  log.reqs.length = 0;
  const ch2 = await changer.call("PATCH", "/api/account/password", { currentPassword: P1, newPassword: P2 });
  await page.waitForFunction(() => !window.DT.getState().session, null, { timeout: 8000 }).catch(() => {});
  const st = await page.evaluate(() => ({ session: window.DT.getState().session, err: window.DT.getState().loginError }));
  rec("C SHO-67: a password change elsewhere closes this socket 1008 and returns to sign-in with the reason", ch1.status < 300 && ch2.status < 300 && !st.session && /password was changed or reset/i.test(st.err || ""), `change=${ch1.status}/${ch2.status} err=${st.err}`);
  rec("C SHO-67: the sign-in screen is shown", await page.locator("text=Sign in").first().isVisible().catch(() => false));
  await sleep(5000);
  rec("C SHO-67: no reconnect attempts afterwards (5 s)", log.sockets === socketsBefore, `sockets ${socketsBefore} → ${log.sockets}`);
  await ctx.close();
}

// ---- D: server session gone + drop → 1008 unauthorized → probe → sign-in ----
{
  const { ctx, page, log } = await phone(390);
  let n = 0; let first = null;
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => { n++; if (n === 1) first = ws; ws.connectToServer(); });
  await signIn(page, "ISPN", "wu");
  await page.evaluate(() => fetch("/api/logout", { method: "POST", credentials: "include" })); // the server session ends (e.g. idle expiry)
  log.reqs.length = 0;
  first.close({ code: 4002, reason: "network drop (test)" });
  await page.waitForFunction(() => !window.DT.getState().session, null, { timeout: 8000 }).catch(() => {});
  const st = await page.evaluate(() => ({ session: window.DT.getState().session, err: window.DT.getState().loginError }));
  const probes = log.reqs.filter((r) => r.path === "/api/user").length;
  rec("D SHO-67: refused reconnect → GET /api/user → 401 → sign-in ('session expired')", !st.session && /session expired/i.test(st.err || "") && probes === 1, `err=${st.err} probes=${probes}`);
  const s0 = n;
  await sleep(5000);
  rec("D SHO-67: no reconnect loop afterwards (5 s)", n === s0, `sockets ${s0} → ${n}`);
  await ctx.close();
}

// ---- E: no automatic permission prompt; Settings tap asks; sign-out hygiene --
{
  const { ctx, page, log } = await phone(390);
  await ctx.addInitScript(() => {
    if (typeof Notification === "undefined") return;
    const orig = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = function (cb) {
      const n = Number(sessionStorage.getItem("__prompts") || 0) + 1;
      sessionStorage.setItem("__prompts", String(n));
      sessionStorage.setItem("__promptGesture", String(!!(navigator.userActivation && navigator.userActivation.isActive)));
      return orig(cb);
    };
  });
  await signIn(page, "ISPN", "lopez");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !!(window.DT && window.DT.getState().session), null, { timeout: 15000 });
  await sleep(1200);
  const prompts0 = await page.evaluate(() => Number(sessionStorage.getItem("__prompts") || 0));
  rec("E SHO-62/NEE-1: sign-in and reload never call Notification.requestPermission", prompts0 === 0, `calls=${prompts0}`);
  await page.evaluate(() => window.DT.actions.setNav("account"));
  await sleep(500);
  const row = page.locator("[data-push-row]");
  const rowState = await row.getAttribute("data-push-row");
  await row.locator("button", { hasText: "Turn on" }).click();
  await sleep(800);
  const p1 = await page.evaluate(() => ({ n: Number(sessionStorage.getItem("__prompts") || 0), gesture: sessionStorage.getItem("__promptGesture") }));
  rec("E SHO-62: the Settings 'Turn on' tap asks — inside the user gesture", rowState === "default" && p1.n === 1 && p1.gesture === "true", `row=${rowState} calls=${p1.n} gesture=${p1.gesture}`);
  // Sign out from Settings.
  log.reqs.length = 0;
  await page.locator("text=Sign out").first().click();
  await page.waitForFunction(() => !window.DT.getState().session, null, { timeout: 8000 });
  await sleep(1500);
  await page.evaluate(() => window.DT.set((s) => { s.loginError = "probe"; return s; })); // a later state change
  await sleep(600);
  const dump = await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
  const blob = JSON.stringify(dump);
  const lopez = await session("ISPN", "lopez");
  const leaked = [lopez.me.displayName, '"user":"lopez"', '"username":"lopez"', '"id":' + lopez.me.id + ","].filter((x) => blob.includes(x));
  rec("E SHO-63: after sign-out localStorage holds no identity (name / username / user id), even after later state changes", leaked.length === 0 && !/"me"\s*:/.test(blob), leaked.join(", ") || Object.keys(dump).join(","));
  rec("E SHO-68: sign-out ends the server session (POST /api/logout)", log.reqs.some((r) => r.method === "POST" && r.path === "/api/logout") && (await page.evaluate(() => fetch("/api/user", { credentials: "include" }).then((r) => r.status))) === 401);
  await page.reload({ waitUntil: "networkidle" });
  await sleep(800);
  const afterReload = await page.evaluate(() => ({ session: window.DT.getState().session, me: window.DT.getState().me }));
  rec("E SHO-63: a reload after sign-out restores no identity", !afterReload.session && afterReload.me.id === undefined && afterReload.me.name !== lopez.me.displayName, JSON.stringify(afterReload.me));
  await ctx.close();
}

// ---- F: iPhone Safari tab (no Web Push APIs) → Add to Home Screen wording ----
for (const w of [375, 390, 430]) {
  const { ctx, page } = await phone(w);
  await ctx.addInitScript(() => { try { delete window.Notification; delete window.PushManager; } catch (e) {} });
  await signIn(page, "ISPN", "liu");
  await page.evaluate(() => window.DT.actions.setNav("account"));
  await sleep(600);
  const m = await page.evaluate(() => {
    const row = document.querySelector("[data-push-row]");
    const sub = row && row.querySelector("[data-settings-sub]");
    const r = row && row.getBoundingClientRect();
    return { state: row && row.getAttribute("data-push-row"), text: sub ? sub.textContent : "", clipped: sub ? sub.scrollWidth > sub.clientWidth + 1 : true, left: r && r.left, right: r && r.right, vw: innerWidth, docW: document.documentElement.scrollWidth, button: !!(row && row.querySelector("button")), ws: sub ? getComputedStyle(sub).whiteSpace : "" };
  });
  rec(`F@${w} SHO-62/68: Safari tab explains Add to Home Screen (no 'not supported', no Turn on)`, m.state === "ios-home-screen" && /Add to Home Screen/.test(m.text) && !/Not supported/.test(m.text) && !m.button, `state=${m.state} "${m.text.slice(0, 60)}…"`);
  rec(`F@${w}: the row fits — wrapped, not clipped, no horizontal page scroll`, !m.clipped && m.ws !== "nowrap" && m.left >= 0 && m.right <= m.vw + 0.5 && m.docW <= m.vw, `row ${Math.round(m.left)}..${Math.round(m.right)} of ${m.vw}, doc ${m.docW}`);
  await ctx.close();
}

// ---- G: developer sign-in requests no role-gated board ------------------------
{
  const { ctx, page, log } = await phone(390);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => window.DT.actions.login("developer", "DOCTURN", "dev", "docturn"));
  await page.waitForFunction(() => { const s = window.DT.getState(); return !!(s.session && s.session.role === "developer"); }, null, { timeout: 20000 });
  await sleep(2500);
  const asked = log.reqs.filter((r) => r.path.startsWith("/api/patient-board")).length;
  const forb = log.responses.filter((r) => r.startsWith("403"));
  rec("G MIN-14: developer hydrate never requests /api/patient-board, and no 403 is logged", asked === 0 && forb.length === 0, `board requests=${asked} 403s=${forb.join(",") || "none"}`);
  await ctx.close();
}

// ---- H: one locale-aware clock ----------------------------------------------
for (const [locale, re] of [["en-US", /^\d{1,2}:\d{2}\s?[AP]M$/], ["en-GB", /^\d{2}:\d{2}$/]]) {
  const { ctx, page } = await phone(390, { locale });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.dtFmt && window.dtFmt.hhmm);
  const r = await page.evaluate(() => { const t = new Date(2026, 9, 8, 15, 4).getTime(); return { hhmm: window.dtFmt.hhmm(t), board: new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), stamp: window.dtFmt.stamp(Date.now()) }; });
  rec(`H MIN-18 ${locale}: dtFmt.hhmm follows the device locale and equals the On-call "as of" label`, re.test(r.hhmm.replace(/ /g, " ")) && r.hhmm === r.board, `hhmm="${r.hhmm}" board="${r.board}" stamp="${r.stamp}"`);
  await ctx.close();
}

// ---- I: service worker push → notification → Messages ------------------------
{
  const { ctx, page } = await phone(390);
  await ctx.grantPermissions(["notifications"], { origin: BASE });
  await signIn(page, "ISPN", "patel");
  const reg = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => ({ scope: r.scope, active: !!r.active })));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("ServiceWorker.enable");
  const regId = await new Promise((resolve) => {
    cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => { const r = (e.registrations || []).find((x) => x.scopeURL.startsWith(BASE)); if (r) resolve(r.registrationId); });
    setTimeout(() => resolve(null), 3000);
  });
  if (regId) await cdp.send("ServiceWorker.deliverPushMessage", { origin: BASE, registrationId: regId, data: JSON.stringify({ title: "STAT secure message" }) });
  await sleep(800);
  const notes = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.getNotifications()).then((ns) => ns.map((n) => ({ title: n.title, body: n.body, data: n.data }))));
  rec("I MIN-17: a content-free push shows a generic notification tagged for Messages", reg.active && notes.length >= 1 && notes[0].title === "STAT secure message" && notes[0].body === "Open DocTurn to view." && notes[0].data && notes[0].data.nav === "messages", JSON.stringify(notes));
  // The SW's notificationclick posts {type:"docturn:open"} to the open window.
  await page.evaluate(() => window.DT.actions.setNav("dashboard"));
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "docturn:open", nav: "messages" } })));
  await sleep(200);
  rec("I: a tapped message notification brings the open app to Messages", (await page.evaluate(() => window.DT.getState().ui.nav)) === "messages");
  // ...or opens the app at /?open=messages when nothing was open.
  await page.evaluate(() => window.DT.actions.setNav("dashboard"));
  await page.goto(BASE + "/?open=messages", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.DT && window.DT.getState().ui.nav === "messages", null, { timeout: 10000 }).catch(() => {});
  const after = await page.evaluate(() => ({ nav: window.DT.getState().ui.nav, url: location.pathname + location.search }));
  rec("I: a cold start from a notification lands on Messages and the URL is cleaned", after.nav === "messages" && after.url === "/", JSON.stringify(after));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed, ${results.length} total`);
process.exit(failed ? 1 : 0);
