/**
 * Per-org session policy + "sign out everywhere" (E2, module
 * `enterprise.sessionPolicy`) in REAL Chromium on emulated iPhones
 * (375×667 / 390×844 / 430×932, DPR 3, touch, iPhone Safari UA), measured
 * against the server's answer:
 *
 *   M. Module OFF (the default): Settings has no Session policy card and no
 *      "Sign out everywhere else" row, People offers no sign-out action, and
 *      both routes answer 404 module_disabled.
 *   R. Module ON: the card is the SERVER's (stored / in force / bounds); one
 *      choice is one PUT and the toast says what is now enforced; "Back to
 *      the default" clears it; the page's own idle auto-lock window becomes
 *      the org's (window.DT idleLockMinutes), not 15 minutes.
 *   C. Sessions per person = 1: signing in as the same person in a SECOND
 *      browser ends the first — which lands on the sign-in screen saying it
 *      was signed out because of another device, from the socket close.
 *   E. "Sign out everywhere else" in Settings ends the other browser and
 *      keeps this one.
 *   P. People → sign a person out of every device: their open app returns to
 *      the sign-in screen; their account still works (they sign in again).
 *   L. Layout at every width (≥44px targets, ≥16px selects, no overflow);
 *      Z. zero CSP violations / page errors.
 *   Q. (REAL_BASE_URL) SYNTHETIC_DATA=false: a fresh tenant has it off, and
 *      switched on it reports the platform defaults until a director changes
 *      them.
 *
 *   BASE_URL=http://127.0.0.1:9066 [REAL_BASE_URL=… REAL_DEV_PASSWORD=…] \
 *     node scripts/session-policy-check.mjs
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const REAL = process.env.REAL_BASE_URL || "";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const PW = process.env.DEV_PASSWORD || "docturn";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const SIZES = { 375: 667, 390: 844, 430: 932 };
const MODULE = "enterprise.sessionPolicy";
const results = [];
const rec = (name, ok, note = "") => { results.push([name, !!ok]); console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  -> " + note : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csp = [];
const pageErrors = [];
const RUN = Date.now().toString(36).slice(-4).toUpperCase().replace(/[^A-Z0-9]/g, "Q");

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

async function apiSession(base, orgCode, username, password = PW) {
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgCode, username, password }) });
  if (!r.ok) throw new Error("login " + username + " " + r.status);
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, text, json };
  };
}

async function open(base, width, org, username, password = PW) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const apiLog = [];
  page.on("pageerror", (e) => pageErrors.push(username + "@" + width + ": " + String((e && e.message) || e)));
  page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(username + ": " + t.slice(0, 160)); });
  page.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) apiLog.push({ m: r.request().method(), p: u.pathname + u.search, s: r.status(), body: r.request().postData() }); });
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.log("Refused to load (CSP) " + e.violatedDirective + " " + e.blockedURI)); });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle" });
  const inputs = await page.locator("input").all();
  await inputs[0].fill(org);
  await inputs[1].fill(username);
  await inputs[2].fill(password);
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role && s.modules); }, null, { timeout: 30000 });
  await sleep(900);
  return { ctx, page, apiLog, width, username };
}

const nav = async (page, id, settle = 1600) => { await page.evaluate((n) => window.DT.actions.setNav(n), id); await sleep(settle); };
const signedOut = (page) => page.evaluate(() => { const s = window.DT.getState(); return { session: !!s.session, error: s.loginError || null }; });

/** What the Settings screen offers right now. */
const card = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-session-policy]");
    const fields = [...document.querySelectorAll("[data-session-policy-field]")].map((f) => {
      const r = f.getBoundingClientRect();
      return { key: f.getAttribute("data-session-policy-field"), value: f.value, h: Math.round(r.height), font: Math.round(parseFloat(getComputedStyle(f).fontSize)), right: Math.round(r.right), options: [...f.options].map((o) => o.text) };
    });
    const small = [];
    for (const b of document.querySelectorAll("[data-sign-out-everywhere] button, [data-session-policy-clear]")) {
      const r = b.getBoundingClientRect();
      if (r.width > 0 && (r.height < 43.5 || r.width < 43.5)) small.push((b.textContent || "").trim() + " " + Math.round(r.width) + "x" + Math.round(r.height));
    }
    return {
      present: !!el,
      state: el && el.getAttribute("data-session-policy"),
      text: el ? el.closest("div").parentElement.innerText.replace(/\s+/g, " ").trim().slice(0, 600) : "",
      fields,
      small,
      signOutRow: !!document.querySelector("[data-sign-out-everywhere]"),
      clear: !!document.querySelector("[data-session-policy-clear]"),
      vw: innerWidth,
      doc: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    };
  });

