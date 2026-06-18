import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { runExpirySweep } from "../server/services/assignments.js";

let ctx: TestContext;

// Fresh DB per test so census/rotation assertions are deterministic.
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

async function createPatient(initials = "AB", specialty?: string) {
  const { agent } = await login(ctx.app, { username: "er.doc" });
  const res = await agent
    .post("/api/patients")
    .send({ initials, roomNumber: "101", issueSummary: "test", specialty });
  expect(res.status).toBe(201);
  return { agent, patient: res.body };
}

describe("assignments — round robin & lifecycle", () => {
  it("round-robin picks the lowest-census provider (Chen 3, not Patel 5)", async () => {
    const { agent, patient } = await createPatient();
    const res = await agent
      .post("/api/assignments")
      .send({ patientId: patient.id, mode: "round_robin" });
    expect(res.status).toBe(201);
    expect(res.body.hospitalistId).toBe(ctx.seedResult.hospitalistIds.chen);
    expect(res.body.status).toBe("pending");
  });

  it("accept increments census; reject does not", async () => {
    const { agent, patient } = await createPatient();
    const created = await agent
      .post("/api/assignments")
      .send({ patientId: patient.id, mode: "round_robin" });
    const chenId = ctx.seedResult.hospitalistIds.chen!;

    const before = await ctx.storage.getHospitalist(ctx.seedResult.orgId, chenId);
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const accept = await chen.patch(`/api/assignments/${created.body.id}/accept`);
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe("accepted");
    const after = await ctx.storage.getHospitalist(ctx.seedResult.orgId, chenId);
    expect(after!.currentPatientCount).toBe(before!.currentPatientCount + 1);

    // A second patient, this time rejected — census must not change.
    const { agent: er2, patient: p2 } = await createPatient("CD");
    const created2 = await er2
      .post("/api/assignments")
      .send({ patientId: p2.id, mode: "round_robin" });
    const target2 = created2.body.hospitalistId;
    const provider = (await ctx.storage.listHospitalists(ctx.seedResult.orgId)).find(
      (h) => h.id === target2,
    )!;
    const censusBeforeReject = provider.currentPatientCount;
    const { agent: targetUser } = await login(ctx.app, {
      username: providerUsername(target2),
    });
    const reject = await targetUser.patch(
      `/api/assignments/${created2.body.id}/reject`,
    );
    expect(reject.status).toBe(200);
    const providerAfter = await ctx.storage.getHospitalist(
      ctx.seedResult.orgId,
      target2,
    );
    expect(providerAfter!.currentPatientCount).toBe(censusBeforeReject);
  });

  it("reject reroutes to exactly one new pending assignment", async () => {
    const { agent, patient } = await createPatient();
    const created = await agent
      .post("/api/assignments")
      .send({ patientId: patient.id, mode: "round_robin" });
    const target = created.body.hospitalistId;
    const { agent: targetUser } = await login(ctx.app, {
      username: providerUsername(target),
    });
    const reject = await targetUser.patch(
      `/api/assignments/${created.body.id}/reject`,
    );
    expect(reject.status).toBe(200);
    expect(reject.body.reroute).toBeTruthy();
    expect(reject.body.reroute.status).toBe("pending");
    expect(reject.body.reroute.hospitalistId).not.toBe(target);

    const all = await ctx.storage.listAssignments(ctx.seedResult.orgId);
    const pendingForPatient = all.filter(
      (a) => a.patientId === patient.id && a.status === "pending",
    );
    expect(pendingForPatient).toHaveLength(1);
  });

  it("expiry sweep marks expired and reroutes", async () => {
    const { agent, patient } = await createPatient();
    const created = await agent
      .post("/api/assignments")
      .send({ patientId: patient.id, mode: "round_robin" });

    // Force the assignment into the past.
    await ctx.storage.updateAssignment(ctx.seedResult.orgId, created.body.id, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    const result = await runExpirySweep(ctx.storage, new Date());
    expect(result.expired).toBe(1);
    expect(result.rerouted).toBe(1);

    const updated = await ctx.storage.getAssignment(
      ctx.seedResult.orgId,
      created.body.id,
    );
    expect(updated!.status).toBe("expired");
    const pending = (await ctx.storage.listAssignments(ctx.seedResult.orgId)).filter(
      (a) => a.patientId === patient.id && a.status === "pending",
    );
    expect(pending).toHaveLength(1);
  });

  it("cap relief: still selects someone when every working provider is at cap", async () => {
    // Drive everyone to cap.
    for (const h of await ctx.storage.listWorkingHospitalists(ctx.seedResult.orgId)) {
      await ctx.storage.updateHospitalist(ctx.seedResult.orgId, h.id, {
        currentPatientCount: h.patientCap,
      });
    }
    const { agent, patient } = await createPatient();
    const res = await agent
      .post("/api/assignments")
      .send({ patientId: patient.id, mode: "round_robin" });
    expect(res.status).toBe(201);
    const picked = await ctx.storage.getHospitalist(
      ctx.seedResult.orgId,
      res.body.hospitalistId,
    );
    expect(picked!.organizationId).toBe(ctx.seedResult.orgId);
  });

  it("manual assignment targets exactly the chosen provider", async () => {
    const { agent, patient } = await createPatient();
    const lopezId = ctx.seedResult.hospitalistIds.lopez!;
    const res = await agent.post("/api/assignments").send({
      patientId: patient.id,
      mode: "manual",
      hospitalistId: lopezId,
    });
    expect(res.status).toBe(201);
    expect(res.body.hospitalistId).toBe(lopezId);
    expect(res.body.via).toBe("manual");
  });

  it("cancel of an accepted assignment decrements census", async () => {
    const { agent, patient } = await createPatient();
    const created = await agent
      .post("/api/assignments")
      .send({ patientId: patient.id, mode: "round_robin" });
    const chenId = ctx.seedResult.hospitalistIds.chen!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.patch(`/api/assignments/${created.body.id}/accept`);
    const afterAccept = await ctx.storage.getHospitalist(
      ctx.seedResult.orgId,
      chenId,
    );

    const { agent: director } = await login(ctx.app, { username: "director" });
    const cancel = await director.patch(
      `/api/assignments/${created.body.id}/cancel`,
    );
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("cancelled");
    const afterCancel = await ctx.storage.getHospitalist(
      ctx.seedResult.orgId,
      chenId,
    );
    expect(afterCancel!.currentPatientCount).toBe(
      afterAccept!.currentPatientCount - 1,
    );
  });
});

// Map a hospitalist id back to its seed username so we can log in as them.
function providerUsername(hospitalistId: number): string {
  const ids = ctx.seedResult.hospitalistIds;
  for (const [name, id] of Object.entries(ids)) {
    if (id === hospitalistId) return name;
  }
  throw new Error(`no seed user for hospitalist ${hospitalistId}`);
}
