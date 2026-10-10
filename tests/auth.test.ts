import { scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { sql } from "drizzle-orm";
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
    // `persistent` distinguishes a real Postgres from the in-process PGlite
    // store; `storage`/`durable` say precisely which store this is (tests run
    // on the in-memory one); `secure` is whether THIS request was HTTPS.
    expect(res.body).toEqual({
      ok: true,
      db: "up",
      persistent: false,
      storage: "pglite-memory",
      durable: false,
      secure: false,
    });
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

  it("a legacy-hash account is not faster to reject than an unknown one (the cheaper derivation is padded)", async () => {
    // A pre-upgrade `key.salt` row derives at N=2^14 p=1 — ~1/6 of the current
    // cost — so without padding a wrong password against it answers far sooner
    // than the dummy comparison an unknown user gets, and timing would single
    // out existing (not yet upgraded) accounts.
    const legacy = await legacyHash("Legacy-Timing-1!");
    const current = await hashPassword("Current-Timing-1!");
    async function medianVerifyMs(stored: string): Promise<number> {
      const samples: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t = process.hrtime.bigint();
        expect(await verifyPassword("not-the-password", stored)).toBe(false);
        samples.push(Number(process.hrtime.bigint() - t) / 1e6);
      }
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length / 2)]!;
    }
    await medianVerifyMs(current); // warm-up
    const legacyMs = await medianVerifyMs(legacy);
    const currentMs = await medianVerifyMs(current);
    expect(legacyMs).toBeGreaterThan(currentMs * 0.6);
    // Still correct: the right password verifies against the legacy row.
    expect(await verifyPassword("Legacy-Timing-1!", legacy)).toBe(true);

    // End to end: a wrong password for a legacy-hash user vs an unknown user.
    const wu = ctx.seedResult.userIds.wu!;
    await ctx.storage.updateUser(wu, { passwordHash: await legacyHash(DEV_PASSWORD) });
    const legacyLogin = await medianLoginMs(ctx.app, { orgCode: "ISPN", username: "wu", password: "wrong-pass-1" });
    const unknownLogin = await medianLoginMs(ctx.app, { orgCode: "ISPN", username: "nobody.here", password: "wrong-pass-1" });
    expect(legacyLogin).toBeGreaterThan(unknownLogin * 0.5);
    // A failed attempt never upgrades the row (only a successful sign-in does).
    expect(classifyPasswordHash((await ctx.storage.getUserById(wu))!.passwordHash)).toBe("legacy");
  });

  it("the org lookup is not public: anonymous callers get one answer for every code, members see only their own org", async () => {
    await ctx.handle.db.execute(sql`INSERT INTO organizations (name, code) VALUES ('Other Hospital', 'OTHR') ON CONFLICT DO NOTHING`);
    // Anonymous: the same 401 whether the code exists, is the platform org, or not.
    for (const code of ["ISPN", "ispn", "OTHR", "DOCTURN", "NOPE"]) {
      const res = await supertest(ctx.app).get(`/api/mobile/org/${code}`);
      expect(res.status, code).toBe(401);
      expect(res.body, code).toEqual({ error: "unauthorized" });
    }
    // Signed in: your own org's safe fields (any casing)…
    const { agent } = await login(ctx.app, { username: "chen" });
    for (const code of ["ISPN", "ispn"]) {
      const own = await agent.get(`/api/mobile/org/${code}`).expect(200);
      expect(own.body).toEqual({
        id: ctx.seedResult.orgId,
        name: "Cedars-Sinai (ISP North)",
        code: "ISPN",
        timezone: "America/New_York",
      });
    }
    // …and one indistinguishable 404 for every other code: another tenant, the
    // operator tenant, or nothing at all.
    for (const code of ["OTHR", "DOCTURN", "NOPE"]) {
      const res = await agent.get(`/api/mobile/org/${code}`);
      expect(res.status, code).toBe(404);
      expect(res.body, code).toEqual({ error: "not_found" });
    }
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
