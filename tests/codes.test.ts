import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { invalidateModules, setModule } from "../server/modules.js";
import { runCodeRealertSweep, MAX_ALERTS } from "../server/services/codes.js";

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
const alertsTo = (userId: number) =>
  ctx.ws.delivered.filter((d) => (d.message as { type: string }).type === "CODE_ALERT" && d.userIds.includes(userId)).length;

/** A stroke protocol: the neurology on-call role, patel by name, and a role nobody holds. */
async function strokeProtocol(director: Agent) {
  await ctx.storage.setOrgSetting(orgId(), "consultServices", [
    { id: "neuro", name: "Neurology", onCall: { userId: uid("lopez"), name: "Dr. Adam Archer" } },
    { id: "rad", name: "Radiology", onCall: { name: "Pat Outside" } }, // on the schedule, no DocTurn account
  ], uid("director"));
  const res = await director.post("/api/codes/protocols").send({
    name: "Code Stroke",
    description: "Suspected acute stroke",
    team: [
      { label: "Neurologist on call", kind: "oncall", ref: "On-call Neurology" },
      { label: "Hospitalist", kind: "user", ref: String(uid("patel")) },
      { label: "CT / Radiology", kind: "oncall", ref: "On-call Radiology" },
      { label: "Pharmacy", kind: "oncall", ref: "" },
    ],
    steps: [{ label: "CT head started", targetMin: 25 }, { label: "Thrombolysis decision", targetMin: 45 }],
  });
  expect(res.status).toBe(201);
  return res.body as { id: number };
}
const board = async (agent: Agent) => (await agent.get("/api/codes")).body as {
  activations: Array<{ id: number; status: string; onTeam: boolean; canAct: boolean; patient: unknown; members: Array<Record<string, unknown>>; steps: Array<Record<string, unknown>> }>;
  protocols: unknown[]; canManage: boolean; templates: unknown[];
};

