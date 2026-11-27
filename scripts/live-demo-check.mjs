// Live demo, guided story: Go live menu, the 7 steps, the presenter's own taps
// (Accept, Acknowledge), Next, the finale and the phone layout. BASE_URL=… node scripts/live-demo-check.mjs
import { chromium } from "playwright-core";
const B = process.env.BASE_URL || "http://127.0.0.1:5000", OUT = process.env.OUT || ""; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const rec = (n, ok, d = "") => console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : ""));
async function open(user, vp, mob) {
  const c = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: mob, hasTouch: mob });
  const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(B + "/", { waitUntil: "networkidle" });
  const inputs = await p.locator("input").all(); await inputs[0].fill("ISPN"); await inputs[1].fill(user); await inputs[2].fill("docturn");
  await p.locator('button:has-text("Sign in")').last().click();
  await p.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
  await sleep(1500); const d = p.locator("[data-alerts-dismiss]"); if (await d.count()) await d.first().click();
  return { c, p, errs };
}
const title = (p) => p.textContent("[data-story-title]").catch(() => "");
// Desktop hospitalist presenter first (menu lives in the top bar).
const H = await open("chen", { width: 1366, height: 820 }, false);
await sleep(5500);
await H.p.click("[data-live-demo-start]"); await sleep(400);
rec("menu offers two modes", await H.p.locator("[data-live-demo-mode]").count() === 2);
if (OUT) await H.p.screenshot({ path: OUT + "/menu.png" });
await H.p.click("[data-live-demo-mode=story]");
await H.p.waitForSelector("[data-story-card]", { timeout: 8000 });
await sleep(2500);
rec("step 1 title", /patient arrives/i.test(await title(H.p)), await title(H.p));
if (OUT) await H.p.screenshot({ path: OUT + "/step1.png" });
await H.p.waitForSelector("[data-story-waiting]", { timeout: 40000 });
rec("your turn: Accept", /tap Accept/.test(await H.p.textContent("[data-story-waiting]")));
if (OUT) await H.p.screenshot({ path: OUT + "/step2-turn.png" });
// The presenter's card must not cover the request it asks them to accept.
const jmCard = H.p.locator("div", { hasText: "Patient JM" }).filter({ has: H.p.locator('button:has-text("Accept")') }).last();
const acc = jmCard.locator('button:has-text("Accept")').first();
const ab = await acc.boundingBox(), cb = await H.p.locator("[data-story-card]").boundingBox();
rec("story card does not cover JM's Accept", ab && cb && (ab.x + ab.width <= cb.x || ab.y + ab.height <= cb.y), JSON.stringify({ ab, cb }));
await acc.click();
await H.p.waitForFunction(() => { const t = document.querySelector("[data-story-title]"); return t && /Cardiology/.test(t.textContent); }, null, { timeout: 40000 });
rec("after accepting, story moves to the consult", true);
if (OUT) await H.p.screenshot({ path: OUT + "/step3.png" });
await H.p.click("[data-story-next]");
await H.p.waitForFunction(() => /consultant answers/i.test((document.querySelector("[data-story-title]") || {}).textContent || ""), null, { timeout: 15000 });
rec("Next skips ahead", true);
await H.p.waitForFunction(() => /urgent/i.test((document.querySelector("[data-story-title]") || {}).textContent || ""), null, { timeout: 40000 });
await H.p.waitForSelector("[data-story-waiting]", { timeout: 20000 });
rec("follow opened Messages", await H.p.evaluate(() => window.DT.getState().ui.nav) === "messages");
await sleep(1500);
if (OUT) await H.p.screenshot({ path: OUT + "/step5-turn.png" });
// open the STAT thread and acknowledge
await H.p.locator("[data-row-stat]").first().click().catch(() => {});
await sleep(1200);
await H.p.locator("[data-ack]").first().click();
await H.p.waitForFunction(() => /acknowledged/i.test((document.querySelector("[data-story-title]") || {}).textContent || ""), null, { timeout: 30000 });
rec("after Acknowledge, story moves on", true);
if (OUT) await H.p.screenshot({ path: OUT + "/step6.png" });
await H.p.waitForFunction(() => /complete/i.test((document.querySelector("[data-story-card]") || {}).textContent || ""), null, { timeout: 60000 });
if (OUT) await H.p.screenshot({ path: OUT + "/done.png" });
rec("story completes with Replay / Keep it busy", await H.p.locator("[data-story-replay]").count() === 1 && await H.p.locator("[data-story-free]").count() === 1);
await H.p.click("[data-story-free]"); await sleep(1500);
rec("Keep it busy switches to free play", await H.p.locator("[data-story-card]").count() === 0 && await H.p.locator("[data-live-demo-ticker]").count() === 1);
await H.p.click("[data-live-demo-stop]"); await sleep(800);
rec("no page errors", H.errs.length === 0, H.errs.join("|").slice(0, 300));
// Phone layout of the card
const P = await open("director", { width: 390, height: 844 }, true);
await sleep(5500);
await P.p.evaluate(() => window.DT.actions.setLiveDemo(true, "steady", "story"));
await P.p.waitForSelector("[data-story-card]", { timeout: 10000 }); await sleep(3000);
const box = await P.p.locator("[data-story-card]").boundingBox();
rec("phone card fits the screen", box && box.x >= 0 && box.x + box.width <= 390 && box.y > 0, JSON.stringify(box));
rec("phone no horizontal scroll", await P.p.evaluate(() => document.documentElement.scrollWidth) <= 390);
if (OUT) await P.p.screenshot({ path: OUT + "/phone.png" });
await P.p.evaluate(() => window.DT.actions.setLiveDemo(false));
rec("phone no page errors", P.errs.length === 0, P.errs.join("|").slice(0, 300));
await browser.close();
