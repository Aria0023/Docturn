import { beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app.js";
import { invalidateModules, setModule } from "../server/modules.js";
import { SCIM_PATCH_SCHEMA, SCIM_USER_SCHEMA, parseFilter } from "../server/scim/schemas.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * SCIM 2.0 Users (E2.2, module `enterprise.scim`).
 *
 * The identity provider's half: a per-org bearer token (hash stored, shown
 * once, revocable, last_used), list / get / create / replace / patch /
 * delete, and the discovery endpoints. Deactivation flows through the SAME
 * path as the People screen — disabled_at, off the rotation, every live
 * session ended — and reactivation through the same reactivate path.
 *
 * Both big providers' PATCH dialects are exercised on purpose: Okta sends
 * `{op:"replace", value:{active:false}}` with NO path, Entra sends
 * `{op:"Replace", path:"active", value:"False"}` (capitalised op, string
 * boolean).
 */

let ctx: TestContext;
let orgId: number;

beforeEach(async () => {
  ctx = await createTestApp();
  orgId = ctx.seedResult.orgId;
  invalidateModules();
  await setModule(orgId, "enterprise.scim", true);
  invalidateModules();
});

/** A token through the director's own API, as the card does. */
async function mintToken(label = "Okta production") {
  const { agent } = await login(ctx.app, { username: "director" });
  const res = await agent.post("/api/org/scim-tokens").send({ label }).expect(201);
  return { agent, token: res.body.token as string, id: res.body.id as number, body: res.body };
}

const scim = (token: string) => {
  const req = supertest(ctx.app);
  return {
    get: (p: string) => req.get(p).set("Authorization", "Bearer " + token),
    post: (p: string, body: unknown) => req.post(p).set("Authorization", "Bearer " + token).set("Content-Type", "application/scim+json").send(body as object),
    put: (p: string, body: unknown) => req.put(p).set("Authorization", "Bearer " + token).set("Content-Type", "application/scim+json").send(body as object),
    patch: (p: string, body: unknown) => req.patch(p).set("Authorization", "Bearer " + token).set("Content-Type", "application/scim+json").send(body as object),
    del: (p: string) => req.delete(p).set("Authorization", "Bearer " + token),
  };
};

const NEW_USER = {
  schemas: [SCIM_USER_SCHEMA],
  userName: "idp.hosp",
  name: { givenName: "Dana", familyName: "Idp" },
  roles: [{ value: "hospitalist", primary: true }],
  emails: [{ value: "dana@example.org", primary: true }],
  externalId: "00u1abcdEFGH",
  active: true,
};

describe("SCIM — the filter parser", () => {
  it('accepts only userName eq "x" (and an externalId filter that matches nothing)', () => {
    expect(parseFilter('userName eq "chen"')).toEqual({ kind: "userName", value: "chen" });
    expect(parseFilter('USERNAME EQ "chen"').kind).toBe("unsupported"); // `EQ` is not the SCIM operator
    expect(parseFilter('userName eq "a\\"b"')).toEqual({ kind: "userName", value: 'a"b' });
    expect(parseFilter('externalId eq "x"')).toEqual({ kind: "never" });
    expect(parseFilter('active eq true').kind).toBe("unsupported");
    expect(parseFilter("").kind).toBe("none");
  });
});