async function choose(page, key, value) {
  await page.evaluate(() => { window.DT.set((s) => { s.__toast = null; return s; }); });
  await page.selectOption(`[data-session-policy-field="${key}"]`, String(value));
  await page.waitForFunction(() => !!window.DT.getState().__toast, null, { timeout: 15000 });
  await sleep(250);
  return page.evaluate(() => {
    const t = window.DT.getState().__toast;
    return { title: t.title, msg: t.msg, onScreen: document.body.innerText.includes(t.title) };
  });
}

// Re-created after any leg that could evict it: "sessions per person = 1"
// applies to the director too, and this is the OLDEST director session.
let director = await apiSession(BASE, "ISPN", "director");
const dev = await apiSession(BASE, "DOCTURN", "dev");
const orgId = (await director("GET", "/api/user")).json.organizationId;
const setModule = async (enabled, org = orgId, id = MODULE) => {
  const r = await dev("PATCH", "/api/dev/modules/" + org, { id, enabled });
  if (r.status !== 200) throw new Error("module flip " + r.status + " " + r.text);
};
const policy = async () => (await director("GET", "/api/org/session-policy")).json;

try {
  // ── M. module OFF ────────────────────────────────────────────────────────
  await setModule(false);
  console.log("\n=== " + MODULE + " OFF ===");
  {
    const h = await open(BASE, 390, "ISPN", "director");
    await nav(h.page, "account", 2200);
    const c = await card(h.page);
    rec("M: no Session policy card and no sign-out-everywhere row", !c.present && !c.signOutRow, JSON.stringify({ present: c.present, row: c.signOutRow }));
    await nav(h.page, "people", 2400);
    // The actions live in each person's Manage panel — open one to look.
    await h.page.locator('[data-person] button[aria-label^="Manage"]').first().click().catch(() => {});
    await sleep(300);
    const people = await h.page.evaluate(() => ({
      rows: document.querySelectorAll("[data-person]").length,
      panel: document.querySelectorAll("[data-manage-panel] button").length,
      signOut: [...document.querySelectorAll("[data-person] button")].filter((b) => /sign .* out of every device/i.test(b.getAttribute("title") || "")).length,
    }));
    rec("M: People offers no sign-out-everywhere action", people.rows > 0 && people.panel > 0 && people.signOut === 0, JSON.stringify(people));
    await h.ctx.close();
    rec("M: GET /api/org/session-policy is 404 module_disabled", (await director("GET", "/api/org/session-policy")).status === 404);
    const soe = await director("POST", "/api/account/sessions/revoke-all", {});
    rec("M: POST /api/account/sessions/revoke-all is 404 module_disabled", soe.status === 404 && soe.json.module === MODULE, soe.status + " " + soe.text.slice(0, 60));
  }

  // ── R / L. module ON, every width ────────────────────────────────────────
  await setModule(true);
  console.log("\n=== " + MODULE + " ON ===");
  for (const width of [375, 390, 430]) {
    const h = await open(BASE, width, "ISPN", "director");
    await nav(h.page, "account", 2400);
    let c = await card(h.page);
    rec(`R[${width}]: the card and the sign-out row are offered`, c.present && c.signOutRow && c.fields.length === 3, JSON.stringify({ present: c.present, row: c.signOutRow, fields: c.fields.map((f) => f.key) }));
    rec(`R[${width}]: it describes the platform default until it is set`, /platform default/i.test(c.text), c.text.slice(0, 160));
    rec(`L[${width}]: every select is ≥44px tall with ≥16px text, inside the viewport`, c.fields.every((f) => f.h >= 43.5 && f.font >= 16 && f.right <= c.vw + 0.5), JSON.stringify(c.fields.map((f) => [f.key, f.h, f.font, f.right])));
    rec(`L[${width}]: every button is a ≥44px target`, c.small.length === 0, c.small.join(" | "));
    rec(`L[${width}]: no horizontal overflow`, c.doc <= c.vw, JSON.stringify({ doc: c.doc, vw: c.vw }));

    if (width === 390) {
      const t = await choose(h.page, "idleMinutes", 30);
      rec("R: choosing 30 minutes — the toast is the server's own answer", t.title === "Session policy updated" && /30 minutes idle/.test(t.msg) && t.onScreen, JSON.stringify(t));
      const srv = await policy();
      rec("R: the server stored it and reports it in force", srv.stored === true && srv.policy.idleMinutes === 30 && srv.effective.idleMinutes === 30, JSON.stringify(srv.policy));
      const t2 = await choose(h.page, "maxConcurrent", 2);
      rec("R: sessions-per-person says the oldest ends", /2 sessions at a time per person \(the oldest ends\)/.test(t2.msg), t2.msg);
      // The page's own idle auto-lock window is the org's, from the server.
      await h.page.reload({ waitUntil: "networkidle" });
      await h.page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session); }, null, { timeout: 30000 });
      await sleep(1200);
      const idle = await h.page.evaluate(() => window.DT.getState().idleLockMinutes);
      rec("R: the page's idle auto-lock window is the org's 30 minutes", idle === 30, String(idle));
      // Clear it.
      await nav(h.page, "account", 2200);
      await h.page.evaluate(() => { window.DT.set((s) => { s.__toast = null; return s; }); });
      await h.page.click("[data-session-policy-clear]");
      await h.page.waitForFunction(() => !!window.DT.getState().__toast, null, { timeout: 15000 });
      const cleared = await h.page.evaluate(() => window.DT.getState().__toast);
      rec("R: 'Back to the default' clears all three and says what is in force", /15 minutes idle/.test(cleared.msg) && !/at a time/.test(cleared.msg), JSON.stringify(cleared));
      const after = await policy();
      rec("R: the server has no stored policy again", after.stored === false && after.effective.idleMinutes === 15, JSON.stringify(after.effective));
      c = await card(h.page);
      rec("R: and the clear button is gone", c.clear === false, String(c.clear));
    }
    await h.ctx.close();
  }

  // ── C. sessions per person = 1 ───────────────────────────────────────────
  console.log("\n=== sessions per person = 1 ===");
  {
    await director("PUT", "/api/org/session-policy", { maxConcurrent: 1 });
    const first = await open(BASE, 390, "ISPN", "chen");
    const second = await open(BASE, 390, "ISPN", "chen");
    // The second sign-in's first authenticated request evicts the first.
    await second.page.evaluate(() => fetch("/api/user", { credentials: "include" }));
    await first.page.waitForFunction(() => !window.DT.getState().session, null, { timeout: 30000 }).catch(() => {});
    const out = await signedOut(first.page);
    rec("C: the oldest session is signed out", out.session === false, JSON.stringify(out));
    rec("C: and it says WHY (another device, the organization's limit)", /signed in on another device/i.test(out.error || ""), out.error || "(no message)");
    const stillIn = await signedOut(second.page);
    rec("C: the newest session keeps working", stillIn.session === true);
    // …and the rule applies to the director as well: this script's own
    // director session is the oldest one, so it was evicted too. Prove it,
    // then take a fresh one to clear the policy.
    const evictedDirector = await director("GET", "/api/user");
    rec("C: it applies to a director too (this script's own session was evicted)", evictedDirector.status === 401 && evictedDirector.json && evictedDirector.json.reason === "max_concurrent", evictedDirector.status + " " + evictedDirector.text.slice(0, 80));
    await first.ctx.close();
    await second.ctx.close();
    director = await apiSession(BASE, "ISPN", "director");
    const cleared = await director("DELETE", "/api/org/session-policy");
    rec("C: a fresh director session clears the policy", cleared.status === 200, String(cleared.status));
  }

  // ── E. sign out everywhere else ──────────────────────────────────────────
  console.log("\n=== sign out everywhere else ===");
  {
    const mine = await open(BASE, 390, "ISPN", "chen");
    const other = await open(BASE, 390, "ISPN", "chen");
    await nav(mine.page, "account", 2200);
    await mine.page.evaluate(() => { window.DT.set((s) => { s.__toast = null; return s; }); });
    await mine.page.click("[data-sign-out-everywhere] button");
    await mine.page.waitForFunction(() => !!window.DT.getState().__toast, null, { timeout: 15000 });
    const t = await mine.page.evaluate(() => window.DT.getState().__toast);
    rec("E: the toast reports the server's count and that this device stays in", /This device stays signed in/.test(t.msg), JSON.stringify(t));
    rec("E: this session still works", (await signedOut(mine.page)).session === true);
    await other.page.waitForFunction(() => !window.DT.getState().session, null, { timeout: 30000 }).catch(() => {});
    const gone = await signedOut(other.page);
    rec("E: the other device is signed out, and told it was everywhere", gone.session === false && /signed out everywhere/i.test(gone.error || ""), JSON.stringify(gone));
    await mine.ctx.close();
    await other.ctx.close();
  }

  // ── P. People → sign a person out of every device ────────────────────────
  console.log("\n=== People → sign out of every device ===");
  {
    const chen = await open(BASE, 390, "ISPN", "chen");
    const dir = await open(BASE, 390, "ISPN", "director");
    await nav(dir.page, "people", 2600);
    await dir.page.locator('[data-person="chen"] button[aria-label^="Manage"]').click();
    await sleep(300);
    const clicked = await dir.page.evaluate(() => {
      const btn = [...document.querySelectorAll("[data-person] button")].find((b) => /^Sign Dr\..*out of every device$/i.test(b.getAttribute("title") || "") && /chen|Alyesh|Nathan/i.test(b.closest("[data-person]").getAttribute("data-person") + b.closest("[data-person]").innerText));
      if (!btn) return null;
      btn.click();
      return btn.getAttribute("title");
    });
    rec("P: the action is offered on the person's row", !!clicked, clicked || "not found");
    await dir.page.waitForFunction(() => !!window.DT.getState().__toast, null, { timeout: 15000 }).catch(() => {});
    const t = await dir.page.evaluate(() => window.DT.getState().__toast || null);
    rec("P: the toast names them and says the account still works", !!t && /account still works/.test(t.msg), t ? JSON.stringify(t) : "no toast");
    await chen.page.waitForFunction(() => !window.DT.getState().session, null, { timeout: 30000 }).catch(() => {});
    rec("P: their open app returns to the sign-in screen", (await signedOut(chen.page)).session === false);
    rec("P: and the account still signs in", (await apiSession(BASE, "ISPN", "chen")) !== null);
    await chen.ctx.close();
    await dir.ctx.close();
  }

  // ── Q. a non-synthetic server ────────────────────────────────────────────
  if (REAL) {
    console.log("\n=== real server " + REAL + " ===");
    const rdev = await apiSession(REAL, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD || PW);
    const cfg = (await rdev("GET", "/api/config")).json;
    rec("Q (setup): the server is SYNTHETIC_DATA=false", cfg && cfg.syntheticData === false, String(cfg && cfg.syntheticData));
    const code = "SP" + RUN;
    const o = (await rdev("POST", "/api/dev/organizations", { name: "Session Policy " + RUN, code, timezone: "America/Chicago" })).json;
    const made = (await rdev("POST", "/api/dev/users", { organizationId: o.id, role: "director", username: "sp.dir", displayName: "Dr. Policy Check" })).json;
    const NEWPW = "Policy-Check-2026!";
    const first = await apiSession(REAL, code, "sp.dir", made.temporaryPassword);
    await first("PATCH", "/api/account/password", { currentPassword: made.temporaryPassword, newPassword: NEWPW });
    const rdir = await apiSession(REAL, code, "sp.dir", NEWPW);
    rec("Q: a fresh tenant has session policy off", (await rdir("GET", "/api/org/session-policy")).status === 404);
    await rdev("PATCH", `/api/dev/modules/${o.id}`, { id: MODULE, enabled: true });
    const on = (await rdir("GET", "/api/org/session-policy")).json;
    rec("Q: switched on it reports the platform defaults, nothing stored", on.stored === false && on.effective.idleMinutes === 15 && on.effective.maxConcurrent === null, JSON.stringify(on.effective));
    const bad = await rdir("PUT", "/api/org/session-policy", { idleMinutes: 1 });
    rec("Q: the server refuses a value outside its own bounds", bad.status === 400, String(bad.status));
  }
} finally {
  // A fresh session: an earlier leg may have evicted the one above.
  await apiSession(BASE, "ISPN", "director")
    .then((d) => d("DELETE", "/api/org/session-policy"))
    .catch(() => {});
  await setModule(false).catch(() => {});
  await browser.close();
}

rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
