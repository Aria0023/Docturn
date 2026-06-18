import type { Express } from "express";
import { z } from "zod";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";

const orgSettingSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});
const userPrefSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});

export function registerSettingsRoutes(app: Express) {
  app.get("/api/settings", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const org = await storage().getOrganization(me.organizationId);
    res.json({
      org: {
        assignmentTimeoutMin: org?.assignmentTimeoutMin,
        roundRobinShiftTypes: org?.roundRobinShiftTypes,
        rotationMode: org?.rotationMode,
      },
    });
  });

  app.patch(
    "/api/settings/org",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = orgSettingSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      await storage().setOrgSetting(
        me.organizationId,
        parsed.data.key,
        parsed.data.value,
        me.id,
      );
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "settings.org_update",
        resourceType: "org_settings",
        resourceId: null,
        details: { key: parsed.data.key },
        riskLevel: "low",
      });
      res.json({ ok: true });
    },
  );

  app.patch("/api/settings/me", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = userPrefSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    await storage().setUserPreference(
      me.organizationId,
      me.id,
      parsed.data.key,
      parsed.data.value,
    );
    res.json({ ok: true });
  });
}
