import type { Express } from "express";
import { createConsultSchema, updateConsultSchema, type PatientConsult } from "@shared/schema";
import { logPhiAccess } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { notificationDeps } from "../services/notifications.js";
import { storage } from "../storage.js";

/**
 * v2 patient distribution board: a hospital-wide view of every distributed
 * patient with the responsible attending + on-call unit, consultants, and the
 * admitting ER physician. Org-scoped and PHI-logged on every load; NOT available
 * to the developer (platform operators don't read tenant PHI).
 */
export function registerBoardRoutes(app: Express) {
  app.get(
    "/api/patient-board",
    requireAuth,
    requireRole("hospitalist", "er_doctor", "er_director", "director"),
    async (req, res) => {
      const me = currentUser(req);
      await logPhiAccess(req, "patient-board");

      const department = req.query.department as string | undefined;
      const [patients, hospitalists, users, latest, consults] =
        await Promise.all([
          storage().listPatients(me.organizationId),
          storage().listHospitalists(me.organizationId),
          storage().listUsers(me.organizationId),
          storage().latestAssignmentByPatient(me.organizationId),
          storage().listActiveConsults(me.organizationId),
        ]);

      const userById = new Map(users.map((u) => [u.id, u]));
      const hById = new Map(hospitalists.map((h) => [h.id, h]));
      // Specialty pills (deduped) for the column, plus per-consultant detail rows
      // so the UI can show WHO was consulted and who accepted / declined.
      const consultsByPatient = new Map<number, string[]>();
      const consultDetailByPatient = new Map<
        number,
        Array<{ id: number; specialty: string; consultantUserId: number | null; name: string | null; credential: string | null; status: string; respondedAt: Date | null; requestedAt: Date | null }>
      >();
      for (const c of consults) {
        const arr = consultsByPatient.get(c.patientId) ?? [];
        if (arr.indexOf(c.specialty) < 0) arr.push(c.specialty);
        consultsByPatient.set(c.patientId, arr);
        const u = c.consultantUserId != null ? userById.get(c.consultantUserId) : undefined;
        const det = consultDetailByPatient.get(c.patientId) ?? [];
        det.push({
          id: c.id,
          specialty: c.specialty,
          consultantUserId: c.consultantUserId ?? null,
          name: u?.displayName ?? c.consultantName ?? null,
          credential: u?.credential ?? null,
          status: c.status,
          respondedAt: c.respondedAt ?? null,
          requestedAt: c.createdAt ?? null,
        });
        consultDetailByPatient.set(c.patientId, det);
      }

      const rows = [];
      for (const p of patients) {
        if (department && p.department !== department) continue;
        const a = latest.get(p.id);
        let responsible = null;
        let status = a?.status ?? "waiting";

        if (a && a.status === "accepted") {
          const h = hById.get(a.hospitalistId);
          const attendingUser = h ? userById.get(h.userId) : undefined;
          const unitIds = h
            ? await storage().unitUserIds(me.organizationId, h.userId)
            : [];
          responsible = {
            attending: attendingUser
              ? { userId: attendingUser.id, displayName: attendingUser.displayName }
              : null,
            unit: unitIds
              .filter((id) => id !== attendingUser?.id)
              .map((id) => {
                const u = userById.get(id);
                return {
                  userId: id,
                  credential: u?.credential ?? null,
                  displayName: u?.displayName ?? "Unknown",
                };
              }),
          };
          status = "assigned";
        } else if (a && a.status === "pending") {
          status = "pending";
        }

        const admittedByUser = p.erDoctorId
          ? userById.get(p.erDoctorId)
          : undefined;

        rows.push({
          patient: {
            id: p.id,
            initials: p.initials,
            room: p.roomNumber,
            department: p.department,
            issue: p.issueSummary,
            acuity: p.acuity,
            status: p.status,
          },
          // Current assignment id (if any), so director/ER reassign can target it.
          assignmentId: a?.id ?? null,
          responsible,
          consultants: consultsByPatient.get(p.id) ?? [],
          consultDetails: consultDetailByPatient.get(p.id) ?? [],
          admittedBy: admittedByUser
            ? { userId: admittedByUser.id, displayName: admittedByUser.displayName }
            : null,
          status,
        });
      }
      res.json(rows);
    },
  );

  // Consults feed the board's Consultants column.
  app.get("/api/patients/:id/consults", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const patientId = Number(req.params.id);
    res.json(await storage().listConsultsForPatient(me.organizationId, patientId));
  });

  app.post(
    "/api/patients/:id/consults",
    requireAuth,
    requireRole("er_doctor", "er_director", "hospitalist", "director"),
    async (req, res) => {
      const me = currentUser(req);
      const patientId = Number(req.params.id);
      const parsed = createConsultSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const patient = await storage().getPatient(me.organizationId, patientId);
      if (!patient) return res.status(404).json({ error: "not_found" });

      // Record WHO is being consulted, each as its own row, so we can track who
      // accepts and who doesn't. Priority: an explicit team (the consult service's
      // on-call + members, by name); then a single pinned user; then a fan-out to
      // hospitalists sharing the specialty; finally a named placeholder.
      const spec = parsed.data.specialty.trim().toLowerCase();
      const existing = await storage().listConsultsForPatient(me.organizationId, patientId);
      const sameSpec = (c: PatientConsult) => (c.specialty || "").trim().toLowerCase() === spec;
      const haveUid = new Set(existing.filter(sameSpec).map((c) => c.consultantUserId).filter(Boolean));
      const haveName = new Set(existing.filter(sameSpec).map((c) => (c.consultantName || "").toLowerCase()).filter(Boolean));

      let created: PatientConsult[];
      if (Array.isArray(parsed.data.consultants) && parsed.data.consultants.length) {
        const targets = parsed.data.consultants.filter(
          (t) => !(t.userId && haveUid.has(t.userId)) && !haveName.has(t.name.trim().toLowerCase()),
        );
        created = await Promise.all(
          targets.map((t) =>
            storage().createConsult({
              organizationId: me.organizationId, patientId,
              specialty: parsed.data.specialty,
              consultantUserId: t.userId ?? null,
              consultantName: t.name,
              status: "requested",
            }),
          ),
        );
      } else if (parsed.data.consultantUserId != null) {
        created = haveUid.has(parsed.data.consultantUserId) ? [] : [
          await storage().createConsult({
            organizationId: me.organizationId, patientId,
            specialty: parsed.data.specialty,
            consultantUserId: parsed.data.consultantUserId,
            status: "requested",
          }),
        ];
      } else {
        const hosps = await storage().listHospitalists(me.organizationId);
        const users = await storage().listUsers(me.organizationId);
        const nameById = new Map(users.map((u) => [u.id, u.displayName]));
        const targets = hosps
          .filter((h) => (h.specialty || "").trim().toLowerCase() === spec)
          .filter((h) => !haveUid.has(h.userId));
        if (targets.length) {
          created = await Promise.all(
            targets.map((h) =>
              storage().createConsult({
                organizationId: me.organizationId, patientId,
                specialty: parsed.data.specialty,
                consultantUserId: h.userId,
                consultantName: nameById.get(h.userId) ?? null,
                status: "requested",
              }),
            ),
          );
        } else if (!existing.some(sameSpec)) {
          created = [
            await storage().createConsult({
              organizationId: me.organizationId, patientId,
              specialty: parsed.data.specialty, consultantUserId: null,
              consultantName: parsed.data.specialty + " on-call", status: "requested",
            }),
          ];
        } else {
          created = [];
        }
      }
      notificationDeps().ws.broadcast(me.organizationId, {
        type: "CONSULT_UPDATED",
        patientId,
      });
      res.status(201).json(created);
    },
  );

  app.patch("/api/consults/:id", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const id = Number(req.params.id);
    const parsed = updateConsultSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const responded = parsed.data.status === "accepted" || parsed.data.status === "declined";
    const updated = await storage().updateConsult(me.organizationId, id, {
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(responded ? { respondedAt: new Date() } : {}),
      ...(parsed.data.consultantUserId !== undefined
        ? { consultantUserId: parsed.data.consultantUserId }
        : {}),
    });
    if (!updated) return res.status(404).json({ error: "not_found" });
    notificationDeps().ws.broadcast(me.organizationId, {
      type: "CONSULT_UPDATED",
      consult: updated,
    });
    res.json(updated);
  });
}
