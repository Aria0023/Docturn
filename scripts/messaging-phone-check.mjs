/**
 * Messaging-on-a-phone regression check (real Chromium, iPhone profile).
 *
 * Drives the REAL web app against a seeded synthetic server and MEASURES the
 * secure-messaging screen — nothing is eyeballed:
 *
 *   layout   (A.CON-SHO-41, A.NEE-SHO-1, A.CON-SHO-61, A.CON-MIN-8)
 *     • the thread pane never exceeds the viewport (main/document scrollWidth),
 *     • Send, Templates, the priority chips and the details button are fully
 *       on-screen at 375 / 390 / 430,
 *     • every Forward control and the STAT Acknowledge button are real
 *       >= 44 x 44 px targets and never overlap each other;
 *   scroll   (A.CON-SHO-47, A.CON-SHO-66)
 *     • a thread opens at the NEWEST message: first open of the already-active
 *       thread, Back -> re-open, a late-loading image at the bottom, and a
 *       desktop switch between two threads with the same message count;
 *   receipts (A.CON-SHO-26)
 *     • a fresh 1:1 message shows "Delivered" (never a hard-coded "Read"), turns
 *       "Read" live when the recipient reads it, a failed/offline send shows
 *       "Not sent", keeps the text (Edit puts it back in the composer) and
 *       Retry delivers it;
 *   modules  (A.CON-SHO-40)
 *     • with messaging.attachments / messaging.priority off the paperclip, mic
 *       and STAT/Urgent chips are gone; a STAT the server refuses because the
 *       switch went off is shown as not sent with "Send as routine", and the
 *       refusal makes the client re-read its module map (the chips go away
 *       without a reload);
 *     • a stale paperclip upload refused because messaging.attachments went off
 *       names the switched-off feature (not just "Upload failed <name>") and
 *       the paperclip disappears;
 *     • with messaging.patientThreads off the board offers no "Message team"
 *       (phone card + desktop row); a stale tap says patient threads are
 *       switched off and the control disappears; with it on, "Message team"
 *       opens the thread itself on a phone (not the conversation list);
 *   recall   (A.CON-SHO-25)
 *     • MESSAGE_RECALLED removes the message from the recipient's open thread
 *       live; the sender's Recall control removes an unread message;
 *   broadcast toast (A.CON-SHO-2)
 *     • the arrival toast never sits over the banner's Acknowledge button and
 *       a tap on Acknowledge right after arrival reaches the server;
 *   attachments (A.NEE-NEE-1, A.NEE-NEE-2)
 *     • image / PDF / text open in an in-app viewer built from an authenticated
 *       fetch (blob: URL) — no window.open, no new page; Download hands over a
 *       file; a 401 lands on the sign-in screen, never on raw JSON;
 *   voice    (A.NEE-NEE-3)
 *     • a voice note the device cannot decode shows a "can't play" state with a
 *       Download control instead of a dead player; the recorder prefers AAC in
 *       MP4 when MediaRecorder supports it (uploads audio/mp4 + .m4a) and
 *       otherwise records WebM;
 *   CSP      — zero Content-Security-Policy violations across the whole run.
 *
 * Usage: start a seeded synthetic server with RATE_LIMIT=off, then
 *   BASE_URL=http://127.0.0.1:5070 node scripts/messaging-phone-check.mjs
 * WIDTHS=390 limits the phone widths. Exits non-zero on any failed check.
 */
import { chromium } from "playwright-core";
import zlib from "node:zlib";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ALL = { 375: 667, 390: 844, 430: 932 };
const WIDTHS = (process.env.WIDTHS || "375,390,430").split(",").map((w) => Number(w.trim())).filter((w) => ALL[w]);
const TAP = 44;

const results = [];
let cur = "";
const rec = (name, ok, note = "") => {
  results.push({ name: cur + name, ok: !!ok });
  console.log((ok ? "PASS  " : "FAIL  ") + cur + name + (note ? "  ↳ " + note : ""));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (n) => Math.round(n * 10) / 10;
const rs = (r) => (r ? `${r1(r.width)}x${r1(r.height)} @${r1(r.left)},${r1(r.top)}` : "none");

// ---- node-side API sessions (fixtures) ------------------------------------
async function session(orgCode, username) {
  const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgCode, username, password: "docturn" }) });
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
const upload = (s, fileName, mimeType, buf, durationMs) =>
  s.call("POST", "/api/messaging/attachments", Object.assign({ fileName, mimeType, dataBase64: Buffer.from(buf).toString("base64") }, durationMs ? { durationMs } : {}));

