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
        assignmentTimeoutMin: Number(b.assignmentTimeoutMin) || 10,
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
      const userCount = await storage().countOrgUsers(id);
      if (userCount > 0) {
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

  // Cross-tenant user/specialist creation (v2).
  app.post(
    "/api/dev/users",
    requireAuth,
    requireRole("developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = devCreateUserSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const d = parsed.data;
      const org = await storage().getOrganization(d.organizationId);
      if (!org) return res.status(404).json({ error: "organization_not_found" });

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
      const tempHash = await hashPassword(
        Math.random().toString(36).slice(2),
      );
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
          working: false,
          shiftType: d.shiftType ?? "day",
        });
      }
      res.status(201).json(toSafeUser(user));
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
