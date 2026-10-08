import { scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";
import {
  classifyPasswordHash,
  hashPassword,
  isValidPasswordHashFormat,
  needsRehash,
  parseSessionPrincipal,
  passwordGeneration,
  PASSWORD_HASH_FORMAT,
  SCRYPT_PARAMS,
  verifyPassword,
} from "../server/auth.js";

const scryptDefault = promisify(scryptCb) as (pw: string, salt: string, keylen: number) => Promise<Buffer>;

/** Build a credential exactly as the pre-upgrade code did (Node defaults, `key.salt`). */
async function legacyHash(password: string): Promise<string> {
  const salt = "0123456789abcdef0123456789abcdef";
  const key = await scryptDefault(password, salt, 64);
  return `${key.toString("hex")}.${salt}`;
}

async function medianLoginMs(
  app: TestContext["app"],
  creds: { orgCode: string; username: string; password: string },
  rounds = 4,
): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const t = process.hrtime.bigint();
    const res = await supertest(app).post("/api/login").send(creds);
    samples.push(Number(process.hrtime.bigint() - t) / 1e6);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_credentials" });
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.handle.close();
});

describe("auth", () => {
  it("logs in with good credentials and returns a sanitized user", async () => {
    const { res } = await login(ctx.app, { username: "director" });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("director");
    expect(res.body.role).toBe("director");
    expect(res.body).not.toHaveProperty("password_hash");
    expect(res.body).not.toHaveProperty("passwordHash");
  });

  it("rejects bad credentials with 401", async () => {
    const { res } = await login(ctx.app, {
      username: "director",
      password: "wrong",
    });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown org with 401", async () => {
    const { res } = await login(ctx.app, {
      orgCode: "NOPE",
      username: "director",
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 on a protected route without a session", async () => {
    const res = await supertest(ctx.app).get("/api/user");
    expect(res.status).toBe(401);
  });

  it("forbids a hospitalist on a director-only route (403)", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const res = await agent.get("/api/users");
    expect(res.status).toBe(403);
  });

  it("allows a director on the director-only route", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const res = await agent.get("/api/users");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const u of res.body) {
      expect(u).not.toHaveProperty("passwordHash");
    }
  });

  it("health endpoint reports the database is up", async () => {
    const res = await supertest(ctx.app).get("/api/health");
    expect(res.status).toBe(200);
    // `persistent` distinguishes a real Postgres from the ephemeral in-process
    // store; tests run on the latter, so it is false here.
    expect(res.body).toEqual({ ok: true, db: "up", persistent: false });
  });

  it("never exposes passwordHash in the registration approval queue", async () => {
    const reg = await supertest(ctx.app).post("/api/register").send({
      orgCode: "ISPN",
      username: "qa.pending",
      password: "qatest123",
      displayName: "QA Pending",
      requestedRole: "hospitalist",
    });
    expect(reg.status).toBe(201);

    const { agent } = await login(ctx.app, { username: "director" });
    const res = await agent.get("/api/registrations");
    expect(res.status).toBe(200);
    const row = res.body.find((r: { username: string }) => r.username === "qa.pending");
    expect(row).toBeTruthy();
    expect(row).not.toHaveProperty("passwordHash");
    expect(row).not.toHaveProperty("password_hash");
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });
});

