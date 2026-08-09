import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { createTestDb, setHandle } from "../server/db.js";
import { DatabaseStorage, setStorage } from "../server/storage.js";
import { verifyPassword } from "../server/auth.js";
import { ensureDemoTenants, ensurePlatform, seed } from "../server/seed.js";

/**
 * Regression tests for two CRITICAL findings:
 *
 *  C1 — the platform root account (`dev`, role `developer`, cross-tenant) was
 *       auto-created at boot with a publicly-known default password, and the
 *       shared demo roster was seeded even on a real-PHI instance.
 *  C2 — any authenticated org user could POST /api/messaging/patient-thread for
 *       ANY patient in their org and be silently added to that patient's
 *       care-team thread, gaining read access to all of its PHI.
 */

describe("C2: patient-thread care-team access control", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  /** Admit a patient via the ER doc and have Chen accept the assignment. */
  async function admitAndAccept() {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const chenHospId = ctx.seedResult.hospitalistIds.chen!;
    const patient = (
      await er
        .post("/api/patients")
        .send({ initials: "ZZ", roomNumber: "412", issueSummary: "obs", acuity: 2 })
    ).body as { id: number };
    const assignment = (
      await er
        .post("/api/assignments")
        .send({ patientId: patient.id, mode: "manual", hospitalistId: chenHospId })
    ).body as { id: number };
    await chen.patch(`/api/assignments/${assignment.id}/accept`).expect(200);
    return { er, chen, patient };
  }

  it("THE EXPLOIT: an unrelated hospitalist cannot self-join a patient thread (403) and still cannot read it", async () => {
    const { er, chen, patient } = await admitAndAccept();

    // The care team opens the thread and puts PHI in it.
    const convo = (
      await er.post("/api/messaging/patient-thread").send({ patientId: patient.id })
    ).body as { id: number; participantIds: number[] };
    await chen
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "HIV viral load 48,000; MRN 88213" })
      .expect(201);

    // Patel is a hospitalist in the same org with NO relationship to this
    // patient: not the attending, not the ER doc, not a consultant.
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const patelId = ctx.seedResult.userIds.patel!;

    const attack = await patel
      .post("/api/messaging/patient-thread")
      .send({ patientId: patient.id });
    expect(attack.status).toBe(403);
    expect(attack.body.error).toBe("forbidden");

    // The attacker was NOT added to the conversation...
    const stored = await ctx.storage.getConversation(
      ctx.seedResult.orgId,
      convo.id,
    );
    expect(stored!.participantIds).not.toContain(patelId);

    // ...and still cannot read a single message from it.
    const read = await patel.get(`/api/messaging/conversations/${convo.id}/messages`);
    expect(read.status).toBe(403);

    // Nor does it appear in their conversation list.
    const list = await patel.get("/api/messaging/conversations");
    expect(list.status).toBe(200);
    expect((list.body as Array<{ id: number }>).some((c) => c.id === convo.id)).toBe(
      false,
    );
  });

  it("a legitimate care-team member (the accepted attending) still gets the thread, idempotently", async () => {
    const { er, chen, patient } = await admitAndAccept();
    const chenUserId = ctx.seedResult.userIds.chen!;
    const erUserId = ctx.seedResult.userIds["er.doc"]!;

    // ER doc (physician of record) creates it.
    const created = await er
      .post("/api/messaging/patient-thread")
      .send({ patientId: patient.id });
    expect(created.status).toBe(201);
    expect(created.body.participantIds).toContain(chenUserId);
    expect(created.body.participantIds).toContain(erUserId);

    // The accepted attending gets the SAME conversation back.
    const attending = await chen
      .post("/api/messaging/patient-thread")
      .send({ patientId: patient.id });
    expect(attending.status).toBe(200);
    expect(attending.body.id).toBe(created.body.id);

    // Idempotent: calling twice more never forks a second thread.
    const again = await chen
      .post("/api/messaging/patient-thread")
      .send({ patientId: patient.id });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(created.body.id);
    const ids = again.body.participantIds as number[];
    expect(new Set(ids).size).toBe(ids.length);

    // And they can actually read it.
    const msgs = await chen.get(
      `/api/messaging/conversations/${created.body.id}/messages`,
    );
    expect(msgs.status).toBe(200);
  });

  it("a director may break the glass, and the access is audited at high risk", async () => {
    const { er, patient } = await admitAndAccept();
    const orgId = ctx.seedResult.orgId;
    const directorId = ctx.seedResult.userIds.director!;

    const convo = (
      await er.post("/api/messaging/patient-thread").send({ patientId: patient.id })
    ).body as { id: number };

    const { agent: director } = await login(ctx.app, { username: "director" });
    const joined = await director
      .post("/api/messaging/patient-thread")
      .send({ patientId: patient.id });
    expect(joined.status).toBe(200);
    expect(joined.body.id).toBe(convo.id);
    expect(joined.body.participantIds).toContain(directorId);

    const audit = await ctx.storage.listAuditLogs(orgId, 200);
    const bg = audit.find(
      (a) =>
        a.action === "message.patient_thread_breakglass" &&
        a.resourceId === convo.id,
    );
    expect(bg).toBeTruthy();
    expect(bg!.riskLevel).toBe("high");
    expect(bg!.userId).toBe(directorId);
    expect((bg!.details as { patientId?: number }).patientId).toBe(patient.id);
    expect((bg!.details as { conversationId?: number }).conversationId).toBe(
      convo.id,
    );

    // Every participant addition on the existing-thread path is audited too.
    const join = audit.find(
      (a) =>
        a.action === "message.patient_thread_joined" &&
        a.resourceId === convo.id &&
        (a.details as { addedUserId?: number }).addedUserId === directorId,
    );
    expect(join).toBeTruthy();
    expect(join!.riskLevel).toBe("medium");
  });

  it("break-glass is NOT recorded for an oversight role that is on the care team", async () => {
    // Sanity: the audit marks genuine reach-ins, not ordinary oversight work.
    const { er, patient } = await admitAndAccept();
    await er.post("/api/messaging/patient-thread").send({ patientId: patient.id });
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 200);
    expect(
      audit.some((a) => a.action === "message.patient_thread_breakglass"),
    ).toBe(false);
  });
});

