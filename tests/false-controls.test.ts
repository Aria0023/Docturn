import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { messages } from "@shared/schema";
import { setStorage, type DatabaseStorage } from "../server/storage.js";
import { runMessageRetentionSweep } from "../server/services/retention.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * Regression suite for four "false controls" — safeguards the product advertised
 * but that did not actually work:
 *
 *  F1  PHI READS were never audited (logPhiAccess was mutation-only), and the
 *      phi_access_logs row carried no record identifier, so "who read THIS
 *      patient's record?" (§164.528 accounting, breach scoping) was unanswerable.
 *  F2  The retention purge FK-crashed on any org with a message attachment, and
 *      one org's failure silently killed the sweep for every remaining org.
 *  F3  Deleting a tenant with attachments 409'd; when it did succeed it
 *      hard-deleted the audit / PHI-access / security trail that
 *      §164.316(b)(2)(i) requires be retained six years.
 *  F4  is a browser-storage concern and is covered by the live Playwright check,
 *      not here.
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  setStorage(ctx.storage);
  await ctx.handle.close();
});

/** A valid 1x1 transparent PNG. */
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function phiRows(orgId: number) {
  return ctx.storage.listPhiAccess(orgId, 500);
}

/* ───────────────────────────── F1 — PHI reads are audited ───────────────── */

describe("F1 — PHI reads are audited with a record identifier", () => {
  it("logs one identified row when a conversation's messages are read", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const { agent: chen } = await login(ctx.app, { username: "chen" });

    const convo = await er
      .post("/api/messaging/conversations")
      .send({ type: "direct", participantIds: [chenId] });
    expect(convo.status).toBe(201);
    const convoId = convo.body.id as number;

    const secret = "Troponin 0.8, admit to telemetry";
    await er
      .post("/api/messaging/send")
      .send({ conversationId: convoId, content: secret })
      .expect(201);

    const before = (await phiRows(orgId)).length;
    const read = await chen.get(
      "/api/messaging/conversations/" + convoId + "/messages",
    );
    expect(read.status).toBe(200);
    expect(read.body[0].content).toBe(secret); // the read really did return PHI

    const rows = await phiRows(orgId);
    // Exactly ONE row for the request — not one per message.
    expect(rows.length).toBe(before + 1);
    const row = rows[0]!;
    expect(row.resource).toBe("conversation-messages");
    expect(row.resourceId).toBe(convoId);
    expect(row.userId).toBe(ctx.seedResult.userIds.chen);
    expect(row.method).toBe("GET");

    // The log row must carry ids only — never a word of clinical content.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("Troponin");
    expect(serialized).not.toContain(secret);
  });

  it("records the patientId when the thread is patient-linked", async () => {
    const orgId = ctx.seedResult.orgId;
    const patientId = ctx.seedResult.patientIds.sc!;
    // er.doc is the patient's ER physician of record, so they are on the care
    // team and the patient thread is legitimately theirs to open.
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const thread = await er
      .post("/api/messaging/patient-thread")
      .send({ patientId });
    expect(thread.status).toBe(201);
    const convoId = thread.body.id as number;

    await er
      .get("/api/messaging/conversations/" + convoId + "/messages")
      .expect(200);

    const rows = await phiRows(orgId);
    const row = rows.find(
      (r) => r.resource === "conversation-messages" && r.resourceId === convoId,
    );
    expect(row, "no PHI row for the patient thread read").toBeTruthy();
    expect(row!.patientId).toBe(patientId);
  });

  it("logs a row when a patient's consults are read", async () => {
    const orgId = ctx.seedResult.orgId;
    const patientId = ctx.seedResult.patientIds.sc!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });

    const res = await chen.get("/api/patients/" + patientId + "/consults");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);

    const row = (await phiRows(orgId)).find(
      (r) => r.resource === "patient-consults",
    );
    expect(row, "consult read was not audited").toBeTruthy();
    expect(row!.resourceId).toBe(patientId);
    expect(row!.patientId).toBe(patientId);
  });

  it("logs the conversation LIST read (it returns lastMessage content)", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const before = (await phiRows(orgId)).length;
    await chen.get("/api/messaging/conversations").expect(200);
    const rows = await phiRows(orgId);
    expect(rows.length).toBe(before + 1);
    expect(rows[0]!.resource).toBe("conversations");
  });

  it("a non-participant is refused AND writes no PHI row", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const { agent: director } = await login(ctx.app, { username: "director" });

    const convo = await er
      .post("/api/messaging/conversations")
      .send({ type: "direct", participantIds: [chenId] });
    const convoId = convo.body.id as number;

    const before = (await phiRows(orgId)).length;
    await director
      .get("/api/messaging/conversations/" + convoId + "/messages")
      .expect(403);
    // A refused read disclosed nothing, so it must not appear as a PHI access.
    expect((await phiRows(orgId)).length).toBe(before);
  });
});

