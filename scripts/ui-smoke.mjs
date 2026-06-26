/**
 * Headless UI smoke test for the web app (webapp/).
 *
 * No browser required: mounts the REAL <App> in jsdom — the same store.js,
 * api-bridge.js, vendored React/lucide and JSX screens the browser loads — wires
 * fetch to a running backend, then logs into every role and clicks every button
 * on every screen, asserting nothing throws. It also drives the core flows
 * (developer org CRUD, ER->hospitalist assignment + accept) against the live API.
 *
 * Usage:  start the server (`npm run dev`, seeded), then `npm run test:ui`.
 * Override the target with BASE_URL=... npm run test:ui
 */
import { JSDOM } from "jsdom";
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const Babel = require("@babel/standalone");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBAPP = path.join(ROOT, "webapp");
const VEND = path.join(WEBAPP, "assets", "vendor");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const read = (f) => fs.readFileSync(path.join(WEBAPP, f), "utf8");

// ---- jsdom + window context ----------------------------------------------
const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="root"></div></body></html>`, {
  url: BASE + "/", runScripts: "outside-only", pretendToBeVisual: true,
});
const { window } = dom;
const ctx = dom.getInternalVMContext();
window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
window.scrollTo = () => {};
if (!window.ResizeObserver) window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.alert = () => {}; window.confirm = () => true; window.prompt = () => "x";

// ---- error capture --------------------------------------------------------
const errors = [];
window.addEventListener("error", (e) => errors.push("window.error: " + (e.error?.stack || e.message)));
window.addEventListener("unhandledrejection", (e) => errors.push("unhandledrejection: " + (e.reason?.stack || e.reason)));
console.error = (...a) => {
  const msg = a.map(String).join(" ");
  if (/Warning:|act\(|deprecated|not found in the provided icons/i.test(msg)) return;
  errors.push("console.error: " + msg);
};

// ---- cookie-jar fetch wired to the live backend ---------------------------
let cookie = "";
window.fetch = async (url, opts = {}) => {
  const u = String(url).startsWith("http") ? String(url) : BASE + url;
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(u, { ...opts, headers, redirect: "manual" });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (sc && sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  return res;
};
// test hook: drop the session cookie to simulate a 15-min expiry / server restart
window.__wipeSession = () => { cookie = ""; };

// ---- load the app exactly as index.html does ------------------------------
const runInWindow = (code, name) => vm.runInContext(code, ctx, { filename: name });
for (const f of ["react.js", "react-dom.js", "lucide.min.js"]) runInWindow(fs.readFileSync(path.join(VEND, f), "utf8"), f);
if (!window.React || !window.ReactDOM) { console.log("FATAL: React UMD did not attach"); process.exit(2); }
runInWindow(read("store.js"), "store.js");
runInWindow(read("api-bridge.js"), "api-bridge.js");
if (!window.DT) { console.log("FATAL: store.js did not set window.DT"); process.exit(2); }

const JSX_FILES = [
  "components.jsx", "LoginScreen.jsx", "LockScreen.jsx", "AppShell.jsx",
  "HospitalistDashboard.jsx", "HospitalistHistory.jsx", "ErDoctorDashboard.jsx", "DirectorDashboard.jsx",
  "ErDirectorDashboard.jsx", "Messaging.jsx", "Directory.jsx", "CareTeam.jsx",
  "PatientBoard.jsx", "DeveloperDashboard.jsx", "AdmissionsLog.jsx", "Compliance.jsx", "Broadcasts.jsx",
  "ScheduleSync.jsx", "OrgSettings.jsx", "RoleManagement.jsx", "People.jsx", "Appearance.jsx",
  "CustomizableDashboard.jsx", "ConsultServices.jsx", "RegistrationApprovals.jsx",
];
const html = read("index.html");
const inlineApp = html.match(/<script type="text\/babel" data-presets="react">([\s\S]*?)<\/script>/);
if (!inlineApp) { console.log("FATAL: could not find inline App script in index.html"); process.exit(2); }
const bundle = JSX_FILES.map(read).join("\n;\n") + "\n;\n" + inlineApp[1];
try {
  runInWindow(Babel.transform(bundle, { presets: ["react"] }).code, "bundle.jsx");
} catch (e) { console.log("FATAL: bundle execution threw:\n" + (e.stack || e)); process.exit(2); }

// ---- test driver ----------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flush = async () => { await sleep(40); await sleep(40); };
const DT = window.DT;
const results = [];
const rec = (label, ok, detail = "") => { results.push({ label, ok, detail }); if (process.env.UI_PROGRESS) console.log((ok ? "ok  " : "ERR ") + label); };

// Set a React-controlled input/textarea value the way a user typing would
// (native setter + input event), so onChange fires.
function setInput(el, value) {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}
const allButtons = () => [...window.document.querySelectorAll("button")];
const btnByText = (re) => allButtons().find((b) => re.test((b.textContent || "").trim()));
const inputByPlaceholder = (sub) => [...window.document.querySelectorAll("input,textarea")].find((i) => (i.placeholder || "").includes(sub));


// Buttons that change session/identity — skipped so the sweep doesn't flood
// /api/login (role switcher) or log itself out mid-test.
const SKIP_LABELS = new Set(["hospitalist", "er physician", "er director", "hosp. director", "developer", "log out", "sign out", "logout", "lock",
  // destructive maintenance buttons — don't wipe data mid-sweep
  "clear all", "clear 24h+", "clear logs"]);
async function clickEveryButton(roleLabel, screen) {
  const before = errors.length;
  let clicked = 0;
  for (const b of [...window.document.querySelectorAll("button")]) {
    if (SKIP_LABELS.has((b.textContent || "").trim().toLowerCase())) continue;
    try { b.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })); clicked++; await sleep(3); }
    catch (e) { errors.push(`click threw [${roleLabel}/${screen}]: ${e.message}`); }
  }
  await flush();
  const newErrs = errors.length - before;
  rec(`${roleLabel} · ${screen}: clicked ${clicked} buttons`, newErrs === 0, newErrs ? errors.slice(before).join(" | ") : "");
}

const NAV = {
  developer: ["dashboard", "roles", "consult", "compliance", "appearance", "settings"],
  director: ["dashboard", "board", "broadcasts", "messages", "directory", "compliance", "appearance", "settings"],
  er_director: ["dashboard", "board", "broadcasts", "messages", "directory", "compliance", "appearance", "settings"],
  er_doctor: ["dashboard", "messages", "directory", "compliance"],
  hospitalist: ["dashboard", "history", "messages", "directory", "compliance"],
};

await flush();
rec("App mounted", !!window.document.querySelector("#root").children.length);

for (const role of ["developer", "director", "er_director", "er_doctor", "hospitalist"]) {
  await DT.actions.login(role, "ISPN");
  await flush(); await flush();
  const st = DT.getState();
  rec(`LOGIN as ${role}`, st.session && st.session.role === role, "session=" + JSON.stringify(st.session));
  if (role === "developer") {
    const mercy = (st.orgs || []).find((o) => o.code === "ISPN");
    const noPlatform = !(st.orgs || []).some((o) => o.code === "DOCTURN");
    // ISPN seeds the real Cedars Amion roster: 3 ops roles + 12 hospitalists + 1 PA = 16.
    rec("developer: orgs hydrated from backend (ISPN seeded, platform hidden)", !!mercy && mercy.users === 16 && noPlatform, "orgs=" + JSON.stringify((st.orgs || []).map((o) => o.code + ":" + o.users)));
  }
  if (role === "hospitalist") rec("hospitalist: providers hydrated", (st.providers || []).length >= 4, "providers=" + (st.providers || []).length);
  for (const navId of NAV[role]) { DT.actions.setNav(navId); await flush(); await clickEveryButton(role, navId); }
}

// developer org CRUD
await DT.actions.login("developer", "ISPN"); await flush();
DT.actions.addTenant({ name: "Harness Test Hospital", code: "HARN", city: "Testville", state: "CA", timezone: "America/Los_Angeles" });
await flush(); await flush();
const harn = (DT.getState().orgs || []).find((o) => o.code === "HARN");
rec("addTenant creates org", !!harn);
let delOk = false, delErr = "";
try { await DT.actions.deleteTenant(harn || { code: "HARN" }); delOk = true; } catch (e) { delErr = e.message; }
await flush();
rec("deleteTenant removes empty org", delOk && !(DT.getState().orgs || []).find((o) => o.code === "HARN"), delErr && "threw: " + delErr);
// force-cascade: a tenant WITH users can be fully deleted from the Danger Zone
DT.actions.addTenant({ name: "Populated Clinic", code: "POPUL", city: "Y", state: "CA", timezone: "America/Los_Angeles" });
await flush(); await flush();
const popul = (DT.getState().orgs || []).find((o) => o.code === "POPUL");
DT.actions.addUser({ org: "POPUL", role: "hospitalist", name: "Dr. Test Person", email: "test@popul.org", specialty: "General", cap: "10", shift: "rounding" });
await flush(); await flush();
let cascadeOk = false, cascadeErr = "";
try { await DT.actions.deleteTenant(popul || { code: "POPUL" }); cascadeOk = true; } catch (e) { cascadeErr = e.message; }
await flush();
rec("deleteTenant force-cascades a populated tenant", cascadeOk && !(DT.getState().orgs || []).find((o) => o.code === "POPUL"), cascadeErr && "threw: " + cascadeErr);
// self-protection: the developer cannot delete their own (platform) org
let ownErr = "";
try { await DT.actions.deleteTenant({ code: "DOCTURN" }); } catch (e) { ownErr = e.message; }
rec("deleteTenant refuses the developer's own org", /own account/i.test(ownErr), "msg=" + ownErr);

// Amion-style import: parsed providers become real users in the org
DT.actions.addTenant({ name: "Amion Clinic", code: "AMION", city: "Z", state: "CA", timezone: "America/Los_Angeles" });
await flush(); await flush();
const roster = [
  { name: "Roupen Guedikian", group: "Nocturnist", shift: "night" },
  { name: "Ann Tran", group: "ISP Hospitalist", shift: "night" },
  { name: "David Chen", group: "Nocturnist", shift: "night" },
];
let impRes = null, impErr = "";
try { impRes = await DT.actions.importProviders("AMION", roster); } catch (e) { impErr = e.message; }
await flush(); await flush();
const amionUsers = (DT.getState().devUsers || []).filter((u) => u.org === "AMION");
rec("importProviders adds parsed providers as users", impRes && impRes.added === 3 && amionUsers.length >= 3, impErr || ("added=" + (impRes && impRes.added) + " amionUsers=" + amionUsers.length));
// re-import the same roster → all skipped (no duplicates)
let dupRes = null;
try { dupRes = await DT.actions.importProviders("AMION", roster); } catch (e) { /* ignore */ }
await flush();
rec("importProviders skips duplicates on re-sync", dupRes && dupRes.added === 0 && dupRes.skipped === 3, "res=" + JSON.stringify(dupRes));
// cleanup
try { await DT.actions.deleteTenant({ code: "AMION" }); } catch (e) { /* ignore */ }
await flush();

// clinical flow: ER doctor sends -> hospitalist receives -> accept.
// Resolve the demo hospitalist's display name first so we route to EXACTLY the
// account we then log in as (the seed roster uses real Amion names now).
await DT.actions.login("hospitalist", "ISPN"); await flush(); await flush();
const hospName = (DT.getState().me && DT.getState().me.name) || "";
await DT.actions.login("er_doctor", "ISPN"); await flush(); await flush();
let provs = DT.sortedProviders();
for (let i = 0; i < 12 && provs.length === 0; i++) { await flush(); provs = DT.sortedProviders(); }
const target = provs.find((p) => p.name === hospName) || provs[0];
rec("ER doctor: providers available to send to", !!target, "providers=" + JSON.stringify(provs.map((p) => p.name)));
if (target) {
DT.actions.sendAssignment(target, { initials: "ZZ", room: "999", complaint: "Harness chest pain", specialty: "Cardiology" }, []);
await flush(); await flush();
rec("admission logged on send", (DT.getState().admissions || []).some((a) => a.initials === "ZZ"), "admissions=" + (DT.getState().admissions || []).length);
await DT.actions.login("hospitalist", "ISPN"); await flush(); await flush();
const got = (DT.getState().pending || []).find((p) => p.initials === "ZZ");
rec("ER->hospitalist: sent assignment appears in pending", !!got, "pending=" + JSON.stringify((DT.getState().pending || []).map((p) => p.initials)));
if (got) {
  DT.actions.accept(got.id); await flush(); await flush();
  rec("hospitalist: accept removes it from pending", !(DT.getState().pending || []).find((p) => p.initials === "ZZ"));
}
}

// ER physician MANUAL send, end-to-end through the real form (the user's bug):
// type initials+room, switch to Manual, pick a NON-default provider, click Send.
await DT.actions.login("er_doctor", "ISPN"); DT.actions.setNav("dashboard"); await flush(); await flush();
{
  let provs = DT.sortedProviders();
  for (let i = 0; i < 12 && provs.length === 0; i++) { await flush(); provs = DT.sortedProviders(); }
  const pick = provs[1] || provs[0]; // not the round-robin default, to prove manual selection
  const initEl = inputByPlaceholder("e.g. JS");
  const roomEl = inputByPlaceholder("Hall");
  let manualOk = false, detail = "";
  if (initEl && roomEl && pick) {
    setInput(initEl, "QX"); setInput(roomEl, "disc 44"); await flush();
    const manualTab = btnByText(/^Manual$/); if (manualTab) manualTab.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await flush();
    const provBtn = allButtons().find((b) => (b.textContent || "").includes(pick.name));
    if (provBtn) provBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await flush();
    const before = (DT.getState().admissions || []).length;
    const sendBtn = btnByText(/^Send assignment/);
    const disabled = sendBtn && (sendBtn.style.pointerEvents === "none" || sendBtn.disabled);
    if (sendBtn && !disabled) sendBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush(); await flush();
    const adm = (DT.getState().admissions || [])[0];
    manualOk = (DT.getState().admissions || []).length > before && adm && adm.initials === "QX" && adm.provider === pick.name;
    detail = "sendDisabled=" + !!disabled + " latest=" + JSON.stringify(adm && { i: adm.initials, p: adm.provider, r: adm.room });
  }
  rec("ER manual send routes to the chosen provider (end-to-end)", manualOk, detail);
}

// Cross-user: import an Amion physician, then ER routes an admission to THEM.
await DT.actions.login("developer", "ISPN"); await flush();
await DT.actions.importProviders("ISPN", [{ name: "Roupen Guedikian", group: "Nocturnist", shift: "night" }]);
await flush(); await flush();
await DT.actions.login("er_doctor", "ISPN"); await flush(); await flush();
{
  // Provider hydration after import/login is async; poll briefly so the test
  // isn't racing the rehydrate (the app creates the user synchronously server-side).
  let imported = null;
  for (let i = 0; i < 10 && !imported; i++) { imported = DT.sortedProviders().find((p) => /Guedikian/.test(p.name)); if (!imported) await flush(); }
  // On-call fix: providers imported from a schedule come in ON-SHIFT (working),
  // so they immediately populate the consult on-call roster (previously they
  // defaulted to inactive and the Amion on-call never updated).
  rec("imported (schedule) provider comes in on-shift → drives on-call", !!(imported && imported.working), "working=" + (imported && imported.working));
  let ok = false, detail = "imported=" + !!imported;
  if (imported) {
    DT.actions.sendAssignment(imported, { initials: "AM", room: "Bay 2", complaint: "Amion route test", specialty: "Cardiology" }, []);
    await flush(); await flush();
    const adm = (DT.getState().admissions || [])[0];
    ok = adm && adm.provider === imported.name && adm.initials === "AM";
    detail = "latest=" + JSON.stringify(adm && { p: adm.provider, i: adm.initials });
  }
  rec("ER routes an admission to an Amion-imported physician", ok, detail);
}

// Messaging is backend-backed (cross-device): starting a conversation creates a
// real server conversation and a sent message persists + round-trips.
await DT.actions.login("hospitalist", "ISPN"); await flush(); await flush();
{
  const who = DT.sortedProviders().find((p) => !/Chen/.test(p.name)) || DT.sortedProviders()[0];
  let conv = null;
  if (who) {
    await DT.actions.startConversation({ name: who.name, specialty: who.specialty, avatar: who.avatar });
    for (let i = 0; i < 12 && !conv; i++) { await flush(); conv = (DT.getState().conversations || []).find((c) => c.name === who.name); }
    if (conv) { DT.actions.sendMessage(conv.id, "Test handoff message"); for (let i = 0; i < 12; i++) await flush(); }
  }
  const conv2 = (DT.getState().conversations || []).find((c) => c.name === (who && who.name));
  const sent = conv2 && (conv2.messages || []).some((m) => m.text === "Test handoff message" && m.me);
  // backend-backed conversation carries a numeric server id
  const realId = conv2 && typeof conv2.id === "number";
  rec("messaging: backend conversation + message round-trips", !!sent && !!realId, "convId=" + (conv2 && conv2.id) + " msgs=" + (conv2 ? conv2.messages.length : "no convo"));
}
// Cross-user delivery: ER physician messages a hospitalist; the hospitalist
// sees it on their OWN login (the real "works across devices" path).
await DT.actions.login("er_doctor", "ISPN"); await flush(); await flush();
{
  const target = (DT.getState().directory || []).find((d) => /Chen/.test(d.name)) || (DT.getState().directory || [])[0];
  let ok = false, detail = "no target";
  if (target) {
    await DT.actions.startConversation({ name: target.name });
    let conv = null;
    for (let i = 0; i < 12 && !conv; i++) { await flush(); conv = (DT.getState().conversations || []).find((c) => c.name === target.name); }
    if (conv) { DT.actions.sendMessage(conv.id, "X-user ping 42"); for (let i = 0; i < 12; i++) await flush(); }
    await DT.actions.login("hospitalist", "ISPN"); for (let i = 0; i < 14; i++) await flush();
    const conv2 = (DT.getState().conversations || []).find((c) => (c.messages || []).some((m) => m.text === "X-user ping 42"));
    ok = !!(conv2 && (conv2.messages || []).some((m) => m.text === "X-user ping 42" && !m.me));
    detail = "received=" + ok + " from=" + (conv2 && conv2.name);
  }
  rec("messaging: receiver sees the sender's message (cross-user)", ok, detail);
}

// demo resilience: a wrong/stale org code (e.g. cached "MERCY") still signs in
// via the role's canonical demo org, so the demo never dead-ends on org code.
await DT.actions.login("hospitalist", "MERCY"); for (let i = 0; i < 12; i++) await flush();
rec("login falls back to canonical org when the code is wrong/stale", (DT.getState().session || {}).role === "hospitalist", "session=" + JSON.stringify(DT.getState().session));

// session recovery: simulate the session dying mid-use (expiry / server restart)
// then perform a dev action — the bridge should re-auth and succeed, not 401.
await DT.actions.login("developer", "ISPN"); await flush(); await flush();
window.__wipeSession();
let recovered = false, recErr = "";
DT.actions.addTenant({ name: "Recovery Org", code: "RECOV", city: "X", state: "CA", timezone: "America/Los_Angeles" });
// addTenant fire-and-forgets a 401 → self-heal re-auth → retry → hydrate (4
// sequential round-trips); poll instead of racing a fixed wait.
let recov = null;
for (let i = 0; i < 15 && !recov; i++) { await flush(); recov = (DT.getState().orgs || []).find((o) => o.code === "RECOV"); }
if (recov) {
  try { await DT.actions.deleteTenant(recov); recovered = true; } catch (e) { recErr = e.message; }
  for (let i = 0; i < 8; i++) await flush();
}
rec("self-heals after session loss (no dead 'unauthorized')", recovered && !(DT.getState().orgs || []).find((o) => o.code === "RECOV"), recErr || (recov ? "" : "addTenant failed after wipe"));

// role switcher: switching FROM developer (platform org) to a clinical role must
// authenticate into the clinical tenant, not the platform org.
await DT.actions.login("developer", "ISPN"); await flush(); await flush();
DT.actions.setRole("hospitalist");
await flush(); await flush();
const swSess = DT.getState().session || {};
rec("role switch developer→hospitalist works", swSess.role === "hospitalist" && (DT.getState().providers || []).length >= 4, "session=" + JSON.stringify(swSess));
DT.actions.setRole("developer");
await flush(); await flush();
rec("role switch back to developer works", (DT.getState().session || {}).role === "developer", "session=" + JSON.stringify(DT.getState().session));

// Developer ROOT access: open any user's portal (impersonation) and return.
await DT.actions.login("developer", "ISPN"); await flush(); await flush();
{
  const target = (DT.getState().devUsers || []).find((u) => u.role === "hospitalist" && u.org === "ISPN")
              || (DT.getState().devUsers || []).find((u) => u.role !== "developer");
  let ok = false, detail = "no target user";
  if (target) {
    await DT.actions.impersonate(target); await flush(); await flush();
    const s1 = DT.getState();
    const into = !!s1.impersonating && s1.session && s1.session.role === target.role;
    await DT.actions.stopImpersonating(); await flush(); await flush();
    const s2 = DT.getState();
    ok = into && !s2.impersonating && (s2.session || {}).role === "developer";
    detail = "into=" + JSON.stringify(s1.impersonating) + " back=" + ((s2.session || {}).role);
  }
  rec("developer root access: impersonate a user's portal and return", ok, detail);
}

// ER/Hospitalist directors can add midlevels (PA/NP) as credentialed consultants.
await DT.actions.login("developer", "ISPN"); await flush();
{
  await DT.actions.addUser({ org: "ISPN", role: "hospitalist", credential: "NP", name: "Riley Midlevel NP", specialty: "Hospital Medicine", shift: "rounding" });
  await flush(); await flush(); await flush();
  const np = (DT.getState().devUsers || []).find((u) => /Riley Midlevel/.test(u.name));
  rec("consultant (PA/NP) added as a credentialed user", !!np && np.credential === "NP", "np=" + JSON.stringify(np && { n: np.name, c: np.credential }));
}

// Amion → shift types: importing detected intervals adds matching shift types
const beforeShifts = (DT.getState().settings.shiftTypes || []).length;
await DT.actions.importShiftTypes([{ name: "Night X-cover", time: "23:00–07:00" }, { name: "Swing", time: "13:00–23:00" }]);
await flush();
const afterShifts = DT.getState().settings.shiftTypes || [];
rec("importShiftTypes adds detected intervals (dedup)", afterShifts.some((t) => t.time === "23:00–07:00") && afterShifts.length === beforeShifts + 1, "before=" + beforeShifts + " after=" + afterShifts.length);

// default assignment timeout is 15
rec("default assignment timeout is 15 min", DT.getState().settings.timeout === 15, "timeout=" + DT.getState().settings.timeout);

// director 24h admissions reset: count since reset drops to 0, log is retained
const logBefore = (DT.getState().admissions || []).length;
DT.actions.resetAdmissions24h();
await flush();
const resetAt = DT.getState().admissionsResetAt;
const sinceReset = (DT.getState().admissions || []).filter((a) => a.at >= resetAt).length;
rec("resetAdmissions24h clears count but keeps log", sinceReset === 0 && (DT.getState().admissions || []).length === logBefore, "since=" + sinceReset + " log=" + (DT.getState().admissions || []).length);

// Customizable dashboards: reorder, remove, and re-add panels (per role).
{
  const ids = ["diversion", "stats", "roster", "recent", "ops", "intake", "board"];
  const def = DT.dashLayout("er_director", ids);
  const orderOk = def.order.length === ids.length && def.hidden.length === 0;
  // reorder: move "board" to the front
  DT.actions.setDashOrder("er_director", ["board"].concat(ids.filter((x) => x !== "board"))); await flush();
  const reordered = DT.dashLayout("er_director", ids).order[0] === "board";
  // remove + re-add
  DT.actions.toggleDashWidget("er_director", "ops"); await flush();
  const removed = DT.dashLayout("er_director", ids).hidden.indexOf("ops") >= 0;
  DT.actions.toggleDashWidget("er_director", "ops"); await flush();
  const readded = DT.dashLayout("er_director", ids).hidden.indexOf("ops") < 0;
  // reset
  DT.actions.resetDashLayout("er_director"); await flush();
  const afterReset = DT.dashLayout("er_director", ids);
  const resetOk = afterReset.order[0] === "diversion" && afterReset.hidden.length === 0;
  rec("dashboard is customizable (reorder / remove / add / reset)", orderOk && reordered && removed && readded && resetOk,
    "orderOk=" + orderOk + " reordered=" + reordered + " removed=" + removed + " readded=" + readded + " reset=" + resetOk);
}

// ER director patient board is modular: defaults to working tiles only, the
// census/FHIR sections stay off, and a toggle persists.
{
  const def = DT.boardModules("er_director");
  const dirDef = DT.boardModules("director");
  rec("ER director board defaults: admissions/accepted on, census/FHIR off",
    def.admissions && def.accepted && !def.census && !def.dataSource && dirDef.census,
    "er_director=" + JSON.stringify(def));
  DT.actions.setBoardModule("er_director", "census", true);
  await flush();
  rec("board module toggle persists", DT.boardModules("er_director").census === true);
  DT.actions.setBoardModule("er_director", "census", false); await flush();
}

// Per-organization schedule source: each org keeps its own, and it's settable.
{
  const sources = DT.getState().scheduleSources || {};
  const distinct = new Set(Object.values(sources)).size;
  rec("schedule source is per-organization (distinct sources seeded)",
    sources.MAYO && sources.STJUDE && distinct >= 2, "sources=" + JSON.stringify(sources));
  DT.actions.setScheduleSource("ISPN", "qgenda"); await flush();
  rec("setScheduleSource updates that org only",
    DT.getState().scheduleSources.ISPN === "qgenda" && DT.getState().scheduleSources.MAYO === sources.MAYO);
}

// Triage acuity: AI suggests an ESI level from the note; it carries onto the
// routed admission so the hospitalist queue can prioritize by urgency.
{
  const a1 = DT.extractIntake("tupac shakur 77M in room hall5 here for GSW");
  const a2 = DT.extractIntake("bob parker 60M chest pain, room 5");
  const a3 = DT.extractIntake("med refill follow-up, room 12");
  rec("triage: AI suggests ESI from the note (GSW=1, chest pain=2, refill=5)",
    a1.acuity === 1 && a2.acuity === 2 && a3.acuity === 5,
    "acuity=" + a1.acuity + "/" + a2.acuity + "/" + a3.acuity);
}
await DT.actions.login("er_doctor", "ISPN"); await flush(); await flush();
{
  let prov = DT.sortedProviders()[0];
  for (let i = 0; i < 12 && !prov; i++) { await flush(); prov = DT.sortedProviders()[0]; }
  let ok = false, detail = "no provider";
  if (prov) {
    DT.actions.sendAssignment(prov, { initials: "AZ", room: "9", complaint: "GSW", specialty: "Cardiology", acuity: 1 }, []);
    await flush(); await flush();
    const adm = (DT.getState().admissions || []).find((a) => a.initials === "AZ");
    ok = !!adm && adm.acuity === 1;
    detail = "adm=" + JSON.stringify(adm && { i: adm.initials, a: adm.acuity });
  }
  rec("triage: acuity carries onto the routed admission", ok, detail);
}

// Consult services are driven by the live registered directory (consultants by
// specialty + PA/NP midlevels), not hardcoded lists.
await DT.actions.login("er_doctor", "ISPN"); await flush(); await flush();
{
  const dir = DT.getState().directory || [];
  const hasSpecialty = dir.some((d) => d.specialty);
  const hasCredential = dir.some((d) => /^(PA|NP|RN|MD|DO)$/.test(d.credential || ""));
  rec("consult services hydrate from the registered directory", dir.length >= 3 && hasSpecialty && hasCredential,
    "dir=" + dir.length + " specialty=" + hasSpecialty + " credential=" + hasCredential);
}

// Schedule-driven on-call: the consult on-call follows the clock — for a given
// specialty it picks the provider whose shift is active now, auto-rotating
// between day and night as the time changes.
{
  const roster = (h) => window.onCallRoster([
    { name: "Dr. Day GI",   specialty: "GI", working: true, shift: "day" },
    { name: "Dr. Night GI", specialty: "GI", working: true, shift: "night" },
  ], h);
  const atDay = roster(9), atNight = roster(23);
  const dayOk = atDay.GI && atDay.GI.name === "Dr. Day GI" && atDay.GI.onCall;
  const nightOk = atNight.GI && atNight.GI.name === "Dr. Night GI" && atNight.GI.onCall;
  rec("on-call follows the schedule by shift time (day/night auto-rotate)", !!(dayOk && nightOk),
    "day=" + JSON.stringify(atDay.GI && { n: atDay.GI.name, o: atDay.GI.onCall }) + " night=" + JSON.stringify(atNight.GI && { n: atNight.GI.name, o: atNight.GI.onCall }));
}

// Consult services are director-editable (add / rename / set on-call / remove).
await DT.actions.login("director", "ISPN"); await flush();
{
  const n0 = (DT.getState().consultServices || []).length;
  DT.actions.addConsultService("Hematology"); await flush();
  const added = (DT.getState().consultServices || []).some((s) => s.name === "Hematology");
  const svc = (DT.getState().consultServices || []).find((s) => s.name === "Hematology");
  DT.actions.setConsultOnCall(svc.id, { name: "Dr. Jordan Chen", avatar: "JC" }); await flush();
  const pinned = (DT.getState().consultServices || []).find((s) => s.name === "Hematology").onCall;
  DT.actions.renameConsultService(svc.id, "Heme/Onc"); await flush();
  const renamed = (DT.getState().consultServices || []).some((s) => s.name === "Heme/Onc");
  // assign a PA/NP under the service, then remove it
  DT.actions.addConsultMember(svc.id, { id: "m_t1", name: "Taylor PA-C", avatar: "TP", role: "PA" }); await flush();
  const withMember = ((DT.getState().consultServices || []).find((s) => s.id === svc.id).members || []).some((m) => m.name === "Taylor PA-C");
  DT.actions.removeConsultMember(svc.id, "m_t1"); await flush();
  const memberRemoved = !((DT.getState().consultServices || []).find((s) => s.id === svc.id).members || []).some((m) => m.id === "m_t1");
  rec("consult service carries its own PA/NPs (add/remove member)", withMember && memberRemoved, "withMember=" + withMember + " removed=" + memberRemoved);
  DT.actions.removeConsultService(svc.id); await flush();
  const removed = !(DT.getState().consultServices || []).some((s) => s.id === svc.id);
  rec("consult services are director-editable (add/rename/on-call/remove)",
    n0 >= 1 && added && pinned && pinned.name === "Dr. Jordan Chen" && renamed && removed,
    "n0=" + n0 + " added=" + added + " pinned=" + JSON.stringify(pinned) + " renamed=" + renamed + " removed=" + removed);
}
// ER director can add/rename but NOT delete; delete stays with director + dev.
await DT.actions.login("er_director", "ISPN"); await flush();
{
  DT.actions.addConsultService("Pain Mgmt"); await flush();
  const svc = (DT.getState().consultServices || []).find((s) => s.name === "Pain Mgmt");
  const erCanAdd = !!svc;
  if (svc) { DT.actions.removeConsultService(svc.id); await flush(); }
  const stillThere = (DT.getState().consultServices || []).some((s) => s.name === "Pain Mgmt");
  rec("consult delete is director/dev-only (ER director add ok, delete blocked)",
    erCanAdd && stillThere, "erCanAdd=" + erCanAdd + " blockedDelete=" + stillThere);
}

// ---- report ---------------------------------------------------------------
console.log("\n================ DocTurn UI smoke test ================\n");
let pass = 0, fail = 0;
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label}`);
  if (!r.ok && r.detail) console.log(`      ↳ ${r.detail.slice(0, 400)}`);
  r.ok ? pass++ : fail++;
}
console.log(`\n${pass} passed, ${fail} failed, ${results.length} total`);
process.exit(fail ? 1 : 0);
