import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateModules, setModule } from "../server/modules.js";
import { SYNC_SETTING_KEY, runScheduledAmionSyncAll } from "../server/services/amion.js";
import { runAutoClean } from "../server/services/expiry.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * The last fake claims the final verification found (server side):
 *
 *   schedule #1  The dashboard says Manual list → "no feed updates it" and
 *                board off → "no schedule source is read". The scheduled
 *                Amion pull must then leave the rotation alone: it runs only
 *                for an org whose board is on AND whose selected source is
 *                Amion. A sync-now with another source selected refreshes
 *                the snapshot but changes nobody's shift (rotationApplied).
 *   schedule #6  "Admissions since last reset" survives the auto-clean
 *                sweep: every first routing is kept in a PHI-free ledger
 *                (admission_events) that purges never touch.
 *   clinical #1  The diversion state records whether a broadcast went out
 *                (alert), so the banner can say what happened.
 *   clinical #4  A care-team member marked On call sees the owner's pending
 *                requests (GET /api/assignments/pending), can accept them,
 *                and then sees the patient (GET /api/assignments/my). Only
 *                accounts that can accept may be linked.
 */

const FIXTURE_HTML = readFileSync(new URL("./fixtures/amion-ocs.html", import.meta.url), "utf8");
function serveFixture(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(FIXTURE_HTML);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/ocs?Lo=test-fixture` });
    });
  });
}

let ctx: TestContext;
const ENV_KEYS = ["AMION_OCS_URL", "AMION_ORG_CODE", "AMION_SYNC_INTERVAL_MIN"] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeEach(async () => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  ctx = await createTestApp();
  invalidateModules();
});
afterEach(async () => {
  invalidateModules();
  await ctx.handle.close();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const as = async (username: string, orgCode = "ISPN") => (await login(ctx.app, { username, orgCode })).agent;
const uid = (u: string) => ctx.seedResult.userIds[u]!;
const audit = (orgId = ctx.seedResult.orgId) => ctx.storage.listAuditLogs(orgId, 500);
async function module(id: string, enabled: boolean) {
  await setModule(ctx.seedResult.orgId, id, enabled);
  invalidateModules();
}

// ── schedule #1 ─────────────────────────────────────────────────────────────
describe("schedule #1: the scheduled Amion pull follows the selected source and the on-call board", () => {
  let fixture: { server: Server; url: string };
  beforeEach(async () => {
    fixture = await serveFixture();
    process.env.AMION_OCS_URL = fixture.url;
    process.env.AMION_ORG_CODE = "ISPN";
    process.env.AMION_SYNC_INTERVAL_MIN = "1";
  });
  afterEach(() => { fixture.server.close(); });

  it("Manual list selected → the pull is skipped and a director's Off stays off; board off → skipped too", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenH = ctx.seedResult.hospitalistIds.chen!;
    const amionSyncs = async () => (await audit()).filter((a) => a.action === "amion.sync").length;

    // Default (no explicit choice, feed connected): Amion drives the rotation.
    expect(await runScheduledAmionSyncAll(ctx.storage)).toEqual([{ orgId, outcome: "synced" }]);
    expect((await ctx.storage.getHospitalist(orgId, chenH))!.working).toBe(true);

    const director = await as("director");
    await director.patch("/api/oncall/source").send({ source: "manual" }).expect(200);
    await director.patch(`/api/hospitalists/${chenH}/working-status`).send({ working: false }).expect(200);
    const snapshot = await ctx.storage.getOrgSetting(orgId, SYNC_SETTING_KEY);
    const before = await amionSyncs();

    expect(await runScheduledAmionSyncAll(ctx.storage)).toEqual([{ orgId, outcome: "skipped_not_selected" }]);
    expect((await ctx.storage.getHospitalist(orgId, chenH))!.working).toBe(false);
    expect(await ctx.storage.getOrgSetting(orgId, SYNC_SETTING_KEY)).toEqual(snapshot); // not even pulled
    expect(await amionSyncs()).toBe(before);

    // A director's explicit Sync now refreshes the snapshot, but with Manual
    // selected it changes nobody's shift — and says so.
    const now = await director.post("/api/amion/sync-now").expect(200);
    expect(now.body.lastStatus).toBe("ok");
    expect(now.body.rotationApplied).toBe(false);
    expect((await ctx.storage.getHospitalist(orgId, chenH))!.working).toBe(false);

    // Amion selected again, but the on-call board switched off → still skipped.
    await director.patch("/api/oncall/source").send({ source: "amion" }).expect(200);
    await module("oncall.board", false);
    expect(await runScheduledAmionSyncAll(ctx.storage)).toEqual([{ orgId, outcome: "skipped_board_off" }]);
    expect((await ctx.storage.getHospitalist(orgId, chenH))!.working).toBe(false);
    const off = await director.post("/api/amion/sync-now").expect(200);
    expect(off.body.rotationApplied).toBe(false);
    expect((await ctx.storage.getHospitalist(orgId, chenH))!.working).toBe(false);

    // Board back on with Amion selected → the pull applies again.
    await module("oncall.board", true);
    expect(await runScheduledAmionSyncAll(ctx.storage)).toEqual([{ orgId, outcome: "synced" }]);
    expect((await ctx.storage.getHospitalist(orgId, chenH))!.working).toBe(true);
    const applied = await director.post("/api/amion/sync-now").expect(200);
    expect(applied.body.rotationApplied).toBe(true);
  });

  it("the Amion integration card says the pull is paused while another source is selected", async () => {
    const director = await as("director");
    await director.patch("/api/oncall/source").send({ source: "manual" }).expect(200);
    const cards = (await director.get("/api/integrations").expect(200)).body;
    const amion = (cards.integrations as any[]).find((c) => c.id === "amion");
    expect(amion.statusText).not.toMatch(/keeps the rotation roster's shifts current/);
    expect(amion.statusText).toMatch(/not pulled/i);
    expect(amion.statusText).toMatch(/manual list/i);
  });
});

// ── schedule #6 ─────────────────────────────────────────────────────────────
async function admit(initials: string, hospitalistKey?: string) {
  const er = await as("er.doc");
  const p = await er.post("/api/patients").send({ initials, roomNumber: "B" + initials, issueSummary: "synthetic", specialty: "Cardiology" }).expect(201);
  const body = hospitalistKey
    ? { patientId: p.body.id, mode: "manual", hospitalistId: ctx.seedResult.hospitalistIds[hospitalistKey] }
    : { patientId: p.body.id, mode: "round_robin" };
  const a = await er.post("/api/assignments").send(body).expect(201);
  return { patient: p.body, assignment: a.body };
}
const HOUR = 3_600_000;
async function backdate(patientId: number, assignmentId: number, at: Date) {
  const orgId = ctx.seedResult.orgId;
  await ctx.storage.updatePatient(orgId, patientId, { createdAt: at } as any);
  await ctx.storage.updateAssignment(orgId, assignmentId, { createdAt: at } as any);
  await ctx.handle.db.execute(sql`UPDATE admission_events SET first_routed_at = ${at} WHERE patient_id = ${patientId}`);
}

describe("schedule #6: the admissions counter survives the auto-clean sweep", () => {
  it("reset 48 h ago, OA admitted 30 h ago, NB now: the sweep removes OA from the log but not from the count", async () => {
    const orgId = ctx.seedResult.orgId;
    const director = await as("director");
    await ctx.storage.setOrgSetting(orgId, "admissionsCounterReset", { at: new Date(Date.now() - 48 * HOUR).toISOString(), by: uid("director") }, uid("director"));
    // The seeded SC admission predates the reset (and is purged by the sweep too).
    const sc = ctx.seedResult.patientIds.sc!;
    const scA = (await ctx.storage.listAssignments(orgId)).find((a) => a.patientId === sc)!;
    await backdate(sc, scA.id, new Date(Date.now() - 72 * HOUR));
    const oa = await admit("OA");
    await backdate(oa.patient.id, oa.assignment.id, new Date(Date.now() - 30 * HOUR));
    await admit("NB");

    const pre = (await director.get("/api/admissions").expect(200)).body;
    expect(pre.sinceReset).toBe(2);
    expect(pre.rows.map((r: any) => r.initials)).toEqual(["NB", "OA", "SC"]);

    await runAutoClean();
    expect(await ctx.storage.getPatient(orgId, oa.patient.id)).toBeFalsy();

    const post = (await director.get("/api/admissions").expect(200)).body;
    expect(post.rows.map((r: any) => r.initials)).toEqual(["NB"]); // the log lists what is on record
    expect(post.total).toBe(1);
    expect(post.sinceReset).toBe(2); // the count does not drop
    expect(post.sinceResetRemoved).toBe(1); // …and says how many are no longer on record
    expect(post.last24h).toBe(1);
    expect(post.autoCleanHours).toBe(24);
    // No PHI in the ledger: ids, times and the route only.
    const cols = await ctx.handle.db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'admission_events'`);
    const names = ((cols as any).rows ?? cols).map((r: any) => r.column_name).sort();
    expect(names).toEqual(["created_at", "first_routed_at", "id", "organization_id", "patient_id", "via"]);
  });

  it("Clear all, Remove admission and a re-route never change the count; a reset does", async () => {
    const orgId = ctx.seedResult.orgId;
    const director = await as("director");
    await director.post("/api/admissions/reset").expect(200);
    const a = await admit("CA", "patel");
    const b = await admit("CB", "patel");
    // A re-route is the same admission.
    await (await as("patel")).patch(`/api/assignments/${a.assignment.id}/reject`).expect(200);
    expect((await director.get("/api/admissions").expect(200)).body.sinceReset).toBe(2);
    await director.delete(`/api/patients/${b.patient.id}`).expect(200);
    await director.post("/api/maintenance/purge").send({ olderThanHours: 0 }).expect(200);
    const after = (await director.get("/api/admissions").expect(200)).body;
    expect(after.total).toBe(0);
    expect(after.sinceReset).toBe(2);
    expect(after.sinceResetRemoved).toBe(2);
    const reset = (await director.post("/api/admissions/reset").expect(200)).body;
    expect(reset.sinceReset).toBe(0);
    const last = (await audit()).find((r) => r.action === "admissions.counter_reset")!;
    expect(last.details).toMatchObject({ countBefore: 2 });
    await admit("CC");
    expect((await director.get("/api/admissions").expect(200)).body.sinceReset).toBe(1);
    // A tenant with ledger rows still deletes cleanly.
    expect((await ctx.storage.listAuditLogs(orgId)).length).toBeGreaterThan(0);
  });

  it("a tenant with admissions in its ledger is deleted in full", async () => {
    const dev = await as("dev", "DOCTURN");
    const org = (await dev.post("/api/dev/organizations").send({ name: "Ledger General", code: "LEDGR", timezone: "America/Chicago" }).expect(201)).body;
    const orgId = org.id;
    const u = await ctx.storage.createUser({ organizationId: orgId, username: "h1", passwordHash: "x", role: "hospitalist", displayName: "H One", credential: "MD", phone: null, twoFactorEnabled: false, mustChangePassword: false } as any);
    const hosp = await ctx.storage.createHospitalist({ organizationId: orgId, userId: u.id, specialty: "Hospital Medicine", currentPatientCount: 0, patientCap: 12, rotationOrder: 0, working: true, shiftType: "day" } as any);
    const p = await ctx.storage.createPatient({ organizationId: orgId, initials: "LG", roomNumber: "1", issueSummary: "x", specialty: "Cardiology", department: "Emergency", acuity: 3, status: "waiting", erDoctorId: null, assignedHospitalistId: null } as any);
    await ctx.storage.createAssignment({ organizationId: orgId, patientId: p.id, hospitalistId: hosp.id, erDoctorId: null, status: "pending", via: "manual", acceptedByUserId: null, expiresAt: new Date(Date.now() + 60_000) });
    await dev.delete(`/api/dev/organizations/${orgId}?force=true`).expect(204);
    const left = await ctx.handle.db.execute(sql`SELECT count(*)::int AS n FROM admission_events WHERE organization_id = ${orgId}`);
    expect(((left as any).rows ?? left)[0].n).toBe(0);
  });
});

