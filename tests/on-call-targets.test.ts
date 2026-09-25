import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDemoTenants } from "../server/seed.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

describe("on-call message addressing", () => {
  it("exposes a next-hospitalist target that resolves to a real in-org user", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const res = await director.get("/api/messaging/on-call-targets");
    expect(res.status).toBe(200);

    const next = res.body.find((t: any) => t.kind === "next_hospitalist");
    expect(next).toBeTruthy();
    // The resolved user must be a real user in the caller's org.
    const user = await ctx.storage.getUser(ctx.seedResult.orgId, next.userId);
    expect(user).toBeTruthy();
    // At seed, Chen has the lowest census (0) under lowest_census rotation.
    expect(next.userId).toBe(ctx.seedResult.userIds.chen);
  });

  it("resolves a consult service's named on-call to a userId, and messaging it works", async () => {
    // Director sets a consult catalog: one service whose on-call display name
    // matches a real user, one whose name matches nobody, and one with no
    // on-call at all.
    const setRes = await (await login(ctx.app, { username: "director" })).agent
      .patch("/api/org/preferences")
      .send({
        consultServices: [
          { id: "cs-card", name: "Cardiology", onCall: { name: "Dr. Sharon George", avatar: "SG" }, members: [] },
          { id: "cs-neuro", name: "Neurology", onCall: { name: "Nobody At All", avatar: "NA" }, members: [] },
          { id: "cs-gi", name: "GI", onCall: null, members: [] },
        ],
      });
    expect(setRes.status).toBe(200);

    // A non-hospitalist composer so next_hospitalist/self doesn't confuse things.
    const { agent: erDoc } = await login(ctx.app, { username: "er.doc" });
    const res = await erDoc.get("/api/messaging/on-call-targets");
    expect(res.status).toBe(200);

    const cardio = res.body.find((t: any) => t.kind === "consult_service" && t.id === "consult_service:cs-card");
    expect(cardio).toBeTruthy();
    expect(cardio.userId).toBe(ctx.seedResult.userIds.patel); // Dr. Sharon George
    expect(cardio.label).toBe("On-call Cardiology");

    // Unresolvable name and missing on-call are excluded — never invented.
    expect(res.body.some((t: any) => t.id === "consult_service:cs-neuro")).toBe(false);
    expect(res.body.some((t: any) => t.id === "consult_service:cs-gi")).toBe(false);

    // Messaging the resolved target works via the standard conversation route.
    const convo = await erDoc
      .post("/api/messaging/conversations")
      .send({ type: "direct", name: cardio.label, participantIds: [cardio.userId] });
    expect(convo.status).toBe(201);
    expect(convo.body.name).toBe("On-call Cardiology");
    const sent = await erDoc
      .post("/api/messaging/send")
      .send({ conversationId: convo.body.id, content: "consult please" });
    expect(sent.status).toBe(201);

    // The resolved on-call user actually receives it.
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const history = await patel.get(`/api/messaging/conversations/${convo.body.id}/messages`);
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
  });

  it("surfaces the caller's own on-call care-team members", async () => {
    // Chen owns Wu (PA) on-call in the seed.
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const res = await chen.get("/api/messaging/on-call-targets");
    expect(res.status).toBe(200);
    const wuTarget = res.body.find(
      (t: any) => t.kind === "care_team" && t.userId === ctx.seedResult.userIds.wu,
    );
    expect(wuTarget).toBeTruthy();
    // Chen (a hospitalist) must never be offered as their own on-call target.
    expect(res.body.some((t: any) => t.userId === ctx.seedResult.userIds.chen)).toBe(false);
  });

  it("never leaks another org's users across tenants", async () => {
    await ensureDemoTenants(ctx.storage);
    const hosp = (await ctx.storage.getOrganizationByCode("HOSP"))!;
    const voss = (await ctx.storage.getUserByUsername(hosp.id, "voss"))!; // "Dr. Lena Voss"

    // ISPN's consult on-call names a user who only exists in HOSP → unresolvable
    // in ISPN, so it must be excluded (and must never surface the HOSP userId).
    const ispnDirector = (await login(ctx.app, { username: "director", orgCode: "ISPN" })).agent;
    await ispnDirector.patch("/api/org/preferences").send({
      consultServices: [
        { id: "cs-x", name: "Cross Tenant", onCall: { name: "Dr. Lena Voss", avatar: "LV" }, members: [] },
      ],
    });
    const ispnTargets = await ispnDirector.get("/api/messaging/on-call-targets");
    expect(ispnTargets.status).toBe(200);
    expect(ispnTargets.body.some((t: any) => t.id === "consult_service:cs-x")).toBe(false);
    expect(ispnTargets.body.some((t: any) => t.userId === voss.id)).toBe(false);
    // Every resolved target belongs to ISPN.
    for (const t of ispnTargets.body) {
      const u = await ctx.storage.getUser(ctx.seedResult.orgId, t.userId);
      expect(u).toBeTruthy();
    }

    // Symmetric: HOSP naming an ISPN user resolves to nobody in HOSP.
    const hospDirector = (await login(ctx.app, { username: "director", orgCode: "HOSP" })).agent;
    await hospDirector.patch("/api/org/preferences").send({
      consultServices: [
        { id: "cs-y", name: "Cross Tenant", onCall: { name: "Dr. Sharon George", avatar: "SG" }, members: [] },
      ],
    });
    const hospTargets = await hospDirector.get("/api/messaging/on-call-targets");
    expect(hospTargets.status).toBe(200);
    expect(hospTargets.body.some((t: any) => t.id === "consult_service:cs-y")).toBe(false);
    expect(hospTargets.body.some((t: any) => t.userId === ctx.seedResult.userIds.patel)).toBe(false);
  });
});
