import type { Express } from "express";
import { z } from "zod";
import { censusOverrideSchema, SHIFT_TYPE } from "@shared/schema";
import { hashPassword, issueTemporaryPassword } from "../auth.js";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { broadcastRotationChange } from "../services/notifications.js";
import { storage } from "../storage.js";

const createProviderSchema = z.object({
  username: z.string().min(3),
  // Accepted for backwards compatibility but IGNORED: the server mints a
  // one-time credential and returns it once (see the handler). A director can
  // never choose — let alone reuse the demo — password for someone else.
  password: z.string().optional(),
  displayName: z.string().min(1),
  specialty: z.string().default("General"),
  patientCap: z.number().int().min(1).max(50).default(12),
  shiftType: z.enum(["day", "night", "swing"]).default("day"),
  role: z
    .enum(["hospitalist", "er_doctor", "er_director", "director"])
    .default("hospitalist"),
  credential: z.enum(["MD", "DO", "NP", "PA"]).optional(),
  // Imported-from-schedule providers come in on-shift (drives on-call roster).
  working: z.boolean().optional(),
});

const workingStatusSchema = z.object({
  working: z.boolean().optional(),
  all: z.boolean().optional(),
});

const capacitySchema = z.object({ patientCap: z.number().int().min(1).max(50) });
const bulkWorkingSchema = z.object({ all: z.boolean() });
const rotationMembershipSchema = z.object({ inRotation: z.boolean() });
const shiftSchema = z.object({ shiftType: z.enum(SHIFT_TYPE) });

const rotationOrderSchema = z.object({
  order: z.array(z.number().int().positive()).min(1),
});

/**
 * Every write below changes who the next round-robin patient goes to, so each
 * successful one ends with broadcastRotationChange(org): every open session of
 * that org (and no other) re-reads GET /api/rotation/next, so a Director card
 * or an ER Quick hint never keeps naming the pre-change provider
 * (A.CON-SHO-29). Refused / cross-tenant writes announce nothing.
 */
