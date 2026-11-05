import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { isValidRequestId } from "../server/request-id.js";

/**
 * E1 — a request id on every request (docs/ENTERPRISE_READINESS.md): echoed as
 * X-Request-Id, carried in every error body the central error middleware
 * answers, and on that middleware's log line — never PHI, never the database's
 * error text.
 */

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.handle.close();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("request id", () => {
  it("every response carries a fresh X-Request-Id (a UUID) when the caller sent none", async () => {
    const a = await supertest(ctx.app).get("/api/health").expect(200);
    const b = await supertest(ctx.app).get("/api/health").expect(200);
    expect(a.headers["x-request-id"]).toMatch(UUID);
    expect(b.headers["x-request-id"]).toMatch(UUID);
    expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
    // Static and 404 paths too — the id is assigned before anything else.
    const nf = await supertest(ctx.app).get("/api/nope").expect(404);
    expect(nf.headers["x-request-id"]).toMatch(UUID);
    const idx = await supertest(ctx.app).get("/").expect(200);
    expect(idx.headers["x-request-id"]).toMatch(UUID);
  });

  it("a caller's (proxy's) id is honoured when it is a plain token, replaced otherwise", async () => {
    const ok = await supertest(ctx.app).get("/api/health").set("X-Request-Id", "caddy-7f3a2b1c.9").expect(200);
    expect(ok.headers["x-request-id"]).toBe("caddy-7f3a2b1c.9");
    for (const bad of ["short", "has space here", "x".repeat(129), "tab\there-is-a-tab"]) {
      const res = await supertest(ctx.app).get("/api/health").set("X-Request-Id", bad).expect(200);
      expect(res.headers["x-request-id"], bad).not.toBe(bad);
      expect(res.headers["x-request-id"], bad).toMatch(UUID);
    }
    expect(isValidRequestId("abcdefgh")).toBe(true);
    expect(isValidRequestId("abc")).toBe(false);
    expect(isValidRequestId("has newline\n")).toBe(false);
  });

  it("an error body from the central middleware carries the same id as the header, and so does its log line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await supertest(ctx.app)
        .post("/api/login")
        .set("Content-Type", "application/json")
        .set("X-Request-Id", "req-abc123456")
        .send("{not json");
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "invalid_json", requestId: "req-abc123456" });
      expect(res.headers["x-request-id"]).toBe("req-abc123456");
      const line = warn.mock.calls.find((c) => c[0] === "[warn]");
      expect(line, "no [warn] log line").toBeTruthy();
      expect(JSON.stringify(line)).toContain("req-abc123456");
      // The line names the classification only — never the body it refused.
      expect(JSON.stringify(line)).not.toContain("not json");
    } finally {
      warn.mockRestore();
    }
  });

  it("a NUL-byte refusal (validation_error) and an unknown route keep their shape plus the id", async () => {
    const { agent } = await login(ctx.app, { username: "er.doc" });
    const nul = await agent.post("/api/patients").send({ initials: "A\u0000B", issueSummary: "x" });
    expect(nul.status).toBe(400);
    expect(nul.body).toEqual({ error: "validation_error", requestId: nul.headers["x-request-id"] });
    const probe = await agent.get("/api/user").expect(200);
    expect(probe.headers["x-request-id"]).toMatch(UUID);
    expect(probe.body).not.toHaveProperty("requestId"); // success bodies are untouched
  });
});
