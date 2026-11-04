import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { invalidateModules, setModule } from "../server/modules.js";
import { _resetOidcCaches, roleFromClaims, usernameFromClaims } from "../server/sso/oidc.js";
import { _setSsoTransport } from "../server/routes/sso.js";
import { startOidcIssuer, type OidcFixture } from "./fixtures/oidc-issuer.js";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";

/**
 * OIDC single sign-on (E2.1, module `enterprise.sso`), driven against a LOCAL
 * identity provider fixture whose RSA key is generated at runtime
 * (tests/fixtures/oidc-issuer.ts — no key material is ever committed).
 *
 * The transport is injected for these tests so the fixture can be plain http
 * on 127.0.0.1; production always uses `guardedFetch` (https only, public
 * addresses only, re-checked on every redirect hop), and the SSRF control is
 * tested where it is enforced: the issuer a director SAVES.
 */

let ctx: TestContext;
let idp: OidcFixture;
let orgId: number;

const SECRET = "s3cret-client-secret-value";

beforeEach(async () => {
  ctx = await createTestApp();
  orgId = ctx.seedResult.orgId;
  invalidateModules();
  _resetOidcCaches();
  idp = await startOidcIssuer();
  _setSsoTransport((url, init) => fetch(url, init));
  await setModule(orgId, "enterprise.sso", true);
  invalidateModules();
  // INTEGRATION_KEY must exist for the client secret to be sealed.
  process.env.INTEGRATION_KEY = "a".repeat(64);
});

afterEach(async () => {
  _setSsoTransport(null);
  await idp.close();
  await ctx.handle.close();
});

/** Save a connection exactly as the director's card does, bypassing the
 *  https-only check by writing the row through storage with the sealed
 *  secret the route would have written. */
async function configure(extra: Record<string, unknown> = {}) {
  const { sealCredentials } = await import("../server/integrations/crypto.js");
  const sealed = sealCredentials(orgId, "sso-oidc", { clientSecret: SECRET });
  return ctx.storage.upsertSsoConnection({
    organizationId: orgId,
    issuer: idp.url,
    clientId: "docturn-client",
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    authTag: sealed.authTag,
    keyVersion: sealed.keyVersion,
    roleMapping: {
      claim: "groups",
      defaultRole: "hospitalist",
      map: { "DocTurn-Directors": "director" },
      scopes: "openid profile email",
      acrMfaValue: null,
      ...(extra.roleMapping as object | undefined),
    },
    ssoRequired: (extra.ssoRequired as boolean) ?? false,
    enabled: (extra.enabled as boolean) ?? true,
    updatedBy: ctx.seedResult.userIds.director!,
  });
}

/** Run a whole sign-in: start → (the IdP would redirect) → callback. */
type Agent = ReturnType<typeof supertest.agent>;

async function signInThroughIdp(
  agent: Agent,
  claims: Record<string, unknown>,
  tokenOpts: Record<string, unknown> = {},
) {
  const start = await agent.post("/api/auth/sso/start").send({ orgCode: "ISPN" });
  if (start.status !== 200) return { start, callback: null as supertest.Response | null };
  const url = new URL(start.body.url);
  const state = url.searchParams.get("state")!;
  const nonce = url.searchParams.get("nonce")!;
  // The nonce comes FIRST so a test can override it on purpose.
  idp.nextToken({ claims: { nonce, ...claims }, ...(tokenOpts as object) });
  const callback = await agent.get(`/api/auth/sso/callback?code=authcode&state=${encodeURIComponent(state)}`);
  return { start, callback };
}

const ssoCode = (res: supertest.Response) => new URL(String(res.headers["location"] ?? "/"), "http://x").searchParams.get("sso");

