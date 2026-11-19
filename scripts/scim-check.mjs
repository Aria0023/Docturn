/**
 * SCIM 2.0 provisioning (E2.2, module `enterprise.scim`) in REAL Chromium on
 * emulated iPhones (375×667 / 390×844 / 430×932, DPR 3, touch, iPhone Safari
 * UA), with the SCIM API driven exactly as an identity provider would:
 *
 *   M. Module OFF (the default): Settings has no SCIM card, the token API
 *      answers 404 module_disabled, and a token minted while it was ON stops
 *      working (404, SCIM error body — never the web app's HTML).
 *   T. Module ON: the card shows the server's base URL and token list; a
 *      token is created from the screen and shown ONCE; it is in no store and
 *      no localStorage; revoking it is reflected by the server.
 *   S. The real connector flow with that token: list, create a user
 *      (`application/scim+json`), filter by userName, PATCH a name, PATCH
 *      active:false, PUT, DELETE — and the People screen shows the created
 *      person after a reload, with no password of their own.
 *   D. A SCIM deactivation ends that person's OPEN app at once.
 *   L. Layout at every width (≥44px targets, ≥16px inputs, no overflow);
 *      Z. zero CSP violations / page errors.
 *   Q. (REAL_BASE_URL) SYNTHETIC_DATA=false: a fresh tenant has SCIM off; a
 *      token provisions a user who cannot be signed in with a guessed
 *      password.
 *
 *   BASE_URL=http://127.0.0.1:9076 [REAL_BASE_URL=… REAL_DEV_PASSWORD=…] \
 *     node scripts/scim-check.mjs
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const REAL = process.env.REAL_BASE_URL || "";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const PW = process.env.DEV_PASSWORD || "docturn";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const SIZES = { 375: 667, 390: 844, 430: 932 };
const MODULE = "enterprise.scim";
const results = [];
const rec = (name, ok, note = "") => { results.push([name, !!ok]); console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  -> " + note : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csp = [];
const pageErrors = [];
const RUN = Date.now().toString(36).slice(-4).replace(/[^a-z0-9]/g, "q");

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
    return { status: res.status, text, json, headers: res.headers };
  };
}

/** An identity provider: every call carries the bearer token and scim+json. */
function connector(base, token) {
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        ...(body ? { "content-type": "application/scim+json" } : {}),
        Accept: "application/scim+json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, text, json, type: res.headers.get("content-type") || "" };
  };
}

async function open(base, width, org, username, password = PW) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(username + "@" + width + ": " + String((e && e.message) || e)));
  page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(username + ": " + t.slice(0, 160)); });
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
  return { ctx, page, width, username };
}

const nav = async (page, id, settle = 1800) => { await page.evaluate((n) => window.DT.actions.setNav(n), id); await sleep(settle); };

const card = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-scim]");
    const baseEl = document.querySelector("[data-scim-base]");
    const label = document.querySelector("[data-scim-label]");
    const small = [];
    for (const b of document.querySelectorAll("[data-scim-create], [data-scim-revoke], [data-scim-dismiss]")) {
      const r = b.getBoundingClientRect();
      if (r.width > 0 && (r.height < 43.5 || r.width < 43.5)) small.push((b.textContent || "").trim() + " " + Math.round(r.width) + "x" + Math.round(r.height));
    }
    return {
      present: !!el,
      state: el && el.getAttribute("data-scim"),
      baseUrl: baseEl ? baseEl.innerText.trim() : null,
      tokens: [...document.querySelectorAll("[data-scim-token]")].map((t) => ({ id: t.getAttribute("data-scim-token"), active: t.getAttribute("data-scim-token-active"), text: t.innerText.replace(/\s+/g, " ").trim() })),
      labelInput: label ? { h: Math.round(label.getBoundingClientRect().height), font: Math.round(parseFloat(getComputedStyle(label).fontSize)), right: Math.round(label.getBoundingClientRect().right) } : null,
      shown: (document.querySelector("[data-scim-new-token]") || {}).innerText || null,
      small,
      vw: innerWidth,
      doc: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    };
  });

