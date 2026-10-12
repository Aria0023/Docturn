import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateModules } from "../server/modules.js";
import { ensureDemoTenants } from "../server/seed.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * The clinical screens, server side (A.CON clinical #1-#23). Every control the
 * ER director / ER doctor / hospitalist / director / patient-board screens
 * offer must claim only what these routes persist and enforce:
 *
 *   #1      ER diversion is the ORG's (org setting "erDiversion"): read by the
 *           org, declared / lifted by an ER director or director, audited,
 *           announced (DIVERSION_UPDATED) and broadcast to everyone through the
 *           real broadcast pipeline — and nothing says "EMS notified".
 *   #2      The ER physicians roster is the org's er_doctor accounts, with
 *           on/off shift and shift kept on the server (org setting "erRoster").
 *   #3      ER throughput (time-to-accept, admits in 24 h) is computed by the
 *           server: org-wide for the ER director, the physician's own for an
 *           ER doctor (GET /api/reports/er).
 *   #11/#12 A provider's name and specialty are server records
 *           (PATCH /api/hospitalists/:id/profile).
 *   #13-#15 A director / ER director edits a patient's room and issue
 *           (PATCH /api/patients/:id), adds an admission (POST /api/patients
 *           + POST /api/assignments) and removes one (DELETE /api/patients/:id,
 *           one audited transaction).
 *   #17/#18 The intake extractor is the server's, per org, and says which
 *           engine ran; it never invents initials.
 *   #19/#20 Consult requests name only this org's people.
 *   #23     A consult request alerts every consultant who has an account
 *           (socket + content-free push); a placeholder alerts nobody.
 *   #4      Care-team links refuse deactivated people and are audited.
 */

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
  invalidateModules();
});
afterEach(async () => {
  await ctx.handle.close();
});

const as = async (username: string, orgCode = "ISPN") => (await login(ctx.app, { username, orgCode })).agent;
const devLogin = () => as("dev", "DOCTURN");
const audit = (orgId = ctx.seedResult.orgId) => ctx.storage.listAuditLogs(orgId, 300);
const uid = (u: string) => ctx.seedResult.userIds[u]!;
const hid = (u: string) => ctx.seedResult.hospitalistIds[u]!;
const orgFrames = (type: string, orgId = ctx.seedResult.orgId) =>
  ctx.ws.broadcasts.filter((b) => b.orgId === orgId && (b.message as { type?: string }).type === type);
const userFrames = (type: string) => ctx.ws.delivered.filter((d) => (d.message as { type?: string }).type === type);

async function setModule(id: string, enabled: boolean, orgId = ctx.seedResult.orgId) {
  const dev = await devLogin();
  await dev.patch(`/api/dev/modules/${orgId}`).send({ id, enabled }).expect(200);
  invalidateModules();
}

async function admit(initials: string, opts: { hospitalistId?: number; by?: string } = {}) {
  const er = await as(opts.by ?? "er.doc");
  const p = await er.post("/api/patients").send({ initials, roomNumber: "R" + initials, issueSummary: "synthetic", specialty: "Cardiology" });
  expect(p.status).toBe(201);
  const body = opts.hospitalistId ? { patientId: p.body.id, mode: "manual", hospitalistId: opts.hospitalistId } : { patientId: p.body.id, mode: "round_robin" };
  const a = await er.post("/api/assignments").send(body);
  expect(a.status).toBe(201);
  return { patient: p.body, assignment: a.body };
}

