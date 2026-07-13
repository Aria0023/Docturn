import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { runStatEscalationSweep } from "../server/services/escalation.js";

/**
 * STAT non-response loop + DND covering forwarding.
 * The sweep is invoked directly with zero thresholds (age > 0ms immediately),
 * against the same seeded app the API agents talk to.
 */
describe("stat escalation + dnd forwarding", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

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

    // Sweep 2: escalation — covering provider joins + is delivered the message.
    out = await runStatEscalationSweep(ctx.storage, {
      realertMs: 0,
      escalateMs: 0,
    });
    expect(out.escalated).toBe(1);
    const updated = await ctx.storage.getConversation(
      orgId,
      convo.id,
    );
    expect(updated!.participantIds).toContain(patelId);
    const delivery = await ctx.storage.listDeliveryForMessages([messageId]);
    expect(delivery.some((d) => d.userId === patelId)).toBe(true);
    expect(
      ctx.ws.delivered.some(
        (d) =>
          (d.message as { type?: string }).type === "STAT_ESCALATED" &&
          d.userIds.includes(patelId),
      ),
    ).toBe(true);
    // Audit row records the escalation with ids only (no PHI).
    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    expect(audit.some((a) => a.action === "message.stat_escalated")).toBe(true);

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

  it("DND forwards new messages to the covering provider at send time", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: chenAgent } = await login(ctx.app, { username: "chen" });
    await chenAgent.patch("/api/settings/me").send({ key: "dnd", value: true }).expect(200);
    await chenAgent
      .patch("/api/settings/me")
      .send({ key: "coveringUserId", value: patelId })
      .expect(200);

    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = await directConvo(er, chenId);
    const sent = await er
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "Are you rounding?" });
    expect(sent.status).toBe(201);
    expect(sent.body.forwardedTo).toContain(patelId);

    // Covering provider became a participant and received a delivery row.
    const updated = await ctx.storage.getConversation(orgId, convo.id);
    expect(updated!.participantIds).toContain(patelId);
    const delivery = await ctx.storage.listDeliveryForMessages([sent.body.id]);
    expect(delivery.some((d) => d.userId === patelId && !d.readAt)).toBe(true);
    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    expect(audit.some((a) => a.action === "message.dnd_forwarded")).toBe(true);
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
