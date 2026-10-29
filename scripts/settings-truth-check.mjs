/**
 * Settings screen truthfulness, measured in REAL Chromium on an emulated
 * iPhone. Each block re-runs a verifier reproduction against the fixed client:
 *
 *   A. ER director: the STAT SMS fallback switch and the assignment timeout are
 *      read-only (the server refuses their writes) — clicking never flips the
 *      switch on screen; Integrations cards are read-only with a reason.
 *   B. Director (fresh storage): the header names the signed-in org as the
 *      SERVER knows it (GET /api/org/config), not the demo store's "Mayo",
 *      and is plain text, not click-to-edit.
 *   C. Schedule sync: a vendor DocTurn has no connector for (QGenda) is NOT a
 *      choice — the picker offers only the server's Amion / Epic / Manual
 *      (A.CON schedule #2) and names the rest as information; no form, no
 *      "Connected", no request; no pre-filled schedule login anywhere.
 *   D. With a real Amion feed connected + synced: the badge says
 *      "Connected · Feed", and the header's Sync now sits inside the viewport
 *      at 375 / 390 / 430.
 *   E. Assignment timeout: an out-of-range entry snaps back to the server's value.
 *   F. Set up sheet: a present-but-rejected env value (AI_EXTERNAL_PHI_OK="<true>")
 *      is flagged "invalid", never ticked; Amion saved with only the OCS URL
 *      marks only that field "saved".
 *   G. Developer overview: after a failed Twilio test the platform badge is
 *      "Error", never "Active".
 *
 * Needs a seeded synthetic server with: INTEGRATION_KEY, RATE_LIMIT=off,
 * TWILIO_* set and answering 401 (preload), OPENAI_API_KEY + AI_EXTERNAL_PHI_OK="<true>",
 * AMION_OCS_URL (a reachable feed) + AMION_ORG_CODE=ISPN.
 *   BASE_URL=http://127.0.0.1:7300 node scripts/settings-truth-check.mjs
 */
import { createHash } from "node:crypto";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const SIZES = { 375: 667, 390: 844, 430: 932 };
const results = [];
const rec = (name, ok, note = "") => { results.push([name, ok]); console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  ↳ " + note : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (t) => createHash("sha256").update(t).digest("hex");
// SHA-256 of the username and schedule key once hard-coded in ScheduleSync.jsx
// (removed; the credential must be rotated with Amion). Hashes, never the values.
const OLD_LOGIN_SHA256 = new Set([
  "068bd8e81bdd1b56e73721ebb6a3b9f62d1fe5ea4f4daf05d09e4852fcad1d24",
  "e559dccc7d0e4889cc136065a2c0703038cb579b21f68bdabce005d01e172709",
]);
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

async function open(width, org, username) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const errors = [];
  const apiLog = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) apiLog.push(r.method() + " " + u.pathname); });
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle" });
  const inputs = await page.locator("input").all();
  await inputs[0].fill(org);
  await inputs[1].fill(username);
  await inputs[2].fill(process.env.DEV_PASSWORD || "docturn");
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 20000 });
  await sleep(1000);
  const api = (method, path, body) => page.evaluate(([m, p, b]) => fetch(p, { method: m, credentials: "include", headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })), [method, path, body]);
  return { ctx, page, errors, apiLog, api };
}
async function toSettings(page) {
  await page.evaluate(() => window.DT.actions.setNav("settings"));
  await page.waitForSelector("[data-integrations-panel] [data-integration]", { timeout: 20000 });
  await page.waitForSelector("[data-schedule-sync]", { timeout: 20000 });
  await sleep(800);
}

