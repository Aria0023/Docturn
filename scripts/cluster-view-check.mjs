#!/usr/bin/env node
/**
 * E1 cluster view (module enterprise.multiInstance), measured in REAL Chromium
 * on emulated iPhones (375 / 390 / 430) against a fresh server:
 *
 *   O. Module OFF (the default): the developer console's Cluster card says
 *      "switched off", shows no numbers, and the client never requests
 *      /api/dev/cluster (the server would answer 404 module_disabled — checked
 *      directly too).
 *   N. Module ON (flipped through the real PATCH /api/dev/modules): the card
 *      shows the SERVER's instance id, bus kind, limiter / session store and
 *      every job lease the server reports — compared with GET /api/dev/cluster.
 *   F. Flipping the module OFF again while the page is open: the next Refresh
 *      is refused (404) and the card returns to "switched off".
 *   L. Layout at every width: no horizontal overflow, controls ≥ 44 px.
 *   Z. Zero CSP violations, zero page errors.
 *
 *   BASE_URL=http://127.0.0.1:9006 node scripts/cluster-view-check.mjs
 * Needs a seeded synthetic server with RATE_LIMIT=off. Exits non-zero on failure.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
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

async function open(width) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const apiLog = [];
  page.on("pageerror", (e) => pageErrors.push(width + ": " + String((e && e.message) || e)));
  page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(width + ": " + t.slice(0, 160)); });
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) apiLog.push({ m: r.method(), p: u.pathname }); });
  await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.log("Refused to load (CSP) " + e.violatedDirective + " " + e.blockedURI)); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle" });
  const inputs = await page.locator("input").all();
  await inputs[0].fill("DOCTURN");
  await inputs[1].fill("dev");
  await inputs[2].fill(PW);
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 20000 });
  await sleep(1500);
  const api = (method, path, body) => page.evaluate(([m, p, b]) => fetch(p, { method: m, credentials: "include", headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })), [method, path, body]);
  return { ctx, page, apiLog, api };
}
const card = (page) => page.evaluate(() => {
  const el = document.querySelector("[data-cluster-card]");
  if (!el) return null;
  const val = (k) => { const n = el.querySelector(`[data-cluster="${k}"] [data-cluster-value]`); return n ? n.textContent : null; };
  return {
    state: el.getAttribute("data-cluster-state"),
    status: (el.querySelector("[data-cluster-status]") || {}).textContent || "",
    off: !!el.querySelector("[data-cluster-off]"),
    text: el.innerText,
    instance: val("instance"), bus: val("bus"), ratelimit: val("ratelimit"), sessions: val("sessions"), db: val("db"),
    leases: [...el.querySelectorAll("[data-cluster-lease]")].map((l) => ({ name: l.getAttribute("data-cluster-lease"), value: (l.querySelector("[data-cluster-value]") || {}).textContent || "" })),
  };
});
async function layout(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const out = { overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw, small: [] };
    const el = document.querySelector("[data-cluster-card]");
    if (!el) return out;
    for (const b of el.querySelectorAll("button")) { const r = b.getBoundingClientRect(); if (r.width > 0 && (r.height < 43.5 || r.width < 43.5)) out.small.push(b.textContent.trim() + " " + Math.round(r.width) + "x" + Math.round(r.height)); }
    return out;
  });
}

const first = await open(390);
const me = (await first.api("GET", "/api/user")).json;
const platformOrgId = me.organizationId;
// Start from the registry default (off), whatever a previous run left behind.
await first.api("PATCH", "/api/dev/modules/" + platformOrgId, { id: "enterprise.multiInstance", enabled: false });
await first.ctx.close();

for (const width of [375, 390, 430]) {
  const { ctx, page, apiLog, api } = await open(width);
  // ── O. off by default ──
  await page.waitForSelector("[data-cluster-card]", { timeout: 10000 }).catch(() => {});
  await sleep(600);
  let c = await card(page);
  rec(`O@${width}: the Cluster card is present and says switched off`, c && c.state === "off" && c.off && /switched off/i.test(c.text), c ? c.state + " / " + c.status : "no card");
  rec(`O@${width}: no numbers while off (no instance id, no leases)`, c && c.instance === null && c.leases.length === 0);
  rec(`O@${width}: the client never asked /api/dev/cluster while the module is off`, !apiLog.some((r) => r.p === "/api/dev/cluster"));
  const refused = await api("GET", "/api/dev/cluster");
  rec(`O@${width}: the server itself answers 404 module_disabled`, refused.status === 404 && refused.json && refused.json.error === "module_disabled" && refused.json.module === "enterprise.multiInstance", JSON.stringify(refused.json));
  const l0 = await layout(page);
  rec(`L@${width}: no horizontal overflow (off)`, l0.overflow <= 0, "overflow " + l0.overflow);

  // ── N. switch on through the real module route ──
  const on = await api("PATCH", "/api/dev/modules/" + platformOrgId, { id: "enterprise.multiInstance", enabled: true });
  rec(`N@${width}: PATCH /api/dev/modules switches the module on`, on.status === 200 && on.json.modules["enterprise.multiInstance"] === true);
  await page.evaluate(() => window.DT.actions.loadModules && window.DT.actions.loadModules());
  await page.waitForFunction(() => { const el = document.querySelector("[data-cluster-card]"); return el && el.getAttribute("data-cluster-state") === "ok"; }, null, { timeout: 15000 }).catch(() => {});
  c = await card(page);
  const server = (await api("GET", "/api/dev/cluster")).json;
  rec(`N@${width}: the card loaded the server's cluster view`, c && c.state === "ok", c ? c.state : "no card");
  rec(`N@${width}: the instance id shown is the server's`, c && server && c.instance && c.instance.startsWith(server.instance.id), (c && c.instance) + " vs " + (server && server.instance.id));
  rec(`N@${width}: the bus kind shown is the server's`, c && server && (server.bus.kind === "postgres" ? /Postgres/.test(c.bus) : /in-process/.test(c.bus)), c && c.bus);
  rec(`N@${width}: limiter and session stores are the server's words`, c && server && (server.rateLimit.enabled ? (server.rateLimit.store === "database" ? /shared/.test(c.ratelimit) : /this instance/.test(c.ratelimit)) : c.ratelimit === "OFF") && (server.sessions.store === "postgres" ? /Postgres/.test(c.sessions) : /this instance|not chosen/.test(c.sessions)), (c && c.ratelimit) + " / " + (c && c.sessions));
  const serverLeases = (server && server.leases) || [];
  // A lease can lapse or be re-claimed between the card's read and this one
  // (the sweeps tick every 15 s), so the holder may show as "this instance"
  // (held) or "lapsed · last <id>"; both name the same server instance.
  rec(`N@${width}: every job lease the server reports is on the card, with its holder`, c && serverLeases.length === c.leases.length && serverLeases.every((l) => { const row = c.leases.find((x) => x.name === l.name); return row && (row.value.includes(l.holder) || (l.holder === server.instance.id && /this instance/.test(row.value))); }), c ? c.leases.map((l) => l.name + "=" + l.value).join(", ") : "");
  rec(`N@${width}: the safety badge is the server's verdict`, c && server && (server.multiInstanceSafe ? /Cluster-safe/.test(c.status) : /Single instance/.test(c.status)), c && c.status);
  const l1 = await layout(page);
  rec(`L@${width}: no horizontal overflow (on), controls ≥ 44 px`, l1.overflow <= 0 && l1.small.length === 0, "overflow " + l1.overflow + " " + l1.small.join(","));

  // ── F. switch off while open: the next refresh is refused and the card follows ──
  await api("PATCH", "/api/dev/modules/" + platformOrgId, { id: "enterprise.multiInstance", enabled: false });
  await page.locator("[data-cluster-card] button").filter({ hasText: /^Refresh$/ }).click();
  await page.waitForFunction(() => { const el = document.querySelector("[data-cluster-card]"); return el && el.getAttribute("data-cluster-state") === "off"; }, null, { timeout: 10000 }).catch(() => {});
  c = await card(page);
  rec(`F@${width}: after the switch goes off, Refresh is refused and the card says switched off again`, c && c.state === "off" && c.instance === null, c ? c.state : "no card");
  await ctx.close();
}

rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await browser.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
