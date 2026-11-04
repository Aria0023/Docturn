import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestHandler } from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { WebSocket } from "ws";
import { createApp } from "../server/app.js";
import { _resetSessionsRevokedCache } from "../server/auth.js";
import { createDb, createTestDb, setHandle, type DbHandle } from "../server/db.js";
import { DatabaseStorage, setStorage } from "../server/storage.js";
import { seed, DEV_PASSWORD } from "../server/seed.js";
import { configureNotifications, NoopPush, _resetAcks } from "../server/services/notifications.js";
import { ConsoleSms } from "../server/services/sms.js";
import { _resetConfigCache } from "../server/config.js";
import { attachWebSocket, type WsHub } from "../server/ws/index.js";
import {
  InProcessBus,
  PostgresBus,
  decodePayload,
  encodeFrame,
  frameResolverTypes,
  registerFrameResolver,
  type RealtimeBus,
} from "../server/services/bus.js";

/**
 * E1 multi-instance safety — the realtime bus (docs/ENTERPRISE_READINESS.md).
 *
 * A frame fanned out on one instance must reach the sockets of every
 * instance, and so must session control (revocation, lock). Two instances
 * are two HTTP servers + two WebSocket hubs on one Express app (one database,
 * one session store), connected by:
 *   - the in-process transport on a shared channel (always runs — a faithful
 *     fake cluster that applies the same payload cap), and
 *   - Postgres LISTEN / NOTIFY against a REAL Postgres when PG_TEST_URL is
 *     set (scripts/multi-instance-check.mjs proves the same with two real
 *     processes).
 */

const PG_TEST_URL = process.env.PG_TEST_URL;

interface TestClient {
  ws: WebSocket;
  buffer: any[];
  waitFor(pred: (m: any) => boolean, ms?: number): Promise<any>;
  closed(): Promise<{ code: number; reason: string }>;
  close(): void;
}

function connect(port: number, cookie: string): Promise<TestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
  const buffer: any[] = [];
  const waiters: Array<{ pred: (m: any) => boolean; resolve: (m: any) => void }> = [];
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() })),
  );
  ws.on("message", (data: Buffer) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    buffer.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.pred(msg)) {
        waiters[i]!.resolve(msg);
        waiters.splice(i, 1);
      }
    }
  });
  const client: TestClient = {
    ws,
    buffer,
    waitFor(pred, ms = 4000) {
      const hit = buffer.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timed out waiting for frame")), ms);
        waiters.push({
          pred,
          resolve: (m) => {
            clearTimeout(t);
            resolve(m);
          },
        });
      });
    },
    closed: () => closed,
    close: () => ws.close(),
  };
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(client));
    ws.once("error", reject);
  });
}

