import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { invalidateModules } from "../server/modules.js";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  invalidateModules();
  await ctx.handle.close();
});

const orgId = () => ctx.seedResult.orgId;
type Agent = Awaited<ReturnType<typeof login>>["agent"];

/** A director adds a charge nurse; she signs in with the one-time password and sets her own. */
async function addNurse(by: Agent, username = "rn.kay") {
  const res = await by.post("/api/director/hospitalists").send({
    username, displayName: "Kay Rivers", role: "staff", credential: "RN", jobTitle: "Charge nurse, ED",
  });
  expect(res.status).toBe(201);
  const temp = res.body.temporaryPassword as string;
  const first = await login(ctx.app, { username, password: temp });
  expect(first.res.status).toBe(200);
  const pw = "Staff-Account-Pw-91!";
  expect((await first.agent.patch("/api/account/password").send({ currentPassword: temp, newPassword: pw })).status).toBe(200);
  const { agent, res: signIn } = await login(ctx.app, { username, password: pw });
  expect(signIn.status).toBe(200);
  return { agent, id: res.body.user?.id ?? res.body.id };
}

describe("staff accounts (nurses, technologists, pharmacists)", () => {
  it("a director or ER director adds one; it has a job title and no rotation profile", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: erDirector } = await login(ctx.app, { username: "er.director" });
    const before = (await ctx.storage.listHospitalists(orgId())).length;
    await addNurse(director);
    const second = await erDirector.post("/api/director/hospitalists").send({ username: "ct.tech", displayName: "Sam Ortiz", role: "staff", jobTitle: "CT technologist" });
    expect(second.status).toBe(201);
    // An ER director still cannot add a hospitalist.
    expect((await erDirector.post("/api/director/hospitalists").send({ username: "x.y", displayName: "X Y", role: "hospitalist" })).status).toBe(403);
    expect((await ctx.storage.listHospitalists(orgId())).length).toBe(before);

    const nurse = (await ctx.storage.getUserByUsername(orgId(), "rn.kay"))!;
    expect(nurse).toMatchObject({ role: "staff", credential: "RN", jobTitle: "Charge nurse, ED" });
    const row = (await director.get("/api/accounts")).body.find((u: { username: string }) => u.username === "rn.kay");
    expect(row).toMatchObject({ role: "staff", jobTitle: "Charge nurse, ED" });
    // The ER director manages staff accounts too.
    expect((await erDirector.post(`/api/accounts/${nurse.id}/job-title`).send({ jobTitle: "House supervisor" })).status).toBe(200);
    expect((await ctx.storage.getUserByUsername(orgId(), "rn.kay"))!.jobTitle).toBe("House supervisor");
    expect((await erDirector.post(`/api/accounts/${nurse.id}/job-title`).send({ jobTitle: "x".repeat(61) })).status).toBe(400);
  });

  it("staff can follow admissions, run reports, see on-call and message — and see who has not accepted", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: nurse } = await addNurse(director);

    const board = await nurse.get("/api/patient-board");
    expect(board.status).toBe(200);
    // The seed leaves one request waiting: the tracker names who was asked.
    const waiting = board.body.find((r: { status: string }) => r.status === "pending");
    expect(waiting.request).toMatchObject({ status: "pending", hospitalist: { displayName: "Dr. Nolan Avery" } });
    expect(waiting.request.expiresAt).toBeTruthy();
    expect(waiting.enteredAt).toBeTruthy();

    expect((await nurse.post("/api/reporting/run").send({ ref: "builtin:pending_admits" })).status).toBe(200);
    expect((await nurse.get("/api/oncall/board")).status).toBe(200);
    expect((await nurse.get("/api/codes")).status).toBe(200);
    const convo = await nurse.post("/api/messaging/conversations").send({ type: "direct", participantIds: [ctx.seedResult.userIds.chen] });
    expect([200, 201]).toContain(convo.status);
    const sent = await nurse.post("/api/messaging/send").send({ conversationId: convo.body.id, content: "Bed 4 is ready for your admission." });
    expect([200, 201]).toContain(sent.status);
  });

  it("staff cannot send, accept, reassign or manage anything", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: nurse } = await addNurse(director);
    const pending = (await ctx.storage.listAssignments(orgId())).find((a) => a.status === "pending")!;
    const refused: Array<[string, () => Promise<{ status: number }>]> = [
      ["add a patient", () => nurse.post("/api/patients").send({ initials: "ZZ", roomNumber: "1", issueSummary: "x" })],
      ["send an admission", () => nurse.post("/api/assignments").send({ patientId: pending.patientId, mode: "round_robin" })],
      ["accept an admission", () => nurse.patch(`/api/assignments/${pending.id}/accept`).send({})],
      ["edit a patient", () => nurse.patch(`/api/patients/${pending.patientId}`).send({ roomNumber: "9" })],
      ["remove a patient", () => nurse.delete(`/api/patients/${pending.patientId}`)],
      ["request a consult", () => nurse.post(`/api/patients/${pending.patientId}/consults`).send({ specialty: "Cardiology" })],
      ["list accounts", () => nurse.get("/api/accounts")],
      ["add an account", () => nurse.post("/api/director/hospitalists").send({ username: "a.b", displayName: "A B", role: "staff" })],
      ["send a broadcast", () => nurse.post("/api/broadcasts").send({ message: "x", severity: "info", audience: "all" })],
      ["set up a code protocol", () => nurse.post("/api/codes/protocols").send({ name: "X", team: [{ label: "A", kind: "user", ref: "1" }], steps: [] })],
      ["director analytics", () => nurse.get("/api/reports/ops")],
      ["change settings", () => nurse.patch("/api/org/config").send({ assignmentTimeoutMin: 5 })],
      ["clear patients", () => nurse.post("/api/maintenance/purge").send({ olderThanHours: 0 })],
      ["share a report", () => nurse.post("/api/reporting/reports").send({ name: "S", dataset: "provider_load", shared: true, config: { columns: ["hospitalist"], filters: [], groupBy: null, sort: null, ehrListId: null } })],
    ];
    for (const [what, call] of refused) expect([what, (await call()).status]).toEqual([what, 403]);
    // Nothing above changed the waiting request.
    expect((await ctx.storage.getAssignment(orgId(), pending.id))!.status).toBe("pending");
  });

  it("a nurse on a code team is alerted, acknowledges, and can call a code", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: nurse } = await addNurse(director);
    const nurseId = (await ctx.storage.getUserByUsername(orgId(), "rn.kay"))!.id;
    const opts = (await director.get("/api/codes/team-options")).body;
    expect(opts.people.find((p: { id: number }) => p.id === nurseId)).toMatchObject({ role: "staff", jobTitle: "Charge nurse, ED" });
    const p = await director.post("/api/codes/protocols").send({
      name: "Code Stroke", team: [{ label: "Charge nurse", kind: "user", ref: String(nurseId) }, { label: "Hospitalist", kind: "user", ref: String(ctx.seedResult.userIds.patel) }], steps: [{ label: "CT head started", targetMin: 25 }],
    });
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const id = (await er.post("/api/codes/activate").send({ protocolId: p.body.id, location: "ED 4" })).body.id;
    expect(ctx.ws.delivered.some((d) => (d.message as { type: string }).type === "CODE_ALERT" && d.userIds.includes(nurseId))).toBe(true);
    expect((await nurse.post(`/api/codes/activations/${id}/ack`)).status).toBe(204);
    const view = (await nurse.get("/api/codes")).body.activations[0];
    expect(view.members[0]).toMatchObject({ me: true, name: "Kay Rivers" });
    expect(view.members[0].acknowledgedAt).toBeTruthy();
    expect((await nurse.post(`/api/codes/activations/${id}/close`).send({ outcome: "completed" })).status).toBe(204);
    // She can call one herself.
    expect((await nurse.post("/api/codes/activate").send({ protocolId: p.body.id, location: "5 West" })).status).toBe(201);
  });

  it("broadcasts can be addressed to staff, and a role change to staff takes a hospitalist off the rotation", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    await addNurse(director);
    const nurseId = (await ctx.storage.getUserByUsername(orgId(), "rn.kay"))!.id;
    const b = await director.post("/api/broadcasts").send({ message: "Downtime at 02:00", severity: "info", audience: ["staff"] });
    expect(b.status).toBe(201);
    expect(b.body.total).toBe(1);
    expect((await ctx.storage.getBroadcast(orgId(), b.body.id))!.recipientIds).toEqual([nurseId]);

    const wu = ctx.seedResult.userIds.wu!;
    expect((await director.post(`/api/accounts/${wu}/role`).send({ role: "staff" })).status).toBe(200);
    const prof = await ctx.storage.getHospitalistByUser(orgId(), wu);
    expect(!prof || prof.working === false).toBe(true);
  });
});