/* ─────────────────── F2 — retention purge actually purges ───────────────── */

describe("F2 — retention sweep purges messages AND their attachments", () => {
  /** Send a message with an attachment, then backdate it past the cutoff. */
  async function seedOldMessageWithAttachment() {
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });

    const up = await er.post("/api/messaging/attachments").send({
      fileName: "ekg.png",
      mimeType: "image/png",
      dataBase64: PNG_1x1,
    });
    expect(up.status).toBe(201);
    const attachmentId = up.body.id as number;

    const convo = await er
      .post("/api/messaging/conversations")
      .send({ type: "direct", participantIds: [chenId] });
    const sent = await er.post("/api/messaging/send").send({
      conversationId: convo.body.id,
      content: "EKG attached",
      attachmentIds: [attachmentId],
    });
    expect(sent.status).toBe(201);
    const messageId = sent.body.id as number;

    // Backdate it 90 days so any sane retention window covers it.
    await ctx.handle.db
      .update(messages)
      .set({ createdAt: new Date(Date.now() - 90 * 86_400_000) })
      .where(eq(messages.id, messageId));

    return { messageId, attachmentId, conversationId: convo.body.id as number };
  }

  it("purges an old message that HAS an attachment (this is the F2 regression)", async () => {
    const orgId = ctx.seedResult.orgId;
    const { messageId, attachmentId } = await seedOldMessageWithAttachment();

    await ctx.storage.setOrgSetting(orgId, "messageRetentionDays", 30, null);

    // Against the pre-fix code this returns 0: purgeMessagesOlderThan deleted
    // delivery rows then messages, leaving message_attachments.message_id
    // dangling, so Postgres rejected the delete and the swallowed FK error left
    // the message (and its attachment) in place forever.
    const purged = await runMessageRetentionSweep();
    expect(purged).toBeGreaterThan(0);

    expect(await ctx.storage.getMessage(orgId, messageId)).toBeUndefined();
    expect(await ctx.storage.getAttachment(orgId, attachmentId)).toBeUndefined();

    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    expect(audit.some((a) => a.action === "messages.retention_purged")).toBe(
      true,
    );
  });

  it("keeps sweeping the remaining orgs when one org fails, and audits the failure", async () => {
    const orgA = ctx.seedResult.orgId;
    await seedOldMessageWithAttachment();
    await ctx.storage.setOrgSetting(orgA, "messageRetentionDays", 30, null);

    // A second tenant with its own expired message.
    const orgB = await ctx.storage.createOrganization({
      name: "Second Hospital",
      code: "SECOND",
      city: null,
      state: null,
      timezone: "America/New_York",
      assignmentTimeoutMin: 10,
      roundRobinShiftTypes: ["day", "night"],
      rotationMode: "lowest_census",
      rotationIndex: 0,
    });
    const userB = await ctx.storage.createUser({
      organizationId: orgB.id,
      username: "b.doc",
      passwordHash: "x",
      role: "hospitalist",
      displayName: "B Doc",
      credential: "MD",
      phone: null,
      twoFactorEnabled: false,
    });
    const convoB = await ctx.storage.createConversation({
      organizationId: orgB.id,
      type: "direct",
      name: null,
      participantIds: [userB.id],
      patientId: null,
    });
    const msgB = await ctx.storage.createMessage({
      organizationId: orgB.id,
      conversationId: convoB.id,
      senderId: userB.id,
      content: "old",
      priority: "routine",
    });
    await ctx.handle.db
      .update(messages)
      .set({ createdAt: new Date(Date.now() - 90 * 86_400_000) })
      .where(eq(messages.id, msgB.id));
    await ctx.storage.setOrgSetting(orgB.id, "messageRetentionDays", 30, null);

    // Force org A's purge to blow up; org B must still be swept.
    const real = ctx.storage;
    const failing = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "purgeMessagesOlderThan") {
          return async (orgId: number, cutoff: Date) => {
            if (orgId === orgA) throw new Error("simulated purge failure");
            return real.purgeMessagesOlderThan(orgId, cutoff);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as DatabaseStorage;
    setStorage(failing);

    const purged = await runMessageRetentionSweep();
    setStorage(real);

    // Org B was reached despite org A throwing first.
    expect(purged).toBe(1);
    expect(await ctx.storage.getMessage(orgB.id, msgB.id)).toBeUndefined();

    // …and the failure surfaced as a high-risk audit event rather than silence.
    const auditA = await ctx.storage.listAuditLogs(orgA, 50);
    const failure = auditA.find((a) => a.action === "retention.sweep_failed");
    expect(failure, "sweep failure was swallowed").toBeTruthy();
    expect(failure!.riskLevel).toBe("high");
    expect(failure!.resourceId).toBe(orgA);
  });
});

/* ───────── F3 — tenant delete works, and the compliance trail survives ──── */