describe("SCIM — tokens", () => {
  it("is created once, hashed, listed without the secret, and revocable", async () => {
    const { agent, token, id, body } = await mintToken();
    expect(token.startsWith("dts_")).toBe(true);
    expect(body.baseUrl).toMatch(/\/scim\/v2$/);
    // Only a hash is stored.
    const rows = await ctx.storage.listScimTokens(orgId);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    const list = await agent.get("/api/org/scim-tokens").expect(200);
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(list.body.tokens[0]).toMatchObject({ id, label: "Okta production", active: true, lastUsedAt: null });

    // It works…
    await scim(token).get("/scim/v2/ServiceProviderConfig").expect(200);
    const used = await agent.get("/api/org/scim-tokens").expect(200);
    expect(used.body.tokens[0].lastUsedAt).toBeTruthy();

    // …until it is revoked.
    await agent.delete(`/api/org/scim-tokens/${id}`).expect(200);
    const after = await scim(token).get("/scim/v2/Users");
    expect(after.status).toBe(401);
    expect(after.body).toMatchObject({ status: "401" });
    const revoked = await agent.get("/api/org/scim-tokens").expect(200);
    expect(revoked.body.tokens[0]).toMatchObject({ active: false });
    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    expect(audit.some((r) => r.action === "scim.token_create" && r.riskLevel === "high")).toBe(true);
    expect(audit.some((r) => r.action === "scim.token_revoke")).toBe(true);
  });

  it("only a director (or the operator) manages tokens, and only inside their org", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    expect((await chen.get("/api/org/scim-tokens")).status).toBe(403);
    expect((await chen.post("/api/org/scim-tokens").send({ label: "mine" })).status).toBe(403);

    const { id } = await mintToken();
    const other = await ctx.storage.createOrganization({
      name: "Other", code: "OTH2", city: null, state: null, timezone: "America/New_York",
      assignmentTimeoutMin: 10, roundRobinShiftTypes: ["day"], rotationMode: "lowest_census", rotationIndex: 0,
    });
    const theirDirector = await ctx.storage.createUser({
      organizationId: other.id, username: "far.dir", passwordHash: "x", role: "director" as never,
      displayName: "Dr. Far", credential: null as never, phone: null, twoFactorEnabled: false,
    });
    expect(theirDirector.organizationId).toBe(other.id);
    // Their director cannot revoke our token (it is simply not theirs).
    const { agent: dir } = await login(ctx.app, { username: "director" });
    expect((await dir.delete(`/api/org/scim-tokens/${id + 999}`)).status).toBe(404);
  });

  it("refuses a bad label and caps live tokens", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    expect((await agent.post("/api/org/scim-tokens").send({})).status).toBe(400);
    expect((await agent.post("/api/org/scim-tokens").send({ label: "" })).status).toBe(400);
    expect((await agent.post("/api/org/scim-tokens").send({ label: "x", extra: 1 })).status).toBe(400);
    for (let i = 0; i < 5; i++) await agent.post("/api/org/scim-tokens").send({ label: "t" + i }).expect(201);
    expect((await agent.post("/api/org/scim-tokens").send({ label: "one too many" })).status).toBe(409);
  });

  it("the module switch owns both halves: 404 for the endpoints and for the card", async () => {
    const { agent, token } = await mintToken();
    await setModule(orgId, "enterprise.scim", false);
    invalidateModules();
    const off = await scim(token).get("/scim/v2/Users");
    expect(off.status).toBe(404);
    expect(off.headers["content-type"]).toMatch(/application\/scim\+json/);
    expect(off.body).toMatchObject({ status: "404" });
    expect((await agent.get("/api/org/scim-tokens")).status).toBe(404);
  });

  it("an unknown or missing token is one generic 401 with a WWW-Authenticate challenge", async () => {
    const none = await supertest(ctx.app).get("/scim/v2/Users");
    expect(none.status).toBe(401);
    expect(none.headers["www-authenticate"]).toMatch(/Bearer/);
    const bogus = await scim("dts_not-a-real-token").get("/scim/v2/Users");
    expect(bogus.status).toBe(401);
    expect(bogus.body.detail).toBe("The bearer token is not valid.");
  });
});

