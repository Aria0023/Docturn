import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { WebSocket } from "ws";
import type { RequestHandler } from "express";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";
import { attachWebSocket, type WsHub } from "../server/ws/index.js";
import { hashPassword, resolveImpersonator } from "../server/auth.js";

/**
 * A.CON-SHO-16 (final residual) — a developer's impersonated / managed-org
 * session is a session OF THE DEVELOPER as much as of the borrowed account.
 * Before the fix, the developer's own password change (or an administrative
 * reset, or a deactivation) left such a session untouched: it kept reading
 * the borrowed tenant's PHI over HTTP and its live WebSocket, and
 * POST /api/dev/impersonate/stop then turned it back into a full developer
 * (platform root) session stamped with the NEW password generation, because
 * req.session.impersonatorId carried no generation and stop re-ran req.login
 * with the fresh row.
 *
 * Now the borrowed session records the developer's password generation at
 * entry and is resolved against it on every HTTP request, on every socket
 * upgrade and at the way back; a rotation or deactivation of the developer
 * also closes the sockets whose impersonator is that developer.
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

type Agent = ReturnType<typeof supertest.agent>;

function cookieOf(agent: Agent): string {
  const jar = (agent as unknown as { jar: { getCookies: (o: unknown) => Array<{ name: string; value: string }> } }).jar;
  const cookies = jar.getCookies({ domain: "127.0.0.1", path: "/", secure: false, script: false });
  const sid = cookies.find((c) => c.name === "docturn.sid");
  expect(sid, "session cookie present").toBeTruthy();
  return `${sid!.name}=${sid!.value}`;
}

interface Socket {
  ws: WebSocket;
  closed: Promise<{ code: number; reason: string }>;
  /** The first frame's type, or "closed:<code>" if the server closes first. */
  first: Promise<string>;
}

function connect(cookie: string): Promise<Socket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  const first = Promise.race([
    new Promise<string>((resolve) => ws.once("message", (d) => resolve(JSON.parse(d.toString()).type))),
    closed.then((c) => `closed:${c.code}`),
  ]);
  ws.on("error", () => {
    /* close fires too */
  });
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve({ ws, closed, first }));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`unexpected ${res.statusCode}`)));
  });
}

function stillOpenAfter(ws: WebSocket, ms: number): Promise<boolean> {
  return new Promise((resolve) => setTimeout(() => resolve(ws.readyState === WebSocket.OPEN), ms));
}

/** How the server closed the socket, or "still-open" if it did not within `ms`. */
function closedWithin(s: Socket, ms = 3000): Promise<{ code: number; reason: string } | "still-open"> {
  return Promise.race([s.closed, new Promise<"still-open">((resolve) => setTimeout(() => resolve("still-open"), ms))]);
}

const REVOKED = { code: 1008, reason: "session_revoked" };

/** The seeded developer's password as the tests below rotate it. */
let devPassword = DEV_PASSWORD;
const devLogin = (username = "dev", password = devPassword) =>
  login(ctx.app, { orgCode: "DOCTURN", username, password });

/** A further platform developer (created directly — no route mints one). */
async function makeDeveloper(username: string): Promise<number> {
  const row = await ctx.storage.createUser({
    organizationId: ctx.seedResult.platformOrgId,
    username,
    passwordHash: await hashPassword(DEV_PASSWORD),
    role: "developer" as never,
    displayName: `Operator ${username}`,
    credential: null as never,
    phone: null,
    twoFactorEnabled: false,
  });
  return row.id;
}

/** Every way a dead borrowed session could still act — all must be 401. */
async function expectBorrowedSessionDead(s: Agent) {
  await s.get("/api/user").expect(401);
  await s.get("/api/patients").expect(401);
  expect((await s.get("/api/session").expect(200)).body).toEqual({ authenticated: false });
  // The way back to the developer is closed…
  expect((await s.post("/api/dev/impersonate/stop").send({})).status).toBe(401);
  // …and nothing developer-only answers either.
  await s.get("/api/dev/organizations").expect(401);
  await s.get("/api/accounts").expect(401);
  expect((await s.post("/api/dev/impersonate").send({ userId: ctx.seedResult.userIds.chen })).status).toBe(401);
  // Still dead on a second look (nothing was re-stamped by the attempts above).
  await s.get("/api/user").expect(401);
}

