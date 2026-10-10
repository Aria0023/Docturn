import type { Express } from "express";
import { MODULES, MODULE_IDS } from "@shared/modules";
import { appendAudit } from "../audit.js";
import { getModules, setModule } from "../modules.js";
import { buildCard, integrationForModule } from "../integrations/registry.js";
import { notReadyBody } from "./integrations.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";

/**
 * Feature modules — "add and remove functions with a click" from the developer
 * console. Enforcement lives in server/modules.ts (moduleGate); these routes
 * only READ the effective map and let a developer flip one switch per org.
 *
 *   GET   /api/modules                 any signed-in user → own org's map + registry
 *   GET   /api/dev/modules/:orgId      developer, or a director for THEIR org
 *   PATCH /api/dev/modules/:orgId      developer only  { id, enabled }
 */
export function registerModuleRoutes(app: Express) {
  app.get("/api/modules", requireAuth, async (req, res) => {
    const me = currentUser(req);
    res.json({
      orgId: me.organizationId,
      modules: await getModules(me.organizationId),
      registry: MODULES,
    });
  });

  app.get("/api/dev/modules/:orgId", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const orgId = Number(req.params.orgId);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: "validation_error" });
    // Directors may read their own org's switches; only developers see others.
    const canRead =
      me.role === "developer" ||
      ((me.role === "director" || me.role === "er_director") && me.organizationId === orgId);
    if (!canRead) return res.status(403).json({ error: "forbidden" });
    const org = await storage().getOrganization(orgId);
    if (!org) return res.status(404).json({ error: "not_found" });
    // A developer reading a tenant's switches is a cross-tenant read: one
    // ids-only row in that tenant's trail, before the read. A director's
    // own-org read is not.
    if (me.role === "developer") {
      await appendAudit({
        organizationId: orgId,
        userId: me.id,
        action: "dev.modules_read",
        resourceType: "organization",
        resourceId: orgId,
        details: { orgId },
        riskLevel: "low",
      });
    }
    res.json({ orgId, modules: await getModules(orgId), registry: MODULES });
  });

  app.patch(
    "/api/dev/modules/:orgId",
    requireAuth,
    requireRole("developer"),
    async (req, res) => {
      const me = currentUser(req);
      const orgId = Number(req.params.orgId);
      if (!Number.isFinite(orgId)) return res.status(400).json({ error: "validation_error" });
      const b = (req.body ?? {}) as { id?: unknown; enabled?: unknown };
      const id = typeof b.id === "string" ? b.id : "";
      if (!MODULE_IDS.includes(id)) return res.status(400).json({ error: "unknown_module" });
      if (typeof b.enabled !== "boolean") return res.status(400).json({ error: "validation_error" });
      const org = await storage().getOrganization(orgId);
      if (!org) return res.status(404).json({ error: "not_found" });
      // An integration's gating module follows the same rule as Settings →
      // Integrations: it cannot be switched ON while the integration is not
      // configured (or, for OpenAI, has no BAA attestation).
      const integration = integrationForModule(id);
      if (integration && b.enabled) {
        const card = await buildCard(storage(), integration, org);
        if (!card.canEnable) return res.status(409).json(notReadyBody(card));
      }

      const modules = await setModule(orgId, id, b.enabled, me.id);
      await appendAudit({
        organizationId: orgId,
        userId: me.id,
        action: "module.toggle",
        resourceType: "organization",
        resourceId: orgId,
        details: { orgId, id, enabled: b.enabled },
        riskLevel: "medium",
      });
      res.json({ orgId, modules, registry: MODULES });
    },
  );
}