// ── #1 ER diversion ─────────────────────────────────────────────────────────
describe("#1 ER diversion is the org's, declared on the server", () => {
  it("defaults to accepting patients, for everyone in the org", async () => {
    for (const u of ["er.director", "er.doc", "chen", "director"]) {
      const r = await (await as(u)).get("/api/er/diversion").expect(200);
      expect(r.body).toEqual({ active: false, since: null, by: null });
    }
  });

  it("an ER director's declare persists org-wide, is audited, announced and broadcast — no EMS claim", async () => {
    const erDir = await as("er.director");
    const r = await erDir.put("/api/er/diversion").send({ active: true });
    expect(r.status).toBe(200);
    expect(r.body.diversion).toMatchObject({ active: true, by: { id: uid("er.director"), name: "Dr. Evan Marsh" } });
    expect(typeof r.body.diversion.since).toBe("string");
    expect(r.body.broadcast).toMatchObject({ id: expect.any(Number), total: expect.any(Number) });
    expect(r.body.broadcast.total).toBeGreaterThan(0);
    expect(r.body.broadcastSkipped).toBeNull();

    // A second ER director session, and a hospitalist, read the same state.
    expect((await (await as("er.director")).get("/api/er/diversion").expect(200)).body.active).toBe(true);
    expect((await (await as("chen")).get("/api/er/diversion").expect(200)).body.active).toBe(true);

    // The broadcast is a real one: in the list every clinician reads, critical, with no EMS claim.
    const list = (await (await as("chen")).get("/api/broadcasts").expect(200)).body;
    const b = list.find((x: { id: number }) => x.id === r.body.broadcast.id);
    expect(b).toMatchObject({ severity: "critical", ackRequired: true });
    expect(b.message).toMatch(/diversion/i);
    expect(b.message).not.toMatch(/EMS/);

    const rows = (await audit()).filter((a) => a.action === "er.diversion_declare");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: uid("er.director"), riskLevel: "high" });
    expect(orgFrames("DIVERSION_UPDATED")).toHaveLength(1);
    expect(orgFrames("BROADCAST_CREATED")).toHaveLength(1);
  });

  it("lifting it is a second, info broadcast; repeating the current state is refused", async () => {
    const erDir = await as("er.director");
    await erDir.put("/api/er/diversion").send({ active: true }).expect(200);
    const again = await erDir.put("/api/er/diversion").send({ active: true });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: "no_change", diversion: { active: true } });
    const lift = await erDir.put("/api/er/diversion").send({ active: false });
    expect(lift.status).toBe(200);
    expect(lift.body.diversion).toEqual({ active: false, since: null, by: null });
    const list = (await erDir.get("/api/broadcasts").expect(200)).body;
    expect(list[0]).toMatchObject({ severity: "info" });
    expect(list[0].message).toMatch(/lifted/i);
    expect((await audit()).filter((a) => a.action === "er.diversion_lift")).toHaveLength(1);
    expect(orgFrames("DIVERSION_UPDATED")).toHaveLength(2);
  });

  it("only an ER director or director may declare it; the body is validated", async () => {
    for (const u of ["er.doc", "chen"]) {
      await (await as(u)).put("/api/er/diversion").send({ active: true }).expect(403);
    }
    const erDir = await as("er.director");
    for (const body of [{}, { active: "yes" }, { active: true, ems: true }, null]) {
      const r = await erDir.put("/api/er/diversion").send(body as object);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect((await erDir.get("/api/er/diversion").expect(200)).body.active).toBe(false);
    await (await as("director")).put("/api/er/diversion").send({ active: true }).expect(200);
  });

  it("with broadcasts switched off the state still saves and says nobody was broadcast to", async () => {
    await setModule("broadcasts", false);
    const r = await (await as("er.director")).put("/api/er/diversion").send({ active: true }).expect(200);
    expect(r.body.broadcast).toBeNull();
    expect(r.body.broadcastSkipped).toBe("module_disabled");
    expect(orgFrames("BROADCAST_CREATED")).toHaveLength(0);
  });

  it("is per tenant", async () => {
    await ensureDemoTenants(ctx.storage);
    await (await as("er.director")).put("/api/er/diversion").send({ active: true }).expect(200);
    const other = await as("director", "ER");
    expect((await other.get("/api/er/diversion").expect(200)).body.active).toBe(false);
  });
});