describe("SCIM — discovery", () => {
  it("serves ServiceProviderConfig, Schemas and ResourceTypes honestly", async () => {
    const { token } = await mintToken();
    const spc = (await scim(token).get("/scim/v2/ServiceProviderConfig").expect(200)).body;
    expect(spc.patch.supported).toBe(true);
    expect(spc.bulk.supported).toBe(false);
    expect(spc.changePassword.supported).toBe(false);
    expect(spc.filter.supported).toBe(true);
    expect(spc.authenticationSchemes[0].type).toBe("oauthbearertoken");

    const types = (await scim(token).get("/scim/v2/ResourceTypes").expect(200)).body;
    expect(types.Resources.map((r: any) => r.id)).toEqual(["User"]);
    expect((await scim(token).get("/scim/v2/ResourceTypes/user").expect(200)).body.endpoint).toBe("/Users");

    const schemas = (await scim(token).get("/scim/v2/Schemas").expect(200)).body;
    const names = schemas.Resources[0].attributes.map((a: any) => a.name);
    // Only what is really stored is advertised.
    expect(names).toEqual(["userName", "displayName", "name", "active", "roles"]);
    expect((await scim(token).get(`/scim/v2/Schemas/${SCIM_USER_SCHEMA}`).expect(200)).body.id).toBe(SCIM_USER_SCHEMA);
    expect((await scim(token).get("/scim/v2/Schemas/nope")).status).toBe(404);
  });

  it("an unknown SCIM path is a SCIM 404, never the web app's HTML shell", async () => {
    const { token } = await mintToken();
    const res = await scim(token).get("/scim/v2/Groups");
    expect(res.status).toBe(404);
    expect(String(res.headers["content-type"] ?? "")).not.toMatch(/text\/html/);
  });
});

