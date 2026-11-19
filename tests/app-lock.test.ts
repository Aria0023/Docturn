import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { WebSocket } from "ws";
import type { RequestHandler } from "express";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";
import { attachWebSocket, type WsHub } from "../server/ws/index.js";
import { SESSION_POLICY } from "../server/config.js";

/**
 * The app lock is SERVER-backed (A.CON-SHO-7). The web client's lock screen
 * used to be the only thing standing between a locked tab and the data: the
 * session behind it answered every /api route, deleting one localStorage key
 * and reloading opened the full app, and the tab's background traffic (60 s
 * module poll, WebSocket-driven re-hydrates) renewed the 15-minute rolling
 * session forever. Now:
 *  - POST /api/session/lock marks the SESSION locked; every /api route except
 *    the identity/sign-in ones answers 423 { error: "session_locked" } —
 *    /api/modules included;
 *  - GET /api/user and /api/session still answer, flagged locked, so a reload
 *    lands on the lock screen instead of the app;
 *  - only re-authentication unlocks: a successful POST /api/login replaces the
 *    session; a wrong password leaves it locked;
 *  - a locked session can NOT be kept alive by traffic: it ends at most one
 *    idle window (SESSION_POLICY.maxAgeMs) after it was locked, however often
 *    it is touched meanwhile;
 *  - the session's live sockets are closed (4423 "session_locked") and a
 *    locked session cannot open a new one, so nothing is pushed to it.
 */

let ctx: TestContext;
let server: Server;
let hub: WsHub;
let port: number;

beforeAll(async () => {
  ctx = await createTestApp();
  server = createServer(ctx.app);
  hub = attachWebSocket(server, ctx.app.locals.sessionMiddleware as RequestHandler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  hub.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await ctx.handle.close();
});

afterEach(() => {
  vi.useRealTimers();
});

const MIN = 60 * 1000;

function cookieOf(res: supertest.Response): string {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(raw).split(";")[0]!;
}

function openSocket(cookie: string): Promise<{ ws: WebSocket; established: boolean; closed: Promise<{ code: number; reason: string }> }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
    const closed = new Promise<{ code: number; reason: string }>((r) => {
      ws.on("close", (code, reason) => r({ code, reason: reason.toString() }));
    });
    let settled = false;
    ws.on("message", (data: Buffer) => {
      try {
        if (JSON.parse(data.toString()).type === "CONNECTION_ESTABLISHED" && !settled) {
          settled = true;
          resolve({ ws, established: true, closed });
        }
      } catch {
        /* ignore */
      }
    });
    void closed.then(() => {
      if (!settled) {
        settled = true;
        resolve({ ws, established: false, closed });
      }
    });
  });
}