describe("F3 — org delete cascades attachments and preserves compliance history", () => {
  it("deletes an org that has attachments and retains its audit/PHI history", async () => {
    const { agent: dev } = await login(ctx.app, {
      orgCode: "DOCTURN",
      username: "dev",
    });

    // A doomed tenant with a user, a message, an ATTACHMENT (the FK that used to
    // block the whole cascade), plus audit + PHI-access history.
    const doomed = await ctx.storage.createOrganization({
      name: "Doomed General",
      code: "DOOMED",
      city: null,
      state: null,
      timezone: "America/New_York",
      assignmentTimeoutMin: 10,
      roundRobinShiftTypes: ["day", "night"],
      rotationMode: "lowest_census",
      rotationIndex: 0,
    });
    const user = await ctx.storage.createUser({
      organizationId: doomed.id,
      username: "doomed.doc",
      passwordHash: "x",
      role: "hospitalist",
      displayName: "Doomed Doc",
      credential: "MD",
      phone: null,
      twoFactorEnabled: false,
    });
    const convo = await ctx.storage.createConversation({
      organizationId: doomed.id,
      type: "direct",
      name: null,
      participantIds: [user.id],
      patientId: null,
    });
    const msg = await ctx.storage.createMessage({
      organizationId: doomed.id,
      conversationId: convo.id,
      senderId: user.id,
      content: "clinical note",
      priority: "routine",
    });
    const att = await ctx.storage.createAttachment({
      organizationId: doomed.id,
      uploaderId: user.id,
      fileName: "scan.png",
      mimeType: "image/png",
      byteSize: 68,
      dataBase64: PNG_1x1,
    });
    await ctx.storage.linkAttachmentsToMessage(
      doomed.id,
      msg.id,
      [att.id],
      user.id,
    );
    await ctx.storage.appendAudit({
      organizationId: doomed.id,
      userId: user.id,
      action: "assignment.accept",
      resourceType: "assignment",
      resourceId: 4242,
      details: { via: "round_robin" },
      riskLevel: "medium",
    });
    await ctx.storage.logPhiAccess({
      organizationId: doomed.id,
      userId: user.id,
      resource: "conversation-messages",
      resourceId: convo.id,
      patientId: 99,
      method: "GET",
    });

    expect(await ctx.storage.countAuditLogs(doomed.id)).toBeGreaterThan(0);
    expect(await ctx.storage.countPhiAccess(doomed.id)).toBe(1);

    // Previously 409 org_has_linked_records — message_attachments was never in
    // the cascade, so any tenant that had uploaded a file was undeletable.
    const del = await dev.delete(
      "/api/dev/organizations/" + doomed.id + "?force=true",
    );
    expect(del.status).toBe(204);
    expect(await ctx.storage.getOrganization(doomed.id)).toBeUndefined();
    expect(await ctx.storage.getAttachment(doomed.id, att.id)).toBeUndefined();

    // The live tables are gone (they are FK-bound to the org)…
    expect(await ctx.storage.countAuditLogs(doomed.id)).toBe(0);
    expect(await ctx.storage.countPhiAccess(doomed.id)).toBe(0);

    // …but the six-year record survives in the retained archive, still naming
    // WHO did WHAT to WHICH record.
    const retained = await ctx.storage.listRetainedComplianceRecords(doomed.id);
    expect(retained.length).toBeGreaterThanOrEqual(2);
    expect(await ctx.storage.countRetainedComplianceRecords(doomed.id)).toBe(
      retained.length,
    );

    const archivedAudit = retained.find(
      (r) => r.sourceTable === "audit_logs" && r.action === "assignment.accept",
    );
    expect(archivedAudit, "audit history was destroyed").toBeTruthy();
    expect(archivedAudit!.organizationCode).toBe("DOOMED");
    expect(archivedAudit!.userDisplayName).toBe("Doomed Doc");
    expect(archivedAudit!.resourceId).toBe(4242);
    expect(archivedAudit!.archivedReason).toBe("organization_deleted");

    const archivedPhi = retained.find(
      (r) => r.sourceTable === "phi_access_logs",
    );
    expect(archivedPhi, "PHI-access history was destroyed").toBeTruthy();
    expect(archivedPhi!.resourceId).toBe(convo.id);
    expect(archivedPhi!.patientId).toBe(99);
    expect(archivedPhi!.userUsername).toBe("doomed.doc");
    // Ids and actions only — no clinical content came along for the ride.
    expect(JSON.stringify(retained)).not.toContain("clinical note");

    // The deletion itself is audited at high risk.
    const archive = await dev.get("/api/dev/compliance-archive?orgId=" + doomed.id);
    expect(archive.status).toBe(200);
    expect(archive.body.length).toBe(retained.length);
  });

  it("gates the compliance archive behind the developer role", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.get("/api/dev/compliance-archive").expect(403);
  });
});
