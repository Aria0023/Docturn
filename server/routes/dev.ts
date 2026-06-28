import type { Express } from "express";
import { devCreateUserSchema, toSafeUser } from "@shared/schema";
import { hashPassword } from "../auth.js";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { getExtractor } from "../services/ai-intake.js";
import { codeFromName, lookupHospitals } from "../services/hospital-lookup.js";
import { storage } from "../storage.js";

/**
 * Developer console: cross-tenant administration. The developer role bypasses
 * org-scoping deliberately; EVERY cross-tenant action is audited before/with it.
 */
export function registerDevRoutes(app: Express) {
  // Web-powered hospital autocomplete: "Cedars Sinai" -> official name + city +
  // state + timezone + a suggested code (NPI registry, curated fallback).
  app.get(
    "/api/dev/org-lookup",
    requireAuth,
    requireRole("developer"),
    async (req, res) => {
      const q = String(req.query.q ?? "");
      res.json(await lookupHospitals(q));
    },
  );

  app.get(
    "/api/dev/organizations",
    requireAuth,
    requireRole("developer"),
    async (_req, res) => {
      const orgs = await storage().listOrganizations();
      const withCounts = await Promise.all(
        orgs.map(async (o) => ({
          ...o,
          userCount: await storage().countOrgUsers(o.id),
        })),
      );
      res.json(withCounts);
    },
  );

  app.post(
    "/api/dev/organizations",
    requireAuth,
    requireRole("developer"),
    async (req, res) => {
      const me = currentUser(req);
      const b = req.body ?? {};
      if (!b.name) return res.status(400).json({ error: "validation_error" });
      const code = String(b.code || codeFromName(b.name)).toUpperCase();
      const existing = await storage().getOrganizationByCode(code);
      if (existing) return res.status(409).json({ error: "code_taken" });
      const org = await storage().createOrganization({
        name: String(b.name),
        code,
        city: b.city ?? null,
        state: b.state ?? null,
        timezone: b.timezone || "America/New_York",
        assignmentTimeoutMin: Number(b.assignmentTimeoutMin) || 15,
        roundRobinShiftTypes: Array.isArray(b.roundRobinShiftTypes)
          ? b.roundRobinShiftTypes
          : ["day", "night"],
        rotationMode: b.rotationMode === "sequential" ? "sequential" : "lowest_census",
        rotationIndex: 0,
      });
      await appendAudit({
        organizationId: org.id,
        userId: me.id,
        action: "dev.org_create",
        resourceType: "organization",
        resourceId: org.id,
        details: { code: org.code, name: org.name },
        riskLevel: "medium",
      });
      res.status(201).json(org);
    },
  );

  app.delete(
    "/api/dev/organizations/:id",
    requireAuth,
    requireRole("developer"),
    async (req, res) => {
      const me = currentUser(req);
      const id = Number(req.params.id);
      const org = await storage().getOrganization(id);
      if (!org) return res.status(404).json({ error: "not_found" });
      // Never let a developer delete the org their own account lives in — it
      // would destroy the session they're acting with.
      if (id === me.organizationId) {
        return res.status(409).json({ error: "cannot_delete_own_org" });
      }
      // `force` (Danger Zone, type-to-confirm) cascades users + all tenant data.
      // Without it, deleting a non-empty org is refused.
      const force = req.query.force === "true" || req.body?.force === true;
      const userCount = await storage().countOrgUsers(id);
      if (userCount > 0 && !force) {
        return res
          .status(409)
          .json({ error: "org_not_empty", users: userCount });
      }
      try {
        await storage().deleteOrganization(id);
      } catch (err) {
        console.error("[dev] org delete failed", err);
        return res.status(409).json({ error: "org_has_linked_records" });
      }
      await appendAudit({
        organizationId: null,
        userId: me.id,
        action: "dev.org_delete",
        resourceType: "organization",
        resourceId: id,
        details: { code: org.code },
        riskLevel: "high",
      });
      res.status(204).end();
    },
  );

  // Edit / rename a tenant.
  app.patch(
    "/api/dev/organizations/:id",
    requireAuth,
    requireRole("developer"),
    async (req, res) => {
      const me = currentUser(req);
      const id = Number(req.params.id);
      const b = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if (typeof b.name === "string") patch.name = b.name;
      if (typeof b.code === "string") patch.code = b.code.toUpperCase();
      if (typeof b.city === "string") patch.city = b.city;
      if (typeof b.state === "string") patch.state = b.state;
      if (typeof b.timezone === "string") patch.timezone = b.timezone;
      if (b.assignmentTimeoutMin != null)
        patch.assignmentTimeoutMin = Number(b.assignmentTimeoutMin);
      if (Array.isArray(b.roundRobinShiftTypes))
        patch.roundRobinShiftTypes = b.roundRobinShiftTypes;
      if (b.rotationMode === "sequential" || b.rotationMode === "lowest_census")
        patch.rotationMode = b.rotationMode;
      const updated = await storage().updateOrganization(id, patch);
      if (!updated) return res.status(404).json({ error: "not_found" });
      await appendAudit({
        organizationId: id,
        userId: me.id,
        action: "dev.org_update",
        resourceType: "organization",
        resourceId: id,
        details: patch,
        riskLevel: "medium",
      });
      res.json(updated);
    },
  );

  // Per-organization rule settings (individualized), read by the developer's
  // org-detail page. Combines the organization columns (timeout, rotation) with
  // org-scoped key/value settings (auto-reassign, retention) and a compliance
  // summary, so each tenant carries its own preferences.
  const ORG_SETTING_KEYS = ["autoReassignOnDecline", "autoCleanHours"] as const;
  app.get(
    "/api/dev/organizations/:id/settings",
    requireAuth,
    requireRole("developer"),
    async (req, res) => {
      const id = Number(req.params.id);
      const org = await storage().getOrganization(id);
      if (!org) return res.status(404).json({ error: "not_found" });
      const settings: Record<string, unknown> = {};
      for (const k of ORG_SETTING_KEYS) {
        const v = await storage().getOrgSetting(id, k);
        settings[k] = v === undefined ? null : v;
      }
      const [audit, phi] = await Promise.all([
        storage().listAuditLogs(id, 100),
        storage().countPhiAccess(id),
      ]);
      res.json({
        org: {
          id: org.id,
          code: org.code,
          name: org.name,
          assignmentTimeoutMin: org.assignmentTimeoutMin,
          rotationMode: org.rotationMode,
          roundRobinShiftTypes: org.roundRobinShiftTypes,
        },
        settings,
        compliance: { auditCount: audit.length, phiCount: phi },
      });
    },
  );

  // A tenant's real audit + PHI trail (developer views ANY org's compliance).
  app.get(
    "/api/dev/organizations/:id/audit",
    requireAuth,
    requireRole("developer"),
    async (req, res) => {
      const id = Number(req.params.id);
      const org = await storage().getOrganization(id);
      if (!org) return res.status(404).json({ error: "not_found" });
      const [audit, phi] = await Promise.all([
        storage().listAuditLogs(id, 100),
        storage().listPhiAccess(id, 50),
      ]);
      res.json({ org: { code: org.code }, audit, phiAccess: phi });
    },
  );

  // Persist a per-organization rule setting (developer edits ANY tenant).
  app.patch(
    "/api/dev/organizations/:id/settings",
    requireAuth,
    requireRole("developer"),
    async (req, res) => {
      const me = currentUser(req);
      const id = Number(req.params.id);
      const org = await storage().getOrganization(id);
      if (!org) return res.status(404).json({ error: "not_found" });
      const b = req.body ?? {};
      if (typeof b.key !== "string" || !ORG_SETTING_KEYS.includes(b.key)) {
        return res.status(400).json({ error: "validation_error" });
      }
      await storage().setOrgSetting(id, b.key, b.value, me.id);
      await appendAudit({
        organizationId: id,
        userId: me.id,
        action: "dev.org_setting",
        resourceType: "organization",
        resourceId: id,
        details: { key: b.key, value: b.value },
        riskLevel: "medium",
      });
      res.json({ ok: true, key: b.key, value: b.value });
    },
  );

  // Cross-tenant user/specialist creation (v2).
  app.get(
    "/api/dev/users",
    requireAuth,
    requireRole("developer"),
    async (_req, res) => {
      const [allUsers, orgs, hosps] = await Promise.all([
        storage().listAllUsers(),
        storage().listOrganizations(),
        storage().listAllHospitalists(),
      ]);
      const orgCode = new Map(orgs.map((o) => [o.id, o.code]));
      const specByUser = new Map(hosps.map((h) => [h.userId, h.specialty]));
      res.json(
        allUsers.map((u) => ({
          id: u.id,
          name: u.displayName,
          role: u.role,
          org: orgCode.get(u.organizationId) ?? "—",
          specialty: specByUser.get(u.id) ?? "",
          credential: u.credential,
        })),
      );
    },
  );

  app.delete(
    "/api/dev/users/:id",
    requireAuth,
    requireRole("developer"),
    async (req, res) => {
      const me = currentUser(req);
      const id = Number(req.params.id);
      if (id === me.id) return res.status(409).json({ error: "cannot_delete_self" });
      const target = await storage().getUserById(id);
      if (!target) return res.status(404).json({ error: "not_found" });
      await appendAudit({
        organizationId: target.organizationId,
        userId: me.id,
        action: "dev.user_delete",
        resourceType: "user",
        resourceId: id,
        details: { username: target.username },
        riskLevel: "high",
      });
      try {
        await storage().deleteUser(id);
      } catch (err) {
        console.error("[dev] user delete failed", err);
        return res.status(409).json({ error: "user_has_activity" });
      }
      res.status(204).end();
    },
  );

  app.post(
    "/api/dev/users",
    requireAuth,
    requireRole("developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = devCreateUserSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const d = parsed.data;
      try {
        const org = await storage().getOrganization(d.organizationId);
        if (!org) return res.status(404).json({ error: "organization_not_found" });

        // Username must be unique within the org — return a clean 409 instead of
        // letting the DB unique constraint throw (which would otherwise hang the
        // request, since an unhandled async error never sends a response).
        const dup = await storage().getUserByUsername(d.organizationId, d.username);
        if (dup) return res.status(409).json({ error: "username_taken" });

        // Audit the cross-tenant write before performing it.
        await appendAudit({
          organizationId: d.organizationId,
          userId: me.id,
          action: "dev.user_create",
          resourceType: "user",
          resourceId: null,
          details: { role: d.role, displayName: d.displayName },
          riskLevel: "medium",
        });

        // Temporary credential issued out-of-band; here we set a random hash.
        const tempHash = await hashPassword(Math.random().toString(36).slice(2));
        const user = await storage().createUser({
          organizationId: d.organizationId,
          username: d.username,
          passwordHash: tempHash,
          role: d.role,
          displayName: d.displayName,
          credential: d.credential ?? null,
          phone: d.phone ?? null,
          twoFactorEnabled: false,
        });

        if (d.role === "hospitalist") {
          const existing = await storage().listHospitalists(d.organizationId);
          await storage().createHospitalist({
            organizationId: d.organizationId,
            userId: user.id,
            specialty: d.specialty ?? "General",
            currentPatientCount: 0,
            patientCap: d.patientCap ?? 12,
            rotationOrder: existing.length,
            working: d.working ?? false,
            shiftType: d.shiftType ?? "day",
          });
        }
        res.status(201).json(toSafeUser(user));
      } catch (err) {
        console.error("[dev] create user failed", err);
        if (!res.headersSent) res.status(500).json({ error: "create_failed" });
      }
    },
  );

  // Audited impersonation (session swap).
  app.post(
    "/api/dev/impersonate",
    requireAuth,
    requireRole("developer"),
    async (req, res, next) => {
      const me = currentUser(req);
      const targetId = Number(req.body?.userId);
      const target = await storage().getUserById(targetId);
      if (!target) return res.status(404).json({ error: "not_found" });
      await appendAudit({
        organizationId: target.organizationId,
        userId: me.id,
        action: "dev.impersonate",
        resourceType: "user",
        resourceId: target.id,
        details: { from: me.id, to: target.id },
        riskLevel: "high",
      });
      req.login(target as unknown as Express.User, (err) => {
        if (err) return next(err);
        res.json(toSafeUser(target));
      });
    },
  );

  // Enter an organization's context as its senior admin (audited session swap)
  // so the developer gets that tenant's FULL portal — board, compliance,
  // directory, approvals, settings — all individualized to that org.
  app.post(
    "/api/dev/manage-org",
    requireAuth,
    requireRole("developer"),
    async (req, res, next) => {
      const me = currentUser(req);
      const orgId = Number(req.body?.orgId);
      const org = await storage().getOrganization(orgId);
      if (!org) return res.status(404).json({ error: "not_found" });
      const users = await storage().listUsers(orgId);
      // Prefer the broadest admin surface available in the tenant.
      const order = ["director", "er_director", "er_doctor", "hospitalist"];
      let admin = null;
      for (const role of order) {
        admin = users.find((u) => u.role === role) || null;
        if (admin) break;
      }
      if (!admin) admin = users[0] || null;
      if (!admin) return res.status(409).json({ error: "no_admin", message: "This organization has no users to manage as." });
      await appendAudit({
        organizationId: orgId,
        userId: me.id,
        action: "dev.manage_org",
        resourceType: "organization",
        resourceId: orgId,
        details: { as: admin.id, role: admin.role },
        riskLevel: "high",
      });
      req.login(admin as unknown as Express.User, (err) => {
        if (err) return next(err);
        res.json({ ...toSafeUser(admin), orgCode: org.code, orgName: org.name });
      });
    },
  );

  app.get(
    "/api/dev/ai-diagnostics",
    requireAuth,
    requireRole("developer"),
    async (_req, res) => {
      const sample = await getExtractor().extract(
        "Patient J.D. in room 204 with chest pain",
      );
      res.json({
        extractor: getExtractor().constructor.name,
        liveAi: !!process.env.OPENAI_API_KEY,
        sample,
      });
    },
  );
}