// ── A. ER director: read-only org settings + read-only integrations ─────────
{
  const { ctx, page, errors, api } = await open(390, "ISPN", "er.director");
  await toSettings(page);
  const before = (await api("GET", "/api/settings")).json.org;
  const sw = page.locator('[role="switch"][aria-label="STAT SMS fallback"]');
  const ariaBefore = await sw.getAttribute("aria-checked");
  await sw.click({ force: true }).catch(() => {});
  await sleep(1200);
  const ariaAfter = await sw.getAttribute("aria-checked");
  const after = (await api("GET", "/api/settings")).json.org;
  rec("A: ER director — STAT SMS switch is disabled and does not flip", (await sw.isDisabled()) && ariaBefore === ariaAfter && after.statSmsFallback === before.statSmsFallback, `aria ${ariaBefore}→${ariaAfter} server ${before.statSmsFallback}→${after.statSmsFallback}`);
  rec("A: ER director — switch shows the server's value", String(before.statSmsFallback !== false) === ariaAfter, `server=${before.statSmsFallback} ui=${ariaAfter}`);
  const tz = page.locator('label:has-text("Assignment timeout") + div input');
  rec("A: ER director — timeout field is read-only and shows the server's value", (await tz.isDisabled()) && (await tz.inputValue()) === String(before.assignmentTimeoutMin), `ui=${await tz.inputValue()} server=${before.assignmentTimeoutMin}`);
  const notes = await page.locator("[data-readonly-note]").count();
  rec("A: ER director — 'Only a director can change this' is shown", notes >= 2, `${notes} notes`);
  const cards = await page.evaluate(() => [...document.querySelectorAll("[data-integrations-panel] [data-integration]")].map((el) => ({
    id: el.getAttribute("data-integration"),
    sw: (el.querySelector("[data-int-switch]") || {}).disabled,
    test: (el.querySelector("[data-int-test]") || {}).disabled,
    setup: (el.querySelector("[data-int-setup]") || {}).disabled,
    ro: !!el.querySelector("[data-int-readonly]"),
  })));
  rec("A: ER director — every integration card is read-only (switch, Test, Set up disabled + note)", cards.length === 5 && cards.every((c) => c.sw && c.test && c.setup && c.ro), JSON.stringify(cards.filter((c) => !(c.sw && c.test && c.setup && c.ro))));
  const ssSelect = page.locator("#ss-source");
  rec("A: ER director — schedule source picker is read-only", await ssSelect.isDisabled());
  rec("A: zero page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ── B, C, E, F: director at 390 ─────────────────────────────────────────────
{
  const { ctx, page, errors, apiLog, api } = await open(390, "ISPN", "director");
  await toSettings(page);
  const cfg = (await api("GET", "/api/org/config")).json;
  const header = await page.evaluate(() => { const el = document.querySelector("[data-org-header]"); return el ? { code: el.getAttribute("data-org-header"), text: el.textContent, editable: !!el.querySelector("[contenteditable], input, button") } : null; });
  rec("B: header names the signed-in org as the server reports it", !!header && header.code === "ISPN" && header.text.includes(cfg.name) && header.text.includes(cfg.timezone) && !/Mayo/.test(header.text), header ? header.text.slice(0, 120) : "no header");
  rec("B: header is not click-to-edit for a director", !!header && !header.editable);
  const panelOrg = await page.evaluate(() => (document.querySelector("[data-integrations-panel]").textContent.match(/active for (.+?)Each card/) || [])[1] || "");
  rec("B: Integrations panel and header name the same org", panelOrg.trim() === cfg.name, `panel="${panelOrg.trim()}" server="${cfg.name}"`);

  // C. QGenda: not a choice (A.CON schedule #2); named as information only;
  // no form, no request, no pre-filled login.
  const before = apiLog.length;
  await sleep(600);
  const ss = await page.evaluate(() => { const el = document.querySelector("[data-schedule-sync]"); const sel = document.querySelector("#ss-source"); return { key: el.getAttribute("data-schedule-sync"), options: sel ? [...sel.options].map((o) => o.value) : [], text: el.textContent, inputs: [...el.querySelectorAll("input, textarea")].length, connected: !!el.querySelector("[data-ss-connected]"), noConn: !!el.querySelector("[data-ss-no-connector]") }; });
  const srcNow = (await api("GET", "/api/oncall/sources")).json.selected;
  const newApi = apiLog.slice(before).filter((l) => !/\/api\/(modules|session|user|settings|org\/config|org\/shifts|integrations|oncall\/sources|amion\/status|patient-board|assignments|admissions|notifications|messaging|broadcasts|registrations|hospitalists|patients|compliance|audit|reports)/.test(l));
  rec("C: only the server's sources are choices (no QGenda); QGenda named as information; no form", JSON.stringify(ss.options) === JSON.stringify(["amion", "epic", "manual"]) && ss.key === srcNow && ss.noConn && /QGenda/.test(ss.text) && ss.inputs === 0 && !/Sign in & capture|Test & connect|Upload & parse|Fetch & parse/.test(ss.text), ss.options.join(",") + " key=" + ss.key + " server=" + srcNow);
  rec("C: reading the schedule panel sends nothing to the server", newApi.length === 0, newApi.join(", "));
  // The page AND every script it loaded: no token is the old hard-coded
  // schedule login. Matched by SHA-256 only, so this file never carries it.
  const served = await page.evaluate(async () => {
    const out = [document.documentElement.outerHTML];
    for (const el of document.querySelectorAll("script[src]")) {
      try { out.push(await (await fetch(el.src, { credentials: "include" })).text()); } catch (e) { /* unreachable script: nothing served */ }
    }
    return out;
  });
  const leaked = served.some((text) => text.split(/[^A-Za-z0-9.!_-]+/).some((tok) => tok.length >= 6 && tok.length <= 40 && OLD_LOGIN_SHA256.has(sha256(tok))));
  rec("C: no pre-filled schedule login in the page or its scripts", !leaked, `${served.length} documents scanned`);
  const board = (await api("GET", "/api/oncall/sources")).json;
  const LABEL = { amion: "Amion", epic: "Epic (FHIR)", manual: "Manual list" };
  rec("C: the board's real source is shown and unchanged", ss.text.includes("The on-call board reads " + LABEL[board.selected]) && ss.key === board.selected, `server=${board.selected}`);

  // E. Timeout out of range → snaps back to the server's value.
  const tz = page.locator('label:has-text("Assignment timeout") + div input');
  const server0 = (await api("GET", "/api/org/config")).json.assignmentTimeoutMin;
  await tz.fill("0");
  await page.waitForFunction(() => { const t = window.DT.getState().__toast; return t && t.title === "Timeout not saved"; }, null, { timeout: 5000 }).catch(() => {});
  await sleep(300);
  rec("E: out-of-range timeout returns to the server's value", (await tz.inputValue()) === String(server0), `ui=${await tz.inputValue()} server=${server0}`);

  // F. Set up sheet: AI_EXTERNAL_PHI_OK="<true>" is "invalid", not ticked.
  await page.locator('[data-integration="openai-intake"] [data-int-setup]').click();
  await page.waitForSelector('[data-int-sheet="openai-intake"]', { timeout: 10000 });
  const phi = await page.evaluate(() => { const el = document.querySelector('[data-int-sheet="openai-intake"] [data-int-var="AI_EXTERNAL_PHI_OK"]'); return el ? { state: el.getAttribute("data-state"), text: el.textContent } : null; });
  const srvPhi = (await api("GET", "/api/integrations")).json.integrations.find((c) => c.id === "openai-intake").setup.variables.find((v) => v.name === "AI_EXTERNAL_PHI_OK");
  rec("F: a present-but-rejected value is flagged, never ticked", !!phi && phi.state === "invalid" && /not accepted/.test(phi.text) && srvPhi.state === "invalid", phi ? phi.state + " · " + phi.text.slice(0, 60) : "missing");
  await page.locator('[data-int-sheet="openai-intake"] [data-int-close]').click();
  // Amion saved with ONLY the OCS URL → only that field says "saved".
  await page.locator('[data-integration="amion"] [data-int-setup]').click();
  await page.waitForSelector('[data-int-sheet="amion"]', { timeout: 10000 });
  await page.locator('[data-int-sheet="amion"] input').first().fill("https://www.amion.com/cgi-bin/ocs?Lo=PW-ONLY-URL");
  await page.locator('[data-int-sheet="amion"] [data-int-save]').click();
  await page.waitForSelector('[data-int-sheet="amion"] [data-int-current]', { timeout: 10000 }).catch(() => {});
  const ph = await page.evaluate(() => [...document.querySelectorAll('[data-int-sheet="amion"] input')].map((i) => i.placeholder));
  rec("F: only the saved Amion field says 'saved'", ph.length === 2 && /saved/.test(ph[0]) && !/saved/.test(ph[1]), ph.join(" | "));
  await page.locator('[data-int-sheet="amion"] [data-int-clear]').click();
  await page.waitForFunction(() => !document.querySelector('[data-int-sheet="amion"] [data-int-current]'), null, { timeout: 10000 }).catch(() => {});
  await page.locator('[data-int-sheet="amion"] [data-int-close]').click();
  rec("B–F: zero page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ── D. Real Amion feed connected + synced: header at 375 / 390 / 430 ────────
for (const w of [375, 390, 430]) {
  const { ctx, page, errors, api } = await open(w, "ISPN", "director");
  if (w === 375) {
    await api("PATCH", "/api/oncall/source", { source: "amion" });
    const s = await api("POST", "/api/amion/sync-now", {});
    rec("D: env Amion feed synced (setup)", s.status === 200 && s.json.lastStatus === "ok" && s.json.rowCount > 0, `status=${s.status} rows=${s.json && s.json.rowCount}`);
  }
  await toSettings(page);
  await page.waitForSelector("[data-amion-grid]", { timeout: 10000 }).catch(() => {});
  const m = await page.evaluate(() => {
    const root = document.querySelector("[data-schedule-sync]");
    const btn = [...root.querySelectorAll("[data-ss-header] button")].find((b) => /Sync now|Syncing/.test(b.textContent));
    if (btn) btn.scrollIntoView({ block: "center" }); // vertical scroll only; horizontal clipping still fails
    const r = btn ? btn.getBoundingClientRect() : null;
    const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    const badge = root.querySelector("[data-ss-connected]");
    return { vw: window.innerWidth, doc: document.documentElement.scrollWidth, btn: r ? { left: Math.round(r.left), right: Math.round(r.right) } : null, hit: !!(hit && btn && btn.contains(hit)), badge: badge ? badge.textContent : null, grid: !!root.querySelector("[data-amion-grid]"), banner: (root.querySelector("[data-amion-banner]") || {}).textContent || "" };
  });
  rec(`D ${w}px: badge says "Connected · Feed" (not Capture)`, m.badge === "Connected · Feed", String(m.badge));
  rec(`D ${w}px: Sync now is inside the viewport and tappable`, !!m.btn && m.btn.left >= 0 && m.btn.right <= m.vw && m.hit, JSON.stringify(m.btn) + " vw=" + m.vw);
  rec(`D ${w}px: no horizontal overflow; live grid + banner shown`, m.doc <= m.vw && m.grid && /Live Amion feed/.test(m.banner), `doc=${m.doc} vw=${m.vw} banner=${m.banner.slice(0, 50)}`);
  // QGenda can't be picked at all while Amion is live (A.CON schedule #2).
  if (w === 390) {
    const q = await page.evaluate(() => [...document.querySelectorAll("#ss-source option")].map((o) => o.value));
    rec("D: no vendor without a connector is a choice while Amion is live", JSON.stringify(q) === JSON.stringify(["amion", "epic", "manual"]), q.join(","));
  }
  rec(`D ${w}px: zero page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ── G. Developer overview after a failed Twilio test ────────────────────────
{
  const d = await open(390, "ISPN", "director");
  const t = await d.api("POST", "/api/integrations/twilio-sms/test", {});
  rec("G: Twilio test fails (mock 401) — setup", t.status === 200 && t.json.ok === false, JSON.stringify(t.json && { ok: t.json.ok, code: t.json.code }));
  await d.ctx.close();
  const { ctx, page, errors, api } = await open(390, "DOCTURN", "dev");
  await page.evaluate(() => window.DT.actions.setNav("enterprise"));
  await page.locator('main button:has-text("Integrations")').first().click();
  await page.waitForSelector("[data-overview-platform]", { timeout: 20000 }).catch(() => {});
  const ov = (await api("GET", "/api/dev/integrations")).json;
  const ui = await page.evaluate(() => [...document.querySelectorAll("[data-overview-platform]")].map((el) => ({ id: el.getAttribute("data-overview-platform"), status: el.getAttribute("data-status"), badge: (el.querySelector("[data-int-badge]") || {}).getAttribute ? el.querySelector("[data-int-badge]").getAttribute("data-int-badge") : null })));
  const tw = ui.find((u) => u.id === "twilio-sms");
  const srv = ov.integrations.find((i) => i.id === "twilio-sms").platform;
  rec("G: platform badge = server platform.status ('error'), never 'active'", !!tw && tw.badge === "error" && srv.status === "error", JSON.stringify(tw) + " server=" + srv.status);
  rec("G: no platform header badge says Active", ui.every((u) => u.badge !== "active"), JSON.stringify(ui));
  rec("G: zero page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