describe("POST /api/session/lock + the lock gate", () => {
  it("requires a signed-in session", async () => {
    await supertest(ctx.app).post("/api/session/lock").send({}).expect(401);
  });

  it("locks the session: data routes (and /api/modules) answer 423, identity routes say locked", async () => {
    const { agent } = await login(ctx.app, { username: "patel" });
    await agent.get("/api/patients").expect(200);
    const lock = await agent.post("/api/session/lock").send({});
    expect(lock.status).toBe(200);
    expect(lock.body).toMatchObject({ locked: true });

    for (const path of ["/api/patients", "/api/patient-board", "/api/modules", "/api/hospitalists", "/api/messaging/conversations"]) {
      const r = await agent.get(path);
      expect(r.status, path).toBe(423);
      expect(r.body).toEqual({ error: "session_locked" });
    }
    // Writes too.
    const w = await agent.patch("/api/account/password").send({ currentPassword: DEV_PASSWORD, newPassword: "Whatever-Long-1" });
    expect(w.status).toBe(423);

    // Identity routes answer, flagged — a reload must land on the lock screen.
    const me = await agent.get("/api/user").expect(200);
    expect(me.body.username).toBe("patel");
    expect(me.body.locked).toBe(true);
    expect(me.body.orgCode).toBe("ISPN");
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|scrypt/);
    const probe = await agent.get("/api/session").expect(200);
    expect(probe.body.authenticated).toBe(true);
    expect(probe.body.user.locked).toBe(true);
    await agent.get("/api/config").expect(200);

    // Locking again is idempotent.
    await agent.post("/api/session/lock").send({}).expect(200);

    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    expect(audit.some((r) => r.action === "auth.lock")).toBe(true);
  });

  it("is per session: the same user's other session keeps working", async () => {
    const { agent: phone } = await login(ctx.app, { username: "lopez" });
    const { agent: laptop } = await login(ctx.app, { username: "lopez" });
    await phone.post("/api/session/lock").send({}).expect(200);
    await phone.get("/api/patients").expect(423);
    await laptop.get("/api/patients").expect(200);
    expect((await laptop.get("/api/user")).body.locked).toBeUndefined();
  });

  it("only re-authentication unlocks: wrong password stays locked, the right one gives an unlocked session", async () => {
    const { agent } = await login(ctx.app, { username: "liu" });
    await agent.post("/api/session/lock").send({}).expect(200);
    await agent.post("/api/login").send({ orgCode: "ISPN", username: "liu", password: "wrong-password" }).expect(401);
    await agent.get("/api/patients").expect(423);
    // There is no unlock route that skips the password.
    expect((await agent.post("/api/session/unlock").send({})).status).not.toBe(200);
    await agent.get("/api/patients").expect(423);

    const relogin = await agent.post("/api/login").send({ orgCode: "ISPN", username: "liu", password: DEV_PASSWORD });
    expect(relogin.status).toBe(200);
    await agent.get("/api/patients").expect(200);
    expect((await agent.get("/api/user")).body.locked).toBeUndefined();
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    const unlock = audit.find((r) => r.action === "auth.login" && (r.details as { unlock?: boolean } | null)?.unlock === true);
    expect(unlock).toBeTruthy();
  });

  it("a locked session cannot be kept alive by traffic: it ends one idle window after the lock", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    const { agent: locked } = await login(ctx.app, { username: "wu" });
    const { agent: control } = await login(ctx.app, { username: "chen" });
    await locked.post("/api/session/lock").send({}).expect(200);

    // A busy ward: the locked tab is poked every 4 minutes (each poke would
    // roll a normal session's 15-minute expiry) — and so is the control.
    for (const m of [4, 8, 12]) {
      vi.setSystemTime(t0 + m * MIN);
      await locked.get("/api/patients").expect(423);
      await locked.get("/api/user").expect(200);
      await control.get("/api/patients").expect(200);
    }
    vi.setSystemTime(t0 + SESSION_POLICY.maxAgeMs + 1 * MIN);
    // The unlocked control session, touched at minute 12, is alive at 16.
    await control.get("/api/patients").expect(200);
    // The locked one is over, despite the traffic.
    await locked.get("/api/user").expect(401);
    const probe = await locked.get("/api/session").expect(200);
    expect(probe.body).toEqual({ authenticated: false });
    await locked.get("/api/patients").expect(401);
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 80);
    expect(audit.some((r) => r.action === "auth.lock_expired")).toBe(true);
  });

  it("re-locking never extends the window; idleMs back-dates it (an idle auto-lock ends the session at once)", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    const { agent } = await login(ctx.app, { username: "patel" });
    await agent.post("/api/session/lock").send({}).expect(200);
    vi.setSystemTime(t0 + 10 * MIN);
    await agent.post("/api/session/lock").send({}).expect(200);
    vi.setSystemTime(t0 + SESSION_POLICY.maxAgeMs + 30 * 1000);
    await agent.get("/api/user").expect(401);

    vi.useRealTimers();
    const { agent: idle } = await login(ctx.app, { username: "patel" });
    await idle.post("/api/session/lock").send({ idleMs: SESSION_POLICY.maxAgeMs }).expect(200);
    await idle.get("/api/user").expect(401);
    // A bogus idleMs can only shorten, never lengthen.
    const { agent: bogus } = await login(ctx.app, { username: "patel" });
    await bogus.post("/api/session/lock").send({ idleMs: -99 * MIN }).expect(200);
    await bogus.get("/api/user").expect(200);
    await bogus.get("/api/patients").expect(423);
  });

  it("closes the session's live sockets (4423) and refuses new ones; other sessions keep theirs", async () => {
    const lockedRes = await supertest(ctx.app).post("/api/login").send({ orgCode: "ISPN", username: "chen", password: DEV_PASSWORD }).expect(200);
    const otherRes = await supertest(ctx.app).post("/api/login").send({ orgCode: "ISPN", username: "chen", password: DEV_PASSWORD }).expect(200);
    const lockedCookie = cookieOf(lockedRes);
    const otherCookie = cookieOf(otherRes);
    const a = await openSocket(lockedCookie);
    const b = await openSocket(otherCookie);
    expect(a.established).toBe(true);
    expect(b.established).toBe(true);

    await supertest(ctx.app).post("/api/session/lock").set("Cookie", lockedCookie).send({}).expect(200);
    const closed = await a.closed;
    expect(closed.code).toBe(4423);
    expect(closed.reason).toBe("session_locked");
    expect(b.ws.readyState).toBe(WebSocket.OPEN);

    const again = await openSocket(lockedCookie);
    expect(again.established).toBe(false);
    expect((await again.closed).code).toBe(4423);
    b.ws.close();
  });

  it("locks a demo bearer token on its own, leaving the cookie session alone", async () => {
    const tok = await supertest(ctx.app).post("/api/demo/login").send({ orgCode: "ISPN", username: "er.doc", password: DEV_PASSWORD }).expect(200);
    const token = tok.body.token as string;
    const { agent } = await login(ctx.app, { username: "er.doc" });
    await supertest(ctx.app).get("/api/patients").set("Authorization", `Bearer ${token}`).expect(200);
    await supertest(ctx.app).post("/api/session/lock").set("Authorization", `Bearer ${token}`).send({}).expect(200);
    const r = await supertest(ctx.app).get("/api/patients").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(423);
    const me = await supertest(ctx.app).get("/api/user").set("Authorization", `Bearer ${token}`).expect(200);
    expect(me.body.locked).toBe(true);
    await agent.get("/api/patients").expect(200);
  });
});
