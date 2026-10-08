import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import speakeasy from "speakeasy";
import { and, eq, isNull } from "drizzle-orm";
import {
  auditLogs,
  messageTemplates,
  messages,
  orgSettings,
  phiAccessLogs,
  users,
} from "@shared/schema";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * Developer-console audit integrity (launch findings A.CON-SHO-9 / -32 / -38 /
 * -39):
 *
 *  SHO-9   every developer cross-tenant READ writes exactly one ids-only audit
 *          row (the file header claims "EVERY cross-tenant action is audited";
 *          the GET routes wrote nothing).
 *  SHO-38  rows written while a developer is impersonating / managing an org
 *          name the REAL operator (impersonator_user_id + details.onBehalfOf),
 *          not only the clinician whose session was borrowed.
 *  SHO-39  high-risk rows never carry organization_id NULL: mfa.failed belongs
 *          to the pending user's org; dev.org_delete to the platform org AND the
 *          deleted tenant's six-year archive (where the tenant's history lives).
 *  SHO-32  tenant force-delete is ONE transaction: message_templates and the
 *          user-keyed null-org rows are cascaded, and a failure anywhere leaves
 *          the tenant exactly as it was (never a half-deleted, undeletable org).
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

const devLogin = () => login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
const audit = (orgId: number) => ctx.storage.listAuditLogs(orgId, 500);
const phi = (orgId: number) => ctx.storage.listPhiAccess(orgId, 500);

/** A throwaway tenant with one clinician, for delete scenarios. */
async function makeDoomedTenant(code = "DOOMED") {
  const org = await ctx.storage.createOrganization({
    name: code + " General",
    code,
    city: null,
    state: null,
    timezone: "America/New_York",
    assignmentTimeoutMin: 10,
    roundRobinShiftTypes: ["day", "night"],
    rotationMode: "lowest_census",
    rotationIndex: 0,
  });
  const user = await ctx.storage.createUser({
    organizationId: org.id,
    username: "doomed.doc",
    passwordHash: "x",
    role: "hospitalist",
    displayName: "Doomed Doc",
    credential: "MD",
    phone: null,
    twoFactorEnabled: false,
  });
  return { org, user };
}

/* ───────────────────────────── SHO-9 ─────────────────────────────────────── */

describe("A.CON-SHO-9 — developer cross-tenant reads are audited", () => {
  it("writes exactly one ids-only audit row per developer read request", async () => {
    const { agent: dev } = await devLogin();
    const platformId = ctx.seedResult.platformOrgId;
    const orgId = ctx.seedResult.orgId;
    const devId = ctx.seedResult.userIds.dev!;
    const total = async () =>
      (await ctx.storage.countAuditLogs(platformId)) + (await ctx.storage.countAuditLogs(orgId));

    const reads: Array<{ path: string; action: string; org: number; risk?: string }> = [
      // Cross-tenant lists belong to the operator's own (platform) org — never NULL.
      { path: "/api/dev/organizations", action: "dev.orgs_list", org: platformId },
      { path: "/api/dev/users", action: "dev.users_list", org: platformId },
      { path: "/api/dev/compliance-overview", action: "dev.compliance_overview", org: platformId },
      { path: "/api/dev/compliance-archive", action: "dev.archive_read", org: platformId },
      { path: "/api/dev/compliance-archive?orgId=" + orgId, action: "dev.archive_read", org: platformId },
      // Per-tenant reads land in THAT tenant's trail, so its director sees them.
      { path: "/api/dev/organizations/" + orgId + "/settings", action: "dev.org_read", org: orgId },
      { path: "/api/dev/organizations/" + orgId + "/audit", action: "dev.audit_read", org: orgId, risk: "medium" },
      { path: "/api/dev/modules/" + orgId, action: "dev.modules_read", org: orgId },
    ];
    for (const r of reads) {
      const before = await total();
      const beforeIds = new Set((await audit(r.org)).map((a) => a.id));
      await dev.get(r.path).expect(200);
      expect(await total(), r.path).toBe(before + 1);
      const fresh = (await audit(r.org)).filter((a) => !beforeIds.has(a.id));
      expect(fresh.length, r.path).toBe(1);
      const row = fresh[0]!;
      expect(row.action, r.path).toBe(r.action);
      expect(row.userId, r.path).toBe(devId);
      expect(row.organizationId, r.path).toBe(r.org);
      if (r.risk) expect(row.riskLevel, r.path).toBe(r.risk);
      // Ids / counts only — never a name, username or clinical value.
      for (const [k, v] of Object.entries(row.details ?? {})) {
        expect(typeof v === "number" || v === null, r.path + " details." + k).toBe(true);
      }
    }
  });

  it("a tenant director reading their OWN module switches is not a cross-tenant read", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: director } = await login(ctx.app, { username: "director" });
    const before = await ctx.storage.countAuditLogs(orgId);
    await director.get("/api/dev/modules/" + orgId).expect(200);
    expect(await ctx.storage.countAuditLogs(orgId)).toBe(before);
  });

  it("a refused read (unknown tenant, malformed id) writes no row", async () => {
    const { agent: dev } = await devLogin();
    const platformId = ctx.seedResult.platformOrgId;
    const before = await ctx.storage.countAuditLogs(platformId);
    await dev.get("/api/dev/organizations/999999/settings").expect(404);
    await dev.get("/api/dev/organizations/999999/audit").expect(404);
    await dev.get("/api/dev/organizations/abc/audit").expect(400);
    await dev.get("/api/dev/compliance-archive?orgId=abc").expect(400);
    expect(await ctx.storage.countAuditLogs(platformId)).toBe(before);
  });
});

