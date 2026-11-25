import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { invalidateModules, setModule } from "../server/modules.js";
import { runExpirySweep } from "../server/services/assignments.js";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  invalidateModules();
  await ctx.handle.close();
});
const orgId = () => ctx.seedResult.orgId;
const uid = (k: string) => ctx.seedResult.userIds[k]!;
type Agent = Awaited<ReturnType<typeof login>>["agent"];

/** A patient the given hospitalist has accepted. */
async function accepted(er: Agent, who: string, initials: string) {
  const p = await er.post("/api/patients").send({ initials, roomNumber: "9", issueSummary: "x", fullName: "Test " + initials });
  const a = await er.post("/api/assignments").send({ patientId: p.body.id, mode: "manual", hospitalistId: ctx.seedResult.hospitalistIds[who] });
  const { agent } = await login(ctx.app, { username: who });
  await agent.patch(`/api/assignments/${a.body.id}/accept`).send({}).expect(200);
  return p.body.id as number;
}

describe("hand-off notes", () => {
  it("the responsible physician writes a note, addresses it, and the receiver acknowledges", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const pid = await accepted(er, "chen", "HN");
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const { agent: nurseLike } = await login(ctx.app, { username: "er.doc" });

    expect((await nurseLike.get("/api/handoffs")).status).toBe(403);
    expect((await patel.put(`/api/handoffs/${pid}`).send({ severity: "stable", summary: "not mine" })).status).toBe(403);
    expect((await chen.put(`/api/handoffs/${pid}`).send({ severity: "watcher" })).status).toBe(400); // empty
    expect((await chen.put(`/api/handoffs/${pid}`).send({ severity: "sick", summary: "x" })).status).toBe(400);
    expect((await chen.put(`/api/handoffs/${pid}`).send({ severity: "stable", summary: "x", toUserId: uid("er.doc") })).status).toBe(400); // not a hospitalist

    const saved = await chen.put(`/api/handoffs/${pid}`).send({ severity: "watcher", summary: "Sepsis, improving on antibiotics.", todo: "Recheck lactate at 02:00.", toUserId: uid("patel") });
    expect(saved.status).toBe(201);
    // The alert says only that notes are waiting.
    const frame = ctx.ws.delivered.find((d) => (d.message as { type: string }).type === "HANDOFF_RECEIVED")!;
    expect(frame.userIds).toEqual([uid("patel")]);
    expect(JSON.stringify(frame.message)).not.toMatch(/Sepsis|lactate|HN/);
    expect(ctx.push.sent.some((s) => s.userId === uid("patel") && s.title === "Hand-off notes waiting")).toBe(true);
    expect(JSON.stringify(await ctx.storage.listAuditLogs(orgId(), 100))).not.toMatch(/Sepsis|lactate/);

    const mine = (await chen.get("/api/handoffs")).body.mine.find((m: { patient: { id: number } }) => m.patient.id === pid);
    expect(mine.note).toMatchObject({ severity: "watcher", toName: "Dr. Sara Grant", acknowledgedAt: null });
    expect(mine.patient).toMatchObject({ initials: "HN", fullName: "Test HN" });
    const incoming = (await patel.get("/api/handoffs")).body.incoming;
    expect(incoming).toHaveLength(1);
    expect(incoming[0].note).toMatchObject({ summary: "Sepsis, improving on antibiotics.", todo: "Recheck lactate at 02:00.", fromName: "Dr. Nolan Avery" });

    expect((await chen.post(`/api/handoffs/${incoming[0].note.id}/ack`)).status).toBe(404); // not the receiver
    expect((await patel.post(`/api/handoffs/${incoming[0].note.id}/ack`)).status).toBe(204);
    expect((await patel.post(`/api/handoffs/${incoming[0].note.id}/ack`)).status).toBe(204); // again: nothing changes
    expect((await chen.get("/api/handoffs")).body.mine.find((m: { patient: { id: number } }) => m.patient.id === pid).note.acknowledgedAt).toBeTruthy();
    expect((await ctx.storage.listAuditLogs(orgId(), 100)).filter((r) => r.action === "handoff.ack")).toHaveLength(1);
  });

  it("ending a shift addresses unaddressed notes to the covering provider; removing the patient removes its notes", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const pid = await accepted(er, "chen", "SE");
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.put(`/api/handoffs/${pid}`).send({ severity: "unstable", summary: "GI bleed, 2 units given." }).expect(201);
    // Settle the seeded waiting request so only the notes are handed over.
    for (const a of await ctx.storage.listAssignments(orgId())) if (a.status === "pending") await ctx.storage.updateAssignment(orgId(), a.id, { status: "cancelled", resolvedAt: new Date() });
    const ended = await chen.post("/api/shift/end").send({ coveringUserId: uid("patel") });
    expect(ended.status).toBe(200);
    expect(ended.body.notesHandedOver).toBe(1);
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    expect((await patel.get("/api/handoffs")).body.incoming.map((i: { patient: { initials: string } }) => i.patient.initials)).toEqual(["SE"]);

    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.delete(`/api/patients/${pid}`).expect((r) => { if (r.status >= 300) throw new Error(String(r.status)); });
    expect((await ctx.storage.listHandoffs(orgId())).filter((h) => h.patientId === pid)).toHaveLength(0);
    expect((await patel.get("/api/handoffs")).body.incoming).toHaveLength(0);

    await setModule(orgId(), "shift.handoffNotes", false);
    expect((await patel.get("/api/handoffs")).status).toBe(404);
  });
});

