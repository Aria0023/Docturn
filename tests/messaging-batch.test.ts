import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs } from "@shared/schema";
import { invalidateModules } from "../server/modules.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
  invalidateModules();
});
afterEach(async () => {
  await ctx.handle.close();
});

// 1x1 transparent PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function directThread(
  agent: Awaited<ReturnType<typeof login>>["agent"],
  otherId: number,
) {
  const res = await agent
    .post("/api/messaging/conversations")
    .send({ type: "direct", participantIds: [otherId] });
  expect(res.status).toBe(201);
  return res.body as { id: number; participantIds: number[] };
}

describe("broadcast catch-up list + acknowledgement", () => {
  it("lists broadcasts with my ack state; directors see acked/total; ack is idempotent", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const orgUsers = await ctx.storage.listUsers(ctx.seedResult.orgId);

    const created = await director
      .post("/api/broadcasts")
      .send({ message: "Code stroke — ICU bed 4", severity: "critical" });
    expect(created.status).toBe(201);
    const info = await director
      .post("/api/broadcasts")
      .send({ message: "Cafeteria closes early", severity: "info" });
    expect(info.status).toBe(201);

    // Recipient: sees both, critical requires ack, info doesn't; no tally.
    let list = await chen.get("/api/broadcasts");
    expect(list.status).toBe(200);
    const crit = list.body.find((b: { id: number }) => b.id === created.body.id);
    const inf = list.body.find((b: { id: number }) => b.id === info.body.id);
    expect(crit.ackRequired).toBe(true);
    expect(crit.acked).toBe(false);
    expect(crit.senderName).toBe("Dr. Dana Director");
    expect(crit.ackCount).toBeUndefined();
    expect(inf.ackRequired).toBe(false);

    // Ack twice → still one ack counted.
    expect((await chen.post(`/api/broadcasts/${created.body.id}/ack`)).status).toBe(204);
    expect((await chen.post(`/api/broadcasts/${created.body.id}/ack`)).status).toBe(204);
    list = await chen.get("/api/broadcasts");
    expect(list.body.find((b: { id: number }) => b.id === created.body.id).acked).toBe(true);

    // Director: tally + who acked.
    const dlist = await director.get("/api/broadcasts");
    const drow = dlist.body.find((b: { id: number }) => b.id === created.body.id);
    expect(drow.ackCount).toBe(1);
    expect(drow.total).toBe(orgUsers.length - 1);
    expect(drow.ackedBy.map((p: { displayName: string }) => p.displayName)).toContain(
      "Dr. Nathan Alyesh",
    );
    expect(drow.acked).toBe(false); // the director themself hasn't acked

    // Unknown broadcast → 404; ack audited.
    expect((await chen.post("/api/broadcasts/999999/ack")).status).toBe(404);
    const audits = await ctx.handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "broadcast.ack"));
    expect(audits).toHaveLength(1);
  });

  it("is hidden (404 module_disabled) when the broadcasts module is off", async () => {
    await ctx.storage.setOrgSetting(ctx.seedResult.orgId, "modules", { broadcasts: false }, null);
    invalidateModules();
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const res = await chen.get("/api/broadcasts");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("module_disabled");
  });
});

