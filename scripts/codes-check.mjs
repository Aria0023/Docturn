// Code protocols end to end with three signed-in people: a director sets up
// Code Stroke, an ER doctor calls it, a hospitalist on the team is alerted,
// acknowledges and arrives, steps are ticked, the code is completed.
// BASE_URL=… node scripts/codes-check.mjs
import { chromium } from "playwright-core";
const B = process.env.BASE_URL || "http://127.0.0.1:5000", OUT = process.env.OUT || ""; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let failed = 0;
const rec = (n, ok, d = "") => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
async function open(user, vp, mob) {
  const c = await browser.newContext({ viewport: vp, deviceScaleFactor: OUT ? 2 : 1, isMobile: mob, hasTouch: mob });
  const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  await p.goto(B + "/", { waitUntil: "networkidle" });
  const inputs = await p.locator("input").all(); await inputs[0].fill("ISPN"); await inputs[1].fill(user); await inputs[2].fill("docturn");
  await p.locator('button:has-text("Sign in")').last().click();
  await p.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
  await sleep(1500); const d = p.locator("[data-alerts-dismiss]"); if (await d.count()) await d.first().click();
  return { c, p, errs };
}
const goCodes = async (p) => { await p.evaluate(() => window.DT.actions.setNav("codes")); await p.waitForSelector("[data-code-idle], [data-code-card]", { timeout: 20000 }); };
const gone = (p, sel) => p.waitForFunction((s) => !document.querySelector(s), sel, { timeout: 15000 });

// ── director sets the protocol up ────────────────────────────────────────────
const D = await open("director", { width: 1366, height: 900 }, false);
rec("Codes is in the navigation", await D.p.locator('text="Codes"').count() > 0);
await goCodes(D.p);
rec("no protocols yet, and it says so", await D.p.locator("[data-code-none]").count() === 1 && await D.p.locator("[data-code-idle]").count() === 1);
await D.p.click('button:has-text("Code Stroke")');
await D.p.waitForSelector("[data-code-editor]");
rec("the template arrives with nobody set, and says so", /5 team members have nobody set/.test(await D.p.textContent("[data-code-unassigned]")));
await D.p.waitForFunction(() => document.querySelectorAll("[data-code-team-ref] optgroup").length > 0, null, { timeout: 15000 });
const refs = D.p.locator("[data-code-team-ref]");
const people = await refs.first().locator('optgroup[label="Always this person"] option').evaluateAll((o) => o.map((x) => [x.value, x.textContent]));
const pick = (name) => people.find((x) => x[1] === name)[0];
await refs.nth(0).selectOption(pick("Dr. Erin Reyes"));   // ED physician
await refs.nth(1).selectOption(pick("Dr. Sara Grant"));   // Neurologist on call (a named person here)
await refs.nth(2).selectOption(pick("Dr. Nolan Avery"));  // Charge nurse slot, a person for the test
// CT / Radiology and Pharmacy stay unset.
if (OUT) await D.p.screenshot({ path: OUT + "/editor.png" });
await D.p.click('button:has-text("Save protocol")');
await gone(D.p, "[data-code-editor]");
await D.p.waitForSelector("[data-code-call-btn]");
rec("the saved protocol can be called", await D.p.locator("[data-code-call-btn]").count() === 1);
rec("the protocol list flags the unset members", /2 team members not set/.test(await D.p.textContent("[data-code-protocol]")));

// ── a hospitalist on the team, signed in before the code ─────────────────────
const H = await open("patel", { width: 1366, height: 900 }, false);
rec("no banner before a code", await H.p.locator("[data-code-banner]").count() === 0);
const C = await open("chen", { width: 390, height: 844 }, true);

// ── the ER doctor calls it ───────────────────────────────────────────────────
const E = await open("er.doc", { width: 1366, height: 900 }, false);
await goCodes(E.p);
rec("an ER doctor cannot manage protocols", await E.p.locator('button:has-text("New protocol")').count() === 0);
await E.p.click("[data-code-call-btn]");
await E.p.waitForSelector("[data-code-preview]");
rec("the preview names who is alerted and who is not", await E.p.locator('[data-code-preview="alerted"]').count() === 3 && await E.p.locator('[data-code-preview="not"]').count() === 2);
if (OUT) await E.p.screenshot({ path: OUT + "/call.png" });
await E.p.click('button:has-text("Call Code Stroke")');
rec("a code needs a location", /where/i.test(await E.p.textContent("[data-code-activate-error]")));
await E.p.fill("[data-code-location]", "ED 4");
await E.p.click('button:has-text("Call Code Stroke")');
await E.p.waitForSelector('[data-code-status="active"]', { timeout: 15000 });
rec("the code is running with a clock", /^\d+:\d\d$/.test((await E.p.textContent("[data-code-clock]")).trim()));
rec("caller is answered, two alerted, two not alerted", await E.p.locator('[data-code-member="acked"]').count() === 1 && await E.p.locator('[data-code-member="waiting"]').count() === 2 && await E.p.locator('[data-code-member="none"]').count() === 2);
rec("tally counts only people who were alerted", /1 of 3 answered/.test(await E.p.textContent("[data-code-tally]")));

