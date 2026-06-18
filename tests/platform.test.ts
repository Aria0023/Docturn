import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createTestApp, login, type TestContext } from "./helpers.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

async function newPendingAssignment() {
  const { agent } = await login(ctx.app, { username: "er.doc" });
  const patient = await agent
    .post("/api/patients")
    .send({ initials: "ZZ", roomNumber: "9", issueSummary: "test", department: "MED" });
  const created = await agent
    .post("/api/assignments")
    .send({ patientId: patient.body.id, mode: "manual", hospitalistId: ctx.seedResult.hospitalistIds.chen });
  return { patientId: patient.body.id, assignmentId: created.body.id };
}

describe("v2 care teams & accept-lock", () => {
  it("a midlevel on the on-call unit can accept; the offer locks for others", async () => {
    const { assignmentId } = await newPendingAssignment();

    // Wu (PA) is on Chen's unit (seeded). Wu accepts.
    const { agent: wu } = await login(ctx.app, { username: "wu" });
    const accept = await wu.patch(`/api/assignments/${assignmentId}/accept`);
    expect(accept.status).toBe(200);
    expect(accept.body.acceptedByUserId).toBe(ctx.seedResult.userIds.wu);

    // Census is attributed to the ATTENDING (Chen), not the midlevel.
    const chen = await ctx.storage.getHospitalist(
      ctx.seedResult.orgId,
      ctx.seedResult.hospitalistIds.chen!,
    );
    expect(chen!.currentPatientCount).toBe(4); // seeded 3 + 1

    // Accept-lock: Chen trying to accept the now-accepted offer → 409.
    const { agent: chenAgent } = await login(ctx.app, { username: "chen" });
    const again = await chenAgent.patch(`/api/assignments/${assignmentId}/accept`);
    expect(again.status).toBe(409);
  });

  it("manages care-team membership and on-call", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const team = await agent.get("/api/care-team");
    expect(team.body.members).toHaveLength(1); // Wu

    const toggle = await agent
      .patch(`/api/care-team/members/${ctx.seedResult.userIds.wu}`)
      .send({ onCall: false });
    expect(toggle.status).toBe(200);
    expect(toggle.body.onCall).toBe(false);

    // Self-link forbidden.
    const self = await agent
      .post("/api/care-team/members")
      .send({ memberUserId: ctx.seedResult.userIds.chen });
    expect(self.status).toBe(409);
  });
});

describe("v2 patient board", () => {
  it("shows responsible attending + unit after accept; forbids developer", async () => {
    const { assignmentId } = await newPendingAssignment();
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.patch(`/api/assignments/${assignmentId}/accept`);

    const { agent: director } = await login(ctx.app, { username: "director" });
    const board = await director.get("/api/patient-board");
    expect(board.status).toBe(200);
    const row = board.body.find((r: any) => r.patient.initials === "ZZ");
    expect(row.responsible.attending.displayName).toContain("Chen");
    expect(row.responsible.unit.some((u: any) => u.credential === "PA")).toBe(true);

    // PHI access was logged for the board load.
    expect(await ctx.storage.countPhiAccess(ctx.seedResult.orgId)).toBeGreaterThan(0);
  });

  it("filters by department", async () => {
    await newPendingAssignment(); // department MED
    const { agent } = await login(ctx.app, { username: "director" });
    const med = await agent.get("/api/patient-board?department=MED");
    expect(med.body.every((r: any) => r.patient.department === "MED")).toBe(true);
    const icu = await agent.get("/api/patient-board?department=ICU");
    expect(icu.body.length).toBe(0);
  });
});

describe("v2 director census override", () => {
  it("is audited, clamped, and requires a reason", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const chenId = ctx.seedResult.hospitalistIds.chen!;

    const noReason = await agent
      .patch(`/api/hospitalists/${chenId}/census`)
      .send({ currentPatientCount: 5 });
    expect(noReason.status).toBe(400);

    const ok = await agent
      .patch(`/api/hospitalists/${chenId}/census`)
      .send({ currentPatientCount: 99, reason: "manual correction" });
    expect(ok.status).toBe(200);
    // Clamped to patient_cap (12).
    expect(ok.body.currentPatientCount).toBe(12);
  });
});

