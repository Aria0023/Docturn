import { afterEach, describe, expect, it } from "vitest";
import { boot, closeAll, count, sleep } from "./client-parity-harness.js";

/**
 * Single sign-on, client half (E2.1, module `enterprise.sso`) — the real
 * store.js + api-bridge.js in jsdom.
 *
 * The client's whole job here is to ASK and to FOLLOW:
 *   • it asks the server once per typed org code whether that code has SSO,
 *     and remembers only the server's answer (never a list of orgs);
 *   • `startSso` posts the code and follows the URL the SERVER built — the
 *     client never holds an issuer, a client secret, PKCE or a nonce;
 *   • the `?sso=<code>` the identity provider sends the browser back with is
 *     turned into one sentence and REMOVED from the address bar;
 *   • the director's card sends one request per change and never keeps the
 *     client secret.
 *
 * The screens themselves are measured in Chromium by scripts/sso-check.mjs.
 */
afterEach(closeAll);

const on = { "enterprise.sso": true };
const CONN = {
  configured: true,
  issuer: "https://hospital.okta.com",
  clientId: "docturn",
  clientSecretStored: true,
  secretReadable: true,
  unreadableReason: null,
  config: { claim: "groups", defaultRole: "hospitalist", map: { Directors: "director" }, scopes: "openid profile email", acrMfaValue: null },
  ssoRequired: false,
  enabled: true,
  redirectUri: "https://app.test/api/auth/sso/callback",
  assignableRoles: ["hospitalist", "er_doctor", "er_director", "director"],
  defaults: { claim: "groups", scopes: "openid profile email" },
  insecureIssuersAllowed: false,
};

describe("SSO (client) — the sign-in screen's lookup", () => {
  it("asks the server once per org code and keeps only its answer", async () => {
    const h = await boot({ modules: on });
    h.routes.sso = (r) =>
      r.path === "/api/auth/sso/available" && r.method === "POST"
        ? { status: 200, body: r.body.orgCode === "ISPN" ? { sso: true, label: "Inspira" } : { sso: false } }
        : undefined;
    expect(await h.w.DT.actions.ssoAvailable("ispn")).toEqual({ sso: true, label: "Inspira" });
    // The code is upper-cased for the server, as the org lookup is.
    expect(h.reqs.filter((r) => r.path === "/api/auth/sso/available").pop()!.body).toEqual({ orgCode: "ISPN" });
    // Asked once, however often the screen re-renders.
    await h.w.DT.actions.ssoAvailable("ISPN");
    await h.w.DT.actions.ssoAvailable("ispn ");
    expect(count(h, "POST", "/api/auth/sso/available")).toBe(1);
    expect(h.state().ssoOffers).toEqual({ ISPN: { sso: true, label: "Inspira" } });

    expect(await h.w.DT.actions.ssoAvailable("NOPE")).toEqual({ sso: false });
    expect(h.state().ssoOffers.NOPE).toEqual({ sso: false });
    // Nothing is stored about which orgs exist.
    expect(JSON.stringify(Object.entries(h.w.localStorage))).not.toContain("ISPN");
  });

  it("asks nothing for a code too short to be one", async () => {
    const h = await boot({ modules: on });
    expect(await h.w.DT.actions.ssoAvailable("I")).toBeNull();
    expect(await h.w.DT.actions.ssoAvailable("")).toBeNull();
    expect(count(h, "POST", "/api/auth/sso/available")).toBe(0);
  });

  it("offers nothing when the server cannot be reached", async () => {
    const h = await boot({ modules: on });
    h.routes.sso = (r) => (r.path === "/api/auth/sso/available" ? { network: true } : undefined);
    expect(await h.w.DT.actions.ssoAvailable("ISPN")).toBeNull();
    expect(h.state().ssoOffers).toBeUndefined();
  });
});

