/**
 * Favorites + recently contacted (PerfectServe parity #2), measured in REAL
 * Chromium on emulated iPhones (375×667 / 390×844 / 430×932, DPR 3, touch,
 * iPhone Safari UA) against the server's answer:
 *
 *   F. Directory opens with Favorites, Recently contacted (= GET
 *      /api/directory/recents, in order), Role contacts, then the provider
 *      directory. A star on a person or a role is ONE server write and the
 *      Favorites section shows what the server stores; a second device shows
 *      the same; unstar is one DELETE. Message on a recent person reopens that
 *      thread (no new conversation).
 *   M. directory.favorites off: no star, no section, no request; 404.
 *   Q. (REAL_BASE_URL) SYNTHETIC_DATA=false: a fresh tenant has no favorites
 *      or recents; one real message makes a recent; a star stores it.
 *   L. Layout at every width; Z. zero CSP violations / page errors.
 *
 *   BASE_URL=http://127.0.0.1:8811 [REAL_BASE_URL=… REAL_DEV_PASSWORD=…] node scripts/favorites-check.mjs
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

const favState = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const order = ["[data-favorites]", "[data-recents]", "[data-role-contacts]"].map((s) => q(s)).filter(Boolean);
  const h2 = [...document.querySelectorAll("h2")].find((h) => /Provider directory/.test(h.textContent));
  const pos = (el) => (el ? el.getBoundingClientRect().top + window.scrollY : null);
  return {
    favorites: [...document.querySelectorAll("[data-favorites] [data-favorite]")].map((b) => b.getAttribute("data-favorite")),
    recents: [...document.querySelectorAll("[data-recents] [data-person-row]")].map((r) => Number(r.getAttribute("data-person-row"))),
    stars: [...document.querySelectorAll("[data-favorite]")].map((b) => ({ key: b.getAttribute("data-favorite"), on: b.getAttribute("aria-pressed") === "true" })),
    tops: order.map(pos).concat([pos(h2)]),
  };
});
const sortedOk = (tops) => tops.every((t, i) => i === 0 || t == null || tops[i - 1] == null || t > tops[i - 1]);
const srvFavKeys = async (P) => ((await P.api("GET", "/api/directory/favorites")).json.favorites || []).map((f) => f.targetKind + ":" + f.targetId);
const writes = (log, from = 0) => log.slice(from).filter((r) => r.m !== "GET");

console.log("== synthetic server " + BASE);
{
  const dev = await open(BASE, 430, "DOCTURN", "dev");
  const ispn = (await dev.api("GET", "/api/dev/organizations")).json.find((o) => o.code === "ISPN");
  for (const id of ["directory.favorites", "routing.roleMessaging", "oncall.board"]) await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id, enabled: true });

  // A conversation so er.doc has someone recently contacted.
  const E0 = await open(BASE, 430, "ISPN", "er.doc");
  const dir = (await E0.api("GET", "/api/physicians/directory")).json;
  const target = dir[0];
  const c = (await E0.api("POST", "/api/messaging/conversations", { type: "direct", participantIds: [target.userId] })).json;
  await E0.api("POST", "/api/messaging/send", { conversationId: c.id, content: "favorites check " + RUN });
  await E0.ctx.close();

  for (const width of [375, 390, 430]) {
    const E = await open(BASE, width, "ISPN", "er.doc");
    for (const k of await srvFavKeys(E)) { const [kind, ...rest] = k.split(":"); await E.api("DELETE", `/api/directory/favorites/${kind}/${encodeURIComponent(rest.join(":"))}`); }
    await nav(E.page, "directory", 3000);
    const recSrv = (await E.api("GET", "/api/directory/recents")).json.recents.map((r) => r.userId);
    let st = await waitFor(async () => { const s = await favState(E.page); return s.recents.length ? s : null; }, 8000);
    rec(`F @${width}: Recently contacted = the server's recents, in order`, st && JSON.stringify(st.recents) === JSON.stringify(recSrv) && recSrv[0] === target.userId, JSON.stringify(st && st.recents) + " vs " + JSON.stringify(recSrv));
    rec(`F @${width}: no Favorites section while the server holds none`, st && st.favorites.length === 0 && !(await E.page.evaluate(() => !!document.querySelector("[data-favorites]"))));

    // Star the person from the provider list.
    const key = "user:" + target.userId;
    let mark = E.apiLog.length;
    await E.page.locator(`[data-favorite="${key}"]`).last().click(); // the provider-directory row
    st = await waitFor(async () => { const s = await favState(E.page); return s.favorites.includes(key) ? s : null; }, 8000);
    let w = writes(E.apiLog, mark);
    rec(`F @${width}: the star is ONE server write (POST /api/directory/favorites 201)`, w.length === 1 && w[0].m === "POST" && w[0].p === "/api/directory/favorites" && w[0].s === 201, w.map((x) => x.m + " " + x.p + " " + x.s).join(", "));
    rec(`F @${width}: the server holds it, and the Favorites section shows it`, (await srvFavKeys(E)).includes(key) && st && st.favorites.includes(key));
    rec(`F @${width}: every star of that person shows pressed`, st && st.stars.filter((s) => s.key === key).every((s) => s.on));

    // Star a role contact.
    const roles = (await E.api("GET", "/api/messaging/role-contacts")).json;
    if (roles.length) {
      const rkey = "role:" + roles[0].role;
      mark = E.apiLog.length;
      await E.page.locator(`[data-role-contacts] [data-favorite="${rkey.replace(/"/g, '\\"')}"]`).click();
      st = await waitFor(async () => { const s = await favState(E.page); return s.favorites.includes(rkey) ? s : null; }, 8000);
      w = writes(E.apiLog, mark);
      rec(`F @${width}: a role star is stored too (and shown under Favorites)`, w.length === 1 && w[0].s === 201 && (await srvFavKeys(E)).includes(rkey) && !!st, rkey);
    } else rec(`F @${width}: (fixture) a role contact to star`, false, "no role contacts");
    rec(`F @${width}: order is Favorites, Recently contacted, Role contacts, then the directory`, st && sortedOk(st.tops), JSON.stringify(st && st.tops));
    await checkLayout(E.page, `favorites + recents + directory @${width}`, ["[data-favorites]", "[data-recents]", "[data-role-contacts]"]);

    // A second device of the same person sees the server's stars.
    const E2 = await open(BASE, width, "ISPN", "er.doc");
    await nav(E2.page, "directory", 3000);
    const st2 = await waitFor(async () => { const s = await favState(E2.page); return s.favorites.length ? s : null; }, 8000);
    rec(`F @${width}: a second device shows the same favorites (server state)`, st2 && JSON.stringify([...st2.favorites].sort()) === JSON.stringify((await srvFavKeys(E2)).sort()), JSON.stringify(st2 && st2.favorites));
    await E2.ctx.close();

    // Unstar from the Favorites section.
    mark = E.apiLog.length;
    await E.page.locator(`[data-favorites] [data-favorite="${key}"]`).click();
    st = await waitFor(async () => { const s = await favState(E.page); return !s.favorites.includes(key) ? s : null; }, 8000);
    w = writes(E.apiLog, mark);
    rec(`F @${width}: unstar is ONE DELETE 204, gone on the server and the screen`, w.length === 1 && w[0].m === "DELETE" && w[0].s === 204 && !(await srvFavKeys(E)).includes(key) && !!st, w.map((x) => x.m + " " + x.p + " " + x.s).join(", "));

    if (width === 390) {
      // Message from Recently contacted reopens the existing thread (no new one).
      mark = E.apiLog.length;
      await E.page.locator(`[data-recents] [data-person-row="${target.userId}"] button[aria-label^="Message"]`).click();
      await sleep(2500);
      const s3 = await E.page.evaluate(() => ({ nav: window.DT.getState().ui.nav, active: window.DT.getState().__activeConvo }));
      w = writes(E.apiLog, mark);
      rec("F: Message on a recent person reopens that thread — no new conversation", s3.nav === "messages" && s3.active === c.id && !w.some((x) => x.p === "/api/messaging/conversations"), JSON.stringify(s3) + " convo=" + c.id);
    }
    await E.ctx.close();
  }

  // Module off: no stars, no sections, no reads; the server refuses.
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "directory.favorites", enabled: false });
  const E = await open(BASE, 390, "ISPN", "er.doc");
  const mark = E.apiLog.length;
  await nav(E.page, "directory", 3000);
  const shown = await E.page.evaluate(() => ({ stars: document.querySelectorAll("[data-favorite]").length, fav: !!document.querySelector("[data-favorites]"), rec: !!document.querySelector("[data-recents]") }));
  const asked = E.apiLog.slice(mark).some((r) => /^\/api\/directory\//.test(r.p));
  const srv = await E.api("GET", "/api/directory/favorites");
  rec("M directory.favorites off: no star, no section, no request; the server says 404 module_disabled", shown.stars === 0 && !shown.fav && !shown.rec && !asked && srv.status === 404 && srv.json.module === "directory.favorites", JSON.stringify(shown) + " asked=" + asked + " status=" + srv.status);
  await checkLayout(E.page, "directory with favorites off @390", ["main"]);
  await dev.api("PATCH", `/api/dev/modules/${ispn.id}`, { id: "directory.favorites", enabled: true });
  await E.ctx.close(); await dev.ctx.close();
}

if (REAL) {
  console.log("== real server " + REAL);
  const dev = await open(REAL, 390, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD);
  const cfg = (await dev.api("GET", "/api/config")).json;
  rec("Q (setup) server is SYNTHETIC_DATA=false", cfg && cfg.syntheticData === false);
  const NEWPW = "Favorites-Check-2026!";
  const code = "FV" + RUN;
  const o = (await dev.api("POST", "/api/dev/organizations", { name: "Favorites Check " + RUN, code, timezone: "America/Chicago" })).json;
  for (const u of [
    { role: "er_doctor", username: "fv.er", displayName: "Dr. Fv Er", credential: "MD" },
    { role: "hospitalist", username: "fv.hosp", displayName: "Dr. Fv Hospitalist", credential: "MD", specialty: "Hospital Medicine", shiftType: "day", patientCap: 12 },
  ]) {
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
  const E = await open(REAL, 430, code, "fv.er", NEWPW);
  await nav(E.page, "directory", 3000);
  const s0 = await E.page.evaluate(() => ({ fav: !!document.querySelector("[data-favorites]"), rec: !!document.querySelector("[data-recents]"), st: { f: window.DT.getState().favorites, r: window.DT.getState().recents } }));
  rec("Q: a fresh tenant — no favorites, no recents, on the server or the screen (nothing demo)", !s0.fav && !s0.rec && s0.st.f.length === 0 && s0.st.r.length === 0, JSON.stringify(s0));
  const hosp = (await E.api("GET", "/api/physicians/directory")).json[0];
  const cv = (await E.api("POST", "/api/messaging/conversations", { type: "direct", participantIds: [hosp.userId] })).json;
  await E.api("POST", "/api/messaging/send", { conversationId: cv.id, content: "real recents " + RUN });
  await nav(E.page, "dashboard", 800);
  await nav(E.page, "directory", 3000);
  const r1 = await waitFor(async () => { const s = await favState(E.page); return s.recents.length ? s : null; }, 8000);
  rec("Q: after one real message the hospitalist is recently contacted", r1 && JSON.stringify(r1.recents) === JSON.stringify([hosp.userId]), JSON.stringify(r1 && r1.recents));
  await E.page.locator(`[data-recents] [data-favorite="user:${hosp.userId}"]`).click();
  const f1 = await waitFor(async () => { const s = await favState(E.page); return s.favorites.length ? s : null; }, 8000);
  rec("Q: starring them stores it and shows it under Favorites", f1 && f1.favorites.includes("user:" + hosp.userId) && (await srvFavKeys(E)).includes("user:" + hosp.userId));
  await checkLayout(E.page, "real favorites @430", ["[data-favorites]", "[data-recents]"]);
  await E.ctx.close();
}

await browser.close();
rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
