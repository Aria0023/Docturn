import type { Express } from "express";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";

// HIPAA audit trail + PHI access summary for the Compliance screen.
export function registerComplianceRoutes(app: Express) {
  app.get(
    "/api/audit",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const [audit, phi, phiCount] = await Promise.all([
        storage().listAuditLogs(me.organizationId, 100),
        storage().listPhiAccess(me.organizationId, 50),
        storage().countPhiAccess(me.organizationId),
      ]);
      res.json({ audit, phiAccess: phi, phiAccessCount: phiCount });
    },
  );
}