describe("a stuck admission alerts the directors once", () => {
  it("after a second decline, with nobody accepting", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const p = await er.post("/api/patients").send({ initials: "SK", roomNumber: "3", issueSummary: "x", fullName: "Stuck Patient" });
    const escalations = () => ctx.ws.delivered.filter((d) => (d.message as { type: string }).type === "ADMISSION_ESCALATED");
    for (const who of ["chen", "patel"]) {
      const a = await er.post("/api/assignments").send({ patientId: p.body.id, mode: "manual", hospitalistId: ctx.seedResult.hospitalistIds[who] });
      expect(a.status).toBe(201);
      const { agent } = await login(ctx.app, { username: who });
      // With auto-reassign off (the default) the first decline leaves nobody
      // being asked: that alone is stuck.
      await agent.patch(`/api/assignments/${a.body.id}/reject`).send({}).expect(200);
    }
    expect(escalations()).toHaveLength(1);
    expect(escalations()[0]!.userIds.sort()).toEqual([uid("director"), uid("er.director")].sort());
    expect(JSON.stringify(escalations()[0]!.message)).not.toMatch(/Stuck|SK/);
    expect(ctx.push.sent.filter((s) => s.title === "An admission needs a hospitalist").map((s) => s.userId).sort()).toEqual([uid("director"), uid("er.director")].sort());
    const row = (await er.get("/api/patient-board")).body.find((r: { patient: { id: number } }) => r.patient.id === p.body.id);
    expect(row.patient.escalatedAt).toBeTruthy();
    expect((await ctx.storage.listAuditLogs(orgId(), 100)).filter((r) => r.action === "assignment.escalated")).toHaveLength(1);
  });

  it("a request that lapses with nobody left to ask escalates; an accepted one never does; the module switches it off", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const count = () => ctx.ws.delivered.filter((d) => (d.message as { type: string }).type === "ADMISSION_ESCALATED").length;
    await accepted(er, "chen", "OK");
    expect(count()).toBe(0);

    // Only chen on shift, at cap: a lapse has nobody to go to.
    for (const h of await ctx.storage.listHospitalists(orgId())) await ctx.storage.updateHospitalist(orgId(), h.id, { working: h.id === ctx.seedResult.hospitalistIds.chen });
    const p = await er.post("/api/patients").send({ initials: "LP", roomNumber: "4", issueSummary: "x" });
    await er.post("/api/assignments").send({ patientId: p.body.id, mode: "manual", hospitalistId: ctx.seedResult.hospitalistIds.chen }).expect(201);
    await runExpirySweep(ctx.storage, new Date(Date.now() + 3 * 3600_000));
    await runExpirySweep(ctx.storage, new Date(Date.now() + 6 * 3600_000));
    const before = count();
    expect(before).toBeGreaterThanOrEqual(1);
    expect((await ctx.storage.getPatient(orgId(), p.body.id))!.escalatedAt).toBeTruthy();
    await runExpirySweep(ctx.storage, new Date(Date.now() + 9 * 3600_000));
    const forLp = ctx.ws.delivered.filter((d) => (d.message as { type: string; patientId?: number }).type === "ADMISSION_ESCALATED" && (d.message as { patientId: number }).patientId === p.body.id);
    expect(forLp).toHaveLength(1); // once per patient

    await setModule(orgId(), "routing.escalation", false);
    const q = await er.post("/api/patients").send({ initials: "NO", roomNumber: "5", issueSummary: "x" });
    const a = await er.post("/api/assignments").send({ patientId: q.body.id, mode: "manual", hospitalistId: ctx.seedResult.hospitalistIds.chen });
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.patch(`/api/assignments/${a.body.id}/reject`).send({}).expect(200);
    expect((await ctx.storage.getPatient(orgId(), q.body.id))!.escalatedAt).toBeNull();
  });
});
