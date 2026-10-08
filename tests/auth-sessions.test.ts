import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { WebSocket } from "ws";
import type { RequestHandler } from "express";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";
import { attachWebSocket, type WsHub } from "../server/ws/index.js";

/**
 * A.CON-SHO-16 — a password change (self-service) or an administrative reset
 * ends every OTHER session of that user: HTTP sessions stop deserialising on
 * their next request, live WebSockets are closed, and a stale cookie can no
 * longer open a socket. The session that made the change continues.
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

function cookieOf(agent: ReturnType<typeof supertest.agent>): string {
  // supertest keeps the jar on the agent; read the docturn.sid cookie back out.
  const jar = (agent as unknown as { jar: { getCookies: (o: unknown) => Array<{ name: string; value: string }> } }).jar;
  const cookies = jar.getCookies({ domain: "127.0.0.1", path: "/", secure: false, script: false });
  const sid = cookies.find((c) => c.name === "docturn.sid");
  expect(sid, "session cookie present").toBeTruthy();
  return `${sid!.name}=${sid!.value}`;
}

interface Socket {
  ws: WebSocket;
  closed: Promise<{ code: number; reason: string }>;
}

function connect(cookie: string): Promise<Socket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  ws.on("error", () => {
    /* close fires too */
  });
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve({ ws, closed }));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`unexpected ${res.statusCode}`)));
  });
}

function stillOpenAfter(ws: WebSocket, ms: number): Promise<boolean> {
  return new Promise((resolve) => setTimeout(() => resolve(ws.readyState === WebSocket.OPEN), ms));
}

describe("password change ends the user's other sessions", () => {
  it("self-service change: other HTTP session 401s, its socket closes 1008, the changer keeps working", async () => {
    const { agent: phone } = await login(ctx.app, { username: "patel" });
    const { agent: laptop } = await login(ctx.app, { username: "patel" });
    await phone.get("/api/user").expect(200);
    await laptop.get("/api/user").expect(200);

    const phoneSock = await connect(cookieOf(phone));
    const laptopSock = await connect(cookieOf(laptop));

    const change = await laptop
      .patch("/api/account/password")
      .send({ currentPassword: DEV_PASSWORD, newPassword: "Patel-New-Pass-1" });
    expect(change.status).toBe(200);

    // The other device: HTTP dead on its very next request, socket closed by the server.
    await phone.get("/api/user").expect(401);
    expect((await phone.get("/api/hospitalists")).status).toBe(401);
    const closed = await phoneSock.closed;
    expect(closed.code).toBe(1008);
    expect(closed.reason).toBe("session_revoked");
    // Re-opening a socket with the stale cookie is refused outright.
    const stale = await connect(cookieOf(phone));
    expect((await stale.closed).code).toBe(1008);

    // The device that changed the password continues: HTTP and the live socket.
    await laptop.get("/api/user").expect(200);
    await laptop.get("/api/hospitalists").expect(200);
    expect(await stillOpenAfter(laptopSock.ws, 300)).toBe(true);

    // Credentials: old password refused, new one signs in, and that new session works.
    expect((await login(ctx.app, { username: "patel", password: DEV_PASSWORD })).res.status).toBe(401);
    const fresh = await login(ctx.app, { username: "patel", password: "Patel-New-Pass-1" });
    expect(fresh.res.status).toBe(200);
    await fresh.agent.get("/api/user").expect(200);

    // The stale session cannot even "change the password again" (it held the old one).
    const replay = await phone
      .patch("/api/account/password")
      .send({ currentPassword: DEV_PASSWORD, newPassword: "Attacker-Pass-1" });
    expect(replay.status).toBe(401);

    const row = (await ctx.storage.getUserById(ctx.seedResult.userIds.patel!))!;
    expect(row.passwordChangedAt).toBeInstanceOf(Date);
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    expect(audit.find((a) => a.action === "auth.password_change" && a.userId === row.id)).toBeTruthy();

    laptopSock.ws.close();
  });

  it("administrative reset: every session and socket of the target ends; the one-time password signs in gated", async () => {
    const { agent: tabA } = await login(ctx.app, { username: "lopez" });
    const { agent: tabB } = await login(ctx.app, { username: "lopez" });
    const sockA = await connect(cookieOf(tabA));
    const sockB = await connect(cookieOf(tabB));

    const { agent: director } = await login(ctx.app, { username: "director" });
    const reset = await director.post(`/api/accounts/${ctx.seedResult.userIds.lopez}/reset-password`).expect(200);
    expect(typeof reset.body.temporaryPassword).toBe("string");

    await tabA.get("/api/user").expect(401);
    await tabB.get("/api/user").expect(401);
    expect((await sockA.closed).code).toBe(1008);
    expect((await sockB.closed).code).toBe(1008);
    // The director's own session is untouched.
    await director.get("/api/user").expect(200);

    expect((await login(ctx.app, { username: "lopez", password: DEV_PASSWORD })).res.status).toBe(401);
    const { agent: lopez, res } = await login(ctx.app, { username: "lopez", password: reset.body.temporaryPassword });
    expect(res.status).toBe(200);
    expect((await lopez.get("/api/user")).body.mustChangePassword).toBe(true);
    // A socket opened by the NEW session is accepted.
    const sock = await connect(cookieOf(lopez));
    expect(await stillOpenAfter(sock.ws, 200)).toBe(true);
    sock.ws.close();
  });

  it("a session issued before a change, then the same user signing in again, is still dead (generation, not recency)", async () => {
    const { agent: old } = await login(ctx.app, { username: "liu" });
    const { agent: changer } = await login(ctx.app, { username: "liu" });
    await changer.patch("/api/account/password").send({ currentPassword: DEV_PASSWORD, newPassword: "Liu-Rotated-Pass-1" }).expect(200);
    const { agent: newer } = await login(ctx.app, { username: "liu", password: "Liu-Rotated-Pass-1" });
    await newer.get("/api/user").expect(200);
    await changer.get("/api/user").expect(200);
    await old.get("/api/user").expect(401);
    // Changing it back does not resurrect the old session either.
    await newer.patch("/api/account/password").send({ currentPassword: "Liu-Rotated-Pass-1", newPassword: "Liu-Rotated-Pass-2" }).expect(200);
    await old.get("/api/user").expect(401);
    await changer.get("/api/user").expect(401); // it is now an "other" session of the second change
    await newer.get("/api/user").expect(200);
  });
});
