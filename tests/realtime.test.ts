import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { WebSocket } from "ws";
import type { RequestHandler } from "express";
import { createTestApp, type TestContext } from "./helpers.js";
import { attachWebSocket, type WsHub } from "../server/ws/index.js";
import { DEV_PASSWORD } from "../server/seed.js";

let ctx: TestContext;
let server: Server;
let hub: WsHub;
let port: number;

beforeAll(async () => {
  ctx = await createTestApp();
  server = createServer(ctx.app);
  hub = attachWebSocket(
    server,
    ctx.app.locals.sessionMiddleware as RequestHandler,
  );
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  hub.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await ctx.handle.close();
});

async function loginCookie(username: string): Promise<string> {
  const res = await supertest(ctx.app)
    .post("/api/login")
    .send({ orgCode: "MERCY", username, password: DEV_PASSWORD });
  expect(res.status).toBe(200);
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(raw).split(";")[0]!;
}

/**
 * A WS client that buffers every message from the moment it opens, so a test
 * can match messages that arrived before `waitFor` was called (e.g. the
 * immediate CONNECTION_ESTABLISHED handshake).
 */
interface TestClient {
  ws: WebSocket;
  buffer: any[];
  waitFor(pred: (m: any) => boolean, ms?: number): Promise<any>;
  close(): void;
}

function connect(cookie: string): Promise<TestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: { Cookie: cookie },
  });
  const buffer: any[] = [];
  const waiters: Array<{ pred: (m: any) => boolean; resolve: (m: any) => void }> =
    [];

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
    waitFor(pred, ms = 2000) {
      const existing = buffer.find(pred);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const entry = { pred, resolve };
        waiters.push(entry);
        setTimeout(() => {
          const idx = waiters.indexOf(entry);
          if (idx >= 0) {
            waiters.splice(idx, 1);
            reject(new Error("timeout waiting for message"));
          }
        }, ms);
      });
    },
    close() {
      ws.close();
    },
  };

  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(client));
    ws.once("error", reject);
  });
}

describe("realtime websocket", () => {
  it("rejects an unauthenticated socket with close 1008", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const code = await new Promise<number>((resolve) => {
      ws.on("close", (c) => resolve(c));
      ws.on("error", () => {
        /* close will still fire */
      });
    });
    expect(code).toBe(1008);
  });

  it("delivers ASSIGNMENT_CREATED to the targeted provider's socket", async () => {
    const chen = await connect(await loginCookie("chen"));
    await chen.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");

    const created = chen.waitFor((m) => m.type === "ASSIGNMENT_CREATED");

    // ER doctor creates a patient + round-robin assignment (targets Chen).
    const er = supertest.agent(ctx.app);
    await er
      .post("/api/login")
      .send({ orgCode: "MERCY", username: "er.doc", password: DEV_PASSWORD });
    const patient = await er
      .post("/api/patients")
      .send({ initials: "WS", roomNumber: "5", issueSummary: "rt" });
    await er
      .post("/api/assignments")
      .send({ patientId: patient.body.id, mode: "round_robin" });

    const msg = await created;
    expect(msg.assignment.hospitalistId).toBe(
      ctx.seedResult.hospitalistIds.chen,
    );
    chen.close();
  });

  it("delivers a message to participants only", async () => {
    const chenWs = await connect(await loginCookie("chen"));
    const patelWs = await connect(await loginCookie("patel"));
    const lopezWs = await connect(await loginCookie("lopez"));
    await Promise.all([
      chenWs.waitFor((m) => m.type === "CONNECTION_ESTABLISHED"),
      patelWs.waitFor((m) => m.type === "CONNECTION_ESTABLISHED"),
      lopezWs.waitFor((m) => m.type === "CONNECTION_ESTABLISHED"),
    ]);

    const chen = supertest.agent(ctx.app);
    await chen
      .post("/api/login")
      .send({ orgCode: "MERCY", username: "chen", password: DEV_PASSWORD });
    const convo = await chen
      .post("/api/messaging/conversations")
      .send({ type: "direct", participantIds: [ctx.seedResult.userIds.patel] });

    const patelGot = patelWs.waitFor((m) => m.type === "MESSAGE_RECEIVED");

    await chen
      .post("/api/messaging/send")
      .send({ conversationId: convo.body.id, content: "hi" });

    const msg = await patelGot;
    expect(msg.message.content).toBe("hi");
    // Lopez (non-participant) must not have received the message.
    expect(lopezWs.buffer.some((m) => m.type === "MESSAGE_RECEIVED")).toBe(false);

    chenWs.close();
    patelWs.close();
    lopezWs.close();
  });

  it("broadcasts presence to the tenant on connect", async () => {
    const director = await connect(await loginCookie("director"));
    await director.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");

    const presence = director.waitFor(
      (m) =>
        m.type === "USER_PRESENCE_CHANGED" &&
        m.online === true &&
        m.userId === ctx.seedResult.userIds.patel,
    );
    const patelWs = await connect(await loginCookie("patel"));

    const msg = await presence;
    expect(msg.userId).toBe(ctx.seedResult.userIds.patel);
    director.close();
    patelWs.close();
  });
});
