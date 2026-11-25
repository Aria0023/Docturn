// Accessibility: runs axe-core (WCAG 2.1 A/AA rules) on the main screens for
// each kind of account and FAILS on any serious or critical finding.
// Moderate and minor findings are listed, not failed.
// BASE_URL=… node scripts/a11y-check.mjs
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
const B = process.env.BASE_URL || "http://127.0.0.1:5000"; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AXE = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let failed = 0; const seen = new Map();
const rec = (n, ok, d = "") => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
const PLAN = {
  __login: ["login"],
  director: ["dashboard", "board", "codes", "reports", "oncall", "broadcasts", "messages", "directory", "settings", "account"],
  hospitalist: ["dashboard", "history", "handoff", "codes", "reports", "messages", "directory", "account"],
  er_doctor: ["dashboard", "codes", "messages"],
  nurse: ["dashboard", "codes", "reports", "oncall", "messages"],
};
const USER = { director: "director", hospitalist: "chen", er_doctor: "er.doc", nurse: "nurse" };
for (const [who, navs] of Object.entries(PLAN)) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 }, bypassCSP: true });
  const p = await c.newPage();
  await p.goto(B + "/", { waitUntil: "networkidle" });
  if (who !== "__login") {
    const inputs = await p.locator("input").all(); await inputs[0].fill("ISPN"); await inputs[1].fill(USER[who]); await inputs[2].fill("docturn");
    await p.locator('button:has-text("Sign in")').last().click();
    await p.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
    await sleep(1500); const d = p.locator("[data-alerts-dismiss]"); if (await d.count()) await d.first().click();
  }
  await p.addScriptTag({ content: AXE });
  for (const nav of navs) {
    if (who !== "__login") { await p.evaluate((n) => window.DT.actions.setNav(n), nav); await sleep(1400); }
    const res = await p.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, sample: v.nodes.slice(0, 3).map((x) => String(x.target) + " | " + x.html.replace(/style="[^"]*"/g, "").slice(0, 200) + " :: " + (x.failureSummary || "").split("\n").slice(1, 2).join(" ").slice(0, 140)) }));
    });
    const bad = res.filter((v) => v.impact === "serious" || v.impact === "critical");
    for (const v of res) { const k = v.impact + " " + v.id; if (!seen.has(k)) seen.set(k, { help: v.help, where: [], sample: v.sample }); seen.get(k).where.push(who + "/" + nav + "×" + v.n); }
    rec(`${who} · ${nav}: no serious or critical accessibility findings`, bad.length === 0, bad.map((v) => v.id + "×" + v.n).join(", "));
  }
  await c.close();
}
console.log("\n---- findings by rule ----");
for (const [k, v] of [...seen].sort()) { console.log(k + " — " + v.help + "\n   " + v.where.join(", ") + "\n   e.g. " + v.sample.join("\n        ")); }
await browser.close();
process.exit(failed ? 1 : 0);
