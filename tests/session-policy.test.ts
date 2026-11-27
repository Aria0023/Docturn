import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { WebSocket } from "ws";
import type { RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { attachWebSocket, type WsHub } from "../server/ws/index.js";
import { invalidateModules, setModule } from "../server/modules.js";
import { invalidateSessionPolicy, SESSION_POLICY_BOUNDS } from "../server/session-policy.js";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";

/**
 * Per-org session policy + "sign out everywhere" (E2, module
 * `enterprise.sessionPolicy`).
 *
 *   • idle timeout minutes — the cookie the server re-issues on every request
 *     carries the ORG's window, not the platform's 15 minutes;
 *   • absolute maximum session hours — counted from when the session was
 *     first seen, not from the last request, so traffic cannot extend it;
 *   • maximum concurrent sessions per user — the OLDEST is evicted, and the
 *     evicted session is told WHY (401 session_ended, reason max_concurrent)
 *     on HTTP and on the WebSocket upgrade (1008 session_evicted);
 *   • "sign out everywhere" — self-service and a director's action on another
 *     person; it survives the module being switched off afterwards, because
 *     it is a per-user epoch on the user row, not a registry decision.
 */

let ctx: TestContext;
let server: Server;
let hub: WsHub;
let port: number;

beforeEach(async () => {
  ctx = await createTestApp();
  invalidateModules();
  invalidateSessionPolicy();
  server = createServer(ctx.app);
  hub = attachWebSocket(server, ctx.app.locals.sessionMiddleware as RequestHandler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  hub.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await ctx.handle.close();
});

const turnOn = async (orgId = ctx.seedResult.orgId) => {
  await setModule(orgId, "enterprise.sessionPolicy", true);
  invalidateModules();
  invalidateSessionPolicy();
};

/** A fresh signed-in agent whose session cookie we can also use on a socket. */
async function signIn(username: string, orgCode = "ISPN") {
  const agent = supertest.agent(ctx.app);
  const res = await agent.post("/api/login").send({ orgCode, username, password: DEV_PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers["set-cookie"];
  const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(";")[0]!;
  return { agent, cookie };
}

/** Open a socket with that cookie; resolves with its first frame or its close. */
function socketOutcome(cookie: string): Promise<{ frame?: string; code?: number; reason?: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
    const done = (v: { frame?: string; code?: number; reason?: string }) => {
      try { ws.close(); } catch { /* already closing */ }
      resolve(v);
    };
    ws.on("message", (d) => done({ frame: d.toString() }));
    ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    ws.on("error", () => resolve({ code: 0 }));
  });
}

/** A socket that stays open: its `closed` promise is how the server ended it. */
async function liveSocket(cookie: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
  let settle: (v: { code: number; reason: string }) => void = () => {};
  const closed = new Promise<{ code: number; reason: string }>((r) => (settle = r));
  ws.on("close", (code, reason) => settle({ code, reason: reason.toString() }));
  ws.on("error", () => settle({ code: 0, reason: "error" }));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket never established")), 5000);
    ws.on("message", (d) => {
      if (/CONNECTION_ESTABLISHED/.test(d.toString())) { clearTimeout(timer); resolve(); }
    });
    ws.on("close", () => { clearTimeout(timer); reject(new Error("closed before establishing")); });
  });
  return { ws, closed };
}

const cookieMaxAgeMs = (res: supertest.Response): number | null => {
  const raw = res.headers["set-cookie"];
  const header = (Array.isArray(raw) ? raw : [raw]).map(String).find((c) => c.startsWith("docturn.sid="));
  if (!header) return null;
  const m = header.match(/Expires=([^;]+)/i);
  if (!m) return null;
  return new Date(m[1]!).getTime() - Date.now();
};