describe("C1: seeded credentials are gated by environment", () => {
  const STRONG = "a-very-strong-platform-secret-42";

  /** A bare, unseeded database + storage wired into the process singletons. */
  async function freshDb() {
    const handle = await createTestDb();
    setHandle(handle);
    const storage = new DatabaseStorage(handle.db);
    setStorage(storage);
    return storage;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("production without PLATFORM_ADMIN_PASSWORD does NOT create the cross-tenant root account", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLATFORM_ADMIN_PASSWORD", "");
    const storage = await freshDb();

    await ensurePlatform(storage);

    const platform = await storage.getOrganizationByCode("DOCTURN");
    expect(platform).toBeTruthy();
    const dev = await storage.getUserByUsername(platform!.id, "dev");
    expect(dev).toBeUndefined();
  });

  it("production with a too-short PLATFORM_ADMIN_PASSWORD also refuses", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLATFORM_ADMIN_PASSWORD", "short");
    const storage = await freshDb();

    await ensurePlatform(storage);

    const platform = (await storage.getOrganizationByCode("DOCTURN"))!;
    expect(await storage.getUserByUsername(platform.id, "dev")).toBeUndefined();
  });

  it("production with a >=12-char PLATFORM_ADMIN_PASSWORD creates root with THAT password, never the default", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLATFORM_ADMIN_PASSWORD", STRONG);
    const storage = await freshDb();

    await ensurePlatform(storage);

    const platform = (await storage.getOrganizationByCode("DOCTURN"))!;
    const dev = await storage.getUserByUsername(platform.id, "dev");
    expect(dev).toBeTruthy();
    expect(dev!.role).toBe("developer");
    expect(await verifyPassword(STRONG, dev!.passwordHash)).toBe(true);
    // The publicly-known default must NOT authenticate the root account.
    expect(await verifyPassword("docturn", dev!.passwordHash)).toBe(false);
  });

  it("an existing root account is never deleted, only warned about", async () => {
    const storage = await freshDb();
    // Provision it the way a dev instance would (no gate).
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PLATFORM_ADMIN_PASSWORD", "");
    await ensurePlatform(storage);
    const platform = (await storage.getOrganizationByCode("DOCTURN"))!;
    const before = await storage.getUserByUsername(platform.id, "dev");
    expect(before).toBeTruthy();

    // Now boot as production with no env password: warn, don't destroy.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    await ensurePlatform(storage);
    const after = await storage.getUserByUsername(platform.id, "dev");
    expect(after).toBeTruthy();
    expect(after!.id).toBe(before!.id);
    const messages = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(messages).toContain("PLATFORM_ADMIN_PASSWORD");
    // Never log a password value.
    expect(messages).not.toContain("docturn");
    warn.mockRestore();
  });

  it("real-PHI mode (SYNTHETIC_DATA=false) seeds no demo clinical accounts and no demo tenants", async () => {
    vi.stubEnv("SYNTHETIC_DATA", "false");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = await freshDb();

    await expect(seed(storage)).rejects.toThrow(/SYNTHETIC_DATA=false/);
    await ensureDemoTenants(storage);

    expect(await storage.getOrganizationByCode("ISPN")).toBeUndefined();
    expect(await storage.getOrganizationByCode("HOSP")).toBeUndefined();
    expect(await storage.getOrganizationByCode("ER")).toBeUndefined();
    expect(warn.mock.calls.length).toBeGreaterThan(0);
    warn.mockRestore();
  });

  it("synthetic mode (the pilot) still seeds the demo clinical logins", async () => {
    // No env stubs: this is exactly how the pilot runs (SYNTHETIC_DATA unset).
    const storage = await freshDb();
    const result = await seed(storage);
    for (const username of ["chen", "director", "er.doc", "er.director"]) {
      const user = await storage.getUserByUsername(result.orgId, username);
      expect(user, `${username} must still exist`).toBeTruthy();
      expect(await verifyPassword("docturn", user!.passwordHash)).toBe(true);
    }
  });
});
