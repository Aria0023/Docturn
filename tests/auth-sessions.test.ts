import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import speakeasy from "speakeasy";
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

/* ── Credentials that are not a cookie session follow the same rule ──────── */

async function demoToken(username: string, password = DEV_PASSWORD): Promise<supertest.Response> {
  return supertest(ctx.app).post("/api/demo/login").send({ orgCode: "ISPN", username, password });
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

interface TokenSocket extends Socket {
  /** The first frame's type, or "closed:<code>" if the server closes first. */
  first: Promise<string>;
}

function connectToken(token: string): Promise<TokenSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  // Listen from construction so a frame parsed in the same chunk as the
  // handshake cannot slip past.
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

describe("demo bearer tokens are bound to the password generation", () => {
  it("a token minted before a password change is dead afterwards on HTTP and WebSocket; one minted after works", async () => {
    const minted = await demoToken("wu");
    expect(minted.status).toBe(200);
    const token = minted.body.token as string;
    await supertest(ctx.app).get("/api/user").set(bearer(token)).expect(200);
    await supertest(ctx.app).get("/api/patients").set(bearer(token)).expect(200);
    const tokenSock = await connectToken(token);
    expect(await tokenSock.first).toBe("CONNECTION_ESTABLISHED");

    // The owner changes the password from an ordinary cookie session.
    const { agent: owner } = await login(ctx.app, { username: "wu" });
    await owner.patch("/api/account/password").send({ currentPassword: DEV_PASSWORD, newPassword: "Wu-New-Pass-1" }).expect(200);

    // The token's live socket is closed by the server…
    const closed = await tokenSock.closed;
    expect(closed.code).toBe(1008);
    expect(closed.reason).toBe("session_revoked");
    // …and the token is refused everywhere: reads, PHI, a new socket, and
    // "changing the password again" with the new password it overheard.
    await supertest(ctx.app).get("/api/user").set(bearer(token)).expect(401);
    await supertest(ctx.app).get("/api/patients").set(bearer(token)).expect(401);
    await supertest(ctx.app).get(`/api/user?token=${token}`).expect(401);
    const replay = await supertest(ctx.app)
      .patch("/api/account/password")
      .set(bearer(token))
      .send({ currentPassword: "Wu-New-Pass-1", newPassword: "Attacker-Pass-2" });
    expect(replay.status).toBe(401);
    const stale = await connectToken(token);
    expect(await stale.first).toBe("closed:1008");

    // The owner's cookie session is untouched; old password mints nothing; the new one does.
    await owner.get("/api/user").expect(200);
    expect((await demoToken("wu")).status).toBe(401);
    const fresh = await demoToken("wu", "Wu-New-Pass-1");
    expect(fresh.status).toBe(200);
    await supertest(ctx.app).get("/api/user").set(bearer(fresh.body.token)).expect(200);
  });

  it("a change made THROUGH a token keeps that token and its socket, ends the user's other tokens, and never touches a cookie on the same request", async () => {
    const a = (await demoToken("er.doc")).body.token as string;
    const b = (await demoToken("er.doc")).body.token as string;
    const sockA = await connectToken(a);
    const sockB = await connectToken(b);
    expect(await sockA.first).toBe("CONNECTION_ESTABLISHED");
    expect(await sockB.first).toBe("CONNECTION_ESTABLISHED");

    // The demo console shares one cookie per origin: this browser is ALSO
    // signed in as chen. The token wins for the request; chen's cookie
    // session must come out of it still chen.
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const change = await chen
      .patch("/api/account/password")
      .set(bearer(a))
      .send({ currentPassword: DEV_PASSWORD, newPassword: "ErDoc-New-Pass-1" });
    expect(change.status).toBe(200);

    expect((await chen.get("/api/user").expect(200)).body.username).toBe("chen");
    expect((await supertest(ctx.app).get("/api/user").set(bearer(a)).expect(200)).body.username).toBe("er.doc");
    await supertest(ctx.app).get("/api/user").set(bearer(b)).expect(401);
    expect((await sockB.closed).code).toBe(1008);
    expect(await stillOpenAfter(sockA.ws, 300)).toBe(true);
    sockA.ws.close();
  });

  it("a deactivated account's token stops working at once", async () => {
    const t = (await demoToken("er.director")).body.token as string;
    await supertest(ctx.app).get("/api/user").set(bearer(t)).expect(200);
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.post(`/api/accounts/${ctx.seedResult.userIds["er.director"]}/deactivate`).expect(200);
    await supertest(ctx.app).get("/api/user").set(bearer(t)).expect(401);
    const sock = await connectToken(t);
    expect(await sock.first).toBe("closed:1008");
  });
});

describe("a pending MFA sign-in is bound to the password it was started with", () => {
  it("a password change voids a half-finished login: the second factor no longer completes it and is not spent", async () => {
    // chen enrols TOTP from an ordinary session.
    const { agent: owner } = await login(ctx.app, { username: "chen" });
    const enroll = await owner.post("/api/mfa/enroll").expect(200);
    const secret = enroll.body.secret as string;
    const verify = await owner.post("/api/mfa/verify").send({ code: speakeasy.totp({ secret, encoding: "base32" }) }).expect(200);
    const backup = (verify.body.backupCodes as string[])[0]!;

    // An attacker holding the OLD password gets past the first step…
    const attacker = supertest.agent(ctx.app);
    const step1 = await attacker.post("/api/login").send({ orgCode: "ISPN", username: "chen", password: DEV_PASSWORD });
    expect(step1.status).toBe(202);
    expect(step1.body).toEqual({ twoFactorRequired: true });

    // …then the owner changes the password.
    await owner.patch("/api/account/password").send({ currentPassword: DEV_PASSWORD, newPassword: "Chen-New-Pass-1" }).expect(200);

    // The half-finished login is dead: no SMS can be requested for it and a
    // valid second factor does not complete it.
    const sms = await attacker.post("/api/2fa/request-sms");
    expect(sms.status).toBe(401);
    expect(sms.body).toEqual({ error: "no_pending_login" });
    const done = await attacker.post("/api/2fa/complete-login").send({ code: backup });
    expect(done.status).toBe(401);
    expect(done.body).toEqual({ error: "no_pending_login" });
    await attacker.get("/api/user").expect(401);
    await attacker.get("/api/patients").expect(401);
    // Even a fresh TOTP is refused (the pending state was cleared, not left to retry).
    const retry = await attacker.post("/api/2fa/complete-login").send({ code: speakeasy.totp({ secret, encoding: "base32" }) });
    expect(retry.status).toBe(401);

    // The attempt is on the record for the org.
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 100);
    expect(audit.find((r) => r.action === "auth.mfa_pending_revoked" && r.userId === ctx.seedResult.userIds.chen)).toBeTruthy();

    // The backup code was NOT consumed by the refused attempt: the owner can
    // still use it to complete a sign-in with the NEW password.
    const ownerAgain = supertest.agent(ctx.app);
    await ownerAgain.post("/api/login").send({ orgCode: "ISPN", username: "chen", password: "Chen-New-Pass-1" }).expect(202);
    const ok = await ownerAgain.post("/api/2fa/complete-login").send({ code: backup });
    expect(ok.status).toBe(200);
    await ownerAgain.get("/api/patients").expect(200);
  });
});