/* A.CON-SHO-14 — OWASP-strength scrypt, legacy hashes still verify and are upgraded on sign-in. */
describe("password hashing work factor", () => {
  it("hashPassword emits the OWASP-parameter format (N=2^15 r=8 p=3) and verifies", async () => {
    expect(SCRYPT_PARAMS).toEqual({ ln: 15, r: 8, p: 3 });
    const stored = await hashPassword("Correct-Horse-7!");
    expect(stored).toMatch(/^\$scrypt\$ln=15,r=8,p=3\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(isValidPasswordHashFormat(stored)).toBe(true);
    expect(classifyPasswordHash(stored)).toBe("current");
    expect(needsRehash(stored)).toBe(false);
    expect(await verifyPassword("Correct-Horse-7!", stored)).toBe(true);
    expect(await verifyPassword("Correct-Horse-8!", stored)).toBe(false);
    // Two hashes of the same password differ (random salt).
    expect(await hashPassword("Correct-Horse-7!")).not.toBe(stored);
    expect(PASSWORD_HASH_FORMAT).toContain("N=2^15 r=8 p=3");
  });

  it("the seeded demo roster is stored under the current parameters", async () => {
    const users = await ctx.storage.listUsers(ctx.seedResult.orgId);
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) expect(classifyPasswordHash(u.passwordHash)).toBe("current");
  });

  it("a legacy (Node-default) hash still verifies, is classified legacy, and needs a re-hash", async () => {
    const legacy = await legacyHash("Old-Pass-1!");
    expect(legacy).toMatch(/^[0-9a-f]{128}\.[0-9a-f]{32}$/);
    expect(classifyPasswordHash(legacy)).toBe("legacy");
    expect(isValidPasswordHashFormat(legacy)).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
    expect(await verifyPassword("Old-Pass-1!", legacy)).toBe(true);
    expect(await verifyPassword("Old-Pass-2!", legacy)).toBe(false);
    // Garbage is "invalid" and never verifies, but still costs one scrypt.
    expect(classifyPasswordHash("plaintext")).toBe("invalid");
    expect(classifyPasswordHash(null)).toBe("invalid");
    expect(await verifyPassword("plaintext", "plaintext")).toBe(false);
  });

  it("signing in with a legacy hash transparently re-hashes it WITHOUT invalidating sessions", async () => {
    const liu = ctx.seedResult.userIds.liu!;
    await ctx.storage.updateUser(liu, { passwordHash: await legacyHash(DEV_PASSWORD) });
    expect(classifyPasswordHash((await ctx.storage.getUserById(liu))!.passwordHash)).toBe("legacy");

    const { agent, res } = await login(ctx.app, { username: "liu" });
    expect(res.status).toBe(200);

    const after = (await ctx.storage.getUserById(liu))!;
    expect(classifyPasswordHash(after.passwordHash)).toBe("current");
    expect(await verifyPassword(DEV_PASSWORD, after.passwordHash)).toBe(true);
    // Not a password CHANGE: the generation is untouched and the session lives on.
    expect(after.passwordChangedAt).toBeNull();
    await agent.get("/api/user").expect(200);
    // A wrong password against the upgraded hash still fails.
    expect((await login(ctx.app, { username: "liu", password: "nope-nope-1" })).res.status).toBe(401);
  });
});

/* A.CON-SHO-11 — login cost is the same whether or not the org / user exists. */
describe("login does not reveal org or user existence", () => {
  it("unknown org, unknown user and wrong password all answer the same 401 in comparable time", async () => {
    // Warm the pool once so the first scrypt's cold start is not a sample.
    await supertest(ctx.app).post("/api/login").send({ orgCode: "ISPN", username: "chen", password: "warm-up-1" });

    const wrongPassword = await medianLoginMs(ctx.app, { orgCode: "ISPN", username: "chen", password: "wrong-pass-1" });
    const unknownUser = await medianLoginMs(ctx.app, { orgCode: "ISPN", username: "nobody.here", password: "wrong-pass-1" });
    const unknownOrg = await medianLoginMs(ctx.app, { orgCode: "NOPE", username: "chen", password: "wrong-pass-1" });

    // Before the fix a miss cost ~5 ms against ~50+ ms for a real scrypt: a
    // 10x gap. Now every miss pays one scrypt, so the medians sit within
    // ordinary jitter of each other (generous bound: no path may be under
    // half the cost of a real password comparison).
    expect(unknownUser).toBeGreaterThan(wrongPassword * 0.5);
    expect(unknownOrg).toBeGreaterThan(wrongPassword * 0.5);
    expect(wrongPassword).toBeGreaterThan(unknownUser * 0.5);
    expect(wrongPassword).toBeGreaterThan(unknownOrg * 0.5);
  });

  it("session principals carry the password generation (legacy numeric ids still parse)", () => {
    expect(parseSessionPrincipal(42)).toEqual({ id: 42, pg: 0 });
    expect(parseSessionPrincipal({ id: 42, pg: 1700000000000 })).toEqual({ id: 42, pg: 1700000000000 });
    expect(parseSessionPrincipal({ id: "42" })).toBeNull();
    expect(parseSessionPrincipal(null)).toBeNull();
    expect(parseSessionPrincipal("42")).toBeNull();
    expect(passwordGeneration({ passwordChangedAt: null })).toBe(0);
    const when = new Date("2026-01-02T03:04:05.678Z");
    expect(passwordGeneration({ passwordChangedAt: when })).toBe(when.getTime());
  });
});
