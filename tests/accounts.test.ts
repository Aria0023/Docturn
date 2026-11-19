import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * Workforce account lifecycle — the server half of launch blockers LB-2/5/6:
 *   • provisioning never uses a client-chosen (or the demo) password: the server
 *     mints a one-time credential, returns it once, and forces a change;
 *   • the forced-change gate blocks everything until the password is replaced;
 *   • deactivation refuses sign-in AND kills live sessions immediately;
 *   • reactivation and administrative reset work; reach is role/tenant scoped.
 */

const DEMO = "docturn";

describe("account lifecycle", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  async function directorCreates(agent: import("supertest").Agent, username: string, role = "hospitalist") {
    const res = await agent.post("/api/director/hospitalists").send({
      username,
      password: DEMO, // client-supplied value must be IGNORED
      displayName: "Dr. " + username,
      role,
      specialty: "Hospital Medicine",
      patientCap: 10,
      shiftType: "day",
    });
    expect(res.status).toBe(201);
    return res.body as { user: { id: number; username: string }; temporaryPassword: string };
  }

  it("director-provisioned accounts get a one-time password, never the demo one, and must change it first", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const made = await directorCreates(director, "newdoc");
    expect(typeof made.temporaryPassword).toBe("string");
    expect(made.temporaryPassword.length).toBeGreaterThanOrEqual(16);
    expect(made.temporaryPassword).not.toBe(DEMO);

    // The demo password (which the client sent) does NOT work.
    const bad = await login(ctx.app, { username: "newdoc", password: DEMO });
    expect(bad.res.status).toBe(401);

    // The one-time password works, but the account is held behind the gate.
    const { agent: doc, res } = await login(ctx.app, { username: "newdoc", password: made.temporaryPassword });
    expect(res.status).toBe(200);
    const me = await doc.get("/api/user").expect(200);
    expect(me.body.mustChangePassword).toBe(true);
    const blocked = await doc.get("/api/hospitalists");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("password_change_required");

    // The demo password is refused as a replacement everywhere; a real one lifts the gate.
    const weak = await doc.patch("/api/account/password").send({ currentPassword: made.temporaryPassword, newPassword: DEMO });
    expect(weak.status).toBe(400);
    const same = await doc.patch("/api/account/password").send({ currentPassword: made.temporaryPassword, newPassword: made.temporaryPassword });
    expect(same.status).toBe(400);
    const ok = await doc.patch("/api/account/password").send({ currentPassword: made.temporaryPassword, newPassword: "Correct-Horse-7!" });
    expect(ok.status).toBe(200);
    const after = await doc.get("/api/user").expect(200);
    expect(after.body.mustChangePassword).toBe(false);
    await doc.get("/api/hospitalists").expect(200);

    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    expect(audit.find((a) => a.action === "auth.password_change" && (a.details as { forced?: boolean }).forced === true)).toBeTruthy();
  });

  it("deactivation refuses sign-in AND ends live sessions; reactivation restores both", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const made = await directorCreates(director, "leaver");
    const { agent: leaver } = await login(ctx.app, { username: "leaver", password: made.temporaryPassword });
    await leaver.patch("/api/account/password").send({ currentPassword: made.temporaryPassword, newPassword: "Leaver-Pass-9!" }).expect(200);
    await leaver.get("/api/hospitalists").expect(200);

    const off = await director.post(`/api/accounts/${made.user.id}/deactivate`);
    expect(off.status).toBe(200);
    expect(off.body.disabled).toBe(true);

    // Existing session dies on its very next request.
    await leaver.get("/api/hospitalists").expect(401);
    // Correct password no longer signs in (generic answer, audited at high risk).
    const denied = await login(ctx.app, { username: "leaver", password: "Leaver-Pass-9!" });
    expect(denied.res.status).toBe(401);
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    expect(audit.find((a) => a.action === "account.deactivate" && a.resourceId === made.user.id)).toBeTruthy();
    expect(audit.find((a) => a.action === "auth.login_denied_disabled" && a.resourceId === made.user.id)).toBeTruthy();
    // Taken off shift so routing never offers them a patient.
    const profile = await ctx.storage.getHospitalistByUser(ctx.seedResult.orgId, made.user.id);
    expect(profile?.working).toBe(false);
    // Visible to the director's people list as disabled.
    const list = await director.get("/api/accounts").expect(200);
    expect((list.body as Array<{ id: number; disabled: boolean }>).find((u) => u.id === made.user.id)?.disabled).toBe(true);

    await director.post(`/api/accounts/${made.user.id}/reactivate`).expect(200);
    const back = await login(ctx.app, { username: "leaver", password: "Leaver-Pass-9!" });
    expect(back.res.status).toBe(200);
    await back.agent.get("/api/hospitalists").expect(200);
  });

  it("administrative reset issues a fresh one-time password and re-arms the forced change", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const made = await directorCreates(director, "forgetful");
    const { agent: user } = await login(ctx.app, { username: "forgetful", password: made.temporaryPassword });
    await user.patch("/api/account/password").send({ currentPassword: made.temporaryPassword, newPassword: "Chosen-Pass-3!" }).expect(200);

    const reset = await director.post(`/api/accounts/${made.user.id}/reset-password`).expect(200);
    expect(typeof reset.body.temporaryPassword).toBe("string");
    expect(reset.body.temporaryPassword).not.toBe(made.temporaryPassword);

    expect((await login(ctx.app, { username: "forgetful", password: "Chosen-Pass-3!" })).res.status).toBe(401);
    const { agent: again, res } = await login(ctx.app, { username: "forgetful", password: reset.body.temporaryPassword });
    expect(res.status).toBe(200);
    expect((await again.get("/api/hospitalists")).status).toBe(403);
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    expect(audit.find((a) => a.action === "account.password_reset" && a.resourceId === made.user.id)).toBeTruthy();
  });

  it("reach is role- and tenant-scoped: clinicians 403, self 409, out-of-reach 404, developer anywhere", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const made = await directorCreates(director, "scoped");
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: erDirector } = await login(ctx.app, { username: "er.director" });
    const { agent: dev } = await login(ctx.app, { orgCode: "DOCTURN", username: "dev" });

    // A hospitalist has no account-management reach at all.
    expect((await chen.post(`/api/accounts/${made.user.id}/deactivate`)).status).toBe(403);
    // Nobody acts on their own account.
    const meDir = await director.get("/api/user").expect(200);
    expect((await director.post(`/api/accounts/${meDir.body.id}/deactivate`)).status).toBe(409);
    // An ER director manages ER doctors only — a hospitalist is out of reach (404, not 403).
    expect((await erDirector.post(`/api/accounts/${made.user.id}/deactivate`)).status).toBe(404);
    // A director cannot touch the platform developer.
    const devMe = await dev.get("/api/user").expect(200);
    expect((await director.post(`/api/accounts/${devMe.body.id}/deactivate`)).status).toBe(404);
    // Cross-tenant: a user in another org is invisible to this director.
    const created = await dev.post("/api/dev/organizations").send({ name: "Other Hospital", code: "OTHR", city: "Elsewhere", state: "CA", timezone: "America/Los_Angeles" });
    expect(created.status).toBe(201);
    const other = created.body as { id: number; code: string };
    const foreign = await dev.post("/api/dev/users").send({ organizationId: other.id, username: "foreign.doc", displayName: "Dr. Foreign", role: "hospitalist" });
    expect(foreign.status).toBe(201);
    expect(typeof foreign.body.temporaryPassword).toBe("string"); // developer provisioning mints one too
    expect((await director.post(`/api/accounts/${foreign.body.id}/deactivate`)).status).toBe(404);
    // The developer reaches everything.
    expect((await dev.post(`/api/accounts/${foreign.body.id}/deactivate`)).status).toBe(200);
    expect((await dev.post(`/api/accounts/${made.user.id}/reset-password`)).status).toBe(200);
    const all = await dev.get("/api/dev/users").expect(200);
    expect((all.body as Array<{ id: number; disabled: boolean }>).find((u) => u.id === foreign.body.id)?.disabled).toBe(true);
  });

  it("impersonation round-trips server-side without any credentials", async () => {
    const { agent: dev } = await login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
    const target = ctx.seedResult.userIds.chen!;
    await dev.post("/api/dev/impersonate").send({ userId: target }).expect(200);
    expect((await dev.get("/api/user").expect(200)).body.username).toBe("chen");
    const back = await dev.post("/api/dev/impersonate/stop").send({});
    expect(back.status).toBe(200);
    expect(back.body.role).toBe("developer");
    expect((await dev.get("/api/user").expect(200)).body.username).toBe("dev");
    // Not impersonating → 400, and the route never grants developer to anyone else.
    expect((await dev.post("/api/dev/impersonate/stop").send({})).status).toBe(400);
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    expect((await chen.post("/api/dev/impersonate/stop").send({})).status).toBe(400);
  });

  it("/api/user exposes the account-state flags the UI renders (twoFactorEnabled, mustChangePassword, disabled)", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const me = await chen.get("/api/user").expect(200);
    expect(me.body).toMatchObject({ twoFactorEnabled: false, mustChangePassword: false, disabled: false });
    expect(me.body.passwordHash).toBeUndefined();
  });
});
