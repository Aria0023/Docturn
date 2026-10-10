/**
 * "Next up" truthfulness check (A.CON-SHO-29) — web client, iPhone profile.
 *
 * Every web surface that names the next round-robin hospitalist (Director
 * "Next up" card, ER intake Quick hint, hospitalist "You're next up" chip) must
 * name the provider the server's round-robin really picks, the ER send mode
 * must come from the Quick/Manual tab (Quick sends NO hospitalistId), and the
 * confirmation toast must name the server's actual pick. Also covers the
 * nobody-routable and everyone-at-cap (cap relief) cases, and measures that
 * the new wording causes no horizontal overflow at 375 / 390 / 430 px.
 *
 * Drives the real app in headless Chromium against a seeded SYNTHETIC server
 * (org ISPN). It changes provider census/cap/working through the director API
 * for the scenarios and RESTORES every provider's original values at the end.
 * It creates a few synthetic admissions (initials like "BQ", rooms "Bay …").
 *
 * Usage:  BASE_URL=http://127.0.0.1:5600 node scripts/next-up-check.mjs
 * Exits non-zero on any failed check. BEFORE=1 tolerates a pre-fix client
 * (used to show the check fails on the old code).
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const SIZES = { 390: 844, 375: 667, 430: 932 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const rec = (name, ok, note = "") => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  -> " + note : "")); };

// ---- server-side state via the real API (director session) ----
async function apiSession(username) {
  const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgCode: "ISPN", username, password: "docturn" }) });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  if (!r.ok) throw new Error("login " + username + " " + r.status);
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
    const t = await res.text();
    return { status: res.status, body: t ? JSON.parse(t) : null };
  };
  return call;
}
const director = await apiSession("director");
const hosps = (await director("GET", "/api/hospitalists")).body;
const dir = (await director("GET", "/api/physicians/directory")).body;
const nameOf = (h) => (dir.find((d) => d.userId === h.userId) || {}).displayName;
const byName = (re) => hosps.find((h) => re.test(nameOf(h) || ""));
const liu = byName(/Darouichi/), chen = byName(/Alyesh/), lopez = byName(/Amir Ahmed/);
// Restore point: every provider's census / cap / working as found.
const original = hosps.map((h) => ({ h, census: h.currentPatientCount, cap: h.patientCap, working: !!h.working }));
async function restore() { for (const o of original) await setProvider(o.h, o.census, o.cap, o.working); }
async function setProvider(h, census, cap, working) {
  await director("PATCH", `/api/physicians/${h.id}/capacity`, { patientCap: cap });
  await director("PATCH", `/api/hospitalists/${h.id}/census`, { currentPatientCount: census, reason: "SHO-29 check" });
  if (working != null) await director("PATCH", `/api/hospitalists/${h.id}/working-status`, { working });
}
async function reproState() {
  // The finding's repro: Darouichi 2/2 (lowest census, AT CAP), everyone else 6/12, all on shift.
  for (const h of hosps) await setProvider(h, h.id === liu.id ? 2 : 6, h.id === liu.id ? 2 : 12, true);
}
await reproState();
const serverNext = (await director("GET", "/api/rotation/next")).body;
rec("server preview names Alyesh (not the at-cap Darouichi)", serverNext.next && serverNext.next.hospitalistId === chen.id, JSON.stringify(serverNext.next));

// ---- browser ----
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });

async function phone(width) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!(window.DT && window.DT.actions && window.DT_LIVE), null, { timeout: 60000 });
  return { ctx, page };
}
async function loginAs(page, role, user) {
  await page.evaluate(([role, user]) => window.DT.actions.login(role, "ISPN", user, "docturn"), [role, user]);
  await page.waitForFunction((r) => { const s = window.DT.getState(); return !!(s.session && s.session.role === r); }, role, { timeout: 20000 });
  // (a pre-fix client never sets state.rotation — don't hang on it)
  await page.waitForFunction(() => { const r = window.DT.getState().rotation; return !!(r && r.source); }, null, { timeout: process.env.BEFORE ? 3000 : 20000 }).catch(() => {});
  await sleep(1200);
  // The Next-up card: the smallest element whose text starts with the "Next up"
  // badge and carries the card's subtitle.
  await page.evaluate(() => { window.__card = () => { const els = [...document.querySelectorAll("main div")].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()).filter((t) => /^Next up/.test(t) && /census|No eligible|routing is switched off|Couldn't load/.test(t)); els.sort((a, b) => a.length - b.length); return els[0] || null; }; });
}
async function overflow(page) {
  return page.evaluate(() => { const m = document.querySelector("main"); return { vw: innerWidth, main: m ? m.scrollWidth : 0, doc: document.documentElement.scrollWidth }; });
}

for (const width of [390, 375, 430]) {
  console.log(`\n=== iPhone ${width}x${SIZES[width]} ===`);
  await reproState();
  const { ctx, page } = await phone(width);

  // Director "Next up" card
  await loginAs(page, "director", "director");
  const d = await page.evaluate(() => {
    const nx = window.DT.nextUp();
    return { next: nx && { id: nx.id, name: nx.name, census: nx.census, cap: nx.cap }, card: window.__card() };
  });
  rec(`[${width}] Director DT.nextUp() = Alyesh`, d.next && d.next.id === "h" + chen.id, JSON.stringify(d.next));
  rec(`[${width}] Director card names Alyesh, never Darouichi`, !!d.card && /Nathan Alyesh/.test(d.card) && !/Darouichi/.test(d.card), d.card);
  let o = await overflow(page);
  rec(`[${width}] Director dashboard: no horizontal overflow`, o.main <= o.vw && o.doc <= o.vw, JSON.stringify(o));

  // Hospitalist chip: Alyesh (chen) is told he's next; Darouichi (liu) is not.
  await loginAs(page, "hospitalist", "chen");
  const chip1 = await page.evaluate(() => [...document.querySelectorAll("span")].map((e) => e.textContent).find((t) => /next up|ahead of you|Not eligible/.test(t || "")) || null);
  rec(`[${width}] hospitalist chen chip says "You're next up"`, /You're next up/.test(chip1 || ""), chip1);
  await loginAs(page, "hospitalist", "liu");
  const chip2 = await page.evaluate(() => [...document.querySelectorAll("span")].map((e) => e.textContent).find((t) => /next up|ahead of you|Not eligible/.test(t || "")) || null);
  rec(`[${width}] hospitalist liu (2/2) is not told she's next`, !!chip2 && !/You're next up/.test(chip2), chip2);

  // ER intake Quick hint + send
  await loginAs(page, "er_doctor", "er.doc");
  const hint = await page.evaluate(() => { const h = document.querySelector("[data-testid=rr-hint]"); return h ? h.textContent.replace(/\s+/g, " ").trim() : null; });
  rec(`[${width}] ER Quick hint names Alyesh (6/12)`, /Next up: Dr\. Nathan Alyesh \(6\/12\)/.test(hint || "") && !/Darouichi/.test(hint || ""), hint);
  o = await overflow(page);
  rec(`[${width}] ER dashboard: no horizontal overflow`, o.main <= o.vw && o.doc <= o.vw, JSON.stringify(o));

  const posts = [];
  page.on("request", (r) => { if (r.method() === "POST" && /\/api\/assignments$/.test(r.url())) posts.push(JSON.parse(r.postData() || "{}")); });
  const responses = [];
  page.on("response", async (r) => { if (r.request().method() === "POST" && /\/api\/assignments$/.test(r.url())) { try { responses.push(await r.json()); } catch (e) {} } });

  const tag = String.fromCharCode(65 + (width % 26)) + "Q";
  await page.getByLabel("Patient initials").fill(tag);
  await page.getByLabel("Room / location").fill("Bay " + width);
  await page.getByRole("button", { name: /Send assignment/ }).click();
  await page.waitForFunction(() => { const t = document.querySelector("[data-toast]"); return t && /Assignment sent to|Couldn't/.test(t.textContent); }, null, { timeout: 15000 }).catch(() => {});
  const toast = await page.evaluate(() => document.querySelector("[data-toast]").textContent.replace(/\s+/g, " ").trim());
  for (let i = 0; i < 50 && responses.length < 1; i++) await sleep(100);
  const post = posts[posts.length - 1] || {};
  const resp = responses[responses.length - 1] || {};
  rec(`[${width}] Quick tab POSTs mode round_robin with NO hospitalistId`, post.mode === "round_robin" && post.hospitalistId === undefined, JSON.stringify(post));
  rec(`[${width}] server picked Alyesh`, resp.hospitalistId === chen.id, "hospitalistId=" + resp.hospitalistId);
  rec(`[${width}] toast names the server's pick`, /Assignment sent to Dr\. Nathan Alyesh/.test(toast), toast);

  // Manual tab: explicitly choose Dr. Amir Ahmed
  await page.getByRole("button", { name: /^Manual$/ }).click();
  await page.getByRole("button", { name: /Dr\. Amir Ahmed/ }).first().click();
  await page.getByLabel("Patient initials").fill(tag.slice(0, 1) + "M");
  await page.getByLabel("Room / location").fill("Bay M" + width);
  await page.getByRole("button", { name: /Send assignment/ }).click();
  await page.waitForFunction((n) => { const t = document.querySelector("[data-toast]"); return t && /Assignment sent to Dr\. Amir Ahmed|Couldn't/.test(t.textContent); }, null, { timeout: 15000 });
  for (let i = 0; i < 50 && responses.length < 2; i++) await sleep(100); // response bodies are read asynchronously
  const post2 = posts[posts.length - 1] || {};
  const resp2 = responses[responses.length - 1] || {};
  rec(`[${width}] Manual tab POSTs mode manual with the chosen hospitalistId`, post2.mode === "manual" && post2.hospitalistId === lopez.id, JSON.stringify(post2));
  rec(`[${width}] Manual send assigned Ahmed`, resp2.hospitalistId === lopez.id, "hospitalistId=" + resp2.hospitalistId);
  await ctx.close();
}

// ---- nobody routable: only the swing provider on shift ----
console.log("\n=== nobody on a round-robin shift ===");
for (const h of hosps) await director("PATCH", `/api/hospitalists/${h.id}/working-status`, { working: /Manukian/.test(nameOf(h) || "") });
{
  const { ctx, page } = await phone(390);
  await loginAs(page, "er_doctor", "er.doc");
  const hint = await page.evaluate(() => { const h = document.querySelector("[data-testid=rr-hint]"); return h ? h.textContent.replace(/\s+/g, " ").trim() : null; });
  rec("ER hint says nobody can take a round-robin patient (no name)", /Nobody on a round.robin shift can take this patient/.test(hint || "") && !/Next up:/.test(hint || ""), hint);
  await page.getByLabel("Patient initials").fill("NB");
  await page.getByLabel("Room / location").fill("Bay 0");
  const btn = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Send assignment/.test(x.textContent)); return b ? getComputedStyle(b).pointerEvents + "|" + getComputedStyle(b).opacity : null; });
  rec("Quick Send is disabled", btn === "none|0.5", btn);
  const note = await page.evaluate(() => [...document.querySelectorAll("div")].map((d) => d.textContent).find((t) => t === "Nobody can take a round-robin patient right now — use Manual.") || null);
  rec("Send explains why and offers Manual", !!note, note);
  await loginAs(page, "director", "director");
  const card = await page.evaluate(() => window.__card());
  rec("Director card says 'No eligible hospitalist' (no swing-shift name)", /No eligible hospitalist/.test(card || "") && !/Manukian/.test(card || ""), card);
  await ctx.close();
}

// ---- cap relief: everyone routable at cap ----
console.log("\n=== everyone routable at cap ===");
for (const h of hosps) await setProvider(h, 12, 12, true);
await setProvider(liu, 11, 11, true);
{
  const s = (await director("GET", "/api/rotation/next")).body;
  const { ctx, page } = await phone(390);
  await loginAs(page, "director", "director");
  const card = await page.evaluate(() => window.__card());
  rec("Director card names the relief pick and says caps will rise", s.capRelief === true && /Darouichi/.test(card || "") && /at cap/.test(card || ""), card);
  const o = await overflow(page);
  rec("Director dashboard (relief text): no horizontal overflow", o.main <= o.vw && o.doc <= o.vw, JSON.stringify(o));
  await ctx.close();
}

await browser.close();
await restore();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