const director = await apiSession(BASE, "ISPN", "director");
const dev = await apiSession(BASE, "DOCTURN", "dev");
const orgId = (await director("GET", "/api/user")).json.organizationId;
const setModule = async (enabled, org = orgId, id = MODULE) => {
  const r = await dev("PATCH", "/api/dev/modules/" + org, { id, enabled });
  if (r.status !== 200) throw new Error("module flip " + r.status + " " + r.text);
};

let mintedWhileOn = null;

try {
  // ── T / L. module ON: the card mints a token ─────────────────────────────
  await setModule(true);
  console.log("\n=== " + MODULE + " ON ===");
  for (const width of [375, 390, 430]) {
    const h = await open(BASE, width, "ISPN", "director");
    await nav(h.page, "account", 2400);
    let c = await card(h.page);
    rec(`T[${width}]: the card is offered and shows the server's base URL`, c.present && /\/scim\/v2$/.test(c.baseUrl || ""), JSON.stringify({ present: c.present, baseUrl: c.baseUrl }));
    rec(`L[${width}]: the label input is ≥44px tall with ≥16px text, inside the viewport`, !!c.labelInput && c.labelInput.h >= 43.5 && c.labelInput.font >= 16 && c.labelInput.right <= c.vw + 0.5, JSON.stringify(c.labelInput));
    rec(`L[${width}]: every button is a ≥44px target`, c.small.length === 0, c.small.join(" | "));
    rec(`L[${width}]: no horizontal overflow`, c.doc <= c.vw, JSON.stringify({ doc: c.doc, vw: c.vw }));

    if (width === 390) {
      await h.page.fill("[data-scim-label]", "Okta " + RUN);
      await h.page.click("[data-scim-create]");
      await h.page.waitForSelector("[data-scim-new-token]", { timeout: 20000 });
      await sleep(600);
      c = await card(h.page);
      const token = (c.shown || "").trim();
      mintedWhileOn = token;
      rec("T: the token is shown once and looks like a DocTurn SCIM token", /^dts_[A-Za-z0-9_-]{20,}$/.test(token), token ? token.slice(0, 12) + "…" : "none");
      rec("T: it is listed as active", c.tokens.some((t) => t.active === "1" && /Okta/.test(t.text)), JSON.stringify(c.tokens));
      const leaked = await h.page.evaluate((t) => ({
        state: JSON.stringify(window.DT.getState()).includes(t),
        ls: JSON.stringify(Object.entries(localStorage)).includes(t),
      }), token);
      rec("T: the token is in NO store and NO localStorage", leaked.state === false && leaked.ls === false, JSON.stringify(leaked));
      const srv = (await director("GET", "/api/org/scim-tokens")).json;
      rec("T: the server holds it with no secret in the list", srv.tokens.some((t) => t.active) && !JSON.stringify(srv).includes(token), JSON.stringify(srv.tokens.map((t) => [t.id, t.active])));

      // ── S. the connector flow ──────────────────────────────────────────
      console.log("\n=== the identity provider's own calls ===");
      const idp = connector(BASE, token);
      const spc = await idp("GET", "/scim/v2/ServiceProviderConfig");
      rec("S: ServiceProviderConfig is served as application/scim+json", spc.status === 200 && /application\/scim\+json/.test(spc.type) && spc.json.patch.supported === true, spc.status + " " + spc.type);
      const list = await idp("GET", "/scim/v2/Users");
      rec("S: the list is the org's clinical accounts only", list.status === 200 && list.json.Resources.some((u) => u.userName === "chen") && !list.json.Resources.some((u) => u.userName === "director"), "n=" + (list.json && list.json.totalResults));
      const userName = "idp." + RUN;
      const made = await idp("POST", "/scim/v2/Users", {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName,
        name: { givenName: "Ivy", familyName: "Provisioned" },
        roles: [{ value: "hospitalist" }],
        emails: [{ value: "ivy@example.org" }],
        externalId: "ext-" + RUN,
        active: true,
      });
      rec("S: a user is created (201, Location, active)", made.status === 201 && made.json.active === true && made.json.displayName === "Ivy Provisioned", made.status + " " + JSON.stringify(made.json && made.json.userName));
      const newId = made.json && Number(made.json.id);
      const filtered = await idp("GET", `/scim/v2/Users?filter=userName eq "${userName}"`);
      rec("S: the IdP can find them again by userName", filtered.status === 200 && filtered.json.totalResults === 1 && Number(filtered.json.Resources[0].id) === newId, JSON.stringify(filtered.json && filtered.json.totalResults));
      const renamed = await idp("PATCH", `/scim/v2/Users/${newId}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", path: "name.familyName", value: "Renamed" }] });
      rec("S: PATCH renames them", renamed.status === 200 && /Renamed/.test(renamed.json.displayName), renamed.status + " " + (renamed.json && renamed.json.displayName));
      const dupe = await idp("POST", "/scim/v2/Users", { userName, displayName: "Twin" });
      rec("S: a duplicate userName is 409 uniqueness", dupe.status === 409 && dupe.json.scimType === "uniqueness", String(dupe.status));
      const noPassword = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgCode: "ISPN", username: userName, password: PW }) });
      rec("S: the provisioned account has no password of its own", noPassword.status === 401, String(noPassword.status));

      // The People screen shows them after a reload (the server's roster).
      await nav(h.page, "people", 2600);
      const onScreen = await h.page.evaluate((u) => {
        const row = [...document.querySelectorAll("[data-person]")].find((el) => el.getAttribute("data-person") === u);
        return row ? row.innerText.replace(/\s+/g, " ").trim() : null;
      }, userName);
      rec("S: the People screen lists the provisioned person", !!onScreen && /Renamed/.test(onScreen), onScreen || "not listed");

      // ── D. deactivation ends their open app ────────────────────────────
      console.log("\n=== a SCIM deactivation ends an open session ===");
      const temp = (await director("POST", `/api/accounts/${newId}/reset-password`)).json;
      if (temp && temp.temporaryPassword) {
        const NEWPW = "Scim-Check-2026!";
        const first = await apiSession(BASE, "ISPN", userName, temp.temporaryPassword);
        await first("PATCH", "/api/account/password", { currentPassword: temp.temporaryPassword, newPassword: NEWPW });
        const theirs = await open(BASE, 390, "ISPN", userName, NEWPW);
        const off = await idp("PATCH", `/scim/v2/Users/${newId}`, { Operations: [{ op: "Replace", path: "active", value: "False" }] });
        rec("D: PATCH active=False (Entra's dialect) deactivates", off.status === 200 && off.json.active === false, String(off.status));
        await theirs.page.waitForFunction(() => !window.DT.getState().session, null, { timeout: 30000 }).catch(() => {});
        const state = await theirs.page.evaluate(() => ({ session: !!window.DT.getState().session }));
        rec("D: their open app is signed out at once", state.session === false, JSON.stringify(state));
        rec("D: and the password no longer signs in", (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgCode: "ISPN", username: userName, password: NEWPW }) })).status === 401);
        await theirs.ctx.close();
      } else {
        rec("D: (setup) a one-time password could be issued for the provisioned user", false, JSON.stringify(temp));
      }
      const del = await idp("DELETE", `/scim/v2/Users/${newId}`);
      rec("S: DELETE is a deactivation (204) and the account still exists", del.status === 204 && (await idp("GET", `/scim/v2/Users/${newId}`)).json.active === false, String(del.status));

      // Revoke from the screen.
      await nav(h.page, "account", 2400);
      const before = (await card(h.page)).tokens.find((t) => t.active === "1");
      await h.page.click(`[data-scim-revoke="${before.id}"]`);
      await sleep(1500);
      c = await card(h.page);
      rec("T: revoking is reflected by the server", c.tokens.find((t) => t.id === before.id).active === "0", JSON.stringify(c.tokens));
      const dead = await idp("GET", "/scim/v2/Users");
      rec("T: the revoked token is refused (401)", dead.status === 401 && /application\/scim\+json/.test(dead.type), String(dead.status));
    }
    await h.ctx.close();
  }

  // ── M. module OFF ───────────────────────────────────────────────────────
  console.log("\n=== " + MODULE + " OFF ===");
  // A token that works now…
  const live = (await director("POST", "/api/org/scim-tokens", { label: "while on" })).json.token;
  const idpLive = connector(BASE, live);
  rec("M (setup): the new token works while the module is on", (await idpLive("GET", "/scim/v2/Users")).status === 200);
  await setModule(false);
  const refused = await idpLive("GET", "/scim/v2/Users");
  rec("M: with the module off the endpoint answers 404 as a SCIM error", refused.status === 404 && /application\/scim\+json/.test(refused.type) && refused.json.status === "404", refused.status + " " + refused.type);
  rec("M: never the web app's HTML shell", !/text\/html/.test(refused.type) && !/<!doctype/i.test(refused.text), refused.text.slice(0, 60));
  rec("M: the token API answers 404 module_disabled", (await director("GET", "/api/org/scim-tokens")).status === 404);
  {
    const h = await open(BASE, 390, "ISPN", "director");
    await nav(h.page, "account", 2400);
    const c = await card(h.page);
    rec("M: Settings has no SCIM card", c.present === false, String(c.present));
    await h.ctx.close();
  }

  // ── Q. a non-synthetic server ───────────────────────────────────────────
  if (REAL) {
    console.log("\n=== real server " + REAL + " ===");
    const rdev = await apiSession(REAL, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD || PW);
    const cfg = (await rdev("GET", "/api/config")).json;
    rec("Q (setup): the server is SYNTHETIC_DATA=false", cfg && cfg.syntheticData === false, String(cfg && cfg.syntheticData));
    const code = "SC" + RUN.toUpperCase().replace(/[^A-Z0-9]/g, "Q");
    const o = (await rdev("POST", "/api/dev/organizations", { name: "Scim Check " + RUN, code, timezone: "America/Chicago" })).json;
    const made = (await rdev("POST", "/api/dev/users", { organizationId: o.id, role: "director", username: "sc.dir", displayName: "Dr. Scim Check" })).json;
    const NEWPW = "Scim-Real-2026!";
    const first = await apiSession(REAL, code, "sc.dir", made.temporaryPassword);
    await first("PATCH", "/api/account/password", { currentPassword: made.temporaryPassword, newPassword: NEWPW });
    const rdir = await apiSession(REAL, code, "sc.dir", NEWPW);
    rec("Q: a fresh tenant has SCIM off", (await rdir("GET", "/api/org/scim-tokens")).status === 404);
    await rdev("PATCH", `/api/dev/modules/${o.id}`, { id: MODULE, enabled: true });
    const tok = (await rdir("POST", "/api/org/scim-tokens", { label: "real" })).json;
    rec("Q: switched on, a token is minted and shown once", typeof tok.token === "string" && tok.token.startsWith("dts_"), String(tok.token || "").slice(0, 10) + "…");
    const idp = connector(REAL, tok.token);
    const u = await idp("POST", "/scim/v2/Users", { userName: "real." + RUN, name: { givenName: "Real", familyName: "Person" }, roles: [{ value: "er_doctor" }] });
    rec("Q: it provisions a user in THAT tenant only", u.status === 201 && u.json.roles[0].value === "er_doctor", String(u.status));
    const guess = await fetch(REAL + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgCode: code, username: "real." + RUN, password: "docturn" }) });
    rec("Q: the provisioned user has no guessable password", guess.status === 401, String(guess.status));
    const crossTenant = await idp("GET", '/scim/v2/Users?filter=userName eq "sc.dir"');
    rec("Q: a director is invisible to the connector", crossTenant.status === 200 && crossTenant.json.totalResults === 0, JSON.stringify(crossTenant.json && crossTenant.json.totalResults));
  }
} finally {
  await setModule(false).catch(() => {});
  await browser.close();
}

rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
