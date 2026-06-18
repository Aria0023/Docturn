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
    res.json({
      assignmentTimeoutMin: org.assignmentTimeoutMin,
      roundRobinShiftTypes: org.roundRobinShiftTypes,
      rotationMode: org.rotationMode,
      rotationIndex: org.rotationIndex,
      timezone: org.timezone,
    });
  });

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