describe("session policy — the director's card", () => {
  it("is 404 while the module is off, and serves defaults + bounds when on", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const off = await agent.get("/api/org/session-policy");
    expect(off.status).toBe(404);
    expect(off.body).toMatchObject({ error: "module_disabled", module: "enterprise.sessionPolicy" });

    await turnOn();
    const on = await agent.get("/api/org/session-policy").expect(200);
    expect(on.body.stored).toBe(false);
    expect(on.body.policy).toEqual({ idleMinutes: null, maxConcurrent: null, absoluteHours: null });
    // The platform default is today's behaviour: a 15-minute idle timeout.
    expect(on.body.effective).toEqual({ idleMinutes: 15, maxConcurrent: null, absoluteHours: null });
    expect(on.body.limits).toEqual(SESSION_POLICY_BOUNDS);
  });

  it("validates every bound, persists a valid policy and can clear it", async () => {
    await turnOn();
    const { agent } = await login(ctx.app, { username: "director" });
    for (const body of [
      { idleMinutes: 1 },
      { idleMinutes: 10_000 },
      { maxConcurrent: 0 },
      { maxConcurrent: 999 },
      { absoluteHours: 0 },
      { absoluteHours: 10_000 },
      { idleMinutes: "30" },
      { nonsense: true },
    ]) {
      const res = await agent.put("/api/org/session-policy").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const saved = await agent.put("/api/org/session-policy").send({ idleMinutes: 30, maxConcurrent: 2, absoluteHours: 12 }).expect(200);
    expect(saved.body.effective).toEqual({ idleMinutes: 30, maxConcurrent: 2, absoluteHours: 12 });
    expect((await agent.get("/api/org/session-policy").expect(200)).body).toMatchObject({ stored: true });
    const rows = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    expect(rows.some((r) => r.action === "org.session_policy_set")).toBe(true);

    await agent.delete("/api/org/session-policy").expect(200);
    expect((await agent.get("/api/org/session-policy").expect(200)).body.effective).toEqual({ idleMinutes: 15, maxConcurrent: null, absoluteHours: null });
  });

  it("is a director's (or the operator's) setting only", async () => {
    await turnOn();
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    expect((await chen.get("/api/org/session-policy")).status).toBe(403);
    expect((await chen.put("/api/org/session-policy").send({ idleMinutes: 30 })).status).toBe(403);
  });
});

