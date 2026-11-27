import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * A.CON-SHO-65 (server half): the MESSAGE_RECEIVED frame carries everything a
 * client needs to render the message it announces — attachment metadata
 * (never bytes) and the per-recipient delivery rows — exactly as the thread
 * route serves them. The web client applies the frame directly instead of
 * re-fetching every conversation (and writing a PHI-access audit row per
 * thread) on each event.
 */

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

type Frame = { type: string; message?: any };

describe("MESSAGE_RECEIVED frame", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  function frames(type: string): Array<{ userIds: number[]; message: Frame }> {
    return ctx.ws.delivered
      .map((d) => ({ userIds: d.userIds, message: d.message as Frame }))
      .filter((d) => d.message.type === type);
  }

  it("carries attachment metadata and delivery rows identical to the thread view", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });

    const up = await chen.post("/api/messaging/attachments").send({ fileName: "xray.png", mimeType: "image/png", dataBase64: PNG_1x1 });
    expect(up.status).toBe(201);
    const convo = await chen.post("/api/messaging/conversations").send({ type: "direct", participantIds: [patelId] });
    expect(convo.status).toBe(201);

    const before = ctx.ws.delivered.length;
    const sent = await chen.post("/api/messaging/send").send({ conversationId: convo.body.id, content: "see image", priority: "stat", attachmentIds: [up.body.id] });
    expect(sent.status).toBe(201);

    const got = frames("MESSAGE_RECEIVED").filter((f) => f.message.message?.id === sent.body.id);
    expect(got).toHaveLength(1);
    expect(ctx.ws.delivered.length).toBeGreaterThan(before);
    const f = got[0]!;
    expect(new Set(f.userIds)).toEqual(new Set([chenId, patelId]));
    const m = f.message.message;
    // The raw row is still there (backwards compatible for any consumer).
    expect(m).toMatchObject({ id: sent.body.id, conversationId: convo.body.id, senderId: chenId, content: "see image", priority: "stat" });

    // Attachments: metadata only, no bytes, same URL the thread view serves.
    expect(m.attachments).toEqual([
      expect.objectContaining({ id: up.body.id, fileName: "xray.png", mimeType: "image/png", isImage: true, isAudio: false, url: "/api/messaging/attachments/" + up.body.id }),
    ]);
    expect(JSON.stringify(m)).not.toContain(PNG_1x1);
    expect(m.attachments[0].dataBase64).toBeUndefined();

    // Deliveries: recipients only (never the sender's own auto-read row).
    expect(m.deliveries).toHaveLength(1);
    expect(m.deliveries[0]).toMatchObject({ userId: patelId, readAt: null, acknowledgedAt: null, status: "delivered" });
    expect(typeof m.deliveries[0].displayName).toBe("string");
    expect(m.deliveries[0].displayName.length).toBeGreaterThan(0);
    expect(m.ackCount).toBe(0);
    expect(m.readCount).toBe(0);

    // Same shape as GET /conversations/:id/messages (minus the viewer-specific
    // acknowledgedByMe, which the client derives from its own delivery row).
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const thread = await patel.get("/api/messaging/conversations/" + convo.body.id + "/messages");
    expect(thread.status).toBe(200);
    const row = (thread.body as any[]).find((x) => x.id === sent.body.id);
    expect(JSON.parse(JSON.stringify(m.attachments))).toEqual(row.attachments);
    expect(JSON.parse(JSON.stringify(m.deliveries))).toEqual(row.deliveries);
  });

  it("a forwarded message's frame carries its by-reference attachments with the forwarded URL", async () => {
    const patelId = ctx.seedResult.userIds.patel!;
    const lopezId = ctx.seedResult.userIds.lopez!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const up = await chen.post("/api/messaging/attachments").send({ fileName: "ecg.png", mimeType: "image/png", dataBase64: PNG_1x1 });
    const a = await chen.post("/api/messaging/conversations").send({ type: "direct", participantIds: [patelId] });
    const sent = await chen.post("/api/messaging/send").send({ conversationId: a.body.id, content: "ecg", attachmentIds: [up.body.id] });
    expect(sent.status).toBe(201);

    const fwd = await chen.post("/api/messaging/messages/" + sent.body.id + "/forward").send({ participantIds: [lopezId] });
    expect(fwd.status).toBe(201);
    const f = frames("MESSAGE_RECEIVED").find((x) => x.message.message?.id === fwd.body.id);
    expect(f).toBeTruthy();
    const m = f!.message.message;
    expect(m.forwardedFrom).toMatchObject({ messageId: sent.body.id });
    expect(m.attachments).toEqual([
      expect.objectContaining({ id: up.body.id, forwarded: true, url: "/api/messaging/messages/" + fwd.body.id + "/attachments/" + up.body.id }),
    ]);
    expect(m.deliveries.map((d: any) => d.userId)).toEqual([lopezId]);
  });

  it("a text-only message's frame says so explicitly (empty attachments, not missing)", async () => {
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const c = await chen.post("/api/messaging/conversations").send({ type: "group", name: "Huddle", participantIds: [patelId, ctx.seedResult.userIds.lopez!] });
    const sent = await chen.post("/api/messaging/send").send({ conversationId: c.body.id, content: "hello team" });
    const f = frames("MESSAGE_RECEIVED").find((x) => x.message.message?.id === sent.body.id)!;
    expect(f.message.message.attachments).toEqual([]);
    expect(f.message.message.deliveries.map((d: any) => d.userId).sort()).toEqual([patelId, ctx.seedResult.userIds.lopez!].sort());
  });
});
