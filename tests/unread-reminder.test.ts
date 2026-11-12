import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { ensureDemoTenants } from "../server/seed.js";
import { invalidateModules, setModule } from "../server/modules.js";
import { runUnreadReminderSweep } from "../server/services/unread-reminder.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * Unread-message reminder (PerfectServe parity #5, module
 * messaging.unreadReminder): a per-user opt-in + interval (5 / 10 / 15 / 30
 * min) stored on the server (user_reminder_prefs), and a server sweep modelled
 * on the STAT re-alert loop that sends a CONTENT-FREE push to an opted-in user
 * whose messages have stayed unread for at least their interval — at most once
 * per interval, never while they are DND, never for a Done thread, never while
 * the module (or push) is off for their org; one org's failure never stops
 * another's.
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
  invalidateModules(); // the 5 s module cache must not carry a switch across tests
});
afterEach(async () => {
  await ctx.handle.close();
});
const ids = () => ctx.seedResult.userIds;
const org = () => ctx.seedResult.orgId;
const MIN = 60_000;
const at = (min: number) => new Date(Date.now() + min * MIN);
const sentTo = (userId: number) => ctx.push.sent.filter((p) => p.userId === userId);

async function unreadFromEr(content = "synthetic unread") {
  const { agent: er } = await login(ctx.app, { username: "er.doc" });
  const c = (await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [ids().chen] })).body;
  const m = (await er.post("/api/messaging/send").send({ conversationId: c.id, content })).body;
  return { er, convoId: c.id as number, messageId: m.id as number };
}
async function optIn(intervalMin = 5) {
  const { agent: chen } = await login(ctx.app, { username: "chen" });
  await chen.put("/api/messaging/unread-reminder").send({ enabled: true, intervalMin }).expect(200);
  return chen;
}

describe("Unread-message reminder — preference", () => {
  it("is off until I opt in; the interval is one of 5/10/15/30; stored per user; audited", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const r0 = await chen.get("/api/messaging/unread-reminder");
    expect(r0.status).toBe(200);
    expect(r0.body).toEqual({ enabled: false, intervalMin: 10, intervals: [5, 10, 15, 30] });
    const r1 = await chen.put("/api/messaging/unread-reminder").send({ enabled: true, intervalMin: 15 });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ enabled: true, intervalMin: 15 });
    expect((await chen.get("/api/messaging/unread-reminder")).body).toMatchObject({ enabled: true, intervalMin: 15 });
    // Another person's preference is untouched.
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    expect((await patel.get("/api/messaging/unread-reminder")).body).toMatchObject({ enabled: false });
    for (const bad of [{ enabled: true, intervalMin: 7 }, { enabled: "yes", intervalMin: 5 }, { enabled: true }, { enabled: true, intervalMin: 5, userId: 1 }]) {
      expect((await chen.put("/api/messaging/unread-reminder").send(bad)).status).toBe(400);
    }
    const audit = (await ctx.storage.listAuditLogs(org(), 200)).filter((a) => a.action === "reminder.prefs_update");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ userId: ids().chen, riskLevel: "low", details: { enabled: true, intervalMin: 15 } });
    expect((await supertest(ctx.app).get("/api/messaging/unread-reminder")).status).toBe(401);
  });

  it("module off: the routes answer 404 module_disabled", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await setModule(org(), "messaging.unreadReminder", false);
    for (const r of [await chen.get("/api/messaging/unread-reminder"), await chen.put("/api/messaging/unread-reminder").send({ enabled: true, intervalMin: 5 })]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: "module_disabled", module: "messaging.unreadReminder" });
    }
  });
});

