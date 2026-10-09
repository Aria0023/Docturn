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
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { invalidateModules, setModule } from "../server/modules.js";
import { syncAmion } from "../server/services/amion.js";

const MFA_MODULE = "security.mfaRequired";

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
      // The account-lifecycle list hands a developer EVERY tenant's workforce
      // (username, role, credential, disabled, must-change) — the same data as
      // /api/dev/users, so the same ids-only row (fix-up of A.CON-SHO-9).
      { path: "/api/accounts", action: "dev.users_list", org: platformId },
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

  it("GET /api/accounts is a cross-tenant read for a developer only", async () => {
    const orgId = ctx.seedResult.orgId;
    const platformId = ctx.seedResult.platformOrgId;
    const devId = ctx.seedResult.userIds.dev!;

    // A developer gets every tenant's accounts → audited in the platform org.
    const { agent: dev } = await devLogin();
    const before = await ctx.storage.countAuditLogs(platformId);
    const all = await dev.get("/api/accounts").expect(200);
    const orgsSeen = new Set((all.body as Array<{ org: string }>).map((u) => u.org));
    expect(orgsSeen.size).toBeGreaterThan(1); // really cross-tenant
    expect(await ctx.storage.countAuditLogs(platformId)).toBe(before + 1);
    const row = (await audit(platformId)).find((a) => a.action === "dev.users_list");
    expect(row).toBeTruthy();
    expect(row!.userId).toBe(devId);
    expect(row!.organizationId).toBe(platformId);
    expect(row!.resourceId).toBeNull();

    // A director's list of their OWN org is not cross-tenant: no row.
    const { agent: director } = await login(ctx.app, { username: "director" });
    const ownBefore = await ctx.storage.countAuditLogs(orgId);
    const platformBefore = await ctx.storage.countAuditLogs(platformId);
    const own = await director.get("/api/accounts").expect(200);
    expect(new Set((own.body as Array<{ org: string }>).map((u) => u.org))).toEqual(new Set(["ISPN"]));
    expect(await ctx.storage.countAuditLogs(orgId)).toBe(ownBefore);
    expect(await ctx.storage.countAuditLogs(platformId)).toBe(platformBefore);
  });

  it("GET /api/amion/status is a cross-tenant read for a developer outside the Amion org", async () => {
    // The Amion snapshot is the configured tenant's provider schedule (names,
    // slots, hours, shift, secure-messaging flag). getAmionStatus lets a
    // developer of ANY org read it, so that read is audited like
    // /api/dev/modules/:orgId: one ids-only row in the Amion org's own trail,
    // before the read, so its director sees the platform looked.
    const orgId = ctx.seedResult.orgId;
    const platformId = ctx.seedResult.platformOrgId;
    const devId = ctx.seedResult.userIds.dev!;
    const feed = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        [
          "Assignment\tHours\tStaff\tDivision\tMessaging",
          "Tarzana 1\t7a-7p\tChen, Lisa\tISP North\tSecure message to Amion app",
          "Tarzana Night\t7p-7a\tPatel, Raj\tISP North\tNot ready to receive secure messages",
          "",
        ].join("\n"),
      );
    });
    await new Promise<void>((r) => feed.listen(0, "127.0.0.1", () => r()));
    const saved = { url: process.env.AMION_OCS_URL, code: process.env.AMION_ORG_CODE };
    process.env.AMION_OCS_URL = `http://127.0.0.1:${(feed.address() as AddressInfo).port}/ocs?Lo=t`;
    process.env.AMION_ORG_CODE = "ISPN";
    try {
      await syncAmion(ctx.storage);
      const { agent: dev } = await devLogin();
      const { agent: director } = await login(ctx.app, { username: "director" });

      const tenantBefore = new Set((await audit(orgId)).map((a) => a.id));
      const platformBefore = await ctx.storage.countAuditLogs(platformId);
      const st = await dev.get("/api/amion/status").expect(200);
      expect(st.body.configured).toBe(true);
      expect(st.body.providers).toHaveLength(2); // really the tenant's schedule
      const fresh = (await audit(orgId)).filter((a) => !tenantBefore.has(a.id));
      expect(fresh).toHaveLength(1);
      const row = fresh[0]!;
      expect(row.action).toBe("dev.amion_status_read");
      expect(row.userId).toBe(devId);
      expect(row.organizationId).toBe(orgId);
      expect(row.resourceType).toBe("organization");
      expect(row.resourceId).toBe(orgId);
      expect(row.riskLevel).toBe("low");
      for (const [k, v] of Object.entries(row.details ?? {})) {
        expect(typeof v === "number" || v === null, "details." + k).toBe(true);
      }
      expect(JSON.stringify(row.details)).not.toMatch(/Chen|Patel|Tarzana/);
      // Filed in the tenant's trail only — the platform trail is unchanged.
      expect(await ctx.storage.countAuditLogs(platformId)).toBe(platformBefore);
      // The tenant's director sees it in their own audit view.
      const trail = await director.get("/api/audit").expect(200);
      expect((trail.body.audit as Array<{ id: number }>).some((a) => a.id === row.id)).toBe(true);

      // The Amion org's own director reading their feed is not cross-tenant.
      const ownBefore = await ctx.storage.countAuditLogs(orgId);
      const own = await director.get("/api/amion/status").expect(200);
      expect(own.body.providers).toHaveLength(2);
      expect(await ctx.storage.countAuditLogs(orgId)).toBe(ownBefore);

      // Feed configured for a code with no tenant: nothing is read, no row.
      process.env.AMION_ORG_CODE = "NOPE";
      const noneBefore = (await ctx.storage.countAuditLogs(orgId)) + (await ctx.storage.countAuditLogs(platformId));
      const none = await dev.get("/api/amion/status").expect(200);
      expect(none.body.configured).toBe(false);
      expect((await ctx.storage.countAuditLogs(orgId)) + (await ctx.storage.countAuditLogs(platformId))).toBe(
        noneBefore,
      );

      // Feed not configured at all: nothing is read, no row.
      delete process.env.AMION_OCS_URL;
      process.env.AMION_ORG_CODE = "ISPN";
      const offBefore = await ctx.storage.countAuditLogs(orgId);
      const off = await dev.get("/api/amion/status").expect(200);
      expect(off.body.configured).toBe(false);
      expect(await ctx.storage.countAuditLogs(orgId)).toBe(offBefore);
    } finally {
      feed.close();
      if (saved.url === undefined) delete process.env.AMION_OCS_URL;
      else process.env.AMION_OCS_URL = saved.url;
      if (saved.code === undefined) delete process.env.AMION_ORG_CODE;
      else process.env.AMION_ORG_CODE = saved.code;
    }
  });

  it("a refused read (unknown tenant, malformed id) writes no row", async () => {
    const { agent: dev } = await devLogin();
    const platformId = ctx.seedResult.platformOrgId;
    const before = await ctx.storage.countAuditLogs(platformId);
    await dev.get("/api/dev/organizations/999999/settings").expect(404);
    await dev.get("/api/dev/organizations/999999/audit").expect(404);
    // Malformed path id: the app-wide :id guard (server/params.ts) answers
    // 404 not_found before the handler — and before any audit row.
    await dev.get("/api/dev/organizations/abc/audit").expect(404, { error: "not_found" });
    // Malformed QUERY id is the handler's own validation.
    await dev.get("/api/dev/compliance-archive?orgId=99999999999").expect(400);
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

  /* The way back must survive the borrowed account's own gates (fix-up). A
     freshly provisioned account still holds its one-time password, and a
     privileged account in an org that requires MFA may not have enrolled:
     both gates 403 every route but their exemptions, and before the fix that
     included POST /api/dev/impersonate/stop — the developer could only sign
     out and back in by hand. */

  const leaveAndCheck = async (
    dev: Awaited<ReturnType<typeof devLogin>>["agent"],
    orgId: number,
    borrowedId: number,
  ) => {
    const devId = ctx.seedResult.userIds.dev!;
    const back = await dev.post("/api/dev/impersonate/stop").send({});
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.id).toBe(devId);
    expect(back.body.role).toBe("developer");
    expect(back.body.mfaEnrollmentRequired).toBeUndefined(); // the developer's own org does not require it
    expect((await dev.get("/api/user").expect(200)).body.id).toBe(devId);
    await dev.get("/api/dev/organizations").expect(200); // a working developer session again
    const stop = (await audit(orgId)).find(
      (a) => a.action === "dev.impersonate_stop" && a.resourceId === borrowedId,
    );
    expect(stop, "stop not audited").toBeTruthy();
    expect(stop!.userId).toBe(devId);
    // Leaving twice is still refused: the exemption opens only a real exit.
    await dev.post("/api/dev/impersonate/stop").send({}).expect(400, { error: "not_impersonating" });
  };

  it("returns to the developer from an account that must still change its one-time password", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: dev } = await devLogin();
    const made = await dev
      .post("/api/dev/users")
      .send({ organizationId: orgId, role: "director", displayName: "Fresh Director", username: "fresh.director" })
      .expect(201);
    expect(made.body.mustChangePassword).toBe(true);

    const enter = await dev.post("/api/dev/impersonate").send({ userId: made.body.id }).expect(200);
    expect(enter.body.mustChangePassword).toBe(true);
    // The borrowed identity is held exactly as its owner would be…
    await dev.get("/api/hospitalists").expect(403, { error: "password_change_required" });
    // …but the developer can always leave, without a password.
    await leaveAndCheck(dev, orgId, made.body.id);
  });

  it("returns to the developer from a managed brand-new tenant whose only admin is still provisional", async () => {
    const { agent: dev } = await devLogin();
    const org = await ctx.storage.createOrganization({
      name: "RPG General",
      code: "RPG",
      city: null,
      state: null,
      timezone: "America/New_York",
      assignmentTimeoutMin: 10,
      roundRobinShiftTypes: ["day", "night"],
      rotationMode: "lowest_census",
      rotationIndex: 0,
    });
    const first = await dev
      .post("/api/dev/users")
      .send({ organizationId: org.id, role: "director", displayName: "RPG Director", username: "rpg.director" })
      .expect(201);
    const enter = await dev.post("/api/dev/manage-org").send({ orgId: org.id }).expect(200);
    expect(enter.body.id).toBe(first.body.id);
    expect(enter.body.mustChangePassword).toBe(true);
    await dev.get("/api/settings/org").expect(403, { error: "password_change_required" });
    await leaveAndCheck(dev, org.id, first.body.id);
  });

  it("returns to the developer from a privileged account that has not enrolled the MFA its org requires", async () => {
    const orgId = ctx.seedResult.orgId;
    const directorId = ctx.seedResult.userIds.director!;
    await setModule(orgId, MFA_MODULE, true);
    try {
      const { agent: dev } = await devLogin();
      const enter = await dev.post("/api/dev/impersonate").send({ userId: directorId }).expect(200);
      // The entry answer already says where the borrowed session stands.
      expect(enter.body.mfaEnrollmentRequired).toBe(true);
      await dev.get("/api/hospitalists").expect(403, { error: "mfa_enrollment_required" });
      await leaveAndCheck(dev, orgId, directorId);

      // Same through the managed-org door.
      const managed = await dev.post("/api/dev/manage-org").send({ orgId }).expect(200);
      expect(managed.body.role).toBe("director");
      expect(managed.body.mfaEnrollmentRequired).toBe(true);
      await dev.get("/api/settings/org").expect(403, { error: "mfa_enrollment_required" });
      await leaveAndCheck(dev, orgId, directorId);
    } finally {
      invalidateModules();
    }
  });

  it("the exemption is only the exit: gated sessions stay gated, and the developer's own gate still applies", async () => {
    const orgId = ctx.seedResult.orgId;
    const platformId = ctx.seedResult.platformOrgId;
    await setModule(orgId, MFA_MODULE, true);
    try {
      // A gated director who is NOT impersonating gets a 400, not a way in.
      const { agent: director } = await login(ctx.app, { username: "director" });
      await director.post("/api/dev/impersonate/stop").send({}).expect(400, { error: "not_impersonating" });
      await director.get("/api/hospitalists").expect(403, { error: "mfa_enrollment_required" });

      // The platform org starts requiring MFA while the developer is inside a
      // portal: leaving still works, the answer says the developer must now
      // enrol, and the developer's session is held by its OWN gate.
      const { agent: dev } = await devLogin();
      await dev.post("/api/dev/impersonate").send({ userId: ctx.seedResult.userIds.chen! }).expect(200);
      await setModule(platformId, MFA_MODULE, true);
      const back = await dev.post("/api/dev/impersonate/stop").send({}).expect(200);
      expect(back.body.role).toBe("developer");
      expect(back.body.mfaEnrollmentRequired).toBe(true);
      await dev.get("/api/dev/organizations").expect(403, { error: "mfa_enrollment_required" });
    } finally {
      invalidateModules();
    }
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
