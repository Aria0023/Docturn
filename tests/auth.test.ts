import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createTestApp, login, type TestContext } from "./helpers.js";

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
    expect(res.body).toEqual({ ok: true, db: "up" });
  });
});