describe("SSO (client) — starting and returning", () => {
  it("follows the URL the server built, and holds no protocol state of its own", async () => {
    const h = await boot({ modules: on });
    const url = "https://hospital.okta.com/authorize?state=abc&nonce=def&code_challenge=xyz";
    h.routes.sso = (r) => (r.path === "/api/auth/sso/start" ? { status: 200, body: { url } } : undefined);
    // jsdom implements neither navigation nor a replaceable `location`, so
    // the observable here is that the action resolves with the SERVER's URL
    // (the browser really following it is measured by
    // scripts/sso-check.mjs, which completes the round trip in Chromium).
    expect(await h.w.DT.actions.startSso("ISPN")).toBe(url);
    const post = h.reqs.filter((r) => r.path === "/api/auth/sso/start").pop()!;
    expect(post.body).toEqual({ orgCode: "ISPN" });
    // No PKCE, state or nonce is the client's to keep.
    const state = JSON.stringify(h.state());
    expect(state).not.toContain("code_challenge");
    expect(state).not.toContain("abc");
  });

  it("says why when the server cannot start the flow", async () => {
    const h = await boot({ modules: on });
    let reply: any = { status: 404, body: { error: "sso_not_available" } };
    h.routes.sso = (r) => (r.path === "/api/auth/sso/start" ? reply : undefined);
    expect(await h.w.DT.actions.startSso("ISPN")).toBeNull();
    expect(h.state().loginError).toMatch(/isn't set up/i);
    reply = { status: 502, body: { error: "sso_unavailable", reason: "discovery" } };
    expect(await h.w.DT.actions.startSso("ISPN")).toBeNull();
    expect(h.state().loginError).toMatch(/couldn't reach/i);
    expect(h.state().ssoStarting).toBeFalsy();
  });

  it("turns ?sso=<result> into one sentence and takes it out of the address bar", async () => {
    const h = await boot({ modules: on });
    const run = (q: string) => {
      h.w.history.replaceState({}, "", "/" + q);
      return h.w.DT.actions.readSsoReturn();
    };
    expect(run("?sso=ok")).toBe("ok");
    expect(h.state().loginError).toBeFalsy();
    expect(h.w.location.search).toBe("");

    expect(run("?sso=no_role")).toBe("no_role");
    expect(h.state().loginError).toMatch(/not in a group/i);
    expect(h.w.location.search).toBe("");

    expect(run("?sso=id_token")).toBe("id_token");
    expect(h.state().loginError).toMatch(/couldn't verify/i);

    // An unknown code still produces a sentence, never a blank screen.
    expect(run("?sso=something_new")).toBe("something_new");
    expect(h.state().loginError).toBeTruthy();
    // Nothing at all without the parameter.
    h.w.history.replaceState({}, "", "/");
    expect(h.w.DT.actions.readSsoReturn()).toBeNull();
  });
});

describe("SSO (client) — a password where SSO is required", () => {
  it("says to use the hospital's sign-in, not that the password was wrong", async () => {
    const h = await boot({ modules: on });
    h.routes.sso = (r) => (r.path === "/api/login" ? { status: 403, body: { error: "sso_required" } } : undefined);
    await h.w.DT.actions.login("hospitalist", "ISPN", "chen", "right-password");
    expect(h.state().loginError).toMatch(/single sign-on/i);
    expect(h.state().loginError).not.toMatch(/Wrong organization code/i);
    expect(h.state().__toast.msg).toMatch(/Sign in with/);
  });
});

describe("SSO (client) — the director's card", () => {
  it("sends nothing while the module is off; reads the server's connection when on", async () => {
    const off = await boot({ modules: { "enterprise.sso": false } });
    off.w.DT.set((s: any) => { s.ssoConnection = CONN; return s; });
    expect(await off.w.DT.actions.loadSsoConnection()).toBeNull();
    expect(count(off, "GET", "/api/org/sso")).toBe(0);
    expect(off.state().ssoConnection).toBeNull();

    const h = await boot({ modules: on });
    h.routes.sso = (r) => (r.path === "/api/org/sso" && r.method === "GET" ? { status: 200, body: CONN } : undefined);
    await h.w.DT.actions.loadSsoConnection();
    expect(h.state().ssoConnection).toEqual(CONN);
  });

  it("saves in one PUT, keeps no secret, and reports the server's answer", async () => {
    const h = await boot({ modules: on });
    const answer = { ...CONN, ssoRequired: true };
    h.routes.sso = (r) => (r.path === "/api/org/sso" && r.method === "PUT" ? { status: 200, body: answer } : undefined);
    await h.w.DT.actions.saveSsoConnection({
      issuer: "https://hospital.okta.com",
      clientId: "docturn",
      clientSecret: "super-secret-value",
      ssoRequired: true,
      config: { claim: "groups", scopes: "openid profile email", defaultRole: "hospitalist", map: { Directors: "director" } },
    });
    const puts = h.reqs.filter((r) => r.method === "PUT" && r.path === "/api/org/sso");
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body.clientSecret).toBe("super-secret-value");
    expect(h.state().ssoConnection).toEqual(answer);
    expect(h.state().__toast.msg).toMatch(/passwords are refused/);
    // The secret the director typed is nowhere in the app's own state.
    expect(JSON.stringify(h.state())).not.toContain("super-secret-value");
    expect(JSON.stringify(Object.entries(h.w.localStorage))).not.toContain("super-secret-value");
  });

  it("shows the server's message when a save is refused, and keeps the stored values", async () => {
    const h = await boot({ modules: on });
    h.w.DT.set((s: any) => { s.ssoConnection = CONN; return s; });
    h.routes.sso = (r) =>
      r.path === "/api/org/sso" && r.method === "PUT"
        ? { status: 400, body: { error: "invalid_connection", field: "issuer", message: "The URL must start with https://" } }
        : undefined;
    expect(await h.w.DT.actions.saveSsoConnection({ issuer: "http://x", clientId: "y" })).toBeNull();
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Not saved" });
    expect(h.state().__toast.msg).toBe("The URL must start with https://");
    expect(h.state().ssoConnection).toEqual(CONN);
  });

  it("Test connection shows the SERVER's result, good or bad", async () => {
    const h = await boot({ modules: on });
    let reply: any = { status: 200, body: { ok: true, issuer: "https://hospital.okta.com", signingKeys: 2 } };
    h.routes.sso = (r) => (r.path === "/api/org/sso/test" ? reply : undefined);
    await h.w.DT.actions.testSsoConnection();
    expect(h.state().ssoTest).toMatchObject({ ok: true, signingKeys: 2 });
    expect(h.state().ssoTesting).toBe(false);

    reply = { status: 200, body: { ok: false, reason: "discovery", message: "DocTurn could not reach it." } };
    await h.w.DT.actions.testSsoConnection();
    expect(h.state().ssoTest).toMatchObject({ ok: false, reason: "discovery" });
    // No toast for a failed TEST: the card shows the server's sentence itself.
    expect(h.state().__toast).toBeFalsy();
  });

  it("removing the connection re-reads the server and says what changed", async () => {
    const h = await boot({ modules: on });
    h.routes.sso = (r) => (r.path === "/api/org/sso" && r.method === "DELETE" ? { status: 200, body: { configured: false, redirectUri: CONN.redirectUri, assignableRoles: CONN.assignableRoles, defaults: CONN.defaults } } : undefined);
    await h.w.DT.actions.removeSsoConnection();
    expect(count(h, "DELETE", "/api/org/sso")).toBe(1);
    expect(h.state().ssoConnection).toMatchObject({ configured: false });
    expect(h.state().__toast.msg).toMatch(/DocTurn passwords again/);
    await sleep(5);
  });
});
