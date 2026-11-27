import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { ensureDemoTenants } from "../server/seed.js";
import { setModule } from "../server/modules.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * Done (PerfectServe parity #3, module messaging.done): a per-user,
 * per-conversation state on the server. A done thread leaves the caller's
 * main list into the Done filter (the list says `done: true`) and does not
 * count as unread (unreadCount 0) — for that user only; a new message in the
 * thread re-opens it with no write; the change reaches the caller's other
 * devices over the WS hub.
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});
const ids = () => ctx.seedResult.userIds;
const tick = () => new Promise((r) => setTimeout(r, 15));

async function thread() {
  const { agent: er } = await login(ctx.app, { username: "er.doc" });
  const { agent: chen } = await login(ctx.app, { username: "chen" });
  const c = (await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [ids().chen] })).body;
  await er.post("/api/messaging/send").send({ conversationId: c.id, content: "one" });
  await er.post("/api/messaging/send").send({ conversationId: c.id, content: "two" });
  return { er, chen, id: c.id as number };
}
const row = async (agent: any, id: number) => ((await agent.get("/api/messaging/conversations")).body as any[]).find((c) => c.id === id);

describe("Done", () => {
  it("marks a thread done for me only: done, not unread, synced to my devices, audited", async () => {
    const { er, chen, id } = await thread();
    expect(await row(chen, id)).toMatchObject({ done: false, doneAt: null, unreadCount: 2 });

    ctx.ws.delivered.length = 0;
    const res = await chen.put(`/api/messaging/conversations/${id}/done`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ conversationId: id, done: true });
    expect(typeof res.body.doneAt).toBe("string");
    // Done THROUGH the newest message — the client re-opens on anything newer.
    const newest = (await row(chen, id)).lastMessage.id;
    expect(res.body.doneThroughMessageId).toBe(newest);

    expect(await row(chen, id)).toMatchObject({ done: true, unreadCount: 0 });
    // The other participant's view is untouched.
    expect(await row(er, id)).toMatchObject({ done: false });
    // My other devices hear it (and nobody else does).
    const frames = ctx.ws.delivered.filter((d: any) => d.message?.type === "CONVERSATION_DONE_CHANGED");
    expect(frames).toHaveLength(1);
    expect(frames[0]!.userIds).toEqual([ids().chen]);
    expect(frames[0]!.message).toMatchObject({ conversationId: id, done: true });
    // The sync summary agrees.
    const sync = (await chen.get("/api/messaging/sync")).body.conversations.find((c: any) => c.id === id);
    expect(sync).toMatchObject({ done: true, unreadCount: 0 });
    // Read receipts are NOT faked: the sender still sees the messages unread.
    const msgs = (await er.get(`/api/messaging/conversations/${id}/messages`)).body as any[];
    expect(msgs.every((m) => (m.deliveries || []).filter((d: any) => d.userId === ids().chen).every((d: any) => !d.readAt))).toBe(true);

    const audit = (await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 200)).find((a) => a.action === "conversation.done");
    expect(audit).toMatchObject({ userId: ids().chen, resourceType: "conversation", resourceId: id, riskLevel: "low" });

    // Undo → back in the main list, unread again.
    ctx.ws.delivered.length = 0;
    const undo = await chen.delete(`/api/messaging/conversations/${id}/done`);
    expect(undo.status).toBe(200);
    expect(undo.body).toMatchObject({ conversationId: id, done: false, doneAt: null });
    expect(await row(chen, id)).toMatchObject({ done: false, unreadCount: 2 });
    expect(ctx.ws.delivered.some((d: any) => d.message?.type === "CONVERSATION_DONE_CHANGED" && d.message.done === false)).toBe(true);
  });

  it("a new message in the thread re-opens it (from either side), with no extra write", async () => {
    const { er, chen, id } = await thread();
    await chen.put(`/api/messaging/conversations/${id}/done`).expect(200);
    await tick();
    await er.post("/api/messaging/send").send({ conversationId: id, content: "three" }).expect(201);
    expect(await row(chen, id)).toMatchObject({ done: false, unreadCount: 3 });
    // Marking done again, then my own reply, re-opens it too.
    await chen.put(`/api/messaging/conversations/${id}/done`).expect(200);
    await tick();
    await chen.post("/api/messaging/send").send({ conversationId: id, content: "mine" }).expect(201);
    expect(await row(chen, id)).toMatchObject({ done: false });
  });

  it("only a participant, only in my org: others get 404 and nothing is written", async () => {
    const { id } = await thread();
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    expect((await patel.put(`/api/messaging/conversations/${id}/done`)).status).toBe(404);
    await ensureDemoTenants(ctx.storage);
    const { agent: other } = await login(ctx.app, { username: "director", orgCode: "HOSP" });
    expect((await other.put(`/api/messaging/conversations/${id}/done`)).status).toBe(404);
    expect((await other.delete(`/api/messaging/conversations/${id}/done`)).status).toBe(404);
    expect((await patel.put(`/api/messaging/conversations/abc/done`)).status).toBe(404);
    expect((await patel.put(`/api/messaging/conversations/999999/done`)).status).toBe(404);
    expect(await ctx.storage.doneStatesFor(ctx.seedResult.orgId, ids().patel!, [id])).toEqual(new Map());
    expect((await supertest(ctx.app).put(`/api/messaging/conversations/${id}/done`)).status).toBe(401);
  });

  it("module off: the routes answer 404 module_disabled and a stored Done is not served", async () => {
    const { chen, id } = await thread();
    await chen.put(`/api/messaging/conversations/${id}/done`).expect(200);
    await setModule(ctx.seedResult.orgId, "messaging.done", false);
    const r = await chen.put(`/api/messaging/conversations/${id}/done`);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "module_disabled", module: "messaging.done" });
    expect((await chen.delete(`/api/messaging/conversations/${id}/done`)).status).toBe(404);
    // Off means off: the thread is back in the list and counts as unread.
    expect(await row(chen, id)).toMatchObject({ done: false, doneAt: null, unreadCount: 2 });
    expect((await chen.get("/api/messaging/sync")).body.conversations.find((c: any) => c.id === id)).toMatchObject({ done: false, unreadCount: 2 });
    await setModule(ctx.seedResult.orgId, "messaging.done", true);
    expect(await row(chen, id)).toMatchObject({ done: true, unreadCount: 0 });
  });

  it("the patient purge removes Done rows of the purged patient threads", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const p = (await er.post("/api/patients").send({ initials: "DN", roomNumber: "D1", issueSummary: "synthetic", specialty: "Cardiology" })).body;
    await er.post("/api/assignments").send({ patientId: p.id, mode: "manual", hospitalistId: (await ctx.storage.listHospitalists(ctx.seedResult.orgId)).find((h) => h.userId === ids().chen)!.id });
    const pt = await er.post("/api/messaging/patient-thread").send({ patientId: p.id });
    expect(pt.status).toBeLessThan(300);
    await er.put(`/api/messaging/conversations/${pt.body.id}/done`).expect(200);
    expect(await ctx.storage.doneStatesFor(ctx.seedResult.orgId, ids()["er.doc"]!, [pt.body.id])).toHaveProperty("size", 1);
    // Deleting the patient (the purge path) takes the thread AND its Done rows.
    expect(await ctx.storage.deletePatient(ctx.seedResult.orgId, p.id)).toBeTruthy();
    expect(await ctx.storage.doneStatesFor(ctx.seedResult.orgId, ids()["er.doc"]!, [pt.body.id])).toEqual(new Map());
  });
});
