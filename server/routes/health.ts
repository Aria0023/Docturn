import type { Express } from "express";
import { sql } from "drizzle-orm";
import { getDb, getHandle } from "../db.js";

export function registerHealthRoutes(app: Express) {
  app.get("/api/health", async (req, res) => {
    try {
      await getDb().execute(sql`SELECT 1`);
      const h = getHandle();
      // Unauthenticated endpoint: describe the store truthfully, never leak a
      // filesystem path or connection detail.
      //  persistent — backed by a real external Postgres (DATABASE_URL). The
      //               deploy scripts (deploy/aws/update.sh) key on this to
      //               confirm the app is on RDS and not a local store.
      //  storage    — postgres | pglite-disk | pglite-memory (server/db.ts).
      //  durable    — rows survive a process restart. TRUE for the on-disk
      //               PGlite store too: it is a single-process, unencrypted
      //               dev/trial database, not an ephemeral one.
      //  secure     — whether THIS request was seen as HTTPS (directly or via a
      //               trusted X-Forwarded-Proto). In production the session
      //               cookie is Secure, so if a curl through the proxy shows
      //               false here, logins will be refused (insecure_transport).
      res.json({
        ok: true,
        db: "up",
        persistent: !h.ephemeral,
        storage: h.storage,
        durable: h.durable,
        secure: req.secure,
      });
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
