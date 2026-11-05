import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import speakeasy from "speakeasy";
import { createTestApp, login, type TestContext } from "./helpers.js";
import {
  ConsoleSms,
  SmsUnavailableError,
  TwilioSms,
  UnavailableSms,
  isSmsUnavailable,
  smsFor,
} from "../server/services/sms.js";

/**
 * A.CON-SHO-3 — the console SMS stub must never put a recipient number or a
 * message body (MFA one-time codes!) on stdout; the MFA SMS path must never
 * hand the code back to the caller; and in production, a carrier that cannot
 * deliver fails closed with a typed `sms_unavailable` instead of reporting
 * success.
 */

const PHONE = "+15557778899";

/** Capture console.log lines emitted by the stub (seed/boot lines are ignored). */
function captureStubLog() {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    const line = args.map(String).join(" ");
    if (line.includes("[sms")) lines.push(line);
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe("ConsoleSms stub", () => {
  it("records the message for tests but logs a content-free line (no number, no body)", async () => {
    const log = captureStubLog();
    try {
      const sms = new ConsoleSms();
      const body = "Your DocTurn verification code is 482913";
      const res = await sms.send(PHONE, body);
      expect(res.sid).toMatch(/^stub_/);
      expect(sms.sent).toEqual([{ to: PHONE, body }]);

      expect(log.lines).toHaveLength(1);
      const line = log.lines[0]!;
      expect(line).not.toContain("482913");
      expect(line).not.toContain(body);
      expect(line).not.toContain(PHONE);
      expect(line).not.toContain("8899"); // not even the last digits
      expect(line).not.toMatch(/\d{4,}/); // no digit run that could be a number or a code
      expect(line).toMatch(/not delivered/);
    } finally {
      log.restore();
    }
  });
});

describe("smsFor registry posture", () => {
  const dev = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
  const prod = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

  it("outside production every credential-less carrier falls back to the console stub", () => {
    for (const carrier of ["console", "twilio", "sns", "pinpoint", "messagebird", "vonage", "bogus"]) {
      const sms = smsFor(carrier, dev);
      expect(sms).toBeInstanceOf(ConsoleSms);
    }
    expect(smsFor("twilio", dev).carrier).toBe("twilio");
    expect(smsFor("bogus", dev).carrier).toBe("console");
  });

  it("in production a carrier without credentials (or without an implementation) fails closed", async () => {
    for (const carrier of ["console", "twilio", "sns", "pinpoint", "messagebird", "vonage"]) {
      const sms = smsFor(carrier, prod);
      expect(sms).toBeInstanceOf(UnavailableSms);
      expect(sms.carrier).toBe(carrier);
      const err = await sms.send(PHONE, "hello").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SmsUnavailableError);
      expect(isSmsUnavailable(err)).toBe(true);
      expect((err as SmsUnavailableError).code).toBe("sms_unavailable");
      // The error text is content-free: no number, no body.
      expect(String((err as Error).message)).not.toContain(PHONE);
      expect(String((err as Error).message)).not.toContain("hello");
    }
  });

  it("Twilio with credentials gets the live adapter, in any environment", () => {
    const creds = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+15550000000" };
    expect(smsFor("twilio", { ...prod, ...creds })).toBeInstanceOf(TwilioSms);
    expect(smsFor("twilio", { ...dev, ...creds })).toBeInstanceOf(TwilioSms);
  });
});

