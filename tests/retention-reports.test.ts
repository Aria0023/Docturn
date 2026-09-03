import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { messages } from "@shared/schema";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { runMessageRetentionSweep } from "../server/services/retention.js";

describe("message retention + ops reports", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it("purges only messages older than the org window, with an audit row", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = (
      await er
        .post("/api/messaging/conversations")
        .send({ type: "direct", participantIds: [chenId] })
    ).body;
    const oldMsg = (
      await er
        .post("/api/messaging/send")
        .send({ conversationId: convo.id, content: "ancient" })
    ).body;
    const newMsg = (
      await er
        .post("/api/messaging/send")
        .send({ conversationId: convo.id, content: "fresh" })
    ).body;
    // Backdate the first message beyond the window.
    await ctx.handle.db
      .update(messages)
      .set({ createdAt: new Date(Date.now() - 40 * 86_400_000) })
      .where(eq(messages.id, oldMsg.id));

    // No setting → nothing purged (default keeps everything).
    expect(await runMessageRetentionSweep()).toBe(0);

    // Director sets a 30-day window → the old message purges, the new survives.
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director
      .patch("/api/settings/org")
      .send({ key: "messageRetentionDays", value: 30 })
      .expect(200);
    expect(await runMessageRetentionSweep()).toBe(1);

    const remaining = (
      await er.get(`/api/messaging/conversations/${convo.id}/messages`)
    ).body as Array<{ id: number }>;
    expect(remaining.some((m) => m.id === newMsg.id)).toBe(true);
    expect(remaining.some((m) => m.id === oldMsg.id)).toBe(false);

    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    expect(audit.some((a) => a.action === "messages.retention_purged")).toBe(true);
  });

  it("ops report returns director metrics and blocks non-admin roles", async () => {
    // Generate one accepted assignment for latency data.
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const chenHospId = ctx.seedResult.hospitalistIds.chen!;
    const p = (
      await er
        .post("/api/patients")
        .send({ initials: "RP", roomNumber: "3", issueSummary: "cp", acuity: 2 })
    ).body;
    const a = (
      await er
        .post("/api/assignments")
        .send({ patientId: p.id, mode: "manual", hospitalistId: chenHospId })
    ).body;
    await chen.patch(`/api/assignments/${a.id}/accept`).expect(200);

    const { agent: director } = await login(ctx.app, { username: "director" });
    const rpt = (await director.get("/api/reports/ops").expect(200)).body;
    expect(rpt.assignments.total).toBeGreaterThan(0);
    expect(rpt.assignments.byStatus.accepted).toBeGreaterThan(0);
    expect(rpt.assignments.timeToAcceptMinMedian).not.toBeNull();
    expect(rpt.messaging).toHaveProperty("last7d");

    // RBAC: a hospitalist cannot read the org report.
    await chen.get("/api/reports/ops").expect(403);
  });
});