describe("Unread-message reminder — sweep", () => {
  it("reminds an opted-in user once their oldest unread is at least the interval old — content-free, once per interval", async () => {
    await unreadFromEr("bed 12 needs a call back");
    await optIn(5);
    ctx.push.sent = [];
    // Too soon: nothing.
    expect((await runUnreadReminderSweep(ctx.storage, { now: at(2) })).reminded).toBe(0);
    // Past the interval: one content-free push.
    expect((await runUnreadReminderSweep(ctx.storage, { now: at(6) })).reminded).toBe(1);
    const pushes = sentTo(ids().chen!);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.title).toBe("You have unread messages in DocTurn");
    expect(JSON.stringify(ctx.push.sent)).not.toMatch(/bed 12|Reyes|Alyesh/);
    expect((await ctx.storage.getReminderPrefs(org(), ids().chen!))!.lastRemindedAt).toBeTruthy();
    // Within the next interval: not again. After it, still unread: again.
    expect((await runUnreadReminderSweep(ctx.storage, { now: at(9) })).reminded).toBe(0);
    expect((await runUnreadReminderSweep(ctx.storage, { now: at(12) })).reminded).toBe(1);
    // Nobody else was pushed.
    expect(ctx.push.sent.every((p) => p.userId === ids().chen)).toBe(true);
  });

  it("no reminder once the messages are read, or for someone who did not opt in", async () => {
    const { messageId } = await unreadFromEr();
    const chen = await optIn(5);
    await chen.post("/api/messaging/messages/mark-read").send({ messageIds: [messageId] }).expect(204);
    ctx.push.sent = [];
    expect((await runUnreadReminderSweep(ctx.storage, { now: at(30) })).reminded).toBe(0);
    // Patel never opted in, though he has unread messages.
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const c = (await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [ids().patel] })).body;
    await er.post("/api/messaging/send").send({ conversationId: c.id, content: "x" });
    expect((await runUnreadReminderSweep(ctx.storage, { now: at(30) })).reminded).toBe(0);
    // (The send itself pushes its own new-message alert; no REMINDER went out.)
    expect(ctx.push.sent.filter((p) => p.title === "You have unread messages in DocTurn")).toHaveLength(0);
  });

  it("respects DND, a deactivated account, and an opted-out user", async () => {
    await unreadFromEr();
    const chen = await optIn(5);
    await chen.patch("/api/settings/me").send({ key: "dnd", value: true }).expect(200);
    ctx.push.sent = [];
    expect((await runUnreadReminderSweep(ctx.storage, { now: at(10) })).reminded).toBe(0);
    await chen.patch("/api/settings/me").send({ key: "dnd", value: false }).expect(200);
    await chen.put("/api/messaging/unread-reminder").send({ enabled: false, intervalMin: 5 }).expect(200);
    expect((await runUnreadReminderSweep(ctx.storage, { now: at(10) })).reminded).toBe(0);
    await chen.put("/api/messaging/unread-reminder").send({ enabled: true, intervalMin: 5 }).expect(200);
    await ctx.storage.updateUser(ids().chen!, { disabledAt: new Date() });
    expect((await runUnreadReminderSweep(ctx.storage, { now: at(10) })).reminded).toBe(0);
    expect(ctx.push.sent).toHaveLength(0);
  });

  it("a Done thread does not count (while messaging.done is on)", async () => {
    const { convoId } = await unreadFromEr();
    const chen = await optIn(5);
    await chen.put(`/api/messaging/conversations/${convoId}/done`).expect(200);
    ctx.push.sent = [];
    expect((await runUnreadReminderSweep(ctx.storage, { now: at(10) })).reminded).toBe(0);
    // Done switched off: off means off — the thread counts again.
    await setModule(org(), "messaging.done", false);
    expect((await runUnreadReminderSweep(ctx.storage, { now: at(10) })).reminded).toBe(1);
  });

  it("module off or push off for the org: nothing is sent and nothing is marked", async () => {
    await unreadFromEr();
    await optIn(5);
    ctx.push.sent = [];
    await setModule(org(), "messaging.unreadReminder", false);
    const out = await runUnreadReminderSweep(ctx.storage, { now: at(10) });
    expect(out.reminded).toBe(0);
    expect(out.skippedModuleOff).toBeGreaterThanOrEqual(1);
    await setModule(org(), "messaging.unreadReminder", true);
    await setModule(org(), "integration.push", false);
    expect((await runUnreadReminderSweep(ctx.storage, { now: at(10) })).reminded).toBe(0);
    expect(ctx.push.sent).toHaveLength(0);
    expect((await ctx.storage.getReminderPrefs(org(), ids().chen!))!.lastRemindedAt).toBeNull();
  });

  it("one org's failure does not stop another org's reminders (per-org try/catch)", async () => {
    await unreadFromEr();
    await optIn(5);
    await ensureDemoTenants(ctx.storage);
    const other = (await ctx.storage.listOrganizations()).find((o) => o.code === "HOSP")!;
    const users = await ctx.storage.listUsers(other.id);
    const sender = users.find((u) => u.role === "er_doctor") ?? users[0]!;
    const target = users.find((u) => u.role === "hospitalist" && u.id !== sender.id)!;
    const conv = await ctx.storage.createConversation({ organizationId: other.id, type: "direct", name: null, participantIds: [sender.id, target.id], patientId: null });
    const msg = await ctx.storage.createMessage({ conversationId: conv.id, organizationId: other.id, senderId: sender.id, content: "x", priority: "routine", forwardedFrom: null });
    await ctx.storage.createDeliveryStatuses([{ messageId: msg.id, userId: target.id, deliveredAt: new Date(), readAt: null, acknowledgedAt: null, realertedAt: null, escalatedAt: null }]);
    await ctx.storage.setReminderPrefs(other.id, target.id, { enabled: true, intervalMin: 5 });
    // ISPN's read blows up; HOSP still gets its reminder.
    const broken = new Proxy(ctx.storage, {
      get(t, k, r) {
        if (k === "listReminderOptIns") return async (orgId: number) => { if (orgId === org()) throw new Error("simulated read failure"); return t.listReminderOptIns(orgId); };
        const v = Reflect.get(t, k, r);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    ctx.push.sent = [];
    const out = await runUnreadReminderSweep(broken as any, { now: at(10) });
    expect(out.failedOrgs).toContain(org());
    expect(out.reminded).toBe(1);
    expect(ctx.push.sent.map((p) => p.userId)).toEqual([target.id]);
  });
});