describe("MFA SMS one-time code path", () => {
  let ctx: TestContext;
  const savedEnv = process.env.NODE_ENV;
  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(async () => {
    process.env.NODE_ENV = savedEnv;
    vi.restoreAllMocks();
    await ctx.handle.close();
  });

  /** Enrol TOTP for chen, give him a phone, and start a login that stops at the second factor. */
  async function pendingLoginForChen() {
    const { agent } = await login(ctx.app, { username: "chen" });
    const enroll = await agent.post("/api/mfa/enroll");
    const code = speakeasy.totp({ secret: enroll.body.secret, encoding: "base32" });
    expect((await agent.post("/api/mfa/verify").send({ code })).status).toBe(200);
    await ctx.storage.updateUser(ctx.seedResult.userIds.chen!, { phone: PHONE });

    const pending = supertest.agent(ctx.app);
    const first = await pending.post("/api/login").send({ orgCode: "ISPN", username: "chen", password: "docturn" });
    expect(first.status).toBe(202);
    return pending;
  }

  it("texts the code without ever returning or logging it, and the texted code completes the login", async () => {
    const pending = await pendingLoginForChen();
    const sendSpy = vi.spyOn(ConsoleSms.prototype, "send");
    const log = captureStubLog();
    let res: supertest.Response;
    try {
      res = await pending.post("/api/2fa/request-sms");
    } finally {
      log.restore();
    }
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });

    // The code exists only inside the SMS body handed to the carrier.
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [to, body] = sendSpy.mock.calls[0] as [string, string];
    expect(to).toBe(PHONE);
    const code = body.match(/\b(\d{6})\b/)?.[1];
    expect(code).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain(code!);
    expect(JSON.stringify(res.headers["set-cookie"] ?? "")).not.toContain(code!);
    for (const line of log.lines) {
      expect(line).not.toContain(code!);
      expect(line).not.toContain(PHONE);
    }
    // History row is content-free as before.
    const history = await ctx.storage.listSmsHistory(ctx.seedResult.orgId);
    expect(history.some((h) => h.body.includes(code!))).toBe(false);

    // Wrong code → 401; the real one → signed in.
    expect((await pending.post("/api/2fa/complete-login").send({ code: "000000" })).status).toBe(401);
    const done = await pending.post("/api/2fa/complete-login").send({ code: code! });
    expect(done.status).toBe(200);
    expect(done.body.username).toBe("chen");
  });

  it("answers sent:false when the account has no phone number", async () => {
    const pending = await pendingLoginForChen();
    await ctx.storage.updateUser(ctx.seedResult.userIds.chen!, { phone: null });
    const res = await pending.post("/api/2fa/request-sms");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: false });
  });

  it("fails closed in production without carrier credentials: 503 sms_unavailable, no code armed, nothing recorded", async () => {
    const pending = await pendingLoginForChen();
    const sendSpy = vi.spyOn(ConsoleSms.prototype, "send");
    const historyBefore = (await ctx.storage.listSmsHistory(ctx.seedResult.orgId)).length;

    process.env.NODE_ENV = "production";
    const res = await pending.post("/api/2fa/request-sms");
    process.env.NODE_ENV = savedEnv;

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ sent: false, error: "sms_unavailable" });
    expect(sendSpy).not.toHaveBeenCalled(); // the stub was never used as a carrier
    expect((await ctx.storage.listSmsHistory(ctx.seedResult.orgId)).length).toBe(historyBefore);
    // No OTP exists to guess: every 6-digit attempt is refused.
    expect((await pending.post("/api/2fa/complete-login").send({ code: "123456" })).status).toBe(401);
  });

  it("POST /api/sms/send fails closed in production (503, no history, no 'sent' audit)", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const historyBefore = (await ctx.storage.listSmsHistory(ctx.seedResult.orgId)).length;

    process.env.NODE_ENV = "production";
    const res = await director.post("/api/sms/send").send({ to: PHONE, body: "test" });
    process.env.NODE_ENV = savedEnv;

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "sms_unavailable", carrier: "console" });
    expect((await ctx.storage.listSmsHistory(ctx.seedResult.orgId)).length).toBe(historyBefore);
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 200);
    expect(audit.some((r) => r.action === "sms.send")).toBe(false);

    // Outside production the stub still records it (dev/test behaviour unchanged).
    const ok = await director.post("/api/sms/send").send({ to: PHONE, body: "test" });
    expect(ok.status).toBe(201);
  });
});
