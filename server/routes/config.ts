import type { Express } from "express";
import { z } from "zod";
import { appendAudit } from "../audit.js";
import { invalidateConfig } from "../config.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { analyze } from "../services/suggestions.js";
import { storage } from "../storage.js";

const flagSchema = z.object({
  flag: z.string().min(1),
  enabled: z.boolean(),
  variant: z.string().optional(),
});

// C2 feature flags + C3 adaptive suggestions.
export function registerConfigRoutes(app: Express) {
  // ── Feature flags ──────────────────────────────────────────────────────────
  app.get(
    "/api/feature-flags",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      res.json(await storage().listFeatureFlags(me.organizationId));
    },
  );

  app.patch(
    "/api/feature-flags",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = flagSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      await storage().setFeatureFlag(
        me.organizationId,
        parsed.data.flag,
        parsed.data.enabled,
        parsed.data.variant,
      );
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "feature_flag.set",
        resourceType: "feature_flag",
        resourceId: null,
        details: { flag: parsed.data.flag, enabled: parsed.data.enabled },
        riskLevel: "low",
      });
      res.json({ ok: true });
    },
  );

  // ── Adaptive suggestions ────────────────────────────────────────────────────
  app.get(
    "/api/suggestions",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      // Refresh proposals on read (cheap; read-only analysis).
      await analyze(storage(), me.organizationId);
      res.json(await storage().listSuggestions(me.organizationId));
    },
  );

  app.post(
    "/api/suggestions/:id/accept",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const id = Number(req.params.id);
      const s = await storage().getSuggestion(me.organizationId, id);
      if (!s || s.status !== "pending") {
        return res.status(404).json({ error: "not_found" });
      }
      // Apply the proposal to org config / settings, audited.
      if (s.key === "assignment_timeout") {
        const value = Number(s.proposedValue);
        await storage().updateOrganization(me.organizationId, {
          assignmentTimeoutMin: value,
        });
      } else {
        await storage().setOrgSetting(
          me.organizationId,
          s.key,
          s.proposedValue,
          me.id,
        );
      }
      invalidateConfig(me.organizationId);
      await storage().setSuggestionStatus(me.organizationId, id, "accepted");
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "suggestion.accept",
        resourceType: "suggestion",
        resourceId: id,
        details: { key: s.key, value: s.proposedValue },
        riskLevel: "low",
      });
      res.json({ ok: true });
    },
  );

  app.post(
    "/api/suggestions/:id/dismiss",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const id = Number(req.params.id);
      await storage().setSuggestionStatus(me.organizationId, id, "dismissed");
      res.json({ ok: true });
    },
  );
}
