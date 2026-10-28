import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { ensureDemoTenants } from "../server/seed.js";
import { hashPassword } from "../server/auth.js";
import { setModule } from "../server/modules.js";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";

/**
 * Role contacts (PerfectServe parity #1, module routing.roleMessaging, which
 * now requires oncall.board). GET /api/messaging/role-contacts groups the ONE
 * role resolution path (resolveOnCallTargets) by role: the role label, every
 * reachable person on it now (schedule-source slots joined to real in-org
 * users by providerUserId, consult-service holders, the round-robin next
 * hospitalist) and the target its Message button addresses — the same
 * DND-aware holder the role picker and forward already use.
 *
 * Only roles that resolve are listed: an org with no schedule data has no
 * schedule contacts (never an empty "on call" card).
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

const ids = () => ctx.seedResult.userIds;
const slot = (s: string, providerName: string, extra: Record<string, unknown> = {}) => ({ slot: s, providerName, ...extra });

async function nameOf(userId: number) {
  return (await ctx.storage.getUser(ctx.seedResult.orgId, userId))!.displayName;
}

describe("role contacts", () => {
  it("lists a schedule role with everyone on it, and Message reaches the first reachable holder", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    // Two people on one role (manual source — the test env's default), one
    // name that matches nobody.
    expect((await director.post("/api/oncall/manual").send(slot("Cardiology call", await nameOf(ids().patel!)))).status).toBe(201);
    expect((await director.post("/api/oncall/manual").send(slot("Cardiology call", await nameOf(ids().lopez!)))).status).toBe(201);
    expect((await director.post("/api/oncall/manual").send(slot("Renal call", "Nobody Matches This"))).status).toBe(201);

    const { agent: erDoc } = await login(ctx.app, { username: "er.doc" });
    const res = await erDoc.get("/api/messaging/role-contacts");
    expect(res.status).toBe(200);
    const cardio = (res.body as any[]).find((r) => r.label === "Cardiology call");
    expect(cardio).toBeTruthy();
    expect(cardio.kind).toBe("schedule");
    expect(cardio.roundRobin).toBe(false);
    expect(cardio.holders.map((h: any) => h.userId).sort()).toEqual([ids().patel, ids().lopez].sort());
    for (const h of cardio.holders) {
      expect(h.name).toBe(await nameOf(h.userId));
      expect(h.messageUserId).toBe(h.userId);
      expect(h.covering).toBeNull();
    }
    // One Message target — a real entry of the role picker's own list.
    expect(cardio.target.userId).toBe(ids().patel);
    const targets = (await erDoc.get("/api/messaging/on-call-targets")).body as any[];
    expect(targets.find((t) => t.id === cardio.target.id)).toMatchObject({ userId: ids().patel, role: cardio.role });

    // Unresolvable role → not listed at all.
    expect((res.body as any[]).some((r) => r.label === "Renal call")).toBe(false);

    // The existing role-target flows deliver to the holder: a direct thread …
    const convo = await erDoc.post("/api/messaging/conversations").send({ type: "direct", name: cardio.target.label, participantIds: [cardio.target.userId] });
    expect(convo.status).toBe(201);
    expect((await erDoc.post("/api/messaging/send").send({ conversationId: convo.body.id, content: "consult please" })).status).toBe(201);
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    expect((await patel.get(`/api/messaging/conversations/${convo.body.id}/messages`)).body).toHaveLength(1);
    // … and forward by roleTarget resolves the same id.
    const msgId = (await patel.get(`/api/messaging/conversations/${convo.body.id}/messages`)).body[0].id;
    const fwd = await erDoc.post(`/api/messaging/messages/${msgId}/forward`).send({ roleTarget: cardio.holders.find((h: any) => h.userId === ids().lopez).targetId });
    expect(fwd.status).toBe(201);
  });

  it("is DND-aware: a DND holder shows with their covering provider; without covering they are left out", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.post("/api/oncall/manual").send(slot("Neuro call", await nameOf(ids().patel!)));
    await director.post("/api/oncall/manual").send(slot("Night call", await nameOf(ids().kohan!)));
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    await patel.patch("/api/settings/me").send({ key: "dnd", value: true });
    await patel.patch("/api/settings/me").send({ key: "coveringUserId", value: ids().manukian });
    const { agent: kohan } = await login(ctx.app, { username: "kohan" });
    await kohan.patch("/api/settings/me").send({ key: "dnd", value: true });

    const { agent: erDoc } = await login(ctx.app, { username: "er.doc" });
    const rows = (await erDoc.get("/api/messaging/role-contacts")).body as any[];
    const neuro = rows.find((r) => r.label === "Neuro call");
    expect(neuro.holders).toHaveLength(1);
    expect(neuro.holders[0]).toMatchObject({ userId: ids().patel, dnd: true, messageUserId: ids().manukian });
    expect(neuro.holders[0].covering).toEqual({ userId: ids().manukian, name: await nameOf(ids().manukian!) });
    expect(neuro.target.userId).toBe(ids().manukian);
    // DND, nobody covering → unreachable → the role is not offered.
    expect(rows.some((r) => r.label === "Night call")).toBe(false);
  });

  it("never offers yourself, and labels the admissions round-robin without routing anything", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.post("/api/oncall/manual").send(slot("Day hospitalist", await nameOf(ids().chen!)));
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const mine = (await chen.get("/api/messaging/role-contacts")).body as any[];
    expect(mine.some((r) => r.label === "Day hospitalist")).toBe(false);
    for (const r of mine) for (const h of r.holders) expect(h.messageUserId).not.toBe(ids().chen);

    const { agent: erDoc } = await login(ctx.app, { username: "er.doc" });
    const before = await ctx.storage.getOrganization(ctx.seedResult.orgId);
    const assignmentsBefore = (await ctx.storage.listAssignments(ctx.seedResult.orgId)).length;
    const rows = (await erDoc.get("/api/messaging/role-contacts")).body as any[];
    const rr = rows.filter((r) => r.roundRobin);
    expect(rr).toHaveLength(1);
    expect(rr[0]).toMatchObject({ kind: "next_hospitalist", label: "Next hospitalist (round-robin)" });
    expect(rr[0].holders).toHaveLength(1);
    // Reading role contacts never advances the rotation or creates an assignment.
    const after = await ctx.storage.getOrganization(ctx.seedResult.orgId);
    expect(after!.rotationIndex).toBe(before!.rotationIndex);
    expect(await ctx.storage.listAssignments(ctx.seedResult.orgId)).toHaveLength(assignmentsBefore);
  });

  it("an org with no schedule, no consult services and no rotation shows no role contacts", async () => {
    const org = await ctx.storage.createOrganization({
      name: "Empty General", code: "EMPTY", city: null, state: null, timezone: "America/New_York",
      assignmentTimeoutMin: 10, roundRobinShiftTypes: ["day", "night"], rotationMode: "lowest_census", rotationIndex: 0,
    });
    await ctx.storage.createUser({
      organizationId: org.id, username: "solo.er", passwordHash: await hashPassword(DEV_PASSWORD), role: "er_doctor",
      displayName: "Solo Er", credential: "MD", phone: null, twoFactorEnabled: false,
    });
    const { agent } = await login(ctx.app, { orgCode: "EMPTY", username: "solo.er" });
    const res = await agent.get("/api/messaging/role-contacts");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("is tenant-scoped: another org's user named on a slot never resolves", async () => {
    await ensureDemoTenants(ctx.storage);
    const hosp = (await ctx.storage.getOrganizationByCode("HOSP"))!;
    const voss = (await ctx.storage.getUserByUsername(hosp.id, "voss"))!;
    const { agent: director } = await login(ctx.app, { username: "director" });
    // By name and by explicit id: neither may resolve to the HOSP user.
    await director.post("/api/oncall/manual").send(slot("Cross A", voss.displayName));
    await director.post("/api/oncall/manual").send(slot("Cross B", voss.displayName, { providerUserId: voss.id }));
    const { agent: erDoc } = await login(ctx.app, { username: "er.doc" });
    const rows = (await erDoc.get("/api/messaging/role-contacts")).body as any[];
    expect(rows.some((r) => /^Cross/.test(r.label))).toBe(false);
    for (const r of rows) {
      for (const h of r.holders) {
        expect(await ctx.storage.getUser(ctx.seedResult.orgId, h.userId)).toBeTruthy();
        expect(await ctx.storage.getUser(ctx.seedResult.orgId, h.messageUserId)).toBeTruthy();
      }
    }
    // HOSP's own view never names ISPN's slots.
    const hospDirector = (await login(ctx.app, { username: "director", orgCode: "HOSP" })).agent;
    await director.post("/api/oncall/manual").send(slot("ISPN only", await nameOf(ids().patel!)));
    const hospRows = (await hospDirector.get("/api/messaging/role-contacts")).body as any[];
    expect(hospRows.some((r) => r.label === "ISPN only")).toBe(false);
  });

  it("needs auth, and is 404 module_disabled when role messaging — or the on-call board it requires — is off", async () => {
    expect((await supertest(ctx.app).get("/api/messaging/role-contacts")).status).toBe(401);
    const { agent: erDoc } = await login(ctx.app, { username: "er.doc" });
    await setModule(ctx.seedResult.orgId, "routing.roleMessaging", false);
    let res = await erDoc.get("/api/messaging/role-contacts");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "module_disabled", module: "routing.roleMessaging" });
    await setModule(ctx.seedResult.orgId, "routing.roleMessaging", true);
    expect((await erDoc.get("/api/messaging/role-contacts")).status).toBe(200);
    await setModule(ctx.seedResult.orgId, "oncall.board", false);
    res = await erDoc.get("/api/messaging/role-contacts");
    expect(res.status).toBe(404);
    expect((await erDoc.get("/api/messaging/on-call-targets")).status).toBe(404);
    const mods = (await erDoc.get("/api/modules")).body.modules;
    expect(mods["routing.roleMessaging"]).toBe(false);
  });
});
