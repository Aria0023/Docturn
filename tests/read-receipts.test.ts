import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { invalidateModules } from "../server/modules.js";

/**
 * A.CON-SHO-26: the sender's receipt must reflect the recipient's REAL read
 * state, and it must be able to change live. POST /mark-read therefore tells
 * the conversation's other participants which of THEIR messages this reader
 * has just read (MESSAGE_READ, ids only), exactly once per message, and only
 * for messages the reader actually received.
 */
describe("read receipts", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
    invalidateModules();
  });

  type Frame = { type?: string; conversationId?: number; messageIds?: number[]; userId?: number; readAt?: string };
  const readFrames = () =>
    ctx.ws.delivered.filter((d) => (d.message as Frame).type === "MESSAGE_READ") as Array<{ userIds: number[]; message: Frame }>;

  async function convo(agent: import("supertest").Agent, participantIds: number[], type = "direct") {
    const res = await agent.post("/api/messaging/conversations").send({ type, participantIds, ...(type === "group" ? { name: "Receipts group" } : {}) });
    expect(res.status).toBe(201);
    return res.body as { id: number; participantIds: number[] };
  }

  it("emits MESSAGE_READ to the sender once, with ids only, when the recipient reads", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const c = await convo(chen, [patelId]);
    const sent = await chen.post("/api/messaging/send").send({ conversationId: c.id, content: "K+ 6.1 — recheck" });
    expect(sent.status).toBe(201);

    // Before the read: the sender's view says delivered, not read.
    let mine = ((await chen.get(`/api/messaging/conversations/${c.id}/messages`).expect(200)).body as Array<{ id: number; readCount: number; deliveries: Array<{ userId: number; deliveredAt: string | null; readAt: string | null }> }>).find((m) => m.id === sent.body.id)!;
    expect(mine.readCount).toBe(0);
    expect(mine.deliveries).toHaveLength(1);
    expect(mine.deliveries[0]!.deliveredAt).toBeTruthy();
    expect(mine.deliveries[0]!.readAt).toBeNull();

    ctx.ws.delivered = [];
    await patel.post("/api/messaging/messages/mark-read").send({ messageIds: [sent.body.id] }).expect(204);
    const frames = readFrames();
    expect(frames).toHaveLength(1);
    expect(frames[0]!.userIds).toEqual([chenId]);
    expect(frames[0]!.message).toMatchObject({ type: "MESSAGE_READ", conversationId: c.id, messageIds: [sent.body.id], userId: patelId });
    expect(typeof frames[0]!.message.readAt).toBe("string");
    expect(Object.keys(frames[0]!.message).sort()).toEqual(["conversationId", "messageIds", "readAt", "type", "userId"]);
    expect(JSON.stringify(frames[0]!.message)).not.toContain("K+");

    mine = ((await chen.get(`/api/messaging/conversations/${c.id}/messages`).expect(200)).body as typeof mine[]).find((m) => m.id === sent.body.id)!;
    expect(mine.readCount).toBe(1);
    expect(mine.deliveries[0]!.readAt).toBeTruthy();

    // A repeat (the open thread re-marking) is silent.
    ctx.ws.delivered = [];
    await patel.post("/api/messaging/messages/mark-read").send({ messageIds: [sent.body.id] }).expect(204);
    expect(readFrames()).toHaveLength(0);
  });

  it("never emits for a message the caller did not receive or sent themselves", async () => {
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: lopez } = await login(ctx.app, { username: "lopez" });
    const c = await convo(chen, [patelId]);
    const sent = await chen.post("/api/messaging/send").send({ conversationId: c.id, content: "not for lopez" });

    ctx.ws.delivered = [];
    // Not a participant: no delivery row, so no receipt can be faked.
    await lopez.post("/api/messaging/messages/mark-read").send({ messageIds: [sent.body.id] }).expect(204);
    // The sender re-marking their own message (their row is auto-read) is silent too.
    await chen.post("/api/messaging/messages/mark-read").send({ messageIds: [sent.body.id] }).expect(204);
    expect(readFrames()).toHaveLength(0);
    const mine = ((await chen.get(`/api/messaging/conversations/${c.id}/messages`).expect(200)).body as Array<{ id: number; readCount: number }>).find((m) => m.id === sent.body.id)!;
    expect(mine.readCount).toBe(0);
  });

  it("group threads: every other participant learns who read which message", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const lopezId = ctx.seedResult.userIds.lopez!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const g = await convo(chen, [patelId, lopezId], "group");
    const a = await chen.post("/api/messaging/send").send({ conversationId: g.id, content: "one" });
    const b = await chen.post("/api/messaging/send").send({ conversationId: g.id, content: "two" });

    ctx.ws.delivered = [];
    await patel.post("/api/messaging/messages/mark-read").send({ messageIds: [a.body.id, b.body.id] }).expect(204);
    const frames = readFrames();
    expect(frames).toHaveLength(1);
    expect([...frames[0]!.userIds].sort()).toEqual([chenId, lopezId].sort());
    expect(frames[0]!.message.messageIds!.slice().sort()).toEqual([a.body.id, b.body.id].sort());
    expect(frames[0]!.message.userId).toBe(patelId);
  });

  it("a recalled message produces no receipt", async () => {
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const c = await convo(chen, [patelId]);
    const sent = await chen.post("/api/messaging/send").send({ conversationId: c.id, content: "oops" });
    await chen.delete(`/api/messaging/messages/${sent.body.id}`).expect(204);
    ctx.ws.delivered = [];
    await patel.post("/api/messaging/messages/mark-read").send({ messageIds: [sent.body.id] }).expect(204);
    expect(readFrames()).toHaveLength(0);
  });
});
