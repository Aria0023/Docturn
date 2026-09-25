import type { Express } from "express";
import { sql } from "drizzle-orm";
import { getDb, getHandle } from "../db.js";

export function registerHealthRoutes(app: Express) {
  app.get("/api/health", async (_req, res) => {
    try {
      await getDb().execute(sql`SELECT 1`);
      // `persistent` = backed by a real Postgres (data survives restarts).
      // false = ephemeral in-process PGlite (a fresh deploy that hasn't been
      // wired to a database yet) — an at-a-glance check that the persistent
      // multi-user setup is actually live.
      res.json({ ok: true, db: "up", persistent: !getHandle().ephemeral });
    } catch {
      res.status(503).json({ ok: false, db: "down" });
    }
  });

  // Public client config (no auth) — read before login so the synthetic-data
  // banner can show on the login screen too. Defaults to SYNTHETIC ON: an
  // instance is treated as test-only unless it is DELIBERATELY put into
  // real-PHI mode with SYNTHETIC_DATA=false (a conscious, compliant choice).
  app.get("/api/config", (_req, res) => {
    res.json({
      syntheticData: process.env.SYNTHETIC_DATA !== "false",
      appName: process.env.APP_NAME ?? "DocTurn",
    });
  });
}