// ── clinical #1 ─────────────────────────────────────────────────────────────
describe("clinical #1: the diversion state records whether anyone was alerted", () => {
  it("broadcasts off → alert {sent:false, reason:module_disabled}; on → {sent:true, recipients}; read by everyone", async () => {
    await module("broadcasts", false);
    const erd = await as("er.director");
    const d1 = await erd.put("/api/er/diversion").send({ active: true }).expect(200);
    expect(d1.body.broadcastSkipped).toBe("module_disabled");
    expect(d1.body.diversion.alert).toEqual({ sent: false, reason: "module_disabled", recipients: 0, broadcastId: null });
    const seen = (await (await as("chen")).get("/api/er/diversion").expect(200)).body;
    expect(seen.alert).toEqual({ sent: false, reason: "module_disabled", recipients: 0, broadcastId: null });

    await erd.put("/api/er/diversion").send({ active: false }).expect(200);
    await module("broadcasts", true);
    const d2 = await erd.put("/api/er/diversion").send({ active: true }).expect(200);
    expect(d2.body.broadcast.total).toBeGreaterThan(0);
    expect(d2.body.diversion.alert).toEqual({ sent: true, reason: null, recipients: d2.body.broadcast.total, broadcastId: d2.body.broadcast.id });
    const again = (await (await as("director")).get("/api/er/diversion").expect(200)).body;
    expect(again.alert).toEqual(d2.body.diversion.alert);
  });

  it("a state saved before alerts were recorded reads alert:null (unknown), never 'sent'", async () => {
    await ctx.storage.setOrgSetting(ctx.seedResult.orgId, "erDiversion", { active: true, since: new Date().toISOString(), by: { id: uid("er.director"), name: "X" } }, uid("er.director"));
    const d = (await (await as("chen")).get("/api/er/diversion").expect(200)).body;
    expect(d.active).toBe(true);
    expect(d.alert).toBeNull();
  });
});