describe("code protocols", () => {
  it("only director roles manage protocols; a name is used once", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const p = await strokeProtocol(director);
    const body = { name: "code stroke", team: [{ label: "A", kind: "user", ref: String(uid("chen")) }], steps: [] };
    expect((await director.post("/api/codes/protocols").send(body)).status).toBe(409);
    expect((await chen.post("/api/codes/protocols").send({ ...body, name: "Mine" })).status).toBe(403);
    expect((await chen.delete(`/api/codes/protocols/${p.id}`)).status).toBe(403);
    expect((await chen.get("/api/codes/team-options")).status).toBe(403);
    expect((await director.post("/api/codes/protocols").send({ name: "No team", team: [], steps: [] })).status).toBe(400);

    const opts = (await director.get("/api/codes/team-options")).body;
    expect(opts.roles).toContain("On-call Neurology");
    expect(opts.people.some((u: { id: number }) => u.id === uid("patel"))).toBe(true);
    expect((await board(chen)).canManage).toBe(false);
    expect((await board(chen)).templates).toEqual([]);
    expect((await board(director)).templates.length).toBeGreaterThan(0);
  });

  it("activating resolves each role to who holds it now, alerts them, and shows who could not be alerted", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const p = await strokeProtocol(director);

    // The preview says the same thing the activation will do.
    const preview = (await er.get(`/api/codes/protocols/${p.id}/team`)).body.team;
    expect(preview.map((m: { userId: number | null; problem: string | null }) => [m.userId, m.problem])).toEqual([
      [uid("lopez"), null], [uid("patel"), null], [null, "no_account"], [null, "not_assigned"],
    ]);

    const patient = await er.post("/api/patients").send({ initials: "ST", roomNumber: "ED 4", issueSummary: "left-sided weakness" });
    const act = await er.post("/api/codes/activate").send({ protocolId: p.id, location: "ED 4", patientId: patient.body.id });
    expect(act.status).toBe(201);

    expect(alertsTo(uid("lopez"))).toBe(1);
    expect(alertsTo(uid("patel"))).toBe(1);
    expect(alertsTo(uid("er.doc"))).toBe(0);
    // Push carries the protocol name only.
    expect(ctx.push.sent.filter((s) => s.title === "Code Stroke activated").map((s) => s.userId).sort()).toEqual([uid("lopez"), uid("patel")].sort());
    const alert = ctx.ws.delivered.find((d) => (d.message as { type: string }).type === "CODE_ALERT")!.message;
    expect(JSON.stringify(alert)).not.toContain("ST");
    expect(alert).toMatchObject({ protocolName: "Code Stroke", location: "ED 4", again: false });

    const view = (await board(er)).activations[0]!;
    expect(view).toMatchObject({ status: "active", onTeam: false, canAct: true, patient: { initials: "ST", room: "ED 4" } });
    expect(view.members.map((m) => [m.label, m.alerted, m.name ?? m.holderName])).toEqual([
      ["Neurologist on call", true, "Dr. Adam Archer"],
      ["Hospitalist", true, "Dr. Sara Grant"],
      ["CT / Radiology", false, "Pat Outside"],
      ["Pharmacy", false, null],
    ]);
    expect(view.steps.map((s) => [s.label, s.targetMin, s.doneAt])).toEqual([["CT head started", 25, null], ["Thrombolysis decision", 45, null]]);
    const audit = (await ctx.storage.listAuditLogs(orgId(), 50)).find((r) => r.action === "code.activate")!;
    expect(audit).toMatchObject({ riskLevel: "high", details: { alerted: 2, notAlerted: 2, patientLinked: true } });
  });

  it("acknowledge and arrive are the member's own; steps and closing belong to the team", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const { agent: lopez } = await login(ctx.app, { username: "lopez" });
    const { agent: chen } = await login(ctx.app, { username: "chen" }); // not on the team
    const p = await strokeProtocol(director);
    const id = (await er.post("/api/codes/activate").send({ protocolId: p.id, location: "ED 4" })).body.id as number;
    const url = `/api/codes/activations/${id}`;

    expect((await chen.post(`${url}/ack`)).status).toBe(403);
    expect((await er.post(`${url}/ack`)).status).toBe(403); // called it, is not on the team
    expect((await lopez.post(`${url}/ack`)).status).toBe(204);
    expect((await lopez.post(`${url}/ack`)).status).toBe(204); // a second tap changes nothing
    let view = (await board(lopez)).activations[0]!;
    const first = view.members[0]!.acknowledgedAt;
    expect(first).toBeTruthy();
    expect(view.members[0]).toMatchObject({ me: true, arrivedAt: null });
    expect(view.members[1]!.acknowledgedAt).toBeNull();
    expect((await ctx.storage.listAuditLogs(orgId(), 50)).filter((r) => r.action === "code.ack")).toHaveLength(1);

    // Arriving without acknowledging first counts as both.
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    expect((await patel.post(`${url}/arrived`)).status).toBe(204);
    view = (await board(patel)).activations[0]!;
    expect(view.members[1]!.acknowledgedAt).toBeTruthy();
    expect(view.members[1]!.arrivedAt).toBeTruthy();
    expect(view.members[0]!.acknowledgedAt).toBe(first);

    const stepId = view.steps[0]!.id as number;
    expect((await chen.post(`${url}/steps/${stepId}`).send({ done: true })).status).toBe(403);
    expect((await lopez.post(`${url}/steps/${stepId}`).send({ done: true })).status).toBe(204);
    expect((await lopez.post(`${url}/steps/999999`).send({ done: true })).status).toBe(404);
    view = (await board(er)).activations[0]!;
    expect(view.steps[0]).toMatchObject({ doneByName: "Dr. Adam Archer" });
    expect(typeof view.steps[0]!.doneMin).toBe("number");
    expect((await er.post(`${url}/steps/${stepId}`).send({ done: false })).status).toBe(204);
    expect((await board(er)).activations[0]!.steps[0]!.doneAt).toBeNull();

    expect((await chen.post(`${url}/close`).send({ outcome: "completed" })).status).toBe(403);
    expect((await er.post(`${url}/close`).send({ outcome: "maybe" })).status).toBe(400);
    expect((await er.post(`${url}/close`).send({ outcome: "completed" })).status).toBe(204);
    expect((await director.post(`${url}/close`).send({ outcome: "stood_down" })).status).toBe(409);
    expect((await lopez.post(`${url}/ack`)).status).toBe(409);
    view = (await board(er)).activations[0]!;
    expect(view).toMatchObject({ status: "completed", canAct: false, closedByName: "Dr. Erin Reyes" });
  });

  it("re-alerts only those who have not acknowledged, and stops at the limit and when the code closes", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const { agent: lopez } = await login(ctx.app, { username: "lopez" });
    const p = await strokeProtocol(director);
    const id = (await er.post("/api/codes/activate").send({ protocolId: p.id, location: "ED 4" })).body.id as number;
    await lopez.post(`/api/codes/activations/${id}/ack`);

    const later = (min: number) => new Date(Date.now() + min * 60_000);
    expect(await runCodeRealertSweep(new Date())).toBe(0); // not due yet
    expect(await runCodeRealertSweep(later(2))).toBe(1);
    expect(alertsTo(uid("patel"))).toBe(2);
    expect(alertsTo(uid("lopez"))).toBe(1);
    expect(await runCodeRealertSweep(later(2))).toBe(0); // just alerted
    for (let i = 3; i < 12; i++) await runCodeRealertSweep(later(i * 2));
    expect(alertsTo(uid("patel"))).toBe(MAX_ALERTS);

    const id2 = (await er.post("/api/codes/activate").send({ protocolId: p.id, location: "ED 5" })).body.id as number;
    await er.post(`/api/codes/activations/${id2}/close`).send({ outcome: "stood_down" });
    const before = alertsTo(uid("patel"));
    expect(await runCodeRealertSweep(later(60))).toBe(0);
    expect(alertsTo(uid("patel"))).toBe(before);
  });

  it("a member on Do Not Disturb hands the alert to their covering provider", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const { agent: lopez } = await login(ctx.app, { username: "lopez" });
    const p = await strokeProtocol(director);
    await lopez.patch("/api/settings/me").send({ key: "coveringUserId", value: uid("liu") }).expect(200);
    await lopez.patch("/api/settings/me").send({ key: "dnd", value: true }).expect(200);
    await er.post("/api/codes/activate").send({ protocolId: p.id, location: "ED 4" });
    expect(alertsTo(uid("liu"))).toBe(1);
    expect(alertsTo(uid("lopez"))).toBe(0);
    const m = (await board(er)).activations[0]!.members[0]!;
    expect(m).toMatchObject({ name: "Dr. Julia Dawson", coveringFor: "Dr. Adam Archer" });
  });

  it("is tenant-scoped, refuses a disabled protocol, and is off when the module is off", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const p = await strokeProtocol(director);
    const other = await ctx.storage.createOrganization({
      name: "Other Hospital", code: "OTHR", city: null, state: null, timezone: "America/New_York",
      assignmentTimeoutMin: 15, roundRobinShiftTypes: ["day", "night"], rotationMode: "lowest_census", rotationIndex: 0,
    });
    expect(await ctx.storage.getCodeProtocol(other.id, p.id)).toBeUndefined();
    expect(await ctx.storage.listCodeActivations(other.id)).toEqual([]);

    const full = (await board(director)).protocols[0] as { name: string; description: string; team: unknown[]; steps: unknown[] };
    expect((await director.patch(`/api/codes/protocols/${p.id}`).send({ name: full.name, description: full.description, team: full.team, steps: full.steps, enabled: false })).status).toBe(200);
    expect((await er.post("/api/codes/activate").send({ protocolId: p.id, location: "ED 4" })).status).toBe(404);
    expect((await board(er)).protocols).toHaveLength(0);
    expect((await board(director)).protocols).toHaveLength(1);
    expect((await er.post("/api/codes/activate").send({ protocolId: p.id, location: "" })).status).toBe(400);

    await setModule(orgId(), "codes.protocols", false);
    expect((await er.get("/api/codes")).status).toBe(404);
  });
});
