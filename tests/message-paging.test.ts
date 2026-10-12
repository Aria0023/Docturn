import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * A.CON-SHO-65 (server half, fix-up):
 *
 *  1. GET /api/messaging/conversations/:id/messages is paginated: ?limit
 *     (default 50, max 200), ?before=<messageId> (older page) and
 *     ?after=<messageId> (newer page), ordered by id, with `X-Has-More` saying
 *     whether the server holds more in the paging direction. storage reads are
 *     bounded — no route reads a whole thread any more.
 *  2. GET /api/messaging/conversations keeps lastMessage + unreadCount exact
 *     for long threads without reading every message.
 *  3. GET /api/messaging/sync — the web client's reconnect resync. It answers
 *     "what changed since my cursor" for the caller's own conversations: new
 *     messages (id > after, decorated like thread rows), receipt changes and
 *     recalls (since the server cursor), and a PHI-free per-thread summary.
 *     When nothing changed it carries no message content and writes NO
 *     PHI-access row (a socket drop used to re-read every group thread and log
 *     a "read" the user never made). When it does deliver message content, the
 *     row says so as "conversation-sync" — never as a user opening the thread.
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});

async function phiRows() {
  return ctx.storage.listPhiAccess(ctx.seedResult.orgId, 500);
}

async function directThread(n: number) {
  const chenId = ctx.seedResult.userIds.chen!;
  const { agent: patel } = await login(ctx.app, { username: "patel" });
  const { agent: chen } = await login(ctx.app, { username: "chen" });
  const convo = await patel.post("/api/messaging/conversations").send({ type: "direct", participantIds: [chenId] });
  expect(convo.status).toBe(201);
  const ids: number[] = [];
  for (let i = 1; i <= n; i++) {
    const s = await patel.post("/api/messaging/send").send({ conversationId: convo.body.id, content: "m" + i });
    expect(s.status).toBe(201);
    ids.push(s.body.id);
  }
  return { convoId: convo.body.id as number, ids, chen, patel };
}

describe("thread pagination", () => {
  it("?limit returns the newest N, ascending, with X-Has-More", async () => {
    const { convoId, ids, chen } = await directThread(5);
    const r = await chen.get(`/api/messaging/conversations/${convoId}/messages?limit=2`);
    expect(r.status).toBe(200);
    expect(r.body.map((m: any) => m.id)).toEqual([ids[3], ids[4]]);
    expect(r.headers["x-has-more"]).toBe("1");
    // Rows are still fully decorated.
    expect(r.body[0]).toMatchObject({ content: "m4", deliveries: expect.any(Array), attachments: [] });

    const all = await chen.get(`/api/messaging/conversations/${convoId}/messages?limit=5`);
    expect(all.body.map((m: any) => m.id)).toEqual(ids);
    expect(all.headers["x-has-more"]).toBe("0");
  });

  it("?before pages backwards; ?after pages forwards", async () => {
    const { convoId, ids, chen } = await directThread(5);
    const older = await chen.get(`/api/messaging/conversations/${convoId}/messages?limit=2&before=${ids[3]}`);
    expect(older.body.map((m: any) => m.id)).toEqual([ids[1], ids[2]]);
    expect(older.headers["x-has-more"]).toBe("1");
    const oldest = await chen.get(`/api/messaging/conversations/${convoId}/messages?limit=2&before=${ids[1]}`);
    expect(oldest.body.map((m: any) => m.id)).toEqual([ids[0]]);
    expect(oldest.headers["x-has-more"]).toBe("0");

    const newer = await chen.get(`/api/messaging/conversations/${convoId}/messages?limit=2&after=${ids[0]}`);
    expect(newer.body.map((m: any) => m.id)).toEqual([ids[1], ids[2]]);
    expect(newer.headers["x-has-more"]).toBe("1");
    const rest = await chen.get(`/api/messaging/conversations/${convoId}/messages?after=${ids[2]}`);
    expect(rest.body.map((m: any) => m.id)).toEqual([ids[3], ids[4]]);
    expect(rest.headers["x-has-more"]).toBe("0");
  });

  it("defaults to 50, caps at 200, and refuses malformed paging", async () => {
    const { convoId, chen } = await directThread(1);
    // Bulk rows straight into storage (the send route is not under test here).
    const patelId = ctx.seedResult.userIds.patel!;
    const extra: number[] = [];
    for (let i = 0; i < 230; i++) {
      const m = await ctx.storage.createMessage({ conversationId: convoId, organizationId: ctx.seedResult.orgId, senderId: patelId, content: "bulk " + i, priority: "routine" });
      extra.push(m.id);
    }
    const def = await chen.get(`/api/messaging/conversations/${convoId}/messages`);
    expect(def.status).toBe(200);
    expect(def.body).toHaveLength(50);
    expect(def.body.at(-1).id).toBe(extra.at(-1));
    expect(def.headers["x-has-more"]).toBe("1");

    const big = await chen.get(`/api/messaging/conversations/${convoId}/messages?limit=5000`);
    expect(big.body).toHaveLength(200);

    for (const q of ["limit=0", "limit=-3", "limit=abc", "before=x", "after=1.5", `before=${extra[5]}&after=${extra[1]}`]) {
      const bad = await chen.get(`/api/messaging/conversations/${convoId}/messages?${q}`);
      expect(bad.status, q).toBe(400);
    }
  });

  it("still logs exactly one PHI row per page read", async () => {
    const { convoId, chen } = await directThread(3);
    const before = (await phiRows()).length;
    await chen.get(`/api/messaging/conversations/${convoId}/messages?limit=1`).expect(200);
    const rows = await phiRows();
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ resource: "conversation-messages", resourceId: convoId });
  });
});

