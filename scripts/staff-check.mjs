// Staff (charge nurse) account: its menu, the admissions tracker updating live
// when a hospitalist accepts, no physician-only controls, messaging the
// hospitalist being waited on, the phone layout, and adding staff in People.
// BASE_URL=… node scripts/staff-check.mjs
import { chromium } from "playwright-core";
const B = process.env.BASE_URL || "http://127.0.0.1:5000", OUT = process.env.OUT || ""; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let failed = 0;
const rec = (n, ok, d = "") => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
async function open(user, vp, mob) {
  const c = await browser.newContext({ viewport: vp, deviceScaleFactor: OUT ? 2 : 1, isMobile: mob, hasTouch: mob });
  const p = await c.newPage(); const errs = [], denied = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("response", (r) => { if (r.status() === 403 && r.url().includes("/api/")) denied.push(new URL(r.url()).pathname); });
  await p.goto(B + "/", { waitUntil: "networkidle" });
  const inputs = await p.locator("input").all(); await inputs[0].fill("ISPN"); await inputs[1].fill(user); await inputs[2].fill("docturn");
  await p.locator('button:has-text("Sign in")').last().click();
  await p.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
  await sleep(1500); const d = p.locator("[data-alerts-dismiss]"); if (await d.count()) await d.first().click();
  return { c, p, errs, denied };
}
const N = await open("nurse", { width: 1366, height: 900 }, false);
rec("signs in as staff", await N.p.evaluate(() => window.DT.getState().session.role) === "staff");
await N.p.waitForSelector("[data-staff-tile]", { timeout: 20000 });
const navText = await N.p.locator("nav, aside").first().innerText().catch(() => "");
rec("menu has what staff use", ["Admissions", "Codes", "Reports", "On call", "Messages", "Directory"].every((x) => navText.includes(x)), navText.replace(/\n/g, " | ").slice(0, 160));
rec("menu has nothing staff cannot use", !/Patient board|Approvals|Broadcasts|Consult services|Roles|Admissions log/.test(navText));
rec("the tracker shows the request that is waiting, and on whom", /Sent to Dr\. Nolan Avery/.test(await N.p.locator('[data-staff-open="pending"]').first().innerText()));
const open0 = Number(await N.p.textContent('[data-staff-tile="open"]')), acc0 = Number(await N.p.textContent('[data-staff-tile="accepted"]'));
rec("tiles count the board", open0 === await N.p.locator("[data-staff-open]").count() && acc0 === await N.p.locator("[data-staff-accepted]").count(), open0 + " open, " + acc0 + " accepted");
rec("no physician controls on the tracker", await N.p.locator('button:has-text("Accept"), button:has-text("Decline"), button:has-text("Reassign"), button:has-text("Route")').count() === 0);
if (OUT) await N.p.screenshot({ path: OUT + "/tracker.png" });

// The hospitalist accepts; the nurse's screen follows without a reload.
const H = await open("chen", { width: 1366, height: 900 }, false);
await H.p.locator('button:has-text("Accept")').first().click();
await N.p.waitForFunction((n) => Number((document.querySelector('[data-staff-tile="accepted"]') || {}).textContent) === n, acc0 + 1, { timeout: 20000 });
rec("when the hospitalist accepts, the tracker updates live", Number(await N.p.textContent('[data-staff-tile="open"]')) === open0 - 1);
rec("the accepted row names the hospitalist", /Dr\. Nolan Avery/.test(await N.p.locator("[data-staff-accepted]").first().innerText()));
if (OUT) await N.p.screenshot({ path: OUT + "/tracker-accepted.png" });
await H.c.close();

// Every other screen in the staff menu opens without an error.
for (const nav of ["codes", "reports", "oncall", "messages", "directory", "compliance", "appearance", "account"]) {
  await N.p.evaluate((n) => window.DT.actions.setNav(n), nav); await sleep(1200);
  const crashed = await N.p.locator("text=/Something went wrong/i").count();
  rec("staff can open " + nav, !crashed && await N.p.evaluate(() => window.DT.getState().ui.nav) === nav);
}
await N.p.evaluate(() => window.DT.actions.setNav("reports")); await N.p.waitForSelector("[data-report-table], [data-report-state]", { timeout: 20000 });
rec("staff can run the built-in reports", await N.p.locator("[data-report-tab^='builtin:']").count() === 4);
await N.p.evaluate(() => window.DT.actions.setNav("codes")); await N.p.waitForSelector("[data-code-idle], [data-code-card]", { timeout: 20000 });
rec("staff cannot manage code protocols", await N.p.locator('button:has-text("New protocol")').count() === 0);
rec("no page errors (staff)", N.errs.length === 0, N.errs.join(" | "));
rec("the app asks the server for nothing staff are refused", N.denied.length === 0, [...new Set(N.denied)].join(", "));
await N.c.close();

// Phone.
const M = await open("nurse", { width: 390, height: 844 }, true);
await M.p.waitForSelector("[data-staff-tile]", { timeout: 20000 });
const over = await M.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
rec("phone: the tracker fits", over <= 1, "overflow " + over);
if (OUT) await M.p.screenshot({ path: OUT + "/phone.png" });
rec("no page errors (phone)", M.errs.length === 0, M.errs.join(" | "));
await M.c.close();

// A director adds a staff account from People.
const D = await open("director", { width: 1366, height: 900 }, false);
await D.p.evaluate(() => window.DT.actions.setNav("directory")); await sleep(1500);
await D.p.locator('button:has-text("People")').first().click().catch(() => {}); await sleep(800);
await D.p.selectOption("main select", { label: "Nurse / staff" }).catch(() => {}); await sleep(500);
const peopleText = await D.p.locator("main").innerText();
rec("People lists the charge nurse with her job title", /Riley Morgan/.test(peopleText) && /RN · Charge nurse, ED/.test(peopleText), peopleText.replace(/\n/g, " | ").slice(-260));
await D.p.selectOption("main select", { index: 0 }).catch(() => {});
await D.p.locator('button:has-text("Add person")').first().click(); await sleep(600);
await D.p.locator('button:has-text("Nurse / staff")').first().click(); await sleep(300);
rec("the add form offers Nurse / staff with a job title", await D.p.locator("[data-staff-job-title]").count() === 1);
if (OUT) await D.p.screenshot({ path: OUT + "/add-staff.png" });
rec("no page errors (director)", D.errs.length === 0, D.errs.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
