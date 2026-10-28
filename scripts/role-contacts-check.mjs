/**
 * Role contacts (PerfectServe parity #1), measured in REAL Chromium on
 * emulated iPhones (375×667 / 390×844 / 430×932, DPR 3, touch, iPhone Safari
 * UA) against the server's answer, not the screen's claim:
 *
 *   R. Directory → Role contacts lists exactly the server's role contacts
 *      (GET /api/messaging/role-contacts): a role a director put on the
 *      manual schedule with two people shows both, with the server's live
 *      presence; a slot naming nobody in the org is not shown; Message is ONE
 *      direct-conversation write to the role's server target and lands on
 *      the thread.
 *   M. routing.roleMessaging off (and oncall.board off, which it requires):
 *      the section is gone, the page asks for nothing, the server says 404.
 *   Q. (REAL_BASE_URL) a SYNTHETIC_DATA=false server: a fresh tenant with no
 *      schedule data shows no role contacts at all; one manual slot later the
 *      role appears with its real holder.
 *   L. Layout of the section at every width; Z. zero CSP violations / page errors.
 *
 *   BASE_URL=http://127.0.0.1:8801 [REAL_BASE_URL=… REAL_DEV_PASSWORD=…] node scripts/role-contacts-check.mjs
 * BASE_URL: a seeded synthetic server with RATE_LIMIT=off. Exits non-zero on failure.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const REAL = process.env.REAL_BASE_URL || "";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const PW = process.env.DEV_PASSWORD || "docturn";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const SIZES = { 375: 667, 390: 844, 430: 932 };
const results = [];
const rec = (name, ok, note = "") => { results.push([name, !!ok]); console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  ↳ " + note : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const csp = [];
const pageErrors = [];
const RUN = Date.now().toString(36).slice(-4).toUpperCase().replace(/[^A-Z]/g, "Q");

async function open(base, width, org, username, password = PW) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const apiLog = [];
  page.on("pageerror", (e) => pageErrors.push(username + "@" + width + ": " + String((e && e.message) || e)));
  page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(username + ": " + t.slice(0, 160)); });
  page.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) apiLog.push({ m: r.request().method(), p: u.pathname, s: r.status(), body: r.request().postData() }); });
  await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.log("Refused to load (CSP) " + e.violatedDirective + " " + e.blockedURI)); });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle" });
  const inputs = await page.locator("input").all();
  await inputs[0].fill(org);
  await inputs[1].fill(username);
  await inputs[2].fill(password);
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
  await sleep(1500);
  const api = (method, path, body) => page.evaluate(([m, p, b]) => fetch(p, { method: m, credentials: "include", headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })), [method, path, body]);
  return { ctx, page, apiLog, api, base, width };
}
const nav = async (page, id, settle = 1500) => { await page.evaluate((n) => window.DT.actions.setNav(n), id); await sleep(settle); };
async function reload(page) {
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
  await sleep(2000);
}
async function waitFor(fn, ms = 10000, step = 200) {
  const t = Date.now();
  let v;
  while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(step); }
  return v;
}
async function layout(page, selectors) {
  return page.evaluate((sels) => {
    const vw = window.innerWidth;
    const out = { overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw, small: [], tinyInputs: [], offscreen: [], found: 0 };
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    for (const root of sels.flatMap((s) => [...document.querySelectorAll(s)])) {
      out.found++;
      const rr = root.getBoundingClientRect();
      if (rr.right > vw + 0.5) out.offscreen.push("panel right=" + Math.round(rr.right));
      for (const el of root.querySelectorAll('button, [role="button"], select, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"])')) {
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).trim().slice(0, 30);
        const isInput = el.tagName === "INPUT" || el.tagName === "SELECT";
        if (r.height < 43.5 || (!isInput && r.width < 43.5)) out.small.push(label + " " + Math.round(r.width) + "x" + Math.round(r.height));
        if (isInput && parseFloat(getComputedStyle(el).fontSize) < 16) out.tinyInputs.push(label);
        if (r.right > vw + 0.5) out.offscreen.push(label + " right=" + Math.round(r.right));
      }
    }
    return out;
  }, selectors);
}
async function checkLayout(page, label, selectors) {
  const m = await layout(page, selectors);
  rec(`L: ${label} — panels present`, m.found > 0, "found=" + m.found);
  rec(`L: ${label} — no horizontal page overflow`, m.overflow <= 0, "overflow=" + m.overflow + "px");
  rec(`L: ${label} — every control ≥ 44×44`, m.small.length === 0, m.small.slice(0, 6).join(" | "));
  rec(`L: ${label} — inputs/selects ≥ 16px`, m.tinyInputs.length === 0, m.tinyInputs.slice(0, 4).join(" | "));
  rec(`L: ${label} — nothing past the right edge`, m.offscreen.length === 0, m.offscreen.slice(0, 4).join(" | "));
}
const onScreen = (page) => page.evaluate(() => [...document.querySelectorAll("[data-role-contact]")].map((el) => ({
  role: el.getAttribute("data-role-contact"),
  label: (el.querySelector("[data-role-label]") || {}).textContent || "",
  holders: [...el.querySelectorAll("[data-role-holder]")].map((h) => ({ id: Number(h.getAttribute("data-role-holder")), presence: h.getAttribute("data-presence") })),
})));
const sameRoles = (screen, srv) => screen.length === srv.length && srv.every((r, i) => screen[i] && screen[i].role === r.role && screen[i].label === r.label
  && JSON.stringify(screen[i].holders.map((h) => h.id)) === JSON.stringify(r.holders.map((h) => h.userId)));

console.log("== synthetic server " + BASE);
{
  const dev = await open(BASE, 430, "DOCTURN", "dev");
  const ispn = (await dev.api("GET", "/api/dev/organizations")).json.find((o) => o.code === "ISPN");
  for (const id of ["oncall.board", "routing.roleMessaging"]) await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id, enabled: true });
  const D = await open(BASE, 390, "ISPN", "director");
  const dir = (await D.api("GET", "/api/physicians/directory")).json;
  const E0 = await open(BASE, 430, "ISPN", "er.doc");
  const erMe = (await E0.api("GET", "/api/user")).json;
  await E0.ctx.close();
  const two = dir.filter((d) => d.userId !== erMe.id).slice(0, 2);
  const ROLE = "RC " + RUN + " call";
  const src = await D.api("PATCH", "/api/oncall/source", { source: "manual" });
  const s1 = await D.api("POST", "/api/oncall/manual", { slot: ROLE, providerName: two[0].displayName });
  const s2 = await D.api("POST", "/api/oncall/manual", { slot: ROLE, providerName: two[1].displayName });
  const s3 = await D.api("POST", "/api/oncall/manual", { slot: "RC " + RUN + " ghost", providerName: "Nobody " + RUN });
  rec("R (setup) manual list selected; two people and one unknown name on the schedule", src.status === 200 && s1.status === 201 && s2.status === 201 && s3.status === 201, [src.status, s1.status, s2.status, s3.status].join("/"));

  for (const width of [375, 390, 430]) {
    const E = await open(BASE, width, "ISPN", "er.doc");
    await nav(E.page, "directory", 2500);
    const srv = (await E.api("GET", "/api/messaging/role-contacts")).json;
    const pres = (await E.api("GET", "/api/presence")).json;
    const mine = srv.find((r) => r.label === ROLE);
    const screen = await waitFor(async () => { const s = await onScreen(E.page); return s.some((r) => r.label === ROLE) ? s : null; }, 10000);
    rec(`R @${width}: the server resolves the role with both people`, mine && mine.holders.length === 2 && mine.holders.every((h) => two.some((t) => t.userId === h.userId)), JSON.stringify(mine && mine.holders.map((h) => h.userId)));
    rec(`R @${width}: the screen lists exactly the server's role contacts, holders in order`, screen && sameRoles(screen, srv), JSON.stringify((screen || []).map((r) => r.label)) + " vs " + JSON.stringify(srv.map((r) => r.label)));
    rec(`R @${width}: the unresolvable slot is on neither`, !srv.some((r) => /ghost/.test(r.label)) && !(screen || []).some((r) => /ghost/.test(r.label)));
    const row = (screen || []).find((r) => r.label === ROLE);
    const expectP = (id) => (pres.live ? (pres.online.includes(id) ? "online" : "offline") : "unknown");
    rec(`R @${width}: each holder's presence dot = the server's /api/presence`, row && row.holders.every((h) => h.presence === expectP(h.id)), JSON.stringify(row && row.holders) + " live=" + pres.live);
    await checkLayout(E.page, `role contacts @${width}`, ["[data-role-contacts]"]);
    if (width === 390) {
      const mark = E.apiLog.length;
      await E.page.locator(`[data-role-contact="${mine.role}"] button[aria-label^="Message"]`).click();
      await sleep(2500);
      const posts = E.apiLog.slice(mark).filter((r) => r.m !== "GET");
      const convos = (await E.api("GET", "/api/messaging/conversations")).json;
      const st = await E.page.evaluate(() => ({ nav: window.DT.getState().ui.nav, active: window.DT.getState().__activeConvo }));
      const active = convos.find((c) => c.id === st.active);
      rec("R: Message opens a direct thread with the role's server target", active && active.type === "direct" && active.participantIds.includes(mine.target.userId) && active.participantIds.length === 2, JSON.stringify(active && active.participantIds) + " target=" + mine.target.userId);
      rec("R: … with at most one write (POST /api/messaging/conversations, or none when the thread exists)", posts.length <= 1 && posts.every((p) => p.p === "/api/messaging/conversations" && p.s === 201 && JSON.parse(p.body).participantIds[0] === mine.target.userId), posts.map((p) => p.m + " " + p.p + " " + p.s).join(", "));
      rec("R: … and lands on Messages", st.nav === "messages", st.nav);
      // The compose picker lists the same role per person, told apart by who it reaches.
      const backBtn = E.page.locator('button[aria-label="Back to conversations"]');
      if (await backBtn.count()) { await backBtn.click(); await sleep(600); }
      await E.page.locator('h2:has-text("Messages") + button').click(); // the compose (pencil) button
      await sleep(2000);
      const picker = await E.page.evaluate((ids) => ids.map((id) => { const el = document.querySelector(`[data-role-target="${id}"]`); return el ? (el.querySelector("[data-role-target-holder]") || {}).textContent : null; }), mine.holders.map((h) => h.targetId));
      const names = mine.holders.map((h) => h.name);
      rec("R: the compose picker shows the role once per person, each naming who it reaches", picker.every((t, i) => t && t.includes(names[i])) && new Set(picker).size === picker.length, JSON.stringify(picker));
    }
    await E.ctx.close();
  }

  // M. module off → no section, no request; the board off takes it down too.
  for (const id of ["routing.roleMessaging", "oncall.board"]) {
    const off = await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id, enabled: false });
    const E = await open(BASE, 390, "ISPN", "er.doc");
    const mark = E.apiLog.length;
    await nav(E.page, "directory", 2500);
    const asked = E.apiLog.slice(mark).some((r) => r.p === "/api/messaging/role-contacts");
    const shown = await E.page.evaluate(() => !!document.querySelector("[data-role-contacts]"));
    const srv = await E.api("GET", "/api/messaging/role-contacts");
    rec(`M ${id} off: no section, no request, the server answers 404 module_disabled`, off.status === 200 && !shown && !asked && srv.status === 404 && srv.json.error === "module_disabled", `shown=${shown} asked=${asked} status=${srv.status}`);
    await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id, enabled: true });
    await E.ctx.close();
  }
  // Leave the schedule as we found it.
  const slots = (await D.api("GET", "/api/oncall/manual")).json;
  for (const s of (slots.slots || slots || [])) if (/^RC /.test(s.slot)) await D.api("DELETE", `/api/oncall/manual/${s.id}`);
  await D.ctx.close(); await dev.ctx.close();
}

if (REAL) {
  console.log("== real server " + REAL);
  const dev = await open(REAL, 390, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD);
  const cfg = (await dev.api("GET", "/api/config")).json;
  rec("Q (setup) server is SYNTHETIC_DATA=false", cfg && cfg.syntheticData === false);
  const NEWPW = "Role-Contacts-2026!";
  const code = "RC" + RUN;
  const o = (await dev.api("POST", "/api/dev/organizations", { name: "Role Check " + RUN, code, timezone: "America/Chicago" })).json;
  const people = [
    { role: "director", username: "rc.dir", displayName: "Dr. Rc Director", credential: "MD" },
    { role: "er_doctor", username: "rc.er", displayName: "Dr. Rc Er", credential: "MD" },
    { role: "hospitalist", username: "rc.hosp", displayName: "Dr. Rc Hospitalist", credential: "MD", specialty: "Hospital Medicine", shiftType: "day", patientCap: 12 },
  ];
  for (const u of people) {
    const r = await dev.api("POST", "/api/dev/users", { organizationId: o.id, ...u });
    const temp = r.json && r.json.temporaryPassword;
    if (temp) {
      const ctx = await browser.newContext(); const pg = await ctx.newPage();
      await pg.goto(REAL + "/", { waitUntil: "domcontentloaded" });
      await pg.evaluate(async ([t, n, un, oc]) => {
        const j = (m, path, b) => fetch(path, { method: m, credentials: "include", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((x) => x.status);
        return [await j("POST", "/api/login", { orgCode: oc, username: un, password: t }), await j("PATCH", "/api/account/password", { currentPassword: t, newPassword: n }), await j("POST", "/api/logout")];
      }, [temp, NEWPW, u.username, code]);
      await ctx.close();
    }
  }
  await dev.ctx.close();
  const E = await open(REAL, 375, code, "rc.er", NEWPW);
  await nav(E.page, "directory", 2500);
  const srv0 = (await E.api("GET", "/api/messaging/role-contacts")).json;
  const shown0 = await E.page.evaluate(() => !!document.querySelector("[data-role-contacts]"));
  rec("Q: a tenant with no schedule data — the server lists no role contacts, the screen shows no section", Array.isArray(srv0) && srv0.length === 0 && !shown0, JSON.stringify(srv0));
  const D = await open(REAL, 430, code, "rc.dir", NEWPW);
  const add = await D.api("POST", "/api/oncall/manual", { slot: "Pine call", providerName: "Dr. Rc Hospitalist" });
  rec("Q (setup) the director puts the hospitalist on the manual list", add.status === 201, "status=" + add.status);
  await reload(E.page);
  await nav(E.page, "directory", 2500);
  const srv1 = (await E.api("GET", "/api/messaging/role-contacts")).json;
  const screen1 = await waitFor(async () => { const s = await onScreen(E.page); return s.length ? s : null; }, 8000);
  rec("Q: now the one role appears, with its one real holder, on the server and the screen", srv1.length === 1 && srv1[0].label === "Pine call" && screen1 && sameRoles(screen1, srv1), JSON.stringify(screen1));
  await checkLayout(E.page, "real role contacts @375", ["[data-role-contacts]"]);
  await E.ctx.close(); await D.ctx.close();
}

await browser.close();
rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
