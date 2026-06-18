import type { Express } from "express";
import { createConsultSchema, updateConsultSchema } from "@shared/schema";
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
      const consultsByPatient = new Map<number, string[]>();
      for (const c of consults) {
        const arr = consultsByPatient.get(c.patientId) ?? [];
        arr.push(c.specialty);
        consultsByPatient.set(c.patientId, arr);
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
            status: p.status,
          },
          responsible,
          consultants: consultsByPatient.get(p.id) ?? [],
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
      const consult = await storage().createConsult({
        organizationId: me.organizationId,
        patientId,
        specialty: parsed.data.specialty,
        consultantUserId: parsed.data.consultantUserId ?? null,
        status: "requested",
      });
      notificationDeps().ws.broadcast(me.organizationId, {
        type: "CONSULT_UPDATED",
        consult,
      });
      res.status(201).json(consult);
    },
  );

  app.patch("/api/consults/:id", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const id = Number(req.params.id);
    const parsed = updateConsultSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const updated = await storage().updateConsult(me.organizationId, id, {
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
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
