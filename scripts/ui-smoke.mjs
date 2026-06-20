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

// ---- load the app exactly as index.html does ------------------------------
const runInWindow = (code, name) => vm.runInContext(code, ctx, { filename: name });
for (const f of ["react.js", "react-dom.js", "lucide.min.js"]) runInWindow(fs.readFileSync(path.join(VEND, f), "utf8"), f);
if (!window.React || !window.ReactDOM) { console.log("FATAL: React UMD did not attach"); process.exit(2); }
runInWindow(read("store.js"), "store.js");
runInWindow(read("api-bridge.js"), "api-bridge.js");
if (!window.DT) { console.log("FATAL: store.js did not set window.DT"); process.exit(2); }

const JSX_FILES = [
  "components.jsx", "LoginScreen.jsx", "LockScreen.jsx", "AppShell.jsx",
  "HospitalistDashboard.jsx", "ErDoctorDashboard.jsx", "DirectorDashboard.jsx",
  "ErDirectorDashboard.jsx", "Messaging.jsx", "Directory.jsx", "CareTeam.jsx",
  "PatientBoard.jsx", "DeveloperDashboard.jsx", "Compliance.jsx", "Broadcasts.jsx",
  "ScheduleSync.jsx", "OrgSettings.jsx", "RoleManagement.jsx", "People.jsx", "Appearance.jsx",
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
const rec = (label, ok, detail = "") => results.push({ label, ok, detail });

// Buttons that change session/identity — skipped so the sweep doesn't flood
// /api/login (role switcher) or log itself out mid-test.
const SKIP_LABELS = new Set(["hospitalist", "er physician", "er director", "hosp. director", "developer", "log out", "sign out", "logout", "lock"]);
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
  developer: ["dashboard", "roles", "compliance", "appearance", "settings"],
  director: ["dashboard", "board", "broadcasts", "messages", "access", "directory", "compliance", "appearance", "settings"],
  er_director: ["dashboard", "board", "broadcasts", "messages", "access", "directory", "compliance", "appearance", "settings"],
  er_doctor: ["dashboard", "board", "team", "messages", "directory", "compliance"],
  hospitalist: ["dashboard", "board", "team", "messages", "directory", "compliance"],
};

await flush();
rec("App mounted", !!window.document.querySelector("#root").children.length);

for (const role of ["developer", "director", "er_director", "er_doctor", "hospitalist"]) {
  await DT.actions.login(role, "MERCY");
  await flush(); await flush();
  const st = DT.getState();
  rec(`LOGIN as ${role}`, st.session && st.session.role === role, "session=" + JSON.stringify(st.session));
  if (role === "developer") {
    const mercy = (st.orgs || []).find((o) => o.code === "MERCY");
    rec("developer: orgs hydrated from backend", !!mercy && mercy.users === 9, "orgs=" + JSON.stringify((st.orgs || []).map((o) => o.code + ":" + o.users)));
  }
  if (role === "hospitalist") rec("hospitalist: providers hydrated", (st.providers || []).length >= 4, "providers=" + (st.providers || []).length);
  for (const navId of NAV[role]) { DT.actions.setNav(navId); await flush(); await clickEveryButton(role, navId); }
}

// developer org CRUD
await DT.actions.login("developer", "MERCY"); await flush();
DT.actions.addTenant({ name: "Harness Test Hospital", code: "HARN", city: "Testville", state: "CA", timezone: "America/Los_Angeles" });
await flush(); await flush();
const harn = (DT.getState().orgs || []).find((o) => o.code === "HARN");
rec("addTenant creates org", !!harn);
let delOk = false, delErr = "";
try { await DT.actions.deleteTenant(harn || { code: "HARN" }); delOk = true; } catch (e) { delErr = e.message; }
await flush();
rec("deleteTenant removes empty org", delOk && !(DT.getState().orgs || []).find((o) => o.code === "HARN"), delErr && "threw: " + delErr);
let mercyErr = "";
try { await DT.actions.deleteTenant({ code: "MERCY" }); } catch (e) { mercyErr = e.message; }
rec("deleteTenant blocks org with users", /still has users/i.test(mercyErr), "msg=" + mercyErr);

// clinical flow: ER doctor sends -> hospitalist receives -> accept
await DT.actions.login("er_doctor", "MERCY"); await flush();
const provs = DT.sortedProviders();
const target = provs.find((p) => /Chen/i.test(p.name)) || provs[0];
DT.actions.sendAssignment(target, { initials: "ZZ", room: "999", complaint: "Harness chest pain", specialty: "Cardiology" }, []);
await flush(); await flush();
await DT.actions.login("hospitalist", "MERCY"); await flush(); await flush();
const got = (DT.getState().pending || []).find((p) => p.initials === "ZZ");
rec("ER->hospitalist: sent assignment appears in pending", !!got, "pending=" + JSON.stringify((DT.getState().pending || []).map((p) => p.initials)));
if (got) {
  DT.actions.accept(got.id); await flush(); await flush();
  rec("hospitalist: accept removes it from pending", !(DT.getState().pending || []).find((p) => p.initials === "ZZ"));
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
