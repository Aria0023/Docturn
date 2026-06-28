import type { Express } from "express";
import { orgConfigSchema } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";

export function registerOrgRoutes(app: Express) {
  app.get("/api/org/config", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const org = await storage().getOrganization(me.organizationId);
    if (!org) return res.status(404).json({ error: "not_found" });
    // Per-organization preferences (individualized): consult-service catalog and
    // appearance/theme live in org settings so each tenant has its own.
    const [consultServices, theme] = await Promise.all([
      storage().getOrgSetting(me.organizationId, "consultServices"),
      storage().getOrgSetting(me.organizationId, "theme"),
    ]);
    res.json({
      assignmentTimeoutMin: org.assignmentTimeoutMin,
      roundRobinShiftTypes: org.roundRobinShiftTypes,
      rotationMode: org.rotationMode,
      rotationIndex: org.rotationIndex,
      timezone: org.timezone,
      consultServices: consultServices ?? null,
      theme: theme ?? null,
    });
  });

  // Per-organization preferences: consult-service catalog + appearance/theme.
  // Each is stored per tenant, so editing one org never affects another.
  app.patch(
    "/api/org/preferences",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const b = req.body ?? {};
      const changed: string[] = [];
      if (Array.isArray(b.consultServices)) {
        await storage().setOrgSetting(me.organizationId, "consultServices", b.consultServices, me.id);
        changed.push("consultServices");
      }
      if (b.theme && typeof b.theme === "object") {
        await storage().setOrgSetting(me.organizationId, "theme", b.theme, me.id);
        changed.push("theme");
      }
      if (!changed.length) return res.status(400).json({ error: "validation_error" });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "org.preferences_update",
        resourceType: "organization",
        resourceId: me.organizationId,
        details: { changed },
        riskLevel: "low",
      });
      res.json({ ok: true, changed });
    },
  );

  app.patch(
    "/api/org/config",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = orgConfigSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const updated = await storage().updateOrganization(
        me.organizationId,
        parsed.data,
      );
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "org.config_update",
        resourceType: "organization",
        resourceId: me.organizationId,
        details: parsed.data,
        riskLevel: "low",
      });
      res.json(updated);
    },
  );
}
