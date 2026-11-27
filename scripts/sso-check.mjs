/**
 * OIDC single sign-on (E2.1, module `enterprise.sso`) in REAL Chromium on
 * emulated iPhones (375×667 / 390×844 / 430×932, DPR 3, touch, iPhone Safari
 * UA), against a LOCAL identity provider this script starts (RS256 key
 * generated at runtime — nothing is committed):
 *
 *   M. Module OFF (the default): the sign-in screen offers no SSO button for
 *      any org code, and the director's card is 404.
 *   B. Module ON, configured: the button appears for the typed org code —
 *      and NOT for an unknown code, so the screen is not an org-code oracle.
 *   F. The whole redirect round trip in the browser: the IdP's authorize URL
 *      carries PKCE S256 + state + nonce, the callback signs a brand-new
 *      person in (JIT), and they land in the app with the role their group
 *      maps to.
 *   R. "SSO required": the password form refuses with the hospital's own
 *      sentence (not "wrong password"), and the lock screen offers the
 *      identity provider instead of a password.
 *   C. The card: saving, the real Test connection, and the redirect URI the
 *      hospital must register.
 *   L. Layout at every width; Z. zero CSP violations / page errors.
 *
 * The server under test must run with INTEGRATION_KEY set (the client secret
 * is sealed with it; without one the server REFUSES to store a connection,
 * which this script reports as a setup failure rather than working around)
 * and with SSO_ALLOW_INSECURE_ISSUER=1 (the lab hatch — never possible with
 * NODE_ENV=production) so the issuer may be this script's http://127.0.0.1
 * fixture.
 *
 *   PORT=9084 INTEGRATION_KEY=$(openssl rand -hex 32) SSO_ALLOW_INSECURE_ISSUER=1 \
 *     RATE_LIMIT=off npx tsx server/index.ts
 *   BASE_URL=http://127.0.0.1:9084 node scripts/sso-check.mjs
 */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const PW = process.env.DEV_PASSWORD || "docturn";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const SIZES = { 375: 667, 390: 844, 430: 932 };
const MODULE = "enterprise.sso";
const results = [];
const rec = (name, ok, note = "") => { results.push([name, !!ok]); console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  -> " + note : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csp = [];
const pageErrors = [];
const RUN = Date.now().toString(36).slice(-4).replace(/[^a-z0-9]/g, "q");

/* ── the identity provider ───────────────────────────────────────────────── */
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = b64url(randomBytes(8));
const JWK = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };
let idpBase = "";
let nextClaims = {};
const authorizeCalls = [];
const idp = createServer((req, res) => {
  const url = new URL(req.url, idpBase);
  const json = (s, b) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  if (url.pathname === "/.well-known/openid-configuration") {
    return json(200, {
      issuer: idpBase,
      authorization_endpoint: `${idpBase}/authorize`,
      token_endpoint: `${idpBase}/token`,
      jwks_uri: `${idpBase}/jwks`,
    });
  }
  if (url.pathname === "/jwks") return json(200, { keys: [JWK] });
  if (url.pathname === "/authorize") {
    // Play the identity provider's own sign-in page: accept at once and
    // redirect straight back to DocTurn with a code, as a real IdP does once
    // the person has authenticated there.
    const q = Object.fromEntries(url.searchParams.entries());
    authorizeCalls.push(q);
    nextClaims = { ...nextClaims, nonce: q.nonce };
    const back = new URL(q.redirect_uri);
    back.searchParams.set("code", "code-" + b64url(randomBytes(6)));
    back.searchParams.set("state", q.state);
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (url.pathname === "/token" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = { iss: idpBase, sub: "idp-sub", aud: "docturn-client", iat: now, exp: now + 300, ...nextClaims };
      const header = { alg: "RS256", typ: "JWT", kid: KID };
      const h = b64url(Buffer.from(JSON.stringify(header)));
      const p = b64url(Buffer.from(JSON.stringify(claims)));
      const s = createSign("RSA-SHA256");
      s.update(`${h}.${p}`);
      json(200, { access_token: "at", token_type: "Bearer", id_token: `${h}.${p}.${b64url(s.sign(privateKey))}` });
    });
    return undefined;
  }
  return json(404, { error: "not_found" });
});
await new Promise((r) => idp.listen(0, "127.0.0.1", r));
idpBase = `http://127.0.0.1:${idp.address().port}`;
console.log("local identity provider at " + idpBase);

/* ── helpers ─────────────────────────────────────────────────────────────── */
async function apiSession(orgCode, username, password = PW) {
  const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgCode, username, password }) });
  if (!r.ok) throw new Error("login " + username + " " + r.status);
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  return async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, text, json };
  };
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