// A real 640x480 PNG (solid blue) so the thumbnail grows the thread when it loads.
function png(w, h) {
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { row[1 + x * 3] = 37; row[2 + x * 3] = 99; row[3 + x * 3] = 235; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

// ---- in-page measurement helpers ------------------------------------------
const HELPERS = `
  window.__mm = (() => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const clipped = (el) => {
      const r = el.getBoundingClientRect(); let b = { left: r.left, right: r.right };
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(hidden|auto|scroll|clip)/.test(cs.overflowX + cs.overflow)) { const pr = p.getBoundingClientRect(); b = { left: Math.max(b.left, pr.left), right: Math.min(b.right, pr.right) }; }
      }
      return Math.abs(b.left - r.left) > 0.5 || Math.abs(b.right - r.right) > 0.5;
    };
    const fully = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= -0.5 && r.right <= innerWidth + 0.5 && !clipped(el); };
    const thread = () => document.querySelector("[data-thread-scroll]") || [...document.querySelectorAll("div")].find((d) => getComputedStyle(d).overflowY === "auto" && d.firstElementChild && /Encrypted in transit/.test(d.firstElementChild.textContent || ""));
    const atBottom = () => { const t = thread(); if (!t) return { ok: false, why: "no thread" }; return { ok: t.scrollTop + t.clientHeight >= t.scrollHeight - 4, top: Math.round(t.scrollTop), client: t.clientHeight, height: t.scrollHeight }; };
    const btn = (re, root) => [...(root || document).querySelectorAll("button")].filter((b) => re.test((b.textContent || "").trim()) && b.offsetParent !== null);
    const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    return { rect, fully, thread, atBottom, btn, overlap };
  })();
`;
async function prep(page) { await page.evaluate(HELPERS); }

async function newPhone(browser, width, extra = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width, height: ALL[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA, permissions: ["microphone"] }, extra));
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  watch(page);
  return { ctx, page };
}
const cspViolations = [];
const pageErrors = [];
function watch(page) {
  page.on("console", (m) => { const t = m.text(); if (/Content.Security.Policy|Refused to|violates the following/i.test(t)) cspViolations.push(t); });
  page.on("pageerror", (e) => pageErrors.push(String((e && e.message) || e)));
}
async function uiLogin(page, role, org, user) {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.DT && window.DT.actions && window.DT.actions.login);
  await page.evaluate(([role, org, user]) => window.DT.actions.login(role, org, user, "docturn"), [role, org, user]);
  await page.waitForFunction((r) => { const s = window.DT.getState(); return !!(s.session && s.session.role === r); }, role, { timeout: 20000 });
  await sleep(900);
}
async function openMessages(page) {
  await page.evaluate(() => window.DT.actions.setNav("messages"));
  await page.waitForFunction(() => (window.DT.getState().conversations || []).length > 0, null, { timeout: 15000 });
  await sleep(500);
  await prep(page);
}
// Tap a thread row in the phone list by the other party's display name.
async function tapThread(page, name) {
  const row = page.locator("button", { hasText: name }).first();
  await row.click();
  await sleep(700);
  await prep(page);
}
async function tapBack(page) {
  await page.locator('button[title="Back"]').first().click();
  await sleep(500);
}

// ---------------------------------------------------------------------------
const chen = await session("ISPN", "chen");
const patel = await session("ISPN", "patel");
const lopez = await session("ISPN", "lopez");
const director = await session("ISPN", "director");
const dev = await session("DOCTURN", "dev");
const orgId = chen.me.organizationId;
const CHEN = chen.me.displayName, PATEL = patel.me.displayName, LOPEZ = lopez.me.displayName;
const setModule = (id, enabled) => dev.call("PATCH", "/api/dev/modules/" + orgId, { id, enabled });
for (const m of ["messaging.attachments", "messaging.voice", "messaging.priority", "messaging.recall", "messaging.forwarding", "messaging.templates", "messaging.patientThreads", "broadcasts"]) await setModule(m, true);

// Fixtures: two direct threads with chen (patel, lopez), long enough to scroll;
// patel's ends with a STAT (unacked), a PDF, a text note, an undecodable
// "voice note", and — newest — a 640x480 image.
const pConv = await directWith(patel, chen.me.id);
const lConv = await directWith(lopez, chen.me.id);
const count = async (s, id) => ((await s.call("GET", `/api/messaging/conversations/${id}/messages`)).body || []).length;
for (let n = await count(patel, pConv.id); n < 24; n++) await send(patel, pConv.id, `Layout check ${n} — synthetic, no PHI. The quick brown fox jumps over the lazy dog.`);
await send(patel, pConv.id, "STAT layout probe — please acknowledge", "stat");
const pdf = await upload(patel, "discharge-summary-synthetic.pdf", "application/pdf", PDF);
await send(patel, pConv.id, "", "routine", [pdf.body.id]);
const txt = await upload(patel, "handoff-note.txt", "text/plain", Buffer.from("Synthetic hand-off note: no PHI. Line two."));
await send(patel, pConv.id, "", "routine", [txt.body.id]);
const bad = await upload(patel, "voice-garbage.wav", "audio/wav", Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) & 0xff)), 2000);
await send(patel, pConv.id, "", "routine", [bad.body.id]);
const img = await upload(patel, "wound-photo-synthetic.png", "image/png", png(640, 480));
await send(patel, pConv.id, "", "routine", [img.body.id]);

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });

