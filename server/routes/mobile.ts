import type { Express } from "express";
import { deviceTokenSchema } from "@shared/schema";
import { logPhiAccess } from "../audit.js";
import { currentUser, requireAuth } from "../rbac.js";
import { storage } from "../storage.js";
import { getVapidPublicKey } from "../services/push.js";

/**
 * Mobile endpoints: the caller's own org (safe fields only), compact
 * assignment payloads, and FCM device-token registration.
 */
export function registerMobileRoutes(app: Express) {
  // Members only, and only their OWN org (A.CON-SHO-11). This used to be a
  // public lookup for QR onboarding, which made it an anonymous org-code
  // oracle (any code → name + timezone, including the platform org) — the
  // very thing /api/login and /api/register are built not to be. Nothing calls
  // it before sign-in (the mobile login takes the code typed and lets
  // /api/login answer), so it now answers a signed-in user for their own org
  // and one indistinguishable 404 for every other code: another tenant, the
  // operator tenant, or none at all.
  app.get("/api/mobile/org/:code", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const org = await storage().getOrganizationByCode(String(req.params.code ?? ""));
    if (!org || org.id !== me.organizationId) return res.status(404).json({ error: "not_found" });
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

  // Public key browsers need to create a Web Push subscription (PWA + web).
  app.get("/api/push/vapid-key", requireAuth, (_req, res) => {
    const key = getVapidPublicKey();
    if (!key) return res.status(503).json({ error: "push_unavailable" });
    res.json({ key });
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
