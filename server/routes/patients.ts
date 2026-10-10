import type { Express } from "express";
import { createPatientSchema, extractNoteSchema, patientPatchSchema } from "@shared/schema";
import { logPhiAccess } from "../audit.js";
import { appendAudit } from "../audit.js";
import { parseId } from "../params.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { extractorForOrg, MockAIExtractor, OpenAIExtractor } from "../services/ai-intake.js";
import { broadcastAssignmentChange, broadcastRotationChange } from "../services/notifications.js";
import { storage } from "../storage.js";

/**
 * Who may edit / remove a patient on the hospital-wide Patient board: the
 * oversight roles that see every patient (A.CON clinical #13-#15). The board's
 * routing status is DERIVED from the patient's assignments, so it is not
 * editable here — only room, issue and unit are.
 */
const BOARD_EDIT_ROLES = ["director", "er_director"] as const;

export function registerPatientRoutes(app: Express) {
  app.post(
    "/api/patients/extract",
    requireAuth,
    requireRole("er_doctor", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = extractNoteSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      // Per-org switch: with OpenAI off for this org the note never leaves DocTurn.
      const extractor = await extractorForOrg(me.organizationId);
      const extracted = await extractor.extract(parsed.data.note);
      // Which engine produced these fields, so the intake screen labels them
      // honestly: "local" = DocTurn's built-in keyword rules (no AI; also the
      // OpenAI extractor's fallback when the vendor call fails), "openai" = the
      // org's OpenAI integration answered.
      const engine = extracted.engine
        ?? (extractor instanceof MockAIExtractor ? "local" : extractor instanceof OpenAIExtractor ? "openai" : "external");
      res.json({ ...extracted, engine });
    },
  );

  // ER intake — and a director's / ER director's manual admission from the
  // Patient board ("Add admission", routed with POST /api/assignments).
  app.post(
    "/api/patients",
    requireAuth,
    requireRole("er_doctor", "er_director", "director", "developer"),
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
        // EHR id (MRN/CSN) is PHI: stored here, resolved only by the audited
        // /api/patients/:id/ehr-link route — never echoed into notifications.
        ehrId: parsed.data.ehrId ?? null,
      });
      res.status(201).json(patient);
    },
  );

  // The board's inline room / issue / unit edits (director, ER director).
  // Validated (no status — it is derived from routing), tenant-scoped (a
  // foreign or unknown id is 404), PHI-logged, audited with the FIELD NAMES
  // only (never the values), and announced so every open board re-reads.
  app.patch(
    "/api/patients/:id",
    requireAuth,
    requireRole(...BOARD_EDIT_ROLES),
    async (req, res) => {
      const me = currentUser(req);
      const id = parseId(req.params.id);
      if (id === null) return res.status(404).json({ error: "not_found" });
      const parsed = patientPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const existing = await storage().getPatient(me.organizationId, id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
      const updated = await storage().updatePatient(me.organizationId, id, patch);
      await logPhiAccess(req, "patients", { resourceId: id, patientId: id });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "patient.update",
        resourceType: "patient",
        resourceId: id,
        details: { fields: Object.keys(patch) },
        riskLevel: "low",
      });
      broadcastAssignmentChange(me.organizationId);
      res.json(updated);
    },
  );

  // The board's "Remove admission": ONE patient and everything linked to it,
  // in one transaction (storage.deletePatient — the purge's own path).
  // Irreversible PHI deletion: PHI-logged and audited at high risk.
  app.delete(
    "/api/patients/:id",
    requireAuth,
    requireRole(...BOARD_EDIT_ROLES),
    async (req, res) => {
      const me = currentUser(req);
      const id = parseId(req.params.id);
      if (id === null) return res.status(404).json({ error: "not_found" });
      if (!(await storage().getPatient(me.organizationId, id))) return res.status(404).json({ error: "not_found" });
      let removed;
      try {
        removed = await storage().deletePatient(me.organizationId, id);
      } catch (err) {
        console.error("[patients] delete failed", (err as Error)?.name ?? "error");
        await appendAudit({
          organizationId: me.organizationId,
          userId: me.id,
          action: "patient.delete_failed",
          resourceType: "patient",
          resourceId: id,
          details: {},
          riskLevel: "high",
        });
        return res.status(500).json({ error: "delete_failed" });
      }
      if (!removed) return res.status(404).json({ error: "not_found" });
      await logPhiAccess(req, "patients", { resourceId: id, patientId: id });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "patient.delete",
        resourceType: "patient",
        resourceId: id,
        details: { ...removed },
        riskLevel: "high",
      });
      broadcastAssignmentChange(me.organizationId);
      // An accepted patient's provider just lost one from their census.
      if (removed.assignments) broadcastRotationChange(me.organizationId);
      res.json({ removed });
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
      // The purge is a single transaction (storage.purgeOldPatients); a failure
      // rolls everything back and is answered, never left to hang the request.
      let result;
      try {
        result = await storage().purgeOldPatients(me.organizationId, olderThanMs);
      } catch (err) {
        console.error("[purge] failed", err);
        await appendAudit({
          organizationId: me.organizationId,
          userId: me.id,
          action: "maintenance.purge_failed",
          resourceType: "patient",
          resourceId: null,
          details: { olderThanHours: olderThanMs / 3600_000, error: String((err as Error)?.message ?? err).slice(0, 200) },
          riskLevel: "high",
        });
        return res.status(500).json({ error: "purge_failed" });
      }
      // Audit exactly what left the system, per table — not just a patient count.
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "maintenance.purge_patients",
        resourceType: "patient",
        resourceId: null,
        details: { removed: result.patients, ...result, olderThanHours: olderThanMs / 3600_000 },
        riskLevel: "medium",
      });
      broadcastAssignmentChange(me.organizationId);
      res.json({ removed: result.patients, ...result });
    },
  );
}
