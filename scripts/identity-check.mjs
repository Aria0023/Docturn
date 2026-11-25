// Patient identity and bed-ready, end to end: an ER physician enters a name,
// date of birth and MRN; the hospitalist and the charge nurse see them; the
// nurse marks the bed ready and the hospitalist sees it; nothing is kept on
// the device; the director's Settings shows the EHR admission feed card.
// BASE_URL=… node scripts/identity-check.mjs
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
const NAME = "Marisol Vandenberg", MRN = "E7701234";

const E = await open("er.doc", { width: 1366, height: 1000 }, false);
await E.p.waitForSelector("[data-intake-identity]", { timeout: 20000 });
await E.p.fill("[data-intake-name]", NAME);
const initialsBox = E.p.locator('input[placeholder="e.g. JS"]');
rec("typing the name fills the initials", (await initialsBox.inputValue()) === "MV", await initialsBox.inputValue());
await E.p.fill("[data-intake-dob]", "1948-03-09");
await E.p.fill("[data-intake-mrn]", MRN);
await E.p.locator('input[placeholder^="e.g. 412"]').fill("ED 7");
await E.p.locator('input[placeholder="Reason for admission"]').fill("Hip fracture");
if (OUT) await E.p.screenshot({ path: OUT + "/intake.png" });
// Send to a named hospitalist so the test knows who to sign in as.
const sent = await E.p.evaluate(async ({ NAME, MRN }) => {
  const prov = (window.DT.getState().providers || []).find((p) => /Sara Grant/.test(p.name));
  window.DT.actions.sendAssignment(prov, { initials: "MV", room: "ED 7", complaint: "Hip fracture", acuity: 3, fullName: NAME, dob: "1948-03-09", mrn: MRN }, [], "manual", {});
  return !!prov;
}, { NAME, MRN });
rec("the admission is sent", sent);

const H = await open("patel", { width: 1366, height: 900 }, false);
await H.p.waitForFunction((n) => document.body.innerText.includes(n), NAME, { timeout: 20000 });
const idLine = await H.p.locator("[data-patient-identity]").first().innerText();
rec("the hospitalist sees name, date of birth and MRN on the request", idLine.includes(NAME) && idLine.includes("DOB 03/09/1948") && idLine.includes("MRN " + MRN), idLine);
if (OUT) await H.p.screenshot({ path: OUT + "/hospitalist.png" });

const N = await open("nurse", { width: 1366, height: 900 }, false);
await N.p.waitForFunction((n) => document.body.innerText.includes(n), NAME, { timeout: 20000 });
rec("the charge nurse sees who the patient is and that it is waiting", /Sent to Dr\. Sara Grant/.test(await N.p.locator("[data-staff-open]", { hasText: "MV" }).innerText()));
rec("no bed control until someone has accepted", await N.p.locator("[data-staff-open] [data-staff-bed]").count() === 0);

await H.p.locator("div", { hasText: "Patient MV" }).locator('button:has-text("Accept")').last().click();
const row = N.p.locator("[data-staff-accepted]", { hasText: "MV" });
await row.waitFor({ timeout: 20000 });
await row.locator('input[aria-label^="Unit or bed"]').fill("5 West 512");
await row.locator('button:has-text("Bed ready")').click();
await row.locator("[data-bed-ready]").waitFor({ timeout: 15000 });
rec("the nurse marks the bed ready with the unit", /Bed ready · 5 West 512/.test(await row.innerText()));
if (OUT) await N.p.screenshot({ path: OUT + "/nurse.png" });
await H.p.waitForSelector("[data-bed-ready]", { timeout: 20000 });
rec("the hospitalist sees the bed is ready, live", /Bed ready · 5 West 512/.test(await H.p.locator("[data-bed-ready]").first().innerText()));
await row.locator('button:has-text("Undo")').click();
await N.p.waitForFunction(() => !document.querySelector("[data-staff-accepted] [data-bed-ready]"), null, { timeout: 15000 });
rec("the nurse can undo it", true);

for (const [who, x] of [["ER physician", E], ["hospitalist", H], ["nurse", N]]) {
  const kept = await x.p.evaluate(({ NAME, MRN }) => Object.keys(localStorage).concat(Object.keys(sessionStorage)).some((k) => { const v = (localStorage.getItem(k) || "") + (sessionStorage.getItem(k) || ""); return v.includes(NAME) || v.includes(MRN) || v.includes("Vandenberg"); }), { NAME, MRN });
  rec("nothing identifying is kept on the " + who + "'s device", !kept);
  rec("no page errors (" + who + ")", x.errs.length === 0, x.errs.join(" | "));
}
// Phone: the tracker with identity and bed control fits.
const M = await open("nurse", { width: 390, height: 844 }, true);
await M.p.waitForSelector("[data-staff-tile]", { timeout: 20000 }); await sleep(800);
const over = await M.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
rec("phone: tracker with identity and bed control fits", over <= 1, "overflow " + over);
if (OUT) await M.p.screenshot({ path: OUT + "/phone.png", fullPage: true });

const D = await open("director", { width: 1366, height: 900 }, false);
await D.p.evaluate(() => window.DT.actions.setNav("settings")); 
await D.p.waitForSelector("[data-adt-card]", { timeout: 20000 });
rec("Settings shows the EHR admission feed, honestly off until DocTurn switches it on", await D.p.locator("[data-adt-off]").count() === 1);
rec("no page errors (director)", D.errs.length === 0, D.errs.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
