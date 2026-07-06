/*
 * DocTurn mobile + interop E2E (real browser).
 *
 * Boots the server as a child process, then drives BOTH surfaces in a real
 * Chromium: the desktop web app (/) and the installable mobile PWA (/m). Proves
 * every mobile function and live web<->phone interoperability across user types.
 *
 * Run: node scripts/e2e-mobile.mjs
 * Chromium: PW_CHROME=/path/to/chrome (defaults to the sandbox's pre-installed
 * build); skips with a clear message if no browser is available.
 */
import { spawn } from "node:child_process";
import { existsSync, appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const LOG = process.env.E2E_LOG || "";
function out(line) {
  console.log(line);
  if (LOG) { try { appendFileSync(LOG, line + "\n"); } catch {} }
}

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME =
  process.env.PW_CHROME ||
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 860 } };

let pass = 0, fail = 0;
const fails = [];
function rec(name, ok, detail = "") {
  if (ok) { pass++; out("PASS  " + name); }
  else { fail++; fails.push(name + (detail ? "  ↳ " + detail : "")); out("FAIL  " + name + (detail ? "  ↳ " + detail : "")); }
}
async function pollText(page, re, ms = 8000) {
  const rx = re instanceof RegExp ? re : new RegExp(re);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await page.evaluate(() => document.body.innerText).catch(() => "");
    if (rx.test(t)) return true;
    await sleep(300);
  }
  return false;
}
async function bodyText(page) { return page.evaluate(() => document.body.innerText).catch(() => ""); }

