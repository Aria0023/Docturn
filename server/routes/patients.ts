import type { Express } from "express";
import { createPatientSchema, extractNoteSchema } from "@shared/schema";
import { logPhiAccess } from "../audit.js";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { getExtractor } from "../services/ai-intake.js";
import { broadcastAssignmentChange } from "../services/notifications.js";
import { storage } from "../storage.js";

export function registerPatientRoutes(app: Express) {
  app.post(
    "/api/patients/extract",
    requireAuth,
    requireRole("er_doctor", "er_director", "developer"),
    async (req, res) => {
      const parsed = extractNoteSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const extracted = await getExtractor().extract(parsed.data.note);
      res.json(extracted);
    },
  );

  app.post(
    "/api/patients",
    requireAuth,
    requireRole("er_doctor", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      await logPhiAccess(req, "patients");
      const parsed = createPatientSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const patient = await storage().createPatient({
        organizationId: me.organizationId,
        initials: parsed.data.initials.toUpperCase(),
        roomNumber: parsed.data.roomNumber ?? null,
        issueSummary: parsed.data.issueSummary,
        specialty: parsed.data.specialty ?? null,
        department: parsed.data.department ?? null,
        acuity: parsed.data.acuity ?? null,
        status: "waiting",
        erDoctorId: me.id,
        assignedHospitalistId: null,
      });
      res.status(201).json(patient);
    },
  );

  app.get("/api/patients", requireAuth, async (req, res) => {
    const me = currentUser(req);
    await logPhiAccess(req, "patients");
    res.json(await storage().listPatients(me.organizationId));
  });

  // Clear out old patients (and their assignments/consults). Default removes
  // anything older than 24h; { olderThanHours: 0 } clears ALL. Director / ER
  // director / developer only. The same call powers the daily auto-clean sweep.
  app.post(
    "/api/maintenance/purge",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const hours = Number((req.body ?? {}).olderThanHours);
      const olderThanMs = Number.isFinite(hours) ? Math.max(0, hours) * 3600_000 : 24 * 3600_000;
      const removed = await storage().purgeOldPatients(me.organizationId, olderThanMs);
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "maintenance.purge_patients",
        resourceType: "patient",
        resourceId: null,
        details: { removed, olderThanHours: olderThanMs / 3600_000 },
        riskLevel: "medium",
      });
      broadcastAssignmentChange(me.organizationId);
      res.json({ removed });
    },
  );
}