// ---- A + B: layout and open-at-newest on each iPhone width ----------------
for (const width of WIDTHS) {
  cur = `${width}x${ALL[width]} `;
  const { ctx, page } = await newPhone(browser, width);
  // Images arrive late (slow network) so a pin taken before they load is stale.
  await page.route("**/api/messaging/attachments/*", async (route) => { await sleep(900); await route.continue(); });
  await uiLogin(page, "hospitalist", "ISPN", "chen");
  await openMessages(page);
  // The newest thread (patel's) is the default `active` one — the case that
  // used to open at the oldest message.
  const isActive = await page.evaluate((id) => (window.DT.getState().__activeConvo || (window.DT.getState().conversations[0] || {}).id) === id, pConv.id);
  await tapThread(page, PATEL);
  let b = await page.evaluate(() => window.__mm.atBottom());
  rec(`first open of the ${isActive ? "already-active " : ""}thread starts at the newest message`, b.ok, JSON.stringify(b));
  await sleep(1600); // the delayed image lands and grows the thread
  b = await page.evaluate(() => window.__mm.atBottom());
  rec("still at the newest message after the late image loads", b.ok, JSON.stringify(b));
  await tapBack(page);
  await tapThread(page, PATEL);
  b = await page.evaluate(() => window.__mm.atBottom());
  rec("Back -> re-open starts at the newest message", b.ok, JSON.stringify(b));

  const o = await page.evaluate(() => { const m = document.querySelector("main"); return { vw: innerWidth, main: m.scrollWidth, doc: document.documentElement.scrollWidth }; });
  rec("no horizontal overflow (main / document)", o.main <= o.vw && o.doc <= o.vw, JSON.stringify(o));
  const lay = await page.evaluate(() => {
    const M = window.__mm;
    const send = document.querySelector('button[title="Send"]');
    const tpl = document.querySelector("button[data-templates]");
    const info = document.querySelector("[data-thread-details] button") || [...document.querySelectorAll("button")].filter((x) => x.offsetParent && x.getBoundingClientRect().top < 140).pop();
    const chips = M.btn(/^(Routine|Urgent|STAT)$/);
    const fw = [...document.querySelectorAll("button[data-forward]")].filter((x) => x.offsetParent);
    const ack = M.btn(/Acknowledge$/).filter((x) => !x.hasAttribute("data-broadcast-ack"));
    const back = document.querySelector('button[title="Back"]');
    return {
      send: { r: M.rect(send), full: M.fully(send) }, tpl: { r: M.rect(tpl), full: M.fully(tpl) }, info: { r: M.rect(info), full: M.fully(info) },
      chips: chips.map((c) => ({ t: c.textContent, full: M.fully(c), h: c.getBoundingClientRect().height })),
      fw: fw.map((x) => ({ r: M.rect(x), full: M.fully(x) })),
      ack: ack.map((x) => M.rect(x)),
      back: M.rect(back),
      overlapAckFw: ack.some((a) => fw.some((f) => M.overlap(a.getBoundingClientRect(), f.getBoundingClientRect()))),
    };
  });
  rec("Send fully visible and >= 44x44", lay.send.full && lay.send.r.width >= TAP && lay.send.r.height >= TAP, rs(lay.send.r));
  rec("Templates fully visible", lay.tpl.full, rs(lay.tpl.r));
  rec("thread details button fully visible", lay.info.full, rs(lay.info.r));
  rec("priority chips fully visible and >= 44 tall", lay.chips.length === 3 && lay.chips.every((c) => c.full && c.h >= TAP), JSON.stringify(lay.chips));
  rec("Back arrow >= 44x44", lay.back && lay.back.width >= TAP && lay.back.height >= TAP, rs(lay.back));
  rec("every Forward control is >= 44x44 and on-screen", lay.fw.length > 0 && lay.fw.every((f) => f.full && f.r.width >= TAP && f.r.height >= TAP), `${lay.fw.length} controls, smallest ${rs(lay.fw.slice().sort((a, c) => a.r.height - c.r.height)[0]?.r)}`);
  rec("STAT Acknowledge >= 44 tall", lay.ack.length > 0 && lay.ack.every((a) => a.height >= TAP), lay.ack.map(rs).join(" "));
  rec("Acknowledge and Forward never overlap", !lay.overlapAckFw);
  const row = await page.evaluate(() => { const r = document.querySelector("[data-priority-row]"); const kids = r ? [...r.querySelectorAll("button")] : []; return { tops: [...new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top)))], h: r ? Math.round(r.getBoundingClientRect().height) : 0 }; });
  rec("priority chips + Templates share one row (no wasted thread height)", row.tops.length === 1, JSON.stringify(row));
  // Software keyboard (emulated as a shorter viewport while the composer has
  // focus): the newest message and Send stay on screen.
  await page.locator('input[aria-label="Message"]').focus();
  await page.setViewportSize({ width, height: ALL[width] - 290 });
  // Let the (deliberately slow) thumbnails finish: their load handler re-pins.
  await page.waitForFunction(() => [...document.querySelectorAll("[data-thread-scroll] img")].every((i) => i.complete), null, { timeout: 8000 }).catch(() => {});
  await sleep(700);
  const kb = await page.evaluate(() => { const s = document.querySelector('button[title="Send"]').getBoundingClientRect(); return { bottom: window.__mm.atBottom(), sendBottom: Math.round(s.bottom), sendRight: Math.round(s.right), vh: innerHeight, vw: innerWidth }; });
  rec("keyboard-height viewport: still at the newest message, Send on screen", kb.bottom.ok && kb.sendBottom <= kb.vh && kb.sendRight <= kb.vw, JSON.stringify(kb));
  await page.setViewportSize({ width, height: ALL[width] });
  await ctx.close();
}

