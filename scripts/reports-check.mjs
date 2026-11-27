// Reports: built-in reports from the server, a custom report (build, run
// unsaved, save, CSV, delete), the honest "Epic is not connected" state, the
// hospitalist's view and the phone layout. BASE_URL=… node scripts/reports-check.mjs
import { chromium } from "playwright-core";
const B = process.env.BASE_URL || "http://127.0.0.1:5000", OUT = process.env.OUT || ""; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let failed = 0;
const rec = (n, ok, d = "") => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
async function open(user, vp, mob) {
  const c = await browser.newContext({ viewport: vp, deviceScaleFactor: OUT ? 2 : 1, isMobile: mob, hasTouch: mob, acceptDownloads: true });
  const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(B + "/", { waitUntil: "networkidle" });
  const inputs = await p.locator("input").all(); await inputs[0].fill("ISPN"); await inputs[1].fill(user); await inputs[2].fill("docturn");
  await p.locator('button:has-text("Sign in")').last().click();
  await p.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
  await sleep(1500); const d = p.locator("[data-alerts-dismiss]"); if (await d.count()) await d.first().click();
  return { c, p, errs };
}
const ready = (p) => p.waitForFunction(() => !document.querySelector('[data-report-state="loading"]') && (document.querySelector("[data-report-table]") || document.querySelector("[data-report-state]")), null, { timeout: 20000 });
const goReports = async (p) => { await p.evaluate(() => window.DT.actions.setNav("reports")); await p.waitForSelector("[data-report-picker]", { timeout: 20000 }); await ready(p); };

// ── director, desktop ────────────────────────────────────────────────────────
const D = await open("director", { width: 1366, height: 860 }, false);
rec("Reports is in the director's navigation", await D.p.locator('text="Reports"').count() > 0);
await goReports(D.p);
rec("four built-in reports", await D.p.locator("[data-report-tab^='builtin:']").count() === 4);
rec("opens on Team census", (await D.p.textContent("[data-report-title]")) === "Team census");
rec("source is stated", /From DocTurn records/.test(await D.p.textContent("[data-report-source]")));
// The screen shows exactly what the server returns for the same report.
const viaApi = async (p, body) => p.evaluate((b) => fetch("/api/reporting/run", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json()), body);
const census = await viaApi(D.p, { ref: "builtin:team_census" });
rec("census rows match the server", await D.p.locator("[data-report-row]").count() === census.rows.length, census.rows.length + " rows");
rec("census is grouped by hospitalist", census.rows.length === 0 || await D.p.locator("[data-report-group-row]").count() === new Set(census.rows.map((r) => r.hospitalist)).size);
if (OUT) await D.p.screenshot({ path: OUT + "/census.png" });

await D.p.click("[data-report-tab='builtin:pending_admits']"); await ready(D.p);
const pend = await viaApi(D.p, { ref: "builtin:pending_admits" });
rec("pending admits rows match the server", await D.p.locator("[data-report-row]").count() === pend.rows.length && pend.rows.length > 0, pend.rows.length + " rows");
if (OUT) await D.p.screenshot({ path: OUT + "/pending.png" });
await D.p.click("[data-report-tab='builtin:provider_load']"); await ready(D.p);
const load = await viaApi(D.p, { ref: "builtin:provider_load" });
rec("provider load rows match the server", await D.p.locator("[data-report-row]").count() === load.rows.length && load.rows.length > 0);
rec("built-in reports cannot be edited or deleted", await D.p.locator('button:has-text("Edit")').count() === 0 && await D.p.locator('button:has-text("Delete")').count() === 0);