interface Cluster {
  app: ReturnType<typeof createApp>;
  handle: DbHandle;
  storage: DatabaseStorage;
  seedResult: Awaited<ReturnType<typeof seed>>;
  a: { server: Server; hub: WsHub; port: number; bus: RealtimeBus };
  b: { server: Server; hub: WsHub; port: number; bus: RealtimeBus };
  close(): Promise<void>;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

/** Two instances of one app, joined by the given pair of buses. */
async function cluster(
  handle: DbHandle,
  buses: [RealtimeBus, RealtimeBus],
  opts: { databaseUrl?: string } = {},
): Promise<Cluster> {
  setHandle(handle);
  const storage = new DatabaseStorage(handle.db);
  setStorage(storage);
  _resetAcks();
  _resetConfigCache();
  _resetSessionsRevokedCache();
  configureNotifications({ push: new NoopPush(), smsFor: () => new ConsoleSms() });
  const seedResult = await seed(storage);
  const savedUrl = process.env.DATABASE_URL;
  if (opts.databaseUrl) process.env.DATABASE_URL = opts.databaseUrl;
  else delete process.env.DATABASE_URL;
  let app: ReturnType<typeof createApp>;
  try {
    app = createApp({ sessionSecret: "test-secret", rateLimiting: false });
  } finally {
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
  }
  const mw = app.locals.sessionMiddleware as RequestHandler;
  const serverA = createServer(app);
  const serverB = createServer(app);
  const hubA = attachWebSocket(serverA, mw, { bus: buses[0] });
  const hubB = attachWebSocket(serverB, mw, { bus: buses[1] });
  // Routes fan out through whichever hub was attached last; make it A so a
  // write on "instance A" is the one that must cross to B.
  configureNotifications({ ws: hubA });
  const portA = await listen(serverA);
  const portB = await listen(serverB);
  return {
    app,
    handle,
    storage,
    seedResult,
    a: { server: serverA, hub: hubA, port: portA, bus: buses[0] },
    b: { server: serverB, hub: hubB, port: portB, bus: buses[1] },
    async close() {
      hubA.close();
      hubB.close();
      await buses[0].close();
      await buses[1].close();
      await new Promise<void>((r) => serverA.close(() => r()));
      await new Promise<void>((r) => serverB.close(() => r()));
    },
  };
}

async function loginCookie(app: Cluster["app"], username: string, orgCode = "ISPN"): Promise<string> {
  const res = await supertest(app).post("/api/login").send({ orgCode, username, password: DEV_PASSWORD });
  expect(res.status).toBe(200);
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(raw).split(";")[0]!;
}

/** The cross-instance behaviours every transport must show. */
function crossInstanceSuite(get: () => Cluster) {
  it("a message sent through instance A reaches a socket held by instance B (and typing relays cross too)", async () => {
    const c = get();
    const chen = await loginCookie(c.app, "chen");
    const er = await loginCookie(c.app, "er.doc");
    const onB = await connect(c.b.port, chen);
    await onB.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");
    const convo = await supertest(c.app)
      .post("/api/messaging/conversations")
      .set("Cookie", er)
      .send({ type: "direct", participantIds: [c.seedResult.userIds.chen] })
      .expect(201);
    await supertest(c.app)
      .post("/api/messaging/send")
      .set("Cookie", er)
      .send({ conversationId: convo.body.id, content: "crossing instances", priority: "routine" })
      .expect(201);
    const frame = await onB.waitFor((m) => m.type === "MESSAGE_RECEIVED");
    expect(frame.message.content).toBe("crossing instances");
    expect(frame.message.conversationId).toBe(convo.body.id);
    expect(c.a.bus.status().published).toBeGreaterThanOrEqual(1);
    expect(c.b.bus.status().received).toBeGreaterThanOrEqual(1);

    // Typing: er.doc's socket on A relays to chen's socket on B.
    const erOnA = await connect(c.a.port, er);
    await erOnA.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");
    erOnA.ws.send(JSON.stringify({ type: "typing_start", conversationId: convo.body.id }));
    const typing = await onB.waitFor((m) => m.type === "user_typing" && m.typing === true);
    expect(typing.userId).toBe(c.seedResult.userIds["er.doc"]);
    erOnA.close();
    onB.close();
  });

  it("a frame over the NOTIFY payload cap travels by reference and is rebuilt in full on instance B", async () => {
    const c = get();
    const chen = await loginCookie(c.app, "chen");
    const er = await loginCookie(c.app, "er.doc");
    const onB = await connect(c.b.port, chen);
    await onB.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");
    const convo = await supertest(c.app)
      .post("/api/messaging/conversations")
      .set("Cookie", er)
      .send({ type: "direct", participantIds: [c.seedResult.userIds.chen] })
      .expect(201);
    const long = "handoff note ".repeat(800); // ≈ 10 KB, past the 7 KB cap
    const before = c.a.bus.status().byReference;
    const sent = await supertest(c.app)
      .post("/api/messaging/send")
      .set("Cookie", er)
      .send({ conversationId: convo.body.id, content: long, priority: "urgent" })
      .expect(201);
    const frame = await onB.waitFor((m) => m.type === "MESSAGE_RECEIVED" && m.message.id === sent.body.id);
    expect(frame.message.content).toBe(long);
    expect(frame.message.priority).toBe("urgent");
    // Rebuilt like the thread view: delivery rows and attachment metadata included.
    expect(Array.isArray(frame.message.deliveries)).toBe(true);
    expect(frame.message.deliveries.map((d: any) => d.userId)).toEqual([c.seedResult.userIds.chen]);
    expect(c.a.bus.status().byReference).toBe(before + 1);
    expect(c.a.bus.status().dropped).toBe(0);
    onB.close();
  });

  it("an org broadcast past the cap is rebuilt by reference too, with its recipient flag", async () => {
    const c = get();
    const chen = await loginCookie(c.app, "chen");
    const director = await loginCookie(c.app, "director");
    const onB = await connect(c.b.port, chen);
    await onB.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");
    const text = "Code triage drill ".repeat(600);
    const created = await supertest(c.app)
      .post("/api/broadcasts")
      .set("Cookie", director)
      .send({ message: text, severity: "critical" })
      .expect(201);
    const frame = await onB.waitFor((m) => m.type === "BROADCAST_CREATED" && m.broadcast.id === created.body.id);
    expect(frame.broadcast.message).toBe(text);
    expect(frame.broadcast.recipient).toBe(true);
    expect(frame.broadcast.ackRequired).toBe(true);
    expect(frame.broadcast.senderName).toBeTruthy();
    expect(c.a.bus.status().dropped).toBe(0);
    onB.close();
  });

  it("a password change on instance A closes that person's socket on instance B (1008 session_revoked) and spares the changing session", async () => {
    const c = get();
    const lopezOld = await loginCookie(c.app, "lopez");
    const lopezNew = await loginCookie(c.app, "lopez");
    const onB = await connect(c.b.port, lopezOld);
    await onB.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");
    const keep = await connect(c.b.port, lopezNew);
    await keep.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");
    await supertest(c.app)
      .patch("/api/account/password")
      .set("Cookie", lopezNew)
      .send({ currentPassword: DEV_PASSWORD, newPassword: "Rotated-Pass-2026!" })
      .expect(200);
    const closed = await onB.closed();
    expect(closed).toEqual({ code: 1008, reason: "session_revoked" });
    // The session that made the change keeps its socket — on every instance.
    await new Promise((r) => setTimeout(r, 200));
    expect(keep.ws.readyState).toBe(WebSocket.OPEN);
    keep.close();
  });

  it("an account deactivated on instance A loses its socket on instance B; a lock on A closes B's socket with 4423", async () => {
    const c = get();
    const director = await loginCookie(c.app, "director");
    const liu = await loginCookie(c.app, "liu");
    const liuOnB = await connect(c.b.port, liu);
    await liuOnB.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");
    await supertest(c.app)
      .post(`/api/accounts/${c.seedResult.userIds.liu}/deactivate`)
      .set("Cookie", director)
      .send({})
      .expect(200);
    expect(await liuOnB.closed()).toEqual({ code: 1008, reason: "session_revoked" });

    const wu = await loginCookie(c.app, "wu");
    const wuOnB = await connect(c.b.port, wu);
    await wuOnB.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");
    // Locked through instance A's HTTP (same session cookie, shared store).
    await supertest(c.app).post("/api/session/lock").set("Cookie", wu).send({}).expect(200);
    expect(await wuOnB.closed()).toEqual({ code: 4423, reason: "session_locked" });
  });

  it("an instance never re-delivers its own frame (no duplicates on either side)", async () => {
    const c = get();
    const patel = await loginCookie(c.app, "patel");
    const er = await loginCookie(c.app, "er.doc");
    const onA = await connect(c.a.port, patel);
    const onB = await connect(c.b.port, patel);
    await onA.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");
    await onB.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");
    const convo = await supertest(c.app)
      .post("/api/messaging/conversations")
      .set("Cookie", er)
      .send({ type: "direct", participantIds: [c.seedResult.userIds.patel] })
      .expect(201);
    const sent = await supertest(c.app)
      .post("/api/messaging/send")
      .set("Cookie", er)
      .send({ conversationId: convo.body.id, content: "once", priority: "routine" })
      .expect(201);
    await onA.waitFor((m) => m.type === "MESSAGE_RECEIVED" && m.message.id === sent.body.id);
    await onB.waitFor((m) => m.type === "MESSAGE_RECEIVED" && m.message.id === sent.body.id);
    await new Promise((r) => setTimeout(r, 300));
    const count = (b: any[]) => b.filter((m) => m.type === "MESSAGE_RECEIVED" && m.message.id === sent.body.id).length;
    expect(count(onA.buffer)).toBe(1);
    expect(count(onB.buffer)).toBe(1);
    onA.close();
    onB.close();
  });
}

describe("realtime bus — wire format", () => {
  it("small frames go inline; an oversized frame with a resolver goes by reference; without one it is dropped, never truncated", async () => {
    const small = encodeFrame({ kind: "org", orgId: 1, message: { type: "ROTATION_UPDATED" } }, "me", 7000);
    expect(small).toMatchObject({ ok: true, byReference: false });
    const big = { type: "TEST_BIG", organizationId: 1, id: 7, blob: "x".repeat(8000) };
    const noResolver = encodeFrame({ kind: "users", userIds: [1], message: big }, "me", 7000);
    expect(noResolver).toEqual({ ok: false, reason: "oversized_no_resolver" });
    registerFrameResolver("TEST_BIG", {
      toRef: (m) => ({ type: "TEST_BIG", organizationId: m.organizationId, id: m.id }),
      fromRef: async (ref) => (ref.id === 7 ? { ...big } : null),
    });
    expect(frameResolverTypes()).toContain("TEST_BIG");
    const byRef = encodeFrame({ kind: "users", userIds: [1], message: big }, "me", 7000);
    expect(byRef).toMatchObject({ ok: true, byReference: true });
    const payload = (byRef as { payload: string }).payload;
    expect(Buffer.byteLength(payload)).toBeLessThan(7000);
    expect(payload).not.toContain("xxxx");
    // The receiving instance rebuilds the full frame; the origin ignores its own.
    const decoded = await decodePayload(payload, "other");
    expect(decoded).toEqual({ kind: "users", userIds: [1], message: big });
    expect(await decodePayload(payload, "me")).toBeNull();
    // A reference whose row is gone yields nothing (never a half frame).
    const gone = encodeFrame({ kind: "users", userIds: [1], message: { ...big, id: 8 } }, "me", 7000);
    expect(await decodePayload((gone as { payload: string }).payload, "other")).toBeNull();
    // Control frames are ids-only; an oversized one cannot be referenced.
    const control = encodeFrame({ kind: "lock", userId: 1, connectionId: "c".repeat(9000) }, "me", 7000);
    expect(control).toEqual({ ok: false, reason: "oversized_control_frame" });
    expect(await decodePayload("not json", "me")).toBeNull();
  });

  it("the message and broadcast routes register their by-reference resolvers", async () => {
    const handle = await createTestDb();
    try {
      // Importing the app registers the route modules (and with them the resolvers).
      setHandle(handle);
      setStorage(new DatabaseStorage(handle.db));
      createApp({ sessionSecret: "t", rateLimiting: false });
      expect(frameResolverTypes()).toEqual(expect.arrayContaining(["MESSAGE_RECEIVED", "BROADCAST_CREATED"]));
    } finally {
      await handle.close();
    }
  });
});

describe("realtime bus — in-process transport (two hubs, one process)", () => {
  let c: Cluster;
  beforeAll(async () => {
    const channel = "test-" + Math.random().toString(36).slice(2);
    c = await cluster(await createTestDb(), [
      new InProcessBus({ channel, instanceId: "proc-A" }),
      new InProcessBus({ channel, instanceId: "proc-B" }),
    ]);
  });
  afterAll(async () => {
    await c.close();
    await c.handle.close();
  });
  crossInstanceSuite(() => c);

  it("with no peer on the channel (a single process) nothing is encoded or published", () => {
    const lone = new InProcessBus({ channel: "lonely-" + Math.random(), instanceId: "solo" });
    lone.publish({ kind: "org", orgId: 1, message: { type: "ROTATION_UPDATED", pad: "x".repeat(20_000) } });
    expect(lone.status()).toMatchObject({ kind: "in-process", published: 0, dropped: 0, connected: true });
    void lone.close();
  });
});

describe.skipIf(!PG_TEST_URL)("realtime bus — Postgres LISTEN/NOTIFY (PG_TEST_URL)", () => {
  let c: Cluster;
  let handle: DbHandle;
  beforeAll(async () => {
    handle = createDb({ databaseUrl: PG_TEST_URL });
    // A clean database per run: the schema is re-applied by ensureSchema().
    await handle.pool!.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await handle.ensureSchema();
    const busA = new PostgresBus({ pool: handle.pool!, connectionString: PG_TEST_URL!, instanceId: "pg-A", channel: "docturn_test_bus" });
    const busB = new PostgresBus({ pool: handle.pool!, connectionString: PG_TEST_URL!, instanceId: "pg-B", channel: "docturn_test_bus" });
    await Promise.all([busA.start(), busB.start()]);
    expect(busA.status()).toMatchObject({ kind: "postgres", connected: true });
    c = await cluster(handle, [busA, busB], { databaseUrl: PG_TEST_URL });
  }, 60_000);
  afterAll(async () => {
    if (c) await c.close();
    if (handle) await handle.close();
  });
  afterEach(() => {
    // Sessions live in the Postgres `session` table here — the cookie minted
    // through one instance's HTTP is honoured by the other's upgrade.
  });
  crossInstanceSuite(() => c);
});
