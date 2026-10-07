/**
 * Sign-in E2E through the REAL form in real Chromium — the regression guard for
 * the launch blocker where the web/PWA login posted a demo account instead of
 * the typed credentials.
 *
 * Two backends:
 *   BASE_URL  — a synthetic instance (SYNTHETIC_DATA unset): the role picker
 *               pre-fills seeded demo accounts; typed values still win.
 *   REAL_URL  — a real-PHI instance (SYNTHETIC_DATA=false
 *               PLATFORM_ADMIN_PASSWORD=$REAL_DEV_PASSWORD): no demo affordances,
 *               empty fields, only the operator account exists, and a lost
 *               server session returns the user to sign-in instead of silently
 *               re-authenticating as somebody else.
 *
 * Run:  BASE_URL=http://127.0.0.1:3000 REAL_URL=http://127.0.0.1:3001 \
 *       REAL_DEV_PASSWORD='<the PLATFORM_ADMIN_PASSWORD>' node scripts/login-e2e.mjs
 * Exits non-zero on any failure.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const REAL = process.env.REAL_URL || null;
const REAL_PW = process.env.REAL_DEV_PASSWORD || "";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" };

const results = [];
const rec = (name, ok, note = "") => { results.push([name, ok]); console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  ↳ " + note : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const me = (page) => page.evaluate(() => fetch("/api/user", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)));
const inApp = (page) => page.waitForFunction(() => !/Sign in to|Secure access to your hospital workspace/.test(document.body.innerText), null, { timeout: 8000 }).then(() => true).catch(() => false);

const br = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

async function open(base) {
  const ctx = await br.newContext(PHONE);
  const page = await ctx.newPage();
  const posted = [];
  page.on("request", (r) => { if (r.url().endsWith("/api/login") && r.method() === "POST") { try { posted.push(JSON.parse(r.postData() || "{}")); } catch {} } });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await sleep(900);
  return { ctx, page, posted };
}
async function fillAndSubmit(page, org, user, pass) {
  const inputs = await page.locator("input").all();
  await inputs[0].fill(org); await inputs[1].fill(user); await inputs[2].fill(pass);
  await page.locator('button:has-text("Sign in")').last().click();
}

// ───────────────────────── synthetic instance ─────────────────────────
{
  const { ctx, page, posted } = await open(BASE);
  const body = await text(page);
  rec("synthetic: demo role picker is shown", /Demo as role/.test(body));
  const vals = await page.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value));
  rec("synthetic: form pre-fills the seeded demo account (ISPN / chen / password)", vals[0] === "ISPN" && vals[1] === "chen" && vals[2] === "docturn", JSON.stringify(vals.map((v, i) => (i === 2 ? (v ? "<set>" : "") : v))));
  await page.click('button:has-text("Developer")');
  const v2 = await page.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value));
  rec("synthetic: tapping a role re-fills with that role's account (Developer → DOCTURN / dev)", v2[0] === "DOCTURN" && v2[1] === "dev", JSON.stringify(v2.slice(0, 2)));
  await page.locator('button:has-text("Sign in")').last().click();
  const ok = await inApp(page);
  const u = await me(page);
  rec("synthetic: one-tap demo sign-in lands as the developer", ok && u?.username === "dev" && u?.role === "developer", `me=${u?.username}/${u?.role}`);
  rec("synthetic: the request body was the pre-filled credentials, verbatim", posted[0]?.orgCode === "DOCTURN" && posted[0]?.username === "dev" && posted[0]?.password === "docturn");
  await ctx.close();
}
{
  const { ctx, page, posted } = await open(BASE);
  await page.click('button:has-text("Hospitalist")');
  await fillAndSubmit(page, "ISPN", "patel", "docturn"); // typed user differs from the picker's default (chen)
  const ok = await inApp(page);
  const u = await me(page);
  rec("synthetic: typed username wins over the role picker (patel, not chen)", ok && u?.username === "patel", `me=${u?.username} posted=${posted[0]?.username}`);
  await ctx.close();
}

// ───────────────────────── real-PHI instance ─────────────────────────
if (!REAL) {
  console.log("\n(REAL_URL not set — real-PHI checks skipped)");
} else {
  const { ctx, page, posted } = await open(REAL);
  const body = await text(page);
  rec("real-PHI: NO demo role picker, NO demo hint", !/Demo as role|password docturn|any password/i.test(body));
  const vals = await page.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value));
  rec("real-PHI: all sign-in fields start EMPTY (no demo pre-fill, no bullet placeholder value)", vals.length >= 3 && vals.slice(0, 3).every((v) => v === ""), JSON.stringify(vals.slice(0, 3)));

  await fillAndSubmit(page, "ISPN", "chen", "docturn"); await sleep(1500);
  rec("real-PHI: the demo account does not exist — chen/docturn is rejected", !(await me(page)) && /Wrong organization code, username or password/i.test(await text(page)));

  await fillAndSubmit(page, "DOCTURN", "dev", "definitely-wrong-" + Date.now()); await sleep(1500);
  rec("real-PHI: wrong operator password is rejected (no session, generic error)", !(await me(page)) && /Wrong organization code, username or password/i.test(await text(page)));

  await fillAndSubmit(page, "DOCTURN", "dev", REAL_PW);
  const ok = await inApp(page);
  const u = await me(page);
  rec("real-PHI: operator signs in from the UI with PLATFORM_ADMIN_PASSWORD", ok && u?.username === "dev" && u?.role === "developer", `me=${u?.username}/${u?.role} mfaEnrol=${u?.mfaEnrollmentRequired}`);
  rec("real-PHI: every POST /api/login carried exactly the typed credentials", posted.length === 3 && posted.every((p) => typeof p.password === "string") && posted[2].password === REAL_PW && posted[1].username === "dev" && posted[0].username === "chen", `posts=${posted.length}`);
  rec("real-PHI: no demo role switcher in the signed-in shell", !/Switch role|Demo as role/i.test(await text(page)));

  // Server session disappears (expiry/restart/revocation). The client must NOT
  // re-login as anyone; it must return to sign-in with a clear message.
  if (ok) {
    await page.evaluate(() => fetch("/api/logout", { method: "POST", credentials: "include" }));
    const before = posted.length;
    await page.evaluate(() => { const a = window.DT && window.DT.actions; return a && a.listOnCallTargets ? a.listOnCallTargets() : (a && a.loadComplianceStatus ? a.loadComplianceStatus() : null); }).catch(() => {});
    await sleep(1500);
    const st = await page.evaluate(() => ({ session: window.DT.getState().session, err: window.DT.getState().loginError }));
    rec("real-PHI: lost server session → back to sign-in, NO automatic re-login as another account", !st.session && /session expired/i.test(st.err || "") && posted.length === before, `session=${JSON.stringify(st.session)} err=${st.err} extraLogins=${posted.length - before}`);
  }
  await ctx.close();
}

await br.close();
const failed = results.filter((r) => !r[1]).length;
console.log("\n" + (results.length - failed) + " passed, " + failed + " failed, " + results.length + " total");
process.exit(failed ? 1 : 0);
