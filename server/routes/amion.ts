import type { Express } from "express";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";
import { amionConfigured, getAmionStatus, syncAmion } from "../services/amion.js";

/**
 * Live Amion schedule feed. The feed URL (with its Lo= token) lives only in
 * the AMION_OCS_URL env var — no response here ever includes it.
 */
export function registerAmionRoutes(app: Express) {
  // Feed status + the last-synced grid (drives the director's Schedule Sync UI).
  app.get("/api/amion/status", requireAuth, async (req, res) => {
    const me = currentUser(req);
    res.json(await getAmionStatus(storage(), me));
  });

  // Run a sync immediately. syncAmion records the outcome (ok or error) in the
  // org's amionSync setting and appends an "amion.sync" audit row either way.
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