// ── #2 ER physicians roster ─────────────────────────────────────────────────
describe("#2 the ER roster is the org's ER physician accounts, with shift state on the server", () => {
  it("lists exactly the org's active ER physicians — no demo names", async () => {
    const r = await (await as("er.director")).get("/api/er/roster").expect(200);
    expect(r.body.physicians).toEqual([
      expect.objectContaining({ userId: uid("er.doc"), displayName: "Dr. Erin Reyes", onShift: false, shiftType: null, admits24h: 1 }),
    ]);
    expect(r.body).toMatchObject({ onShift: 0, admits24h: 1 });
    expect(JSON.stringify(r.body)).not.toMatch(/Osei|Okafor|Iyer/);
  });

  it("on/off shift and the shift persist for everyone, audited and announced", async () => {
    const erDir = await as("er.director");
    const on = await erDir.patch(`/api/er/roster/${uid("er.doc")}`).send({ onShift: true });
    expect(on.status).toBe(200);
    expect(on.body.physician).toMatchObject({ userId: uid("er.doc"), onShift: true });
    await erDir.patch(`/api/er/roster/${uid("er.doc")}`).send({ shiftType: "night" }).expect(200);
    const again = (await (await as("director")).get("/api/er/roster").expect(200)).body;
    expect(again.physicians[0]).toMatchObject({ onShift: true, shiftType: "night" });
    expect(again.onShift).toBe(1);
    const rows = (await audit()).filter((a) => a.action === "er.roster_update");
    expect(rows).toHaveLength(2);
    expect(orgFrames("ER_ROSTER_UPDATED")).toHaveLength(2);
  });

  it("validates the body and refuses anyone who is not an ER physician of this org", async () => {
    const erDir = await as("er.director");
    for (const body of [{}, { onShift: "yes" }, { shiftType: "evening" }, { onShift: true, name: "Sweep" }]) {
      expect((await erDir.patch(`/api/er/roster/${uid("er.doc")}`).send(body)).status, JSON.stringify(body)).toBe(400);
    }
    await erDir.patch(`/api/er/roster/${uid("chen")}`).send({ onShift: true }).expect(404);
    await erDir.patch(`/api/er/roster/999999`).send({ onShift: true }).expect(404);
    await ensureDemoTenants(ctx.storage);
    const foreign = await ctx.storage.getUserByUsername((await ctx.storage.getOrganizationByCode("ER"))!.id, "er.doc1");
    await erDir.patch(`/api/er/roster/${foreign!.id}`).send({ onShift: true }).expect(404);
  });

  it("only an ER director or director may read or change it", async () => {
    for (const u of ["er.doc", "chen"]) {
      const a = await as(u);
      await a.get("/api/er/roster").expect(403);
      await a.patch(`/api/er/roster/${uid("er.doc")}`).send({ onShift: true }).expect(403);
    }
  });

  it("counts each physician's admissions in the last 24 h and drops deactivated accounts", async () => {
    await admit("AA");
    await admit("BB");
    const r = (await (await as("er.director")).get("/api/er/roster").expect(200)).body;
    expect(r.physicians[0].admits24h).toBe(3);
    expect(r.admits24h).toBe(3);
    await (await as("director")).post(`/api/accounts/${uid("er.doc")}/deactivate`).expect(200);
    expect((await (await as("er.director")).get("/api/er/roster").expect(200)).body.physicians).toEqual([]);
  });
});

// ── #3 ER throughput ────────────────────────────────────────────────────────
describe("#3 ER throughput is computed by the server", () => {
  it("nothing accepted yet → no time-to-accept (never a constant)", async () => {
    const r = (await (await as("er.director")).get("/api/reports/er").expect(200)).body;
    expect(r.scope).toBe("org");
    expect(r.assignments.timeToAcceptMinAvg).toBeNull();
    expect(r.assignments.timeToAcceptMinMedian).toBeNull();
    expect(r.admits24h).toBe(1);
  });

  it("the ER director sees the org, the ER doctor only what they routed", async () => {
    const { assignment } = await admit("CC", { hospitalistId: hid("patel") });
    await (await as("patel")).patch(`/api/assignments/${assignment.id}/accept`).expect(200);
    const org = (await (await as("er.director")).get("/api/reports/er").expect(200)).body;
    expect(org.assignments.accepted).toBe(1);
    expect(typeof org.assignments.timeToAcceptMinAvg).toBe("number");
    const mine = (await (await as("er.doc")).get("/api/reports/er").expect(200)).body;
    expect(mine.scope).toBe("mine");
    expect(mine.assignments.accepted).toBe(1);
    // A patient the ER director routed is the org's, not er.doc's.
    await admit("DD", { by: "er.director" });
    expect((await (await as("er.doc")).get("/api/reports/er").expect(200)).body.admits24h).toBe(2);
    expect((await (await as("er.director")).get("/api/reports/er").expect(200)).body.admits24h).toBe(3);
  });

  it("hospitalists cannot read it; it follows the analytics module", async () => {
    await (await as("chen")).get("/api/reports/er").expect(403);
    await setModule("ops.analytics", false);
    const r = await (await as("er.doc")).get("/api/reports/er");
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("module_disabled");
  });
});

