import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { InvoicePeriodTakenError } from "../server/storage.js";
import { onlineElsewhere, publishPresence, PRESENCE_TTL_MS } from "../server/services/presence.js";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});
const orgId = () => ctx.seedResult.orgId;

describe("a message is written whole or not at all", () => {
  it("send writes the message, its attachment link and every delivery row together", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const convo = await agent.post("/api/messaging/conversations").send({ type: "direct", participantIds: [ctx.seedResult.userIds.patel] });
    const sent = await agent.post("/api/messaging/send").send({ conversationId: convo.body.id, content: "hello", priority: "stat" });
    expect(sent.status).toBe(201);
    const rows = await ctx.storage.listDeliveryForMessages([sent.body.id]);
    expect(rows.map((r) => r.userId).sort()).toEqual([ctx.seedResult.userIds.chen, ctx.seedResult.userIds.patel].sort());
    // The sender's own copy is read and acknowledged; the recipient's is neither.
    const mine = rows.find((r) => r.userId === ctx.seedResult.userIds.chen)!;
    const theirs = rows.find((r) => r.userId === ctx.seedResult.userIds.patel)!;
    expect(mine.readAt && mine.acknowledgedAt).toBeTruthy();
    expect(theirs.readAt ?? theirs.acknowledgedAt).toBeNull();
  });

  it("a failure while writing delivery rows leaves no message behind", async () => {
    const convo = await ctx.storage.createConversation({
      organizationId: orgId(), type: "direct", name: null, participantIds: [ctx.seedResult.userIds.chen!, ctx.seedResult.userIds.patel!],
      createdBy: ctx.seedResult.userIds.chen!, patientId: null,
    } as never);
    const count = async () => (await ctx.storage.listMessagesAfter(orgId(), [convo.id], 0, 100)).messages.length;
    const before = await count();
    // A participant id that cannot be stored makes the delivery insert fail.
    await expect(
      ctx.storage.createMessageDelivered(
        { conversationId: convo.id, organizationId: orgId(), senderId: ctx.seedResult.userIds.chen!, content: "x", priority: "routine" } as never,
        [ctx.seedResult.userIds.patel!, 999_999_999],
      ),
    ).rejects.toBeTruthy();
    expect(await count()).toBe(before);
  });
});

describe("an invoice period is billed once", () => {
  it("a second invoice overlapping the period is refused inside the write, and its number is not used up", async () => {
    const base = {
      organizationId: orgId(), contractId: null, periodStart: "2026-01-01", periodEnd: "2026-01-31", currency: "USD",
      lines: [], subtotalCents: 0, totalCents: 0, status: "draft", createdBy: ctx.seedResult.userIds.director!,
    } as never;
    const first = await ctx.storage.createInvoiceWithNumber(base);
    await expect(ctx.storage.createInvoiceWithNumber({ ...(base as object), periodStart: "2026-01-15", periodEnd: "2026-02-14" } as never)).rejects.toBeInstanceOf(InvoicePeriodTakenError);
    // Two at once: exactly one wins.
    const both = await Promise.allSettled([
      ctx.storage.createInvoiceWithNumber({ ...(base as object), periodStart: "2026-03-01", periodEnd: "2026-03-31" } as never),
      ctx.storage.createInvoiceWithNumber({ ...(base as object), periodStart: "2026-03-01", periodEnd: "2026-03-31" } as never),
    ]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const won = both.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ number: string }>;
    // The refused attempts gave their numbers back: the next number follows the first.
    expect(Number(won.value.number.slice(3))).toBe(Number(first.number.slice(3)) + 1);
    // A voided invoice no longer blocks its period.
    await ctx.storage.updateInvoice(first.id, { status: "void" } as never);
    await expect(ctx.storage.createInvoiceWithNumber(base)).resolves.toBeTruthy();
  });
});

describe("who is online, across servers", () => {
  it("counts people another server holds a socket for, until that server stops refreshing", async () => {
    const now = new Date();
    await publishPresence([{ userId: 11, organizationId: orgId() }, { userId: 12, organizationId: orgId() + 1 }], "server-b", now);
    await publishPresence([{ userId: 13, organizationId: orgId() }], "server-a", now);
    expect(await onlineElsewhere(orgId(), "server-a", now)).toEqual([11]);
    expect((await onlineElsewhere(orgId(), "server-b", now))).toEqual([13]);
    // server-b drops user 11 on its next write.
    await publishPresence([], "server-b", now);
    expect(await onlineElsewhere(orgId(), "server-a", now)).toEqual([]);
    // A server that died stops counting after the time-to-live.
    await publishPresence([{ userId: 11, organizationId: orgId() }], "server-b", now);
    expect(await onlineElsewhere(orgId(), "server-a", new Date(now.getTime() + PRESENCE_TTL_MS + 1000))).toEqual([]);
  });

  it("GET /api/presence still answers for a single server", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const res = await agent.get("/api/presence");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.online)).toBe(true);
  });
});
