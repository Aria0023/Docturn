/**
 * Developer console truthfulness, measured in REAL Chromium on emulated
 * iPhones (375×667 / 390×844 / 430×932, DPR 3, touch, iPhone Safari UA).
 * Each block re-runs a finder reproduction of the developer-screen sweep
 * (A.CON developer #1–#24) against the fixed client and checks the SERVER's
 * answer, not the screen's claim:
 *
 *   F. First paint (#24): a MutationObserver from document start never sees a
 *      demo tenant or demo person; no notification bell, no demo notification
 *      (#23).
 *   T. Tiles (#15/#18): organizations / users / assignments-24h equal the
 *      server's list; "Server uptime" is the server's measured process uptime
 *      (never "99.98%").
 *   S. System health (#16): the card shows the server's numbers — the live
 *      WebSocket count follows a second browser connecting; no constant.
 *   A. AI monitor (#17): no insight before diagnostics; afterwards the server's.
 *   O. Organizations (#19): no Active / Suspended badge anywhere.
 *   C. Role colors (#20): labelled this browser's; a change sends nothing and
 *      another browser keeps the defaults.
 *   U. Add user (#1/#21): no developer scope choice; a developer is created in
 *      the platform org and listed under Developers; the server refuses a
 *      developer inside a tenant; a hospitalist is created with the typed
 *      username (there is no e-mail field).
 *   N. New tenant (#22): the time zone is labelled as this browser's; nothing
 *      "auto-detected"; the server stores no invented city.
 *   P. Platform (#2/#4/#5/#7–#11/#13): none of the removed mock controls.
 *   K. Compliance (#12/#14): every row is a server row; the count tiles are
 *      the server's true totals (> 100 when the trail is longer than a page).
 *   R. Org rules (#6): an invalid timeout is refused and the screen shows the
 *      server's value again, also after a reload; a valid one persists.
 *   X. "Sign out all" (#3) ends another browser's session; the operator stays.
 *   L. Layout: no horizontal overflow, controls ≥ 44×44, inputs ≥ 16 px.
 *   Z. Zero CSP violations and zero page errors.
 *   Q. (REAL_BASE_URL) a SYNTHETIC_DATA=false server: F, T, S, A, P again.
 *
 *   BASE_URL=http://127.0.0.1:8300 [REAL_BASE_URL=http://127.0.0.1:8301 REAL_DEV_PASSWORD=…] \
 *     node scripts/developer-truth-check.mjs
 * Needs a seeded synthetic server with RATE_LIMIT=off. Exits non-zero on failure.
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
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const csp = [];
const pageErrors = [];
const DEMO = /Mayo General|St\. Jude Medical|Cleveland Care|Pinecrest|Lena Ortiz|Karen Vance|Priya Shah|Ruth Osei|Paul Okafor|Alex Kim|Sam Rivera|STJUDE|Code stroke — Bed 4|Accepting the 412/;
const RUN = Date.now().toString(36).slice(-5);
const REMOVED = [
  /Enforce two-factor/i, /Require 2FA for every account/i, /Single sign-on/i, /SAML/, /Auto-lock on background/i, /Session timeout/i,
  /Message retention/i, /Message recall/i, /Read receipts/i, /Minimum app version/i, /Force update/i, /Managed deployment/i, /\bMDM\b/,
  /Biometric unlock/i, /iOS app/, /Android app/, /View census/, /Message care team/, /Permissions/, /On-call providers only/i,
  /Active \(working\) only/i, /\bInherited\b/, /Enterprise defaults/i, /Clear logs/i, /Open incidents/i, /Remote sign-out queued/i,
];

async function open(base, width, org, username, password = PW, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA, timezoneId: opts.tz || "America/Chicago" });
  const page = await ctx.newPage();
  const apiLog = [];
  page.on("pageerror", (e) => pageErrors.push(username + "@" + width + ": " + String((e && e.message) || e)));
  page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(username + ": " + t.slice(0, 160)); });
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) apiLog.push({ m: r.method(), p: u.pathname, body: r.postData() }); });
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.log("Refused to load (CSP) " + e.violatedDirective + " " + e.blockedURI)); });
  // First-paint watcher (#24): every text the document ever shows, from the
  // first mutation on, timestamped.
  await page.addInitScript((src) => {
    const re = new RegExp(src);
    window.__demoSeen = [];
    const scan = () => { const t = document.body ? document.body.innerText : ""; const m = re.exec(t); if (m) window.__demoSeen.push(Math.round(performance.now()) + "ms " + m[0]); };
    new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true });
  }, DEMO.source);
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle" });
  const inputs = await page.locator("input").all();
  await inputs[0].fill(org);
  await inputs[1].fill(username);
  await inputs[2].fill(password);
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 20000 });
  await sleep(opts.settle == null ? 1500 : opts.settle);
  const api = (method, path, body) => page.evaluate(([m, p, b]) => fetch(p, { method: m, credentials: "include", headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })), [method, path, body]);
  return { ctx, page, apiLog, api };
}
const nav = async (page, id, settle = 900) => { await page.evaluate((n) => window.DT.actions.setNav(n), id); await sleep(settle); };
const mainText = (page) => page.evaluate(() => document.querySelector("main").innerText);
const writes = (log, from = 0) => log.slice(from).filter((r) => r.m !== "GET");
const toast = (page) => page.evaluate(() => { const t = document.querySelector("[data-toast]"); return t ? t.textContent : ""; });
const tiles = (page) => page.$$eval("[data-tile]", (els) => Object.fromEntries(els.map((e) => [e.getAttribute("data-tile"), (e.querySelector("div[style*='font-size: 28px']") || {}).textContent || ""])));
function fmtUptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return d + "d " + h + "h"; if (h) return h + "h " + m + "m"; if (m) return m + "m"; return Math.floor(sec) + "s";
}

async function layout(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const out = { overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw, small: [], tinyInputs: [], offscreen: [] };
    const roots = [document.querySelector("main"), ...document.querySelectorAll("[role=dialog]")].filter(Boolean);
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    for (const root of roots) for (const el of root.querySelectorAll('button, [role="button"], select, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"])')) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).trim().slice(0, 30);
      const isInput = el.tagName === "INPUT" || el.tagName === "SELECT";
      if (r.height < 43.5 || (!isInput && r.width < 43.5)) out.small.push(label + " " + Math.round(r.width) + "x" + Math.round(r.height));
      if (isInput && parseFloat(getComputedStyle(el).fontSize) < 16) out.tinyInputs.push(label);
      let p = el.parentElement, scroller = false;
      while (p && p !== root) { const cs = getComputedStyle(p); if (cs.overflowX === "auto" || cs.overflowX === "scroll") { scroller = true; break; } p = p.parentElement; }
      if (!scroller && r.right > vw + 0.5) out.offscreen.push(label + " right=" + Math.round(r.right));
    }
    return out;
  });
}
async function checkLayout(page, label) {
  const m = await layout(page);
  rec(`L: ${label} — no horizontal overflow`, m.overflow <= 0, "overflow=" + m.overflow + "px");
  rec(`L: ${label} — every control ≥ 44×44`, m.small.length === 0, m.small.slice(0, 6).join(" | "));
  rec(`L: ${label} — text inputs ≥ 16px`, m.tinyInputs.length === 0, m.tinyInputs.slice(0, 4).join(" | "));
  rec(`L: ${label} — nothing past the right edge`, m.offscreen.length === 0, m.offscreen.slice(0, 4).join(" | "));
}

async function serverTotals(api) {
  const orgs = (await api("GET", "/api/dev/organizations")).json;
  const tenants = orgs.filter((o) => o.code !== "DOCTURN");
  return { orgs, tenants, users: tenants.reduce((a, o) => a + o.userCount, 0), assign: tenants.reduce((a, o) => a + o.assignments24h, 0), platform: orgs.find((o) => o.code === "DOCTURN") };
}

// Dashboard truths shared by the synthetic and the real server.
async function dashboardTruths(tag, dev) {
  const { page, api } = dev;
  const seen = await page.evaluate(() => window.__demoSeen);
  rec(`F${tag}: no demo tenant or person ever painted (MutationObserver from document start)`, seen.length === 0, seen.slice(0, 3).join(" | "));
  const bell = await page.locator("button[aria-label^='Notifications'], button[title='Notifications']").count();
  const notes = await page.evaluate(() => window.DT.getState().notifications.length);
  rec(`F${tag}: no notification bell and no demo notifications (#23)`, bell === 0 && notes === 0, `bell=${bell} notifications=${notes}`);
  await page.waitForFunction(() => !!document.querySelector("[data-org-row]") || /No organizations yet/.test(document.body.innerText), null, { timeout: 15000 });
  await page.waitForFunction(() => { const h = window.DT.getState().platformHealth; return !!h; }, null, { timeout: 15000 });
  await sleep(300);
  const t = await tiles(page);
  const srv = await serverTotals(api);
  rec(`T${tag}: Organizations tile = server tenants (${srv.tenants.length})`, Number(t["Organizations"]) === srv.tenants.length, JSON.stringify(t));
  rec(`T${tag}: Total users tile = server user counts (${srv.users})`, Number(t["Total users"]) === srv.users, t["Total users"]);
  rec(`T${tag}: Assignments / 24h tile = server's 24 h count (${srv.assign}) (#18)`, Number(t["Assignments / 24h"]) === srv.assign, t["Assignments / 24h"]);
  const tileSec = Number(await page.locator("[data-uptime-sec]").getAttribute("data-uptime-sec").catch(() => "NaN"));
  const health = (await api("GET", "/api/dev/platform-health")).json;
  const up = t["Server uptime"];
  // The tile ticks from the server's figure; it must agree with a fresh
  // reading to within a couple of seconds (the two reads are not simultaneous).
  rec(`T${tag}: Server uptime tile is the server's measured uptime, not "99.98%" (#15)`, !/99\.98|%/.test(up) && Math.abs(tileSec - health.instance.uptimeSec) <= 3 && up === fmtUptime(tileSec) && !/Uptime \(30d\)/.test(await mainText(page)), up + " (" + tileSec + "s) vs server " + health.instance.uptimeSec + "s");
  const txt = await mainText(page);
  rec(`S${tag}: no constant health figures (1284, 142/500, 36/50) (#16)`, !/1284|142\/500|36\/50/.test(txt));
  const status = await page.locator("[data-health-status]").innerText();
  rec(`S${tag}: status badge = server status (${health.status})`, status.toLowerCase().includes(health.status), status);
  const dbv = await page.locator("[data-health='db'] [data-health-value]").innerText();
  rec(`S${tag}: database row names the server's store`, /PGlite|PostgreSQL/.test(dbv) && /ms/.test(dbv), dbv);
  const ai = await page.locator("[data-ai-monitor]").innerText();
  rec(`A${tag}: no fabricated insight before diagnostics (#17)`, !/STJUDE|Twilio|Insight:|expiry rate/.test(ai) && /Not checked yet/.test(ai), ai.slice(0, 80));
  const badges = await page.$$eval("[data-org-row]", (els) => els.map((e) => e.innerText).join(" | "));
  rec(`O${tag}: no Active / Suspended tenant badge (#19)`, !/\bActive\b|Suspended/.test(badges) && !/Suspended/.test(txt), badges.slice(0, 120));
  return { srv, health };
}

// ── Synthetic server ────────────────────────────────────────────────────────
let platformId = null;
for (const width of [375, 390, 430]) {
  const dev = await open(BASE, width, "DOCTURN", "dev");
  const { page, api, apiLog } = dev;
  const { srv } = await dashboardTruths("@" + width, dev);
  platformId = srv.platform.id;
  await checkLayout(page, `dashboard @${width}`);

  if (width === 390) {
    // S: the live socket count follows a second browser.
    const before = Number((await page.locator("[data-health='ws'] [data-health-value]").innerText()).split(" ")[0]);
    const srvBefore = (await api("GET", "/api/dev/platform-health")).json.websocket.connections;
    rec("S: WebSocket count shown = the server's", before === srvBefore, `ui=${before} server=${srvBefore}`);
    const other = await open(BASE, 390, "ISPN", "director");
    await sleep(1500);
    await page.locator("button").filter({ hasText: /^Refresh$/ }).click();
    await sleep(1200);
    const after = Number((await page.locator("[data-health='ws'] [data-health-value]").innerText()).split(" ")[0]);
    const srvAfter = (await api("GET", "/api/dev/platform-health")).json.websocket.connections;
    rec("S: a second browser connecting raises the count, as the server reports", after === srvAfter && after > before, `before=${before} after=${after} server=${srvAfter}`);
    await other.ctx.close();

    // A: diagnostics answer from the server.
    await page.locator("button").filter({ hasText: /Run AI diagnostics/ }).click();
    await sleep(1500);
    const ai = await page.locator("[data-ai-monitor]").innerText();
    rec("A: after Run AI diagnostics the server's extractor answer is shown", /Last check/.test(ai) && /Extractor/.test(ai) && !/STJUDE/.test(ai), ai.slice(0, 100));

    // C: role colors are this browser's.
    const scope = await page.locator("[data-role-colors-scope]").innerText();
    rec("C: role colors say they are this browser's only (#20)", /this browser only/.test(scope), scope);
    const n0 = apiLog.length;
    await page.locator("button").filter({ hasText: /^Hospitalist$/ }).first().click();
    await page.locator("button[aria-label='Use #C25A6B for Hospitalist']").click();
    await sleep(800);
    const c = await page.evaluate(() => window.DT.getState().roleColors.hospitalist);
    rec("C: the change applies here and sends nothing to the server", c === "#C25A6B" && writes(apiLog, n0).length === 0, `color=${c} writes=${JSON.stringify(writes(apiLog, n0))}`);
    const second = await open(BASE, 390, "DOCTURN", "dev");
    const c2 = await second.page.evaluate(() => window.DT.getState().roleColors.hospitalist);
    rec("C: another browser keeps the default color", c2 === "#4666C4", c2);
    await second.ctx.close();

    // U: Add user.
    await page.locator("button").filter({ hasText: /Add user \/ provider/ }).click();
    await sleep(400);
    const formText = await page.locator("[data-add-user-form]").innerText();
    rec("U: the form has a Username field and no Email field (#21)", (await page.getByLabel("Username").count()) === 1 && !/\bEmail\b/.test(formText), formText.slice(0, 120));
    await checkLayout(page, "Add user form @390");
    await page.locator("[data-add-user-form] button[aria-pressed]").filter({ hasText: /^Developer$/ }).click();
    await sleep(300);
    const devForm = await page.locator("[data-add-user-form]").innerText();
    rec("U: Developer offers no scope choice and says it is every organization (#1)", !/Local developer|Scoped to one organization|Root developer|Developer scope/.test(devForm) && /Full access to every organization/.test(devForm) && (await page.locator("[data-add-user-form] select").count()) === 0, devForm.slice(0, 160));
    await page.getByLabel("Full name").fill("Sweep Operator " + RUN);
    await page.getByLabel("Username").fill("ops." + RUN);
    const n1 = apiLog.length;
    await page.locator("[data-add-user-form] button").filter({ hasText: /Create developer/ }).click();
    await sleep(1800);
    const post = writes(apiLog, n1).find((r) => r.m === "POST" && r.p === "/api/dev/users");
    const body = post ? JSON.parse(post.body) : {};
    rec("U: POST /api/dev/users goes to the platform org, with no scope / e-mail", body.organizationId === platformId && body.role === "developer" && !("scope" in body) && !("email" in body) && body.username === "ops." + RUN, JSON.stringify(body));
    const users = (await api("GET", "/api/dev/users")).json;
    const made = users.find((u) => u.username === "ops." + RUN);
    rec("U: the server lists the new developer in DOCTURN", made && made.org === "DOCTURN" && made.role === "developer", JSON.stringify(made));
    await page.locator("button").filter({ hasText: /^Done$/ }).first().click().catch(() => {});
    await sleep(500);
    const devCard = await page.locator("[data-developers]").innerText().catch(() => "");
    rec("U: the new developer is listed under Developers (every organization)", devCard.includes("Sweep Operator " + RUN) && /Developer · all orgs/.test(devCard), devCard.slice(0, 120));
    const ispn = srv.tenants.find((o) => o.code === "ISPN");
    const refused = await api("POST", "/api/dev/users", { organizationId: ispn.id, role: "developer", displayName: "Sweep Local Dev", username: "sweep.localdev" + RUN });
    rec("U: the server refuses a developer inside a tenant (400 developer_platform_org_only)", refused.status === 400 && refused.json && refused.json.error === "developer_platform_org_only", JSON.stringify(refused));
    // Hospitalist with the typed username.
    await page.locator("button").filter({ hasText: /Add user \/ provider/ }).click().catch(() => {});
    await sleep(300);
    if (!(await page.locator("[data-add-user-form]").count())) { await page.locator("button").filter({ hasText: /Add user \/ provider/ }).click(); await sleep(300); }
    await page.locator("[data-add-user-form] button[aria-pressed]").filter({ hasText: /^Hospitalist$/ }).click();
    await page.locator("[data-add-user-form] select").first().selectOption("ISPN");
    await page.getByLabel("Full name").fill("Dr. Sweep " + RUN);
    await page.getByLabel("Username").fill("Dr.Sweep." + RUN);
    const n2 = apiLog.length;
    await page.locator("[data-add-user-form] button").filter({ hasText: /Create account/ }).click();
    await sleep(1800);
    const post2 = writes(apiLog, n2).find((r) => r.m === "POST" && r.p === "/api/dev/users");
    const body2 = post2 ? JSON.parse(post2.body) : {};
    rec("U: a hospitalist is created with the typed username (lower-cased), in the chosen tenant", body2.username === ("dr.sweep." + RUN) && body2.organizationId === ispn.id && !("email" in body2), JSON.stringify(body2));
    await page.locator("button").filter({ hasText: /^Done$/ }).first().click().catch(() => {});
    await sleep(400);

    // N: New tenant.
    await page.locator("button").filter({ hasText: /^New tenant$/ }).click();
    await sleep(500);
    const modal = await page.locator("[data-new-tenant]").innerText();
    rec("N: the modal claims no detected location; the time zone is labelled as this browser's (#22)", !/Auto-detected|Location/.test(modal) && /This browser's time zone/.test(modal) && /America\/Chicago/.test(await page.locator("[data-new-tenant] select").inputValue()), modal.slice(0, 160));
    await checkLayout(page, "New tenant modal @390");
    const code = ("SW" + RUN.replace(/[^a-z]/g, "").toUpperCase() + "XYZ").slice(0, 6);
    await page.getByLabel("Hospital name").fill("Sweep Loc " + RUN);
    await page.getByLabel("Short code").fill(code);
    const n3 = apiLog.length;
    await page.locator("[data-new-tenant] button").filter({ hasText: /Create tenant/ }).click();
    await sleep(1800);
    const post3 = writes(apiLog, n3).find((r) => r.m === "POST" && r.p === "/api/dev/organizations");
    const body3 = post3 ? JSON.parse(post3.body) : {};
    const created = (await api("GET", "/api/dev/organizations")).json.find((o) => o.code === code);
    rec("N: POST sends the shown time zone and no invented city; the server stores no city", body3.timezone === "America/Chicago" && !("city" in body3) && created && created.city == null, JSON.stringify(body3) + " → " + JSON.stringify(created && { city: created.city, tz: created.timezone }));
    const row = await page.locator(`[data-org-row='${code}']`).innerText().catch(() => "");
    rec("N: the new row shows the time zone it was created with", row.includes("America/Chicago"), row.slice(0, 80));
  }
  await dev.ctx.close();
}

// ── P / K / R: Platform and org configuration ─────────────────────────────
{
  const dev = await open(BASE, 390, "DOCTURN", "dev");
  const { page, api, apiLog } = dev;
  // A platform trail longer than one page (> 100 rows): 110 audited list reads.
  for (let i = 0; i < 110; i++) await api("GET", "/api/dev/organizations");
  await nav(page, "enterprise", 1200);
  const tabStrip = () => page.$$eval("main button[aria-pressed]", (els) => els.map((e) => e.textContent.trim()));
  const platformTabs = await tabStrip();
  rec("P: Platform has only Security / Integrations / Compliance (no Rules, Permissions, Platform & mobile) (#5/#7/#8–#11)", JSON.stringify(platformTabs) === JSON.stringify(["Security", "Integrations", "Compliance"]), platformTabs.join(","));
  let all = "";
  for (const tab of ["Security", "Integrations", "Compliance"]) {
    await page.locator("main button").filter({ hasText: new RegExp("^" + tab + "$") }).first().click();
    await sleep(tab === "Compliance" ? 2500 : 1200);
    all += "\n" + (await mainText(page));
    await checkLayout(page, `Platform → ${tab} @390`);
  }
  const hits = REMOVED.filter((re) => re.test(all)).map(String);
  rec("P: Platform shows none of the removed mock controls (2FA, SSO, session timeout, retention, mobile/MDM, permissions, rules, Clear logs, Open incidents)", hits.length === 0, hits.join(", "));
  // K: the platform trail.
  const server = (await api("GET", "/api/audit")).json;
  const shownIds = await page.$$eval("[data-audit-id]", (els) => els.map((e) => Number(e.getAttribute("data-audit-id"))));
  const serverIds = new Set(server.audit.map((r) => r.id));
  rec("K: every platform-trail row on screen is a server row (#12)", shownIds.length > 0 && shownIds.every((id) => serverIds.has(id)), `shown=${shownIds.length}`);
  const tileText = await page.locator("main").locator("div[style*='font-size: 28px']").first().innerText();
  const tile = Number(tileText);
  rec("K: platform 'Audit events' is the trail's true size (> 100, ≈ server count) — not a page length", tile > 100 && tile <= server.auditCount && server.auditCount - tile <= 5, `tile=${tile} server=${server.auditCount} page=${server.audit.length}`);
  rec("K: no locally fabricated row (no customize_role_color, no 10.2.7.40)", !/customize role color|10\.2\.7\.40/i.test(await mainText(page)));

  // K (#14): one tenant's trail beyond a page.
  const orgs = (await api("GET", "/api/dev/organizations")).json;
  const er = orgs.find((o) => o.code === "ER") || orgs.find((o) => o.code !== "DOCTURN");
  for (let i = 0; i < 110; i++) await api("GET", `/api/dev/organizations/${er.id}/settings`);
  await page.evaluate((code) => window.DT.actions.selectOrg(code), er.code);
  await nav(page, "settings", 1500);
  const orgTabs = await tabStrip();
  rec(`P: ${er.code} config has only Rules / Integrations / Compliance (no Permissions) (#7)`, JSON.stringify(orgTabs) === JSON.stringify(["Rules", "Integrations", "Compliance"]), orgTabs.join(","));
  const rulesText = await mainText(page);
  const ruleHits = REMOVED.filter((re) => re.test(rulesText)).map(String);
  rec(`P: ${er.code} Rules show none of the removed controls (no Inherited/Custom, On-call only, Active only) (#5/#6)`, ruleHits.length === 0 && !/\bCustom\b|Reset to platform/.test(rulesText), ruleHits.join(", "));
  await page.locator("main button").filter({ hasText: /^Compliance$/ }).first().click();
  await page.waitForFunction(() => /Showing the latest/.test(document.querySelector("main").innerText), null, { timeout: 15000 }).catch(() => {});
  await sleep(500);
  const orgTile = Number(await page.locator("main").locator("div[style*='font-size: 28px']").first().innerText());
  const overview = (await api("GET", "/api/dev/compliance-overview")).json.find((o) => o.id === er.id);
  rec(`K: ${er.code} 'Audit events' = the server's count (compliance-overview), > 100 (#14)`, orgTile === overview.auditCount && orgTile > 100, `tile=${orgTile} overview=${overview.auditCount}`);
  const orgAll = await mainText(page);
  rec(`K: ${er.code} compliance has no Open incidents / Clear logs (#13/#4)`, !/Open incidents|Clear logs/.test(orgAll));
  await checkLayout(page, `Org config → Compliance @390`);

  // R (#6): an invalid timeout is refused and the server's value comes back.
  await page.locator("main button").filter({ hasText: /^Rules$/ }).first().click();
  await sleep(800);
  const serverRule = async () => (await api("GET", `/api/dev/organizations/${er.id}/settings`)).json.org.assignmentTimeoutMin;
  const orig = await serverRule();
  const input = page.locator("input[aria-label='Assignment timeout in minutes']");
  const n0 = apiLog.length;
  await input.fill("0");
  await sleep(2000);
  const sent = writes(apiLog, n0).find((r) => r.p === `/api/dev/organizations/${er.id}`);
  rec("R: typing 0 sends 0 (not a silent 15) and the server refuses it (#6)", sent && JSON.parse(sent.body).assignmentTimeoutMin === 0 && (await serverRule()) === orig, sent && sent.body);
  rec("R: the screen shows the server's value again with the reason", (await input.inputValue()) === String(orig) && /Not saved|1–120/.test(await toast(page)), `ui=${await input.inputValue()} server=${orig} toast=${await toast(page)}`);
  await input.fill("30");
  await sleep(2000);
  rec("R: a valid timeout persists on the server", (await serverRule()) === 30);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !!(window.DT.getState().orgConfigs || {})[window.DT.getState().selectedOrg], null, { timeout: 15000 });
  await nav(page, "settings", 1500);
  rec("R: after a reload the screen shows the server's value", (await page.locator("input[aria-label='Assignment timeout in minutes']").inputValue()) === "30");
  await checkLayout(page, `Org config → Rules @390`);
  await api("PATCH", `/api/dev/organizations/${er.id}`, { assignmentTimeoutMin: orig });

  // X (#3): Sign out all — last, it ends every other session.
  const victim = await open(BASE, 390, "ISPN", "director");
  rec("X: the victim session is live before", (await victim.api("GET", "/api/user")).status === 200);
  await nav(page, "enterprise", 1000);
  await page.locator("main button").filter({ hasText: /^Security$/ }).first().click();
  await sleep(400);
  const n9 = apiLog.length;
  await page.locator("main button").filter({ hasText: /^Sign out all$/ }).click();
  await sleep(2000);
  rec("X: Sign out all calls the server", writes(apiLog, n9).some((r) => r.p === "/api/dev/sessions/revoke-all"));
  rec("X: the other browser is signed out (GET /api/user 401)", (await victim.api("GET", "/api/user")).status === 401);
  rec("X: the operator stays signed in", (await api("GET", "/api/user")).status === 200);
  await victim.ctx.close();
  await dev.ctx.close();
}

// ── Q. SYNTHETIC_DATA=false server ─────────────────────────────────────────
if (REAL) {
  const dev = await open(REAL, 390, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD);
  const orgs = (await dev.api("GET", "/api/dev/organizations")).json;
  if (!orgs.some((o) => o.code === "RIVER")) await dev.api("POST", "/api/dev/organizations", { name: "River Hospital", code: "RIVER", timezone: "America/Denver" });
  await dev.ctx.close();
  for (const width of [375, 390, 430]) {
    const d = await open(REAL, width, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD);
    await dashboardTruths("@real" + width, d);
    await checkLayout(d.page, `real dashboard @${width}`);
    if (width === 390) {
      await nav(d.page, "enterprise", 1200);
      let all = "";
      for (const tab of ["Security", "Integrations", "Compliance"]) {
        await d.page.locator("main button").filter({ hasText: new RegExp("^" + tab + "$") }).first().click();
        await sleep(1500);
        all += "\n" + (await mainText(d.page));
      }
      const hits = REMOVED.filter((re) => re.test(all)).map(String);
      rec("Q: real-mode Platform shows none of the removed mock controls", hits.length === 0, hits.join(", "));
    }
    await d.ctx.close();
  }
}

rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await browser.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
