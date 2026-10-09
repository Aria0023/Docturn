import type { Express } from "express";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";
import { amionConfigured, amionOrganization, getAmionStatus, syncAmion } from "../services/amion.js";

/**
 * Live Amion schedule feed. The feed URL (with its Lo= token) lives only in
 * the AMION_OCS_URL env var — no response here ever includes it.
 */
export function registerAmionRoutes(app: Express) {
  // Feed status + the last-synced grid (drives the director's Schedule Sync UI).
  app.get("/api/amion/status", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const db = storage();
    if (me.role === "developer") {
      // The snapshot is the Amion tenant's provider schedule (names, slots,
      // hours, shift, secure-messaging flag), and getAmionStatus serves it to
      // a developer of ANY org. From outside that org this is a CROSS-TENANT
      // read (launch finding A.CON-SHO-9; see the header of routes/dev.ts):
      // one ids-only row in the Amion org's own trail, before the read, so
      // its director sees the platform looked. No feed / no such org → nothing
      // is read, no row; a developer of the Amion org itself → not
      // cross-tenant, no row.
      const org = await amionOrganization(db);
      if (org && org.id !== me.organizationId) {
        await appendAudit({
          organizationId: org.id,
          userId: me.id,
          action: "dev.amion_status_read",
          resourceType: "organization",
          resourceId: org.id,
          details: { orgId: org.id },
          riskLevel: "low",
        });
      }
    }
    res.json(await getAmionStatus(db, me));
  });

  // Run a sync immediately. syncAmion records the outcome (ok or error) in the
  // org's amionSync setting and appends an "amion.sync" audit row either way,
  // in the Amion org and naming the caller — so a developer's sync-now (and
  // the snapshot it answers with) is already on that tenant's trail.
  app.post(
    "/api/amion/sync-now",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      if (!amionConfigured()) {
        return res.status(409).json({ error: "amion_not_configured" });
      }
      try {
        await syncAmion(storage(), { actorUserId: me.id });
      } catch (err) {
        // Config-shaped failures (missing org). Fetch/parse errors are already
        // captured in the stored state and don't throw.
        console.error("[amion] sync-now failed:", err instanceof Error ? err.message : err);
        return res.status(502).json({ error: "amion_sync_failed" });
      }
      res.json(await getAmionStatus(storage(), me));
    },
  );
}