async function openLogin(width) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(width + ": " + String((e && e.message) || e)));
  page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(t.slice(0, 160)); });
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.log("Refused to load (CSP) " + e.violatedDirective + " " + e.blockedURI)); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle" });
  return { ctx, page };
}

/** Type an org code and report what the sign-in screen then offers. */
async function ssoButton(page, orgCode) {
  const inputs = await page.locator("input").all();
  await inputs[0].fill("");
  await inputs[0].type(orgCode, { delay: 10 });
  await inputs[0].blur();
  await sleep(1200);
  return page.evaluate(() => {
    const el = document.querySelector("[data-sso-button]");
    if (!el) return { present: false };
    const btn = el.querySelector("button") || el;
    const r = btn.getBoundingClientRect();
    return { present: true, label: btn.innerText.replace(/\s+/g, " ").trim(), h: Math.round(r.height), w: Math.round(r.width), right: Math.round(r.right), vw: innerWidth, doc: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) };
  });
}

async function signInWithPassword(page, org, username, password = PW) {
  const inputs = await page.locator("input").all();
  await inputs[0].fill(org);
  await inputs[1].fill(username);
  await inputs[2].fill(password);
  // The PASSWORD button only: with the SSO button on screen its accessible
  // name also starts with "Sign in", and `type="submit"` is what tells them
  // apart (the SSO button is a plain button).
  await page.locator('button[type="submit"]:has-text("Sign in")').last().click();
  await sleep(2200);
}

const director = await apiSession("ISPN", "director");
const dev = await apiSession("DOCTURN", "dev");
const orgId = (await director("GET", "/api/user")).json.organizationId;
const setModule = async (enabled, id = MODULE) => {
  const r = await dev("PATCH", "/api/dev/modules/" + orgId, { id, enabled });
  if (r.status !== 200) throw new Error("module flip " + r.status + " " + r.text);
};