/* ───────────────────────────── SHO-38 ────────────────────────────────────── */

describe("A.CON-SHO-38 — impersonated sessions keep the operator identity", () => {
  it("attributes PHI and audit rows written while impersonating to the developer", async () => {
    const { agent: dev } = await devLogin();
    const devId = ctx.seedResult.userIds.dev!;
    const orgId = ctx.seedResult.orgId;
    const directorId = ctx.seedResult.userIds.director!;

    await dev.post("/api/dev/impersonate").send({ userId: directorId }).expect(200);
    // The entry row itself is the developer's own act — no "on behalf of".
    const entry = (await audit(orgId)).find((a) => a.action === "dev.impersonate");
    expect(entry).toBeTruthy();
    expect(entry!.userId).toBe(devId);
    expect(entry!.impersonatorUserId).toBeNull();

    // A PHI read made through the borrowed session.
    await dev.get("/api/patient-board").expect(200);
    const board = (await phi(orgId)).find((r) => r.resource === "patient-board");
    expect(board, "board read not accounted").toBeTruthy();
    expect(board!.userId).toBe(directorId); // the identity whose rights were used…
    expect(board!.impersonatorUserId).toBe(devId); // …and the human who really read it

    // An audited mutation made through the borrowed session.
    const chenH = ctx.seedResult.hospitalistIds.chen!;
    await dev
      .patch("/api/hospitalists/" + chenH + "/census")
      .send({ currentPatientCount: 3, reason: "impersonated correction" })
      .expect(200);
    const override = (await audit(orgId)).find((a) => a.action === "hospitalist.census_override");
    expect(override).toBeTruthy();
    expect(override!.userId).toBe(directorId);
    expect(override!.impersonatorUserId).toBe(devId);
    expect((override!.details as { onBehalfOf?: number }).onBehalfOf).toBe(devId);

    // Leaving restores the developer; the stop row is the developer's own act.
    await dev.post("/api/dev/impersonate/stop").send({}).expect(200);
    const stop = (await audit(orgId)).find((a) => a.action === "dev.impersonate_stop");
    expect(stop!.userId).toBe(devId);
    expect(stop!.impersonatorUserId).toBeNull();

    // Back as the developer, nothing is "on behalf of" anyone.
    await dev.get("/api/dev/organizations").expect(200);
    const list = (await audit(ctx.seedResult.platformOrgId)).find((a) => a.action === "dev.orgs_list");
    expect(list!.impersonatorUserId).toBeNull();
    expect(list!.details ?? {}).not.toHaveProperty("onBehalfOf");
  });

  it("attributes rows written inside a managed-org portal to the developer", async () => {
    const { agent: dev } = await devLogin();
    const devId = ctx.seedResult.userIds.dev!;
    const orgId = ctx.seedResult.orgId;
    const enter = await dev.post("/api/dev/manage-org").send({ orgId }).expect(200);
    expect(enter.body.role).toBe("director");

    await dev
      .patch("/api/settings/org")
      .send({ key: "autoReassignOnDecline", value: true })
      .expect(200);
    const row = (await audit(orgId)).find((a) => a.action === "settings.org_update");
    expect(row).toBeTruthy();
    expect(row!.userId).toBe(enter.body.id);
    expect(row!.impersonatorUserId).toBe(devId);
    expect((row!.details as { onBehalfOf?: number }).onBehalfOf).toBe(devId);

    // A clinician's ordinary session carries no impersonator.
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.get("/api/patients").expect(200);
    const own = (await phi(orgId)).find((r) => r.resource === "patients" && r.userId === ctx.seedResult.userIds.chen);
    expect(own).toBeTruthy();
    expect(own!.impersonatorUserId).toBeNull();
  });
});