describe("SSO — claim mapping (pure)", () => {
  it("builds a username from preferred_username, email or sub", () => {
    expect(usernameFromClaims({ preferred_username: "Dana.Idp" })).toBe("dana.idp");
    expect(usernameFromClaims({ email: "Dana.Idp@hospital.org" })).toBe("dana.idp");
    expect(usernameFromClaims({ sub: "00u-abc-123" })).toBe("00u-abc-123");
    expect(usernameFromClaims({ preferred_username: "a" })).toBeNull();
    expect(usernameFromClaims({})).toBeNull();
  });

  it("maps the first matching group, honours the default, and refuses an unmapped role", () => {
    const mapping = { claim: "groups", default: "hospitalist", map: { Directors: "director", Docs: "er_doctor" } };
    const allowed = ["hospitalist", "er_doctor", "director"];
    expect(roleFromClaims({ groups: ["docs", "directors"] }, mapping, allowed)).toBe("director");
    expect(roleFromClaims({ groups: ["Docs"] }, mapping, allowed)).toBe("er_doctor");
    expect(roleFromClaims({ groups: ["nobody"] }, mapping, allowed)).toBe("hospitalist");
    expect(roleFromClaims({}, { ...mapping, default: null }, allowed)).toBeNull();
    // A role the mapping names but SSO may not grant is ignored.
    expect(roleFromClaims({ groups: ["x"] }, { claim: "groups", default: null, map: { x: "developer" } }, allowed)).toBeNull();
  });
});

describe("SSO — the sign-in screen's lookup is not an org-code oracle", () => {
  it("answers the same shape for unknown, unconfigured, disabled and module-off", async () => {
    const agent = supertest.agent(ctx.app);
    const shapes: string[] = [];
    shapes.push(JSON.stringify((await agent.post("/api/auth/sso/available").send({ orgCode: "NOPE" }).expect(200)).body));
    shapes.push(JSON.stringify((await agent.post("/api/auth/sso/available").send({ orgCode: "ISPN" }).expect(200)).body));
    await configure({ enabled: false });
    shapes.push(JSON.stringify((await agent.post("/api/auth/sso/available").send({ orgCode: "ISPN" }).expect(200)).body));
    await configure({ enabled: true });
    await setModule(orgId, "enterprise.sso", false);
    invalidateModules();
    shapes.push(JSON.stringify((await agent.post("/api/auth/sso/available").send({ orgCode: "ISPN" }).expect(200)).body));
    // Every refusal is byte-identical.
    expect(new Set(shapes).size).toBe(1);
    expect(JSON.parse(shapes[0]!)).toEqual({ sso: false });
    // A malformed body is the same answer, not a 400 that would reveal a path.
    expect((await agent.post("/api/auth/sso/available").send({}).expect(200)).body).toEqual({ sso: false });

    await setModule(orgId, "enterprise.sso", true);
    invalidateModules();
    const on = await agent.post("/api/auth/sso/available").send({ orgCode: "ispn" }).expect(200);
    const org = (await ctx.storage.getOrganization(orgId))!;
    expect(on.body).toEqual({ sso: true, label: org.name });
    expect(on.headers["cache-control"]).toBe("no-store");
  });

  it("start is refused the same way for an unknown org and an unconfigured one", async () => {
    const agent = supertest.agent(ctx.app);
    const a = await agent.post("/api/auth/sso/start").send({ orgCode: "NOPE" });
    const b = await agent.post("/api/auth/sso/start").send({ orgCode: "ISPN" });
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(a.body).toEqual(b.body);
  });
});