export function registerProviderRoutes(app: Express) {
  app.get("/api/hospitalists", requireAuth, async (req, res) => {
    const me = currentUser(req);
    res.json(await storage().listHospitalists(me.organizationId));
  });

  // A Hospitalist Director opts in to also take patients: give their account a
  // (working) rotation profile if it doesn't have one. Idempotent.
  app.post(
    "/api/director/become-hospitalist",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      let h = await storage().getHospitalistByUser(me.organizationId, me.id);
      if (!h) {
        const existing = await storage().listHospitalists(me.organizationId);
        h = await storage().createHospitalist({
          organizationId: me.organizationId,
          userId: me.id,
          specialty: "Hospital Medicine",
          currentPatientCount: 0,
          patientCap: 12,
          rotationOrder: existing.length,
          working: true,
          shiftType: "day",
        });
        await appendAudit({
          organizationId: me.organizationId,
          userId: me.id,
          action: "director.become_hospitalist",
          resourceType: "hospitalist",
          resourceId: h.id,
          details: {},
          riskLevel: "low",
        });
        broadcastRotationChange(me.organizationId);
      }
      res.status(201).json({ hospitalistId: h.id });
    },
  );

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

      // Security boundary: only the dedicated developer route may mint developer
      // (super-admin) accounts. Enforced server-side regardless of the UI.
      if (req.body?.role === "developer" && me.role !== "developer") {
        return res.status(403).json({ error: "forbidden" });
      }

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

      // One-time credential: crypto-random, returned ONCE below for the director
      // to hand over out-of-band, and forced to change at first sign-in.
      const temporaryPassword = issueTemporaryPassword();
      const user = await storage().createUser({
        organizationId: me.organizationId,
        username: data.username,
        passwordHash: await hashPassword(temporaryPassword),
        role: data.role,
        displayName: data.displayName,
        credential: data.credential ?? null,
        phone: null,
        twoFactorEnabled: false,
        mustChangePassword: true,
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
      if (hospitalist) broadcastRotationChange(me.organizationId);
      res.status(201).json({ user: { id: user.id, username: user.username }, hospitalist, temporaryPassword });
    },
  );

  // Bulk on/off shift for the whole org ("All on shift" / "All off shift").
  // Its own id-less path: the numeric `:id` guard (server/params.ts) answers
  // `/api/hospitalists/0/...` with 404, so the old "id 0 + all" form below was
  // unreachable from the Director dashboard.
  async function bulkWorking(me: { id: number; organizationId: number }, working: boolean) {
    await storage().bulkSetWorking(me.organizationId, working);
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "hospitalist.working_bulk",
      resourceType: "organization",
      resourceId: me.organizationId,
      details: { working },
      riskLevel: "medium",
    });
    broadcastRotationChange(me.organizationId);
  }
  app.patch(
    "/api/hospitalists/working-status",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = bulkWorkingSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      await bulkWorking(me, parsed.data.all);
      res.json({ ok: true, bulk: true, working: parsed.data.all });
    },
  );

  app.patch(
    "/api/hospitalists/:id/working-status",
    requireAuth,
    async (req, res) => {
      const me = currentUser(req);
      const parsed = workingStatusSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });

      // Bulk form (director/developer only; kept for older callers).
      if (parsed.data.all !== undefined) {
        if (me.role !== "director" && me.role !== "developer") {
          return res.status(403).json({ error: "forbidden" });
        }
        await bulkWorking(me, parsed.data.all);
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
      broadcastRotationChange(me.organizationId);
      res.json(updated);
    },
  );

  // The Director's "Rotation / Off" switch: take an on-shift provider out of
  // round-robin (or put them back) without touching their shift. Director
  // decision, so not self-service; audited; org-scoped.
  app.patch(
    "/api/hospitalists/:id/rotation",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = rotationMembershipSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const id = Number(req.params.id);
      const h = await storage().getHospitalist(me.organizationId, id);
      if (!h) return res.status(404).json({ error: "not_found" });
      const updated = await storage().updateHospitalist(me.organizationId, id, {
        inRotation: parsed.data.inRotation,
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "hospitalist.rotation_membership",
        resourceType: "hospitalist",
        resourceId: id,
        details: { inRotation: parsed.data.inRotation, from: h.inRotation },
        riskLevel: "low",
      });
      broadcastRotationChange(me.organizationId);
      res.json(updated);
    },
  );

  // The Director's shift selector (Day / Swing / Night). Only shifts in
  // org.roundRobinShiftTypes are routable, so this moves a provider into or
  // out of round-robin. A schedule sync (Amion) may set it again later.
  app.patch(
    "/api/hospitalists/:id/shift",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = shiftSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const id = Number(req.params.id);
      const h = await storage().getHospitalist(me.organizationId, id);
      if (!h) return res.status(404).json({ error: "not_found" });
      const updated = await storage().updateHospitalist(me.organizationId, id, {
        shiftType: parsed.data.shiftType,
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "hospitalist.shift_change",
        resourceType: "hospitalist",
        resourceId: id,
        details: { from: h.shiftType, to: parsed.data.shiftType },
        riskLevel: "low",
      });
      broadcastRotationChange(me.organizationId);
      res.json(updated);
    },
  );

  // "Mass set daily census limit → Apply to all": every provider in the org.
  app.patch(
    "/api/physicians/capacity",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = capacitySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const all = await storage().listHospitalists(me.organizationId);
      for (const h of all) {
        if (h.patientCap !== parsed.data.patientCap) {
          await storage().updateHospitalist(me.organizationId, h.id, { patientCap: parsed.data.patientCap });
        }
      }
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "hospitalist.cap_bulk",
        resourceType: "organization",
        resourceId: me.organizationId,
        details: { patientCap: parsed.data.patientCap, providers: all.length },
        riskLevel: "low",
      });
      broadcastRotationChange(me.organizationId);
      res.json({ ok: true, bulk: true, patientCap: parsed.data.patientCap });
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
    broadcastRotationChange(me.organizationId);
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
      // Only this org's providers are reordered (updateHospitalist is
      // org-scoped, so a foreign id is a no-op).
      let i = 0;
      for (const hid of parsed.data.order) {
        await storage().updateHospitalist(me.organizationId, hid, {
          rotationOrder: i++,
        });
      }
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "rotation.reorder",
        resourceType: "organization",
        resourceId: me.organizationId,
        details: { order: parsed.data.order },
        riskLevel: "low",
      });
      broadcastRotationChange(me.organizationId);
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
      broadcastRotationChange(me.organizationId);
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
      broadcastRotationChange(me.organizationId);
      res.json(updated);
    },
  );

  app.post(
    "/api/round-robin/reset",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const org = await storage().getOrganization(me.organizationId);
      await storage().updateOrganization(me.organizationId, {
        rotationIndex: 0,
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "rotation.reset",
        resourceType: "organization",
        resourceId: me.organizationId,
        details: { fromIndex: org?.rotationIndex ?? null },
        riskLevel: "low",
      });
      // The sequential "Next up" just changed for everyone in the org.
      broadcastRotationChange(me.organizationId);
      res.json({ ok: true });
    },
  );
}