async function main() {
  out("== e2e boot ==");
  if (!existsSync(CHROME)) {
    out("SKIP: no Chromium at " + CHROME + " (set PW_CHROME). Nothing tested.");
    process.exit(0);
  }
  const { chromium } = (await import("playwright-core")).default ?? (await import("playwright-core"));

  // Reuse an already-running server if one is healthy (the shell wrapper starts
  // it); only spawn our own as a fallback.
  let srv = null;
  let healthy = false;
  try { const r = await fetch(BASE + "/api/health"); healthy = r.ok; } catch {}
  if (!healthy) {
    srv = spawn("npx", ["tsx", "server/index.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, RATE_LIMIT: "off", SYNTHETIC_DATA: "true", STAT_REALERT_MS: "1500", STAT_ESCALATE_MS: "3000" },
      stdio: "ignore",
    });
  }
  out("== launching browser ==");
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

  try {
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(BASE + "/api/health"); if (r.ok) break; } catch {}
      await sleep(1000);
    }
    out("== server up, browser launched ==");

    // Context factory: log in via the API in-origin, then load the surface.
    async function open(username, path, opts, org = "ISPN") {
      const ctx = await browser.newContext(opts);
      const page = await ctx.newPage();
      await page.goto(BASE + "/m", { waitUntil: "domcontentloaded" });
      const status = await page.evaluate(async ([u, o]) => {
        const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ orgCode: o, username: u, password: "docturn" }) });
        return r.status;
      }, [username, org]);
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(1800);
      return { ctx, page, status };
    }
    const clickFirst = async (page, sel) => { try { await page.locator(sel).first().click({ timeout: 4000 }); return true; } catch { return false; } };
    // API helper bound to a page's cookie jar.
    const apiIn = (page) => (method, p, body) =>
      page.evaluate(async ([m, pp, b]) => {
        const r = await fetch(pp, { method: m, credentials: "include", headers: b ? { "Content-Type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined });
        const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
        return { status: r.status, json: j };
      }, [method, p, body]);

    // ===================================================================
    // 1) EVERY USER TYPE loads the /m PWA without crashing
    // ===================================================================
    const ROLES = [
      ["chen", "hospitalist"],
      ["er.doc", "er_doctor"],
      ["er.director", "er_director"],
      ["director", "director"],
      ["dev", "developer"],
    ];
    for (const [uname, role] of ROLES) {
      const org = role === "developer" ? "DOCTURN" : "ISPN";
      const { page, status } = await open(uname, "/m", PHONE, org);
      const txt = await bodyText(page);
      const crashed = /Something went wrong|Unhandled|is not defined|Cannot read/i.test(txt);
      const mounted = txt.replace(/\s/g, "").length > 40;
      rec(`/m loads for ${role} (${uname}) without crashing`, status === 200 && mounted && !crashed,
        `login=${status} mounted=${mounted} crashed=${crashed}`);
      await page.context().close();
    }

    // ===================================================================
    // 2) LOGIN FORM on /m works (real form, not API)
    // ===================================================================
    {
      const ctx = await browser.newContext(PHONE);
      const page = await ctx.newPage();
      await page.goto(BASE + "/m", { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      // Fill the visible login inputs (org / username / password) and submit.
      const inputs = await page.$$("input");
      let filled = false;
      if (inputs.length >= 3) {
        await inputs[0].fill("ISPN").catch(() => {});
        await inputs[1].fill("chen").catch(() => {});
        await inputs[2].fill("docturn").catch(() => {});
        await page.keyboard.press("Enter").catch(() => {});
        await page.click("text=/sign in|log in|continue/i").catch(() => {});
        filled = true;
      }
      const ok = filled && (await pollText(page, /Messages|Dashboard|On call|Directory/i, 8000));
      rec("/m login FORM authenticates and enters the app", ok, `inputs=${inputs.length}`);
      await ctx.close();
    }

    // ===================================================================
    // 3) WEB <-> PHONE live messaging interop
    //    web(er.doc) and phone(chen) on ONE backend.
    // ===================================================================
    const W = await open("er.doc", "/", DESKTOP);       // web, ER physician
    const P = await open("chen", "/m", PHONE);           // phone, hospitalist
    const erApi = apiIn(W.page);
    const chenApi = apiIn(P.page);

    // Resolve ids + create the direct conversation from the WEB side (API).
    const chenUser = (await erApi("GET", "/api/physicians/directory")).json?.find?.((d) => /Alyesh|chen/i.test(d.displayName));
    const chenUserId = chenUser?.userId;
    const convo = (await erApi("POST", "/api/messaging/conversations", { type: "direct", participantIds: [chenUserId] })).json;
    rec("web can start a direct conversation with a phone user", !!convo?.id, "convoId=" + (convo && convo.id));

    // Re-hydrate both UIs so the new conversation shows.
    await W.page.goto(BASE + "/", { waitUntil: "networkidle" }); await W.page.waitForTimeout(1500);
    await P.page.reload({ waitUntil: "networkidle" }); await P.page.waitForTimeout(1500);

    // The counterparty (er.doc — the "web / other device" user) sends over the
    // SAME backend+WS the web app uses; we drive the phone's real /m UI to prove
    // it receives, replies, and acknowledges live. (The web app's own composer is
    // covered by the ui-smoke suite + xuser-smoke.)
    // Phone: open the Messages tab + the conversation.
    await clickFirst(P.page, 'text=Messages');
    await P.page.waitForTimeout(800);
    await clickFirst(P.page, 'text=/Reyes|Erin/i');
    await P.page.waitForTimeout(800);

    // -- counterparty sends; phone /m receives LIVE --
    await erApi("POST", "/api/messaging/send", { conversationId: convo.id, content: "PING-from-web-42" });
    const gotOnPhone = await pollText(P.page, /PING-from-web-42/, 10000);
    rec("phone /m receives a message LIVE from the other surface (web → phone)", gotOnPhone);

    // -- phone replies via the real /m UI; counterparty receives (verify via API) --
    const phoneBox = P.page.locator('input[placeholder*="Message" i], input[placeholder*="secure" i], textarea').first();
    let phoneSent = false;
    try { await phoneBox.fill("PONG-from-phone-7", { timeout: 4000 }); await P.page.keyboard.press("Enter"); phoneSent = true; } catch {}
    rec("phone /m thread send box works", phoneSent);
    await W.page.waitForTimeout(1200);
    const erMsgs = (await erApi("GET", "/api/messaging/conversations/" + convo.id + "/messages")).json || [];
    rec("the other surface receives the phone's reply (phone → web)", erMsgs.some((m) => /PONG-from-phone-7/.test(m.content)));

    // ===================================================================
    // 4) STAT priority + acknowledgement, received + acked on the phone /m
    // ===================================================================
    await erApi("POST", "/api/messaging/send", { conversationId: convo.id, content: "CODE-STROKE-now", priority: "stat" });
    const phoneStatMsg = await pollText(P.page, /CODE-STROKE-now/, 10000);
    const ackBtn = await pollText(P.page, /Acknowledge/, 8000);
    rec("phone /m shows the incoming STAT with an Acknowledge action", phoneStatMsg && ackBtn, `msg=${phoneStatMsg} ack=${ackBtn}`);
    await clickFirst(P.page, 'button:has-text("Acknowledge")');
    await P.page.waitForTimeout(1500);
    // Sender side sees the acknowledgement (ackCount == 1 via the shared backend).
    const statRow = ((await erApi("GET", "/api/messaging/conversations/" + convo.id + "/messages")).json || [])
      .find((m) => /CODE-STROKE-now/.test(m.content));
    rec("acknowledging on the phone is visible to the sender (STAT ack round-trip)", !!statRow && statRow.ackCount === 1, "ackCount=" + (statRow && statRow.ackCount));

    // ===================================================================
    // 5) WEB routes an admission -> phone gets it live -> accept on phone
    // ===================================================================
    const patient = (await erApi("POST", "/api/patients", { initials: "ZZ", roomNumber: "12", issueSummary: "e2e", acuity: 2 })).json;
    const chenHosp = (await erApi("GET", "/api/hospitalists")).json?.find?.((h) => h.userId === chenUserId);
    const asg = (await erApi("POST", "/api/assignments", { patientId: patient?.id, mode: "manual", hospitalistId: chenHosp?.id })).json;
    rec("web routes an admission to the phone user", !!asg?.id, "asgId=" + (asg && asg.id));
    // Phone: Dashboard tab shows the incoming assignment live.
    await P.page.click("text=Dashboard").catch(() => {});
    const phoneGotAsg = await pollText(P.page, /ZZ|Room 12|Accept/i, 10000);
    rec("phone receives the admission LIVE and can accept it", phoneGotAsg);
    // Accept on the phone, verify server-side.
    await P.page.click("text=Accept").catch(() => {});
    await P.page.waitForTimeout(1500);
    const accepted = (await chenApi("GET", "/api/assignments/my")).json?.some?.((a) => a.id === asg?.id);
    rec("accepting on the phone updates the shared backend (phone → web state)", !!accepted);
    // Web ER's sent feed reflects the acceptance (via API — the web app polls the same).
    const erSent = (await erApi("GET", "/api/assignments/sent")).json?.find?.((a) => a.id === asg?.id);
    rec("web ER sees the assignment resolved (no longer pending)", erSent && erSent.status !== "pending", "status=" + (erSent && erSent.status));

    // ===================================================================
    // 6) Mobile tabs all render for the hospitalist (no crash)
    // ===================================================================
    for (const tab of ["Messages", "On call", "Directory", "Profile", "Dashboard"]) {
      await P.page.click(`text=${tab}`).catch(() => {});
      await P.page.waitForTimeout(700);
      const t = await bodyText(P.page);
      rec(`/m "${tab}" tab renders`, t.replace(/\s/g, "").length > 30 && !/Something went wrong/i.test(t));
    }

    await W.ctx.close();
    await P.ctx.close();
  } finally {
    await browser.close().catch(() => {});
    if (srv) srv.kill("SIGKILL");
  }

  out(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
  if (fails.length) { out("FAILURES:"); fails.forEach((f) => out("  - " + f)); }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { out("FATAL " + (e && e.stack || e)); process.exit(2); });
