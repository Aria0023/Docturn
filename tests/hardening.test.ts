import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import speakeasy from "speakeasy";
import supertest from "supertest";
import { WebSocket } from "ws";
import type { RequestHandler } from "express";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";
import { createApp } from "../server/app.js";
import { attachWebSocket, type SessionLookup, type WsHub } from "../server/ws/index.js";
import { isAcknowledged } from "../server/services/notifications.js";
import { runExpirySweep } from "../server/services/assignments.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

const dev = () => login(ctx.app, { orgCode: "DOCTURN", username: "dev" });

async function newPatient(agent: supertest.Agent, initials = "ZZ") {
  const res = await agent.post("/api/patients").send({ initials, issueSummary: "test" });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function seededPendingId() {
  const { agent } = await login(ctx.app, { username: "chen" });
  const res = await agent.get("/api/assignments/pending");
  return res.body[0].id as number;
}

describe("request handling", () => {
  it("turns a throwing async handler into a 500 instead of hanging", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    // A foreign-key-violating department id makes the insert reject.
    const res = await agent
      .post("/api/beds")
      .send({ label: "X1", departmentId: 987654 })
      .timeout(5000);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("internal_error");
  });

  it("404s a non-numeric path id and 400s malformed JSON", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const bad = await agent.patch("/api/beds/abc").send({ occupied: true });
    expect(bad.status).toBe(404);

    const json = await agent
      .post("/api/broadcasts")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(json.status).toBe(400);
    expect(json.body.error).toBe("invalid_json");
  });

  it("refuses to boot in production against a real database without SESSION_SECRET", () => {
    const saved = { ...process.env };
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://example.invalid/db";
    delete process.env.SESSION_SECRET;
    try {
      expect(() => createApp({ rateLimiting: false })).toThrow(/SESSION_SECRET/);
    } finally {
      process.env = saved;
    }
  });
});