describe("session policy — enforcement", () => {
  it("the re-issued cookie carries the ORG's idle window, not the platform's", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const before = await agent.get("/api/user").expect(200);
    const base = cookieMaxAgeMs(before);
    expect(base).not.toBeNull();
    expect(base!).toBeLessThan(16 * 60_000);

    await turnOn();
    const { agent: dir } = await login(ctx.app, { username: "director" });
    await dir.put("/api/org/session-policy").send({ idleMinutes: 45 }).expect(200);
    invalidateSessionPolicy();
    const after = await agent.get("/api/user").expect(200);
    const widened = cookieMaxAgeMs(after);
    expect(widened!).toBeGreaterThan(40 * 60_000);
    expect(widened!).toBeLessThan(46 * 60_000);
  });

  it("the absolute maximum ends a session however much traffic it had, and says why", async () => {
    await turnOn();
    const { agent: dir } = await login(ctx.app, { username: "director" });
    await dir.put("/api/org/session-policy").send({ absoluteHours: 1 }).expect(200);
    invalidateSessionPolicy();

    const { agent } = await signIn("chen");
    await agent.get("/api/user").expect(200); // registers the session
    // Age the session: the absolute clock is when it was FIRST seen.
    await ctx.handle.db.execute(sql`UPDATE user_sessions SET issued_at = NOW() - INTERVAL '3 hours'`);
    const ended = await agent.get("/api/user");
    expect(ended.status).toBe(401);
    expect(ended.body).toEqual({ error: "session_ended", reason: "absolute_timeout" });
    // The session probe still answers politely (the app is just signed out).
    const probe = await agent.get("/api/session").expect(200);
    expect(probe.body).toEqual({ authenticated: false });
  });

  it("maximum concurrent sessions evicts the OLDEST and tells it why — on HTTP and on the socket", async () => {
    await turnOn();
    const { agent: dir } = await login(ctx.app, { username: "director" });
    await dir.put("/api/org/session-policy").send({ maxConcurrent: 2 }).expect(200);
    invalidateSessionPolicy();

    const first = await signIn("chen");
    await first.agent.get("/api/user").expect(200);
    const second = await signIn("chen");
    await second.agent.get("/api/user").expect(200);
    // Both still good: two is the limit.
    await first.agent.get("/api/user").expect(200);
    expect((await socketOutcome(first.cookie)).frame).toMatch(/CONNECTION_ESTABLISHED/);

    const third = await signIn("chen");
    await third.agent.get("/api/user").expect(200);

    // The evicted session cannot open a socket, and the close says which rule
    // ended it. Checked BEFORE its next HTTP request, which signs it out.
    const sock = await socketOutcome(first.cookie);
    expect(sock.code).toBe(1008);
    expect(sock.reason).toBe("session_evicted");

    const evicted = await first.agent.get("/api/user");
    expect(evicted.status).toBe(401);
    expect(evicted.body).toEqual({ error: "session_ended", reason: "max_concurrent" });
    // The two newest are untouched.
    await second.agent.get("/api/user").expect(200);
    await third.agent.get("/api/user").expect(200);

    const rows = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 100);
    const audited = rows.find((r) => r.action === "auth.session_evicted");
    expect(audited).toBeTruthy();
    expect(audited!.details).toMatchObject({ reason: "max_concurrent", maxConcurrent: 2 });
  });

  it("the app lock counts its deadline in the ORG's window, not the platform's", async () => {
    await turnOn();
    const { agent: dir } = await login(ctx.app, { username: "director" });
    await dir.put("/api/org/session-policy").send({ idleMinutes: 5 }).expect(200);
    invalidateSessionPolicy();

    const { agent } = await signIn("chen");
    await agent.get("/api/user").expect(200);
    // The client back-dates the lock by how long it had already been idle.
    // Clamped to the ORG's 5 minutes, that lock is already expired, so the
    // session is over on its next request (a real automatic logoff).
    await agent.post("/api/session/lock").send({ idleMs: 15 * 60_000 }).expect(200);
    expect((await agent.get("/api/user")).status).toBe(401);

    // With the platform's 15-minute window the same lock would still be live.
    await dir.delete("/api/org/session-policy").expect(200);
    invalidateSessionPolicy();
    const { agent: other } = await signIn("chen");
    await other.get("/api/user").expect(200);
    await other.post("/api/session/lock").send({ idleMs: 5 * 60_000 }).expect(200);
    const locked = await other.get("/api/user");
    expect(locked.status).toBe(200);
    expect(locked.body.locked).toBe(true);
  });

  it("does nothing at all while the module is off", async () => {
    const { agent: dir } = await login(ctx.app, { username: "director" });
    await turnOn();
    await dir.put("/api/org/session-policy").send({ maxConcurrent: 1, absoluteHours: 1 }).expect(200);
    await setModule(ctx.seedResult.orgId, "enterprise.sessionPolicy", false);
    invalidateModules();
    invalidateSessionPolicy();

    const a = await signIn("chen");
    await a.agent.get("/api/user").expect(200);
    const b = await signIn("chen");
    await b.agent.get("/api/user").expect(200);
    // maxConcurrent 1 is NOT enforced with the module off: both live.
    await a.agent.get("/api/user").expect(200);
    const before = cookieMaxAgeMs(await a.agent.get("/api/user"));
    expect(before!).toBeLessThan(16 * 60_000);
  });
});