describe("conversation list stays exact for long threads", () => {
  it("lastMessage is the newest and unreadCount counts every unread message", async () => {
    const { convoId, chen } = await directThread(1);
    const patelId = ctx.seedResult.userIds.patel!;
    const chenId = ctx.seedResult.userIds.chen!;
    let last = 0;
    for (let i = 0; i < 60; i++) {
      const m = await ctx.storage.createMessage({ conversationId: convoId, organizationId: ctx.seedResult.orgId, senderId: patelId, content: "x" + i, priority: "routine" });
      await ctx.storage.createDeliveryStatuses([{ messageId: m.id, userId: chenId, deliveredAt: new Date(), readAt: null, acknowledgedAt: null, realertedAt: null, escalatedAt: null }]);
      last = m.id;
    }
    // A recalled (soft-deleted) message is neither last nor unread.
    const gone = await ctx.storage.createMessage({ conversationId: convoId, organizationId: ctx.seedResult.orgId, senderId: patelId, content: "recalled", priority: "routine" });
    await ctx.storage.createDeliveryStatuses([{ messageId: gone.id, userId: chenId, deliveredAt: new Date(), readAt: null, acknowledgedAt: null, realertedAt: null, escalatedAt: null }]);
    await ctx.storage.softDeleteMessage(ctx.seedResult.orgId, gone.id);

    const list = await chen.get("/api/messaging/conversations");
    const row = (list.body as any[]).find((c) => c.id === convoId);
    expect(row.lastMessage.id).toBe(last);
    expect(row.unreadCount).toBe(61); // 1 via the send route + 60 here
    // The preview is a full thread row: my own delivery row says it is unread.
    expect(row.lastMessage.deliveries).toEqual([expect.objectContaining({ userId: chenId, readAt: null })]);
    expect(row.lastMessage.attachments).toEqual([]);
  });
});

