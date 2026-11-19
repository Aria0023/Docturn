import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import speakeasy from "speakeasy";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * LB-3: managing an ACTIVE second factor.
 *  • /api/user reports twoFactorEnabled so Settings can render the truth;
 *  • re-enrolment requires password + a valid current code, and the live
 *    authenticator keeps working until the NEW one verifies (nothing is
 *    destroyed by one click);
 *  • disable and backup-code regeneration exist, step-up protected, audited;
 *  • an administrator can reset a locked-out clinician's MFA.
 */

let ctx: TestContext;
beforeEach(async () => { ctx = await createTestApp(); });
afterEach(async () => { await ctx.handle.close(); });

const totp = (secret: string) => speakeasy.totp({ secret, encoding: "base32" });

async function enrol(agent: import("supertest").Agent) {
  const enroll = await agent.post("/api/mfa/enroll");
  expect(enroll.status).toBe(200);
  const secret = enroll.body.secret as string;
  const verify = await agent.post("/api/mfa/verify").send({ code: totp(secret) });
  expect(verify.status).toBe(200);
  return { secret, backupCodes: verify.body.backupCodes as string[] };
}
async function loginWithTotp(username: string, secret: string) {
  const a = supertest.agent(ctx.app);
  const first = await a.post("/api/login").send({ orgCode: "ISPN", username, password: "docturn" });
  expect(first.status).toBe(202);
  return a.post("/api/2fa/complete-login").send({ code: totp(secret) });
}

describe("MFA management", () => {
  it("/api/user reports the real enrolment state", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    expect((await agent.get("/api/user")).body.twoFactorEnabled).toBe(false);
    await enrol(agent);
    expect((await agent.get("/api/user")).body.twoFactorEnabled).toBe(true);
  });

  it("re-enrolment needs password + current code, and keeps the OLD authenticator live until the new one verifies", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const { secret: oldSecret } = await enrol(agent);

    // One click (no step-up) must NOT touch the live credential.
    const bare = await agent.post("/api/mfa/enroll").send({});
    expect(bare.status).toBe(400);
    expect(bare.body.error).toBe("step_up_required");
    expect((await loginWithTotp("chen", oldSecret)).status).toBe(200);

    // Wrong password / wrong code are refused (and audited).
    expect((await agent.post("/api/mfa/enroll").send({ currentPassword: "nope", code: totp(oldSecret) })).status).toBe(401);
    expect((await agent.post("/api/mfa/enroll").send({ currentPassword: "docturn", code: "000000" })).status).toBe(401);

    // Proper step-up: a NEW secret is issued but parked as pending.
    const re = await agent.post("/api/mfa/enroll").send({ currentPassword: "docturn", code: totp(oldSecret) });
    expect(re.status).toBe(200);
    expect(re.body.reenrol).toBe(true);
    const newSecret = re.body.secret as string;
    expect(newSecret).not.toBe(oldSecret);
    // Abandoned halfway: the old authenticator STILL signs in; the new one does not yet.
    expect((await loginWithTotp("chen", oldSecret)).status).toBe(200);
    expect((await loginWithTotp("chen", newSecret)).status).toBe(401);
    // A wrong first code for the new one changes nothing.
    expect((await agent.post("/api/mfa/verify").send({ code: "000000" })).status).toBe(401);
    expect((await loginWithTotp("chen", oldSecret)).status).toBe(200);
    // The right code promotes it: new works, old is dead, fresh backup codes issued.
    const done = await agent.post("/api/mfa/verify").send({ code: totp(newSecret) });
    expect(done.status).toBe(200);
    expect(done.body.backupCodes).toHaveLength(10);
    expect((await loginWithTotp("chen", newSecret)).status).toBe(200);
    expect((await loginWithTotp("chen", oldSecret)).status).toBe(401);

    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 60);
    expect(audit.find((a) => a.action === "mfa.reenroll")).toBeTruthy();
    expect(audit.find((a) => a.action === "mfa.step_up_failed")).toBeTruthy();
  });

  it("backup codes can be regenerated (old ones die) and MFA can be disabled — both step-up protected", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const { secret, backupCodes } = await enrol(agent);

    expect((await agent.post("/api/mfa/backup-codes/regenerate").send({})).status).toBe(400);
    const regen = await agent.post("/api/mfa/backup-codes/regenerate").send({ currentPassword: "docturn", code: totp(secret) });
    expect(regen.status).toBe(200);
    expect(regen.body.backupCodes).toHaveLength(10);
    // An OLD backup code no longer completes a login; a NEW one does.
    const a1 = supertest.agent(ctx.app);
    await a1.post("/api/login").send({ orgCode: "ISPN", username: "chen", password: "docturn" });
    expect((await a1.post("/api/2fa/complete-login").send({ code: backupCodes[0] })).status).toBe(401);
    const a2 = supertest.agent(ctx.app);
    await a2.post("/api/login").send({ orgCode: "ISPN", username: "chen", password: "docturn" });
    expect((await a2.post("/api/2fa/complete-login").send({ code: regen.body.backupCodes[0] })).status).toBe(200);

    expect((await agent.post("/api/mfa/disable").send({ currentPassword: "docturn" })).status).toBe(400);
    expect((await agent.post("/api/mfa/disable").send({ currentPassword: "wrong", code: totp(secret) })).status).toBe(401);
    const off = await agent.post("/api/mfa/disable").send({ currentPassword: "docturn", code: totp(secret) });
    expect(off.status).toBe(200);
    expect((await agent.get("/api/user")).body.twoFactorEnabled).toBe(false);
    // Plain password login again (200, no 202 challenge).
    const plain = await supertest.agent(ctx.app).post("/api/login").send({ orgCode: "ISPN", username: "chen", password: "docturn" });
    expect(plain.status).toBe(200);
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 60);
    expect(audit.find((a) => a.action === "mfa.disable")).toBeTruthy();
    expect(audit.find((a) => a.action === "mfa.backup_codes_regenerated")).toBeTruthy();
  });

  it("a director can reset a locked-out clinician's MFA; a peer cannot", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await enrol(chen);
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    expect((await patel.post(`/api/accounts/${chenId}/reset-mfa`)).status).toBe(403);
    const { agent: director } = await login(ctx.app, { username: "director" });
    const reset = await director.post(`/api/accounts/${chenId}/reset-mfa`);
    expect(reset.status).toBe(200);
    const plain = await supertest.agent(ctx.app).post("/api/login").send({ orgCode: "ISPN", username: "chen", password: "docturn" });
    expect(plain.status).toBe(200); // no second factor demanded any more
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 60);
    expect(audit.find((a) => a.action === "account.mfa_reset" && a.resourceId === chenId)).toBeTruthy();
  });
});
