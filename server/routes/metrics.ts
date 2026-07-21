import type { Express } from "express";
import { currentUser, requireAuth } from "../rbac.js";
import { storage } from "../storage.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Org-scoped clinical-comms KPIs for the dashboard stat tiles.
export function registerMetricsRoutes(app: Express) {
  app.get("/api/metrics/comms", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const now = Date.now();
    const since7d = new Date(now - 7 * DAY_MS);
    const since30d = new Date(now - 30 * DAY_MS);

    // messages7d reuses the shared analytics counter (also powers /api/reports/ops);
    // the STAT-ack and consult-response averages are purpose-built for these tiles.
    const [messages7d, statAckAvgSec, consultResponseAvgSec] = await Promise.all(
      [
        storage().countMessagesSince(me.organizationId, since7d),
        storage().avgStatAckSeconds(me.organizationId, since30d),
        storage().avgConsultResponseSeconds(me.organizationId, since30d),
      ],
    );

    res.json({ messages7d, statAckAvgSec, consultResponseAvgSec });
  });
}