describe("GET /api/messaging/sync (reconnect resync)", () => {
  async function cursor(agent: any, after: number) {
    const r = await agent.get(`/api/messaging/sync?after=${after}`);
    expect(r.status).toBe(200);
    return r.body as { cursor: string; conversations: any[]; messages: any[]; receipts: any[]; recalled: any[]; more: boolean };
  }

  it("nothing changed → no content, no PHI row", async () => {
    const { convoId, ids, chen } = await directThread(2);
    const first = await cursor(chen, ids[1]!);
    expect(typeof first.cursor).toBe("string");
    const before = (await phiRows()).length;
    const r = await chen.get(`/api/messaging/sync?after=${ids[1]}&since=${encodeURIComponent(first.cursor)}`);
    expect(r.status).toBe(200);
    expect(r.body.messages).toEqual([]);
    expect(r.body.recalled).toEqual([]);
    expect(r.body.more).toBe(false);
    // PHI-free summary: ids and counters only.
    const mine = r.body.conversations.find((c: any) => c.id === convoId);
    expect(mine).toEqual({ id: convoId, lastMessageId: ids[1], unreadCount: 2 });
    expect(JSON.stringify(r.body)).not.toMatch(/"content"|m1|m2/);
    expect((await phiRows()).length).toBe(before);
  });

  it("a message sent while away comes back decorated, logged once as conversation-sync", async () => {
    const { convoId, ids, chen, patel } = await directThread(1);
    const c0 = await cursor(chen, ids[0]!);
    const sent = await patel.post("/api/messaging/send").send({ conversationId: convoId, content: "while you were away", priority: "stat" });
    const before = (await phiRows()).length;
    const r = await chen.get(`/api/messaging/sync?after=${ids[0]}&since=${encodeURIComponent(c0.cursor)}`);
    expect(r.body.messages.map((m: any) => m.id)).toEqual([sent.body.id]);
    expect(r.body.messages[0]).toMatchObject({ content: "while you were away", priority: "stat", conversationId: convoId, attachments: [], acknowledgedByMe: false });
    expect(r.body.messages[0].deliveries.map((d: any) => d.userId)).toEqual([ctx.seedResult.userIds.chen]);
    expect(r.body.conversations.find((c: any) => c.id === convoId)).toMatchObject({ lastMessageId: sent.body.id, unreadCount: 2 });
    const rows = await phiRows();
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ resource: "conversation-sync", resourceId: convoId, method: "GET" });
    expect(JSON.stringify(rows[0])).not.toContain("while you were away");
  });

  it("receipts and recalls since the cursor come back without content or a PHI row", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const convo = await chen.post("/api/messaging/conversations").send({ type: "direct", participantIds: [patelId] });
    const a = await chen.post("/api/messaging/send").send({ conversationId: convo.body.id, content: "please read" });
    const b = await chen.post("/api/messaging/send").send({ conversationId: convo.body.id, content: "oops recall me" });
    const c0 = await cursor(chen, b.body.id);
    // While chen is away: patel reads A, chen (another device) recalls B.
    await patel.post("/api/messaging/messages/mark-read").send({ messageIds: [a.body.id] }).expect(204);
    await chen.delete("/api/messaging/messages/" + b.body.id).expect(204);
    const before = (await phiRows()).length;
    const r = await chen.get(`/api/messaging/sync?after=${b.body.id}&since=${encodeURIComponent(c0.cursor)}`);
    expect(r.body.messages).toEqual([]);
    const rc = r.body.receipts.filter((x: any) => x.messageId === a.body.id);
    expect(rc).toEqual([expect.objectContaining({ messageId: a.body.id, conversationId: convo.body.id, userId: patelId, status: "read" })]);
    expect(rc[0].readAt).toBeTruthy();
    // The sender's own auto-read row is never a receipt.
    expect(r.body.receipts.some((x: any) => x.userId === chenId)).toBe(false);
    expect(r.body.recalled).toEqual([{ messageId: b.body.id, conversationId: convo.body.id }]);
    expect(JSON.stringify(r.body)).not.toMatch(/please read|recall me/);
    expect((await phiRows()).length).toBe(before);
  });

  it("only the caller's own conversations", async () => {
    const { convoId, ids } = await directThread(1);
    // lopez is not in chen↔patel; a fresh message there must not leak to lopez.
    const { agent: lopez } = await login(ctx.app, { username: "lopez" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    await patel.post("/api/messaging/send").send({ conversationId: convoId, content: "private" }).expect(201);
    const r = await lopez.get(`/api/messaging/sync?after=0`);
    expect(r.status).toBe(200);
    expect(r.body.messages.some((m: any) => m.conversationId === convoId)).toBe(false);
    expect(r.body.conversations.some((c: any) => c.id === convoId)).toBe(false);
    expect(JSON.stringify(r.body)).not.toContain("private");
    expect(ids.length).toBe(1);
  });

  it("caps a large backlog and says there is more; validates its input", async () => {
    const { convoId, ids, chen } = await directThread(1);
    const patelId = ctx.seedResult.userIds.patel!;
    for (let i = 0; i < 205; i++) {
      await ctx.storage.createMessage({ conversationId: convoId, organizationId: ctx.seedResult.orgId, senderId: patelId, content: "b" + i, priority: "routine" });
    }
    const r = await chen.get(`/api/messaging/sync?after=${ids[0]}`);
    expect(r.body.messages).toHaveLength(200);
    expect(r.body.more).toBe(true);
    const next = await chen.get(`/api/messaging/sync?after=${r.body.messages.at(-1).id}`);
    expect(next.body.messages).toHaveLength(5);
    expect(next.body.more).toBe(false);

    for (const q of ["after=x", "after=-1", "after=1&since=not-a-date"]) {
      expect((await chen.get(`/api/messaging/sync?${q}`)).status, q).toBe(400);
    }
    // No `after`: summary only (a client that has not synced yet gets a cursor).
    const bare = await chen.get(`/api/messaging/sync`);
    expect(bare.status).toBe(200);
    expect(bare.body.messages).toEqual([]);
    expect(bare.body.conversations.find((c: any) => c.id === convoId)).toBeTruthy();
  });
});