// ---- B (desktop): switching between two equal-length threads ----------------
cur = "desktop 1280x800 ";
{
  // Equalise the two threads' lengths right before switching.
  let pc = await count(chen, pConv.id), lc = await count(chen, lConv.id);
  for (; lc < pc; lc++) await send(lopez, lConv.id, `Equal-length filler ${lc} — synthetic.`);
  for (; pc < lc; pc++) await send(patel, pConv.id, `Equal-length filler ${pc} — synthetic.`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(10000); watch(page);
  await uiLogin(page, "hospitalist", "ISPN", "chen");
  await openMessages(page);
  await page.locator("button", { hasText: PATEL }).first().click(); await sleep(700); await prep(page);
  await page.locator("button", { hasText: LOPEZ }).first().click(); await sleep(700); await prep(page);
  let b = await page.evaluate(() => window.__mm.atBottom());
  rec(`switch to an equal-length thread (${pc} = ${lc} messages) starts at the newest`, pc === lc && b.ok, JSON.stringify(b));
  await page.evaluate(() => { const t = window.__mm.thread(); t.scrollTop = 0; });
  await page.locator("button", { hasText: PATEL }).first().click(); await sleep(700); await prep(page);
  b = await page.evaluate(() => window.__mm.atBottom());
  rec("switch back after scrolling up starts at the newest", b.ok, JSON.stringify(b));
  await ctx.close();
}

// ---- C..J on the 390 iPhone ---------------------------------------------
cur = "390x844 ";
const { ctx: pctx, page } = await newPhone(browser, 390);
const popups = [];
pctx.on("page", (p) => popups.push(p.url()));
await uiLogin(page, "hospitalist", "ISPN", "chen");
await openMessages(page);
await tapThread(page, PATEL);
const composer = page.locator('input[aria-label="Message"]');
const typeAndSend = async (text) => { await composer.fill(text); await page.locator('button[title="Send"]').click(); };
const bubble = (text) => page.locator("[data-message]", { hasText: text });
const receiptOf = (text) => page.evaluate((t) => { const el = [...document.querySelectorAll("[data-message]")].find((m) => (m.textContent || "").includes(t)); if (!el) return null; const r = el.querySelector("[data-receipt]"); return r ? r.getAttribute("data-receipt") : "none"; }, text);

// C. Receipts.
{
  const t = "Receipt probe " + Date.now();
  await typeAndSend(t);
  await page.waitForFunction((t) => [...document.querySelectorAll("[data-message]")].some((m) => (m.textContent || "").includes(t) && m.querySelector('[data-receipt="delivered"]')), t, { timeout: 8000 }).catch(() => {});
  const before = await receiptOf(t);
  rec("a fresh 1:1 message reads Delivered, not Read", before === "delivered", "receipt=" + before);
  const msgs = (await patel.call("GET", `/api/messaging/conversations/${pConv.id}/messages`)).body;
  const mine = msgs.find((m) => m.content === t);
  await patel.call("POST", "/api/messaging/messages/mark-read", { messageIds: [mine.id] });
  const live = await page.waitForFunction((t) => [...document.querySelectorAll("[data-message]")].some((m) => (m.textContent || "").includes(t) && m.querySelector('[data-receipt="read"]')), t, { timeout: 6000 }).then(() => true).catch(() => false);
  rec("receipt turns Read live when the recipient reads it (no reload)", live, "receipt=" + (await receiptOf(t)));
}
// D. Failed / offline send keeps the text and retries.
{
  const t = "Offline probe " + Date.now();
  await page.route("**/api/messaging/send", (route) => route.abort("internetdisconnected"));
  await typeAndSend(t);
  await sleep(800);
  const st = await receiptOf(t);
  rec("an offline send shows Not sent (not Delivered/Read)", st === "failed", "receipt=" + st);
  const retry = bubble(t).locator("button[data-retry]");
  const rr = await retry.boundingBox().catch(() => null);
  rec("Retry is a >= 44px control on the failed message", rr && rr.height >= TAP && rr.width >= TAP, JSON.stringify(rr));
  await page.unroute("**/api/messaging/send");
  await retry.click().catch(() => {});
  const ok = await page.waitForFunction((t) => { const els = [...document.querySelectorAll("[data-message]")].filter((m) => (m.textContent || "").includes(t)); return els.length === 1 && els[0].querySelector('[data-receipt="delivered"], [data-receipt="read"]'); }, t, { timeout: 8000 }).then(() => true).catch(() => false);
  const server = ((await patel.call("GET", `/api/messaging/conversations/${pConv.id}/messages`)).body || []).filter((m) => m.content === t).length;
  rec("Retry delivers it exactly once", ok && server === 1, `on server: ${server}`);
  // Edit returns a failed message's text to the composer (the draft is kept).
  const t2 = "Draft kept " + Date.now();
  await page.route("**/api/messaging/send", (route) => route.abort("internetdisconnected"));
  await typeAndSend(t2);
  await sleep(800);
  await bubble(t2).locator("button[data-edit-failed]").click().catch(() => {});
  await sleep(300);
  const val = await composer.inputValue();
  rec("Edit puts the unsent text back into the composer", val === t2, JSON.stringify(val));
  await page.unroute("**/api/messaging/send");
  await composer.fill("");
}
// E. Module switches hide the composer controls; a refused STAT is not "sent".
{
  // Server switch goes off while this page still believes STAT is available.
  await setModule("messaging.priority", false);
  await page.locator("button", { hasText: /^STAT$/ }).first().click();
  const t = "STAT refused probe " + Date.now();
  await typeAndSend(t);
  await sleep(1200);
  const st = await receiptOf(t);
  const reason = await bubble(t).textContent().catch(() => "");
  rec("a STAT refused by the server (priority switched off) shows Not sent, not Awaiting ack", st === "failed" && !/Awaiting ack/.test(reason), "receipt=" + st);
  rec("…with the reason and a Send as routine action", /switched off/i.test(reason) && (await bubble(t).locator("button[data-send-routine]").count()) === 1, reason.slice(0, 120));
  await bubble(t).locator("button[data-send-routine]").click().catch(() => {});
  const ok = await page.waitForFunction((t) => [...document.querySelectorAll("[data-message]")].some((m) => (m.textContent || "").includes(t) && m.querySelector('[data-receipt="delivered"], [data-receipt="read"]')), t, { timeout: 8000 }).then(() => true).catch(() => false);
  const srv = ((await patel.call("GET", `/api/messaging/conversations/${pConv.id}/messages`)).body || []).find((m) => m.content === t);
  rec("Send as routine delivers it as routine", ok && srv && srv.priority === "routine", srv ? srv.priority : "missing");
  const chipsGone = await page.waitForFunction(() => ![...document.querySelectorAll("button")].some((b) => /^(STAT|Urgent)$/.test((b.textContent || "").trim()) && b.offsetParent !== null), null, { timeout: 6000 }).then(() => true).catch(() => false);
  rec("the refusal refreshes the module map: STAT/Urgent chips disappear without a reload", chipsGone);
  // Attachments switched off while this page still shows the paperclip.
  await page.evaluate(() => window.DT.set((s) => { s.__toast = null; return s; }));
  await setModule("messaging.attachments", false);
  await page.locator('input[type="file"]').setInputFiles({ name: "stale-upload.png", mimeType: "image/png", buffer: png(4, 4) }).catch(() => {});
  const upToast = await page.waitForFunction(() => { const t = document.querySelector("[data-toast]"); return t && /Upload failed/.test(t.textContent || "") ? t.textContent : null; }, null, { timeout: 6000 }).then((h) => h.jsonValue()).catch(() => null);
  rec("a stale upload refused by the switch names it (and the file), not just \"Upload failed\"", /file attachments are switched off/i.test(upToast || "") && /stale-upload\.png/.test(upToast || ""), JSON.stringify(upToast));
  const clipGone = await page.waitForFunction(() => !document.querySelector('button[title="Attach a file"]') && !document.querySelector('input[type="file"]'), null, { timeout: 6000 }).then(() => true).catch(() => false);
  rec("…and the paperclip disappears without a reload", clipGone);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return s && s.session && s.modules && s.modules["messaging.priority"] === false; }, null, { timeout: 15000 }).catch(() => {});
  await openMessages(page);
  await tapThread(page, PATEL);
  const ctl = await page.evaluate(() => ({ clip: !!document.querySelector('button[title="Attach a file"]'), file: !!document.querySelector('input[type="file"]'), mic: !!document.querySelector('button[title="Record a voice message"]'), stat: window.__mm.btn(/^(STAT|Urgent)$/).length }));
  rec("attachments off: no paperclip, file input or mic", !ctl.clip && !ctl.file && !ctl.mic, JSON.stringify(ctl));
  rec("priority off: no STAT/Urgent chips", ctl.stat === 0, JSON.stringify(ctl));
  await setModule("messaging.attachments", true);
  await setModule("messaging.priority", true);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return s && s.session && s.modules && s.modules["messaging.priority"] !== false; }, null, { timeout: 15000 }).catch(() => {});
  await openMessages(page);
  await tapThread(page, PATEL);
}
// F. Recall: live removal in the recipient's open thread + the sender's control.
{
  // The recipient's app is in the background (thread open, not visible) so the
  // message stays unread and recallable — then the sender recalls it.
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  const t = "Recall me " + Date.now();
  const sent = await send(patel, pConv.id, t);
  const shown = await page.waitForFunction((t) => (document.body.textContent || "").includes(t), t, { timeout: 8000 }).then(() => true).catch(() => false);
  const del = await patel.call("DELETE", "/api/messaging/messages/" + sent.body.id);
  const gone = await page.waitForFunction((t) => !(document.body.textContent || "").includes(t), t, { timeout: 6000 }).then(() => true).catch(() => false);
  rec("MESSAGE_RECALLED removes the message from the open thread live", shown && del.status === 204 && gone, `shown=${shown} delete=${del.status}`);
  await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange")); });
  const t2 = "Sender recall " + Date.now();
  await typeAndSend(t2);
  await page.waitForFunction((t) => [...document.querySelectorAll("[data-message]")].some((m) => (m.textContent || "").includes(t) && m.querySelector("button[data-recall]")), t2, { timeout: 8000 }).catch(() => {});
  page.once("dialog", (d) => d.accept());
  const rb = await bubble(t2).locator("button[data-recall]").boundingBox().catch(() => null);
  await bubble(t2).locator("button[data-recall]").click().catch(() => {});
  const gone2 = await page.waitForFunction((t) => !(document.body.textContent || "").includes(t), t2, { timeout: 6000 }).then(() => true).catch(() => false);
  const srv = ((await patel.call("GET", `/api/messaging/conversations/${pConv.id}/messages`)).body || []).some((m) => m.content === t2);
  rec("the sender's Recall (>= 44px) removes an unread message for everyone", rb && rb.height >= TAP && gone2 && !srv, JSON.stringify(rb));
}
// G. Broadcast toast vs. the banner's Acknowledge.
{
  const res = await director.call("POST", "/api/broadcasts", { message: "Synthetic drill — acknowledge " + Date.now(), severity: "urgent" });
  const ack = page.locator(`button[data-broadcast-ack="${res.body.id}"]`);
  await ack.waitFor({ timeout: 8000 }).catch(() => {});
  const m = await page.evaluate((id) => {
    const a = document.querySelector(`button[data-broadcast-ack="${id}"]`);
    const toast = document.querySelector("[data-toast]") || [...document.querySelectorAll('[role="status"]')].find((t) => getComputedStyle(t).position === "fixed" && getComputedStyle(t).zIndex === "50");
    const ar = a && a.getBoundingClientRect();
    const hit = ar ? document.elementFromPoint(ar.left + ar.width / 2, ar.top + ar.height / 2) : null;
    const tr = toast && toast.getBoundingClientRect();
    return { ack: ar && { left: ar.left, right: ar.right, top: ar.top, bottom: ar.bottom, height: ar.height }, toast: tr ? { left: tr.left, right: tr.right, top: tr.top, bottom: tr.bottom, pe: getComputedStyle(toast).pointerEvents } : null, hitIsAck: !!(hit && a && (hit === a || a.contains(hit))) };
  }, res.body.id);
  const overl = m.toast && m.ack && m.toast.left < m.ack.right && m.ack.left < m.toast.right && m.toast.top < m.ack.bottom && m.ack.top < m.toast.bottom;
  rec("no toast sits over the banner's Acknowledge (and toasts never take taps)", m.hitIsAck && !overl && (!m.toast || m.toast.pe === "none"), JSON.stringify(m));
  rec("banner Acknowledge >= 44 tall", m.ack && m.ack.height >= TAP, JSON.stringify(m.ack));
  if (m.ack) await page.mouse.click((m.ack.left + m.ack.right) / 2, (m.ack.top + m.ack.bottom) / 2);
  await sleep(900);
  const mineB = ((await chen.call("GET", "/api/broadcasts")).body || []).find((b) => b.id === res.body.id);
  rec("a tap on Acknowledge right after arrival reaches the server", mineB && mineB.acked === true, JSON.stringify(mineB && { acked: mineB.acked }));
}
// H. Attachments open in-app (fetch -> blob:), never a new browsing context.
{
  await page.locator("[data-attachment-open][data-kind=image]").last().click().catch(async () => { await page.locator('img[alt="wound-photo-synthetic.png"]').last().click().catch(() => {}); });
  await sleep(1500);
  const v = await page.evaluate(() => { const d = document.querySelector("[data-attachment-viewer]"); const i = d && d.querySelector("img"); return { open: !!d, src: i ? i.src.slice(0, 5) : null, loaded: !!(i && i.complete && i.naturalWidth > 0) }; });
  rec("image opens in an in-app viewer from a blob: URL", v.open && v.src === "blob:" && v.loaded, JSON.stringify(v));
  const close = page.locator('[data-attachment-viewer] button[aria-label="Close"]');
  const cb = await close.boundingBox().catch(() => null);
  rec("viewer Close is >= 44x44", cb && cb.width >= TAP && cb.height >= TAP, JSON.stringify(cb));
  await close.click().catch(() => {});
  await sleep(300);
  rec("viewer closes", (await page.locator("[data-attachment-viewer]").count()) === 0);
  await page.locator("[data-attachment-open][data-kind=pdf]").last().click().catch(() => {});
  await sleep(1500);
  const pv = await page.evaluate(() => { const d = document.querySelector("[data-attachment-viewer]"); return { open: !!d, dl: !!(d && d.querySelector("button[data-attachment-download]")), state: d && d.getAttribute("data-state") }; });
  rec("PDF opens in the in-app viewer with a Download control", pv.open && pv.dl && pv.state === "ready", JSON.stringify(pv));
  const dl = page.waitForEvent("download", { timeout: 6000 }).catch(() => null);
  await page.locator("[data-attachment-viewer] button[data-attachment-download]").click().catch(() => {});
  const d = await dl;
  rec("Download hands over the file with its name", d && d.suggestedFilename() === "discharge-summary-synthetic.pdf", d ? d.suggestedFilename() : "no download");
  await page.locator('[data-attachment-viewer] button[aria-label="Close"]').click().catch(() => {});
  await page.locator("[data-attachment-open][data-kind=text]").last().click().catch(() => {});
  await sleep(1200);
  const tv = await page.evaluate(() => { const d = document.querySelector("[data-attachment-viewer]"); const p = d && d.querySelector("pre"); return p ? p.textContent : null; });
  rec("text attachment renders in-app", tv && /Synthetic hand-off note/.test(tv), JSON.stringify(tv));
  await page.locator('[data-attachment-viewer] button[aria-label="Close"]').click().catch(() => {});
  rec("no new page / popup was opened for any attachment", popups.length === 0, popups.join(", "));
}
// I. Voice notes.
{
  await page.evaluate(() => { const els = [...document.querySelectorAll("[data-voice-note] audio")]; const a = els[els.length - 1]; if (a) { a.preload = "auto"; a.load(); a.play().catch(() => {}); } });
  await sleep(2500);
  const st = await page.evaluate(() => { const els = [...document.querySelectorAll("[data-voice-note]")]; const v = els[els.length - 1]; return v ? { state: v.getAttribute("data-state"), text: v.textContent.slice(0, 120), dl: !!v.querySelector("button[data-attachment-download]") } : null; });
  rec("an undecodable voice note shows a can't-play state with Download (not a dead control)", st && st.state === "unplayable" && /can.t play/i.test(st.text) && st.dl, JSON.stringify(st));
}
await pctx.close();

