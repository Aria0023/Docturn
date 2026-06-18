import type { Express } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db.js";

export function registerHealthRoutes(app: Express) {
  app.get("/api/health", async (_req, res) => {
    try {
      await getDb().execute(sql`SELECT 1`);
      res.json({ ok: true, db: "up" });
    } catch {
      res.status(503).json({ ok: false, db: "down" });
    }
  });
}