describe("message forwarding", () => {
  it("creates a message with provenance + attachment refs in the target thread", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const lopezId = ctx.seedResult.userIds.lopez!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const { agent: lopez } = await login(ctx.app, { username: "lopez" });

    const convo = await directThread(chen, patelId);
    const up = await chen
      .post("/api/messaging/attachments")
      .send({ fileName: "ecg.png", mimeType: "image/png", dataBase64: PNG_B64 });
    expect(up.status).toBe(201);
    const sent = await chen.post("/api/messaging/send").send({
      conversationId: convo.id,
      content: "Please review this ECG",
      priority: "stat",
      attachmentIds: [up.body.id],
    });
    expect(sent.status).toBe(201);

    // Patel (a participant) forwards to Lopez; default priority is routine.
    const fwd = await patel
      .post(`/api/messaging/messages/${sent.body.id}/forward`)
      .send({ participantIds: [lopezId] });
    expect(fwd.status).toBe(201);
    expect(fwd.body.conversationId).not.toBe(convo.id);
    expect(fwd.body.createdConversation).toBe(true);
    expect(fwd.body.priority).toBe("routine");
    expect(fwd.body.senderId).toBe(patelId);
    expect(fwd.body.forwardedFrom).toMatchObject({
      messageId: sent.body.id,
      senderId: chenId,
      senderName: "Dr. Nathan Alyesh",
      conversationId: convo.id,
      attachmentIds: [up.body.id],
    });
    expect(typeof fwd.body.forwardedFrom.sentAt).toBe("string");

    // Lopez sees it with provenance + a forwarded attachment reference (no
    // second copy of the bytes exists).
    const msgs = await lopez.get(
      `/api/messaging/conversations/${fwd.body.conversationId}/messages`,
    );
    expect(msgs.status).toBe(200);
    expect(msgs.body).toHaveLength(1);
    const m = msgs.body[0];
    expect(m.content).toBe("Please review this ECG");
    expect(m.forwardedFrom.senderName).toBe("Dr. Nathan Alyesh");
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]).toMatchObject({ id: up.body.id, forwarded: true, isImage: true });
    const allAtts = await ctx.storage.listAttachmentMetaByIds(ctx.seedResult.orgId, [up.body.id]);
    expect(allAtts).toHaveLength(1);

    // Target-thread participant can open the referenced bytes via the
    // forwarded-message route…
    const bytes = await lopez.get(m.attachments[0].url);
    expect(bytes.status).toBe(200);
    expect(bytes.headers["content-type"]).toContain("image/png");
    // …but not through the original attachment route (still participant-only
    // on the source thread), and not a random id on this message.
    expect([403, 404]).toContain(
      (await lopez.get(`/api/messaging/attachments/${up.body.id}`)).status,
    );
    expect(
      (await lopez.get(`/api/messaging/messages/${m.id}/attachments/999999`)).status,
    ).toBe(404);
    // A non-participant of the target thread cannot use the forwarded route.
    const { agent: liu } = await login(ctx.app, { username: "liu" });
    expect((await liu.get(m.attachments[0].url)).status).toBe(403);

    // Forwarding again into the SAME person reuses the direct thread; keeping
    // priority preserves STAT.
    const again = await patel
      .post(`/api/messaging/messages/${sent.body.id}/forward`)
      .send({ participantIds: [lopezId], keepPriority: true, note: "FYI" });
    expect(again.status).toBe(201);
    expect(again.body.conversationId).toBe(fwd.body.conversationId);
    expect(again.body.createdConversation).toBe(false);
    expect(again.body.priority).toBe("stat");
    expect(again.body.content).toBe("FYI\nPlease review this ECG");

    // Audit trail.
    const audits = await ctx.handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "message.forward"));
    expect(audits.length).toBe(2);
    expect(audits[0]!.userId).toBe(patelId);
  });

  it("rejects a non-participant (403), the same thread (400) and bad targets", async () => {
    const patelId = ctx.seedResult.userIds.patel!;
    const lopezId = ctx.seedResult.userIds.lopez!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const convo = await directThread(chen, patelId);
    const sent = await chen
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "private" });

    const { agent: lopez } = await login(ctx.app, { username: "lopez" });
    const denied = await lopez
      .post(`/api/messaging/messages/${sent.body.id}/forward`)
      .send({ participantIds: [lopezId] });
    expect(denied.status).toBe(403);

    // Same thread as the source.
    const same = await chen
      .post(`/api/messaging/messages/${sent.body.id}/forward`)
      .send({ conversationId: convo.id });
    expect(same.status).toBe(400);
    expect(same.body.error).toBe("same_conversation");

    // Exactly one target is required.
    expect(
      (
        await chen
          .post(`/api/messaging/messages/${sent.body.id}/forward`)
          .send({ conversationId: convo.id, participantIds: [lopezId] })
      ).status,
    ).toBe(400);
    expect(
      (await chen.post(`/api/messaging/messages/${sent.body.id}/forward`).send({}))
        .status,
    ).toBe(400);
    // Unknown role target.
    expect(
      (
        await chen
          .post(`/api/messaging/messages/${sent.body.id}/forward`)
          .send({ roleTarget: "consult_service:nope" })
      ).status,
    ).toBe(404);
    // Missing message.
    expect(
      (await chen.post("/api/messaging/messages/999999/forward").send({ participantIds: [lopezId] }))
        .status,
    ).toBe(404);
  });

  it("resolves a roleTarget exactly like /api/messaging/on-call-targets", async () => {
    const orgId = ctx.seedResult.orgId;
    const patelId = ctx.seedResult.userIds.patel!;
    const lopezId = ctx.seedResult.userIds.lopez!;
    const lopezName = (await ctx.storage.getUser(orgId, lopezId))!.displayName;
    await ctx.storage.setOrgSetting(orgId, "consultServices", [
      { id: "cards", name: "Cardiology", onCall: { name: lopezName, avatar: "AA" }, members: [] },
    ], null);
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const convo = await directThread(chen, patelId);
    const sent = await chen
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "consult please" });

    const targets = await chen.get("/api/messaging/on-call-targets");
    const cards = targets.body.find((t: { id: string }) => t.id === "consult_service:cards");
    expect(cards.userId).toBe(lopezId);

    const fwd = await chen
      .post(`/api/messaging/messages/${sent.body.id}/forward`)
      .send({ roleTarget: "consult_service:cards" });
    expect(fwd.status).toBe(201);
    const target = await ctx.storage.getConversation(orgId, fwd.body.conversationId);
    expect(target!.participantIds.sort()).toEqual([chenIdOf(ctx), lopezId].sort());
    expect(target!.name).toBe("On-call Cardiology");
  });

  it("answers 404 module_disabled when messaging.forwarding is off", async () => {
    const patelId = ctx.seedResult.userIds.patel!;
    const lopezId = ctx.seedResult.userIds.lopez!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const convo = await directThread(chen, patelId);
    const sent = await chen
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "hi" });

    await ctx.storage.setOrgSetting(ctx.seedResult.orgId, "modules", {
      "messaging.forwarding": false,
    }, null);
    invalidateModules();
    const res = await chen
      .post(`/api/messaging/messages/${sent.body.id}/forward`)
      .send({ participantIds: [lopezId] });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "module_disabled", module: "messaging.forwarding" });
    // Other messaging still works.
    expect((await chen.get(`/api/messaging/conversations/${convo.id}/messages`)).status).toBe(200);
  });
});

