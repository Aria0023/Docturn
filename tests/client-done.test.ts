import { afterEach, describe, expect, it } from "vitest";
import { boot, closeAll, count, sleep, until, ME } from "./client-parity-harness.js";

/**
 * Done, client half (PerfectServe parity #3, module messaging.done) — the real
 * store.js + api-bridge.js in jsdom. The Messages screen itself (filter, header
 * toggle, badge) is measured on iPhones by scripts/done-check.mjs.
 */
afterEach(closeAll);

const msg = (id: number, convo: number, from = 12) => ({
  id, conversationId: convo, senderId: from, content: "m" + id, priority: "routine", createdAt: new Date(Date.now() - 60000 + id).toISOString(),
  deliveries: [{ userId: ME.id, deliveredAt: new Date().toISOString(), readAt: null, acknowledgedAt: null }, { userId: from, readAt: new Date().toISOString() }],
  attachments: [],
});
const convo = (id: number, last: any, extra: any = {}) => ({ id, type: "direct", name: null, participantIds: [ME.id, 12], patientId: null, lastMessage: last, unreadCount: 1, done: false, doneAt: null, doneThroughMessageId: null, ...extra });

async function withThreads(extra: any = {}) {
  const h = await boot({ convos: [convo(1, msg(10, 1)), convo(2, msg(20, 2))] , ...extra });
  await until(() => (h.state().conversations || []).length === 2);
  return h;
}
const c = (h: any, id: number) => h.state().conversations.find((x: any) => x.id === id);

describe("Done (client)", () => {
  it("a thread the server reports done is Done and does not count as unread", async () => {
    const h = await boot({ convos: [convo(1, msg(10, 1)), convo(2, msg(20, 2), { done: true, doneAt: "2026-10-28T00:00:00Z", doneThroughMessageId: 20, unreadCount: 0 })] });
    await until(() => (h.state().conversations || []).length === 2);
    expect(h.w.DT.convoDone(c(h, 2))).toBe(true);
    expect(h.w.DT.convoDone(c(h, 1))).toBe(false);
    expect(h.w.DT.unreadMessages()).toBe(1);
  });

  it("Mark done is ONE server write; the response is applied; Move back undoes it", async () => {
    const h = await withThreads();
    h.routes.done = (r) => (/\/api\/messaging\/conversations\/1\/done$/.test(r.path)
      ? { status: 200, body: r.method === "PUT" ? { conversationId: 1, done: true, doneAt: "2026-10-28T00:00:00Z", doneThroughMessageId: 10 } : { conversationId: 1, done: false, doneAt: null, doneThroughMessageId: null } }
      : undefined);
    expect(h.w.DT.unreadMessages()).toBe(2);
    expect(await h.w.DT.actions.setConversationDone(1, true)).toBe(true);
    expect(count(h, "PUT", "/api/messaging/conversations/1/done")).toBe(1);
    expect(h.w.DT.convoDone(c(h, 1))).toBe(true);
    expect(h.w.DT.unreadMessages()).toBe(1);
    expect(await h.w.DT.actions.setConversationDone(1, false)).toBe(true);
    expect(count(h, "DELETE", "/api/messaging/conversations/1/done")).toBe(1);
    expect(h.w.DT.convoDone(c(h, 1))).toBe(false);
  });

  it("a new message re-opens a done thread (live frame), with no request", async () => {
    const h = await boot({ convos: [convo(1, msg(10, 1), { done: true, doneAt: "2026-10-28T00:00:00Z", doneThroughMessageId: 10, unreadCount: 0 })] });
    await until(() => (h.state().conversations || []).length === 1);
    expect(h.w.DT.convoDone(c(h, 1))).toBe(true);
    const writes = h.reqs.filter((r) => r.method !== "GET").length;
    h.sockets[0].emit({ type: "MESSAGE_RECEIVED", message: msg(11, 1) });
    await until(() => h.w.DT.convoDone(c(h, 1)) === false);
    expect(h.w.DT.unreadMessages()).toBeGreaterThan(0);
    expect(h.reqs.filter((r) => r.method !== "GET").length).toBe(writes);
  });

  it("another device's Done arrives over the socket (CONVERSATION_DONE_CHANGED)", async () => {
    const h = await withThreads();
    h.sockets[0].emit({ type: "CONVERSATION_DONE_CHANGED", conversationId: 2, done: true, doneAt: "2026-10-28T00:00:00Z", doneThroughMessageId: 20 });
    await until(() => h.w.DT.convoDone(c(h, 2)) === true);
    h.sockets[0].emit({ type: "CONVERSATION_DONE_CHANGED", conversationId: 2, done: false, doneAt: null, doneThroughMessageId: null });
    await until(() => h.w.DT.convoDone(c(h, 2)) === false);
  });

  it("module off: nothing is Done on this device; a refused toggle says so and re-reads the switches", async () => {
    const h = await boot({ convos: [convo(1, msg(10, 1), { done: true, doneAt: "2026-10-28T00:00:00Z", doneThroughMessageId: 10, unreadCount: 0 })] });
    await until(() => (h.state().conversations || []).length === 1);
    h.routes.done = (r) => (/\/done$/.test(r.path) ? { status: 404, body: { error: "module_disabled", module: "messaging.done" } } : undefined);
    const before = count(h, "GET", "/api/modules");
    h.modules = { "messaging.done": false };
    expect(await h.w.DT.actions.setConversationDone(1, false)).toBe(false);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", msg: "Done is switched off for your organization." });
    await until(() => count(h, "GET", "/api/modules") > before);
    await until(() => h.w.DT.moduleOn("messaging.done") === false);
    expect(h.w.DT.convoDone(c(h, 1))).toBe(false);
    await sleep(10);
  });
});
