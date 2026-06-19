import type { Express } from "express";
import { createBroadcastSchema } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { notificationDeps } from "../services/notifications.js";
import { storage } from "../storage.js";

// Emergency broadcasts with org-scoped fan-out and per-recipient acks.
export function registerBroadcastRoutes(app: Express) {
  app.post(
    "/api/broadcasts",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = createBroadcastSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const broadcast = await storage().createBroadcast({
        organizationId: me.organizationId,
        senderId: me.id,
        message: parsed.data.message,
        severity: parsed.data.severity,
      });
      notificationDeps().ws.broadcast(me.organizationId, {
        type: "BROADCAST_CREATED",
        broadcast,
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "broadcast.create",
        resourceType: "broadcast",
        resourceId: broadcast.id,
        details: { severity: broadcast.severity },
        riskLevel: "medium",
      });
      res.status(201).json(broadcast);
    },
  );

  app.post("/api/broadcasts/:id/ack", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const id = Number(req.params.id);
    const broadcast = await storage().getBroadcast(me.organizationId, id);
    if (!broadcast) return res.status(404).json({ error: "not_found" });
    await storage().ackBroadcast({
      organizationId: me.organizationId,
      broadcastId: id,
      userId: me.id,
    });
    notificationDeps().ws.broadcast(me.organizationId, {
      type: "BROADCAST_ACK",
      broadcastId: id,
      userId: me.id,
    });
    res.status(204).end();
  });

  app.get(
    "/api/broadcasts/:id",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const id = Number(req.params.id);
      const broadcast = await storage().getBroadcast(me.organizationId, id);
      if (!broadcast) return res.status(404).json({ error: "not_found" });
      const acks = await storage().listBroadcastAcks(me.organizationId, id);
      res.json({ broadcast, acks });
    },
  );
}
