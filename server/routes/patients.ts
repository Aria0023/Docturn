import type { Express } from "express";
import { createPatientSchema, extractNoteSchema } from "@shared/schema";
import { logPhiAccess } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { getExtractor } from "../services/ai-intake.js";
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
}
