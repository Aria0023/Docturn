import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import speakeasy from "speakeasy";
import { createTestApp, login, type TestContext } from "./helpers.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

describe("MFA (TOTP + backup codes)", () => {
  it("enrolls, activates 2FA, and gates the next login behind a second factor", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });

    const enroll = await agent.post("/api/mfa/enroll");
    expect(enroll.status).toBe(200);
    const secret = enroll.body.secret as string;
    expect(secret).toBeTruthy();

    const code = speakeasy.totp({ secret, encoding: "base32" });
    const verify = await agent.post("/api/mfa/verify").send({ code });
    expect(verify.status).toBe(200);
    expect(verify.body.activated).toBe(true);
    expect(verify.body.backupCodes).toHaveLength(10);
    const backupCodes: string[] = verify.body.backupCodes;

    // A fresh login now returns 202 (second factor required).
    const agent2 = supertest.agent(ctx.app);
    const loginRes = await agent2
      .post("/api/login")
      .send({ orgCode: "MERCY", username: "chen", password: "docturn" });
    expect(loginRes.status).toBe(202);
    expect(loginRes.body.twoFactorRequired).toBe(true);

    // Complete with a valid TOTP code.
    const code2 = speakeasy.totp({ secret, encoding: "base32" });
    const complete = await agent2
      .post("/api/2fa/complete-login")
      .send({ code: code2 });
    expect(complete.status).toBe(200);
    expect(complete.body.username).toBe("chen");

    // A backup code works once, then is rejected on reuse.
    const agent3 = supertest.agent(ctx.app);
    await agent3
      .post("/api/login")
      .send({ orgCode: "MERCY", username: "chen", password: "docturn" });
    const first = await agent3
      .post("/api/2fa/complete-login")
      .send({ code: backupCodes[0] });
    expect(first.status).toBe(200);

    const agent4 = supertest.agent(ctx.app);
    await agent4
      .post("/api/login")
      .send({ orgCode: "MERCY", username: "chen", password: "docturn" });
    const reuse = await agent4
      .post("/api/2fa/complete-login")
      .send({ code: backupCodes[0] });
    expect(reuse.status).toBe(401);
  });

  it("rejects an invalid TOTP at verify", async () => {
    const { agent } = await login(ctx.app, { username: "patel" });
    await agent.post("/api/mfa/enroll");
    const verify = await agent.post("/api/mfa/verify").send({ code: "000000" });
    expect(verify.status).toBe(401);
  });
});
