import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateModules } from "../server/modules.js";
import { ensureDemoTenants } from "../server/seed.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * The director's schedule screens, server side (A.CON schedule #1-#7). Every
 * control on the Director dashboard's schedule / shift / admissions panels must
 * claim only what these routes persist and enforce:
 *
 *   - Shift names and hours (#4, #5) are the ORG's: org setting
 *     "shiftDefinitions", read by everyone in the org (GET /api/org/config,
 *     GET /api/org/shifts), written by a director or developer only
 *     (PATCH /api/org/shifts/:id), validated, audited, announced over the
 *     socket (SHIFTS_UPDATED). An org that never set them has the plain
 *     Day / Swing / Night names and NO hours — never demo hours.
 *   - The admissions log and its tiles (#7) are built from the org's real
 *     assignments (GET /api/admissions): one row per patient routed to a
 *     hospitalist, newest first, with the server's counts. PHI read → one
 *     phi-access row per request.
 *   - "Reset count" (#6) is an org-wide counter reset the server stores and
 *     audits (POST /api/admissions/reset); the log keeps every row.
 *   - The schedule source (#1-#3) is GET /api/oncall/sources; a fresh org
 *     reads "manual" with nothing synced — what the dashboard must show.
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
const audit = (orgId = ctx.seedResult.orgId) => ctx.storage.listAuditLogs(orgId, 200);

async function setModule(id: string, enabled: boolean, orgId = ctx.seedResult.orgId) {
  const dev = await devLogin();
  await dev.patch(`/api/dev/modules/${orgId}`).send({ id, enabled }).expect(200);
  invalidateModules();
}

/** ER physician admits a patient and routes it (round-robin unless a hospitalist id is given). */
async function admit(initials: string, opts: { hospitalistId?: number; room?: string } = {}) {
  const er = await as("er.doc");
  const p = await er.post("/api/patients").send({ initials, roomNumber: opts.room ?? "B" + initials, issueSummary: "synthetic", specialty: "Cardiology" });
  expect(p.status).toBe(201);
  const body = opts.hospitalistId ? { patientId: p.body.id, mode: "manual", hospitalistId: opts.hospitalistId } : { patientId: p.body.id, mode: "round_robin" };
  const a = await er.post("/api/assignments").send(body);
  expect(a.status).toBe(201);
  return { patient: p.body, assignment: a.body };
}

// ── Shift names and hours (#4, #5) ────────────────────────────────────────
describe("shift definitions are the org's, stored on the server", () => {
  it("an org that never set them has Day / Swing / Night and no hours — no demo hours", async () => {
    const director = await as("director");
    const cfg = (await director.get("/api/org/config").expect(200)).body;
    expect(cfg.shifts).toEqual([
      { id: "day", label: "Day", start: null, end: null },
      { id: "swing", label: "Swing", start: null, end: null },
      { id: "night", label: "Night", start: null, end: null },
    ]);
    const chen = await as("chen");
    expect((await chen.get("/api/org/shifts").expect(200)).body.shifts).toEqual(cfg.shifts);
  });

  it("a director's rename and hours persist for everyone in the org, with an audit row and a socket event", async () => {
    const director = await as("director");
    const r1 = await director.patch("/api/org/shifts/day").send({ label: "  Day Team SWEEP  " });
    expect(r1.status).toBe(200);
    expect(r1.body.shifts[0]).toEqual({ id: "day", label: "Day Team SWEEP", start: null, end: null });
    const r2 = await director.patch("/api/org/shifts/day").send({ start: "06:30", end: "18:30" });
    expect(r2.status).toBe(200);
    expect(r2.body.shifts[0]).toEqual({ id: "day", label: "Day Team SWEEP", start: "06:30", end: "18:30" });

    // A second director session and a hospitalist both read the same.
    const again = await as("director");
    expect((await again.get("/api/org/config").expect(200)).body.shifts[0]).toEqual({ id: "day", label: "Day Team SWEEP", start: "06:30", end: "18:30" });
    const chen = await as("chen");
    expect((await chen.get("/api/org/shifts").expect(200)).body.shifts[0].label).toBe("Day Team SWEEP");
    // Untouched shifts keep the defaults.
    expect(r2.body.shifts[1]).toEqual({ id: "swing", label: "Swing", start: null, end: null });

    const rows = (await audit()).filter((a) => a.action === "org.shift_update");
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.details)).toEqual(expect.arrayContaining([
      expect.objectContaining({ shift: "day", changed: { label: "Day Team SWEEP" } }),
      expect.objectContaining({ shift: "day", changed: { start: "06:30", end: "18:30" } }),
    ]));
    expect(ctx.ws.broadcasts.filter((b) => b.orgId === ctx.seedResult.orgId && (b.message as any).type === "SHIFTS_UPDATED").length).toBe(2);
  });

  it("hours can be cleared (null) and a rename back keeps the hours", async () => {
    const director = await as("director");
    await director.patch("/api/org/shifts/night").send({ start: "19:00", end: "07:00" }).expect(200);
    const cleared = await director.patch("/api/org/shifts/night").send({ start: null }).expect(200);
    expect(cleared.body.shifts[2]).toEqual({ id: "night", label: "Night", start: null, end: "07:00" });
    const renamed = await director.patch("/api/org/shifts/night").send({ label: "Nocturnist" }).expect(200);
    expect(renamed.body.shifts[2]).toEqual({ id: "night", label: "Nocturnist", start: null, end: "07:00" });
  });

  it("validates the shift id, the label and the HH:MM hours", async () => {
    const director = await as("director");
    await director.patch("/api/org/shifts/evening").send({ label: "Evening" }).expect(404);
    for (const body of [
      {}, { label: "" }, { label: "   " }, { label: "x".repeat(41) }, { label: "Day\u0007" }, { label: 5 },
      { start: "25:00" }, { start: "7:00" }, { end: "07:60" }, { end: "0700" }, { start: 700 },
      { label: "Ok", foo: 1 },
    ]) {
      const r = await director.patch("/api/org/shifts/day").send(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error).toBe("validation_error");
    }
    // Nothing was stored by the refused writes.
    expect((await director.get("/api/org/shifts").expect(200)).body.shifts[0]).toEqual({ id: "day", label: "Day", start: null, end: null });
    expect((await audit()).some((a) => a.action === "org.shift_update")).toBe(false);
  });

  it("only a director or developer may change them", async () => {
    for (const u of ["chen", "er.doc", "er.director"]) {
      const agent = await as(u);
      await agent.patch("/api/org/shifts/day").send({ label: "Mine" }).expect(403);
    }
    await (await as("director")).patch("/api/org/shifts/day").send({ label: "Ours" }).expect(200);
  });

  it("is per tenant: one org's rename never shows in another", async () => {
    await ensureDemoTenants(ctx.storage);
    await (await as("director")).patch("/api/org/shifts/swing").send({ label: "ISPN Swing", start: "14:00", end: "22:00" }).expect(200);
    const other = await as("director", "HOSP");
    expect((await other.get("/api/org/shifts").expect(200)).body.shifts[1]).toEqual({ id: "swing", label: "Swing", start: null, end: null });
    await other.patch("/api/org/shifts/swing").send({ label: "HOSP Swing" }).expect(200);
    expect((await (await as("chen")).get("/api/org/shifts").expect(200)).body.shifts[1].label).toBe("ISPN Swing");
  });
});

// ── Admissions log (#7) ───────────────────────────────────────────────────
describe("the admissions log is the org's real routing history", () => {
  it("lists exactly the server's routed patients with the server's counts (seed: one, SC → Chen)", async () => {
    const director = await as("director");
    const res = await director.get("/api/admissions");
    expect(res.status).toBe(200);
    const chen = (await ctx.storage.listUsers(ctx.seedResult.orgId)).find((u) => u.username === "chen")!;
    expect(res.body.rows).toEqual([
      expect.objectContaining({ patientId: ctx.seedResult.patientIds.sc, initials: "SC", room: "204", specialty: "Cardiology", provider: chen.displayName, via: "round_robin", status: "pending", routings: 1 }),
    ]);
    expect(res.body).toMatchObject({ total: 1, last24h: 1, sinceReset: 1, reset: null });
    expect(typeof res.body.rows[0].routedAt).toBe("string");
    // PHI read: one row for the request, ids only.
    const phi = await ctx.storage.listPhiAccess(ctx.seedResult.orgId, 50);
    expect(phi.filter((p) => p.resource === "admissions").length).toBe(1);
  });

  it("a new ER admission appears (newest first); a re-route stays one row with the latest holder", async () => {
    const director = await as("director");
    const { patient } = await admit("QZ");
    const res = (await director.get("/api/admissions").expect(200)).body;
    expect(res.total).toBe(2);
    expect(res.rows.map((r: any) => r.initials)).toEqual(["QZ", "SC"]);

    // Re-route QZ by hand to Patel: still ONE admission, two routings.
    const patel = ctx.seedResult.hospitalistIds.patel!;
    const asg = (await ctx.storage.listAssignments(ctx.seedResult.orgId)).find((a) => a.patientId === patient.id)!;
    await director.patch(`/api/assignments/${asg.id}/reassign`).send({ hospitalistId: patel }).expect(200);
    const after = (await director.get("/api/admissions").expect(200)).body;
    expect(after.total).toBe(2);
    const qz = after.rows.find((r: any) => r.initials === "QZ");
    const patelUser = (await ctx.storage.listUsers(ctx.seedResult.orgId)).find((u) => u.username === "patel")!;
    expect(qz).toMatchObject({ routings: 2, provider: patelUser.displayName, status: "pending", via: "round_robin" });
  });

  it("is director / ER director / developer only, and module-gated", async () => {
    for (const u of ["chen", "er.doc"]) await (await as(u)).get("/api/admissions").expect(403);
    await (await as("er.director")).get("/api/admissions").expect(200);
    await setModule("routing.assignments", false);
    const r = await (await as("director")).get("/api/admissions");
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "module_disabled", module: "routing.assignments" });
  });

  it("never includes another tenant's admissions", async () => {
    await ensureDemoTenants(ctx.storage); // HOSP + ER have their own assignments
    const res = (await (await as("director")).get("/api/admissions").expect(200)).body;
    expect(res.rows.map((r: any) => r.initials)).toEqual(["SC"]);
    const hosp = (await (await as("director", "HOSP")).get("/api/admissions").expect(200)).body;
    expect(hosp.total).toBeGreaterThan(0);
    expect(hosp.rows.some((r: any) => r.initials === "SC")).toBe(false);
  });

  it("an empty org has an empty log — nothing invented", async () => {
    const director = await as("director");
    await director.post("/api/maintenance/purge").send({ olderThanHours: 0 }).expect(200);
    expect((await director.get("/api/admissions").expect(200)).body).toMatchObject({ rows: [], total: 0, last24h: 0, sinceReset: 0 });
  });
});

