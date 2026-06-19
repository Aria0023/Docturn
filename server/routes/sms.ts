import type { Express } from "express";
import { z } from "zod";
import { appendAudit } from "../audit.js";
import { getNotificationProfile } from "../config.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { smsFor } from "../services/sms.js";
import { storage } from "../storage.js";

const sendSchema = z.object({
  to: z.string().min(3),
  body: z.string().min(1).max(255),
});

// Twilio-style SMS send + audited history (director/developer). Uses the org's
// configured carrier adapter, falling back to the console stub with no creds.
export function registerSmsRoutes(app: Express) {
  app.post(
    "/api/sms/send",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = sendSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const profile = await getNotificationProfile(me.organizationId);
      const sms = smsFor(profile.smsCarrier);
      const result = await sms.send(parsed.data.to, parsed.data.body);
      await storage().appendSmsHistory({
        organizationId: me.organizationId,
        userId: me.id,
        toPhone: parsed.data.to,
        body: parsed.data.body,
        carrier: sms.carrier,
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "sms.send",
        resourceType: "sms",
        resourceId: null,
        details: { to: parsed.data.to, carrier: sms.carrier },
        riskLevel: "low",
      });
      res.status(201).json({ ok: true, sid: result.sid });
    },
  );

  app.get(
    "/api/sms/history",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      res.json(await storage().listSmsHistory(me.organizationId));
    },
  );
}
