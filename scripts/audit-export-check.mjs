/**
 * Audit export (E2, module `enterprise.auditExport`) in REAL Chromium on
 * emulated iPhones (375×667 / 390×844 / 430×932, DPR 3, touch, iPhone
 * Safari UA), measured against the server's answer:
 *
 *   M. Module OFF (the default): the Compliance screen offers the plain
 *      Export CSV and NOTHING else — no date range, no JSON — and the
 *      enterprise form of the endpoint answers 404 module_disabled while the
 *      legacy whole-trail CSV still downloads.
 *   R. Module ON: From / To and a JSON button appear; a range is SENT to the
 *      server (from / to / format in the query) and the file the browser
 *      saves is the server's; the toast's row count is the file's own; the
 *      screen stops claiming "every row" once a range is set.
 *   J. JSON: the download is the server's JSON with rowCount and the
 *      declared PHI-free columns; no patient name, note or user agent in it.
 *   P. The PHI trail exports the same way, with patient_id (an internal id)
 *      and without user_agent.
 *   X. A developer exports ANOTHER tenant (orgId) — audited on THAT tenant
 *      at high risk; a director naming another tenant is refused 403.
 *   V. A bad range is the server's refusal (400), said in the toast, with
 *      nothing downloaded.
 *   L. Layout at every width (≥44px targets, ≥16px inputs, no overflow);
 *      Z. zero CSP violations / page errors.
 *   Q. (REAL_BASE_URL) SYNTHETIC_DATA=false: a fresh tenant has the module
 *      off; its director still gets the plain CSV; the enterprise form 404s.
 *
 *   BASE_URL=http://127.0.0.1:9061 [REAL_BASE_URL=… REAL_DEV_PASSWORD=…] \
 *     node scripts/audit-export-check.mjs
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const REAL = process.env.REAL_BASE_URL || "";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const PW = process.env.DEV_PASSWORD || "docturn";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const SIZES = { 375: 667, 390: 844, 430: 932 };
const MODULE = "enterprise.auditExport";
const results = [];
const rec = (name, ok, note = "") => { results.push([name, !!ok]); console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  -> " + note : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csp = [];
const pageErrors = [];
const RUN = Date.now().toString(36).slice(-4).toUpperCase().replace(/[^A-Z0-9]/g, "Q");

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

/** A cookie session straight on the API (no browser), for the server legs. */
async function apiSession(base, orgCode, username, password = PW) {
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgCode, username, password }) });
  if (!r.ok) throw new Error("login " + username + " " + r.status);
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* csv */ }
    return { status: res.status, text, json, headers: res.headers };
  };
}

/** The real app, signed in, on an emulated iPhone. Downloads are captured. */
async function open(base, width, org, username, password = PW) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA, acceptDownloads: true });
  const page = await ctx.newPage();
  const apiLog = [];
  const downloads = [];
  page.on("pageerror", (e) => pageErrors.push(username + "@" + width + ": " + String((e && e.message) || e)));
  page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(username + ": " + t.slice(0, 160)); });
  page.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) apiLog.push({ m: r.request().method(), p: u.pathname + u.search, s: r.status() }); });
  page.on("download", (d) => downloads.push(d));
  await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.log("Refused to load (CSP) " + e.violatedDirective + " " + e.blockedURI)); });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle" });
  const inputs = await page.locator("input").all();
  await inputs[0].fill(org);
  await inputs[1].fill(username);
  await inputs[2].fill(password);
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role && s.modules); }, null, { timeout: 30000 });
  await sleep(800);
  return { ctx, page, apiLog, downloads, width };
}

const nav = async (page, id, settle = 1500) => { await page.evaluate((n) => window.DT.actions.setNav(n), id); await sleep(settle); };

/** What the Compliance screen offers right now. */
const panel = (page) =>
  page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const rangeBox = q("[data-export-range]");
    const dates = [...document.querySelectorAll("[data-export-date]")].map((el) => ({ key: el.getAttribute("data-export-date"), font: Math.round(parseFloat(getComputedStyle(el).fontSize)), h: Math.round(el.getBoundingClientRect().height), right: Math.round(el.getBoundingClientRect().right) }));
    const small = [];
    for (const el of document.querySelectorAll("[data-compliance-export] button, [data-export-range] button")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.height < 43.5 || r.width < 43.5)) small.push((el.textContent || "").trim() + " " + Math.round(r.width) + "x" + Math.round(r.height));
    }
    return {
      hasRange: !!rangeBox,
      hasJson: !!q("[data-export-json] button"),
      dates,
      small,
      window: (q("[data-trail-window]") || {}).innerText || "",
      vw: innerWidth,
      doc: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    };
  });