describe("SSO — the authorization-code flow", () => {
  it("asks for code + PKCE S256 + state + nonce, exchanges with the verifier, and signs the person in", async () => {
    await configure();
    const agent = supertest.agent(ctx.app);
    const start = await agent.post("/api/auth/sso/start").send({ orgCode: "ISPN" }).expect(200);
    const url = new URL(start.body.url);
    expect(url.origin + url.pathname).toBe(idp.url + "/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("docturn-client");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")!.length).toBeGreaterThan(20);
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/sso\/callback$/);
    const state = url.searchParams.get("state")!;
    const nonce = url.searchParams.get("nonce")!;
    expect(state).not.toBe(nonce);

    idp.nextToken({ claims: { nonce, preferred_username: "dana.idp", name: "Dr. Dana Idp", groups: ["clinicians"] } });
    const cb = await agent.get(`/api/auth/sso/callback?code=the-code&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(302);
    expect(ssoCode(cb)).toBe("ok");

    // The token exchange carried the code, the verifier and the secret.
    expect(idp.exchanges).toHaveLength(1);
    expect(idp.exchanges[0]).toMatchObject({
      grant_type: "authorization_code",
      code: "the-code",
      client_id: "docturn-client",
      client_secret: SECRET,
    });
    expect(idp.exchanges[0]!.code_verifier!.length).toBeGreaterThan(20);

    // The session is real: the app's own identity route answers.
    const me = await agent.get("/api/user").expect(200);
    expect(me.body).toMatchObject({ username: "dana.idp", displayName: "Dr. Dana Idp", role: "hospitalist" });

    // JIT: a new account with no password, and a rotation profile.
    const user = (await ctx.storage.getUserByUsername(orgId, "dana.idp"))!;
    expect(user.mustChangePassword).toBe(false);
    expect(await ctx.storage.getHospitalistByUser(orgId, user.id)).toBeTruthy();
    expect((await login(ctx.app, { username: "dana.idp" })).res.status).toBe(401);

    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    expect(audit.some((r) => r.action === "sso.user_create")).toBe(true);
    const row = audit.find((r) => r.action === "sso.login");
    expect(row).toBeTruthy();
    expect(row!.details).toMatchObject({ username: "dana.idp", created: true, idpMfa: false });
    // No token, no secret, no claim values in the trail.
    expect(JSON.stringify(audit)).not.toContain(SECRET);
    expect(JSON.stringify(audit)).not.toContain("the-code");
  });

  it("regenerates the session (the pre-sign-in id is gone) and clears the flow", async () => {
    await configure();
    const agent = supertest.agent(ctx.app);
    const start = await agent.post("/api/auth/sso/start").send({ orgCode: "ISPN" }).expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const nonce = new URL(start.body.url).searchParams.get("nonce")!;
    idp.nextToken({ claims: { nonce, preferred_username: "dana.idp", groups: [] } });
    const first = await agent.get(`/api/auth/sso/callback?code=c1&state=${encodeURIComponent(state)}`);
    expect(ssoCode(first)).toBe("ok");
    // The same state cannot be replayed: the flow was consumed.
    const replay = await agent.get(`/api/auth/sso/callback?code=c1&state=${encodeURIComponent(state)}`);
    expect(ssoCode(replay)).toBe("state");
  });

  it("maps a group to a role, and updates the role on a later sign-in", async () => {
    await configure();
    const agent = supertest.agent(ctx.app);
    let out = await signInThroughIdp(agent, { preferred_username: "dana.idp", groups: ["DocTurn-Directors"] });
    expect(ssoCode(out.callback!)).toBe("ok");
    expect((await ctx.storage.getUserByUsername(orgId, "dana.idp"))!.role).toBe("director");

    // The IdP moves them out of the directors group: the next sign-in demotes.
    const again = supertest.agent(ctx.app);
    out = await signInThroughIdp(again, { preferred_username: "dana.idp", groups: ["clinicians"] });
    expect(ssoCode(out.callback!)).toBe("ok");
    expect((await ctx.storage.getUserByUsername(orgId, "dana.idp"))!.role).toBe("hospitalist");
    const audit = await ctx.storage.listAuditLogs(orgId, 60);
    expect(audit.some((r) => r.action === "sso.login" && (r.details as any)?.roleChangedFrom === "director")).toBe(true);
  });

  it("refuses a sign-in no mapping covers when there is no default role", async () => {
    await configure({ roleMapping: { defaultRole: null } });
    const agent = supertest.agent(ctx.app);
    const out = await signInThroughIdp(agent, { preferred_username: "stranger.x", groups: ["unknown"] });
    expect(ssoCode(out.callback!)).toBe("no_role");
    expect(await ctx.storage.getUserByUsername(orgId, "stranger.x")).toBeFalsy();
    expect((await agent.get("/api/user")).status).toBe(401);
    expect((await ctx.storage.listAuditLogs(orgId, 30)).some((r) => r.action === "sso.login_denied_no_role")).toBe(true);
  });

  it("never signs in a deactivated account", async () => {
    await configure();
    const agent = supertest.agent(ctx.app);
    expect(ssoCode((await signInThroughIdp(agent, { preferred_username: "dana.idp", groups: [] })).callback!)).toBe("ok");
    const user = (await ctx.storage.getUserByUsername(orgId, "dana.idp"))!;
    await ctx.storage.updateUser(user.id, { disabledAt: new Date() });
    const again = supertest.agent(ctx.app);
    const out = await signInThroughIdp(again, { preferred_username: "dana.idp", groups: [] });
    expect(ssoCode(out.callback!)).toBe("disabled");
    expect((await again.get("/api/user")).status).toBe(401);
    expect((await ctx.storage.listAuditLogs(orgId, 30)).some((r) => r.action === "sso.login_denied_disabled" && r.riskLevel === "high")).toBe(true);
  });
});

describe("SSO — id_token verification", () => {
  const cases: Array<[string, Record<string, unknown>, Record<string, unknown>, string]> = [
    ["a wrong nonce", { preferred_username: "a.b", nonce: "not-the-nonce" }, {}, "id_token"],
    ["a bad signature", { preferred_username: "a.b" }, { badSignature: true }, "id_token"],
    ["a key that is not in the JWKS", { preferred_username: "a.b" }, { wrongKey: true }, "id_token"],
    ["an unknown kid", { preferred_username: "a.b" }, { kid: "stranger" }, "id_token"],
    ["alg none", { preferred_username: "a.b" }, { alg: "none" }, "id_token"],
    ["HS256", { preferred_username: "a.b" }, { alg: "HS256" }, "id_token"],
    ["the wrong audience", { preferred_username: "a.b", aud: "someone-else" }, {}, "id_token"],
    ["an expired token", { preferred_username: "a.b", exp: Math.floor(Date.now() / 1000) - 3600 }, {}, "id_token"],
    ["the wrong issuer", { preferred_username: "a.b", iss: "https://evil.example" }, {}, "id_token"],
  ];
  for (const [name, claims, opts, expected] of cases) {
    it(`refuses ${name}`, async () => {
      await configure();
      const agent = supertest.agent(ctx.app);
      // The nonce case overrides the real nonce on purpose.
      const out = await signInThroughIdp(agent, claims, opts);
      expect(ssoCode(out.callback!)).toBe(expected);
      expect((await agent.get("/api/user")).status).toBe(401);
      expect(await ctx.storage.getUserByUsername(orgId, "a.b")).toBeFalsy();
    });
  }

  it("follows a key rotation without a restart", async () => {
    await configure();
    const first = supertest.agent(ctx.app);
    expect(ssoCode((await signInThroughIdp(first, { preferred_username: "dana.idp", groups: [] })).callback!)).toBe("ok");
    // The IdP rotates its key; the cached JWKS no longer has that kid.
    idp.rotateKey();
    const second = supertest.agent(ctx.app);
    expect(ssoCode((await signInThroughIdp(second, { preferred_username: "dana.idp", groups: [] })).callback!)).toBe("ok");
  });

  it("refuses a discovery document that names another issuer, and a token-endpoint error", async () => {
    await configure();
    idp.lieAboutIssuer("https://someone-else.example");
    _resetOidcCaches();
    const agent = supertest.agent(ctx.app);
    const start = await agent.post("/api/auth/sso/start").send({ orgCode: "ISPN" });
    expect(start.status).toBe(502);
    expect(start.body).toMatchObject({ error: "sso_unavailable", reason: "issuer_mismatch" });

    idp.lieAboutIssuer(null);
    _resetOidcCaches();
    const ok = await agent.post("/api/auth/sso/start").send({ orgCode: "ISPN" }).expect(200);
    const state = new URL(ok.body.url).searchParams.get("state")!;
    idp.nextTokenError("invalid_grant");
    const cb = await agent.get(`/api/auth/sso/callback?code=stale&state=${encodeURIComponent(state)}`);
    expect(ssoCode(cb)).toBe("token");
    expect((await ctx.storage.listAuditLogs(orgId, 30)).some((r) => r.action === "sso.login_failed")).toBe(true);
  });

  it("refuses a callback with no flow, a wrong state, or the IdP's own error", async () => {
    await configure();
    const bare = supertest.agent(ctx.app);
    expect(ssoCode(await bare.get("/api/auth/sso/callback?code=c&state=s"))).toBe("state");
    const agent = supertest.agent(ctx.app);
    await agent.post("/api/auth/sso/start").send({ orgCode: "ISPN" }).expect(200);
    expect(ssoCode(await agent.get("/api/auth/sso/callback?code=c&state=wrong"))).toBe("state");
    expect(ssoCode(await agent.get("/api/auth/sso/callback?error=access_denied&state=x"))).toBe("idp_refused");
  });
});

describe("SSO — required, MFA and the module switch", () => {
  it("'SSO required' refuses a password for the org's staff but not for a developer", async () => {
    await configure({ ssoRequired: true });
    const staff = await login(ctx.app, { username: "chen" });
    expect(staff.res.status).toBe(403);
    expect(staff.res.body).toEqual({ error: "sso_required" });
    const director = await login(ctx.app, { username: "director" });
    expect(director.res.status).toBe(403);
    // The operator's break-glass still works, and is audited at high risk.
    const dev = await login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
    expect(dev.res.status).toBe(200);
    const audit = await ctx.storage.listAuditLogs(orgId, 40);
    expect(audit.filter((r) => r.action === "auth.login_denied_sso_required")).toHaveLength(2);

    // Switching the module off hands the org back its passwords.
    await setModule(orgId, "enterprise.sso", false);
    invalidateModules();
    expect((await login(ctx.app, { username: "chen" })).res.status).toBe(200);
  });

  it("an id_token that asserts MFA satisfies the org's MFA requirement for that session", async () => {
    await setModule(orgId, "security.mfaRequired", true);
    await configure({ roleMapping: { map: { "DocTurn-Directors": "director" }, defaultRole: null } });
    invalidateModules();

    // Without amr: the privileged user is in the enrolment-only session the
    // password path gives them.
    const plain = supertest.agent(ctx.app);
    expect(ssoCode((await signInThroughIdp(plain, { preferred_username: "dir.idp", groups: ["DocTurn-Directors"] })).callback!)).toBe("ok");
    const flagged = await plain.get("/api/user").expect(200);
    expect(flagged.body.mfaEnrollmentRequired).toBe(true);
    expect((await plain.get("/api/accounts")).status).toBe(403);

    // With amr: the IdP did the second factor, so the gate stands down.
    const mfa = supertest.agent(ctx.app);
    expect(ssoCode((await signInThroughIdp(mfa, { preferred_username: "dir.idp", groups: ["DocTurn-Directors"], amr: ["pwd", "mfa"] })).callback!)).toBe("ok");
    const okBody = await mfa.get("/api/user").expect(200);
    expect(okBody.body.mfaEnrollmentRequired).toBeUndefined();
    expect((await mfa.get("/api/accounts")).status).toBe(200);
    const audit = await ctx.storage.listAuditLogs(orgId, 60);
    expect(audit.some((r) => r.action === "sso.login" && (r.details as any)?.idpMfa === true)).toBe(true);
  });

  it("with the module off the public routes refuse and the director's card is 404", async () => {
    await configure();
    await setModule(orgId, "enterprise.sso", false);
    invalidateModules();
    const agent = supertest.agent(ctx.app);
    expect((await agent.post("/api/auth/sso/available").send({ orgCode: "ISPN" }).expect(200)).body).toEqual({ sso: false });
    expect((await agent.post("/api/auth/sso/start").send({ orgCode: "ISPN" })).status).toBe(404);
    const { agent: dir } = await login(ctx.app, { username: "director" });
    expect((await dir.get("/api/org/sso")).status).toBe(404);
    expect((await dir.put("/api/org/sso").send({ issuer: "https://idp.example.com", clientId: "x", clientSecret: "secret12" })).status).toBe(404);
  });
});

describe("SSO — the director's card", () => {
  it("saves a connection, never returns the secret, and refuses a private or http issuer", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const empty = await agent.get("/api/org/sso").expect(200);
    expect(empty.body).toMatchObject({ configured: false });
    expect(empty.body.redirectUri).toMatch(/\/api\/auth\/sso\/callback$/);
    expect(empty.body.assignableRoles).not.toContain("developer");

    for (const issuer of ["http://idp.example.com", "https://127.0.0.1:8443", "https://localhost", "https://idp.example.com/?x=1", "not-a-url"]) {
      const bad = await agent.put("/api/org/sso").send({ issuer, clientId: "docturn", clientSecret: "secret12" });
      expect(bad.status, issuer).toBe(400);
      expect(bad.body.error, issuer).toBe("invalid_connection");
    }
    const refusedRole = await agent.put("/api/org/sso").send({
      issuer: "https://idp.example.com", clientId: "docturn", clientSecret: "secret12",
      config: { map: { Admins: "developer" } },
    });
    expect(refusedRole.status).toBe(400);
    expect(refusedRole.body.field).toBe("map");

    const saved = await agent.put("/api/org/sso").send({
      issuer: "https://idp.example.com/", clientId: "docturn", clientSecret: "secret12345",
      ssoRequired: true,
      config: { claim: "roles", defaultRole: "hospitalist", map: { "DocTurn-Directors": "director" }, scopes: "openid profile email groups" },
    }).expect(200);
    expect(saved.body).toMatchObject({ configured: true, issuer: "https://idp.example.com", clientId: "docturn", ssoRequired: true, clientSecretStored: true, secretReadable: true });
    expect(JSON.stringify(saved.body)).not.toContain("secret12345");
    expect(saved.body.config).toMatchObject({ claim: "roles", defaultRole: "hospitalist" });

    // Editing the mapping alone keeps the stored secret.
    const edited = await agent.put("/api/org/sso").send({ issuer: "https://idp.example.com", clientId: "docturn", config: { defaultRole: null } }).expect(200);
    expect(edited.body.secretReadable).toBe(true);
    expect(edited.body.config.defaultRole).toBeNull();
    const row = (await ctx.storage.getSsoConnection(orgId))!;
    expect(row.ciphertext).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain("secret12345");

    const audit = await ctx.storage.listAuditLogs(orgId, 30);
    const savedRow = audit.find((r) => r.action === "sso.connection_saved");
    expect(savedRow!.riskLevel).toBe("high");
    expect(JSON.stringify(savedRow!.details)).not.toContain("secret12345");

    await agent.delete("/api/org/sso").expect(200);
    expect(await ctx.storage.getSsoConnection(orgId)).toBeFalsy();
    expect(audit.length).toBeGreaterThan(0);
  });

  it("Test connection really fetches the issuer and reports what came back", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    expect((await agent.post("/api/org/sso/test")).status).toBe(404);
    await configure();
    const ok = await agent.post("/api/org/sso/test").expect(200);
    expect(ok.body).toMatchObject({ ok: true, issuer: idp.url, signingKeys: 1 });
    expect(ok.body.tokenEndpoint).toBe(idp.url + "/token");
    // No secret is sent to test: the token endpoint is never called.
    expect(idp.exchanges).toHaveLength(0);

    await idp.close();
    _resetOidcCaches();
    const dead = await agent.post("/api/org/sso/test").expect(200);
    expect(dead.body.ok).toBe(false);
    expect(dead.body.reason).toBe("discovery");
    expect((await ctx.storage.listAuditLogs(orgId, 30)).filter((r) => r.action === "sso.connection_tested")).toHaveLength(2);
  });

  it("the lab hatch allows an http issuer on this machine — and never in production", async () => {
    const { insecureIssuersAllowed, isLoopbackHttpIssuer, issuerProblemFor } = await import("../server/sso/connection.js");
    const off = { SSO_ALLOW_INSECURE_ISSUER: undefined } as unknown as NodeJS.ProcessEnv;
    expect(insecureIssuersAllowed(off)).toBe(false);
    expect(insecureIssuersAllowed({ SSO_ALLOW_INSECURE_ISSUER: "1" } as never)).toBe(true);
    // Refused outright in production, whatever the flag says.
    expect(insecureIssuersAllowed({ SSO_ALLOW_INSECURE_ISSUER: "1", NODE_ENV: "production" } as never)).toBe(false);
    expect(isLoopbackHttpIssuer("http://127.0.0.1:9000")).toBe(true);
    expect(isLoopbackHttpIssuer("http://idp.example.com")).toBe(false);
    expect(isLoopbackHttpIssuer("https://127.0.0.1")).toBe(false);
    const lab = { SSO_ALLOW_INSECURE_ISSUER: "1" } as unknown as NodeJS.ProcessEnv;
    // Only that one shape is relaxed: everything else faces the full control.
    expect(issuerProblemFor("http://127.0.0.1:9000", lab)).toBeNull();
    expect(issuerProblemFor("http://idp.example.com", lab)).toMatch(/https/);
    expect(issuerProblemFor("https://10.0.0.5", lab)).toMatch(/private or local/);
    expect(issuerProblemFor("http://127.0.0.1:9000", off)).toMatch(/https/);

    // The card refuses it with the flag off and accepts it with the flag on.
    const { agent } = await login(ctx.app, { username: "director" });
    const body = { issuer: idp.url, clientId: "docturn-client", clientSecret: "secret12345", config: { defaultRole: "hospitalist" } };
    delete process.env.SSO_ALLOW_INSECURE_ISSUER;
    expect((await agent.put("/api/org/sso").send(body)).status).toBe(400);
    process.env.SSO_ALLOW_INSECURE_ISSUER = "1";
    try {
      const saved = await agent.put("/api/org/sso").send(body).expect(200);
      expect(saved.body.insecureIssuersAllowed).toBeUndefined(); // PUT does not report it
      const read = await agent.get("/api/org/sso").expect(200);
      expect(read.body.insecureIssuersAllowed).toBe(true);
      // And the whole flow then works against the local fixture.
      const user = supertest.agent(ctx.app);
      const out = await signInThroughIdp(user, { preferred_username: "lab.user", groups: [] });
      expect(ssoCode(out.callback!)).toBe("ok");
    } finally {
      delete process.env.SSO_ALLOW_INSECURE_ISSUER;
    }
  });

  it("is a director's (or the operator's) card only", async () => {
    await configure();
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    expect((await chen.get("/api/org/sso")).status).toBe(403);
    expect((await chen.put("/api/org/sso").send({ issuer: "https://x.example.com", clientId: "y" })).status).toBe(403);
    expect((await chen.post("/api/org/sso/test")).status).toBe(403);
    const { agent: erd } = await login(ctx.app, { username: "er.director" });
    expect((await erd.get("/api/org/sso")).status).toBe(403);
  });
});