// Build a custom report.
await D.p.click('button:has-text("New report")');
await D.p.waitForSelector("[data-report-builder]");
await D.p.selectOption("[data-report-dataset]", "ehr_patient_list");
rec("Epic report says Epic is not connected", await D.p.locator("[data-report-ehr-off]").count() === 1);
rec("an Epic report cannot be saved or run while not connected", await D.p.locator('button:has-text("Save report")').isDisabled() && await D.p.locator('button:has-text("Run without saving")').isDisabled());
if (OUT) await D.p.screenshot({ path: OUT + "/builder-epic.png" });
await D.p.selectOption("[data-report-dataset]", "provider_load");
await D.p.uncheck("[data-report-col='specialty']").catch(() => {});
await D.p.uncheck("[data-report-col='inRotation']");
await D.p.selectOption("[data-report-sort]", "hospitalist");
await D.p.selectOption('select[aria-label="Sort direction"]', "asc");
await D.p.click('button:has-text("Add a filter")');
await D.p.locator("[data-report-filter] select").first().selectOption("hospitalist");
await D.p.locator("[data-report-filter] select").nth(1).selectOption("contains");
await D.p.locator("[data-report-filter] input").fill("AN"); // matching ignores case
await D.p.click('button:has-text("Save report")');
rec("a report needs a name", /name/i.test(await D.p.textContent("[data-report-builder-error]")));
await D.p.click('button:has-text("Run without saving")');
await ready(D.p);
const onShift = load.rows.filter((r) => r.hospitalist.toLowerCase().includes("an"));
rec("unsaved run applies the filter", await D.p.locator("[data-report-row]").count() === onShift.length && onShift.length > 0 && onShift.length < load.rows.length, onShift.length + " of " + load.rows.length);
rec("unsaved run is marked Not saved", await D.p.locator('text="Not saved"').count() === 1);
const heads = await D.p.locator("[data-report-table] th").allTextContents();
rec("only the chosen columns show", !heads.includes("In rotation") && heads.includes("Census"), heads.join("|"));
const names = await D.p.locator("[data-report-row] td:first-child").allTextContents();
rec("rows are sorted", JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))), names.join(", "));
await D.p.click('button:has-text("Save…")');
await D.p.fill("[data-report-name]", "On shift now");
await D.p.check("[data-report-shared]");
await D.p.click('button:has-text("Save report")');
await D.p.waitForFunction(() => (document.querySelector("[data-report-title]") || {}).textContent === "On shift now", null, { timeout: 15000 });
await ready(D.p);
rec("saved report opens and keeps its filter", await D.p.locator("[data-report-row]").count() === onShift.length);
if (OUT) await D.p.screenshot({ path: OUT + "/custom.png" });
const [dl] = await Promise.all([D.p.waitForEvent("download", { timeout: 15000 }), D.p.click('button:has-text("CSV")')]);
const fs = await import("node:fs");
const csv = fs.readFileSync(await dl.path(), "utf8");
rec("CSV downloads with the same rows", dl.suggestedFilename() === "docturn-on-shift-now.csv" && csv.trim().split("\r\n").length === onShift.length + 1, dl.suggestedFilename());
rec("nothing from a report is kept on the device", await D.p.evaluate((n) => !Object.keys(localStorage).some((k) => (localStorage.getItem(k) || "").includes(n)), names[0] || "zzzz"));

// ── hospitalist sees the shared report but cannot change it ──────────────────
const H = await open("patel", { width: 1366, height: 860 }, false);
await goReports(H.p);
const sharedTab = H.p.locator("[data-report-tab]", { hasText: "On shift now" });
rec("a hospitalist sees the shared report", await sharedTab.count() === 1);
await sharedTab.click(); await ready(H.p);
rec("…and can run it", await H.p.locator("[data-report-row]").count() === onShift.length);
rec("…but cannot edit or delete it", await H.p.locator('button:has-text("Edit")').count() === 0 && await H.p.locator('button:has-text("Delete")').count() === 0);
await H.p.click('button:has-text("New report")');
rec("a hospitalist is not offered sharing", await H.p.locator("[data-report-shared]").count() === 0);
await H.c.close();

// Director deletes it.
D.p.once("dialog", (d) => d.accept());
await D.p.click('button:has-text("Delete")');
await D.p.waitForFunction(() => ![...document.querySelectorAll("[data-report-tab]")].some((b) => /On shift now/.test(b.textContent)), null, { timeout: 15000 });
rec("deleting removes the saved report", true);
rec("no page errors (desktop)", D.errs.length === 0, D.errs.join(" | "));
await D.c.close();

// ── phone ────────────────────────────────────────────────────────────────────
const M = await open("chen", { width: 390, height: 844 }, true);
await goReports(M.p);
const over = await M.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
rec("phone: the page does not scroll sideways", over <= 1, "overflow " + over);
rec("phone: the report table is on screen", await M.p.locator("[data-report-table], [data-report-state]").first().isVisible());
if (OUT) await M.p.screenshot({ path: OUT + "/phone.png" });
rec("no page errors (phone)", M.errs.length === 0, M.errs.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
