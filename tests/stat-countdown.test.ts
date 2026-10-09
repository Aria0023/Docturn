import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { runStatEscalationSweep } from "../server/services/escalation.js";
import { invalidateModules } from "../server/modules.js";

/**
 * A.CON-MIN-18 (second half): an unacknowledged STAT can show a real re-alert /
 * escalation countdown only if the client knows the intervals the server's
 * sweep actually applies. GET /api/settings exposes them (the same values the
 * sweep reads — STAT_REALERT_MS / STAT_ESCALATE_MS or the 2 / 5 min defaults),
 * and each recipient delivery row says when the re-alert / escalation fired.
 */
let ctx: TestContext;
const saved = { r: process.env.STAT_REALERT_MS, e: process.env.STAT_ESCALATE_MS };
beforeEach(async () => {
  ctx = await createTestApp();
  invalidateModules();
});
afterEach(() => {
  if (saved.r === undefined) delete process.env.STAT_REALERT_MS; else process.env.STAT_REALERT_MS = saved.r;
  if (saved.e === undefined) delete process.env.STAT_ESCALATE_MS; else process.env.STAT_ESCALATE_MS = saved.e;
});

describe("STAT re-alert / escalation timing", () => {
  it("GET /api/settings reports the default intervals the sweep uses", async () => {
    delete process.env.STAT_REALERT_MS;
    delete process.env.STAT_ESCALATE_MS;
    const { agent } = await login(ctx.app, { username: "chen" });
    const r = await agent.get("/api/settings").expect(200);
    expect(r.body.org.statRealertMs).toBe(120_000);
    expect(r.body.org.statEscalateMs).toBe(300_000);
  });

  it("an operator override is what both the API and the sweep use", async () => {
    process.env.STAT_REALERT_MS = "1";
    process.env.STAT_ESCALATE_MS = "600000";
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const r = await er.get("/api/settings").expect(200);
    expect(r.body.org.statRealertMs).toBe(1);
    expect(r.body.org.statEscalateMs).toBe(600_000);

    const chenId = ctx.seedResult.userIds.chen!;
    const convo = await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [chenId] });
    const sent = await er.post("/api/messaging/send").send({ conversationId: convo.body.id, content: "STAT: call me", priority: "stat" });
    expect(sent.status).toBe(201);
    await new Promise((res) => setTimeout(res, 5));
    // No explicit thresholds: the sweep reads the same configuration.
    const out = await runStatEscalationSweep(ctx.storage);
    expect(out.realerted).toBe(1);
    expect(out.escalated).toBe(0);
    // Recipient AND sender hear about it (the sender's countdown moves on).
    const erId = ctx.seedResult.userIds["er.doc"]!;
    const frame = ctx.ws.delivered.find((d) => (d.message as any).type === "STAT_REALERT");
    expect(frame).toBeTruthy();
    expect(new Set(frame!.userIds)).toEqual(new Set([chenId, erId]));
    expect(frame!.message).toMatchObject({ messageId: sent.body.id, conversationId: convo.body.id, userId: chenId });

    // The sender's thread shows WHEN the re-alert fired (and no escalation yet).
    const thread = await er.get(`/api/messaging/conversations/${convo.body.id}/messages`).expect(200);
    const d = thread.body.find((m: any) => m.id === sent.body.id).deliveries[0];
    expect(d.userId).toBe(chenId);
    expect(typeof d.realertedAt).toBe("string");
    expect(d.escalatedAt).toBeNull();
  });

  it("an invalid override falls back to the defaults (never 0 / NaN)", async () => {
    process.env.STAT_REALERT_MS = "soon";
    process.env.STAT_ESCALATE_MS = "-5";
    const { agent } = await login(ctx.app, { username: "chen" });
    const r = await agent.get("/api/settings").expect(200);
    expect(r.body.org.statRealertMs).toBe(120_000);
    expect(r.body.org.statEscalateMs).toBe(300_000);
  });
});
