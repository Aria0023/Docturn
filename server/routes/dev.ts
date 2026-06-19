import type { Express } from "express";
import { devCreateUserSchema, toSafeUser } from "@shared/schema";
import { hashPassword } from "../auth.js";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { getExtractor } from "../services/ai-intake.js";
import { storage } from "../storage.js";

/**
 * Developer console: cross-tenant administration. The developer role bypasses
 * org-scoping deliberately; EVERY cross-tenant action is audited before/with it.
 */
export function registerDevRoutes(app: Express) {
  app.get(
    "/api/dev/organizations",
    requireAuth,
    requireRole("developer"),
    async (_req, res) => {
      res.json(await storage().listOrganizations());
    },
  );

  app.post(
    "/api/dev/organizations",
    requireAuth,
    requireRole("developer"),
    async (req, res) => {
      const me = currentUser(req);
      const { name, code } = req.body ?? {};
      if (!name || !code) return res.status(400).json({ error: "validation_error" });
      const org = await storage().createOrganization({
        name,
        code: String(code).toUpperCase(),
        timezone: "America/New_York",
        assignmentTimeoutMin: 10,
        roundRobinShiftTypes: ["day", "night"],
        rotationMode: "lowest_census",
        rotationIndex: 0,
      });
      await appendAudit({
        organizationId: org.id,
        userId: me.id,
        action: "dev.org_create",
        resourceType: "organization",
        resourceId: org.id,
        details: { code: org.code },
        riskLevel: "medium",
      });
      res.status(201).json(org);
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
      const patch: Record<string, unknown> = {};
      if (typeof req.body?.name === "string") patch.name = req.body.name;
      if (typeof req.body?.timezone === "string") patch.timezone = req.body.timezone;
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
