import type { Express } from "express";
import { z } from "zod";
import { censusOverrideSchema } from "@shared/schema";
import { hashPassword } from "../auth.js";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";

const createProviderSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  displayName: z.string().min(1),
  specialty: z.string().default("General"),
  patientCap: z.number().int().min(1).max(50).default(12),
  shiftType: z.enum(["day", "night", "swing"]).default("day"),
  role: z.enum(["hospitalist", "er_doctor"]).default("hospitalist"),
  credential: z.enum(["MD", "DO", "NP", "PA"]).optional(),
  // Imported-from-schedule providers come in on-shift (drives on-call roster).
  working: z.boolean().optional(),
});

const workingStatusSchema = z.object({
  working: z.boolean().optional(),
  all: z.boolean().optional(),
});

const capacitySchema = z.object({ patientCap: z.number().int().min(1).max(50) });

const rotationOrderSchema = z.object({
  order: z.array(z.number().int().positive()).min(1),
});

export function registerProviderRoutes(app: Express) {
  app.get("/api/hospitalists", requireAuth, async (req, res) => {
    const me = currentUser(req);
    res.json(await storage().listHospitalists(me.organizationId));
  });

  app.get("/api/hospitalists/working", requireAuth, async (req, res) => {
    const me = currentUser(req);
    res.json(await storage().listWorkingHospitalists(me.organizationId));
  });

  app.get("/api/physicians/directory", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const hospitalists = await storage().listHospitalists(me.organizationId);
    const users = await storage().listUsers(me.organizationId);
    const byId = new Map(users.map((u) => [u.id, u]));
    // HIPAA-safe directory fields only.
    res.json(
      hospitalists.map((h) => ({
        id: h.id,
        userId: h.userId,
        displayName: byId.get(h.userId)?.displayName ?? "Unknown",
        credential: byId.get(h.userId)?.credential ?? null,
        specialty: h.specialty,
        working: h.working,
        shiftType: h.shiftType,
      })),
    );
  });

  app.post(
    "/api/director/hospitalists",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = createProviderSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const data = parsed.data;

      // er_director may only create er_doctor accounts.
      if (me.role === "er_director" && data.role !== "er_doctor") {
        return res.status(403).json({ error: "forbidden" });
      }

      const existing = await storage().getUserByUsername(
        me.organizationId,
        data.username,
      );
      if (existing) return res.status(409).json({ error: "username_taken" });

      const user = await storage().createUser({
        organizationId: me.organizationId,
        username: data.username,
        passwordHash: await hashPassword(data.password),
        role: data.role,
        displayName: data.displayName,
        credential: data.credential ?? null,
        phone: null,
        twoFactorEnabled: false,
      });

      let hospitalist = null;
      if (data.role === "hospitalist") {
        const existingProviders = await storage().listHospitalists(
          me.organizationId,
        );
        hospitalist = await storage().createHospitalist({
          organizationId: me.organizationId,
          userId: user.id,
          specialty: data.specialty,
          currentPatientCount: 0,
          patientCap: data.patientCap,
          rotationOrder: existingProviders.length,
          working: data.working ?? false,
          shiftType: data.shiftType,
        });
      }

      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "provider.create",
        resourceType: "user",
        resourceId: user.id,
        details: { role: data.role },
        riskLevel: "low",
      });
      res.status(201).json({ user: { id: user.id }, hospitalist });
    },
  );

  app.patch(
    "/api/hospitalists/:id/working-status",
    requireAuth,
    async (req, res) => {
      const me = currentUser(req);
      const parsed = workingStatusSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });

      // Bulk form (director/developer only).
      if (parsed.data.all !== undefined) {
        if (me.role !== "director" && me.role !== "developer") {
          return res.status(403).json({ error: "forbidden" });
        }
        await storage().bulkSetWorking(me.organizationId, parsed.data.all);
        return res.json({ ok: true, bulk: true, working: parsed.data.all });
      }

      const id = Number(req.params.id);
      const h = await storage().getHospitalist(me.organizationId, id);
      if (!h) return res.status(404).json({ error: "not_found" });

      // self or director.
      const isSelf = h.userId === me.id;
      if (!isSelf && me.role !== "director" && me.role !== "developer") {
        return res.status(403).json({ error: "forbidden" });
      }
      if (parsed.data.working === undefined) {
        return res.status(400).json({ error: "validation_error" });
      }
      const updated = await storage().updateHospitalist(me.organizationId, id, {
        working: parsed.data.working,
      });
      res.json(updated);
    },
  );

  app.patch("/api/physicians/:id/capacity", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = capacitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const id = Number(req.params.id);
    const h = await storage().getHospitalist(me.organizationId, id);
    if (!h) return res.status(404).json({ error: "not_found" });
    const isSelf = h.userId === me.id;
    if (!isSelf && me.role !== "director" && me.role !== "developer") {
      return res.status(403).json({ error: "forbidden" });
    }
    const updated = await storage().updateHospitalist(me.organizationId, id, {
      patientCap: parsed.data.patientCap,
    });
    res.json(updated);
  });

  app.patch(
    "/api/hospitalists/rotation-order",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = rotationOrderSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      let i = 0;
      for (const hid of parsed.data.order) {
        await storage().updateHospitalist(me.organizationId, hid, {
          rotationOrder: i++,
        });
      }
      res.json(await storage().listHospitalists(me.organizationId));
    },
  );

  app.delete(
    "/api/physicians/:id",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const id = Number(req.params.id);
      const h = await storage().getHospitalist(me.organizationId, id);
      if (!h) return res.status(404).json({ error: "not_found" });
      if (await storage().hasPendingForHospitalist(me.organizationId, id)) {
        return res.status(409).json({ error: "has_pending_assignments" });
      }
      await storage().deleteHospitalist(me.organizationId, id);
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "provider.delete",
        resourceType: "hospitalist",
        resourceId: id,
        details: {},
        riskLevel: "medium",
      });
      res.status(204).end();
    },
  );

  // v2: director census override — an audited manual correction (not an
  // automatic path). Clamped to [0, patient_cap]; reason required.
  app.patch(
    "/api/hospitalists/:id/census",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = censusOverrideSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const id = Number(req.params.id);
      const h = await storage().getHospitalist(me.organizationId, id);
      if (!h) return res.status(404).json({ error: "not_found" });
      const clamped = Math.max(
        0,
        Math.min(parsed.data.currentPatientCount, h.patientCap),
      );
      const updated = await storage().updateHospitalist(me.organizationId, id, {
        currentPatientCount: clamped,
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "hospitalist.census_override",
        resourceType: "hospitalist",
        resourceId: id,
        details: {
          from: h.currentPatientCount,
          to: clamped,
          reason: parsed.data.reason,
        },
        riskLevel: "medium",
      });
      res.json(updated);
    },
  );

  app.post(
    "/api/round-robin/reset",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      await storage().updateOrganization(me.organizationId, {
        rotationIndex: 0,
      });
      res.json({ ok: true });
    },
  );
}