// I (cont). A device that cannot decode WebM (iOS) + an AAC-capable recorder.
{
  const { ctx, page: p2 } = await newPhone(browser, 390);
  await p2.addInitScript(() => {
    const orig = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (t) { return /webm/i.test(t) ? "" : orig.call(this, t); };
    // Safari-like recorder: AAC in MP4 is supported, WebM is not.
    class FakeRecorder {
      static isTypeSupported(t) { return /^audio\/mp4/.test(t); }
      constructor(stream, opts) { this.stream = stream; this.mimeType = (opts && opts.mimeType) || "audio/mp4"; this.state = "inactive"; window.__recMime = this.mimeType; }
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; const b = new Blob([new Uint8Array(2048)], { type: this.mimeType }); this.ondataavailable && this.ondataavailable({ data: b }); this.onstop && this.onstop(); }
    }
    window.MediaRecorder = FakeRecorder;
  });
  await uiLogin(p2, "hospitalist", "ISPN", "chen");
  // A WebM voice note as Chromium records them (the sender's device). Only its
  // declared type matters here: this "device" reports it cannot play WebM.
  const wb = await upload(patel, "voice-chrome.webm", "audio/webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]), 1500);
  await send(patel, pConv.id, "", "routine", [wb.body.id]);
  await openMessages(p2);
  await tapThread(p2, PATEL);
  await sleep(800);
  const st = await p2.evaluate(() => { const els = [...document.querySelectorAll("[data-voice-note]")]; const v = els[els.length - 1]; return v ? { state: v.getAttribute("data-state"), text: v.textContent.slice(0, 140), dl: !!v.querySelector("button[data-attachment-download]"), audio: !!v.querySelector("audio") } : null; });
  rec("a WebM note on a device without WebM shows can't-play up front (no dead <audio>)", st && st.state === "unplayable" && !st.audio && st.dl && /can.t play/i.test(st.text), JSON.stringify(st));
  // Record with the AAC-capable recorder.
  await p2.locator('button[title="Record a voice message"]').click().catch(() => {});
  await sleep(1300);
  await p2.locator('button[title="Stop & attach"]').click().catch(() => {});
  await p2.waitForSelector("text=/Voice message/", { timeout: 8000 }).catch(() => {});
  const recMime = await p2.evaluate(() => window.__recMime || null);
  await p2.locator('button[title="Send"]').click().catch(() => {});
  await sleep(1500);
  const last = ((await patel.call("GET", `/api/messaging/conversations/${pConv.id}/messages`)).body || []).filter((m) => (m.attachments || []).some((a) => a.isAudio)).pop();
  const att = last && last.attachments.find((a) => a.isAudio);
  rec("recorder prefers AAC-in-MP4 when supported (audio/mp4 + .m4a uploaded)", /mp4a/.test(recMime || "") && att && att.mimeType === "audio/mp4" && /\.m4a$/.test(att.fileName), `recorder=${recMime} stored=${att && att.mimeType} ${att && att.fileName}`);
  await ctx.close();
}
// J. Session gone: an attachment tap lands on sign-in, never raw JSON.
{
  const { ctx, page: p3 } = await newPhone(browser, 390);
  const pops = []; ctx.on("page", (p) => pops.push(p.url()));
  await uiLogin(p3, "hospitalist", "ISPN", "chen");
  await openMessages(p3);
  await tapThread(p3, PATEL);
  await ctx.clearCookies();
  await p3.locator("[data-attachment-open][data-kind=pdf]").last().click().catch(() => {});
  await sleep(1800);
  const s = await p3.evaluate(() => ({ session: !!(window.DT.getState().session), err: window.DT.getState().loginError || null, json: /"error"\s*:\s*"unauthorized"/.test(document.body.textContent || "") }));
  rec("expired session: attachment tap goes to sign-in with an explanation, no raw JSON, no new page", !s.session && /expired/i.test(s.err || "") && !s.json && pops.length === 0, JSON.stringify(s));
  await ctx.close();
}