describe("assignment state machine integrity", () => {
  it("lets exactly one of two simultaneous accepts win and counts census once", async () => {
    const id = await seededPendingId();
    const chen = await login(ctx.app, { username: "chen" });
    const wu = await login(ctx.app, { username: "wu" }); // on-call unit member

    const results = await Promise.all([
      chen.agent.patch(`/api/assignments/${id}/accept`),
      wu.agent.patch(`/api/assignments/${id}/accept`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

    const h = await ctx.storage.getHospitalist(
      ctx.seedResult.orgId,
      ctx.seedResult.hospitalistIds.chen!,
    );
    expect(h!.currentPatientCount).toBe(1);
  });

  it("rejects a second active assignment for the same patient", async () => {
    const { agent } = await login(ctx.app, { username: "er.doc" });
    const res = await agent
      .post("/api/assignments")
      .send({ patientId: ctx.seedResult.patientIds.sc, mode: "round_robin" });
    expect(res.status).toBe(409);
  });

  it("leaves an accepted assignment untouched when reassigned to an unknown provider", async () => {
    const id = await seededPendingId();
    const chen = await login(ctx.app, { username: "chen" });
    await chen.agent.patch(`/api/assignments/${id}/accept`);

    const director = await login(ctx.app, { username: "director" });
    const res = await director.agent
      .patch(`/api/assignments/${id}/reassign`)
      .send({ hospitalistId: 987654 });
    expect(res.status).toBe(404);

    const a = await ctx.storage.getAssignment(ctx.seedResult.orgId, id);
    expect(a!.status).toBe("accepted");
    const h = await ctx.storage.getHospitalist(
      ctx.seedResult.orgId,
      ctx.seedResult.hospitalistIds.chen!,
    );
    expect(h!.currentPatientCount).toBe(1);
  });

  it("will not cancel an assignment that is already resolved", async () => {
    const id = await seededPendingId();
    const chen = await login(ctx.app, { username: "chen" });
    await chen.agent.patch(`/api/assignments/${id}/reject`);

    const director = await login(ctx.app, { username: "director" });
    const res = await director.agent.patch(`/api/assignments/${id}/cancel`);
    expect(res.status).toBe(409);
    const a = await ctx.storage.getAssignment(ctx.seedResult.orgId, id);
    expect(a!.status).toBe("rejected");
  });

  it("does not expire an assignment that was accepted before the sweep ran", async () => {
    const id = await seededPendingId();
    const chen = await login(ctx.app, { username: "chen" });
    await chen.agent.patch(`/api/assignments/${id}/accept`);

    // Far-future "now": the row is past its expiry but no longer pending.
    const out = await runExpirySweep(ctx.storage, new Date(Date.now() + 3600_000));
    expect(out.expired).toBe(0);
    const a = await ctx.storage.getAssignment(ctx.seedResult.orgId, id);
    expect(a!.status).toBe("accepted");
  });

  it("stops the escalation clock as soon as the provider accepts", async () => {
    const er = await login(ctx.app, { username: "er.doc" });
    const patientId = await newPatient(er.agent);
    const created = await er.agent
      .post("/api/assignments")
      .send({ patientId, mode: "manual", hospitalistId: ctx.seedResult.hospitalistIds.chen });
    expect(created.status).toBe(201);
    expect(isAcknowledged(created.body.id)).toBe(false);

    const chen = await login(ctx.app, { username: "chen" });
    await chen.agent.patch(`/api/assignments/${created.body.id}/accept`);
    expect(isAcknowledged(created.body.id)).toBe(true);
  });
});

describe("authentication controls", () => {
  it("locks an account after repeated failures and audits every attempt", async () => {
    const attempt = (password: string) =>
      supertest(ctx.app)
        .post("/api/login")
        .send({ orgCode: "ISPN", username: "liu", password });

    for (let i = 0; i < 5; i++) {
      expect((await attempt("wrong-password")).status).toBe(401);
    }
    // Even the right password is refused while locked.
    const locked = await attempt(DEV_PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe("account_locked");

    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 100);
    expect(audit.filter((a) => a.action === "auth.login_failed")).toHaveLength(5);
    expect(audit.some((a) => a.action === "security.account_locked" && a.riskLevel === "high")).toBe(true);
  });

  it("audits logout", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    expect((await agent.post("/api/logout")).status).toBe(204);
    expect((await agent.get("/api/user")).status).toBe(401);
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 100);
    expect(audit.some((a) => a.action === "auth.logout")).toBe(true);
  });

  it("refuses to re-enroll over an active second factor", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const enroll = await agent.post("/api/mfa/enroll");
    const code = speakeasy.totp({ secret: enroll.body.secret, encoding: "base32" });
    expect((await agent.post("/api/mfa/verify").send({ code })).status).toBe(200);

    const again = await agent.post("/api/mfa/enroll");
    expect(again.status).toBe(409);
    // The working secret is still the one on file.
    const cred = await ctx.storage.getMfaCredential(ctx.seedResult.userIds.chen!);
    expect(cred!.secret).toBe(enroll.body.secret);
    expect(cred!.activated).toBe(true);
  });

  it("discards a pending login after five wrong second-factor codes", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const enroll = await agent.post("/api/mfa/enroll");
    const secret = enroll.body.secret as string;
    await agent
      .post("/api/mfa/verify")
      .send({ code: speakeasy.totp({ secret, encoding: "base32" }) });

    const pending = supertest.agent(ctx.app);
    const first = await pending
      .post("/api/login")
      .send({ orgCode: "ISPN", username: "chen", password: DEV_PASSWORD });
    expect(first.status).toBe(202);
    for (let i = 0; i < 5; i++) {
      const bad = await pending.post("/api/2fa/complete-login").send({ code: "000000" });
      expect(bad.status).toBe(401);
    }
    // A correct code no longer helps — the password step must be redone.
    const late = await pending
      .post("/api/2fa/complete-login")
      .send({ code: speakeasy.totp({ secret, encoding: "base32" }) });
    expect(late.status).toBe(401);
    expect(late.body.error).toBe("no_pending_login");

    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 100);
    expect(audit.filter((a) => a.action === "mfa.failed")).toHaveLength(5);
  });

  it("stops an ER director approving a director-level registration", async () => {
    const reg = await supertest(ctx.app).post("/api/register").send({
      orgCode: "ISPN",
      username: "newboss",
      password: "s3cret-pass",
      displayName: "New Boss",
      requestedRole: "director",
    });
    expect(reg.status).toBe(201);

    const erDirector = await login(ctx.app, { username: "er.director" });
    const list = await erDirector.agent.get("/api/registrations");
    const id = list.body[0].id as number;
    expect((await erDirector.agent.post(`/api/registrations/${id}/approve`)).status).toBe(403);

    const director = await login(ctx.app, { username: "director" });
    expect((await director.agent.post(`/api/registrations/${id}/approve`)).status).toBe(201);
  });
});

