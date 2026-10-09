/**
 * Settings → Integrations, measured in REAL Chromium on an emulated iPhone
 * (375 / 390 / 430 wide). The panel used to be a mock ("Connect" flipped a
 * browser boolean and toasted "Connected"); this check proves the real one:
 *
 *   1. every card's status badge equals what GET /api/integrations says, and
 *      the word "Connected" / "Firebase" appears nowhere the server does not
 *      back it (no fake "Connected");
 *   2. the on/off switch round-trips through the server: switching push off
 *      flips the org's integration.push module (GET /api/modules), switching
 *      it back on restores it; a not-configured integration's switch is
 *      disabled and says why;
 *   3. "Test connection" shows the server's real result;
 *   4. the Amion "Set up" sheet is write-only: a saved OCS URL never comes
 *      back in the page or any API response, the sheet shows only
 *      "Saved · updated by …", and Remove clears it;
 *   5. phone layout: no horizontal overflow (page and sheet), every control in
 *      the panel/sheet ≥ 44 px tall, every text input ≥ 16 px;
 *   6. zero CSP violations and zero page errors across the run.
 *
 * Run against a seeded synthetic server with INTEGRATION_KEY set and
 * RATE_LIMIT=off:  BASE_URL=http://127.0.0.1:7001 node scripts/integrations-panel-check.mjs
 * Exits non-zero on any failure. WIDTHS=390 limits the viewports.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ALL = { 375: 667, 390: 844, 430: 932 };
const WIDTHS = (process.env.WIDTHS || "375,390,430").split(",").map((w) => Number(w.trim())).filter((w) => ALL[w]);
const SECRET = "PLAYWRIGHT-SECRET-" + Date.now();

const results = [];
const rec = (name, ok, note = "") => {
  results.push([name, ok]);
  console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  ↳ " + note : ""));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

for (const w of WIDTHS) {
  const tag = `${w}px`;
  const ctx = await browser.newContext({ viewport: { width: w, height: ALL[w] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const csp = [];
  const errors = [];
  page.on("console", (m) => { if (/Content.Security.Policy|Refused to|violates the following/i.test(m.text())) csp.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  page.on("dialog", (d) => d.accept());

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  // Sign in through the real form as the director.
  const inputs = await page.locator("input").all();
  await inputs[0].fill("ISPN");
  await inputs[1].fill("director");
  await inputs[2].fill("docturn");
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role === "director"); }, null, { timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => window.DT.actions.setNav("settings"));
  await page.waitForSelector("[data-integrations-panel] [data-integration]", { timeout: 20000 });
  await sleep(400);

  const api = (method, path, body) => page.evaluate(([m, p, b]) => fetch(p, { method: m, credentials: "include", headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, text: await r.text() })), [method, path, body]);
  const server = async () => JSON.parse((await api("GET", "/api/integrations")).text);
  const ui = () => page.evaluate(() => [...document.querySelectorAll("[data-integrations-panel] [data-integration]")].map((el) => ({
    id: el.getAttribute("data-integration"),
    status: el.getAttribute("data-status"),
    badge: (el.querySelector("[data-int-badge]") || {}).getAttribute ? el.querySelector("[data-int-badge]").getAttribute("data-int-badge") : null,
    enabled: el.getAttribute("data-enabled") === "1",
    text: el.textContent,
    switchDisabled: !!(el.querySelector("[data-int-switch]") || {}).disabled,
  })));

  // 1. status matches the server; no fake "Connected".
  const s1 = await server();
  const u1 = await ui();
  rec(`${tag}: five cards rendered`, u1.length === 5, u1.map((c) => c.id).join(","));
  for (const c of s1.integrations) {
    const u = u1.find((x) => x.id === c.id);
    rec(`${tag}: ${c.id} badge = server status (${c.status})`, !!u && u.status === c.status && u.badge === c.status && u.enabled === c.enabled, u ? `ui=${u.status}/${u.badge} enabled=${u.enabled}` : "missing");
    if (u && /Connected/.test(u.text)) rec(`${tag}: ${c.id} says "Connected" only when the server reports active`, c.status === "active", c.status);
  }
  const panelText = await page.evaluate(() => document.querySelector("[data-integrations-panel]").textContent);
  rec(`${tag}: no "Firebase" anywhere (push is Web Push + Expo)`, !/firebase/i.test(panelText));

  // 2a. a not-configured integration's switch is disabled and says why.
  const epic = u1.find((c) => c.id === "epic-fhir");
  const epicServer = s1.integrations.find((c) => c.id === "epic-fhir");
  if (epicServer && !epicServer.canEnable && !epicServer.enabled) {
    rec(`${tag}: Epic (not set up) switch is disabled with a reason`, epic.switchDisabled && /unlocks once/.test(epic.text), epic.text.slice(0, 80));
  }

  // 2b. push switch round-trips through the server.
  const push0 = s1.integrations.find((c) => c.id === "push");
  if (push0 && push0.canEnable) {
    const sw = page.locator('[data-integration="push"] [data-int-switch]');
    if (!push0.enabled) { await sw.click(); await page.waitForSelector('[data-integration="push"][data-enabled="1"]', { timeout: 10000 }); }
    await sw.click();
    await page.waitForSelector('[data-integration="push"][data-enabled="0"]', { timeout: 10000 }).catch(() => {});
    const mOff = JSON.parse((await api("GET", "/api/modules")).text).modules["integration.push"];
    const uOff = (await ui()).find((c) => c.id === "push");
    rec(`${tag}: switching push OFF flips the server module`, mOff === false && uOff.status === "off" && !uOff.enabled, `module=${mOff} ui=${uOff.status}`);
    await sw.click();
    await page.waitForSelector('[data-integration="push"][data-enabled="1"]', { timeout: 10000 }).catch(() => {});
    const mOn = JSON.parse((await api("GET", "/api/modules")).text).modules["integration.push"];
    const sOn = (await server()).integrations.find((c) => c.id === "push");
    const uOn = (await ui()).find((c) => c.id === "push");
    rec(`${tag}: switching push back ON restores it (server + UI agree)`, mOn === true && uOn.enabled && uOn.status === sOn.status, `module=${mOn} ui=${uOn.status} server=${sOn.status}`);

    // 3. real test result.
    await page.locator('[data-integration="push"] [data-int-test]').click();
    await page.waitForSelector('[data-integration="push"] [data-int-result]', { timeout: 15000 }).catch(() => {});
    const res = await page.evaluate(() => { const el = document.querySelector('[data-integration="push"] [data-int-result]'); return el ? { kind: el.getAttribute("data-int-result"), text: el.textContent } : null; });
    rec(`${tag}: push "Test connection" shows the server's result`, !!res && /Test (passed|failed)/.test(res.text), res ? res.kind + ": " + res.text.slice(0, 90) : "no result");
  } else {
    rec(`${tag}: push is configured on this server (needed for the switch round-trip)`, false, push0 ? push0.statusText : "no push card");
  }

  // 5a. panel layout.
  const layout = async (scopeSel) => page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const vw = window.innerWidth;
    const ctl = root ? [...root.querySelectorAll("button, input, textarea, select")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) : [];
    const small = ctl.filter((el) => el.getBoundingClientRect().height < 44 - 0.5).map((el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30) + "=" + Math.round(el.getBoundingClientRect().height));
    const fonts = ctl.filter((el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)).filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.name || el.placeholder || el.tagName);
    const outside = ctl.filter((el) => { const r = el.getBoundingClientRect(); return r.left < -0.5 || r.right > vw + 0.5; }).map((el) => (el.textContent || el.tagName).trim().slice(0, 20));
    return { vw, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, count: ctl.length, small, fonts, outside };
  }, scopeSel);
  const L1 = await layout("[data-integrations-panel]");
  rec(`${tag}: no horizontal overflow with the panel`, L1.doc <= L1.vw && L1.body <= L1.vw, `doc=${L1.doc} body=${L1.body} vw=${L1.vw}`);
  rec(`${tag}: every panel control ≥ 44px tall (${L1.count})`, L1.small.length === 0, L1.small.join(", "));
  rec(`${tag}: every panel control inside the viewport`, L1.outside.length === 0, L1.outside.join(", "));

  // 4. write-only Amion credentials through the sheet.
  await page.locator('[data-integration="amion"] [data-int-setup]').click();
  await page.waitForSelector('[data-int-sheet="amion"]', { timeout: 10000 });
  const L2 = await layout('[data-int-sheet="amion"]');
  rec(`${tag}: no horizontal overflow with the Set up sheet open`, L2.doc <= L2.vw && L2.body <= L2.vw, `doc=${L2.doc} vw=${L2.vw}`);
  rec(`${tag}: sheet controls ≥ 44px tall (${L2.count})`, L2.small.length === 0, L2.small.join(", "));
  rec(`${tag}: sheet inputs ≥ 16px (no iOS zoom)`, L2.fonts.length === 0, L2.fonts.join(", "));
  rec(`${tag}: sheet controls inside the viewport`, L2.outside.length === 0, L2.outside.join(", "));
  const storageOn = (await server()).credentialStorage.available;
  if (storageOn) {
    await page.locator('[data-int-sheet="amion"] input').first().fill(`https://www.amion.com/cgi-bin/ocs?Lo=${SECRET}`);
    await page.locator('[data-int-sheet="amion"] [data-int-save]').click();
    await page.waitForSelector('[data-int-sheet="amion"] [data-int-current]', { timeout: 10000 }).catch(() => {});
    const cur = await page.evaluate(() => { const el = document.querySelector('[data-int-sheet="amion"] [data-int-current]'); return el ? el.textContent : ""; });
    const html = await page.content();
    const apiBody = (await api("GET", "/api/integrations")).text;
    const inputVals = await page.evaluate(() => [...document.querySelectorAll('[data-int-sheet="amion"] input')].map((i) => i.value).join("|"));
    rec(`${tag}: saved credentials show only "Saved · updated by …" + host`, /Saved/.test(cur) && /Dana Director/.test(cur) && /www\.amion\.com/.test(cur), cur.slice(0, 120));
    rec(`${tag}: the saved secret is in neither the page nor any API response`, !html.includes(SECRET) && !apiBody.includes(SECRET) && !inputVals.includes(SECRET));
    const amionNow = JSON.parse(apiBody).integrations.find((c) => c.id === "amion");
    const amionUi = (await ui()).find((c) => c.id === "amion");
    rec(`${tag}: Amion card follows the server after saving`, amionUi.status === amionNow.status && amionNow.configSource === "organization", `ui=${amionUi.status} server=${amionNow.status}`);
    await page.locator('[data-int-sheet="amion"] [data-int-clear]').click();
    await page.waitForFunction(() => !document.querySelector('[data-int-sheet="amion"] [data-int-current]'), null, { timeout: 10000 }).catch(() => {});
    const after = JSON.parse((await api("GET", "/api/integrations")).text).integrations.find((c) => c.id === "amion");
    rec(`${tag}: Remove clears them on the server`, !after.setup.current, JSON.stringify(after.setup.current));
  } else {
    rec(`${tag}: credential storage is available on this server (set INTEGRATION_KEY)`, false);
  }
  await page.locator('[data-int-sheet="amion"] [data-int-close]').click();

  // 6. CSP + page errors.
  rec(`${tag}: zero CSP violations`, csp.length === 0, csp.slice(0, 2).join(" | "));
  rec(`${tag}: zero page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// 7. Developer console: Enterprise defaults → Integrations is the same server
//    truth across every org; Organization config → Integrations shows one
//    org's real cards. (390 px only — the layout rules are the same.)
{
  const tag = "developer 390px";
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const csp = [];
  const errors = [];
  page.on("console", (m) => { if (/Content.Security.Policy|Refused to|violates the following/i.test(m.text())) csp.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const inputs = await page.locator("input").all();
  await inputs[0].fill("DOCTURN");
  await inputs[1].fill("dev");
  await inputs[2].fill(process.env.DEV_PASSWORD || "docturn");
  await page.locator('button:has-text("Sign in")').last().click();
  const signedIn = await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role === "developer"); }, null, { timeout: 20000 }).then(() => true).catch(() => false);
  rec(`${tag}: signed in as the platform operator`, signedIn);
  if (signedIn) {
    await sleep(800);
    await page.evaluate(() => window.DT.actions.setNav("enterprise"));
    await page.locator('main button:has-text("Integrations")').first().click();
    await page.waitForSelector("[data-integrations-overview] [data-overview-row]", { timeout: 20000 }).catch(() => {});
    const overview = JSON.parse(await page.evaluate(() => fetch("/api/dev/integrations", { credentials: "include" }).then((r) => r.text())));
    const rows = await page.evaluate(() => [...document.querySelectorAll("[data-overview-row]")].map((el) => ({ key: el.getAttribute("data-overview-row"), status: el.getAttribute("data-status") })));
    let mismatches = 0;
    for (const o of overview.orgs) for (const id of Object.keys(o.statuses)) {
      const r = rows.find((x) => x.key === o.code + ":" + id);
      if (!r || r.status !== o.statuses[id]) mismatches++;
    }
    rec(`${tag}: overview shows every org × integration exactly as the server reports`, rows.length === overview.orgs.length * overview.integrations.length && mismatches === 0, `${rows.length} rows, ${mismatches} mismatches`);
    const o1 = await page.evaluate(() => ({ vw: window.innerWidth, doc: document.documentElement.scrollWidth }));
    rec(`${tag}: no horizontal overflow on the overview`, o1.doc <= o1.vw, `doc=${o1.doc} vw=${o1.vw}`);
    // One org's real cards from Organization config.
    await page.evaluate(() => { const s = window.DT.getState(); const o = (s.orgs || []).find((x) => x.code === "ISPN"); if (o && window.DT.actions.selectOrg) window.DT.actions.selectOrg(o.code); window.DT.actions.setNav("settings"); });
    await sleep(600);
    await page.locator('main button:has-text("Integrations")').first().click();
    const gotCards = await page.waitForSelector("[data-integrations-panel] [data-integration]", { timeout: 20000 }).then(() => true).catch(() => false);
    if (gotCards) {
      const orgId = await page.evaluate(() => Number(document.querySelector("[data-integrations-panel]").getAttribute("data-integrations-panel")));
      const srv = JSON.parse(await page.evaluate((id) => fetch("/api/integrations?orgId=" + id, { credentials: "include" }).then((r) => r.text()), orgId));
      const uiCards = await page.evaluate(() => [...document.querySelectorAll("[data-integrations-panel] [data-integration]")].map((el) => ({ id: el.getAttribute("data-integration"), status: el.getAttribute("data-status") })));
      const same = srv.integrations.every((c) => (uiCards.find((u) => u.id === c.id) || {}).status === c.status);
      rec(`${tag}: Organization config → Integrations shows org #${orgId}'s server statuses`, same && uiCards.length === 5, uiCards.map((u) => u.id + "=" + u.status).join(" "));
      const o2 = await page.evaluate(() => ({ vw: window.innerWidth, doc: document.documentElement.scrollWidth }));
      rec(`${tag}: no horizontal overflow on Organization config → Integrations`, o2.doc <= o2.vw, `doc=${o2.doc} vw=${o2.vw}`);
    } else {
      rec(`${tag}: Organization config → Integrations renders cards`, false);
    }
  }
  rec(`${tag}: zero CSP violations`, csp.length === 0, csp.slice(0, 2).join(" | "));
  rec(`${tag}: zero page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
