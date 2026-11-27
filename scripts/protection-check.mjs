// Code protection on the BUILT app: the readable source files are not served,
// the shipped bundle carries no file names or comments, the app still works
// from that bundle, and search engines are pointed at the website only.
// BASE_URL=… node scripts/protection-check.mjs
import { chromium } from "playwright-core";
const B = process.env.BASE_URL || "http://127.0.0.1:5000"; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const rec = (n, ok, d = "") => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
const get = async (p) => { const r = await fetch(B + p, { redirect: "manual" }); return { status: r.status, text: await r.text() }; };

for (const p of ["/Codes.jsx", "/components.jsx", "/Messaging.jsx", "/store.js", "/api-bridge.js"]) {
  const r = await get(p);
  rec("source file is not served: " + p, r.status === 404 && !/function|React/.test(r.text), String(r.status));
}
const shell = await get("/");
const scripts = [...shell.text.matchAll(/src="(\/dist\/[^"]+\.js)"/g)].map((m) => m[1]);
const leak = /.{0,50}(?:\.jsx|text\/babel|api-bridge\.js).{0,30}/.exec(shell.text);
rec("the page runs from built bundles only", scripts.length >= 2 && !leak, leak ? "mentions: " + leak[0].replace(/\s+/g, " ") : scripts.join(", "));
rec("the page carries no HTML comments", !/<!--/.test(shell.text));
let total = 0, named = 0, commented = 0, longNames = 0;
for (const s of scripts) {
  const r = await get(s);
  total += r.text.length;
  if (/\/\*\s*\/[A-Za-z]+\.jsx\s*\*\//.test(r.text) || /\b(Codes|Handoffs|Reports|StaffDashboard)\.jsx\b/.test(r.text)) named++;
  if (/\/\/ [A-Z][a-z]+ [a-z]+ [a-z]+/.test(r.text) || /\/\*\*?\s+[A-Z][a-z]+ [a-z]+/.test(r.text)) commented++;
  // Readable local names are gone: long camelCase locals declared with var/let/const are rare after mangling.
  longNames += (r.text.match(/\b(?:const|let|var) [a-z][a-zA-Z]{9,}=/g) || []).length;
}
rec("bundles carry no source file names", named === 0);
rec("bundles carry no comments", commented === 0);
rec("local names are shortened", longNames < 40, longNames + " long local names in " + Math.round(total / 1024) + " KB");
const robots = await get("/robots.txt");
rec("robots.txt keeps search engines to the website", robots.status === 200 && /Disallow: \/\n/.test(robots.text) && /Allow: \/home/.test(robots.text));
rec("no source maps are served", !/"mappings"\s*:/.test((await get(scripts[0] + ".map")).text));

// And it still works: sign in, open several screens, no script errors.
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const c = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const p = await c.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(B + "/", { waitUntil: "networkidle" });
const inputs = await p.locator("input").all(); await inputs[0].fill("ISPN"); await inputs[1].fill("director"); await inputs[2].fill("docturn");
await p.locator('button:has-text("Sign in")').last().click();
await p.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 });
for (const nav of ["dashboard", "board", "codes", "reports", "messages", "directory", "settings"]) { await p.evaluate((n) => window.DT.actions.setNav(n), nav); await sleep(900); }
rec("the app runs from the scrambled bundle with no script errors", errs.length === 0 && !(await p.locator("text=/Something went wrong/i").count()), errs.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
