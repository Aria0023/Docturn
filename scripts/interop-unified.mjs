/**
 * DocTurn phone <-> web interop E2E on the UNIFIED app (real Chromium).
 *
 * Since 6f4b221 the phone app IS the web app: "/" on a phone viewport is the
 * installable PWA and "/m" redirects to "/". This drives an iPhone-sized
 * session (hospitalist) against a desktop session (ER physician) plus a
 * director, all on ONE backend, and proves the handoffs cross live:
 * messaging both directions, STAT acknowledge round-trip, admission accept,
 * broadcast delivery, role targets and DND.
 *
 * Run: start a server (RATE_LIMIT=off SYNTHETIC_DATA=true), then
 *   BASE_URL=http://127.0.0.1:3000 node scripts/interop-unified.mjs
 * Exit status: 0 only when every check passed; 1 on any FAIL or if the run
 * throws — usable as a release gate.
 * Chromium: CHROME_PATH, else the sandbox's pre-installed build at
 * /opt/pw-browsers/chromium, else Playwright's own downloaded browser.
 * The final phone screenshot goes to OUT_DIR (default <tmp>/docturn-interop);
 * UPDATE_DOCS=1 writes docs/mobile/interop-phone-final.png instead.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const results = []; const rec = (n, ok, note="") => { results.push([n, ok, note]); console.log((ok?"PASS  ":"FAIL  ")+n+(note?"  ↳ "+note:"")); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const br = await chromium.launch({ executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox"] });
let phonePage = null; // for the final screenshot, whatever happens below
const PHONE = { viewport:{width:390,height:844}, isMobile:true, hasTouch:true, userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" };
const DESK = { viewport:{width:1400,height:900} };
async function login(ctxOpts, roleLabel, org, user) {
  const ctx = await br.newContext(ctxOpts); const page = await ctx.newPage();
  const errs = []; page.on("pageerror", e => errs.push(String(e).slice(0,160)));
  await page.goto(BASE + "/", { waitUntil: "networkidle" }); await sleep(800);
  await page.click(`button:has-text("${roleLabel}")`, { timeout: 5000 }).catch(()=>{});
  const inputs = await page.locator("input").all();
  if (inputs.length >= 2) { await inputs[0].fill(org); await inputs[1].fill(user); }
  await page.locator('button:has-text("Sign in")').last().click({ timeout: 5000 });
  const ok = await page.waitForFunction(() => !document.body.innerText.includes("Demo as role"), null, { timeout: 8000 }).then(()=>true).catch(()=>false);
  const me = await page.evaluate(() => fetch("/api/user", { credentials:"include" }).then(r => r.ok ? r.json() : null));
  return { ctx, page, ok, me, errs };
}
const api = (page) => (method, path, body) => page.evaluate(async ([m,p,b]) => { const r = await fetch(p, { method:m, credentials:"include", headers: b?{"Content-Type":"application/json"}:{}, body: b?JSON.stringify(b):undefined }); let j=null; try { j = await r.json(); } catch {} return { status:r.status, json:j }; }, [method, path, body]);
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g," ");
const poll = async (page, re, ms=8000) => { const t0=Date.now(); while (Date.now()-t0<ms) { if (re.test(await text(page))) return true; await sleep(300); } return false; };

try {
  // ---- sessions
  const P = await login(PHONE, "Hospitalist", "ISPN", "chen");
  phonePage = P.page;
  rec("phone: form login as hospitalist (chen) enters the app", P.ok && P.me?.username==="chen", `me=${P.me?.username} errs=${P.errs.length}`);
  const W = await login(DESK, "ER physician", "ISPN", "er.doc");
  rec("web: form login as ER physician (er.doc) enters the app", W.ok && W.me?.username==="er.doc", `me=${W.me?.username}`);
  const D = await login(DESK, "Hospitalist director", "ISPN", "director");
  rec("web: director login", D.ok && D.me?.role==="director", `role=${D.me?.role}`);
  const erApi = api(W.page), chenApi = api(P.page), dirApi = api(D.page);

  // ---- phone layout sanity: is it actually a mobile layout?
  const phoneIsMobile = await P.page.evaluate(() => window.matchMedia("(max-width: 768px)").matches);
  rec("phone: unified app renders in mobile layout (narrow media query)", phoneIsMobile);

  // ---- 1) web -> phone live message
  const conv = (await erApi("POST", "/api/messaging/conversations", { type:"direct", participantIds:[P.me.id] })).json;
  rec("web: create direct conversation with the phone user", !!conv?.id, "convo="+conv?.id);
  // phone: open messaging via the app's own store action (robust to icon-only nav)
  // Messaging view marker: the compose/search affordances, NOT the dashboard's "Messages (7 days)" tile.
  const inMessaging = async (page) => (await page.locator("input:not([type=file]):not([type=password])").count()) > 0 && !/Census & assignments/.test(await text(page));
  const goNav = async (page, ids) => { for (const id of ids) { await page.evaluate((i) => { try { window.DT.actions.setNav(i); } catch (e) {} }, id); await sleep(700); if (await inMessaging(page)) return id; } return null; };
  const navId = await goNav(P.page, ["messages", "messaging"]);
  rec("phone: can open Messaging view", !!navId, "navId="+navId);
  await sleep(600);
  // request-level diagnostics on the phone
  const preq = []; P.page.on("request", r => { if (r.url().includes("/api/")) preq.push(r.method()+" "+r.url().replace(BASE,"")); });
  const pres = []; P.page.on("response", r => { if (r.url().includes("/api/") && r.request().method()!=="GET") pres.push(r.request().method()+" "+r.url().replace(BASE,"")+" -> "+r.status()); });
  const tag1 = "PING-web-"+Date.now();
  await erApi("POST", "/api/messaging/send", { conversationId: conv.id, content: tag1, priority:"routine" });
  const live1 = await poll(P.page, new RegExp(tag1), 8000);
  if (!live1) {
    const snap = (await text(P.page)).slice(0, 500);
    const convs = (await chenApi("GET", "/api/messaging/conversations")).json;
    console.log("   [diag] phone Messaging view text:", snap);
    console.log("   [diag] phone /api/messaging/conversations count:", Array.isArray(convs)?convs.length:convs, "| contains tag:", JSON.stringify(convs).includes(tag1));
    console.log("   [diag] phone /api requests since nav:", preq.slice(-8).join(" ; "));
  }
  rec("phone: receives web message LIVE (no reload)", live1);

  // ---- 2) phone -> web reply via the UI composer: open the thread by conversation row
  const erName = W.me?.displayName || "er.doc";
  await P.page.click(`text=${tag1}`, { timeout: 2500 }).catch(async () => { await P.page.click(`text=${erName}`, { timeout: 2500 }).catch(()=>{}); });
  await sleep(700);
  const box = P.page.locator("textarea, input[placeholder*='essage' i], input:not([type=file]):not([type=password]):not([type=checkbox])").last();
  const tag2 = "PONG-phone-"+Date.now();
  let sent = false;
  try { await box.fill(tag2, { timeout: 4000 }); await P.page.keyboard.press("Enter"); sent = true; } catch (e) {}
  if (!sent) { try { await P.page.locator('button:has-text("Send")').last().click({ timeout: 2000 }); sent = true; } catch {} }
  await sleep(1200);
  const webHas = (await erApi("GET", `/api/messaging/conversations/${conv.id}/messages`)).json;
  const arrived = Array.isArray(webHas) ? webHas.some(m => (m.content||"").includes(tag2)) : JSON.stringify(webHas).includes(tag2);
  rec("phone: composer sends; web/backend receives the phone reply", sent && arrived, `sent=${sent} arrivedOnServer=${arrived}`);
  // web UI shows it live?
  await W.page.click('text=Messages', { timeout: 3000 }).catch(()=>{});
  rec("web UI: shows the phone's reply live", await poll(W.page, new RegExp(tag2), 8000));

  // ---- 3) STAT to phone, acknowledge on phone, visible to web
  const stat = (await erApi("POST", "/api/messaging/send", { conversationId: conv.id, content: "STAT-"+Date.now()+" bed 4 now", priority:"stat" })).json;
  const sawStat = await poll(P.page, /STAT/, 6000);
  let acked = false;
  try { await P.page.locator('button:has-text("Acknowledge")').first().click({ timeout: 4000 }); acked = true; } catch {}
  await sleep(1000);
  const msgs = (await erApi("GET", `/api/messaging/conversations/${conv.id}/messages`)).json;
  const statRow = Array.isArray(msgs) ? msgs.find(m => m.id === stat?.id) : null;
  const ackVisible = JSON.stringify(statRow||{}).match(/ack/i) && /acknowledged|ackedAt|acknowledgedAt/i.test(JSON.stringify(statRow||{})) ;
  rec("phone: STAT arrives with an Acknowledge action; tapping it works", sawStat && acked, `saw=${sawStat} acked=${acked}`);
  rec("web: sees the phone's STAT acknowledgement", !!ackVisible || (await poll(W.page, /Acknowledged/, 5000)), `row=${JSON.stringify(statRow||{}).slice(0,140)}`);

  // ---- 4) admission web -> phone, accept on phone, web sees resolved
  const pat = (await erApi("POST", "/api/patients", { initials:"IX", roomNumber:"ER-2", issueSummary:"sob", acuity:3 })).json;
  const hosp = (await dirApi("GET", "/api/hospitalists")).json?.find?.(h => h.userId === P.me.id);
  const asg = (await erApi("POST", "/api/assignments", { patientId: pat.id, mode:"manual", hospitalistId: hosp?.id })).json;
  rec("web ER: routes an admission to the phone hospitalist", !!asg?.id, `asg=${asg?.id} status=${asg?.status}`);
  await P.page.evaluate(() => { try { window.DT.actions.setNav("dashboard"); } catch (e) {} });
  await sleep(800);
  const seen = await poll(P.page, /IX/, 8000);
  let accepted = false;
  const nAccept = await P.page.locator('button:has-text("Accept")').count();
  pres.length = 0;
  // Accept THIS admission (the seeded demo org already has another pending request).
  const card = P.page.locator(':is(div,li,article):has-text("IX")').filter({ has: P.page.locator('button:has-text("Accept")') }).last();
  try { await card.locator('button:has-text("Accept")').first().click({ timeout: 4000 }); accepted = true; }
  catch { try { await P.page.locator('button:has-text("Accept")').last().click({ timeout: 3000 }); accepted = true; } catch {} }
  await sleep(1500);
  console.log(`   [diag] Accept buttons on phone: ${nAccept}; non-GET /api calls after tap: ${pres.join(" ; ") || "NONE"}`);
  { const dash = (await text(P.page)).slice(0, 400); console.log("   [diag] phone dashboard text:", dash); }
  const sentFeed = (await erApi("GET", "/api/assignments/sent")).json;
  const allAsg = (await dirApi("GET", "/api/assignments")).json;
  const pick = (x) => Array.isArray(x) ? x.find(a => a.id === asg?.id || a.assignmentId === asg?.id) : null;
  const row = pick(sentFeed) || pick(allAsg) || pick(sentFeed?.items) || pick(allAsg?.items);
  rec("phone: sees the admission LIVE and accepts it", seen && accepted, `seen=${seen} accepted=${accepted}`);
  rec("web: assignment resolved (status accepted) after phone accept", row?.status === "accepted", `status=${row?.status}`);

  // ---- 5) director broadcast -> phone banner -> ack -> director sees ack
  const bc = (await dirApi("POST", "/api/broadcasts", { message: "DRILL-"+Date.now(), severity:"critical" })).json;
  const bannerSeen = await poll(P.page, /DRILL-/, 6000);
  let bAck = false;
  try { await P.page.locator('button:has-text("Acknowledge"), button:has-text("Ack")').first().click({ timeout: 3000 }); bAck = true; } catch {}
  await sleep(800);
  rec("phone: critical broadcast appears LIVE on the phone", bannerSeen, `seen=${bannerSeen}`);
  const ackApi = (await chenApi("POST", `/api/broadcasts/${bc?.id}/ack`)).status;
  rec("phone UI: has a control to ACKNOWLEDGE the broadcast (API supports it: " + ackApi + ")", bAck, `uiAckControl=${bAck} apiAck=${ackApi}`);

  // ---- 6) role-based messaging from phone: "message the on-call"
  const targets = (await chenApi("GET", "/api/messaging/on-call-targets")).json;
  rec("phone: on-call/role targets available", Array.isArray(targets) && targets.length > 0, `targets=${Array.isArray(targets)?targets.map(t=>t.label).join("|"):targets}`);

  // ---- 7) DND on phone reflected to web
  await chenApi("PATCH", "/api/settings/me", { key:"dnd", value:true });
  const av = (await erApi("GET", `/api/messaging/availability/${P.me.id}`)).json;
  rec("phone sets DND; web sees availability dnd=true", av?.dnd === true, JSON.stringify(av));
  await chenApi("PATCH", "/api/settings/me", { key:"dnd", value:false });

  // ---- 8) credentials are REAL: the form posts what was typed
  {
    const ctx = await br.newContext(PHONE); const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" }); await sleep(800);
    const posted = [];
    page.on("request", r => { if (r.url().endsWith("/api/login") && r.method() === "POST") { try { posted.push(JSON.parse(r.postData() || "{}")); } catch {} } });
    const inputs = await page.locator("input").all();
    await inputs[0].fill("ISPN"); await inputs[1].fill("patel"); await inputs[2].fill("not-the-password");
    await page.locator('button:has-text("Sign in")').last().click(); await sleep(1500);
    const meBad = await page.evaluate(() => fetch("/api/user", { credentials:"include" }).then(r => r.ok ? r.json() : null));
    const errShown = /Wrong organization code, username or password/i.test(await text(page));
    rec("login: wrong password is rejected — no session, error shown", !meBad && errShown, `me=${meBad?.username} err=${errShown}`);
    rec("login: request body carries the TYPED credentials (not a demo substitute)", posted[0]?.username === "patel" && posted[0]?.password === "not-the-password" && posted[0]?.orgCode === "ISPN", JSON.stringify(posted[0] && { ...posted[0], password: posted[0].password === "not-the-password" ? "<typed>" : posted[0].password }));
    await inputs[2].fill("docturn");
    await page.locator('button:has-text("Sign in")').last().click();
    const okP = await page.waitForFunction(() => !document.body.innerText.includes("Demo as role"), null, { timeout: 8000 }).then(()=>true).catch(()=>false);
    const meP = await page.evaluate(() => fetch("/api/user", { credentials:"include" }).then(r => r.ok ? r.json() : null));
    rec("login: typed username is honoured (patel signs in as patel, not the role's default account)", okP && meP?.username === "patel", `me=${meP?.username}`);
    await ctx.close();
  }
} catch (e) {
  // A step that throws (server down, selector API change, null session…) is a
  // failure of the run, not something to skip over.
  rec("interop run completed without throwing", false, String(e?.stack || e).split("\n").slice(0, 3).join(" | "));
}

const failed = results.filter(r => !r[1]).length;
console.log("\n" + (results.length - failed) + " passed, " + failed + " failed, " + results.length + " total");
// Final phone screenshot for a human to look at. It goes to a scratch directory
// (OUT_DIR, default <tmp>/docturn-interop) so a routine run never rewrites the
// tracked docs image; UPDATE_DOCS=1 refreshes docs/mobile/interop-phone-final.png
// deliberately.
if (phonePage) {
  const shot = process.env.UPDATE_DOCS === "1"
    ? path.join(ROOT, "docs", "mobile", "interop-phone-final.png")
    : path.join(process.env.OUT_DIR || path.join(os.tmpdir(), "docturn-interop"), "interop-phone-final.png");
  try { fs.mkdirSync(path.dirname(shot), { recursive: true }); await phonePage.screenshot({ path: shot }); console.log("screenshot: " + shot); }
  catch (e) { console.log("screenshot not written: " + String(e).slice(0, 160)); }
}
await br.close().catch(() => {});
// Release gate: non-zero on ANY failed check, and on a run that recorded nothing.
process.exit(failed > 0 || results.length === 0 ? 1 : 0);
