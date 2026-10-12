import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";
import { invalidateModules, setModule } from "../server/modules.js";

/**
 * GET /api/session — the sign-in screen's "is there a session to restore?"
 * probe. Being signed out is the normal state of a freshly opened app, not an
 * error, so the probe answers 200 either way: a cold load of the client then
 * logs nothing in the browser console (a 401 from GET /api/user is reported
 * by every browser as "Failed to load resource"). It shares /api/user's whole
 * notion of "authenticated" — a revoked or logged-out session reads as signed
 * out — and carries the same user body, account-state flags included.
 * GET /api/user keeps answering 401 when there is no session (the client's
 * dead-session checks rely on that).
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx.handle.close();
});

describe("GET /api/session", () => {
  it("signed out: 200 { authenticated: false }, never cached, no user data; /api/user still 401", async () => {
    const res = await supertest(ctx.app).get("/api/session");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false });
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    const user = await supertest(ctx.app).get("/api/user");
    expect(user.status).toBe(401);
    expect(user.body.error).toBe("unauthorized");
  });

  it("signed in: 200 with exactly the /api/user body (no password hash)", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const probe = await agent.get("/api/session");
    expect(probe.status).toBe(200);
    expect(probe.headers["cache-control"]).toMatch(/no-store/);
    expect(probe.body.authenticated).toBe(true);
    const me = await agent.get("/api/user").expect(200);
    expect(probe.body.user).toEqual(me.body);
    expect(probe.body.user.username).toBe("chen");
    expect(JSON.stringify(probe.body)).not.toMatch(/passwordHash|password_hash|scrypt/);
  });

  it("after sign-out the same cookie reads as signed out", async () => {
    const { agent } = await login(ctx.app, { username: "wu" });
    expect((await agent.get("/api/session")).body.authenticated).toBe(true);
    await agent.post("/api/logout").expect(204);
    const after = await agent.get("/api/session");
    expect(after.status).toBe(200);
    expect(after.body).toEqual({ authenticated: false });
  });

  it("a session revoked by a password change elsewhere reads as signed out", async () => {
    const { agent: phone } = await login(ctx.app, { username: "patel" });
    const { agent: laptop } = await login(ctx.app, { username: "patel" });
    expect((await phone.get("/api/session")).body.authenticated).toBe(true);
    await laptop
      .patch("/api/account/password")
      .send({ currentPassword: DEV_PASSWORD, newPassword: "Patel-Probe-Pass-1" })
      .expect(200);
    const stale = await phone.get("/api/session");
    expect(stale.status).toBe(200);
    expect(stale.body).toEqual({ authenticated: false });
    await phone.get("/api/user").expect(401);
    // The session that made the change is still signed in.
    expect((await laptop.get("/api/session")).body.user.username).toBe("patel");
  });

  it("is exempt from the MFA-enrolment gate and carries the flag, like /api/user", async () => {
    await setModule(ctx.seedResult.orgId, "security.mfaRequired", true);
    try {
      const { agent } = await login(ctx.app, { username: "director" });
      await agent.get("/api/hospitalists").expect(403);
      const probe = await agent.get("/api/session");
      expect(probe.status).toBe(200);
      expect(probe.body.authenticated).toBe(true);
      expect(probe.body.user.mfaEnrollmentRequired).toBe(true);
      expect(probe.body.user.username).toBe("director");
    } finally {
      await setModule(ctx.seedResult.orgId, "security.mfaRequired", false);
      invalidateModules(ctx.seedResult.orgId);
    }
  });

  it("is exempt from the forced-password-change gate and carries mustChangePassword", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const reset = await director.post(`/api/accounts/${ctx.seedResult.userIds.lopez}/reset-password`).expect(200);
    const { agent: lopez } = await login(ctx.app, { username: "lopez", password: reset.body.temporaryPassword });
    const blocked = await lopez.get("/api/hospitalists");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("password_change_required");
    const probe = await lopez.get("/api/session");
    expect(probe.status).toBe(200);
    expect(probe.body.authenticated).toBe(true);
    expect(probe.body.user.mustChangePassword).toBe(true);
  });
});
