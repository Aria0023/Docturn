import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});
const orgId = () => ctx.seedResult.orgId;

describe("shift review and trends", () => {
  it("counts requests by outcome, hospitalist and time of day, and still counts them after the patient is removed", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    for (const a of await ctx.storage.listAssignments(orgId())) if (a.status === "pending") await ctx.storage.updateAssignment(orgId(), a.id, { status: "cancelled", resolvedAt: new Date() });
    const before = (await director.get("/api/reports/review?hours=12")).body.totals;

    const send = async (initials: string, who: string) => {
      const p = await er.post("/api/patients").send({ initials, roomNumber: "1", issueSummary: "x", fullName: "Review " + initials });
      const a = await er.post("/api/assignments").send({ patientId: p.body.id, mode: "manual", hospitalistId: ctx.seedResult.hospitalistIds[who] });
      return { patientId: p.body.id as number, id: a.body.id as number };
    };
    const one = await send("R1", "chen");
    await chen.patch(`/api/assignments/${one.id}/accept`).send({}).expect(200);
    const two = await send("R2", "patel");
    await patel.patch(`/api/assignments/${two.id}/reject`).send({}).expect(200);
    await send("R3", "chen"); // still waiting

    let r = (await director.get("/api/reports/review?hours=12")).body;
    expect(r.totals).toMatchObject({ requests: before.requests + 3, accepted: before.accepted + 1, declined: before.declined + 1, waiting: 1 });
    expect(typeof r.totals.medianAcceptMin).toBe("number");
    const byName = Object.fromEntries(r.byHospitalist.map((h: { hospitalist: string }) => [h.hospitalist, h]));
    expect(byName["Dr. Nolan Avery"]).toMatchObject({ accepted: 1, waiting: 1 });
    expect(byName["Dr. Sara Grant"]).toMatchObject({ declined: 1 });
    expect(r.byTimeOfDay.map((b: { block: string }) => b.block)).toEqual(["Day (07–15)", "Evening (15–23)", "Night (23–07)"]);
    expect(r.byTimeOfDay.reduce((n: number, b: { requests: number }) => n + b.requests, 0)).toBe(r.totals.requests);
    expect(r.byDay.reduce((n: number, d: { requests: number }) => n + d.requests, 0)).toBe(r.totals.requests);
    expect(r.stuckAlerts).toBe(1); // the decline left nobody being asked
    // No patient in it.
    expect(JSON.stringify(r)).not.toMatch(/Review R|"R1"|"R2"/);

    // Remove the accepted patient: its outcome is still counted, once.
    await director.delete(`/api/patients/${one.patientId}`);
    expect(await ctx.storage.getAssignment(orgId(), one.id)).toBeUndefined();
    r = (await director.get("/api/reports/review?hours=12")).body;
    expect(r.totals).toMatchObject({ requests: before.requests + 3, accepted: before.accepted + 1 });
    // Trends are the same question over more days.
    const month = (await director.get("/api/reports/review?hours=720")).body;
    expect(month.hours).toBe(720);
    expect(month.totals.requests).toBeGreaterThanOrEqual(r.totals.requests);

    expect((await chen.get("/api/reports/review")).status).toBe(403);
  });
});
