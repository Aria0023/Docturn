import type { Express } from "express";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";

// CMS for public pages. Read is open to any authenticated user; editing is
// developer-only (org-scoped, or global when no org context).
export function registerCmsRoutes(app: Express) {
  app.get("/api/cms/:key", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const key = req.params.key;
    if (key !== "landing" && key !== "contact") {
      return res.status(404).json({ error: "not_found" });
    }
    const row = await storage().getCms(key, me.organizationId);
    res.json(row ?? {});
  });

  app.put(
    "/api/cms/:key",
    requireAuth,
    requireRole("developer"),
    async (req, res) => {
      const me = currentUser(req);
      const key = req.params.key;
      if (key !== "landing" && key !== "contact") {
        return res.status(404).json({ error: "not_found" });
      }
      await storage().setCms(key, me.organizationId, req.body ?? {});
      res.json({ ok: true });
    },
  );
}