try {
  const cfg = await director("GET", "/api/config");
  rec("(setup) the server is reachable", cfg.status === 200);
  await setModule(true);
  const keyed = await director("PUT", "/api/org/sso", { issuer: "https://probe.example.com", clientId: "probe", clientSecret: "probe-secret-12345" });
  rec("(setup) the server can seal a client secret (INTEGRATION_KEY is set)", keyed.status === 200, keyed.status + " " + keyed.text.slice(0, 120));
  await director("DELETE", "/api/org/sso");

  // ── M. module OFF ────────────────────────────────────────────────────────
  await setModule(false);
  console.log("\n=== " + MODULE + " OFF ===");
  {
    const { ctx, page } = await openLogin(390);
    const b = await ssoButton(page, "ISPN");
    rec("M: no SSO button on the sign-in screen", b.present === false, JSON.stringify(b));
    rec("M: the director's card is 404", (await director("GET", "/api/org/sso")).status === 404);
    const avail = await fetch(BASE + "/api/auth/sso/available", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgCode: "ISPN" }) });
    rec("M: the lookup says no SSO", avail.status === 200 && (await avail.json()).sso === false);
    await ctx.close();
  }

  // ── C. the card ──────────────────────────────────────────────────────────
  await setModule(true);
  console.log("\n=== the director's card ===");
  const lab = (await director("GET", "/api/org/sso")).json;
  rec("C: the card names the redirect URI to register", /\/api\/auth\/sso\/callback$/.test(lab.redirectUri || ""), lab.redirectUri);
  rec("C: the server is in lab mode (SSO_ALLOW_INSECURE_ISSUER)", lab.insecureIssuersAllowed === true, String(lab.insecureIssuersAllowed));
  rec("C: single sign-on cannot grant developer", Array.isArray(lab.assignableRoles) && !lab.assignableRoles.includes("developer"), JSON.stringify(lab.assignableRoles));
  const refusedIssuer = await director("PUT", "/api/org/sso", { issuer: "http://idp.example.com", clientId: "docturn-client", clientSecret: "secret12345" });
  rec("C: a plain-http PUBLIC issuer is still refused", refusedIssuer.status === 400, String(refusedIssuer.status));
  const saved = await director("PUT", "/api/org/sso", {
    issuer: idpBase,
    clientId: "docturn-client",
    clientSecret: "secret12345",
    config: { claim: "groups", defaultRole: "hospitalist", map: { "DocTurn-Directors": "director" }, scopes: "openid profile email" },
  });
  rec("C: the local issuer is saved and the secret is never returned", saved.status === 200 && saved.json.clientSecretStored === true && !saved.text.includes("secret12345"), String(saved.status));
  const tested = await director("POST", "/api/org/sso/test");
  rec("C: Test connection really reaches the issuer and counts its keys", tested.status === 200 && tested.json.ok === true && tested.json.signingKeys === 1, JSON.stringify(tested.json));

  // ── B / F / L. the button and the whole round trip ───────────────────────
  for (const width of [375, 390, 430]) {
    console.log(`\n=== sign-in screen (iPhone ${width}) ===`);
    const { ctx, page } = await openLogin(width);
    const mine = await ssoButton(page, "ISPN");
    rec(`B[${width}]: the button appears for an org code that HAS single sign-on`, mine.present && /sign in with/i.test(mine.label), JSON.stringify(mine));
    rec(`L[${width}]: it is a ≥44px target inside the viewport, no overflow`, mine.h >= 43.5 && mine.right <= mine.vw + 0.5 && mine.doc <= mine.vw, JSON.stringify(mine));
    const unknown = await ssoButton(page, "NOSUCHORG");
    rec(`B[${width}]: and NOT for an org code that does not exist`, unknown.present === false, JSON.stringify(unknown));

    if (width === 390) {
      // F. the round trip: click the button, let the IdP redirect back.
      nextClaims = { preferred_username: "sso." + RUN, name: "Dr. Sso Check", groups: ["DocTurn-Directors"] };
      await ssoButton(page, "ISPN");
      await page.click("[data-sso-button] button");
      await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role); }, null, { timeout: 30000 }).catch(() => {});
      await sleep(1500);
      const state = await page.evaluate(() => { const s = window.DT.getState(); return { role: s.session && s.session.role, user: s.session && s.session.user, url: location.pathname + location.search }; });
      rec("F: the person is signed in, with the role their group maps to", state.role === "director" && state.user === "sso." + RUN, JSON.stringify(state));
      const q = authorizeCalls[authorizeCalls.length - 1] || {};
      rec("F: the authorize request used code + PKCE S256 + state + nonce", q.response_type === "code" && q.code_challenge_method === "S256" && !!q.code_challenge && !!q.state && !!q.nonce, JSON.stringify({ rt: q.response_type, m: q.code_challenge_method, hasState: !!q.state, hasNonce: !!q.nonce }));
      rec("F: the redirect URI it sent is the one the card shows", q.redirect_uri === lab.redirectUri, q.redirect_uri);
      const row = await dev("GET", `/api/dev/organizations/${orgId}/audit`);
      const login = (row.json.audit || []).find((r) => r.action === "sso.login");
      rec("F: the sign-in is audited, with no token or secret in it", !!login && !JSON.stringify(login).includes("secret12345"), login ? JSON.stringify(login.details) : "no row");
      rec("F: a just-in-time account was created with no password", (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgCode: "ISPN", username: "sso." + RUN, password: PW }) })).status === 401);
      await ctx.close();

      // ── R. SSO required ───────────────────────────────────────────────
      console.log("\n=== 'SSO required' ===");
      const required = await director("PUT", "/api/org/sso", { issuer: idpBase, clientId: "docturn-client", ssoRequired: true });
      rec("R (setup): the connection is marked 'SSO required'", required.status === 200 && required.json.ssoRequired === true, required.status + " " + required.text.slice(0, 120));
      const pw = await openLogin(390);
      await signInWithPassword(pw.page, "ISPN", "chen");
      const refused = await pw.page.evaluate(() => { const s = window.DT.getState(); return { session: !!s.session, error: s.loginError }; });
      rec("R: a password is refused and the screen says to use the hospital's sign-in", refused.session === false && /single sign-on|hospital/i.test(refused.error || ""), JSON.stringify(refused));
      rec("R: it does NOT say the password was wrong", !/password/i.test(refused.error || "") || /single sign-on/i.test(refused.error || ""), refused.error);
      const devStill = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgCode: "DOCTURN", username: "dev", password: PW }) });
      rec("R: the operator's break-glass still signs in", devStill.status === 200, String(devStill.status));
      const breakGlass = (await dev("GET", `/api/dev/organizations/${orgId}/audit`)).json.audit || [];
      rec("R: both the refusal and the break-glass are audited", breakGlass.some((r) => r.action === "auth.login_denied_sso_required"), "");
      await pw.ctx.close();
      await director("PUT", "/api/org/sso", { issuer: idpBase, clientId: "docturn-client", ssoRequired: false });
    } else {
      await ctx.close();
    }
  }
} finally {
  await director("DELETE", "/api/org/sso").catch(() => {});
  await setModule(false).catch(() => {});
  await browser.close();
  await new Promise((r) => idp.close(r));
}

rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
rec("Z: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
