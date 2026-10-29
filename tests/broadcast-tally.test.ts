import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { broadcastRecipientIds } from "../server/routes/broadcasts.js";

/**
 * A.CON-MIN-3: the ack tally denominator is the recipient set AT SEND TIME,
 * not the live roster — a provider added after the send must not turn a
 * complete "N/N acknowledged" into "N/N+1".
 */
describe("broadcast ack tally denominator", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it("stays fixed when a provider joins after the send; late joiners can still ack without inflating it", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: director } = await login(ctx.app, { username: "director" });
    const rosterBefore = (await ctx.storage.listUsers(orgId)).length;

    const created = await director.post("/api/broadcasts").send({ message: "Code triage drill", severity: "urgent" });
    expect(created.status).toBe(201);
    const expectedTotal = rosterBefore - 1; // everyone but the sender
    expect(created.body.total).toBe(expectedTotal);

    const list1 = (await director.get("/api/broadcasts").expect(200)).body as Array<{ id: number; total: number; ackCount: number }>;
    expect(list1.find((b) => b.id === created.body.id)).toMatchObject({ total: expectedTotal, ackCount: 0 });

    // A new provider joins the org AFTER the send.
    const late = await ctx.storage.createUser({
      organizationId: orgId,
      username: "late.joiner",
      passwordHash: "x",
      role: "hospitalist",
      displayName: "Dr. Late Joiner",
      credential: "MD",
      phone: null,
      twoFactorEnabled: false,
    });
    expect((await ctx.storage.listUsers(orgId)).length).toBe(rosterBefore + 1);

    // Denominator unchanged on the list…
    const list2 = (await director.get("/api/broadcasts").expect(200)).body as Array<{ id: number; total: number; ackCount: number }>;
    expect(list2.find((b) => b.id === created.body.id)!.total).toBe(expectedTotal);

    // …and on the live BROADCAST_ACKED frame when a recipient acks.
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.post(`/api/broadcasts/${created.body.id}/ack`).expect(204);
    // The late joiner can still acknowledge from the catch-up list — but they
    // never count toward (or past) the send-time denominator.
    await ctx.storage.updateUser(late.id, { passwordHash: (await ctx.storage.getUser(orgId, ctx.seedResult.userIds.chen!))!.passwordHash });
    const { agent: lateAgent, res: lateLogin } = await login(ctx.app, { username: "late.joiner" });
    expect(lateLogin.status).toBe(200);
    await lateAgent.post(`/api/broadcasts/${created.body.id}/ack`).expect(204);

    const list3 = (await director.get("/api/broadcasts").expect(200)).body as Array<{ id: number; total: number; ackCount: number; ackedBy: Array<{ userId: number }> }>;
    const b = list3.find((x) => x.id === created.body.id)!;
    expect(b.total).toBe(expectedTotal);
    expect(b.ackCount).toBe(1);
    expect(b.ackedBy.map((a) => a.userId)).toEqual([ctx.seedResult.userIds.chen]);
    expect(b.ackCount).toBeLessThanOrEqual(b.total);
    // The late joiner's own view still shows their ack landed.
    const mine = (await lateAgent.get("/api/broadcasts").expect(200)).body as Array<{ id: number; acked: boolean }>;
    expect(mine.find((x) => x.id === created.body.id)!.acked).toBe(true);

    // A broadcast sent NOW counts the late joiner.
    const second = await director.post("/api/broadcasts").send({ message: "Second", severity: "urgent" });
    expect(second.body.total).toBe(expectedTotal + 1);
  });

  it("the live ack frame uses the same send-time denominator", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: director } = await login(ctx.app, { username: "director" });
    const created = await director.post("/api/broadcasts").send({ message: "x", severity: "critical" });
    const total = created.body.total as number;
    await ctx.storage.createUser({ organizationId: orgId, username: "late2", passwordHash: "x", role: "hospitalist", displayName: "Late Two", credential: "MD", phone: null, twoFactorEnabled: false });
    const frames: unknown[] = [];
    const realBroadcast = ctx.ws.broadcast.bind(ctx.ws);
    ctx.ws.broadcast = (orgIdArg: number, message: unknown) => { frames.push(message); realBroadcast(orgIdArg, message); };
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.post(`/api/broadcasts/${created.body.id}/ack`).expect(204);
    const acked = frames.find((f) => (f as { type?: string }).type === "BROADCAST_ACKED") as { ackCount: number; total: number };
    expect(acked).toBeTruthy();
    expect(acked.total).toBe(total);
    expect(acked.ackCount).toBe(1);
  });

  it("broadcastRecipientIds excludes the sender, later joiners and already-deactivated accounts", () => {
    const t0 = new Date("2026-01-01T12:00:00Z");
    const users = [
      { id: 1, createdAt: new Date("2025-01-01"), disabledAt: null }, // sender
      { id: 2, createdAt: new Date("2025-01-01"), disabledAt: null },
      { id: 3, createdAt: new Date("2026-02-01"), disabledAt: null }, // joined later
      { id: 4, createdAt: new Date("2025-01-01"), disabledAt: new Date("2025-12-01") }, // deactivated before
      { id: 5, createdAt: new Date("2025-01-01"), disabledAt: new Date("2026-03-01") }, // deactivated after → was a recipient
      { id: 6, createdAt: t0, disabledAt: null }, // same instant counts
    ];
    expect([...broadcastRecipientIds(users, { senderId: 1, createdAt: t0 })].sort()).toEqual([2, 5, 6]);
  });
});
