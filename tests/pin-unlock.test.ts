import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { ensureDemoTenants } from "../server/seed.js";
import { setModule } from "../server/modules.js";
import { SESSION_POLICY } from "../server/config.js";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";

/**
 * PIN unlock (PerfectServe parity #7, module security.pin, default OFF).
 * A PIN re-opens an authenticated, LOCKED session; it is not authentication:
 *  - set / changed only with the account password re-entered (scrypt hash,
 *    the password hasher — the digits are never stored or audited);
 *  - verified by the server through the existing 423 lock gate: the unlock
 *    route is lock-EXEMPT, so an expired lock (the idle auto-lock) is still
 *    a signed-out session and no PIN re-opens it;
 *  - 5 wrong PINs disable the PIN for that session — the password is then
 *    the only way in — counted atomically BEFORE the hash is checked;
 *  - never signs anyone in; another tenant / the module off answer 404.
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

const PIN = "4826";
const on = () => setModule(ctx.seedResult.orgId, "security.pin", true);
async function signedIn(username = "chen") {
  const { agent } = await login(ctx.app, { username });
  return agent;
}
async function withPin(username = "chen") {
  const agent = await signedIn(username);
  const r = await agent.put("/api/security/pin").send({ currentPassword: DEV_PASSWORD, pin: PIN });
  expect(r.status).toBe(200);
  return agent;
}
const pinAudit = async () =>
  (await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 500)).filter((r) => /^(pin\.|auth\.pin_|auth\.unlock)/.test(r.action));

describe("PIN unlock — setting the PIN", () => {
  it("is off by default: every PIN route answers 404 module_disabled", async () => {
    const agent = await signedIn();
    for (const r of [
      await agent.get("/api/security/pin"),
      await agent.put("/api/security/pin").send({ currentPassword: DEV_PASSWORD, pin: PIN }),
      await agent.delete("/api/security/pin"),
      await agent.post("/api/session/unlock-pin").send({ pin: PIN }),
    ]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: "module_disabled", module: "security.pin" });
    }
    expect(await ctx.storage.getUserPin(ctx.seedResult.orgId, (await agent.get("/api/user")).body.id)).toBeUndefined();
  });

  it("needs the account password; stores a scrypt hash only; audits without the digits", async () => {
    await on();
    const agent = await signedIn();
    const me = (await agent.get("/api/user")).body;
    expect((await agent.get("/api/security/pin")).body).toMatchObject({ set: false });
    const wrong = await agent.put("/api/security/pin").send({ currentPassword: "not-the-password", pin: PIN });
    expect(wrong.status).toBe(403);
    expect(wrong.body).toEqual({ error: "wrong_password" });
    expect(await ctx.storage.getUserPin(ctx.seedResult.orgId, me.id)).toBeUndefined();
    // A body without the password is a validation error, not a set.
    expect((await agent.put("/api/security/pin").send({ pin: PIN })).status).toBe(400);
    // Strict body: nothing else rides along.
    expect((await agent.put("/api/security/pin").send({ currentPassword: DEV_PASSWORD, pin: PIN, userId: 1 })).status).toBe(400);

    const ok = await agent.put("/api/security/pin").send({ currentPassword: DEV_PASSWORD, pin: PIN });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ set: true });
    const row = (await ctx.storage.getUserPin(ctx.seedResult.orgId, me.id))!;
    expect(row.pinHash).toMatch(/^\$scrypt\$ln=\d+,r=\d+,p=\d+\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(row.pinHash).not.toContain(PIN);
    expect((await agent.get("/api/security/pin")).body).toMatchObject({ set: true });

    expect((await agent.delete("/api/security/pin")).status).toBe(200);
    expect(await ctx.storage.getUserPin(ctx.seedResult.orgId, me.id)).toBeUndefined();

    const rows = await pinAudit();
    expect(rows.map((r) => r.action).sort()).toEqual(["pin.remove", "pin.set"]);
    for (const r of rows) expect(JSON.stringify(r)).not.toContain(PIN);
  });

  it("refuses weak PINs (not 4–8 digits, one repeated digit, a straight run)", async () => {
    await on();
    const agent = await signedIn();
    for (const pin of ["123", "123456789", "12a4", "1111", "1234", "9876", "012345", " 4826"]) {
      const r = await agent.put("/api/security/pin").send({ currentPassword: DEV_PASSWORD, pin });
      expect(r.status, pin).toBe(400);
    }
    expect((await agent.put("/api/security/pin").send({ currentPassword: DEV_PASSWORD, pin: "40917263" })).status).toBe(200);
  });
});

describe("PIN unlock — re-opening a locked session", () => {
  it("unlocks the SAME locked session (no new sign-in), audited; the locked /api/user says a PIN can be used", async () => {
    await on();
    const agent = await withPin();
    await agent.post("/api/session/lock").send({}).expect(200);
    expect((await agent.get("/api/patients")).status).toBe(423);
    const lockedMe = (await agent.get("/api/user")).body;
    expect(lockedMe).toMatchObject({ locked: true, pinUnlock: true });
    const r = await agent.post("/api/session/unlock-pin").send({ pin: PIN });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ locked: false });
    expect((await agent.get("/api/patients")).status).toBe(200);
    const me = (await agent.get("/api/user")).body;
    expect(me.locked).toBeUndefined();
    expect(me.pinUnlock).toBeUndefined();
    const rows = await pinAudit();
    expect(rows.find((x) => x.action === "auth.unlock")).toMatchObject({ details: { method: "pin" }, riskLevel: "low" });
  });

  it("an unlocked session gets 409 not_locked; a signed-out caller 401 — a PIN never signs anyone in", async () => {
    await on();
    const agent = await withPin();
    const r = await agent.post("/api/session/unlock-pin").send({ pin: PIN });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: "not_locked" });
    const anon = await supertest(ctx.app).post("/api/session/unlock-pin").send({ pin: PIN });
    expect(anon.status).toBe(401);
    // Nor with an org + username along for the ride.
    const anon2 = await supertest(ctx.app).post("/api/session/unlock-pin").send({ orgCode: "ISPN", username: "chen", pin: PIN });
    expect(anon2.status).toBe(401);
    expect(anon2.headers["set-cookie"] ?? []).toEqual([]);
  });

  it("no PIN set → 409 pin_not_set (the password is the way in), and the locked body offers no PIN", async () => {
    await on();
    const agent = await signedIn();
    await agent.post("/api/session/lock").send({}).expect(200);
    expect((await agent.get("/api/user")).body.pinUnlock).toBeUndefined();
    const r = await agent.post("/api/session/unlock-pin").send({ pin: PIN });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: "pin_not_set", passwordRequired: true });
  });

  it("the idle auto-lock is still an automatic logoff: no PIN re-opens an expired lock", async () => {
    await on();
    const agent = await withPin();
    await agent.post("/api/session/lock").send({ idleMs: SESSION_POLICY.maxAgeMs }).expect(200);
    const r = await agent.post("/api/session/unlock-pin").send({ pin: PIN });
    expect(r.status).toBe(401);
    expect((await agent.get("/api/user")).status).toBe(401);
  });

  it("5 wrong PINs disable the PIN for this session — even the right one is then refused; the password still unlocks", async () => {
    await on();
    const agent = await withPin();
    await agent.post("/api/session/lock").send({}).expect(200);
    for (let i = 1; i <= 4; i++) {
      const r = await agent.post("/api/session/unlock-pin").send({ pin: "0000" });
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ error: "wrong_pin", attemptsLeft: 5 - i });
    }
    const fifth = await agent.post("/api/session/unlock-pin").send({ pin: "0000" });
    expect(fifth.body).toEqual({ error: "pin_disabled", passwordRequired: true });
    const right = await agent.post("/api/session/unlock-pin").send({ pin: PIN });
    expect(right.status).toBe(403);
    expect(right.body).toEqual({ error: "pin_disabled", passwordRequired: true });
    expect((await agent.get("/api/patients")).status).toBe(423);
    expect((await agent.get("/api/user")).body).toMatchObject({ locked: true });
    expect((await agent.get("/api/user")).body.pinUnlock).toBeUndefined();

    const rows = await pinAudit();
    expect(rows.filter((x) => x.action === "auth.pin_failed")).toHaveLength(5);
    expect(rows.find((x) => x.action === "auth.pin_disabled")).toMatchObject({ riskLevel: "medium" });
    for (const x of rows) expect(JSON.stringify(x)).not.toMatch(/0000|4826/);

    // The password is the way back in — and that NEW session may use the PIN again.
    const relog = await agent.post("/api/login").send({ orgCode: "ISPN", username: "chen", password: DEV_PASSWORD });
    expect(relog.status).toBe(200);
    expect((await agent.get("/api/patients")).status).toBe(200);
    await agent.post("/api/session/lock").send({}).expect(200);
    expect((await agent.get("/api/user")).body.pinUnlock).toBe(true);
    expect((await agent.post("/api/session/unlock-pin").send({ pin: PIN })).status).toBe(200);
  });

  it("the limit holds under a burst of parallel guesses", async () => {
    await on();
    const agent = await withPin();
    await agent.post("/api/session/lock").send({}).expect(200);
    const burst = await Promise.all(Array.from({ length: 8 }, () => agent.post("/api/session/unlock-pin").send({ pin: "0000" })));
    expect(burst.every((r) => r.status === 403)).toBe(true);
    expect(burst.filter((r) => r.body.error === "wrong_pin").length).toBeLessThanOrEqual(4);
    const right = await agent.post("/api/session/unlock-pin").send({ pin: PIN });
    expect(right.body).toEqual({ error: "pin_disabled", passwordRequired: true });
  });

  it("a session's failures never count against another session of the same user", async () => {
    await on();
    const a = await withPin();
    const b = await signedIn();
    await a.post("/api/session/lock").send({}).expect(200);
    await b.post("/api/session/lock").send({}).expect(200);
    for (let i = 0; i < 5; i++) await a.post("/api/session/unlock-pin").send({ pin: "0000" });
    expect((await a.post("/api/session/unlock-pin").send({ pin: PIN })).status).toBe(403);
    expect((await b.post("/api/session/unlock-pin").send({ pin: PIN })).status).toBe(200);
  });

  it("module switched off while locked: 404 module_disabled, still locked", async () => {
    await on();
    const agent = await withPin();
    await agent.post("/api/session/lock").send({}).expect(200);
    await setModule(ctx.seedResult.orgId, "security.pin", false);
    const r = await agent.post("/api/session/unlock-pin").send({ pin: PIN });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "module_disabled", module: "security.pin" });
    expect((await agent.get("/api/user")).body.pinUnlock).toBeUndefined();
    expect((await agent.get("/api/patients")).status).toBe(423);
  });

  it("another tenant: its own module switch, and one user's PIN never opens another's session", async () => {
    await ensureDemoTenants(ctx.storage);
    await on();
    await withPin("chen");
    const { agent: voss } = await login(ctx.app, { orgCode: "HOSP", username: "voss" });
    await voss.post("/api/session/lock").send({}).expect(200);
    const r = await voss.post("/api/session/unlock-pin").send({ pin: PIN });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "module_disabled", module: "security.pin" });
    const hosp = (await ctx.storage.getOrganizationByCode("HOSP"))!;
    await setModule(hosp.id, "security.pin", true);
    expect((await voss.post("/api/session/unlock-pin").send({ pin: PIN })).body).toEqual({ error: "pin_not_set", passwordRequired: true });
    // Same org, another user who has no PIN: chen's PIN does not open patel's session.
    const patel = await signedIn("patel");
    await patel.post("/api/session/lock").send({}).expect(200);
    expect((await patel.post("/api/session/unlock-pin").send({ pin: PIN })).status).toBe(409);
  });

  it("a demo bearer token locks and unlocks on its own", async () => {
    await on();
    await withPin("er.doc");
    const tok = await supertest(ctx.app).post("/api/demo/login").send({ orgCode: "ISPN", username: "er.doc", password: DEV_PASSWORD }).expect(200);
    const auth = `Bearer ${tok.body.token as string}`;
    await supertest(ctx.app).post("/api/session/lock").set("Authorization", auth).send({}).expect(200);
    expect((await supertest(ctx.app).get("/api/patients").set("Authorization", auth)).status).toBe(423);
    const r = await supertest(ctx.app).post("/api/session/unlock-pin").set("Authorization", auth).send({ pin: PIN });
    expect(r.status).toBe(200);
    expect((await supertest(ctx.app).get("/api/patients").set("Authorization", auth)).status).toBe(200);
  });
});