describe("audit trail integrity", () => {
  it("keeps the developer's identity on rows written while impersonating", async () => {
    const { agent } = await dev();
    const devId = ctx.seedResult.userIds.dev!;
    const swap = await agent
      .post("/api/dev/impersonate")
      .send({ userId: ctx.seedResult.userIds.director });
    expect(swap.status).toBe(200);

    expect((await agent.get("/api/patients")).status).toBe(200);
    const made = await agent.post("/api/broadcasts").send({ message: "drill" });
    expect(made.status).toBe(201);

    const phi = await ctx.storage.listPhiAccess(ctx.seedResult.orgId, 50);
    expect(phi.some((p) => p.resource === `patients (impersonated by user #${devId})`)).toBe(true);

    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 100);
    const row = audit.find((a) => a.action === "broadcast.create");
    expect(row!.userId).toBe(ctx.seedResult.userIds.director);
    expect((row!.details as Record<string, unknown>).impersonatedBy).toBe(devId);
  });

  it("logs PHI access for message threads and intake extraction", async () => {
    const chen = await login(ctx.app, { username: "chen" });
    const convo = await chen.agent
      .post("/api/messaging/conversations")
      .send({ participantIds: [ctx.seedResult.userIds["er.doc"]] });
    await chen.agent
      .post("/api/messaging/send")
      .send({ conversationId: convo.body.id, content: "pt in 204 stable" });
    await chen.agent.get(`/api/messaging/conversations/${convo.body.id}/messages`);

    const er = await login(ctx.app, { username: "er.doc" });
    await er.agent.post("/api/patients/extract").send({ note: "Patient J.D. room 204 chest pain" });

    const phi = await ctx.storage.listPhiAccess(ctx.seedResult.orgId, 50);
    expect(phi.filter((p) => p.resource === "messages")).toHaveLength(2);
    expect(phi.some((p) => p.resource === "patients/extract")).toBe(true);
  });
});

describe("input validation on destructive / config routes", () => {
  it("does not treat a null retention window as 'clear everything'", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const res = await agent.post("/api/maintenance/purge").send({ olderThanHours: null });
    expect(res.status).toBe(400);
    expect(await ctx.storage.listPatients(ctx.seedResult.orgId)).toHaveLength(1);
  });

  it("only accepts known org-setting keys", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const bad = await agent.patch("/api/settings/org").send({ key: "anything", value: 1 });
    expect(bad.status).toBe(400);
    const ok = await agent
      .patch("/api/settings/org")
      .send({ key: "autoReassignOnDecline", value: true });
    expect(ok.status).toBe(200);
  });

  it("rejects a consultant who belongs to another organization", async () => {
    const { agent } = await login(ctx.app, { username: "er.doc" });
    const res = await agent
      .post(`/api/patients/${ctx.seedResult.patientIds.sc}/consults`)
      .send({ specialty: "Neurology", consultantUserId: ctx.seedResult.userIds.dev });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("consultant_not_in_org");
  });

  it("moves a re-registered device token to the new owner's organization", async () => {
    const devId = ctx.seedResult.userIds.dev!;
    await ctx.storage.upsertDeviceToken({
      organizationId: ctx.seedResult.orgId,
      userId: ctx.seedResult.userIds.chen!,
      token: "tok-1",
      platform: "ios",
    });
    await ctx.storage.upsertDeviceToken({
      organizationId: ctx.seedResult.platformOrgId,
      userId: devId,
      token: "tok-1",
      platform: "ios",
    });
    const [row] = await ctx.storage.listDeviceTokens(devId);
    expect(row!.organizationId).toBe(ctx.seedResult.platformOrgId);
  });
});

describe("realtime channel", () => {
  let server: Server;
  let hub: WsHub;
  let port: number;

  beforeEach(async () => {
    server = createServer(ctx.app);
    hub = attachWebSocket(
      server,
      ctx.app.locals.sessionMiddleware as RequestHandler,
      ctx.app.locals.sessionStore as SessionLookup,
    );
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    hub.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function open(cookie: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
    const messages: any[] = [];
    ws.on("message", (d: Buffer) => messages.push(JSON.parse(d.toString())));
    const ready = new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
    return { ws, messages, ready, closed };
  }
  const cookieOf = (res: supertest.Response) =>
    String((res.headers["set-cookie"] as unknown as string[])[0]).split(";")[0]!;
  const settle = () => new Promise((r) => setTimeout(r, 150));

  it("never relays a typing event to a user in another tenant", async () => {
    const chen = await login(ctx.app, { username: "chen" });
    const liu = await login(ctx.app, { username: "liu" });
    const platform = await dev();
    const sender = open(cookieOf(chen.res));
    const sameOrg = open(cookieOf(liu.res));
    const otherOrg = open(cookieOf(platform.res));
    await Promise.all([sender.ready, sameOrg.ready, otherOrg.ready]);
    await settle();

    sender.ws.send(
      JSON.stringify({
        type: "typing_start",
        conversationId: 1,
        participantIds: [ctx.seedResult.userIds.liu, ctx.seedResult.userIds.dev],
      }),
    );
    await settle();

    expect(sameOrg.messages.some((m) => m.type === "user_typing")).toBe(true);
    expect(otherOrg.messages.some((m) => m.type === "user_typing")).toBe(false);
    for (const c of [sender, sameOrg, otherOrg]) c.ws.close();
  });

  it("closes a user's sockets when they log out", async () => {
    const chen = await login(ctx.app, { username: "chen" });
    const sock = open(cookieOf(chen.res));
    await sock.ready;
    await settle();

    await chen.agent.post("/api/logout");
    expect(await sock.closed).toBe(4401);
  });
});
