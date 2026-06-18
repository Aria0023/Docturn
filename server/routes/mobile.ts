import type { Express } from "express";
import { deviceTokenSchema } from "@shared/schema";
import { logPhiAccess } from "../audit.js";
import { currentUser, requireAuth } from "../rbac.js";
import { storage } from "../storage.js";

/**
 * Mobile endpoints: public org lookup (safe fields only, for QR onboarding),
 * compact assignment payloads, and FCM device-token registration.
 */
export function registerMobileRoutes(app: Express) {
  app.get("/api/mobile/org/:code", async (req, res) => {
    const org = await storage().getOrganizationByCode(req.params.code);
    if (!org) return res.status(404).json({ error: "not_found" });
    // Safe fields only.
    res.json({
      id: org.id,
      name: org.name,
      code: org.code,
      timezone: org.timezone,
    });
  });

  app.get("/api/mobile/assignments", requireAuth, async (req, res) => {
    const me = currentUser(req);
    await logPhiAccess(req, "assignments");
    const h = await storage().getHospitalistByUser(me.organizationId, me.id);
    if (!h) return res.json([]);
    const pending = await storage().listPendingForHospitalist(
      me.organizationId,
      h.id,
    );
    const patients = await storage().listPatients(me.organizationId);
    const byId = new Map(patients.map((p) => [p.id, p]));
    // Compact payload: initials, room, specialty only (no PHI beyond initials).
    res.json(
      pending.map((a) => {
        const p = byId.get(a.patientId);
        return {
          id: a.id,
          initials: p?.initials ?? "??",
          room: p?.roomNumber ?? null,
          specialty: p?.specialty ?? null,
          expiresAt: a.expiresAt,
        };
      }),
    );
  });

  app.post("/api/mobile/device-tokens", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = deviceTokenSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    await storage().upsertDeviceToken({
      organizationId: me.organizationId,
      userId: me.id,
      token: parsed.data.token,
      platform: parsed.data.platform,
    });
    res.status(201).json({ ok: true });
  });

  app.delete(
    "/api/mobile/device-tokens/:token",
    requireAuth,
    async (req, res) => {
      const me = currentUser(req);
      await storage().deleteDeviceToken(me.id, req.params.token ?? "");
      res.status(204).end();
    },
  );
}