/* ───────────────────────────── SHO-39 ────────────────────────────────────── */

describe("A.CON-SHO-39 — high-risk audit rows always carry an organization", () => {
  it("mfa.failed is attributed to the pending user's org", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent } = await login(ctx.app, { username: "chen" });
    const enroll = await agent.post("/api/mfa/enroll").expect(200);
    const secret = enroll.body.secret as string;
    await agent
      .post("/api/mfa/verify")
      .send({ code: speakeasy.totp({ secret, encoding: "base32" }) })
      .expect(200);

    const a2 = supertest.agent(ctx.app);
    const first = await a2
      .post("/api/login")
      .send({ orgCode: "ISPN", username: "chen", password: "docturn" });
    expect(first.status).toBe(202);
    const good = speakeasy.totp({ secret, encoding: "base32" });
    const wrong = good === "000000" ? "111111" : "000000";
    await a2.post("/api/2fa/complete-login").send({ code: wrong }).expect(401);

    const failed = (await audit(orgId)).find((a) => a.action === "mfa.failed");
    expect(failed, "mfa.failed not visible in the tenant's trail").toBeTruthy();
    expect(failed!.organizationId).toBe(orgId);
    expect(failed!.userId).toBe(chenId);
    expect(failed!.riskLevel).toBe("high");
    // Nothing high-risk is left floating without a tenant.
    const orphans = await ctx.handle.db
      .select()
      .from(auditLogs)
      .where(and(isNull(auditLogs.organizationId), eq(auditLogs.riskLevel, "high")));
    expect(orphans).toHaveLength(0);
  });

  it("dev.org_delete lands in the platform org AND in the deleted tenant's retained archive", async () => {
    const { agent: dev } = await devLogin();
    const platformId = ctx.seedResult.platformOrgId;
    const devId = ctx.seedResult.userIds.dev!;
    const { org } = await makeDoomedTenant();

    await dev.delete("/api/dev/organizations/" + org.id + "?force=true").expect(204);

    // Readable where the operator's own trail lives…
    const row = (await audit(platformId)).find((a) => a.action === "dev.org_delete");
    expect(row).toBeTruthy();
    expect(row!.organizationId).toBe(platformId);
    expect(row!.userId).toBe(devId);
    expect(row!.resourceId).toBe(org.id);
    expect(row!.riskLevel).toBe("high");
    // …and in the tenant's six-year archive, which is the only place the
    // tenant's own history can still be read.
    const retained = await ctx.storage.listRetainedComplianceRecords(org.id);
    const archived = retained.find((r) => r.action === "dev.org_delete");
    expect(archived, "deletion missing from the deleted tenant's archive").toBeTruthy();
    expect(archived!.organizationCode).toBe("DOOMED");
    expect(archived!.userId).toBe(devId);
    expect(archived!.userUsername).toBe("dev");
    expect(archived!.sourceTable).toBe("audit_logs");
    expect(archived!.sourceId).toBe(row!.id);
    // The developer-facing archive route shows it too.
    const api = await dev.get("/api/dev/compliance-archive?orgId=" + org.id).expect(200);
    expect(api.body.some((r: { action: string }) => r.action === "dev.org_delete")).toBe(true);

    const orphans = await ctx.handle.db
      .select()
      .from(auditLogs)
      .where(and(isNull(auditLogs.organizationId), eq(auditLogs.riskLevel, "high")));
    expect(orphans).toHaveLength(0);
  });
});

/* ───────────────────────────── SHO-32 ────────────────────────────────────── */