// ── clinical #4 ─────────────────────────────────────────────────────────────
describe("clinical #4: an on-call care-team member sees and accepts the owner's requests", () => {
  it("Wu (on Chen's unit, no rotation profile) gets Chen's pending request, accepts it, and then has the patient", async () => {
    const { patient, assignment } = await admit("UV", "chen");
    const wu = await as("wu");
    const pending = (await wu.get("/api/assignments/pending").expect(200)).body;
    const row = pending.find((x: any) => x.id === assignment.id);
    expect(row).toMatchObject({ id: assignment.id, patientId: patient.id, status: "pending", onBehalfOf: { userId: uid("chen"), displayName: "Dr. Nathan Alyesh" } });
    // Chen's own view marks it as his own (no onBehalfOf).
    const chenPending = (await (await as("chen")).get("/api/assignments/pending").expect(200)).body;
    expect(chenPending.find((x: any) => x.id === assignment.id).onBehalfOf).toBeNull();

    await wu.patch(`/api/assignments/${assignment.id}/accept`).expect(200);
    const mine = (await wu.get("/api/assignments/my").expect(200)).body;
    expect(mine.find((x: any) => x.id === assignment.id)).toMatchObject({ status: "accepted", acceptedByUserId: uid("wu"), onBehalfOf: { userId: uid("chen") } });
    // The patient is on Chen's census (the unit's owner).
    const chenMine = (await (await as("chen")).get("/api/assignments/my").expect(200)).body;
    expect(chenMine.some((x: any) => x.id === assignment.id)).toBe(true);
    expect((await wu.get("/api/assignments/pending").expect(200)).body.some((x: any) => x.id === assignment.id)).toBe(false);
  });

  it("Off call → the member no longer sees or may accept the owner's requests", async () => {
    await (await as("chen")).patch(`/api/care-team/members/${uid("wu")}`).send({ onCall: false }).expect(200);
    const { assignment } = await admit("WX", "chen");
    const wu = await as("wu");
    expect((await wu.get("/api/assignments/pending").expect(200)).body.some((x: any) => x.id === assignment.id)).toBe(false);
    await wu.patch(`/api/assignments/${assignment.id}/accept`).expect(403);
  });

  it("only accounts that can accept a request may be linked; candidates say who can", async () => {
    const chen = await as("chen");
    const cands = (await chen.get("/api/care-team/candidates").expect(200)).body;
    expect(cands.find((c: any) => c.userId === uid("er.doc"))).toMatchObject({ canJoinUnit: false });
    expect(cands.find((c: any) => c.userId === uid("patel"))).toMatchObject({ canJoinUnit: true });
    expect(cands.find((c: any) => c.userId === uid("director"))).toMatchObject({ canJoinUnit: true });
    const r = await chen.post("/api/care-team/members").send({ memberUserId: uid("er.doc") });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("member_cannot_accept");
  });

  it("a member whose role can't accept (linked before the rule) is listed as such, and gets nothing to accept", async () => {
    const orgId = ctx.seedResult.orgId;
    await ctx.storage.addCareTeamMember({ organizationId: orgId, ownerUserId: uid("chen"), memberUserId: uid("er.doc"), onCall: true });
    const team = (await (await as("chen")).get("/api/care-team").expect(200)).body.members;
    expect(team.find((m: any) => m.userId === uid("er.doc"))).toMatchObject({ onCall: true, canAccept: false });
    expect(team.find((m: any) => m.userId === uid("wu"))).toMatchObject({ onCall: true, canAccept: true });
    const { assignment } = await admit("YZ", "chen");
    const er = await as("er.doc");
    await er.get("/api/assignments/pending").expect(403);
    await er.patch(`/api/assignments/${assignment.id}/accept`).expect(403);
  });
});
