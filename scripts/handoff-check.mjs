// Hand-off notes end to end: a hospitalist accepts a patient, writes a note,
// gives it to a colleague who is told live and acknowledges; the writer sees
// the acknowledgement; nothing clinical is kept on the device.
// BASE_URL=… node scripts/handoff-check.mjs
import { chromium } from "playwright-core";
const B = process.env.BASE_URL || "http://127.0.0.1:5000", OUT = process.env.OUT || ""; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let failed = 0;
const rec = (n, ok, d = "") => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
async function open(user, vp, mob) {
  const c = await browser.newContext({ viewport: vp, deviceScaleFactor: OUT ? 2 : 1, isMobile: mob, hasTouch: mob });
  const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("dialog", (d) => d.accept());
  await p.goto(B + "/", { waitUntil: "networkidle" });
  const inputs = await p.locator("input").all(); await inputs[0].fill("ISPN"); await inputs[1].fill(user); await inputs[2].fill("docturn");
  await p.locator('button:has-text("Sign in")').last().click();
  await p.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
  await sleep(1500); const d = p.locator("[data-alerts-dismiss]"); if (await d.count()) await d.first().click();
  return { c, p, errs };
}
const C = await open("chen", { width: 1366, height: 950 }, false);
rec("Hand-off is in the hospitalist's menu", await C.p.locator('text="Hand-off"').count() > 0);
await C.p.locator('button:has-text("Accept")').first().click(); // the seeded waiting request (patient SC)
await sleep(1500);
await C.p.evaluate(() => window.DT.actions.setNav("handoff"));
await C.p.waitForSelector("[data-handoff-mine]", { timeout: 20000 });
rec("my accepted patient is listed with no note yet", /No note yet/.test(await C.p.locator("[data-handoff-state]").first().innerText()));
rec("nothing handed to me, and it says so", await C.p.locator("[data-handoff-incoming-empty]").count() === 1);
await C.p.click('button:has-text("Save note")').catch(() => {});
await C.p.click('[data-handoff-sev-pick="watcher"]');
await C.p.fill("[data-handoff-summary]", "Chest pain, troponin negative x1, on telemetry.");
await C.p.fill("[data-handoff-todo]", "Repeat troponin at 02:00. Call cardiology if it rises.");
const P = await open("patel", { width: 1366, height: 950 }, false);
const opt = await C.p.locator("[data-handoff-to] option", { hasText: "Dr. Sara Grant" }).getAttribute("value");
await C.p.selectOption("[data-handoff-to]", opt);
if (OUT) await C.p.screenshot({ path: OUT + "/write.png" });
await C.p.click('button:has-text("Save note")');
await C.p.waitForFunction(() => /Given to Dr\. Sara Grant · not acknowledged yet/.test((document.querySelector("[data-handoff-state]") || {}).textContent || ""), null, { timeout: 15000 });
rec("the saved note shows who it was given to and that it is not acknowledged", true);

await P.p.waitForFunction(() => /Hand-off notes waiting/.test(document.body.innerText), null, { timeout: 15000 });
rec("the receiver is told live, without the note's text", !/troponin/i.test(await P.p.locator("body").innerText()));
await P.p.evaluate(() => window.DT.actions.setNav("handoff"));
await P.p.waitForSelector('[data-handoff-incoming="waiting"]', { timeout: 20000 });
const inc = await P.p.locator("[data-handoff-incoming]").first().innerText();
rec("the receiver reads severity, summary and what to watch", /Watch closely/.test(inc) && /troponin negative/.test(inc) && /Repeat troponin at 02:00/.test(inc) && /From Dr\. Nolan Avery/.test(inc));
if (OUT) await P.p.screenshot({ path: OUT + "/receive.png" });
await P.p.click('[data-handoff-incoming] button:has-text("Acknowledge")');
await P.p.waitForSelector('[data-handoff-incoming="acked"]', { timeout: 15000 });
await C.p.waitForFunction(() => /Acknowledged by Dr\. Sara Grant/.test((document.querySelector("[data-handoff-state]") || {}).textContent || ""), null, { timeout: 15000 });
rec("the writer sees the acknowledgement live", true);
for (const [who, x] of [["writer", C], ["receiver", P]]) {
  rec("no note text kept on the " + who + "'s device", await x.p.evaluate(() => !Object.keys(localStorage).concat(Object.keys(sessionStorage)).some((k) => /troponin|cardiology/i.test((localStorage.getItem(k) || "") + (sessionStorage.getItem(k) || "")))));
  rec("no page errors (" + who + ")", x.errs.length === 0, x.errs.join(" | "));
}
const M = await open("patel", { width: 390, height: 844 }, true);
await M.p.evaluate(() => window.DT.actions.setNav("handoff")); await M.p.waitForSelector("[data-handoff-incoming]", { timeout: 20000 });
const over = await M.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
rec("phone: hand-off fits", over <= 1, "overflow " + over);
await browser.close();
process.exit(failed ? 1 : 0);