function chenIdOf(c: TestContext) {
  return c.seedResult.userIds.chen!;
}

describe("message templates", () => {
  it("seeds 6 org templates; CRUD respects owner/director scope", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: director } = await login(ctx.app, { username: "director" });

    const seeded = await chen.get("/api/messaging/templates");
    expect(seeded.status).toBe(200);
    const org = seeded.body.filter((t: { scope: string }) => t.scope === "org");
    expect(org).toHaveLength(6);
    expect(org.every((t: { canEdit: boolean }) => t.canEdit === false)).toBe(true);
    expect(org.map((t: { title: string }) => t.title)).toContain("STAT: need you at bedside");
    expect(org.find((t: { title: string }) => t.title === "STAT: need you at bedside").priority).toBe("stat");

    // Hospitalist may not create org-wide…
    const denied = await chen
      .post("/api/messaging/templates")
      .send({ title: "X", body: "Y", scope: "org" });
    expect(denied.status).toBe(403);
    // …but may create a personal one (default scope).
    const mine = await chen
      .post("/api/messaging/templates")
      .send({ title: "My callback", body: "Call me back on 4321", priority: "urgent" });
    expect(mine.status).toBe(201);
    expect(mine.body).toMatchObject({ scope: "mine", canEdit: true, priority: "urgent" });

    // Personal templates are private: the director's list doesn't include it.
    const dlist = await director.get("/api/messaging/templates");
    expect(dlist.body.some((t: { id: number }) => t.id === mine.body.id)).toBe(false);
    expect(dlist.body.filter((t: { scope: string }) => t.scope === "org").every((t: { canEdit: boolean }) => t.canEdit)).toBe(true);

    // Director creates org-wide; hospitalist can't edit it; director can.
    const orgTpl = await director
      .post("/api/messaging/templates")
      .send({ title: "Rounds at 8", body: "Rounds start at 08:00 in {room}.", scope: "org" });
    expect(orgTpl.status).toBe(201);
    expect(orgTpl.body.scope).toBe("org");
    expect((await chen.patch(`/api/messaging/templates/${orgTpl.body.id}`).send({ title: "Nope" })).status).toBe(403);
    const upd = await director
      .patch(`/api/messaging/templates/${orgTpl.body.id}`)
      .send({ title: "Rounds at 9", priority: "urgent" });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ title: "Rounds at 9", priority: "urgent", body: "Rounds start at 08:00 in {room}." });
    // Everyone sees the org-wide update.
    const after = await chen.get("/api/messaging/templates");
    expect(after.body.some((t: { title: string }) => t.title === "Rounds at 9")).toBe(true);

    // Director cannot delete a hospitalist's personal template; owner can.
    expect((await director.delete(`/api/messaging/templates/${mine.body.id}`)).status).toBe(403);
    expect((await chen.delete(`/api/messaging/templates/${mine.body.id}`)).status).toBe(204);
    expect((await chen.delete(`/api/messaging/templates/${mine.body.id}`)).status).toBe(404);
    // Director deletes the org-wide one.
    expect((await director.delete(`/api/messaging/templates/${orgTpl.body.id}`)).status).toBe(204);
    // Validation.
    expect((await chen.post("/api/messaging/templates").send({ title: "", body: "x" })).status).toBe(400);
    expect((await chen.patch(`/api/messaging/templates/${org[0].id}`).send({})).status).toBe(400);
  });

  it("is gated by messaging.templates", async () => {
    await ctx.storage.setOrgSetting(ctx.seedResult.orgId, "modules", {
      "messaging.templates": false,
    }, null);
    invalidateModules();
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const res = await chen.get("/api/messaging/templates");
    expect(res.status).toBe(404);
    expect(res.body.module).toBe("messaging.templates");
  });
});

