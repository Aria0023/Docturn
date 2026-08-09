import type { Express } from "express";
import { attestationUpsertSchema } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { CONTROL_BY_ID } from "../compliance/controls.js";
import {
  buildComplianceReport,
  buildEvidencePack,
} from "../compliance/report.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";

/** Roles allowed to see compliance posture, matching /api/reports/ops. */
const COMPLIANCE_ROLES = ["director", "er_director", "developer"] as const;

// HIPAA audit trail + PHI access summary for the Compliance screen, plus the
// continuous control monitor (Vanta-style) and its auditor evidence export.
export function registerComplianceRoutes(app: Express) {
  app.get(
    "/api/audit",
    requireAuth,
    requireRole(...COMPLIANCE_ROLES),
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

  /**
   * Live control posture. Every automated control is RECOMPUTED on each call
   * from database state and runtime configuration — nothing is cached, so a
   * stale green can never be served.
   */
  app.get(
    "/api/compliance/status",
    requireAuth,
    requireRole(...COMPLIANCE_ROLES),
    async (req, res) => {
      const me = currentUser(req);
      const org = await storage().getOrganization(me.organizationId);
      if (!org) return res.status(404).json({ error: "not_found" });
      const report = await buildComplianceReport(storage(), org);
      res.json(report);
    },
  );

  /**
   * Record one MANUAL attestation. Automated controls are rejected outright:
   * an organization must never be able to attest a failing technical safeguard
   * into a passing state.
   */
  app.patch(
    "/api/compliance/attestation",
    requireAuth,
    requireRole(...COMPLIANCE_ROLES),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = attestationUpsertSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "validation_error" });
      }
      const def = CONTROL_BY_ID.get(parsed.data.controlId);
      if (!def) return res.status(404).json({ error: "unknown_control" });
      if (def.kind !== "manual") {
        return res.status(400).json({ error: "control_is_automated" });
      }
      const reviewDue = parsed.data.reviewDue
        ? new Date(parsed.data.reviewDue)
        : null;
      if (reviewDue && Number.isNaN(reviewDue.getTime())) {
        return res.status(400).json({ error: "validation_error" });
      }
      const row = await storage().upsertAttestation(
        me.organizationId,
        parsed.data.controlId,
        {
          status: parsed.data.status,
          owner: parsed.data.owner ?? null,
          note: parsed.data.note ?? null,
          evidenceUrl: parsed.data.evidenceUrl || null,
          reviewDue,
        },
        me.id,
      );
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "compliance.attestation_updated",
        resourceType: "compliance_attestation",
        resourceId: row.id,
        // Control id + status only. No note text, no evidence URL.
        details: { controlId: parsed.data.controlId, status: parsed.data.status },
        riskLevel: "medium",
      });
      res.json(row);
    },
  );

  /**
   * The auditor evidence pack — one JSON document a CPA firm or an OCR
   * investigator can read cold. Contains control results, the attestation
   * register, aggregate audit statistics and an explicit scope-and-limitations
   * section. Contains NO PHI and no raw audit rows.
   */
  app.get(
    "/api/compliance/evidence",
    requireAuth,
    requireRole(...COMPLIANCE_ROLES),
    async (req, res) => {
      const me = currentUser(req);
      const org = await storage().getOrganization(me.organizationId);
      if (!org) return res.status(404).json({ error: "not_found" });
      const pack = await buildEvidencePack(storage(), org, {
        id: me.id,
        role: me.role,
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "compliance.evidence_exported",
        resourceType: "compliance_report",
        resourceId: null,
        details: {
          readinessPct: (pack.summary as { readinessPct: number }).readinessPct,
        },
        riskLevel: "medium",
      });
      res.json(pack);
    },
  );
}
