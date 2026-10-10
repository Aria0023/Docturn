import type { Express } from "express";
import { consultServicesArraySchema, orgConfigSchema, orgThemePatchSchema } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { broadcastRotationChange } from "../services/notifications.js";
import { storage } from "../storage.js";
import { catalogOf, CONSULT_KEY, CONSULT_REV_KEY, revOf } from "./consult-services.js";

export function registerOrgRoutes(app: Express) {
  app.get("/api/org/config", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const org = await storage().getOrganization(me.organizationId);
    if (!org) return res.status(404).json({ error: "not_found" });
    // Per-organization preferences (individualized): consult-service catalog and
    // appearance/theme live in org settings so each tenant has its own.
    const [consultServices, consultRev, theme] = await Promise.all([
      storage().getOrgSetting(me.organizationId, CONSULT_KEY),
      storage().getOrgSetting(me.organizationId, CONSULT_REV_KEY),
      storage().getOrgSetting(me.organizationId, "theme"),
    ]);
    res.json({
      // The caller's own organization's identity (Settings header). Editing
      // it is developer-only (PATCH /api/dev/organizations/:id).
      name: org.name,
      code: org.code,
      assignmentTimeoutMin: org.assignmentTimeoutMin,
      roundRobinShiftTypes: org.roundRobinShiftTypes,
      rotationMode: org.rotationMode,
      rotationIndex: org.rotationIndex,
      timezone: org.timezone,
      consultServices: consultServices ?? null,
      // Revision of the catalog: a whole-catalog PATCH must quote it
      // (consultServicesVersion) or it is refused as stale (409).
      consultServicesVersion: revOf(consultRev),
      theme: theme ?? null,
    });
  });

  // Per-organization preferences: consult-service catalog + appearance/theme.
  // Each is stored per tenant, so editing one org never affects another.
  //   theme            validated (orgThemePatchSchema) and MERGED key by key
  //                    into the stored theme under a row lock, so an admin who
  //                    changes the accent never undoes another admin's radius.
  //                    Gated by platform.appearance (server/modules.ts).
  //   consultServices  the legacy whole-catalog replace (director / developer
  //                    only — it can remove services). The screens edit one
  //                    item at a time (server/routes/consult-services.ts); a
  //                    caller replacing the whole list may quote the revision it
  //                    read (consultServicesVersion) and is refused with 409
  //                    and the current list when it is stale.
  app.patch(
    "/api/org/preferences",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const b = req.body ?? {};
      const hasCatalog = b.consultServices !== undefined;
      const hasTheme = b.theme !== undefined;
      if (!hasCatalog && !hasTheme) return res.status(400).json({ error: "validation_error" });
      // Replacing the whole catalog can remove services, which only a
      // director or developer may do (DELETE /api/org/consult-services/:id).
      if (hasCatalog && me.role !== "director" && me.role !== "developer") {
        return res.status(403).json({ error: "forbidden" });
      }
      const catalog = hasCatalog ? consultServicesArraySchema.safeParse(b.consultServices) : null;
      const theme = hasTheme ? orgThemePatchSchema.safeParse(b.theme) : null;
      const quoted = b.consultServicesVersion;
      if ((catalog && !catalog.success) || (theme && !theme.success)) {
        return res.status(400).json({ error: "validation_error" });
      }
      if (quoted !== undefined && !(typeof quoted === "number" && Number.isInteger(quoted) && quoted >= 0)) {
        return res.status(400).json({ error: "validation_error" });
      }
      type Out =
        | { ok: true; theme?: Record<string, unknown>; version?: number }
        | { ok: false; services: unknown[]; version: number };
      const out = await storage().mutateOrgSettings<Out>(
        me.organizationId,
        ["theme", CONSULT_KEY, CONSULT_REV_KEY],
        me.id,
        (cur) => {
          const write: Record<string, unknown> = {};
          const result: Out = { ok: true };
          if (catalog && catalog.success) {
            const rev = revOf(cur[CONSULT_REV_KEY]);
            if (quoted !== undefined && quoted !== rev) {
              return { result: { ok: false, services: catalogOf(cur[CONSULT_KEY]), version: rev } };
            }
            write[CONSULT_KEY] = catalog.data;
            write[CONSULT_REV_KEY] = rev + 1;
            result.version = rev + 1;
          }
          if (theme && theme.success) {
            const stored = cur.theme && typeof cur.theme === "object" ? (cur.theme as Record<string, unknown>) : {};
            write.theme = { ...stored, ...theme.data };
            result.theme = write.theme as Record<string, unknown>;
          }
          return { write, result };
        },
      );
      if (!out.ok) {
        return res.status(409).json({ error: "version_conflict", consultServices: out.services, consultServicesVersion: out.version });
      }
      const changed = [hasCatalog ? "consultServices" : null, hasTheme ? "theme" : null].filter(Boolean) as string[];
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "org.preferences_update",
        resourceType: "organization",
        resourceId: me.organizationId,
        details: { changed, ...(theme && theme.success ? { themeKeys: Object.keys(theme.data) } : {}) },
        riskLevel: "low",
      });
      const body: Record<string, unknown> = { ok: true, changed };
      if (out.theme) body.theme = out.theme;
      if (out.version !== undefined) body.consultServicesVersion = out.version;
      res.json(body);
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
      // Rotation mode / round-robin shifts decide who is next for everyone.
      if (parsed.data.rotationMode !== undefined || parsed.data.roundRobinShiftTypes !== undefined) {
        broadcastRotationChange(me.organizationId);
      }
      res.json(updated);
    },
  );
}