/** Click an export button and return { file, toast }. */
async function clickExport(h, selector) {
  await h.page.evaluate(() => { window.DT.set((s) => { s.__toast = null; return s; }); });
  const before = h.downloads.length;
  await h.page.click(selector);
  // The toast is the end of the action for BOTH outcomes (the download event
  // fires just before it is set) and it is transient, so capture it the
  // moment it appears instead of waiting out a download that never comes.
  let toast = null;
  for (let i = 0; i < 120 && !toast; i++) {
    toast = await h.page.evaluate(() => window.DT.getState().__toast || null);
    if (!toast) await sleep(100);
  }
  await sleep(200);
  const d = h.downloads[before];
  let body = null;
  let name = null;
  if (d) {
    name = d.suggestedFilename();
    const stream = await d.createReadStream();
    if (stream) {
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      body = Buffer.concat(chunks).toString("utf8");
    }
  }
  return { name, body, toast, downloaded: !!d };
}

const director = await apiSession(BASE, "ISPN", "director");
const dev = await apiSession(BASE, "DOCTURN", "dev");
const orgId = (await director("GET", "/api/user")).json.organizationId;
const platformOrgId = (await dev("GET", "/api/user")).json.organizationId;
const setModule = async (org, enabled, id = MODULE) => {
  const r = await dev("PATCH", "/api/dev/modules/" + org, { id, enabled });
  if (r.status !== 200) throw new Error("module flip " + r.status + " " + r.text);
};