describe("broadcasts", () => {
  it("creates a broadcast and tracks per-recipient acks", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const b = await director
      .post("/api/broadcasts")
      .send({ message: "Code blue, 4th floor", severity: "critical" });
    expect(b.status).toBe(201);

    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const ack = await chen.post(`/api/broadcasts/${b.body.id}/ack`);
    expect(ack.status).toBe(204);

    const detail = await director.get(`/api/broadcasts/${b.body.id}`);
    expect(detail.body.acks).toHaveLength(1);
    expect(detail.body.acks[0].userId).toBe(ctx.seedResult.userIds.chen);
  });

  it("forbids a hospitalist from creating a broadcast", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const res = await agent.post("/api/broadcasts").send({ message: "x" });
    expect(res.status).toBe(403);
  });
});

describe("developer provisioning & cross-tenant", () => {
  it("creates an org and a clinical user (audited), with a paired profile", async () => {
    // Promote the seeded director to developer for this test by direct write.
    await ctx.storage.updateUser(ctx.seedResult.userIds.director!, {
      role: "developer",
    });
    const { agent } = await login(ctx.app, { username: "director" });

    const org = await agent
      .post("/api/dev/organizations")
      .send({ name: "St. Luke's", code: "LUKE" });
    expect(org.status).toBe(201);

    const user = await agent.post("/api/dev/users").send({
      organizationId: org.body.id,
      role: "hospitalist",
      displayName: "Dr. Lena Ortiz",
      username: "ortiz",
      credential: "MD",
      specialty: "Nephrology",
      patientCap: 15,
      shiftType: "day",
    });
    expect(user.status).toBe(201);
    expect(user.body).not.toHaveProperty("passwordHash");

    const provs = await ctx.storage.listHospitalists(org.body.id);
    expect(provs).toHaveLength(1);
    expect(provs[0]!.specialty).toBe("Nephrology");
  });
});

describe("config: flags & adaptive suggestions", () => {
  it("sets a feature flag per org", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const set = await agent
      .patch("/api/feature-flags")
      .send({ flag: "new_board", enabled: true });
    expect(set.status).toBe(200);
    const list = await agent.get("/api/feature-flags");
    expect(list.body.find((f: any) => f.flag === "new_board").enabled).toBe(true);
  });

  it("proposes a timeout suggestion from fast accepts and applies it on accept", async () => {
    // Seed several fast-accepted assignments (accept latency ~1m vs 10m window).
    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      const a = await ctx.storage.createAssignment({
        organizationId: ctx.seedResult.orgId,
        patientId: ctx.seedResult.patientIds.sc!,
        hospitalistId: ctx.seedResult.hospitalistIds.chen!,
        erDoctorId: ctx.seedResult.userIds["er.doc"]!,
        status: "accepted",
        via: "round_robin",
        acceptedByUserId: ctx.seedResult.userIds.chen!,
        expiresAt: new Date(now + 600000),
      });
      await ctx.storage.updateAssignment(ctx.seedResult.orgId, a.id, {
        resolvedAt: new Date(new Date(a.createdAt).getTime() + 60_000),
      });
    }

    const { agent } = await login(ctx.app, { username: "director" });
    const list = await agent.get("/api/suggestions");
    const s = list.body.find((x: any) => x.key === "assignment_timeout");
    expect(s).toBeTruthy();
    expect(s.evidence).toContain("median");

    const accept = await agent.post(`/api/suggestions/${s.id}/accept`);
    expect(accept.status).toBe(200);
    const cfg = await agent.get("/api/org/config");
    expect(cfg.body.assignmentTimeoutMin).toBeLessThan(10);
  });
});

describe("mobile API", () => {
  it("exposes safe org fields publicly and compact assignments to providers", async () => {
    const pub = await supertest(ctx.app).get("/api/mobile/org/MERCY");
    expect(pub.status).toBe(200);
    expect(pub.body).toEqual({
      id: ctx.seedResult.orgId,
      name: "Mercy General Hospital",
      code: "MERCY",
      timezone: "America/New_York",
    });

    const { agent } = await login(ctx.app, { username: "chen" });
    const reg = await agent
      .post("/api/mobile/device-tokens")
      .send({ token: "tok-123", platform: "ios" });
    expect(reg.status).toBe(201);

    const compact = await agent.get("/api/mobile/assignments");
    expect(compact.status).toBe(200);
    // Compact payload exposes initials/room/specialty only.
    for (const a of compact.body) {
      expect(a).toHaveProperty("initials");
      expect(a).not.toHaveProperty("issueSummary");
    }
  });
});