// ── Reset count (#6) ──────────────────────────────────────────────────────
describe("Reset count is an org-wide reset the server stores and audits", () => {
  it("resets for everyone, keeps the log, records who and when, and counts new admissions after it", async () => {
    const director = await as("director");
    await admit("QA");
    const before = (await director.get("/api/admissions").expect(200)).body;
    expect(before.sinceReset).toBe(2);

    const r = await director.post("/api/admissions/reset").send({});
    expect(r.status).toBe(200);
    const me = (await ctx.storage.listUsers(ctx.seedResult.orgId)).find((u) => u.username === "director")!;
    expect(r.body).toMatchObject({ total: 2, sinceReset: 0, reset: { by: { id: me.id, name: me.displayName } } });
    expect(Date.parse(r.body.reset.at)).toBeGreaterThan(Date.now() - 60_000);

    // A second director session sees the same reset; the log keeps every row.
    const other = await as("director");
    const seen = (await other.get("/api/admissions").expect(200)).body;
    expect(seen).toMatchObject({ total: 2, sinceReset: 0, reset: { at: r.body.reset.at } });
    expect(seen.rows.length).toBe(2);

    const row = (await audit()).find((a) => a.action === "admissions.counter_reset");
    expect(row).toBeTruthy();
    expect(row!.userId).toBe(me.id);
    expect(row!.details).toMatchObject({ countBefore: 2, previousResetAt: null, resetAt: r.body.reset.at });
    expect(ctx.ws.broadcasts.some((b) => b.orgId === ctx.seedResult.orgId && (b.message as any).type === "ADMISSIONS_UPDATED")).toBe(true);

    await new Promise((res) => setTimeout(res, 5));
    await admit("QB");
    expect((await director.get("/api/admissions").expect(200)).body).toMatchObject({ total: 3, sinceReset: 1 });
  });

  it("only a director or developer may reset; refusals store nothing", async () => {
    for (const u of ["chen", "er.doc", "er.director"]) await (await as(u)).post("/api/admissions/reset").send({}).expect(403);
    expect((await (await as("director")).get("/api/admissions").expect(200)).body.reset).toBe(null);
    expect((await audit()).some((a) => a.action === "admissions.counter_reset")).toBe(false);
  });

  it("is module-gated like the log", async () => {
    await setModule("routing.assignments", false);
    const r = await (await as("director")).post("/api/admissions/reset").send({});
    expect(r.status).toBe(404);
  });

  it("is per tenant", async () => {
    await ensureDemoTenants(ctx.storage);
    await (await as("director")).post("/api/admissions/reset").send({}).expect(200);
    expect((await (await as("director", "HOSP")).get("/api/admissions").expect(200)).body.reset).toBe(null);
  });
});

// ── Schedule source (#1-#3) — what the dashboard badge must read ───────────
describe("the schedule source the dashboard shows is the server's", () => {
  it("a fresh org reads the manual list with nothing synced; a director's choice is what every session reads", async () => {
    const director = await as("director");
    const src = (await director.get("/api/oncall/sources").expect(200)).body;
    expect(src.selected).toBe("manual");
    expect(src.sources.amion).toMatchObject({ configured: false, lastSyncAt: null });
    expect(src.sources.manual).toMatchObject({ configured: true });
    // The server knows only amion / epic / manual — a vendor without a connector is refused.
    for (const v of ["qgenda", "tangier", "shiftadmin", "word", "pdf", "online", "custom", "none"]) {
      await director.patch("/api/oncall/source").send({ source: v }).expect(400);
    }
    await director.patch("/api/oncall/source").send({ source: "manual" }).expect(200);
    expect((await (await as("director")).get("/api/oncall/sources").expect(200)).body).toMatchObject({ selected: "manual", explicit: true });
  });
});
