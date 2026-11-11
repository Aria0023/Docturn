import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { countBillableSeats } from "../server/billing/seats.js";
import { invalidateModules, setModule } from "../server/modules.js";
import { resolveCovering } from "../server/services/escalation.js";

/**
 * Role-logic and cross-role interoperability review (2026-11).
 *
 * Each case here was a live defect found by walking every route as every role
 * and then walking the hand-offs between them:
 *   • one patient could be routed twice, and two people could accept the same
 *     request at the same moment (census counted twice);
 *   • a request could be sent to — and sit in front of — a deactivated
 *     account until it timed out; "All on shift" put a deactivated account
 *     back on the rotation;
 *   • an ER director could approve a HOSPITALIST's self-registration although
 *     everywhere else they add and manage ER physicians only;
 *   • reactivating an account skipped the seat limit that adding one enforces;
 *   • a sender "acknowledging" their own STAT announced an acknowledgement
 *     the recipient never gave;
 *   • any signed-in account could rewrite any consult, with no audit row.
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
  invalidateModules();
});
afterEach(async () => {
  await ctx.handle.close();
});

const as = async (username: string, orgCode?: string) => (await login(ctx.app, { username, orgCode })).agent;
const orgId = () => ctx.seedResult.orgId;

async function routedPatient(initials = "RV") {
  const er = await as("er.doc");
  const p = await er.post("/api/patients").send({ initials, roomNumber: "ER-1", issueSummary: "review" });
  expect(p.status).toBe(201);
  const a = await er.post("/api/assignments").send({ patientId: p.body.id, mode: "round_robin" });
  expect(a.status).toBe(201);
  return { er, patient: p.body, assignment: a.body };
}
async function userOfHospitalist(hospitalistId: number) {
  const h = (await ctx.storage.getHospitalist(orgId(), hospitalistId))!;
  return (await ctx.storage.getUser(orgId(), h.userId))!;
}

describe("admission routing — one live request per patient, one winner per request", () => {
  it("a second Assign for a patient who is already being routed is refused", async () => {
    const { er, patient } = await routedPatient();
    const again = await er.post("/api/assignments").send({ patientId: patient.id, mode: "round_robin" });
    expect(again.status).toBe(409);
    const live = (await ctx.storage.listAssignments(orgId())).filter(
      (a) => a.patientId === patient.id && (a.status === "pending" || a.status === "accepted"),
    );
    expect(live).toHaveLength(1);
  });

  it("two simultaneous accepts: exactly one wins and the census moves by one", async () => {
    const { assignment } = await routedPatient();
    const owner = await userOfHospitalist(assignment.hospitalistId);
    const before = (await ctx.storage.getHospitalist(orgId(), assignment.hospitalistId))!.currentPatientCount;
    const a1 = await as(owner.username);
    const a2 = await as(owner.username);
    const [r1, r2] = await Promise.all([
      a1.patch(`/api/assignments/${assignment.id}/accept`),
      a2.patch(`/api/assignments/${assignment.id}/accept`),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const after = (await ctx.storage.getHospitalist(orgId(), assignment.hospitalistId))!.currentPatientCount;
    expect(after).toBe(before + 1);
  });

  it("cancelling a request that is no longer live is refused and rewrites nothing", async () => {
    const { assignment } = await routedPatient();
    const director = await as("director");
    expect((await director.patch(`/api/assignments/${assignment.id}/cancel`)).status).toBe(200);
    const first = (await ctx.storage.getAssignment(orgId(), assignment.id))!;
    const again = await director.patch(`/api/assignments/${assignment.id}/cancel`);
    expect(again.status).toBe(409);
    const second = (await ctx.storage.getAssignment(orgId(), assignment.id))!;
    expect(second.resolvedAt?.getTime()).toBe(first.resolvedAt?.getTime());
  });
});

describe("a deactivated account is never offered a patient", () => {
  it("deactivation releases a waiting request to the next provider at once", async () => {
    const { patient, assignment } = await routedPatient();
    const owner = await userOfHospitalist(assignment.hospitalistId);
    const director = await as("director");
    expect((await director.post(`/api/accounts/${owner.id}/deactivate`)).status).toBe(200);
    const rows = (await ctx.storage.listAssignments(orgId())).filter((a) => a.patientId === patient.id);
    expect(rows.find((a) => a.id === assignment.id)!.status).toBe("expired");
    const live = rows.filter((a) => a.status === "pending");
    expect(live).toHaveLength(1);
    expect(live[0]!.hospitalistId).not.toBe(assignment.hospitalistId);
  });

  it("a manual assign or reassign to a deactivated provider is refused, and the patient stays where they were", async () => {
    const { er, assignment } = await routedPatient();
    const hosps = await ctx.storage.listHospitalists(orgId());
    const other = hosps.find((h) => h.id !== assignment.hospitalistId)!;
    const director = await as("director");
    expect((await director.post(`/api/accounts/${other.userId}/deactivate`)).status).toBe(200);

    const re = await er.patch(`/api/assignments/${assignment.id}/reassign`).send({ hospitalistId: other.id });
    expect(re.status).toBe(409);
    expect((await ctx.storage.getAssignment(orgId(), assignment.id))!.status).toBe("pending");

    const p2 = await er.post("/api/patients").send({ initials: "MN", roomNumber: "ER-2", issueSummary: "manual" });
    const manual = await er.post("/api/assignments").send({ patientId: p2.body.id, mode: "manual", hospitalistId: other.id });
    expect(manual.status).toBe(409);
  });

  it("'All on shift' and the single switch leave a deactivated account off the rotation", async () => {
    const hosps = await ctx.storage.listHospitalists(orgId());
    const target = hosps[0]!;
    const director = await as("director");
    await director.post(`/api/accounts/${target.userId}/deactivate`);
    expect((await director.patch("/api/hospitalists/working-status").send({ all: true })).status).toBe(200);
    expect((await ctx.storage.getHospitalist(orgId(), target.id))!.working).toBe(false);
    const one = await director.patch(`/api/hospitalists/${target.id}/working-status`).send({ working: true });
    expect(one.status).toBe(409);
    expect(one.body.error).toBe("user_deactivated");
    expect((await ctx.storage.listWorkingHospitalists(orgId())).some((h) => h.id === target.id)).toBe(false);
  });

  it("nobody can open a new thread with a deactivated account, and the directory flags it", async () => {
    const hosps = await ctx.storage.listHospitalists(orgId());
    const target = hosps[0]!;
    const director = await as("director");
    await director.post(`/api/accounts/${target.userId}/deactivate`);
    const er = await as("er.doc");
    const convo = await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [target.userId] });
    expect(convo.status).toBe(409);
    expect(convo.body.error).toBe("user_deactivated");
    const dir = await er.get("/api/physicians/directory");
    const row = dir.body.find((d: { userId: number }) => d.userId === target.userId);
    expect(row.active).toBe(false);
    expect(row.working).toBe(false);
  });
});

describe("self-registration review follows the reviewer's reach", () => {
  const register = (username: string, requestedRole?: string) =>
    supertest(ctx.app).post("/api/register").send({
      orgCode: "ISPN",
      username,
      password: "Str0ng-pass-phrase!",
      displayName: "Dr. " + username,
      ...(requestedRole ? { requestedRole } : {}),
    });

  it("an ER director sees and decides ER-physician requests only", async () => {
    expect((await register("rv.hosp")).status).toBe(201);
    expect((await register("rv.er", "er_doctor")).status).toBe(201);
    const erDirector = await as("er.director");
    const director = await as("director");

    const mine = await erDirector.get("/api/registrations");
    expect(mine.body.map((r: { username: string }) => r.username)).toEqual(["rv.er"]);
    const all = await director.get("/api/registrations");
    expect(all.body.map((r: { username: string }) => r.username).sort()).toEqual(["rv.er", "rv.hosp"]);

    const hospReq = all.body.find((r: { username: string }) => r.username === "rv.hosp");
    const erReq = all.body.find((r: { username: string }) => r.username === "rv.er");
    expect((await erDirector.post(`/api/registrations/${hospReq.id}/approve`)).status).toBe(404);
    expect((await erDirector.post(`/api/registrations/${hospReq.id}/deny`)).status).toBe(404);
    expect(await ctx.storage.getUserByUsername(orgId(), "rv.hosp")).toBeFalsy();

    expect((await erDirector.post(`/api/registrations/${erReq.id}/approve`)).status).toBe(201);
    expect((await director.post(`/api/registrations/${hospReq.id}/approve`)).status).toBe(201);
    expect((await ctx.storage.getUserByUsername(orgId(), "rv.hosp"))!.role).toBe("hospitalist");
  });
});

describe("billing — reactivating an account is creating a seat", () => {
  async function contractAtExactlyCurrentSeats() {
    const plan = await ctx.storage.createBillingPlan({
      code: "rv-" + Math.random().toString(36).slice(2, 8),
      name: "Review plan",
      moduleIds: [],
      perSeatPriceCents: 1500,
      currency: "USD",
    });
    const seats = (await countBillableSeats(ctx.storage, orgId())).total;
    await ctx.storage.upsertOrgContract({
      organizationId: orgId(),
      planId: plan.id,
      term: "monthly",
      startDate: "2026-01-01",
      endDate: null,
      committedSeats: seats,
      priceOverrideCents: null,
      poNumber: null,
      billingContactName: null,
      billingContactEmail: null,
      status: "active",
      pastDueAt: null,
      createdBy: null,
    });
    return seats;
  }

  it("deactivate → add → reactivate cannot walk past the commitment; the operator still can", async () => {
    await contractAtExactlyCurrentSeats();
    const director = await as("director");
    const hosps = await ctx.storage.listHospitalists(orgId());
    const leaver = hosps[0]!;
    expect((await director.post(`/api/accounts/${leaver.userId}/deactivate`)).status).toBe(200);
    // The freed seat is taken by a new account…
    const add = await director
      .post("/api/director/hospitalists")
      .send({ username: "rv.new", displayName: "Dr. New", role: "hospitalist" });
    expect(add.status).toBe(201);
    // …so restoring the first one is a seat the contract does not have.
    const back = await director.post(`/api/accounts/${leaver.userId}/reactivate`);
    expect(back.status).toBe(402);
    expect(back.body.error).toBe("seat_refused");
    expect(back.body.reason).toBe("seat_limit_reached");
    expect((await ctx.storage.getUserById(leaver.userId))!.disabledAt).not.toBeNull();
    const trail = await ctx.storage.listAuditLogs(orgId(), 100);
    expect(
      trail.find((a) => a.action === "billing.seat_refused" && (a.details as Record<string, unknown>).via === "reactivation"),
    ).toBeTruthy();

    const dev = await as("dev", "DOCTURN");
    expect((await dev.post(`/api/accounts/${leaver.userId}/reactivate`)).status).toBe(200);
    expect((await ctx.storage.getUserById(leaver.userId))!.disabledAt).toBeNull();
  });

  it("with no contract on file reactivation is exactly as before", async () => {
    const director = await as("director");
    const hosps = await ctx.storage.listHospitalists(orgId());
    await director.post(`/api/accounts/${hosps[0]!.userId}/deactivate`);
    expect((await director.post(`/api/accounts/${hosps[0]!.userId}/reactivate`)).status).toBe(200);
  });
});

describe("STAT acknowledgement — only the recipient's counts", () => {
  it("a sender acknowledging their own STAT records and announces nothing", async () => {
    const er = await as("er.doc");
    const patel = (await ctx.storage.getUserByUsername(orgId(), "patel"))!;
    const convo = await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [patel.id] });
    const msg = await er.post("/api/messaging/send").send({ conversationId: convo.body.id, content: "STAT call ER", priority: "stat" });
    expect(msg.status).toBe(201);
    expect((await er.post("/api/messaging/messages/ack").send({ messageIds: [msg.body.id] })).status).toBe(204);
    const rows = await ctx.storage.listDeliveryForMessages([msg.body.id]);
    // (The sender's own row is acknowledged at send time; the RECIPIENT's is not.)
    const theirs = rows.filter((r) => r.userId === patel.id);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]!.acknowledgedAt).toBeNull();
    // The sender's "ack" recorded nothing new, so nothing is announced.
    expect(await ctx.storage.acknowledgeMessages(msg.body.senderId, [msg.body.id])).toEqual([]);
    expect(await ctx.storage.acknowledgeMessages(patel.id, [msg.body.id])).toEqual([msg.body.id]);
    // A repeat is not a second acknowledgement.
    expect(await ctx.storage.acknowledgeMessages(patel.id, [msg.body.id])).toEqual([]);
  });

  it("a message body has an upper bound", async () => {
    const er = await as("er.doc");
    const patel = (await ctx.storage.getUserByUsername(orgId(), "patel"))!;
    const convo = await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [patel.id] });
    const big = await er.post("/api/messaging/send").send({ conversationId: convo.body.id, content: "x".repeat(20_001) });
    expect(big.status).toBe(400);
  });
});

describe("consult updates — clinical roles, a real consultant, an audit row", () => {
  it("validates the re-pointed consultant, audits the answer, and refuses the operator", async () => {
    const { er, patient } = await routedPatient("CS");
    const created = await er.post(`/api/patients/${patient.id}/consults`).send({ specialty: "Cardiology" });
    expect(created.status).toBe(201);
    const consult = created.body[0];

    // Another tenant's user id is not a consultant here.
    const dev = (await ctx.storage.getUserByUsername(ctx.seedResult.platformOrgId, "dev"))!;
    expect((await er.patch(`/api/consults/${consult.id}`).send({ consultantUserId: dev.id })).status).toBe(400);

    const ok = await er.patch(`/api/consults/${consult.id}`).send({ status: "accepted" });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("accepted");
    const trail = await ctx.storage.listAuditLogs(orgId(), 100);
    const row = trail.find((a) => a.action === "consult.update");
    expect(row).toBeTruthy();
    expect((row!.details as Record<string, unknown>).to).toBe("accepted");
    // The audit row carries ids and states — never the specialty or patient text.
    expect(JSON.stringify(row!.details)).not.toMatch(/Cardiology|review/);

    const operator = await as("dev", "DOCTURN");
    expect((await operator.patch(`/api/consults/${consult.id}`).send({ status: "declined" })).status).toBe(403);
  });
});

describe("a role change keeps the rotation consistent (identity-provider path)", () => {
  async function scimPatchRole(userId: number, role: string) {
    await setModule(orgId(), "enterprise.scim", true);
    invalidateModules();
    const director = await as("director");
    const minted = await director.post("/api/org/scim-tokens").send({ label: "review" });
    expect(minted.status).toBe(201);
    return supertest(ctx.app)
      .patch(`/scim/v2/Users/${userId}`)
      .set("Authorization", "Bearer " + minted.body.token)
      .set("Content-Type", "application/scim+json")
      .send({ Operations: [{ op: "replace", path: "roles", value: [{ value: role }] }] });
  }

  it("a hospitalist moved to ER physician leaves the round-robin and their waiting request is re-offered", async () => {
    const { patient, assignment } = await routedPatient("RC");
    const owner = await userOfHospitalist(assignment.hospitalistId);
    expect((await scimPatchRole(owner.id, "er_doctor")).status).toBe(200);
    expect((await ctx.storage.getUserById(owner.id))!.role).toBe("er_doctor");
    // Off the rotation — an ER physician cannot accept an admission.
    expect((await ctx.storage.listWorkingHospitalists(orgId())).some((h) => h.userId === owner.id)).toBe(false);
    const rows = (await ctx.storage.listAssignments(orgId())).filter((a) => a.patientId === patient.id);
    expect(rows.find((a) => a.id === assignment.id)!.status).toBe("expired");
    const live = rows.filter((a) => a.status === "pending");
    expect(live).toHaveLength(1);
    expect(live[0]!.hospitalistId).not.toBe(assignment.hospitalistId);
  });

  it("an ER physician moved to hospitalist gets a rotation profile (off shift)", async () => {
    const erDoc = (await ctx.storage.getUserByUsername(orgId(), "er.doc"))!;
    expect(await ctx.storage.getHospitalistByUser(orgId(), erDoc.id)).toBeFalsy();
    expect((await scimPatchRole(erDoc.id, "hospitalist")).status).toBe(200);
    const profile = await ctx.storage.getHospitalistByUser(orgId(), erDoc.id);
    expect(profile).toBeTruthy();
    expect(profile!.working).toBe(false);
    // …so they can start a shift like any other hospitalist.
    const agent = await as("er.doc");
    expect((await agent.post("/api/shift/start").send({})).status).toBe(200);
  });
});

describe("a director changes a person's role in place", () => {
  it("hospitalist → ER physician: off the rotation, signed out, same account; audited", async () => {
    const { patient, assignment } = await routedPatient("RD");
    const owner = await userOfHospitalist(assignment.hospitalistId);
    const ownerAgent = await as(owner.username);
    expect((await ownerAgent.get("/api/user")).status).toBe(200);

    const director = await as("director");
    const res = await director.post(`/api/accounts/${owner.id}/role`).send({ role: "er_doctor" });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    expect((await ctx.storage.getUserById(owner.id))!.role).toBe("er_doctor");
    // Their open session ended: they sign in again into the new workspace.
    expect((await ownerAgent.get("/api/messaging/conversations")).status).toBe(401);
    // Off the round-robin, and the waiting request moved on.
    expect((await ctx.storage.listWorkingHospitalists(orgId())).some((h) => h.userId === owner.id)).toBe(false);
    const live = (await ctx.storage.listAssignments(orgId())).filter((a) => a.patientId === patient.id && a.status === "pending");
    expect(live).toHaveLength(1);
    expect(live[0]!.hospitalistId).not.toBe(assignment.hospitalistId);
    const trail = await ctx.storage.listAuditLogs(orgId(), 100);
    const row = trail.find((a) => a.action === "account.role_change");
    expect(row).toBeTruthy();
    expect(row!.details).toMatchObject({ from: "hospitalist", to: "er_doctor" });
    // The same person, re-signed-in, now works as an ER physician.
    const again = await as(owner.username);
    expect((await again.get("/api/assignments/sent")).status).toBe(200);
    expect((await again.get("/api/assignments/pending")).status).toBe(403);
  });

  it("ER physician → hospitalist gets a rotation profile; the seat count does not move", async () => {
    const before = (await countBillableSeats(ctx.storage, orgId())).total;
    const erDoc = (await ctx.storage.getUserByUsername(orgId(), "er.doc"))!;
    const director = await as("director");
    expect((await director.post(`/api/accounts/${erDoc.id}/role`).send({ role: "hospitalist" })).status).toBe(200);
    expect(await ctx.storage.getHospitalistByUser(orgId(), erDoc.id)).toBeTruthy();
    expect((await countBillableSeats(ctx.storage, orgId())).total).toBe(before);
  });

  it("is the hospitalist director's alone: never an ER director's, never on yourself, never to or from developer", async () => {
    const erDoc = (await ctx.storage.getUserByUsername(orgId(), "er.doc"))!;
    const erDirector = await as("er.director");
    expect((await erDirector.post(`/api/accounts/${erDoc.id}/role`).send({ role: "hospitalist" })).status).toBe(403);
    const director = await as("director");
    const me = (await ctx.storage.getUserByUsername(orgId(), "director"))!;
    expect((await director.post(`/api/accounts/${me.id}/role`).send({ role: "hospitalist" })).status).toBe(409);
    expect((await director.post(`/api/accounts/${erDoc.id}/role`).send({ role: "developer" })).status).toBe(400);
    const dev = (await ctx.storage.getUserByUsername(ctx.seedResult.platformOrgId, "dev"))!;
    expect((await director.post(`/api/accounts/${dev.id}/role`).send({ role: "hospitalist" })).status).toBe(404);
    expect((await ctx.storage.getUserById(erDoc.id))!.role).toBe("er_doctor");
    expect((await ctx.storage.getUserById(dev.id))!.role).toBe("developer");
  });

  it("a hospitalist promoted to director keeps their place in the rotation", async () => {
    const hosps = await ctx.storage.listHospitalists(orgId());
    const h = hosps.find((x) => x.working)!;
    const director = await as("director");
    expect((await director.post(`/api/accounts/${h.userId}/role`).send({ role: "director" })).status).toBe(200);
    expect((await ctx.storage.getHospitalist(orgId(), h.id))!.working).toBe(true);
    expect((await ctx.storage.listWorkingHospitalists(orgId())).some((x) => x.id === h.id)).toBe(true);
  });
});

describe("a deactivated account never stands in for anyone", () => {
  it("is not resolved as a covering provider, and its on-call role is not offered", async () => {
    const chen = (await ctx.storage.getUserByUsername(orgId(), "chen"))!;
    const patel = (await ctx.storage.getUserByUsername(orgId(), "patel"))!;
    await ctx.storage.setUserPreference(orgId(), chen.id, "coveringUserId", patel.id);
    expect(await resolveCovering(ctx.storage, orgId(), chen.id)).toBe(patel.id);

    const er = await as("er.doc");
    const before = await er.get("/api/messaging/on-call-targets");
    expect(before.status).toBe(200);

    const director = await as("director");
    expect((await director.post(`/api/accounts/${patel.id}/deactivate`)).status).toBe(200);
    expect(await resolveCovering(ctx.storage, orgId(), chen.id)).toBeNull();

    // No role on the list resolves to — or is covered by — the deactivated account.
    const after = await er.get("/api/messaging/on-call-targets");
    expect(after.body.every((t: { userId: number; onCallUserId?: number }) => t.userId !== patel.id && t.onCallUserId !== patel.id)).toBe(true);
  });
});