// K. Patient-linked threads (messaging.patientThreads) on the patient board.
{
  cur = "patient threads ";
  const erdoc = await session("ISPN", "er.doc");
  await erdoc.call("POST", "/api/patients", { initials: "ZQ", roomNumber: "7", issueSummary: "Synthetic board row — no PHI", department: "ER", acuity: 3, specialty: "Hospital Medicine" });
  const teamBtns = (pg) => pg.evaluate(() => [...document.querySelectorAll("button")].filter((b) => /Message team/.test(b.textContent || "") || b.title === "Message the care team about this patient").length);
  const toBoard = async (pg) => { await pg.evaluate(() => window.DT.actions.setNav("board")); await pg.waitForFunction(() => (window.DT.getState().board || []).some((p) => p.patientId != null), null, { timeout: 15000 }).catch(() => {}); await sleep(600); };
  await setModule("messaging.patientThreads", false);
  for (const [label, mk] of [["390", () => newPhone(browser, 390)], ["desktop", async () => { const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); watch(page); return { ctx, page }; }]]) {
    const { ctx, page: pb } = await mk();
    await uiLogin(pb, "er_doctor", "ISPN", "er.doc");
    await toBoard(pb);
    const n = await teamBtns(pb);
    rec(`off at sign-in (${label}): no "Message team" control`, n === 0, "buttons=" + n);
    await ctx.close();
  }
  await setModule("messaging.patientThreads", true);
  const { ctx, page: pb } = await newPhone(browser, 390);
  await uiLogin(pb, "er_doctor", "ISPN", "er.doc");
  await toBoard(pb);
  const before = await teamBtns(pb);
  await setModule("messaging.patientThreads", false); // this page is now stale
  await pb.locator("button", { hasText: "Message team" }).first().click().catch(() => {});
  const t = await pb.waitForFunction(() => { const x = document.querySelector("[data-toast]"); return x ? x.textContent : null; }, null, { timeout: 6000 }).then((h) => h.jsonValue()).catch(() => null);
  rec("a stale tap says patient threads are switched off (not \"Try again\")", before > 0 && /Patient-linked threads are switched off/.test(t || "") && !/Try again/.test(t || ""), JSON.stringify({ before, toast: t }));
  const gone = await pb.waitForFunction(() => ![...document.querySelectorAll("button")].some((b) => /Message team/.test(b.textContent || "")), null, { timeout: 6000 }).then(() => true).catch(() => false);
  rec("…and the control disappears without a reload", gone);
  await setModule("messaging.patientThreads", true);
  await pb.reload({ waitUntil: "networkidle" });
  await pb.waitForFunction(() => { const s = window.DT && window.DT.getState(); return s && s.session && s.modules && s.modules["messaging.patientThreads"] !== false; }, null, { timeout: 15000 }).catch(() => {});
  await toBoard(pb);
  await pb.locator("button", { hasText: "Message team" }).first().click().catch(() => {});
  const opened = await pb.waitForFunction(() => window.DT.getState().ui.nav === "messages" && !!document.querySelector('input[aria-label="Message"]'), null, { timeout: 8000 }).then(() => true).catch(() => false);
  rec("on: \"Message team\" opens the thread itself on a phone (composer on screen)", opened);
  await pb.evaluate(() => window.DT.actions.setNav("board")); await sleep(400);
  await pb.evaluate(() => window.DT.actions.setNav("messages")); await sleep(700);
  const atList = await pb.evaluate(() => !document.querySelector('input[aria-label="Message"]'));
  rec("…and a later visit to Messages starts at the list again", atList);
  await ctx.close();
}

await browser.close();
cur = "";
rec("ZERO CSP violations across the run", cspViolations.length === 0, cspViolations.slice(0, 3).join(" | "));
rec("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
for (const m of ["messaging.attachments", "messaging.priority", "messaging.patientThreads"]) await setModule(m, true);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed, ${results.length} total`);
process.exit(failed ? 1 : 0);
