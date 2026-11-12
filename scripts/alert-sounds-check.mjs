/**
 * Priority alert sounds (PerfectServe parity #8, module messaging.alertSounds),
 * measured in REAL Chromium on emulated iPhones (375×667 / 390×844 / 430×932,
 * DPR 3, touch, iPhone Safari UA; autoplay allowed so no tap is needed) with
 * the page's WebAudio oscillators recorded:
 *
 *   S. Settings → Alert sounds: the honest label ("In-app sound — iPhone
 *      lock-screen notifications use the system sound"), one select per
 *      priority showing the server's answer; a change is ONE PUT 200 that
 *      the server stores (and a reload shows); Preview plays the tone.
 *   P. A live message from someone else plays MY tone for its priority (STAT,
 *      urgent); a priority set to None plays nothing; my own message plays
 *      nothing. No audio file is ever requested.
 *   M. messaging.alertSounds off: no Settings group, GET 404, a STAT message
 *      plays nothing.
 *   Q. (REAL_BASE_URL) SYNTHETIC_DATA=false: a fresh tenant's user starts on
 *      the built-in defaults with nothing stored.
 *   L. Layout at every width; Z. zero CSP violations / page errors.
 *
 *   BASE_URL=http://127.0.0.1:8867 [REAL_BASE_URL=… REAL_DEV_PASSWORD=…] node scripts/alert-sounds-check.mjs
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
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
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
  // Record every tone the page synthesises: the first note's frequency names it.
  await page.addInitScript(() => {
    window.__tones = [];
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const orig = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function () {
      const osc = orig.call(this);
      const ctx = this;
      const set = osc.frequency.setValueAtTime.bind(osc.frequency);
      osc.frequency.setValueAtTime = function (hz, at) {
        if (at - ctx.currentTime <= 0.03) window.__tones.push({ hz, t: Date.now() });
        return set(hz, at);
      };
      return osc;
    };
  });
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
const HZ = { siren: 960, alarm: 880, chime: 660, ping: 1046, soft: 523 };
const LABEL = "In-app sound — iPhone lock-screen notifications use the system sound";
const tones = (P) => P.page.evaluate(() => window.__tones.slice());
const settings = (P) => P.page.evaluate(() => ({
  group: document.querySelectorAll("[data-sound-row]").length,
  label: (document.querySelector("[data-sound-label]") || { textContent: "" }).textContent,
  sel: Object.fromEntries([...document.querySelectorAll("[data-sound-select]")].map((s) => [s.getAttribute("data-sound-select"), s.value])),
}));
const writes = (log, from = 0) => log.slice(from).filter((r) => r.m !== "GET");
const audioFiles = [];
async function newTones(P, before, ms = 4000) {
  return waitFor(async () => { const t = await tones(P); return t.length > before ? t.slice(before) : null; }, ms);
}
async function sendFrom(S, convId, priority, content) {
  return S.api("POST", "/api/messaging/send", { conversationId: convId, content, priority });
}

console.log("== synthetic server " + BASE);
{
  const dev = await open(BASE, 430, "DOCTURN", "dev");
  const ispn = (await dev.api("GET", "/api/dev/organizations")).json.find((o) => o.code === "ISPN");
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "messaging.alertSounds", enabled: true });
  const ER = await open(BASE, 430, "ISPN", "er.doc");
  for (const width of [375, 390, 430]) {
    const label = "@" + width;
    const C = await open(BASE, width, "ISPN", "chen");
    C.page.on("request", (r) => { if (/\.(mp3|wav|ogg|m4a|aac|caf)(\?|$)/i.test(r.url())) audioFiles.push(r.url()); });
    await C.api("PUT", "/api/messaging/alert-sounds", { stat: "siren", urgent: "alarm", routine: "ping" });
    await reload(C.page);
    const me = (await C.api("GET", "/api/user")).json.id;
    const cv = (await ER.api("POST", "/api/messaging/conversations", { type: "direct", participantIds: [me] })).json;
    await nav(C.page, "account", 1800);
    let v = await waitFor(async () => { const x = await settings(C); return x.group === 3 ? x : null; }, 8000);
    rec(`S ${label}: Settings → Alert sounds shows the honest in-app label and the server's choice`, v && v.label.includes(LABEL) && v.sel.stat === "siren" && v.sel.urgent === "alarm" && v.sel.routine === "ping", JSON.stringify(v));
    await checkLayout(C.page, `${label} Alert sounds`, ["[data-sound-row]", "[data-sound-label]"]);
    let mark = C.apiLog.length;
    await C.page.locator('[data-sound-select="urgent"]').selectOption("chime");
    await sleep(1200);
    let w = writes(C.apiLog, mark);
    const srv = (await C.api("GET", "/api/messaging/alert-sounds")).json;
    rec(`S ${label}: a change is ONE PUT 200 of all three and the server stores it`, w.length === 1 && w[0].m === "PUT" && w[0].s === 200 && JSON.stringify(JSON.parse(w[0].body)) === JSON.stringify({ stat: "siren", urgent: "chime", routine: "ping" }) && srv.urgent === "chime", w.map((x) => x.m + " " + x.s + " " + x.body).join(", "));
    await C.page.locator('[data-sound-select="routine"]').selectOption("none");
    await sleep(1200);
    let t0 = (await tones(C)).length;
    await C.page.locator('[data-sound-preview="urgent"]').click();
    let nt = await newTones(C, t0, 3000);
    rec(`S ${label}: Preview plays the chosen tone (chime)`, nt && nt[0].hz === HZ.chime, JSON.stringify(nt));
    if (width === 390) {
      await reload(C.page);
      await nav(C.page, "account", 1800);
      v = await waitFor(async () => { const x = await settings(C); return x.group === 3 ? x : null; }, 8000);
      rec(`S ${label}: after a reload the selects show what the server stores`, v && v.sel.urgent === "chime" && v.sel.routine === "none", JSON.stringify(v && v.sel));
    }
    // P. live messages.
    await nav(C.page, "dashboard", 1500);
    await sleep(1600);
    t0 = (await tones(C)).length;
    await sendFrom(ER, cv.id, "stat", "sound check stat " + RUN);
    nt = await newTones(C, t0);
    rec(`P ${label}: a STAT message from someone else plays MY STAT tone (siren)`, nt && nt[0].hz === HZ.siren, JSON.stringify(nt));
    await sleep(1800);
    t0 = (await tones(C)).length;
    await sendFrom(ER, cv.id, "urgent", "sound check urgent " + RUN);
    nt = await newTones(C, t0);
    rec(`P ${label}: an urgent message plays MY urgent tone (chime)`, nt && nt[0].hz === HZ.chime, JSON.stringify(nt));
    await sleep(1800);
    t0 = (await tones(C)).length;
    await sendFrom(ER, cv.id, "routine", "sound check routine " + RUN);
    await sleep(3000);
    rec(`P ${label}: routine set to None plays nothing`, (await tones(C)).length === t0);
    await sendFrom(C, cv.id, "stat", "my own stat " + RUN);
    await sleep(3000);
    rec(`P ${label}: my own message plays nothing`, (await tones(C)).length === t0);
    await C.ctx.close();
  }
  // M. module off.
  {
    const C = await open(BASE, 390, "ISPN", "chen");
    const me = (await C.api("GET", "/api/user")).json.id;
    const cv = (await ER.api("POST", "/api/messaging/conversations", { type: "direct", participantIds: [me] })).json;
    await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "messaging.alertSounds", enabled: false });
    await reload(C.page);
    await nav(C.page, "account", 1800);
    const v = await settings(C);
    const g = await C.api("GET", "/api/messaging/alert-sounds");
    await nav(C.page, "dashboard", 1500);
    const t0 = (await tones(C)).length;
    await sendFrom(ER, cv.id, "stat", "sound off check " + RUN);
    await sleep(3500);
    rec("M messaging.alertSounds off: no Settings group, GET 404 module_disabled, a STAT message plays nothing", v.group === 0 && g.status === 404 && g.json && g.json.module === "messaging.alertSounds" && (await tones(C)).length === t0, JSON.stringify({ group: v.group, g: g.status }));
    await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "messaging.alertSounds", enabled: true });
    await C.ctx.close();
  }
  await ER.ctx.close(); await dev.ctx.close();
}

if (REAL) {
  console.log("== real server " + REAL);
  const dev = await open(REAL, 390, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD);
  const cfg = (await dev.api("GET", "/api/config")).json;
  rec("Q (setup) server is SYNTHETIC_DATA=false", cfg && cfg.syntheticData === false);
  const NEWPW = "Sound-Check-2026!";
  const code = "SN" + RUN;
  const o = (await dev.api("POST", "/api/dev/organizations", { name: "Sound Check " + RUN, code, timezone: "America/Chicago" })).json;
  const r = await dev.api("POST", "/api/dev/users", { organizationId: o.id, role: "hospitalist", username: "snd.hosp", displayName: "Dr. Sound Check", credential: "MD", specialty: "Hospital Medicine", shiftType: "day", patientCap: 12 });
  const temp = r.json && r.json.temporaryPassword;
  {
    const ctx = await browser.newContext(); const pg = await ctx.newPage();
    await pg.goto(REAL + "/", { waitUntil: "domcontentloaded" });
    await pg.evaluate(async ([t, n, oc]) => {
      const j = (m, path, b) => fetch(path, { method: m, credentials: "include", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((x) => x.status);
      return [await j("POST", "/api/login", { orgCode: oc, username: "snd.hosp", password: t }), await j("PATCH", "/api/account/password", { currentPassword: t, newPassword: n }), await j("POST", "/api/logout")];
    }, [temp, NEWPW, code]);
    await ctx.close();
  }
  await dev.ctx.close();
  const H = await open(REAL, 390, code, "snd.hosp", NEWPW);
  const g = (await H.api("GET", "/api/messaging/alert-sounds")).json;
  await nav(H.page, "account", 1800);
  const v = await waitFor(async () => { const x = await settings(H); return x.group === 3 ? x : null; }, 8000);
  rec("Q: a fresh tenant's user starts on the built-in defaults (nothing stored, no demo choice)", g && g.stat === "siren" && g.urgent === "alarm" && g.routine === "ping" && v && v.label.includes(LABEL), JSON.stringify({ g, v }));
  await checkLayout(H.page, "Q@390 Alert sounds", ["[data-sound-row]"]);
  await H.ctx.close();
}

await browser.close();
rec("Z: no audio file requested (tones are synthesised)", audioFiles.length === 0, audioFiles.slice(0, 3).join(" | "));
rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
