import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { ensureDemoTenants } from "../server/seed.js";
import { setModule } from "../server/modules.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * End shift / Start shift (PerfectServe parity #4, module shift.handoff).
 *
 * ONE server action ends a shift, in ONE transaction: the caller's rotation
 * profile goes off shift (hospitalists.working = false), a covering provider is
 * recorded (required while the caller has pending incoming requests — those are
 * handed to the covering provider's rotation profile as new pending requests),
 * an optional away message / DND is stored, and one audit row is written.
 * Accepted patients are never re-routed. Start shift is the inverse (on shift,
 * DND off; the covering preference stays).
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});
const ids = () => ctx.seedResult.userIds;
const org = () => ctx.seedResult.orgId;
const profileOf = async (userId: number) =>
  (await ctx.storage.listHospitalists(org())).find((h) => h.userId === userId)!;
const audits = async (action: string) =>
  (await ctx.storage.listAuditLogs(org(), 500)).filter((a) => a.action === action);

describe("End shift / Start shift", () => {
  it("GET /api/shift states the caller's truth: profile, on shift, pending + accepted counts", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const r = await chen.get("/api/shift");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ hasProfile: true, working: true, pendingCount: 1, acceptedCount: 0, coveringUserId: null, dnd: false });
    // A hospitalist with no rotation profile (a PA on a care team) is told so.
    const { agent: wu } = await login(ctx.app, { username: "wu" });
    expect((await wu.get("/api/shift")).body).toMatchObject({ hasProfile: false, working: false, pendingCount: 0 });
    // Roles that never have a rotation profile do not get the action at all.
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    expect((await er.get("/api/shift")).status).toBe(403);
    expect((await er.post("/api/shift/end").send({})).status).toBe(403);
    expect((await supertest(ctx.app).post("/api/shift/end").send({})).status).toBe(401);
  });

  it("refuses to end a shift with pending requests and no covering provider — and changes nothing", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const r = await chen.post("/api/shift/end").send({});
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "covering_required", pendingCount: 1 });
    expect((await profileOf(ids().chen!)).working).toBe(true);
    expect(await audits("shift.end")).toHaveLength(0);
  });

  it("validates the covering provider: same org, active, not me, on shift in the rotation when requests are handed over", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await ensureDemoTenants(ctx.storage);
    const otherOrg = (await ctx.storage.listOrganizations()).find((o) => o.id !== org() && o.code !== "DOCTURN")!;
    const foreign = (await ctx.storage.listUsers(otherOrg.id))[0]!;
    expect((await chen.post("/api/shift/end").send({ coveringUserId: foreign.id })).status).toBe(404);
    expect((await chen.post("/api/shift/end").send({ coveringUserId: 999999 })).status).toBe(404);
    expect((await chen.post("/api/shift/end").send({ coveringUserId: ids().chen })).status).toBe(400);
    expect((await chen.post("/api/shift/end").send({ coveringUserId: "x" })).status).toBe(400);
    // Wu has no rotation profile: a pending request cannot be handed to them.
    const wu = await chen.post("/api/shift/end").send({ coveringUserId: ids().wu });
    expect(wu.status).toBe(409);
    expect(wu.body).toMatchObject({ error: "covering_not_in_rotation" });
    // An off-shift covering provider would leave the request with nobody.
    await ctx.storage.updateHospitalist(org(), (await profileOf(ids().patel!)).id, { working: false });
    expect((await chen.post("/api/shift/end").send({ coveringUserId: ids().patel })).body).toMatchObject({ error: "covering_off_shift" });
    // A deactivated account cannot cover.
    await ctx.storage.updateHospitalist(org(), (await profileOf(ids().patel!)).id, { working: true });
    await ctx.storage.updateUser(ids().patel!, { disabledAt: new Date() });
    expect((await chen.post("/api/shift/end").send({ coveringUserId: ids().patel })).status).toBe(409);
    expect((await profileOf(ids().chen!)).working).toBe(true);
    expect(await audits("shift.end")).toHaveLength(0);
  });

  it("ends the shift in one action: off shift, covering set, pending handed over, accepted untouched, DND + away message, one audit row", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const chenProfile = await profileOf(ids().chen!);
    const patelProfile = await profileOf(ids().patel!);
    // An ACCEPTED patient of Chen's: it must stay Chen's.
    const p = (await er.post("/api/patients").send({ initials: "AC", roomNumber: "A1", issueSummary: "synthetic", specialty: "General" })).body;
    const asg = (await er.post("/api/assignments").send({ patientId: p.id, mode: "manual", hospitalistId: chenProfile.id })).body;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.patch(`/api/assignments/${asg.id}/accept`).expect(200);
    const pendingBefore = await ctx.storage.listPendingForHospitalist(org(), chenProfile.id);
    expect(pendingBefore).toHaveLength(1);

    ctx.ws.delivered.length = 0;
    const r = await chen.post("/api/shift/end").send({ coveringUserId: ids().patel, dnd: true, awayMessage: "  Off until 7am  " });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ working: false, coveringUserId: ids().patel, dnd: true, awayMessage: "Off until 7am", handedOff: 1, acceptedKept: 1 });

    expect((await profileOf(ids().chen!)).working).toBe(false);
    expect(await ctx.storage.getUserPreference(ids().chen!, "coveringUserId")).toBe(ids().patel);
    expect(await ctx.storage.getUserPreference(ids().chen!, "dnd")).toBe(true);
    expect(await ctx.storage.getUserPreference(ids().chen!, "awayMessage")).toBe("Off until 7am");
    // The pending request now waits on the covering provider; Chen has none.
    expect(await ctx.storage.listPendingForHospitalist(org(), chenProfile.id)).toHaveLength(0);
    const moved = await ctx.storage.listPendingForHospitalist(org(), patelProfile.id);
    expect(moved.map((a) => a.patientId)).toContain(pendingBefore[0]!.patientId);
    expect((await ctx.storage.getAssignment(org(), pendingBefore[0]!.id))!.status).toBe("expired");
    // The accepted patient is still Chen's.
    expect((await ctx.storage.getAssignment(org(), asg.id))!.status).toBe("accepted");
    expect((await ctx.storage.getPatient(org(), p.id))!.assignedHospitalistId).toBe(chenProfile.id);
    // The covering provider is alerted; every session re-reads rotation + assignments.
    expect(ctx.ws.delivered.some((d: any) => d.message?.type === "ASSIGNMENT_CREATED" && d.userIds.includes(ids().patel))).toBe(true);
    // ONE audit row, ids and flags only — never the away-message text.
    const rows = await audits("shift.end");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ids().chen, resourceType: "hospitalist", resourceId: chenProfile.id, riskLevel: "medium" });
    expect(rows[0]!.details).toMatchObject({ coveringUserId: ids().patel, handedOff: 1, acceptedKept: 1, dnd: true, awayMessageSet: true });
    expect(JSON.stringify(rows[0]!.details)).not.toContain("7am");

    // Already off shift: refused, not a second audit row.
    expect((await chen.post("/api/shift/end").send({ coveringUserId: ids().patel })).body).toMatchObject({ error: "not_on_shift" });
    expect(await audits("shift.end")).toHaveLength(1);
  });

  it("is one transaction: a failure at the last write (the audit row) leaves nothing changed", async () => {
    const chenProfile = await profileOf(ids().chen!);
    const patelProfile = await profileOf(ids().patel!);
    const pendingBefore = await ctx.storage.listPendingForHospitalist(org(), chenProfile.id);
    await expect(
      ctx.storage.endShift({
        orgId: org(), userId: ids().chen!, hospitalistId: chenProfile.id, coveringUserId: ids().patel,
        handOffToHospitalistId: patelProfile.id, timeoutMin: 10, dnd: true, awayMessage: "x",
        audit: () => { throw new Error("audit write failed"); },
      }),
    ).rejects.toThrow("audit write failed");
    expect((await profileOf(ids().chen!)).working).toBe(true);
    expect((await ctx.storage.listPendingForHospitalist(org(), chenProfile.id)).map((a) => a.id)).toEqual(pendingBefore.map((a) => a.id));
    expect(await ctx.storage.listPendingForHospitalist(org(), patelProfile.id)).toHaveLength(0);
    expect(await ctx.storage.getUserPreference(ids().chen!, "dnd")).toBeUndefined();
    expect(await ctx.storage.getUserPreference(ids().chen!, "coveringUserId")).toBeUndefined();
  });

  it("with no pending requests a covering provider is optional and the existing one is kept", async () => {
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    await patel.patch("/api/settings/me").send({ key: "coveringUserId", value: ids().lopez }).expect(200);
    const r = await patel.post("/api/shift/end").send({});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ working: false, coveringUserId: ids().lopez, handedOff: 0, dnd: false });
    expect((await audits("shift.end"))[0]).toMatchObject({ riskLevel: "low" });
  });

  it("Start shift is the inverse: on shift, DND off, covering preference kept; audited", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    expect((await chen.post("/api/shift/start").send({})).body).toMatchObject({ error: "already_on_shift" });
    await chen.post("/api/shift/end").send({ coveringUserId: ids().patel, dnd: true }).expect(200);
    const r = await chen.post("/api/shift/start").send({});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ working: true, dnd: false, coveringUserId: ids().patel });
    expect((await profileOf(ids().chen!)).working).toBe(true);
    expect(await ctx.storage.getUserPreference(ids().chen!, "dnd")).toBe(false);
    expect(await audits("shift.start")).toHaveLength(1);
  });

  it("DND / away message need messaging.dnd: refused (and nothing changed) while it is off", async () => {
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    await setModule(org(), "messaging.dnd", false);
    const r = await patel.post("/api/shift/end").send({ dnd: true });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "module_disabled", module: "messaging.dnd" });
    expect((await patel.post("/api/shift/end").send({ awayMessage: "away" })).status).toBe(404);
    expect((await profileOf(ids().patel!)).working).toBe(true);
    // Without those fields the shift still ends.
    expect((await patel.post("/api/shift/end").send({})).status).toBe(200);
  });

  it("module off: every shift route answers 404 module_disabled", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await setModule(org(), "shift.handoff", false);
    for (const [m, p] of [["get", "/api/shift"], ["post", "/api/shift/end"], ["post", "/api/shift/start"]] as const) {
      const r = await (chen as any)[m](p).send({ coveringUserId: ids().patel });
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: "module_disabled", module: "shift.handoff" });
    }
    expect((await profileOf(ids().chen!)).working).toBe(true);
  });
});