// ── #11 provider profile ────────────────────────────────────────────────────
describe("#11 a provider's name and specialty are server records", () => {
  it("a director's rename and specialty change persist, are audited and re-route", async () => {
    const director = await as("director");
    const r = await director.patch(`/api/hospitalists/${hid("chen")}/profile`).send({ displayName: "  Dr. Nathan Alyesh Renamed ", specialty: "Cardiology" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ hospitalist: { id: hid("chen"), specialty: "Cardiology" }, user: { id: uid("chen"), displayName: "Dr. Nathan Alyesh Renamed" } });
    const dir = (await (await as("er.doc")).get("/api/physicians/directory").expect(200)).body;
    expect(dir.find((d: { userId: number }) => d.userId === uid("chen"))).toMatchObject({ displayName: "Dr. Nathan Alyesh Renamed", specialty: "Cardiology" });
    const rows = (await audit()).filter((a) => a.action === "hospitalist.profile_update");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.details).toMatchObject({ changed: ["displayName", "specialty"] });
    expect(orgFrames("ROTATION_UPDATED").length).toBeGreaterThan(0);
  });

  it("validates, refuses non-directors and other tenants' providers", async () => {
    const director = await as("director");
    for (const body of [{}, { displayName: "" }, { displayName: "x".repeat(121) }, { specialty: "Card\u0007" }, { displayName: "Ok", role: "director" }]) {
      expect((await director.patch(`/api/hospitalists/${hid("chen")}/profile`).send(body)).status, JSON.stringify(body)).toBe(400);
    }
    for (const u of ["chen", "er.director", "er.doc"]) {
      await (await as(u)).patch(`/api/hospitalists/${hid("chen")}/profile`).send({ specialty: "GI" }).expect(403);
    }
    await ensureDemoTenants(ctx.storage);
    const other = await as("director", "HOSP");
    await other.patch(`/api/hospitalists/${hid("chen")}/profile`).send({ specialty: "GI" }).expect(404);
  });

  it("removing a provider with a pending request is refused with the reason", async () => {
    await admit("EE", { hospitalistId: hid("liu") });
    const r = await (await as("director")).delete(`/api/physicians/${hid("liu")}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("has_pending_assignments");
    expect((await (await as("director")).get("/api/hospitalists").expect(200)).body.some((h: { id: number }) => h.id === hid("liu"))).toBe(true);
  });
});

// ── #13-#15 patient board edits ─────────────────────────────────────────────
describe("#13 room and issue edits are a server PATCH", () => {
  it("a director's edit persists for everyone, is audited without PHI values, and refreshes boards", async () => {
    const sc = ctx.seedResult.patientIds.sc!;
    const director = await as("director");
    const r = await director.patch(`/api/patients/${sc}`).send({ roomNumber: " 999X ", issueSummary: "Chest pain — reassessed" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: sc, roomNumber: "999X", issueSummary: "Chest pain — reassessed" });
    const board = (await (await as("er.doc")).get("/api/patient-board").expect(200)).body;
    expect(board.find((x: { patient: { id: number } }) => x.patient.id === sc).patient).toMatchObject({ room: "999X", issue: "Chest pain — reassessed" });
    const rows = (await audit()).filter((a) => a.action === "patient.update");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.details).toEqual({ fields: ["roomNumber", "issueSummary"] });
    expect(JSON.stringify(rows[0]!.details)).not.toMatch(/999X|reassessed/);
    expect(orgFrames("ASSIGNMENT_UPDATED").length).toBeGreaterThan(0);
    // The ER director may edit too.
    await (await as("er.director")).patch(`/api/patients/${sc}`).send({ roomNumber: "778" }).expect(200);
  });

  it("validates the body (no status), the role and the tenant", async () => {
    const sc = ctx.seedResult.patientIds.sc!;
    const director = await as("director");
    for (const body of [{}, { status: "admitted" }, { roomNumber: "x".repeat(41) }, { issueSummary: "" }, { issueSummary: "bad\u0000" }, { roomNumber: 5 }]) {
      expect((await director.patch(`/api/patients/${sc}`).send(body)).status, JSON.stringify(body)).toBe(400);
    }
    for (const u of ["chen", "er.doc"]) await (await as(u)).patch(`/api/patients/${sc}`).send({ roomNumber: "1" }).expect(403);
    await ensureDemoTenants(ctx.storage);
    await (await as("director", "HOSP")).patch(`/api/patients/${sc}`).send({ roomNumber: "1" }).expect(404);
    expect((await ctx.storage.getPatient(ctx.seedResult.orgId, sc))!.roomNumber).toBe("204");
  });
});

describe("#14 a director's manual admission is a real patient + assignment", () => {
  it("director creates the patient and routes it; it is on every board", async () => {
    const director = await as("director");
    const p = await director.post("/api/patients").send({ initials: "ZZ", roomNumber: "555", issueSummary: "Sweep manual admission", department: "MED" });
    expect(p.status).toBe(201);
    const a = await director.post("/api/assignments").send({ patientId: p.body.id, mode: "manual", hospitalistId: hid("patel") });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ status: "pending", hospitalistId: hid("patel") });
    const board = (await (await as("er.doc")).get("/api/patient-board").expect(200)).body;
    expect(board.some((x: { patient: { initials: string } }) => x.patient.initials === "ZZ")).toBe(true);
    // A hospitalist still cannot create patients.
    await (await as("chen")).post("/api/patients").send({ initials: "QQ", issueSummary: "x" }).expect(403);
  });
});

describe("#15 removing an admission is one audited server transaction", () => {
  it("deletes the patient and everything linked, decrements an accepted census, audits it", async () => {
    const { patient, assignment } = await admit("RQ", { hospitalistId: hid("patel") });
    await (await as("patel")).patch(`/api/assignments/${assignment.id}/accept`).expect(200);
    const before = (await ctx.storage.getHospitalist(ctx.seedResult.orgId, hid("patel")))!.currentPatientCount;
    await (await as("chen")).post(`/api/patients/${patient.id}/consults`).send({ specialty: "GI" }).expect(201);
    const director = await as("director");
    const r = await director.delete(`/api/patients/${patient.id}`);
    expect(r.status).toBe(200);
    expect(r.body.removed).toMatchObject({ patients: 1, assignments: 1 });
    expect(await ctx.storage.getPatient(ctx.seedResult.orgId, patient.id)).toBeUndefined();
    expect((await ctx.storage.listConsultsForPatient(ctx.seedResult.orgId, patient.id))).toEqual([]);
    expect((await ctx.storage.getHospitalist(ctx.seedResult.orgId, hid("patel")))!.currentPatientCount).toBe(before - 1);
    // Other hospitalists' (manually set) census is untouched.
    expect((await ctx.storage.getHospitalist(ctx.seedResult.orgId, hid("lopez")))!.currentPatientCount).toBe(7);
    const rows = (await audit()).filter((a) => a.action === "patient.delete");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ resourceId: patient.id, riskLevel: "high" });
    const phi = await ctx.storage.listPhiAccess(ctx.seedResult.orgId, 50);
    expect(phi.some((x) => x.patientId === patient.id && x.method === "DELETE")).toBe(true);
    await director.delete(`/api/patients/${patient.id}`).expect(404);
  });

  it("refuses other roles and other tenants", async () => {
    const sc = ctx.seedResult.patientIds.sc!;
    for (const u of ["chen", "er.doc"]) await (await as(u)).delete(`/api/patients/${sc}`).expect(403);
    await ensureDemoTenants(ctx.storage);
    await (await as("director", "HOSP")).delete(`/api/patients/${sc}`).expect(404);
    expect(await ctx.storage.getPatient(ctx.seedResult.orgId, sc)).toBeDefined();
  });
});

// ── #17/#18 intake extraction ───────────────────────────────────────────────
describe("#17/#18 the intake extractor is the server's and never invents a patient", () => {
  it("says which engine ran; nothing found → empty initials, not XX", async () => {
    const er = await as("er.doc");
    const r = await er.post("/api/patients/extract").send({ note: "Patient J.K. room 612 with crushing chest pain" }).expect(200);
    expect(r.body).toMatchObject({ initials: "JK", roomNumber: "612", specialty: "Cardiology", engine: "local" });
    const none = await er.post("/api/patients/extract").send({ note: "needs a bed soon" }).expect(200);
    expect(none.body.initials).toBe("");
    await er.post("/api/patients/extract").send({ note: "" }).expect(400);
  });
});

// ── #19/#20/#23 consults ────────────────────────────────────────────────────
describe("#23 a consult request alerts the consultants who have accounts", () => {
  it("named consultants with accounts get a socket frame and a content-free push; audited", async () => {
    const sc = ctx.seedResult.patientIds.sc!;
    const er = await as("er.doc");
    const r = await er.post(`/api/patients/${sc}/consults`).send({ specialty: "Pulmonology", consultants: [{ name: "Jordan Wu, PA-C", userId: uid("wu") }, { name: "Dr. Named Only" }] });
    expect(r.status).toBe(201);
    expect(r.body.map((c: { consultantUserId: number | null }) => c.consultantUserId).sort()).toEqual([null, uid("wu")].sort());
    const frames = userFrames("CONSULT_REQUESTED");
    expect(frames).toHaveLength(1);
    expect(frames[0]!.userIds).toEqual([uid("wu")]);
    expect(JSON.stringify(frames[0]!.message)).not.toMatch(/Pulmonology|SC|204/);
    expect(ctx.push.sent).toEqual(expect.arrayContaining([{ userId: uid("wu"), title: "New consult request" }]));
    const rows = (await audit()).filter((a) => a.action === "consult.request");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ resourceType: "patient", resourceId: sc });
    expect(rows[0]!.details).toEqual({ created: 2, alerted: 1 });
  });

  it("a specialty nobody covers is recorded but alerts nobody", async () => {
    const sc = ctx.seedResult.patientIds.sc!;
    const r = await (await as("chen")).post(`/api/patients/${sc}/consults`).send({ specialty: "Toxicology" }).expect(201);
    expect(r.body).toEqual([expect.objectContaining({ consultantUserId: null, consultantName: "Toxicology on-call" })]);
    expect(userFrames("CONSULT_REQUESTED")).toHaveLength(0);
    expect(ctx.push.sent.filter((p) => p.title === "New consult request")).toHaveLength(0);
  });

  it("refuses a consultant who is not in this org (or deactivated)", async () => {
    await ensureDemoTenants(ctx.storage);
    const foreign = await ctx.storage.getUserByUsername((await ctx.storage.getOrganizationByCode("ER"))!.id, "er.doc1");
    const sc = ctx.seedResult.patientIds.sc!;
    const er = await as("er.doc");
    const r = await er.post(`/api/patients/${sc}/consults`).send({ specialty: "GI", consultants: [{ name: "Spy", userId: foreign!.id }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("unknown_consultant");
    const r2 = await er.post(`/api/patients/${sc}/consults`).send({ specialty: "GI", consultantUserId: foreign!.id });
    expect(r2.status).toBe(400);
    await (await as("director")).post(`/api/accounts/${uid("wu")}/deactivate`).expect(200);
    expect((await er.post(`/api/patients/${sc}/consults`).send({ specialty: "GI", consultants: [{ name: "Wu", userId: uid("wu") }] })).status).toBe(400);
    expect((await ctx.storage.listConsultsForPatient(ctx.seedResult.orgId, sc)).some((c) => c.specialty === "GI")).toBe(false);
  });
});

// ── #4 care team ────────────────────────────────────────────────────────────
describe("#4 care-team links are the server's", () => {
  it("lists real members, links/unlinks/toggles with audit rows, refuses deactivated people", async () => {
    const chen = await as("chen");
    const team = (await chen.get("/api/care-team").expect(200)).body;
    expect(team.members).toEqual([expect.objectContaining({ userId: uid("wu"), displayName: "Jordan Wu, PA-C", credential: "PA", onCall: true })]);
    await chen.patch(`/api/care-team/members/${uid("wu")}`).send({ onCall: false }).expect(200);
    expect((await chen.get("/api/care-team").expect(200)).body.members[0].onCall).toBe(false);
    await chen.post("/api/care-team/members").send({ memberUserId: uid("patel") }).expect(201);
    await chen.delete(`/api/care-team/members/${uid("patel")}`).expect(204);
    const actions = (await audit()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["care_team.on_call", "care_team.link", "care_team.unlink"]));

    await (await as("director")).post(`/api/accounts/${uid("liu")}/deactivate`).expect(200);
    const cands = (await chen.get("/api/care-team/candidates").expect(200)).body;
    expect(cands.find((c: { userId: number }) => c.userId === uid("liu"))).toMatchObject({ active: false });
    expect(cands.find((c: { userId: number }) => c.userId === uid("patel"))).toMatchObject({ active: true });
    const r = await chen.post("/api/care-team/members").send({ memberUserId: uid("liu") });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("user_deactivated");
  });
});
