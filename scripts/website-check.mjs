// Public website (/home): published price, live estimate, order request end to end,
// and the operator queue in the developer console. BASE_URL=… node scripts/website-check.mjs
import { chromium } from "playwright-core";
const B = process.env.BASE_URL || "http://127.0.0.1:5000"; const OUT = process.env.OUT || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const rec = (n, ok, d = "") => console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : ""));
// operator publishes a plan first (real flow)
{ const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(B + "/");
  const r = await p.evaluate(async () => { const j = (m, u, b) => fetch(u, { method: m, credentials: "include", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then(async (x) => ({ s: x.status, j: await x.json().catch(() => null) }));
    await j("POST", "/api/login", { orgCode: "DOCTURN", username: "dev", password: "docturn" });
    const a = await j("POST", "/api/dev/billing/plans", { code: "hospital", name: "Hospital", moduleIds: [], perSeatPriceCents: 4900, currency: "USD", showOnWebsite: true });
    return a.s; });
  rec("operator published a plan", r === 201, String(r)); await ctx.close(); }
for (const [w, h, mob] of [[1440, 900, false], [390, 844, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mob ? 3 : 1, isMobile: mob, hasTouch: mob });
  const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push(String(e))); page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto(B + "/home", { waitUntil: "networkidle" });
  await page.waitForSelector("[data-site-plan=hospital]");
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  rec(w + " no horizontal scroll", sw <= w, String(sw));
  const imgs = await page.evaluate(async () => { const ims = [...document.images]; for (const i of ims) { i.loading = "eager"; } await new Promise((r) => setTimeout(r, 1500)); return ims.map((i) => i.naturalWidth); });
  rec(w + " all images load", imgs.every((x) => x > 0), imgs.join(","));
  rec(w + " price from server", /\$49 \/ account \/ month/.test(await page.textContent("[data-site-plan=hospital]")));
  if (OUT) await page.screenshot({ path: OUT + "/site-" + w + "-top.png" });
  if (OUT) await page.screenshot({ path: OUT + "/site-" + w + "-full.png", fullPage: true });
  // purchase
  await page.click("[data-choose=hospital]"); await sleep(600);
  await page.fill("input[name=seats]", "30");
  const est = await page.textContent("[data-estimate]");
  rec(w + " estimate = 30 × $49", /\$1,470/.test(est), est);
  await page.click("[data-buy-submit]");
  const err = await page.textContent("[data-buy-error]");
  rec(w + " empty form refused in place", /hospital or group/.test(err), err);
  await page.fill("input[name=organizationName]", "Lakeside Health " + w);
  await page.fill("input[name=contactName]", "Pat Rivera");
  await page.fill("input[name=email]", "pat@example.org");
  await page.check("input[name=agreeTerms]");
  if (OUT) await page.screenshot({ path: OUT + "/site-" + w + "-form.png" });
  await page.click("[data-buy-submit]");
  await page.waitForSelector("[data-buy-done]", { timeout: 8000 });
  const done = await page.textContent("[data-buy-done]");
  rec(w + " request received with reference", /DT-\d{5}/.test(done), done.slice(0, 80));
  if (OUT) await page.screenshot({ path: OUT + "/site-" + w + "-done.png" });
  rec(w + " no console errors", errs.length === 0, errs.join(" | ").slice(0, 300));
  await ctx.close();
}
// operator sees it in console
{ const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
  await page.goto(B + "/", { waitUntil: "networkidle" });
  const inputs = await page.locator("input").all(); await inputs[0].fill("DOCTURN"); await inputs[1].fill("dev"); await inputs[2].fill("docturn");
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
  await sleep(1500); await page.evaluate(() => window.DT.actions.setNav("dev-billing")); await sleep(2500);
  const n = await page.locator("[data-purchase-request]").count();
  rec("console lists both requests", n === 2, String(n));
  await page.locator("[data-purchase-request]").first().locator("[data-purchase-set-contacted]").click(); await sleep(1500);
  const st = await page.locator("[data-purchase-request]").first().getAttribute("data-purchase-request");
  const label = await page.locator("[data-purchase-request]").first().locator("[data-purchase-status]").getAttribute("data-purchase-status");
  rec("mark contacted persists", label === "contacted", label);
  const pl = page.locator("[data-plan=hospital] [data-plan-website]"); rec("plan shows On website", /On website/.test(await pl.textContent()));
  await pl.click(); await sleep(1500);
  const pub = await page.evaluate(() => fetch("/api/public/plans").then((r) => r.json()));
  rec("hiding plan removes it from site", pub.plans.length === 0, JSON.stringify(pub));
  if (OUT) await page.locator("[data-purchase-requests]").screenshot({ path: OUT + "/console-orders.png" });
  await ctx.close(); }
await browser.close();