describe("a developer's borrowed session is bound to the developer's password generation", () => {
  it("impersonate: the developer's own password change ends the borrowed session, its socket and its way back", async () => {
    const devId = ctx.seedResult.userIds.dev!;
    const wuId = ctx.seedResult.userIds.wu!;

    // wu's OWN session: the developer's password is none of its business.
    const { agent: wu } = await login(ctx.app, { username: "wu" });
    const wuSock = await connect(cookieOf(wu));
    expect(await wuSock.first).toBe("CONNECTION_ESTABLISHED");

    // S1 enters wu's portal with the developer's CURRENT (soon old) password.
    const { agent: s1 } = await devLogin();
    const { agent: s2 } = await devLogin();
    const entered = await s1.post("/api/dev/impersonate").send({ userId: wuId });
    expect(entered.status).toBe(200);
    expect(entered.body.id).toBe(wuId);
    expect((await s1.get("/api/user").expect(200)).body.id).toBe(wuId);
    await s1.get("/api/patients").expect(200);
    const s1Sock = await connect(cookieOf(s1));
    expect(await s1Sock.first).toBe("CONNECTION_ESTABLISHED");

    // S2 (the developer's own session) changes the developer's password.
    const change = await s2
      .patch("/api/account/password")
      .send({ currentPassword: devPassword, newPassword: "Dev-Rotated-Pass-1" });
    expect(change.status).toBe(200);
    const oldPassword = devPassword;
    devPassword = "Dev-Rotated-Pass-1";

    // The borrowed session's live socket is closed by the server…
    expect(await closedWithin(s1Sock)).toEqual(REVOKED);
    // …a NEW socket on that cookie is refused BEFORE any HTTP request has
    // touched the session (the upgrade applies the same rule itself)…
    const reopened = await connect(cookieOf(s1));
    expect(await reopened.first).toBe("closed:1008");
    // …and over HTTP it is neither wu nor (via stop) the developer.
    await expectBorrowedSessionDead(s1);

    // The end of the borrowed session is on wu's org's record, naming the developer.
    const trail = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 200);
    const revoked = trail.find((a) => a.action === "dev.impersonation_revoked" && a.resourceId === wuId);
    expect(revoked, "revocation audited in the borrowed org").toBeTruthy();
    expect(revoked!.userId).toBe(devId);

    // Nothing else was collateral: wu's own session and socket, the
    // developer's changing session.
    expect((await wu.get("/api/user").expect(200)).body.id).toBe(wuId);
    expect(await stillOpenAfter(wuSock.ws, 200)).toBe(true);
    expect((await s2.get("/api/user").expect(200)).body.id).toBe(devId);
    await s2.get("/api/dev/organizations").expect(200);

    // Credentials: the old password is refused; the new one signs in.
    expect((await devLogin("dev", oldPassword)).res.status).toBe(401);
    const { agent: fresh, res } = await devLogin();
    expect(res.status).toBe(200);

    // A portal entered UNDER the new generation still round-trips normally.
    await fresh.post("/api/dev/impersonate").send({ userId: wuId }).expect(200);
    const freshSock = await connect(cookieOf(fresh));
    expect(await freshSock.first).toBe("CONNECTION_ESTABLISHED");
    const back = await fresh.post("/api/dev/impersonate/stop").send({});
    expect(back.status).toBe(200);
    expect(back.body.id).toBe(devId);
    await fresh.get("/api/dev/organizations").expect(200);

    freshSock.ws.close();
    wuSock.ws.close();
  });

  it("manage-org: the same holds for a managed tenant portal", async () => {
    const devId = ctx.seedResult.userIds.dev!;
    const { agent: s1 } = await devLogin();
    const { agent: s2 } = await devLogin();
    const entered = await s1.post("/api/dev/manage-org").send({ orgId: ctx.seedResult.orgId });
    expect(entered.status).toBe(200);
    expect(entered.body.role).toBe("director");
    await s1.get("/api/patients").expect(200);
    await s1.get("/api/accounts").expect(200); // the director's own-org list
    const s1Sock = await connect(cookieOf(s1));
    expect(await s1Sock.first).toBe("CONNECTION_ESTABLISHED");

    await s2
      .patch("/api/account/password")
      .send({ currentPassword: devPassword, newPassword: "Dev-Rotated-Pass-2" })
      .expect(200);
    devPassword = "Dev-Rotated-Pass-2";

    expect(await closedWithin(s1Sock)).toEqual(REVOKED);
    await expectBorrowedSessionDead(s1);
    expect((await s2.get("/api/user").expect(200)).body.id).toBe(devId);
  });

  it("an administrative reset of the developer ends the developer's borrowed sessions", async () => {
    const opId = await makeDeveloper("op.reset");
    const { agent: s1 } = await devLogin("op.reset", DEV_PASSWORD);
    await s1.post("/api/dev/impersonate").send({ userId: ctx.seedResult.userIds.chen }).expect(200);
    await s1.get("/api/patients").expect(200);
    const s1Sock = await connect(cookieOf(s1));
    expect(await s1Sock.first).toBe("CONNECTION_ESTABLISHED");

    // The seeded developer resets the operator's password.
    const { agent: admin } = await devLogin();
    const reset = await admin.post(`/api/accounts/${opId}/reset-password`);
    expect(reset.status).toBe(200);

    expect(await closedWithin(s1Sock)).toEqual(REVOKED);
    await expectBorrowedSessionDead(s1);
    await admin.get("/api/user").expect(200);
  });

  it("deactivating the developer ends the developer's borrowed sessions and its own sockets at once", async () => {
    const opId = await makeDeveloper("op.leaver");
    const { agent: own } = await devLogin("op.leaver", DEV_PASSWORD);
    const ownSock = await connect(cookieOf(own));
    expect(await ownSock.first).toBe("CONNECTION_ESTABLISHED");
    const { agent: s1 } = await devLogin("op.leaver", DEV_PASSWORD);
    await s1.post("/api/dev/manage-org").send({ orgId: ctx.seedResult.orgId }).expect(200);
    await s1.get("/api/patients").expect(200);
    const s1Sock = await connect(cookieOf(s1));
    expect(await s1Sock.first).toBe("CONNECTION_ESTABLISHED");

    // The borrowed account's own session is NOT the leaver's: it stays.
    const { agent: director } = await login(ctx.app, { username: "director" });
    const directorSock = await connect(cookieOf(director));
    expect(await directorSock.first).toBe("CONNECTION_ESTABLISHED");

    const { agent: admin } = await devLogin();
    await admin.post(`/api/accounts/${opId}/deactivate`).expect(200);

    // Both the leaver's own socket and the borrowed portal's socket close now,
    // not on their next reconnect.
    expect(await closedWithin(s1Sock)).toEqual(REVOKED);
    expect(await closedWithin(ownSock)).toEqual(REVOKED);
    await expectBorrowedSessionDead(s1);
    await own.get("/api/user").expect(401);

    await director.get("/api/user").expect(200);
    expect(await stillOpenAfter(directorSock.ws, 200)).toBe(true);
    directorSock.ws.close();
  });

  it("a borrowed session that recorded no developer generation (written before this rule) is not honoured", async () => {
    const devId = ctx.seedResult.userIds.dev!;
    const dev = (await ctx.storage.getUserById(devId))!;
    // Recorded with the generation → honoured.
    const ok = await resolveImpersonator({ impersonatorId: devId, impersonatorPg: dev.passwordChangedAt!.getTime() } as never);
    expect(ok.state).toBe("ok");
    // No generation (a pre-upgrade session), a stale one, or a non-developer → revoked.
    expect((await resolveImpersonator({ impersonatorId: devId } as never)).state).toBe("revoked");
    expect((await resolveImpersonator({ impersonatorId: devId, impersonatorPg: 0 } as never)).state).toBe("revoked");
    const chenId = ctx.seedResult.userIds.chen!;
    expect((await resolveImpersonator({ impersonatorId: chenId, impersonatorPg: 0 } as never)).state).toBe("revoked");
    // Not a borrowed session at all.
    expect((await resolveImpersonator({} as never)).state).toBe("none");
  });
});