describe("A.CON-SHO-32 — tenant delete is atomic and complete", () => {
  it("cascades message templates and user-keyed null-org audit rows, archiving them first", async () => {
    const { agent: dev } = await devLogin();
    const { org, user } = await makeDoomedTenant();

    // The two rows that used to make force-delete 409 AFTER the cascade had
    // already run: an org-wide + a personal template, and a legacy mfa.failed
    // row written with organization_id NULL but user_id = a tenant user.
    await ctx.storage.createMessageTemplate({
      organizationId: org.id, ownerUserId: null, title: "Org-wide", body: "t", priority: "routine",
    });
    await ctx.storage.createMessageTemplate({
      organizationId: org.id, ownerUserId: user.id, title: "Personal", body: "t", priority: "routine",
    });
    await ctx.handle.db.insert(auditLogs).values({
      organizationId: null,
      userId: user.id,
      action: "mfa.failed",
      resourceType: "user",
      resourceId: user.id,
      details: {},
      riskLevel: "high",
    });
    await ctx.handle.db.insert(phiAccessLogs).values({
      organizationId: null,
      userId: user.id,
      resource: "patients",
      method: "GET",
    });

    await dev.delete("/api/dev/organizations/" + org.id + "?force=true").expect(204);

    expect(await ctx.storage.getOrganization(org.id)).toBeUndefined();
    expect(await ctx.handle.db.select().from(users).where(eq(users.organizationId, org.id))).toHaveLength(0);
    expect(
      await ctx.handle.db.select().from(messageTemplates).where(eq(messageTemplates.organizationId, org.id)),
    ).toHaveLength(0);
    expect(await ctx.handle.db.select().from(auditLogs).where(eq(auditLogs.userId, user.id))).toHaveLength(0);
    expect(await ctx.handle.db.select().from(phiAccessLogs).where(eq(phiAccessLogs.userId, user.id))).toHaveLength(0);

    // The null-org rows were archived under the tenant they really belonged to.
    const retained = await ctx.storage.listRetainedComplianceRecords(org.id);
    const legacy = retained.find((r) => r.action === "mfa.failed");
    expect(legacy, "user-keyed audit row was destroyed, not archived").toBeTruthy();
    expect(legacy!.userUsername).toBe("doomed.doc");
    expect(retained.find((r) => r.sourceTable === "phi_access_logs")).toBeTruthy();
  });

  it("rolls back everything when any step fails — never a half-deleted tenant", async () => {
    const { agent: dev } = await devLogin();
    const platformId = ctx.seedResult.platformOrgId;
    const { org, user } = await makeDoomedTenant();
    const convo = await ctx.storage.createConversation({
      organizationId: org.id, type: "direct", name: null, participantIds: [user.id], patientId: null,
    });
    const msg = await ctx.storage.createMessage({
      organizationId: org.id, conversationId: convo.id, senderId: user.id, content: "note", priority: "routine",
    });
    await ctx.storage.createMessageTemplate({
      organizationId: org.id, ownerUserId: user.id, title: "Personal", body: "t", priority: "routine",
    });
    await ctx.storage.appendAudit({
      organizationId: org.id, userId: user.id, action: "assignment.accept", resourceType: "assignment",
      resourceId: 1, details: {}, riskLevel: "medium",
    });
    const auditBefore = await ctx.storage.countAuditLogs(org.id);

    // A foreign-key the cascade cannot know about: another tenant's setting
    // row pointing at this tenant's user. The users delete — the LAST step —
    // must fail, and everything deleted before it must come back.
    await ctx.handle.db.insert(orgSettings).values({
      organizationId: ctx.seedResult.orgId, key: "blocker", value: 1, type: "number", updatedBy: user.id,
    });

    const res = await dev.delete("/api/dev/organizations/" + org.id + "?force=true");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("org_has_linked_records");

    // Nothing left the system.
    expect(await ctx.storage.getOrganization(org.id)).toBeTruthy();
    expect(await ctx.storage.getUserById(user.id)).toBeTruthy();
    expect(await ctx.handle.db.select().from(messages).where(eq(messages.id, msg.id))).toHaveLength(1);
    expect(
      await ctx.handle.db.select().from(messageTemplates).where(eq(messageTemplates.organizationId, org.id)),
    ).toHaveLength(1);
    expect(await ctx.storage.countAuditLogs(org.id)).toBe(auditBefore);
    // The archive copy was rolled back too (no duplicate history on retry).
    expect(await ctx.storage.countRetainedComplianceRecords(org.id)).toBe(0);
    // The failed attempt is itself on the record, at high risk, in the platform org.
    const failed = (await audit(platformId)).find((a) => a.action === "dev.org_delete_failed");
    expect(failed).toBeTruthy();
    expect(failed!.resourceId).toBe(org.id);

    // Once the blocker is gone the same delete succeeds — the org was never
    // left in an undeletable half-state.
    await ctx.handle.db.delete(orgSettings).where(eq(orgSettings.key, "blocker"));
    await dev.delete("/api/dev/organizations/" + org.id + "?force=true").expect(204);
    expect(await ctx.storage.getOrganization(org.id)).toBeUndefined();
    expect(await ctx.storage.countRetainedComplianceRecords(org.id)).toBeGreaterThanOrEqual(2);
  });
});
