import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs } from "@shared/schema";
import { createTestApp, login, type TestContext } from "./helpers.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

describe("messaging", () => {
  it("delivers a direct message to the recipient and blocks non-participants", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const patelUserId = ctx.seedResult.userIds.patel!;

    const convo = await chen
      .post("/api/messaging/conversations")
      .send({ type: "direct", participantIds: [patelUserId] });
    expect(convo.status).toBe(201);

    const sent = await chen
      .post("/api/messaging/send")
      .send({ conversationId: convo.body.id, content: "hello patel" });
    expect(sent.status).toBe(201);

    // Recipient can read it.
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const history = await patel.get(
      `/api/messaging/conversations/${convo.body.id}/messages`,
    );
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].content).toBe("hello patel");

    // A non-participant is forbidden.
    const { agent: lopez } = await login(ctx.app, { username: "lopez" });
    const denied = await lopez.get(
      `/api/messaging/conversations/${convo.body.id}/messages`,
    );
    expect(denied.status).toBe(403);
  });

  it("mark-read sets read state and clears the unread count", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const patelUserId = ctx.seedResult.userIds.patel!;
    const convo = await chen
      .post("/api/messaging/conversations")
      .send({ type: "direct", participantIds: [patelUserId] });
    const sent = await chen
      .post("/api/messaging/send")
      .send({ conversationId: convo.body.id, content: "ping" });

    const { agent: patel } = await login(ctx.app, { username: "patel" });
    let convos = await patel.get("/api/messaging/conversations");
    expect(convos.body[0].unreadCount).toBe(1);

    const read = await patel
      .post("/api/messaging/messages/mark-read")
      .send({ messageIds: [sent.body.id] });
    expect(read.status).toBe(204);

    convos = await patel.get("/api/messaging/conversations");
    expect(convos.body[0].unreadCount).toBe(0);
  });

  it("sender soft-delete writes an audit row; others cannot delete", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const patelUserId = ctx.seedResult.userIds.patel!;
    const convo = await chen
      .post("/api/messaging/conversations")
      .send({ type: "direct", participantIds: [patelUserId] });
    const sent = await chen
      .post("/api/messaging/send")
      .send({ conversationId: convo.body.id, content: "to delete" });

    // Non-sender cannot delete.
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const denied = await patel.delete(
      `/api/messaging/messages/${sent.body.id}`,
    );
    expect(denied.status).toBe(403);

    // Sender deletes → 204 + audit row.
    const del = await chen.delete(`/api/messaging/messages/${sent.body.id}`);
    expect(del.status).toBe(204);

    const audits = await ctx.handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "message.delete"));
    expect(audits.length).toBeGreaterThanOrEqual(1);

    // Message no longer appears in history.
    const history = await chen.get(
      `/api/messaging/conversations/${convo.body.id}/messages`,
    );
    expect(history.body).toHaveLength(0);
  });
});