describe("sign out everywhere", () => {
  it("self-service ends the person's OTHER sessions and keeps this one", async () => {
    await turnOn();
    const mine = await signIn("chen");
    const other = await signIn("chen");
    await other.agent.get("/api/user").expect(200);
    const sock = await liveSocket(other.cookie);

    const res = await mine.agent.post("/api/account/sessions/revoke-all").expect(200);
    expect(res.body).toMatchObject({ ok: true });
    // This session continues…
    await mine.agent.get("/api/user").expect(200);
    // …the other is told why.
    const ended = await other.agent.get("/api/user");
    expect(ended.status).toBe(401);
    expect(ended.body).toEqual({ error: "session_ended", reason: "sign_out_everywhere" });
    const close = await sock.closed;
    expect(close.code).toBe(1008);
    expect(close.reason).toBe("signed_out_everywhere");

    const rows = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    expect(rows.some((r) => r.action === "auth.sign_out_everywhere")).toBe(true);
  });

  it("survives the module being switched off afterwards (it is not a registry decision)", async () => {
    await turnOn();
    const mine = await signIn("chen");
    const other = await signIn("chen");
    await other.agent.get("/api/user").expect(200);
    await mine.agent.post("/api/account/sessions/revoke-all").expect(200);
    await setModule(ctx.seedResult.orgId, "enterprise.sessionPolicy", false);
    invalidateModules();
    invalidateSessionPolicy();
    // Still signed out — with or without a reason, never back in.
    expect((await other.agent.get("/api/user")).status).toBe(401);
    expect((await other.agent.get("/api/session")).body).toEqual({ authenticated: false });
  });

  it("the same browser can sign in again straight away (the dead cookie must not refuse the login)", async () => {
    await turnOn();
    const mine = await signIn("chen");
    const other = await signIn("chen");
    await other.agent.get("/api/user").expect(200);
    await mine.agent.post("/api/account/sessions/revoke-all").expect(200);
    expect((await other.agent.get("/api/user")).status).toBe(401);
    // The SAME agent (still carrying the ended session's cookie) signs in.
    const again = await other.agent.post("/api/login").send({ orgCode: "ISPN", username: "chen", password: DEV_PASSWORD });
    expect(again.status).toBe(200);
    await other.agent.get("/api/user").expect(200);
  });

  it("a director signs another person out everywhere; a clinician cannot, and no tenant can reach another's user", async () => {
    await turnOn();
    const chen = await signIn("chen");
    await chen.agent.get("/api/user").expect(200);
    const chenId = ctx.seedResult.userIds.chen!;

    const { agent: other } = await login(ctx.app, { username: "er.doc" });
    expect((await other.post(`/api/accounts/${chenId}/sessions/revoke-all`)).status).toBe(403);

    const { agent: dir } = await login(ctx.app, { username: "director" });
    const res = await dir.post(`/api/accounts/${chenId}/sessions/revoke-all`).expect(200);
    expect(res.body).toMatchObject({ ok: true });
    expect((await chen.agent.get("/api/user")).status).toBe(401);
    const rows = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    const audited = rows.find((r) => r.action === "auth.sign_out_everywhere" && r.resourceId === chenId);
    expect(audited).toBeTruthy();
    expect(audited!.riskLevel).toBe("medium");

    // Another tenant's user id is an unknown id, not a forbidden one.
    const stranger = await ctx.storage.createOrganization({
      name: "Stranger", code: "STRG", city: null, state: null, timezone: "America/New_York",
      assignmentTimeoutMin: 10, roundRobinShiftTypes: ["day"], rotationMode: "lowest_census", rotationIndex: 0,
    });
    const theirs = await ctx.storage.createUser({
      organizationId: stranger.id, username: "far.away", passwordHash: "x", role: "hospitalist" as never,
      displayName: "Dr. Far Away", credential: null as never, phone: null, twoFactorEnabled: false,
    });
    expect((await dir.post(`/api/accounts/${theirs.id}/sessions/revoke-all`)).status).toBe(404);
  });
});
