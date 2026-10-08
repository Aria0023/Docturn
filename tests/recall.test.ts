import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { invalidateModules } from "../server/modules.js";

/**
 * A.CON-SHO-25 (server half): message recall emits MESSAGE_RECALLED to every
 * participant so an open thread drops the message live, and enforces the
 * advertised "unread only" rule (module blurb: "Sender can recall an unread
 * message") instead of silently deleting messages people have already read.
 */
describe("message recall", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
    // The module map is cached per process (5 s); a fresh DB must not inherit
    // a switch an earlier test flipped.
    invalidateModules();
  });

  async function directConvo(agent: import("supertest").Agent, otherUserId: number) {
    const res = await agent
      .post("/api/messaging/conversations")
      .send({ type: "direct", participantIds: [otherUserId] });
    expect(res.status).toBe(201);
    return res.body as { id: number; participantIds: number[] };
  }

  it("recalls an unread message, tells both participants live, and audits ids only", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const convo = await directConvo(chen, patelId);
    const sent = await chen.post("/api/messaging/send").send({ conversationId: convo.id, content: "wrong patient — ignore" });
    expect(sent.status).toBe(201);

    ctx.ws.delivered = [];
    await chen.delete(`/api/messaging/messages/${sent.body.id}`).expect(204);

    const evt = ctx.ws.delivered.find((d) => (d.message as { type?: string }).type === "MESSAGE_RECALLED");
    expect(evt).toBeTruthy();
    expect(evt!.message).toEqual({ type: "MESSAGE_RECALLED", messageId: sent.body.id, conversationId: convo.id, userId: chenId });
    expect([...evt!.userIds].sort()).toEqual([chenId, patelId].sort());
    // No content in the event.
    expect(JSON.stringify(evt!.message)).not.toContain("wrong patient");

    // Gone from the thread for the recipient.
    const msgs = (await patel.get(`/api/messaging/conversations/${convo.id}/messages`).expect(200)).body as Array<{ id: number }>;
    expect(msgs.some((m) => m.id === sent.body.id)).toBe(false);

    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    const row = audit.find((a) => a.action === "message.delete");
    expect(row).toBeTruthy();
    expect(row!.details).toMatchObject({ conversationId: convo.id, recipients: 1, coveringCopies: [] });

    // Idempotent: a retry after a lost 204 is still 204 and emits nothing new.
    ctx.ws.delivered = [];
    await chen.delete(`/api/messaging/messages/${sent.body.id}`).expect(204);
    expect(ctx.ws.delivered).toHaveLength(0);
  });

  it("refuses to recall a message a recipient has already read (409 already_read)", async () => {
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const convo = await directConvo(chen, patelId);
    const sent = await chen.post("/api/messaging/send").send({ conversationId: convo.id, content: "seen" });
    await patel.post("/api/messaging/messages/mark-read").send({ messageIds: [sent.body.id] }).expect(204);

    ctx.ws.delivered = [];
    const res = await chen.delete(`/api/messaging/messages/${sent.body.id}`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "already_read", readBy: 1 });
    expect(ctx.ws.delivered.some((d) => (d.message as { type?: string }).type === "MESSAGE_RECALLED")).toBe(false);
    // Still there.
    const msgs = (await patel.get(`/api/messaging/conversations/${convo.id}/messages`).expect(200)).body as Array<{ id: number }>;
    expect(msgs.some((m) => m.id === sent.body.id)).toBe(true);
  });

  it("only the sender may recall; bad ids are 404; the module switch still applies", async () => {
    const orgId = ctx.seedResult.orgId;
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const convo = await directConvo(chen, patelId);
    const sent = await chen.post("/api/messaging/send").send({ conversationId: convo.id, content: "x" });
    expect((await patel.delete(`/api/messaging/messages/${sent.body.id}`)).status).toBe(403);
    expect((await chen.delete("/api/messaging/messages/not-a-number")).status).toBe(404);
    expect((await chen.delete("/api/messaging/messages/999999")).status).toBe(404);

    await ctx.storage.setOrgSetting(orgId, "modules", { "messaging.recall": false }, null);
    invalidateModules();
    const off = await chen.delete(`/api/messaging/messages/${sent.body.id}`);
    expect(off.status).toBe(404);
    expect(off.body).toEqual({ error: "module_disabled", module: "messaging.recall" });
  });

  it("recalling a DND-forwarded message also recalls the covering copy and notifies that thread", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const erId = ctx.seedResult.userIds["er.doc"]!;
    const { agent: chenAgent } = await login(ctx.app, { username: "chen" });
    await chenAgent.patch("/api/settings/me").send({ key: "dnd", value: true }).expect(200);
    await chenAgent.patch("/api/settings/me").send({ key: "coveringUserId", value: patelId }).expect(200);
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = await directConvo(er, chenId);
    const sent = await er.post("/api/messaging/send").send({ conversationId: convo.id, content: "oops" });
    expect(sent.body.forwardedTo).toContain(patelId);

    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const threads = (await patel.get("/api/messaging/conversations").expect(200)).body as Array<{ id: number; participantIds: number[]; lastMessage: { id: number } | null }>;
    const covering = threads.find((c) => c.participantIds.includes(erId) && c.participantIds.length === 2)!;
    expect(covering.lastMessage).toBeTruthy();
    const copyId = covering.lastMessage!.id;

    ctx.ws.delivered = [];
    await er.delete(`/api/messaging/messages/${sent.body.id}`).expect(204);
    const recalled = ctx.ws.delivered.filter((d) => (d.message as { type?: string }).type === "MESSAGE_RECALLED").map((d) => d.message as { messageId: number; conversationId: number });
    expect(recalled).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: sent.body.id, conversationId: convo.id }),
      expect.objectContaining({ messageId: copyId, conversationId: covering.id }),
    ]));
    const copies = (await patel.get(`/api/messaging/conversations/${covering.id}/messages`).expect(200)).body as Array<{ id: number }>;
    expect(copies.some((m) => m.id === copyId)).toBe(false);
  });
});
