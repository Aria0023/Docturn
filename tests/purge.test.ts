import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { runAutoClean } from "../server/services/expiry.js";

/**
 * LB-4: patient purge must be transactional and complete. A patient with a
 * linked care-team conversation used to FK-fail AFTER assignments/consults
 * were already deleted (silent partial delete, hung request, and the hourly
 * auto-clean stalled for every later tenant). Now everything that references
 * the patient leaves in one transaction, per-table counts are audited, and the
 * sweep isolates failures per org.
 */

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("patient purge", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it("removes a patient together with its thread, messages, attachments, assignments and consults in one go, and audits the counts", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const { agent: director } = await login(ctx.app, { username: "director" });

    // A patient with an admission routed to a hospitalist…
    const patient = await er.post("/api/patients").send({ initials: "ZQ", roomNumber: "12", issueSummary: "chest pain", specialty: "Cardiology" });
    expect(patient.status).toBe(201);
    const patientId = patient.body.id as number;

    // …a patient-linked care-team thread with a message and an attachment…
    const thread = await director.post("/api/messaging/patient-thread").send({ patientId });
    expect([200, 201]).toContain(thread.status);
    const convoId = thread.body.id as number;
    const up = await director.post("/api/messaging/attachments").send({ fileName: "ecg.png", mimeType: "image/png", dataBase64: PNG_1x1 });
    expect(up.status).toBe(201);
    const sent = await director.post("/api/messaging/send").send({ conversationId: convoId, content: "ECG attached", attachmentIds: [up.body.id] });
    expect(sent.status).toBe(201);

    // …and an unrelated direct thread that must SURVIVE the purge.
    const keep = await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [chenId] });
    expect(keep.status).toBe(201);
    await er.post("/api/messaging/send").send({ conversationId: keep.body.id, content: "unrelated" }).expect(201);

    // Purge everything (0h window). Previously this threw an FK violation.
    const purge = await director.post("/api/maintenance/purge").send({ olderThanHours: 0 });
    expect(purge.status).toBe(200);
    expect(purge.body.removed).toBeGreaterThanOrEqual(1);
    expect(purge.body.conversations).toBeGreaterThanOrEqual(1);
    expect(purge.body.messages).toBeGreaterThanOrEqual(1);
    expect(purge.body.attachments).toBeGreaterThanOrEqual(1);

    // Gone: the patient, its thread, its attachment bytes.
    const patientsLeft = await er.get("/api/patients").expect(200);
    expect((patientsLeft.body as Array<{ id: number }>).some((p) => p.id === patientId)).toBe(false);
    expect((await director.get(`/api/messaging/conversations/${convoId}/messages`)).status).toBeGreaterThanOrEqual(400);
    expect((await director.get(`/api/messaging/attachments/${up.body.id}`)).status).toBe(404);
    // Kept: the unrelated thread.
    await er.get(`/api/messaging/conversations/${keep.body.id}/messages`).expect(200);

    // Audited with per-table counts, not just a patient number.
    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    const row = audit.find((a) => a.action === "maintenance.purge_patients");
    expect(row).toBeTruthy();
    expect(row!.details).toMatchObject({ patients: purge.body.patients, conversations: purge.body.conversations, messages: purge.body.messages });

    // Census is consistent afterwards (no accepted assignments remain).
    const hosps = await ctx.storage.listHospitalists(orgId);
    expect(hosps.every((h) => h.currentPatientCount === 0)).toBe(true);
  });

  it("auto-clean keeps sweeping other tenants when one org's purge throws", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    await er.post("/api/patients").send({ initials: "AA", roomNumber: "1", issueSummary: "x" }).expect(201);

    // Sabotage: make the FIRST org listed fail, let the rest proceed.
    const orgs = await ctx.storage.listOrganizations();
    const victim = orgs.find((o) => o.id !== orgId) ?? orgs[0]!;
    const real = ctx.storage.purgeOldPatients.bind(ctx.storage);
    const spy = { calls: 0 };
    (ctx.storage as unknown as { purgeOldPatients: typeof real }).purgeOldPatients = async (id: number, ms: number) => {
      spy.calls++;
      if (id === victim.id) throw new Error("simulated FK violation");
      return real(id, ms);
    };
    try {
      const removed = await runAutoClean(0.0000001); // tiny window → purge everything created so far
      expect(removed).toBeGreaterThanOrEqual(1);
      expect(spy.calls).toBeGreaterThanOrEqual(2); // the failure did not stop the loop
      const audit = await ctx.storage.listAuditLogs(victim.id, 20);
      expect(audit.find((a) => a.action === "maintenance.autoclean_failed")).toBeTruthy();
      const ok = await ctx.storage.listAuditLogs(orgId, 20);
      expect(ok.find((a) => a.action === "maintenance.autoclean_purged")).toBeTruthy();
    } finally {
      (ctx.storage as unknown as { purgeOldPatients: typeof real }).purgeOldPatients = real;
    }
  });
});
