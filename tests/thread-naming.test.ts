import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * A.CON-MIN-15: a role-addressed direct thread used to persist the sender-side
 * label ("Next hospitalist (Dr. Nathan Alyesh)") as the SHARED conversation
 * name, so the recipient saw a thread titled after himself. The API now serves
 * `name: null` for direct threads (each client falls back to the other
 * participant's display name) and carries the label as `addressedAs`.
 */
describe("direct-thread naming", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it("serves a role label as addressedAs, never as the direct thread's name, on both sides", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const label = "Next hospitalist (Dr. Nathan Alyesh)";
    const created = await er.post("/api/messaging/conversations").send({ type: "direct", name: label, participantIds: [chenId] });
    expect(created.status).toBe(201);
    expect(created.body.name).toBeNull();
    expect(created.body.addressedAs).toBe(label);

    const erList = (await er.get("/api/messaging/conversations").expect(200)).body as Array<{ id: number; name: string | null; addressedAs: string | null; type: string }>;
    const mine = erList.find((c) => c.id === created.body.id)!;
    expect(mine.name).toBeNull();
    expect(mine.addressedAs).toBe(label);

    // The recipient's side: no thread named after himself.
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const chenList = (await chen.get("/api/messaging/conversations").expect(200)).body as Array<{ id: number; name: string | null; addressedAs: string | null }>;
    const his = chenList.find((c) => c.id === created.body.id)!;
    expect(his.name).toBeNull();
    expect(his.addressedAs).toBe(label);
  });

  it("forwarding to an on-call role creates a direct thread without a shared role name; group threads keep their names", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: director } = await login(ctx.app, { username: "director" });
    const patelName = (await ctx.storage.getUser(orgId, patelId))!.displayName;
    await director
      .patch("/api/org/preferences")
      .send({ consultServices: [{ id: "cardio", name: "Cardiology", onCall: { name: patelName } }] })
      .expect(200);

    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = (await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [chenId] })).body;
    const sent = (await er.post("/api/messaging/send").send({ conversationId: convo.id, content: "consult please" })).body;
    const fwd = await er.post(`/api/messaging/messages/${sent.id}/forward`).send({ roleTarget: "consult_service:cardio" });
    expect(fwd.status).toBe(201);

    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const list = (await patel.get("/api/messaging/conversations").expect(200)).body as Array<{ id: number; type: string; name: string | null; addressedAs: string | null }>;
    const target = list.find((c) => c.id === fwd.body.conversationId)!;
    expect(target.type).toBe("direct");
    expect(target.name).toBeNull();
    expect(target.addressedAs).toBe("On-call Cardiology");

    // Group threads are unaffected: their name IS shared.
    const group = await er.post("/api/messaging/conversations").send({ type: "group", name: "Night team", participantIds: [chenId, patelId] });
    expect(group.status).toBe(201);
    expect(group.body.name).toBe("Night team");
    expect(group.body.addressedAs).toBeNull();
    const groupSeen = (await patel.get("/api/messaging/conversations").expect(200)).body.find((c: { id: number }) => c.id === group.body.id);
    expect(groupSeen.name).toBe("Night team");
  });
});
