import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { runStatEscalationSweep } from "../server/services/escalation.js";
import { invalidateModules } from "../server/modules.js";

/**
 * STAT non-response loop + DND covering forwarding.
 * The sweep is invoked directly with zero thresholds (age > 0ms immediately),
 * against the same seeded app the API agents talk to.
 *
 * A.CON-SHO-22: the covering provider is delivered a provenance-stamped COPY in
 * a sender ↔ covering thread — they are never joined to the original thread.
 * A.CON-SHO-20/33: the whole loop is off when messaging.escalation is off.
 */
describe("stat escalation + dnd forwarding", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
    invalidateModules();
  });

  /** The 1:1 thread between two users as one of them sees it in the list. */
  async function directThreadBetween(
    agent: import("supertest").Agent,
    otherUserId: number,
    excludeId?: number,
  ) {
    const list = (await agent.get("/api/messaging/conversations").expect(200)).body as Array<{
      id: number; type: string; participantIds: number[]; name: string | null;
    }>;
    return list.find(
      (c) => c.id !== excludeId && c.type === "direct" && c.participantIds.length === 2 && c.participantIds.includes(otherUserId),
    );
  }

  async function directConvo(
    agent: import("supertest").Agent,
    otherUserId: number,
  ) {
    const res = await agent
      .post("/api/messaging/conversations")
      .send({ type: "direct", participantIds: [otherUserId] });
    expect(res.status).toBe(201);
    return res.body as { id: number; participantIds: number[] };
  }

  it("re-alerts, then escalates an unacked STAT to the covering provider", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;

    // Chen designates Patel as covering.
    const { agent: chenAgent } = await login(ctx.app, { username: "chen" });
    await chenAgent
      .patch("/api/settings/me")
      .send({ key: "coveringUserId", value: patelId })
      .expect(200);

    const convo = await directConvo(er, chenId);
    const sent = await er
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "STAT bed 4", priority: "stat" });
    expect(sent.status).toBe(201);
    const messageId = sent.body.id as number;

    // Sweep 1: re-alert only (escalate threshold not yet reached).
    ctx.push.sent = [];
    let out = await runStatEscalationSweep(ctx.storage, {
      realertMs: 0,
      escalateMs: 60_000,
    });
    expect(out.realerted).toBe(1);
    expect(out.escalated).toBe(0);
    expect(
      ctx.ws.delivered.some(
        (d) =>
          (d.message as { type?: string }).type === "STAT_REALERT" &&
          d.userIds.includes(chenId),
      ),
    ).toBe(true);
    expect(ctx.push.sent.some((p) => p.userId === chenId)).toBe(true);

    // Sweep 2: escalation — the covering provider is delivered a COPY in a
    // sender ↔ covering thread. The original 1:1 thread's membership is
    // untouched (no permanent join, no history exposure).
    out = await runStatEscalationSweep(ctx.storage, {
      realertMs: 0,
      escalateMs: 0,
    });
    expect(out.escalated).toBe(1);
    const updated = await ctx.storage.getConversation(orgId, convo.id);
    expect(updated!.participantIds).not.toContain(patelId);
    expect(updated!.participantIds).toEqual(convo.participantIds);
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    expect((await patel.get(`/api/messaging/conversations/${convo.id}/messages`)).status).toBe(403);
    const coveringThread = await directThreadBetween(patel, ctx.seedResult.userIds["er.doc"]!);
    expect(coveringThread).toBeTruthy();
    const copies = (await patel.get(`/api/messaging/conversations/${coveringThread!.id}/messages`).expect(200)).body as Array<{
      id: number; content: string; priority: string; forwardedFrom: Record<string, unknown> | null;
    }>;
    expect(copies).toHaveLength(1);
    expect(copies[0]!.content).toBe("STAT bed 4");
    expect(copies[0]!.priority).toBe("stat");
    expect(copies[0]!.forwardedFrom).toMatchObject({
      messageId,
      conversationId: convo.id,
      coveringFor: chenId,
      reason: "escalation",
    });
    const copyDelivery = await ctx.storage.listDeliveryForMessages([copies[0]!.id]);
    expect(copyDelivery.some((d) => d.userId === patelId && !d.readAt)).toBe(true);
    const escalatedEvt = ctx.ws.delivered.find(
      (d) =>
        (d.message as { type?: string }).type === "STAT_ESCALATED" &&
        d.userIds.includes(patelId),
    );
    expect(escalatedEvt).toBeTruthy();
    // The event points the covering provider at the thread they CAN open.
    expect(escalatedEvt!.message).toMatchObject({
      conversationId: coveringThread!.id,
      messageId: copies[0]!.id,
      originalMessageId: messageId,
      forUserId: chenId,
    });
    // Audit row records the escalation with ids only (no PHI), incl. where it went.
    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    const row = audit.find((a) => a.action === "message.stat_escalated");
    expect(row).toBeTruthy();
    expect(row!.details).toMatchObject({
      unresponsiveUserId: chenId,
      coveringUserId: patelId,
      coveringConversationId: coveringThread!.id,
      coveringMessageId: copies[0]!.id,
    });
    expect(JSON.stringify(row!.details)).not.toContain("bed 4");

    // Sweep 3: idempotent — nothing new fires for the same delivery.
    out = await runStatEscalationSweep(ctx.storage, {
      realertMs: 0,
      escalateMs: 0,
    });
    expect(out.realerted + out.escalated).toBe(0);
  });

  it("sends a PHI-free SMS fallback on escalation, and honors the org off-switch", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    await ctx.storage.updateUser(chenId, { phone: "+15550001111" });
    const { agent: er } = await login(ctx.app, { username: "er.doc" });

    // Default ON → escalating an unacked STAT sends a content-free SMS nudge.
    const convo = await directConvo(er, chenId);
    await er
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "STAT bed 4 GSW", priority: "stat" })
      .expect(201);
    ctx.sms.sent = [];
    await runStatEscalationSweep(ctx.storage, { realertMs: 0, escalateMs: 0 });
    const nudge = ctx.sms.sent.find((m) => m.to === "+15550001111");
    expect(nudge).toBeTruthy();
    expect(nudge!.body).not.toMatch(/bed|GSW|STAT|patient/i); // no PHI / no content

    // Developer/operator turns it off for the org → no SMS on the next escalation.
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director
      .patch("/api/settings/org")
      .send({ key: "statSmsFallback", value: false })
      .expect(200);
    const convo2 = await directConvo(er, chenId);
    await er
      .post("/api/messaging/send")
      .send({ conversationId: convo2.id, content: "STAT again", priority: "stat" })
      .expect(201);
    ctx.sms.sent = [];
    await runStatEscalationSweep(ctx.storage, { realertMs: 0, escalateMs: 0 });
    expect(ctx.sms.sent.length).toBe(0);
  });

  it("acknowledged STATs never re-alert or escalate", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: chenAgent } = await login(ctx.app, { username: "chen" });

    const convo = await directConvo(er, chenId);
    const sent = await er
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "STAT", priority: "stat" });
    await chenAgent
      .post("/api/messaging/messages/ack")
      .send({ messageIds: [sent.body.id] })
      .expect(204);

    const out = await runStatEscalationSweep(ctx.storage, {
      realertMs: 0,
      escalateMs: 0,
    });
    expect(out.realerted).toBe(0);
    expect(out.escalated).toBe(0);
  });

  it("with no covering provider, escalation audits the gap instead of inventing a target", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const convo = await directConvo(er, chenId);
    await er
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "STAT", priority: "stat" });

    const out = await runStatEscalationSweep(ctx.storage, {
      realertMs: 0,
      escalateMs: 0,
    });
    expect(out.escalated).toBe(0); // nowhere to go
    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    expect(
      audit.some((a) => a.action === "message.stat_escalation_no_covering"),
    ).toBe(true);
    // …and it doesn't retry forever: second sweep is quiet.
    const again = await runStatEscalationSweep(ctx.storage, {
      realertMs: 0,
      escalateMs: 0,
    });
    expect(again.realerted + again.escalated).toBe(0);
  });

  // A.CON-MIN-18 (end states): the sender's and the recipient's countdowns can
  // only reach "Escalated" live if the sweep TELLS them the escalation step ran
  // — with or without a covering provider — and never by a frame that reads as
  // an acknowledgement.
  const frames = (type: string) =>
    ctx.ws.delivered.filter((d) => (d.message as { type?: string }).type === type);

  it("no covering provider: sender and recipient are told it escalated (STAT_ESCALATED with the stored escalatedAt), and nothing reads as an ack", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const chenId = ctx.seedResult.userIds.chen!;
    const erId = ctx.seedResult.userIds["er.doc"]!;
    const convo = await directConvo(er, chenId);
    const sent = await er
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "STAT no cover", priority: "stat" })
      .expect(201);
    ctx.ws.delivered = [];
    await runStatEscalationSweep(ctx.storage, { realertMs: 0, escalateMs: 0 });

    const [row] = (await ctx.storage.listDeliveryForMessages([sent.body.id])).filter((d) => d.userId === chenId);
    expect(row!.escalatedAt).toBeInstanceOf(Date);
    expect(row!.acknowledgedAt).toBeNull();
    const esc = frames("STAT_ESCALATED");
    expect(esc).toHaveLength(1);
    expect(new Set(esc[0]!.userIds)).toEqual(new Set([erId, chenId]));
    expect(esc[0]!.message).toEqual({
      type: "STAT_ESCALATED",
      messageId: sent.body.id,
      conversationId: convo.id,
      userId: chenId,
      escalatedAt: row!.escalatedAt!.toISOString(),
      coveringUserId: null,
      coveringRowAdded: false,
    });
    // The re-alert frame carries the stored time too.
    const [realert] = frames("STAT_REALERT");
    expect(realert!.message).toMatchObject({ userId: chenId, at: row!.realertedAt!.toISOString() });
    expect(frames("MESSAGE_ACK")).toHaveLength(0);
  });

  it("group thread whose covering provider is a member: no MESSAGE_ACK, nobody's row acknowledged; sender + recipient get STAT_ESCALATED", async () => {
    const patelId = ctx.seedResult.userIds.patel!;
    const chenId = ctx.seedResult.userIds.chen!;
    const lopezId = ctx.seedResult.userIds.lopez!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.patch("/api/settings/me").send({ key: "coveringUserId", value: lopezId }).expect(200);
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const group = await patel
      .post("/api/messaging/conversations")
      .send({ type: "group", name: "Night team", participantIds: [chenId, lopezId] })
      .expect(201);
    const sent = await patel
      .post("/api/messaging/send")
      .send({ conversationId: group.body.id, content: "STAT group", priority: "stat" })
      .expect(201);
    ctx.ws.delivered = [];
    const out = await runStatEscalationSweep(ctx.storage, { realertMs: 0, escalateMs: 0 });
    expect(out.escalated).toBe(1); // chen → lopez (lopez has no covering of their own)

    // The sweep never claims an acknowledgement.
    expect(frames("MESSAGE_ACK")).toHaveLength(0);
    const rows = await ctx.storage.listDeliveryForMessages([sent.body.id]);
    const recipients = rows.filter((d) => d.userId !== patelId);
    expect(recipients.map((d) => d.userId).sort()).toEqual([chenId, lopezId].sort());
    for (const d of recipients) {
      expect(d.acknowledgedAt).toBeNull();
      expect(d.escalatedAt).toBeInstanceOf(Date);
    }
    // What the sender's thread shows after the sweep: 0 acks.
    const thread = (await patel.get(`/api/messaging/conversations/${group.body.id}/messages`).expect(200)).body as Array<{ id: number; ackCount: number }>;
    expect(thread.find((m) => m.id === sent.body.id)!.ackCount).toBe(0);

    // Each escalated row is announced to the sender and that recipient.
    const toSender = frames("STAT_ESCALATED").filter((f) => f.userIds.includes(patelId));
    const byUser = new Map(toSender.map((f) => [(f.message as { userId: number }).userId, f]));
    expect(new Set(byUser.keys())).toEqual(new Set([chenId, lopezId]));
    const chenRow = recipients.find((d) => d.userId === chenId)!;
    expect(new Set(byUser.get(chenId)!.userIds)).toEqual(new Set([patelId, chenId]));
    expect(byUser.get(chenId)!.message).toMatchObject({
      messageId: sent.body.id,
      conversationId: group.body.id,
      userId: chenId,
      escalatedAt: chenRow.escalatedAt!.toISOString(),
      coveringUserId: lopezId,
      coveringRowAdded: false,
    });
    expect(byUser.get(lopezId)!.message).toMatchObject({ userId: lopezId, coveringUserId: null });
    // The covering provider still gets their own pointer at the message.
    const cover = frames("STAT_ESCALATED").find((f) => f.userIds.length === 1 && f.userIds[0] === lopezId && (f.message as { forUserId?: number }).forUserId === chenId);
    expect(cover!.message).toMatchObject({ messageId: sent.body.id, conversationId: group.body.id, originalMessageId: sent.body.id, forUserId: chenId });
  });

  it("DND forwards new messages to the covering provider at send time — via a covering thread, never by joining the 1:1", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const erId = ctx.seedResult.userIds["er.doc"]!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const { agent: chenAgent } = await login(ctx.app, { username: "chen" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });

    // Pre-DND history the covering provider must NEVER see.
    const convo = await directConvo(er, chenId);
    await er.post("/api/messaging/send").send({ conversationId: convo.id, content: "private history before DND" }).expect(201);

    await chenAgent.patch("/api/settings/me").send({ key: "dnd", value: true }).expect(200);
    await chenAgent
      .patch("/api/settings/me")
      .send({ key: "coveringUserId", value: patelId })
      .expect(200);

    ctx.push.sent = [];
    const sent = await er
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "Are you rounding?" });
    expect(sent.status).toBe(201);
    expect(sent.body.forwardedTo).toContain(patelId);

    // The original thread is unchanged: still er.doc ↔ chen only; patel is
    // forbidden from it and the pre-DND history stays private.
    const updated = await ctx.storage.getConversation(orgId, convo.id);
    expect(updated!.participantIds.sort()).toEqual([erId, chenId].sort());
    expect((await patel.get(`/api/messaging/conversations/${convo.id}/messages`)).status).toBe(403);
    const delivery = await ctx.storage.listDeliveryForMessages([sent.body.id]);
    expect(delivery.some((d) => d.userId === patelId)).toBe(false);

    // Patel got a copy in an er.doc ↔ patel thread, with provenance, unread,
    // and only the message sent while coverage was active.
    const coveringThread = await directThreadBetween(patel, erId);
    expect(coveringThread).toBeTruthy();
    const copies = (await patel.get(`/api/messaging/conversations/${coveringThread!.id}/messages`).expect(200)).body as Array<{
      id: number; content: string; senderId: number; forwardedFrom: Record<string, unknown> | null;
    }>;
    expect(copies.map((m) => m.content)).toEqual(["Are you rounding?"]);
    expect(copies[0]!.senderId).toBe(erId);
    expect(copies[0]!.forwardedFrom).toMatchObject({
      messageId: sent.body.id,
      conversationId: convo.id,
      senderId: erId,
      coveringFor: chenId,
      reason: "dnd",
    });
    const copyDelivery = await ctx.storage.listDeliveryForMessages([copies[0]!.id]);
    expect(copyDelivery.some((d) => d.userId === patelId && !d.readAt)).toBe(true);
    // Live + push to the covering provider; the audit row names the copy.
    expect(ctx.ws.delivered.some((d) => (d.message as { type?: string }).type === "MESSAGE_RECEIVED" && d.userIds.includes(patelId))).toBe(true);
    expect(ctx.push.sent.some((p) => p.userId === patelId)).toBe(true);
    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    const row = audit.find((a) => a.action === "message.dnd_forwarded");
    expect(row).toBeTruthy();
    expect(row!.details).toMatchObject({ dndUserId: chenId, coveringUserId: patelId, coveringConversationId: coveringThread!.id, coveringMessageId: copies[0]!.id });

    // A second message reuses the same covering thread (no duplicate threads)
    // and the sender sees the copies in it too.
    await er.post("/api/messaging/send").send({ conversationId: convo.id, content: "second" }).expect(201);
    const threads = (await patel.get("/api/messaging/conversations").expect(200)).body as Array<{ type: string; participantIds: number[] }>;
    expect(threads.filter((c) => c.type === "direct" && c.participantIds.includes(erId))).toHaveLength(1);
    const erView = (await er.get(`/api/messaging/conversations/${coveringThread!.id}/messages`).expect(200)).body as Array<{ content: string }>;
    expect(erView.map((m) => m.content)).toEqual(["Are you rounding?", "second"]);
  });

  it("a STAT forwarded at send time is not copied again when the sweep escalates it", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const erId = ctx.seedResult.userIds["er.doc"]!;
    const { agent: chenAgent } = await login(ctx.app, { username: "chen" });
    await chenAgent.patch("/api/settings/me").send({ key: "dnd", value: true }).expect(200);
    await chenAgent.patch("/api/settings/me").send({ key: "coveringUserId", value: patelId }).expect(200);
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = await directConvo(er, chenId);
    await er.post("/api/messaging/send").send({ conversationId: convo.id, content: "STAT now", priority: "stat" }).expect(201);

    const out = await runStatEscalationSweep(ctx.storage, { realertMs: 0, escalateMs: 0 });
    expect(out.escalated).toBe(1);
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const coveringThread = await directThreadBetween(patel, erId);
    const copies = (await patel.get(`/api/messaging/conversations/${coveringThread!.id}/messages`).expect(200)).body as Array<{ content: string }>;
    expect(copies.filter((m) => m.content === "STAT now")).toHaveLength(1);
  });

  it("does nothing — no re-alert, escalation, SMS or audit — when messaging.escalation is off for the org", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    await ctx.storage.updateUser(chenId, { phone: "+15550002222" });
    const { agent: chenAgent } = await login(ctx.app, { username: "chen" });
    await chenAgent.patch("/api/settings/me").send({ key: "coveringUserId", value: patelId }).expect(200);
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = await directConvo(er, chenId);
    const sent = await er.post("/api/messaging/send").send({ conversationId: convo.id, content: "STAT bed 9", priority: "stat" });
    expect(sent.status).toBe(201);

    // Developer switches the module off for this org.
    await ctx.storage.setOrgSetting(orgId, "modules", { "messaging.escalation": false }, null);
    invalidateModules();

    ctx.ws.delivered = [];
    ctx.push.sent = [];
    ctx.sms.sent = [];
    const auditBefore = (await ctx.storage.listAuditLogs(orgId, 200)).length;
    const out = await runStatEscalationSweep(ctx.storage, { realertMs: 0, escalateMs: 0 });
    expect(out).toEqual({ realerted: 0, escalated: 0, skippedModuleOff: 1 });
    expect(ctx.ws.delivered.filter((d) => ["STAT_REALERT", "STAT_ESCALATED", "MESSAGE_RECEIVED", "MESSAGE_ACK"].includes((d.message as { type: string }).type))).toHaveLength(0);
    expect(ctx.push.sent).toHaveLength(0);
    expect(ctx.sms.sent).toHaveLength(0);
    expect((await ctx.storage.listAuditLogs(orgId, 200)).length).toBe(auditBefore);
    // Delivery row untouched (so switching back on resumes the loop) and the
    // original thread unchanged.
    const [row] = await ctx.storage.listDeliveryForMessages([sent.body.id]).then((r) => r.filter((d) => d.userId === chenId));
    expect(row!.realertedAt).toBeNull();
    expect(row!.escalatedAt).toBeNull();
    expect((await ctx.storage.getConversation(orgId, convo.id))!.participantIds).toEqual(convo.participantIds);

    // Switch back on → the loop resumes for the still-unacked STAT.
    await ctx.storage.setOrgSetting(orgId, "modules", { "messaging.escalation": true }, null);
    invalidateModules();
    const resumed = await runStatEscalationSweep(ctx.storage, { realertMs: 0, escalateMs: 0 });
    expect(resumed.realerted).toBe(1);
    expect(resumed.escalated).toBe(1);
    expect(resumed.skippedModuleOff).toBe(0);
  });

  it("the switch is transitive: messaging.priority off also stops the escalation loop", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = await directConvo(er, chenId);
    await er.post("/api/messaging/send").send({ conversationId: convo.id, content: "STAT", priority: "stat" }).expect(201);
    await ctx.storage.setOrgSetting(orgId, "modules", { "messaging.priority": false }, null);
    invalidateModules();
    const out = await runStatEscalationSweep(ctx.storage, { realertMs: 0, escalateMs: 0 });
    expect(out.realerted + out.escalated).toBe(0);
    expect(out.skippedModuleOff).toBe(1);
  });

  it("exposes a peer's availability (DND + covering) for the 1:1 banner", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: chenAgent } = await login(ctx.app, { username: "chen" });
    await chenAgent.patch("/api/settings/me").send({ key: "dnd", value: true }).expect(200);
    await chenAgent
      .patch("/api/settings/me")
      .send({ key: "coveringUserId", value: patelId })
      .expect(200);

    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const res = await er.get(`/api/messaging/availability/${chenId}`);
    expect(res.status).toBe(200);
    expect(res.body.dnd).toBe(true);
    expect(res.body.covering?.userId).toBe(patelId);

    // Clearing DND clears the covering in the response.
    await chenAgent.patch("/api/settings/me").send({ key: "dnd", value: false }).expect(200);
    const res2 = await er.get(`/api/messaging/availability/${chenId}`);
    expect(res2.body.dnd).toBe(false);
    expect(res2.body.covering).toBe(null);
  });

  it("on-call targets substitute the covering provider for a DND holder", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: director } = await login(ctx.app, { username: "director" });
    const chenName = (await ctx.storage.getUser(orgId, chenId))!.displayName;

    // Publish a consult service with Chen on call (by display name).
    await director
      .patch("/api/org/preferences")
      .send({ consultServices: [{ id: "cardio", name: "Cardiology", onCall: { name: chenName } }] })
      .expect(200);

    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    let targets = (await er.get("/api/messaging/on-call-targets")).body as Array<{
      kind: string; userId: number; label: string;
    }>;
    const before = targets.find((t) => t.kind === "consult_service");
    expect(before?.userId).toBe(chenId);

    // Chen goes DND with Patel covering → the same role now routes to Patel.
    const { agent: chenAgent } = await login(ctx.app, { username: "chen" });
    await chenAgent.patch("/api/settings/me").send({ key: "dnd", value: true }).expect(200);
    await chenAgent
      .patch("/api/settings/me")
      .send({ key: "coveringUserId", value: patelId })
      .expect(200);

    targets = (await er.get("/api/messaging/on-call-targets")).body;
    const after = targets.find((t) => t.kind === "consult_service");
    expect(after?.userId).toBe(patelId);
    expect(after?.label).toContain("covering");
  });
});