// ── the hospitalist is alerted live, wherever they are in the app ────────────
await H.p.waitForSelector("[data-code-banner-item]", { timeout: 15000 });
rec("team member gets a banner without being on the Codes screen", /Code Stroke/.test(await H.p.textContent("[data-code-banner]")) && /ED 4/.test(await H.p.textContent("[data-code-banner]")));
rec("the banner asks for an acknowledgement", await H.p.locator('[data-code-banner] button:has-text("Acknowledge")').count() === 1);
if (OUT) await H.p.screenshot({ path: OUT + "/banner.png" });
await H.p.click('[data-code-banner] button:has-text("Acknowledge")');
await H.p.waitForFunction(() => !document.querySelector("[data-code-banner] button") || ![...document.querySelectorAll("[data-code-banner] button")].some((b) => /Acknowledge/.test(b.textContent)), null, { timeout: 15000 });
await E.p.waitForFunction(() => /2 of 3 answered/.test((document.querySelector("[data-code-tally]") || {}).textContent || ""), null, { timeout: 15000 });
rec("the caller sees the acknowledgement live", true);
await H.p.click('[data-code-banner] button:has-text("Open")');
await H.p.waitForSelector("[data-code-card]");
await H.p.click('button:has-text("I\'m here")');
await E.p.waitForFunction(() => document.querySelectorAll('[data-code-member="arrived"]').length === 1, null, { timeout: 15000 });
rec("the caller sees the arrival live", true);

// phone: a team member who has not answered
await C.p.waitForSelector("[data-code-banner-item]", { timeout: 15000 });
const over = await C.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
rec("phone: banner shows and the page does not scroll sideways", over <= 1, "overflow " + over);
await C.p.evaluate(() => window.DT.actions.setNav("codes")); await C.p.waitForSelector("[data-code-card]");
const over2 = await C.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
rec("phone: the code card fits", over2 <= 1, "overflow " + over2);
if (OUT) await C.p.screenshot({ path: OUT + "/phone.png", fullPage: true });

// steps
await H.p.locator("[data-code-step] input").first().click();
await E.p.waitForFunction(() => document.querySelectorAll('[data-code-step="done"]').length === 1, null, { timeout: 15000 });
rec("a step ticked by the team shows for everyone with its time", /Done at .* min · Dr\. Sara Grant · within target/.test(await E.p.locator('[data-code-step="done"]').textContent()));
if (OUT) await E.p.screenshot({ path: OUT + "/running.png" });
// the director (not on the team) watches and may close; here the caller completes it
await D.p.waitForSelector('[data-code-status="active"]', { timeout: 15000 });
rec("the director sees the running code but is not asked to acknowledge", await D.p.locator("[data-code-banner]").count() === 0 && await D.p.locator('button:has-text("Acknowledge")').count() === 0);
await E.p.click('button:has-text("Complete")');
await E.p.waitForSelector('[data-code-status="completed"]', { timeout: 15000 });
rec("completed code moves to Recent with its duration", /Completed · .* min/.test(await E.p.textContent("[data-code-clock]")) && await E.p.locator("[data-code-idle]").count() === 1);
await gone(H.p, "[data-code-banner]"); await gone(C.p, "[data-code-banner]");
rec("banners clear for the team when the code closes", true);
rec("a closed code offers no actions", await H.p.locator('button:has-text("I\'m here"), button:has-text("Stand down")').count() === 0 && await H.p.locator("[data-code-step] input:not([disabled])").count() === 0);
rec("nothing about the code is kept on the device", await H.p.evaluate(() => !Object.keys(localStorage).some((k) => /Code Stroke|ED 4/.test(localStorage.getItem(k) || ""))));
for (const [n, x] of [["director", D], ["ER doctor", E], ["hospitalist", H], ["phone", C]]) rec("no page errors (" + n + ")", x.errs.length === 0, x.errs.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
