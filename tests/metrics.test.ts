import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * Org-scoped clinical-comms KPIs behind GET /api/metrics/comms:
 * { messages7d, statAckAvgSec, consultResponseAvgSec }.
 */
let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

async function directConvo(
  agent: import("supertest").Agent,
  otherUserId: number,
) {
  const res = await agent
    .post("/api/messaging/conversations")
    .send({ type: "direct", participantIds: [otherUserId] });
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

describe("comms metrics", () => {
  it("requires authentication", async () => {
    const res = await supertest(ctx.app).get("/api/metrics/comms");
    expect(res.status).toBe(401);
  });

  it("returns the KPI shape and counts a freshly-sent message", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const patelId = ctx.seedResult.userIds.patel!;

    const before = await chen.get("/api/metrics/comms");
    expect(before.status).toBe(200);
    expect(before.body).toHaveProperty("messages7d");
    expect(before.body).toHaveProperty("statAckAvgSec");
    expect(before.body).toHaveProperty("consultResponseAvgSec");
    const baseline = before.body.messages7d as number;

    const convo = await directConvo(chen, patelId);
    await chen
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "hello patel" })
      .expect(201);

    const after = await chen.get("/api/metrics/comms");
    expect(after.body.messages7d).toBe(baseline + 1);
  });

  it("statAckAvgSec is null with no STAT acks, non-null once a STAT is acknowledged", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const chenId = ctx.seedResult.userIds.chen!;

    // No STAT acknowledged yet → null.
    const before = await er.get("/api/metrics/comms");
    expect(before.status).toBe(200);
    expect(before.body.statAckAvgSec).toBeNull();

    // ER sends a STAT to chen; chen acknowledges it.
    const convo = await directConvo(er, chenId);
    const sent = await er
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "STAT bed 4", priority: "stat" });
    expect(sent.status).toBe(201);
    await chen
      .post("/api/messaging/messages/ack")
      .send({ messageIds: [sent.body.id] })
      .expect(204);

    const after = await er.get("/api/metrics/comms");
    expect(after.body.statAckAvgSec).not.toBeNull();
    expect(after.body.statAckAvgSec).toBeGreaterThanOrEqual(0);
  });

  it("is org-scoped — a user in another org sees none of this org's messages", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const patelId = ctx.seedResult.userIds.patel!;
    const convo = await directConvo(chen, patelId);
    await chen
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "ispn only" })
      .expect(201);

    const ispn = await chen.get("/api/metrics/comms");
    expect(ispn.body.messages7d).toBeGreaterThan(0);

    // The developer lives in the separate platform org (DOCTURN) — its metrics
    // must not include any of ISPN's messages.
    const { agent: dev } = await login(ctx.app, {
      orgCode: "DOCTURN",
      username: "dev",
    });
    const platform = await dev.get("/api/metrics/comms");
    expect(platform.status).toBe(200);
    expect(platform.body.messages7d).toBe(0);
  });
});
