import type { Express } from "express";
import { z } from "zod";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { statEscalationTimings } from "../services/escalation.js";
import { effectiveRetentionDays, RETENTION_MAX_DAYS } from "../services/retention.js";
import { storage } from "../storage.js";

/**
 * Org settings a director may write through PATCH /api/settings/org, each with
 * the shape the code that READS it expects. Anything else is rejected: this
 * route used to accept any key with any JSON value, which (a) let a fractional
 * or boolean messageRetentionDays reach the hourly purge and (b) let a director
 * overwrite developer-owned keys such as "modules" or "consultServices" that
 * have their own guarded routes.
 */
const ORG_SETTING_SCHEMAS: Record<string, z.ZodTypeAny> = {
  // 0 = retain indefinitely; otherwise whole days, at most ten years.
  messageRetentionDays: z.number().int().min(0).max(RETENTION_MAX_DAYS),
  autoReassignOnDecline: z.boolean(),
  statSmsFallback: z.boolean(),
};

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
    const autoReassignOnDecline =
      (await storage().getOrgSetting(me.organizationId, "autoReassignOnDecline")) === true;
    // Same interpretation as the sweep: an invalid stored value is reported as
    // 0 (not enforced) — never as a window the server is not actually applying.
    const messageRetentionDays = effectiveRetentionDays(
      await storage().getOrgSetting(me.organizationId, "messageRetentionDays"),
    );
    // STAT SMS fallback defaults ON; the operator/developer can disable it.
    const statSmsFallback =
      (await storage().getOrgSetting(me.organizationId, "statSmsFallback")) !== false;
    const stat = statEscalationTimings();
    const [dnd, coveringUserId, dashboardLayout] = await Promise.all([
      storage().getUserPreference(me.id, "dnd"),
      storage().getUserPreference(me.id, "coveringUserId"),
      storage().getUserPreference(me.id, "dashboardLayout"),
    ]);
    res.json({
      org: {
        assignmentTimeoutMin: org?.assignmentTimeoutMin,
        roundRobinShiftTypes: org?.roundRobinShiftTypes,
        rotationMode: org?.rotationMode,
        autoReassignOnDecline,
        messageRetentionDays,
        statSmsFallback,
        // When an unacknowledged STAT is re-alerted / escalated to the covering
        // provider — exactly what the sweep applies (A.CON-MIN-18 countdown).
        // Whether it runs at all is the messaging.escalation module.
        statRealertMs: stat.realertMs,
        statEscalateMs: stat.escalateMs,
      },
      me: {
        dnd: dnd === true,
        coveringUserId:
          typeof coveringUserId === "number" ? coveringUserId : null,
        // Per-user dashboard customization (panel + stat-tile layout), synced
        // across devices. Arbitrary JSON blob; null until the user customizes.
        dashboardLayout:
          dashboardLayout && typeof dashboardLayout === "object"
            ? dashboardLayout
            : null,
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
      const schema = ORG_SETTING_SCHEMAS[parsed.data.key];
      if (!schema) return res.status(400).json({ error: "unknown_setting", key: parsed.data.key });
      const value = schema.safeParse(parsed.data.value);
      if (!value.success) return res.status(400).json({ error: "validation_error", key: parsed.data.key });
      await storage().setOrgSetting(
        me.organizationId,
        parsed.data.key,
        value.data,
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