describe("availability + away message", () => {
  it("persists awayMessage via /api/settings/me and shows it to senders", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.patch("/api/settings/me").send({ key: "awayMessage", value: "  In clinic until 3pm — page my cover.  " }).expect(200);
    await chen.patch("/api/settings/me").send({ key: "dnd", value: true }).expect(200);
    await chen.patch("/api/settings/me").send({ key: "coveringUserId", value: patelId }).expect(200);

    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const res = await er.get(`/api/messaging/availability/${chenId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: chenId,
      displayName: "Dr. Nathan Alyesh",
      dnd: true,
      awayMessage: "In clinic until 3pm — page my cover.",
    });
    expect(res.body.covering.userId).toBe(patelId);

    // Clearing the message removes it; empty/whitespace reads as null.
    await chen.patch("/api/settings/me").send({ key: "awayMessage", value: "   " }).expect(200);
    const res2 = await er.get(`/api/messaging/availability/${chenId}`);
    expect(res2.body.awayMessage).toBe(null);
  });
});

describe("per-recipient status in group threads", () => {
  it("exposes deliveries (delivered/read/acknowledged) per recipient", async () => {
    const patelId = ctx.seedResult.userIds.patel!;
    const lopezId = ctx.seedResult.userIds.lopez!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const group = await chen
      .post("/api/messaging/conversations")
      .send({ type: "group", name: "Night team", participantIds: [patelId, lopezId] });
    expect(group.status).toBe(201);
    const sent = await chen
      .post("/api/messaging/send")
      .send({ conversationId: group.body.id, content: "Bed 12 needs eyes", priority: "urgent" });
    expect(sent.status).toBe(201);

    const { agent: patel } = await login(ctx.app, { username: "patel" });
    await patel.post("/api/messaging/messages/mark-read").send({ messageIds: [sent.body.id] }).expect(204);
    const { agent: lopez } = await login(ctx.app, { username: "lopez" });
    await lopez.post("/api/messaging/messages/ack").send({ messageIds: [sent.body.id] }).expect(204);

    const msgs = await chen.get(`/api/messaging/conversations/${group.body.id}/messages`);
    const m = msgs.body[0];
    expect(m.readCount).toBe(2); // ack implies read
    expect(m.ackCount).toBe(1);
    expect(m.deliveries).toHaveLength(2); // sender excluded
    const byUser = Object.fromEntries(m.deliveries.map((d: { userId: number }) => [d.userId, d]));
    expect(byUser[patelId]).toMatchObject({ displayName: "Dr. Sharon George", status: "read" });
    expect(byUser[lopezId]).toMatchObject({ displayName: "Dr. Amir Ahmed", status: "acknowledged" });
    expect(byUser[patelId].acknowledgedAt).toBe(null);
  });
});
