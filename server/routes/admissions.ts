import type { Express } from "express";
import { appendAudit, logPhiAccess } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import {
  ADMISSIONS_RESET_KEY,
  buildAdmissionsLog,
  parseReset,
} from "../services/admissions-log.js";
import { broadcastAdmissionsChange } from "../services/notifications.js";
import { storage } from "../storage.js";

/**
 * Admissions log + the dashboard's "since last reset" counter.
 *
 *   GET  /api/admissions        director / ER director / developer — the org's
 *                               routed patients (services/admissions-log.ts)
 *                               with the server's counts. PHI read: one
 *                               phi-access row per request, ids only.
 *   POST /api/admissions/reset  director / developer — moves the org-wide
 *                               counter marker to now (the log keeps every
 *                               row), audited, announced as ADMISSIONS_UPDATED.
 *
 * Both are gated with routing.assignments (server/modules.ts GATE_TABLE), the
 * module the Admissions log nav item already follows. Org-scoped to the
 * caller's own organization.
 */
export function registerAdmissionsRoutes(app: Express) {
  app.get(
    "/api/admissions",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      await logPhiAccess(req, "admissions");
      res.json(await buildAdmissionsLog(storage(), me.organizationId));
    },
  );

  app.post(
    "/api/admissions/reset",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const db = storage();
      // What the counter showed until now (for the audit row).
      const before = await buildAdmissionsLog(db, me.organizationId);
      const at = new Date().toISOString();
      // Locked read-modify-write: the audit row names the marker it replaced.
      const previous = await db.mutateOrgSettings(me.organizationId, [ADMISSIONS_RESET_KEY], me.id, (cur) => ({
        write: { [ADMISSIONS_RESET_KEY]: { at, by: me.id } },
        result: parseReset(cur[ADMISSIONS_RESET_KEY]),
      }));
      const after = await buildAdmissionsLog(db, me.organizationId);
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "admissions.counter_reset",
        resourceType: "org_settings",
        resourceId: null,
        details: { resetAt: at, previousResetAt: previous?.at ?? null, countBefore: before.sinceReset },
        riskLevel: "low",
      });
      broadcastAdmissionsChange(me.organizationId);
      // Counts only — the response carries no patient rows.
      res.json({ total: after.total, last24h: after.last24h, sinceReset: after.sinceReset, reset: after.reset });
    },
  );
}