describe("SCIM — Users", () => {
  it("creates a user as the app itself would (no password, a rotation profile, audited)", async () => {
    const { token } = await mintToken();
    const res = await scim(token).post("/scim/v2/Users", NEW_USER).expect(201);
    expect(res.headers["content-type"]).toMatch(/application\/scim\+json/);
    expect(res.headers["location"]).toMatch(/\/scim\/v2\/Users\/\d+$/);
    expect(res.body).toMatchObject({
      schemas: [SCIM_USER_SCHEMA],
      userName: "idp.hosp",
      displayName: "Dana Idp",
      active: true,
      roles: [{ value: "hospitalist", primary: true }],
    });
    const id = Number(res.body.id);
    const user = (await ctx.storage.getUserById(id))!;
    expect(user.organizationId).toBe(orgId);
    expect(user.mustChangePassword).toBe(false);
    expect(user.passwordHash).toBeTruthy();
    // The hospitalist is in the rotation, off shift.
    const profile = await ctx.storage.getHospitalistByUser(orgId, id);
    expect(profile).toBeTruthy();
    expect(profile!.working).toBe(false);
    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    const row = audit.find((r) => r.action === "scim.user_create");
    expect(row).toBeTruthy();
    expect(row!.details).toMatchObject({ username: "idp.hosp", role: "hospitalist", source: "scim" });
    // The token is named, the label is not.
    expect(JSON.stringify(row!.details)).not.toContain("Okta");
  });

  it("refuses a privileged role, a missing userName, and a duplicate", async () => {
    const { token } = await mintToken();
    const s = scim(token);
    const bad = await s.post("/scim/v2/Users", { ...NEW_USER, roles: [{ value: "director" }] });
    expect(bad.status).toBe(400);
    expect(bad.body.scimType).toBe("invalidValue");
    expect((await s.post("/scim/v2/Users", { ...NEW_USER, userName: undefined })).status).toBe(400);
    expect((await s.post("/scim/v2/Users", { ...NEW_USER, userName: "ab" })).status).toBe(400);
    expect((await s.post("/scim/v2/Users", { userName: "no.name" })).status).toBe(400);
    await s.post("/scim/v2/Users", NEW_USER).expect(201);
    const dup = await s.post("/scim/v2/Users", NEW_USER);
    expect(dup.status).toBe(409);
    expect(dup.body.scimType).toBe("uniqueness");
    // The seeded clinician's name is taken too, whatever its case.
    const taken = await s.post("/scim/v2/Users", { ...NEW_USER, userName: "CHEN" });
    expect(taken.status).toBe(409);
  });

  it("lists and filters, 1-based, and never shows another tenant or a privileged account", async () => {
    const { token } = await mintToken();
    const s = scim(token);
    const all = (await s.get("/scim/v2/Users").expect(200)).body;
    expect(all.schemas).toEqual(["urn:ietf:params:scim:api:messages:2.0:ListResponse"]);
    expect(all.startIndex).toBe(1);
    expect(all.totalResults).toBe(all.Resources.length);
    const usernames = all.Resources.map((r: any) => r.userName);
    expect(usernames).toContain("chen");
    expect(usernames).not.toContain("director");
    expect(usernames).not.toContain("dev");

    const one = (await s.get('/scim/v2/Users?filter=userName eq "chen"').expect(200)).body;
    expect(one.totalResults).toBe(1);
    expect(one.Resources[0].userName).toBe("chen");
    const missing = (await s.get('/scim/v2/Users?filter=userName eq "nobody.here"').expect(200)).body;
    expect(missing.totalResults).toBe(0);
    expect(missing.Resources).toEqual([]);
    // A filter we do not implement is refused, never silently ignored.
    const weird = await s.get("/scim/v2/Users?filter=active eq true");
    expect(weird.status).toBe(400);
    expect(weird.body.scimType).toBe("invalidFilter");

    const paged = (await s.get("/scim/v2/Users?startIndex=2&count=1").expect(200)).body;
    expect(paged.startIndex).toBe(2);
    expect(paged.Resources).toHaveLength(1);
    expect(paged.Resources[0].userName).not.toBe(usernames[0]);
    expect(paged.totalResults).toBe(all.totalResults);
  });

  it("reads one user, and answers 404 for another tenant's id and for a director", async () => {
    const { token } = await mintToken();
    const s = scim(token);
    const chenId = ctx.seedResult.userIds.chen!;
    expect((await s.get(`/scim/v2/Users/${chenId}`).expect(200)).body.userName).toBe("chen");
    expect((await s.get(`/scim/v2/Users/${ctx.seedResult.userIds.director!}`)).status).toBe(404);
    expect((await s.get("/scim/v2/Users/999999")).status).toBe(404);
    expect((await s.get("/scim/v2/Users/not-a-number")).status).toBe(404);
  });

  it("PATCH active=false deactivates through the real path, and active=true restores it (Okta's shape)", async () => {
    const { token } = await mintToken();
    const s = scim(token);
    const chenId = ctx.seedResult.userIds.chen!;
    // On shift first, so the rotation side-effect is observable.
    const profile = (await ctx.storage.getHospitalistByUser(orgId, chenId))!;
    await ctx.storage.updateHospitalist(orgId, profile.id, { working: true });

    // Okta: no path, a partial resource in `value`.
    const off = await s.patch(`/scim/v2/Users/${chenId}`, {
      schemas: [SCIM_PATCH_SCHEMA],
      Operations: [{ op: "replace", value: { active: false } }],
    }).expect(200);
    expect(off.body.active).toBe(false);
    const disabled = (await ctx.storage.getUserById(chenId))!;
    expect(disabled.disabledAt).toBeTruthy();
    expect((await ctx.storage.getHospitalistByUser(orgId, chenId))!.working).toBe(false);
    // A correct password no longer signs in.
    const denied = await login(ctx.app, { username: "chen" });
    expect(denied.res.status).toBe(401);

    const on = await s.patch(`/scim/v2/Users/${chenId}`, {
      schemas: [SCIM_PATCH_SCHEMA],
      Operations: [{ op: "replace", value: { active: true } }],
    }).expect(200);
    expect(on.body.active).toBe(true);
    expect((await ctx.storage.getUserById(chenId))!.disabledAt).toBeNull();
    expect((await login(ctx.app, { username: "chen" })).res.status).toBe(200);

    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    expect(audit.some((r) => r.action === "scim.user_deactivate" && r.riskLevel === "high")).toBe(true);
    expect(audit.some((r) => r.action === "scim.user_reactivate")).toBe(true);
  });

  it("PATCH understands Entra's dialect too: capitalised op, path, string boolean", async () => {
    const { token } = await mintToken();
    const s = scim(token);
    const chenId = ctx.seedResult.userIds.chen!;
    const res = await s.patch(`/scim/v2/Users/${chenId}`, {
      schemas: [SCIM_PATCH_SCHEMA],
      Operations: [{ op: "Replace", path: "active", value: "False" }],
    }).expect(200);
    expect(res.body.active).toBe(false);
    expect((await ctx.storage.getUserById(chenId))!.disabledAt).toBeTruthy();
  });

  it("PATCH changes a name and a role; it refuses a privileged role and a bad op", async () => {
    const { token } = await mintToken();
    const s = scim(token);
    const chenId = ctx.seedResult.userIds.chen!;
    const named = await s.patch(`/scim/v2/Users/${chenId}`, {
      Operations: [{ op: "replace", path: "displayName", value: "Dr. Nathan Renamed" }],
    }).expect(200);
    expect(named.body.displayName).toBe("Dr. Nathan Renamed");
    expect((await ctx.storage.getUserById(chenId))!.displayName).toBe("Dr. Nathan Renamed");

    const family = await s.patch(`/scim/v2/Users/${chenId}`, {
      Operations: [{ op: "replace", path: "name.familyName", value: "Surname" }],
    }).expect(200);
    expect(family.body.name.familyName).toBe("Surname");

    const role = await s.patch(`/scim/v2/Users/${chenId}`, {
      Operations: [{ op: "replace", path: "roles", value: [{ value: "er_doctor" }] }],
    }).expect(200);
    expect(role.body.roles[0].value).toBe("er_doctor");

    const priv = await s.patch(`/scim/v2/Users/${chenId}`, { Operations: [{ op: "replace", path: "roles", value: [{ value: "developer" }] }] });
    expect(priv.status).toBe(400);
    const badOp = await s.patch(`/scim/v2/Users/${chenId}`, { Operations: [{ op: "move", path: "active", value: false }] });
    expect(badOp.status).toBe(400);
    expect((await s.patch(`/scim/v2/Users/${chenId}`, { Operations: [] })).status).toBe(400);
    // An attribute DocTurn does not store is accepted and dropped.
    const ignored = await s.patch(`/scim/v2/Users/${chenId}`, { Operations: [{ op: "replace", path: "emails[type eq \"work\"].value", value: "x@y.z" }] }).expect(200);
    expect(ignored.body.userName).toBe("chen");
  });

  it("PUT replaces the stored attributes and refuses a name that belongs to someone else", async () => {
    const { token } = await mintToken();
    const s = scim(token);
    const created = (await s.post("/scim/v2/Users", NEW_USER).expect(201)).body;
    const res = await s.put(`/scim/v2/Users/${created.id}`, {
      schemas: [SCIM_USER_SCHEMA],
      userName: "idp.renamed",
      name: { givenName: "Dana", familyName: "Renamed" },
      roles: [{ value: "er_doctor" }],
      active: true,
    }).expect(200);
    expect(res.body).toMatchObject({ userName: "idp.renamed", displayName: "Dana Renamed", roles: [{ value: "er_doctor", primary: true }] });
    const clash = await s.put(`/scim/v2/Users/${created.id}`, { userName: "chen", displayName: "x" });
    expect(clash.status).toBe(409);
  });

  it("DELETE deactivates (and is idempotent); the account is never removed", async () => {
    const { token } = await mintToken();
    const s = scim(token);
    const created = (await s.post("/scim/v2/Users", NEW_USER).expect(201)).body;
    await s.del(`/scim/v2/Users/${created.id}`).expect(204);
    const row = (await ctx.storage.getUserById(Number(created.id)))!;
    expect(row).toBeTruthy();
    expect(row.disabledAt).toBeTruthy();
    await s.del(`/scim/v2/Users/${created.id}`).expect(204);
    // Still readable — and reported inactive, which is what an IdP reconciles against.
    expect((await s.get(`/scim/v2/Users/${created.id}`).expect(200)).body.active).toBe(false);
  });

  it("a SCIM deactivation ends that person's live sessions at once", async () => {
    const { token } = await mintToken();
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent } = await login(ctx.app, { username: "chen" });
    await agent.get("/api/user").expect(200);
    await scim(token).del(`/scim/v2/Users/${chenId}`).expect(204);
    // The cookie no longer resolves: deactivation is immediate, not at next login.
    expect((await agent.get("/api/user")).status).toBe(401);
  });

  it("is rate-limited on a deployment with limiters on", async () => {
    const { token } = await mintToken();
    const limited = createApp({ sessionSecret: "test-secret", rateLimiting: true, rateLimitStore: "memory" });
    let last = 0;
    for (let i = 0; i < 130 && last !== 429; i++) {
      last = (await supertest(limited).get("/scim/v2/ServiceProviderConfig").set("Authorization", "Bearer " + token)).status;
    }
    expect(last).toBe(429);
  });
});