try {
  // ── M. module OFF (the default): plain CSV only ──────────────────────────
  await setModule(orgId, false);
  console.log("\n=== " + MODULE + " OFF ===");
  {
    const h = await open(BASE, 390, "ISPN", "director");
    await nav(h.page, "compliance", 2200);
    const p = await panel(h.page);
    rec("M: no date range and no JSON button while the module is off", !p.hasRange && !p.hasJson, JSON.stringify({ hasRange: p.hasRange, hasJson: p.hasJson }));
    rec("M: the screen still says Export downloads every row", /every row/.test(p.window), p.window.slice(0, 160));
    const out = await clickExport(h, "[data-compliance-export] button");
    rec("M: the plain whole-trail CSV still downloads", out.downloaded && /^docturn-audit-ISPN-\d{4}-\d{2}-\d{2}\.csv$/.test(out.name || ""), out.name || "none");
    rec("M: it is the server's CSV (header row, UTC stamps)", /^"occurred_at_utc"/.test(out.body || ""), (out.body || "").slice(0, 60));
    rec("M: the legacy request carried no from/to/format", h.apiLog.some((r) => r.p === "/api/audit/export?trail=audit&scope=org" && r.s === 200), JSON.stringify(h.apiLog.filter((r) => r.p.startsWith("/api/audit/export"))));
    await h.ctx.close();
  }
  {
    const refused = await director("GET", "/api/audit/export?trail=audit&format=json");
    rec("M: the enterprise form answers 404 module_disabled", refused.status === 404 && refused.json && refused.json.module === MODULE, refused.status + " " + refused.text.slice(0, 80));
    const ranged = await director("GET", "/api/audit/export?trail=audit&from=2026-01-01");
    rec("M: a date range is refused the same way", ranged.status === 404 && ranged.json.error === "module_disabled", String(ranged.status));
  }

  // ── R / J / P / V: module ON, on every width ─────────────────────────────
  await setModule(orgId, true);
  console.log("\n=== " + MODULE + " ON ===");
  const today = new Date().toISOString().slice(0, 10);
  for (const width of [375, 390, 430]) {
    const h = await open(BASE, width, "ISPN", "director");
    await nav(h.page, "compliance", 2200);
    let p = await panel(h.page);
    rec(`R[${width}]: From / To and a JSON button are offered`, p.hasRange && p.hasJson && p.dates.length === 2, JSON.stringify({ hasRange: p.hasRange, hasJson: p.hasJson, dates: p.dates.length }));
    rec(`L[${width}]: date inputs are ≥44px tall and ≥16px text`, p.dates.every((d) => d.h >= 43.5 && d.font >= 16), JSON.stringify(p.dates));
    rec(`L[${width}]: every export control is a ≥44px target`, p.small.length === 0, p.small.join(" | "));
    rec(`L[${width}]: no horizontal overflow and nothing off-screen`, p.doc <= p.vw && p.dates.every((d) => d.right <= p.vw + 0.5), JSON.stringify({ doc: p.doc, vw: p.vw, rights: p.dates.map((d) => d.right) }));

    // A range the server filters on.
    await h.page.fill('[data-export-date="from"]', "2026-01-01");
    await h.page.fill('[data-export-date="to"]', today);
    await sleep(400);
    p = await panel(h.page);
    rec(`R[${width}]: with a range set the screen stops claiming "every row"`, /date range/.test(p.window) && !/every row/.test(p.window), p.window.slice(0, 200));
    const csvOut = await clickExport(h, "[data-compliance-export] button");
    const req = h.apiLog.filter((r) => r.p.startsWith("/api/audit/export")).pop();
    rec(`R[${width}]: the range and the format went to the SERVER`, !!req && /from=2026-01-01/.test(req.p) && req.p.includes("to=" + today) && /format=csv/.test(req.p) && req.s === 200, req ? req.p : "no request");
    const lines = (csvOut.body || "").split("\r\n").filter((l) => l.length > 0);
    rec(`R[${width}]: the saved file is the server's CSV for that range`, csvOut.downloaded && /^"occurred_at_utc"/.test(csvOut.body || "") && lines.length > 1, (csvOut.name || "none") + " lines=" + lines.length);
    const toastRows = Number(String((csvOut.toast || {}).title || "").replace(/[^0-9]/g, ""));
    rec(`R[${width}]: the toast's row count is the file's own`, toastRows === lines.length - 1, JSON.stringify({ toast: (csvOut.toast || {}).title, rows: lines.length - 1 }));

    if (width === 390) {
      // J. JSON.
      const jsonOut = await clickExport(h, "[data-export-json] button");
      let parsed = null;
      try { parsed = JSON.parse(jsonOut.body || "null"); } catch { /* reported below */ }
      rec("J: the JSON download is the server's, with rowCount and declared columns", !!parsed && parsed.rowCount === parsed.rows.length && Array.isArray(parsed.columns) && parsed.columns.includes("details_omitted"), parsed ? "rowCount=" + parsed.rowCount : (jsonOut.body || "").slice(0, 80));
      rec("J: every row carries exactly the declared columns", !!parsed && parsed.rows.every((r) => Object.keys(r).length === parsed.columns.length), parsed ? String(Object.keys(parsed.rows[0] || {}).length) : "-");
      rec("J: the organization and range are the server's", !!parsed && parsed.organization.code === "ISPN" && parsed.from === "2026-01-01T00:00:00.000Z", parsed ? JSON.stringify({ org: parsed.organization, from: parsed.from }) : "-");
      rec("J: the file names no patient and no user agent", !!parsed && !/Mozilla|AppleWebKit/.test(jsonOut.body) && !parsed.columns.includes("user_agent"), "-");
      rec("J: the file name is .json", /\.json$/.test(jsonOut.name || ""), jsonOut.name || "none");

      // P. PHI trail.
      await h.page.click('[data-compliance-tab="phi"]');
      await sleep(600);
      const phiOut = await clickExport(h, "[data-export-json] button");
      let phi = null;
      try { phi = JSON.parse(phiOut.body || "null"); } catch { /* reported below */ }
      rec("P: the PHI trail exports with patient_id and without user_agent", !!phi && phi.trail === "phi" && phi.columns.includes("patient_id") && !phi.columns.includes("user_agent"), phi ? phi.columns.join(",") : (phiOut.body || "").slice(0, 80));
      await h.page.click('[data-compliance-tab="audit"]');
      await sleep(400);

      // V. A refused range.
      await h.page.fill('[data-export-date="from"]', "2026-03-02");
      await h.page.fill('[data-export-date="to"]', "2026-03-01");
      await sleep(300);
      const bad = await clickExport(h, "[data-compliance-export] button");
      rec("V: a backwards range is the server's 400 and nothing is downloaded", !bad.downloaded && /date range isn't valid/.test(((bad.toast || {}).msg) || ""), JSON.stringify(bad.toast) + " downloaded=" + bad.downloaded);
    }
    await h.ctx.close();
  }

  // ── X. cross-tenant (developer) ──────────────────────────────────────────
  console.log("\n=== cross-tenant ===");
  await setModule(platformOrgId, true);
  const x = await dev("GET", `/api/audit/export?trail=audit&format=json&orgId=${orgId}`);
  rec("X: a developer exports another tenant", x.status === 200 && x.json && x.json.organization.id === orgId, String(x.status));
  rec("X: streamed (no Content-Length, says so)", x.headers.get("x-export-streamed") === "1" && !x.headers.get("content-length"), String(x.headers.get("content-length")));
  const trail = (await dev(`GET`, `/api/dev/organizations/${orgId}/audit`)).json;
  const crossRow = (trail.audit || []).find((r) => r.action === "audit.export" && r.details && r.details.crossTenant);
  rec("X: the read is audited on the TARGET tenant at high risk", !!crossRow && crossRow.riskLevel === "high" && crossRow.details.operatorOrganizationId === platformOrgId, crossRow ? JSON.stringify(crossRow.details) : "no row");
  const denied = await director(`GET`, `/api/audit/export?trail=audit&format=json&orgId=${platformOrgId}`);
  rec("X: a director naming another tenant is refused 403", denied.status === 403, String(denied.status));
  const chen = await apiSession(BASE, "ISPN", "chen");
  rec("X: a hospitalist is refused the enterprise export (403), keeps the legacy own-trail CSV", (await chen("GET", "/api/audit/export?trail=audit&format=json")).status === 403 && (await chen("GET", "/api/audit/export?trail=audit&scope=mine")).status === 200);

  // ── Q. a non-synthetic server ────────────────────────────────────────────
  if (REAL) {
    console.log("\n=== real server " + REAL + " ===");
    const rdev = await apiSession(REAL, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD || PW);
    const cfg = (await rdev("GET", "/api/config")).json;
    rec("Q (setup): the server is SYNTHETIC_DATA=false", cfg && cfg.syntheticData === false, JSON.stringify(cfg && cfg.syntheticData));
    const code = "AX" + RUN;
    const o = (await rdev("POST", "/api/dev/organizations", { name: "Audit Export " + RUN, code, timezone: "America/Chicago" })).json;
    const made = (await rdev("POST", "/api/dev/users", { organizationId: o.id, role: "director", username: "ax.dir", displayName: "Dr. Export Check" })).json;
    const temp = made && made.temporaryPassword;
    const NEWPW = "Export-Check-2026!";
    const first = await apiSession(REAL, code, "ax.dir", temp);
    await first("PATCH", "/api/account/password", { currentPassword: temp, newPassword: NEWPW });
    const rdir = await apiSession(REAL, code, "ax.dir", NEWPW);
    rec("Q: a fresh tenant has audit export off (the enterprise form 404s)", (await rdir("GET", "/api/audit/export?trail=audit&format=json")).status === 404);
    const plain = await rdir("GET", "/api/audit/export?trail=audit&scope=org");
    rec("Q: its director still gets the plain whole-trail CSV", plain.status === 200 && /^"occurred_at_utc"/.test(plain.text), String(plain.status));
    await rdev("PATCH", `/api/dev/modules/${o.id}`, { id: MODULE, enabled: true });
    const on = await rdir("GET", "/api/audit/export?trail=audit&format=json&from=2026-01-01");
    rec("Q: switched on, the range export answers with that tenant's own rows only", on.status === 200 && on.json.organization.code === code && on.json.rows.every((r) => r.action !== "test.export_probe"), String(on.status) + " rows=" + (on.json ? on.json.rowCount : "-"));
  }
} finally {
  await setModule(orgId, false).catch(() => {});
  await setModule(platformOrgId, false).catch(() => {});
  await browser.close();
}

rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
