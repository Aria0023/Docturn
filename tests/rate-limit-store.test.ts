import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app.js";
import { ACCOUNT_RATE_LIMIT, REGISTER_RATE_LIMIT, getRateLimitState } from "../server/config.js";
import { createTestApp, DEV_PASSWORD, type TestContext } from "./helpers.js";

/**
 * E1 multi-instance safety — the shared rate-limit store (docs/ENTERPRISE_READINESS.md).
 *
 * With DATABASE_URL the auth / account / registration limiters count in the
 * `rate_limit_hits` table, so N instances enforce ONE budget. Two instances
 * are two Express apps on one database here (the counter is one upsert, so
 * the sharing is real); the store itself is exercised on PGlite because it
 * is plain SQL — scripts/multi-instance-check.mjs runs it on real Postgres.
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("rate_limit_hits storage", () => {
  it("counts within a window, restarts a lapsed window, decrements to a floor of 0, resets and prunes", async () => {
    const s = ctx.storage;
    expect((await s.incrementRateLimitHit("t:k", 10_000)).count).toBe(1);
    expect((await s.incrementRateLimitHit("t:k", 10_000)).count).toBe(2);
    const third = await s.incrementRateLimitHit("t:k", 10_000);
    expect(third.count).toBe(3);
    expect(third.windowStart).toBeInstanceOf(Date);
    await s.decrementRateLimitHit("t:k");
    expect((await s.incrementRateLimitHit("t:k", 10_000)).count).toBe(3);
    await s.decrementRateLimitHit("t:none");
    await s.decrementRateLimitHit("t:none");
    expect((await s.incrementRateLimitHit("t:none", 10_000)).count).toBe(1);
    // A short window lapses and the next hit starts a fresh one.
    expect((await s.incrementRateLimitHit("t:short", 50)).count).toBe(1);
    expect((await s.incrementRateLimitHit("t:short", 50)).count).toBe(2);
    await sleep(80);
    expect((await s.incrementRateLimitHit("t:short", 50)).count).toBe(1);
    await s.resetRateLimitKey("t:k");
    expect((await s.incrementRateLimitHit("t:k", 10_000)).count).toBe(1);
    await s.incrementRateLimitHit("u:1", 10_000);
    await s.resetRateLimitPrefix("t:");
    expect((await s.incrementRateLimitHit("t:k", 10_000)).count).toBe(1);
    expect((await s.incrementRateLimitHit("u:1", 10_000)).count).toBe(2);
    await sleep(60);
    expect(await s.pruneRateLimitHits(50)).toBeGreaterThanOrEqual(2);
  });
});

describe("limiter store selection", () => {
  it("defaults to the per-process memory store without DATABASE_URL, and records it", () => {
    createApp({ sessionSecret: "t", rateLimiting: true });
    expect(getRateLimitState()).toMatchObject({ enabled: true, store: "memory" });
    createApp({ sessionSecret: "t", rateLimiting: false });
    expect(getRateLimitState().enabled).toBe(false);
  });

  it("two instances on the database store share ONE per-account failed-login budget", async () => {
    const a = createApp({ sessionSecret: "t", rateLimiting: true, rateLimitStore: "database" });
    const b = createApp({ sessionSecret: "t", rateLimiting: true, rateLimitStore: "database" });
    expect(getRateLimitState()).toMatchObject({ enabled: true, store: "database" });
    const wrong = (app: typeof a) =>
      supertest(app).post("/api/login").send({ orgCode: "ISPN", username: "chen", password: "not-it" });
    const half = Math.floor(ACCOUNT_RATE_LIMIT.max / 2);
    for (let i = 0; i < half; i++) expect((await wrong(a)).status).toBe(401);
    for (let i = half; i < ACCOUNT_RATE_LIMIT.max; i++) expect((await wrong(b)).status).toBe(401);
    // The budget is spent across both instances: the next guess, on either, is refused.
    const blockedOnA = await wrong(a);
    expect(blockedOnA.status).toBe(429);
    expect(blockedOnA.body).toEqual({ error: "rate_limited" });
    expect((await wrong(b)).status).toBe(429);
    // Another account's budget is its own, on both instances.
    expect(
      (await supertest(b).post("/api/login").send({ orgCode: "ISPN", username: "patel", password: DEV_PASSWORD })).status,
    ).toBe(200);
    // The rows are in the shared table, keyed per limiter.
    const rows = await ctx.handle.db.query.rateLimitHits.findMany();
    expect(rows.some((r) => r.key.startsWith("acct:") && r.key.includes("chen"))).toBe(true);
    expect(rows.some((r) => r.key.startsWith("auth:"))).toBe(true);
  });

  it("a correct password never spends the shared budget (skipSuccessfulRequests decrements in the store)", async () => {
    const a = createApp({ sessionSecret: "t", rateLimiting: true, rateLimitStore: "database" });
    for (let i = 0; i < 3; i++) {
      expect(
        (await supertest(a).post("/api/login").send({ orgCode: "ISPN", username: "wu", password: DEV_PASSWORD })).status,
      ).toBe(200);
    }
    const rows = await ctx.handle.db.query.rateLimitHits.findMany();
    const wu = rows.find((r) => r.key.startsWith("acct:") && r.key.includes("wu"));
    expect(wu?.count ?? 0).toBe(0);
  });

  it("two instances share the per-IP registration budget (every request counts)", async () => {
    const a = createApp({ sessionSecret: "t", rateLimiting: true, rateLimitStore: "database" });
    const b = createApp({ sessionSecret: "t", rateLimiting: true, rateLimitStore: "database" });
    const register = (app: typeof a, i: number) =>
      supertest(app)
        .post("/api/register")
        .send({ orgCode: "ISPN", username: `shared.${i}`, displayName: "Shared", requestedRole: "hospitalist", password: "Strong-Pass-2026" });
    const half = Math.floor(REGISTER_RATE_LIMIT.max / 2);
    for (let i = 0; i < half; i++) expect((await register(a, i)).status).toBe(201);
    for (let i = half; i < REGISTER_RATE_LIMIT.max; i++) expect((await register(b, i)).status).toBe(201);
    const blocked = await register(a, 99);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["ratelimit-limit"]).toBe(String(REGISTER_RATE_LIMIT.max));
  });
});
