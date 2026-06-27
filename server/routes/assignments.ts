import type { Express, Response } from "express";
import { createAssignmentSchema } from "@shared/schema";
import { z } from "zod";
import { logPhiAccess } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import {
  AssignmentError,
  acceptAssignment,
  cancelAssignment,
  createAssignment,
  reassignAssignment,
  rejectAssignment,
} from "../services/assignments.js";
import { storage } from "../storage.js";

function handleError(res: Response, err: unknown) {
  if (err instanceof AssignmentError) {
    const status =
      err.code === "not_found"
        ? 404
        : err.code === "forbidden"
          ? 403
          : err.code === "no_provider"
            ? 409
            : 409;
    return res.status(status).json({ error: err.message });
  }
  console.error("[assignments] unexpected", err);
  return res.status(500).json({ error: "internal_error" });
}

const reassignSchema = z.object({
  hospitalistId: z.number().int().positive().optional(),
});

export function registerAssignmentRoutes(app: Express) {
  app.post(
    "/api/assignments",
    requireAuth,
    requireRole("er_doctor", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      await logPhiAccess(req, "assignments");
      const parsed = createAssignmentSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      try {
        const a = await createAssignment(storage(), {
          orgId: me.organizationId,
          patientId: parsed.data.patientId,
          erDoctorId: me.id,
          mode: parsed.data.mode,
          hospitalistId: parsed.data.hospitalistId,
        });
        res.status(201).json(a);
      } catch (err) {
        handleError(res, err);
      }
    },
  );

  // Org-wide assignment list for oversight roles (reassign/cancel UI).
  app.get(
    "/api/assignments",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      await logPhiAccess(req, "assignments");
      res.json(await storage().listAssignments(me.organizationId));
    },
  );

  app.get(
    "/api/assignments/pending",
    requireAuth,
    requireRole("hospitalist", "director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      await logPhiAccess(req, "assignments");
      const h = await storage().getHospitalistByUser(me.organizationId, me.id);
      if (!h) return res.json([]);
      res.json(
        await storage().listPendingForHospitalist(me.organizationId, h.id),
      );
    },
  );

  app.get(
    "/api/assignments/my",
    requireAuth,
    requireRole("hospitalist", "director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      await logPhiAccess(req, "assignments");
      const h = await storage().getHospitalistByUser(me.organizationId, me.id);
      if (!h) return res.json([]);
      res.json(
        await storage().listAcceptedForHospitalist(me.organizationId, h.id),
      );
    },
  );

  // What the ER sent: every assignment THIS ER physician routed (er_director /
  // developer see the whole org), enriched with patient + current provider +
  // live status, newest first. Drives the ER's "Patient board" so declines,
  // re-routes and accepts are visible — not just the optimistic local copy.
  app.get(
    "/api/assignments/sent",
    requireAuth,
    requireRole("er_doctor", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      await logPhiAccess(req, "assignments");
      const [all, patients, hospitalists, users] = await Promise.all([
        storage().listAssignments(me.organizationId),
        storage().listPatients(me.organizationId),
        storage().listHospitalists(me.organizationId),
        storage().listUsers(me.organizationId),
      ]);
      const pById = new Map(patients.map((p) => [p.id, p]));
      const hById = new Map(hospitalists.map((h) => [h.id, h]));
      const uById = new Map(users.map((u) => [u.id, u]));
      const mine = me.role === "er_doctor"
        ? all.filter((a) => a.erDoctorId === me.id)
        : all;
      const rows = mine.slice(0, 60).map((a) => {
        const p = pById.get(a.patientId);
        const h = hById.get(a.hospitalistId);
        const provider = h ? uById.get(h.userId) : undefined;
        return {
          id: a.id,
          patientId: a.patientId,
          initials: p?.initials ?? "??",
          room: p?.roomNumber ?? "",
          complaint: p?.issueSummary ?? "",
          acuity: p?.acuity ?? null,
          provider: provider?.displayName ?? "Unassigned",
          hospitalistId: a.hospitalistId,
          status: a.status,
          via: a.via,
          createdAt: a.createdAt,
        };
      });
      res.json(rows);
    },
  );

  app.patch(
    "/api/assignments/:id/accept",
    requireAuth,
    requireRole("hospitalist", "director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const id = Number(req.params.id);
      const a = await storage().getAssignment(me.organizationId, id);
      if (!a) return res.status(404).json({ error: "not_found" });
      // v2: the targeted attending OR any on-call member of their unit may accept.
      const attending = await storage().getHospitalist(
        me.organizationId,
        a.hospitalistId,
      );
      const unit = attending
        ? await storage().unitUserIds(me.organizationId, attending.userId)
        : [];
      if (me.role !== "developer" && !unit.includes(me.id)) {
        return res.status(403).json({ error: "forbidden" });
      }
      try {
        res.json(await acceptAssignment(storage(), me.organizationId, id, me.id));
      } catch (err) {
        handleError(res, err);
      }
    },
  );

  app.patch(
    "/api/assignments/:id/reject",
    requireAuth,
    requireRole("hospitalist", "director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const id = Number(req.params.id);
      const a = await storage().getAssignment(me.organizationId, id);
      if (!a) return res.status(404).json({ error: "not_found" });
      const h = await storage().getHospitalistByUser(me.organizationId, me.id);
      if (me.role !== "developer" && (!h || h.id !== a.hospitalistId)) {
        return res.status(403).json({ error: "forbidden" });
      }
      try {
        const result = await rejectAssignment(
          storage(),
          me.organizationId,
          id,
          me.id,
        );
        res.json(result);
      } catch (err) {
        handleError(res, err);
      }
    },
  );

  app.patch(
    "/api/assignments/:id/reassign",
    requireAuth,
    requireRole("director", "er_director", "er_doctor", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const id = Number(req.params.id);
      const parsed = reassignSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      // An ER physician may re-route only the patients THEY admitted.
      if (me.role === "er_doctor") {
        const a = await storage().getAssignment(me.organizationId, id);
        if (!a) return res.status(404).json({ error: "not_found" });
        if (a.erDoctorId !== me.id) return res.status(403).json({ error: "forbidden" });
      }
      try {
        const result = await reassignAssignment(
          storage(),
          me.organizationId,
          id,
          me.id,
          parsed.data.hospitalistId,
        );
        res.json(result);
      } catch (err) {
        handleError(res, err);
      }
    },
  );

  app.patch(
    "/api/assignments/:id/cancel",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const id = Number(req.params.id);
      try {
        res.json(await cancelAssignment(storage(), me.organizationId, id, me.id));
      } catch (err) {
        handleError(res, err);
      }
    },
  );
}
