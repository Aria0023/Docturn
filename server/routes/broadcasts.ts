import type { Express } from "express";
import { createBroadcastSchema } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { requireModule } from "../modules.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { notificationDeps } from "../services/notifications.js";
import { storage } from "../storage.js";

// Roles that see per-recipient ack tallies on the broadcast list.
const DIRECTOR_ROLES = new Set<string>(["director", "er_director", "developer"]);

/** Ack semantics: urgent/critical demand an explicit acknowledgement; info doesn't. */
export function broadcastRequiresAck(severity: string): boolean {
  return severity !== "info";
}

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
        broadcast: {
          ...broadcast,
          senderName: me.displayName,
          ackRequired: broadcastRequiresAck(broadcast.severity),
        },
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

  // Catch-up list: the last 50 broadcasts for my org with my own ack state, so
  // a device that was offline when the WS event fired still sees (and can
  // acknowledge) an outstanding urgent/critical broadcast on login. Directors
  // additionally get the acked/total tally per broadcast.
  app.get(
    "/api/broadcasts",
    requireAuth,
    requireModule("broadcasts"),
    async (req, res) => {
      const me = currentUser(req);
      const rows = await storage().listRecentBroadcasts(me.organizationId, 50);
      const acks = await storage().listBroadcastAcksForBroadcasts(
        me.organizationId,
        rows.map((b) => b.id),
      );
      const users = await storage().listUsers(me.organizationId);
      const nameById = new Map(users.map((u) => [u.id, u.displayName]));
      const isDirector = DIRECTOR_ROLES.has(me.role);
      const out = rows.map((b) => {
        const mine = acks.filter((a) => a.broadcastId === b.id);
        const myAck = mine.find((a) => a.userId === me.id);
        // Recipients = every org member except the sender.
        const total = Math.max(0, users.length - 1);
        const acked = new Set(
          mine.filter((a) => a.userId !== b.senderId).map((a) => a.userId),
        ).size;
        const base = {
          id: b.id,
          severity: b.severity,
          message: b.message,
          createdAt: b.createdAt,
          senderId: b.senderId,
          senderName: nameById.get(b.senderId) ?? "",
          ackRequired: broadcastRequiresAck(b.severity),
          acked: !!myAck,
          ackedAt: myAck?.acknowledgedAt ?? null,
        };
        return isDirector || b.senderId === me.id
          ? {
              ...base,
              ackCount: acked,
              total,
              ackedBy: mine
                .filter((a) => a.userId !== b.senderId)
                .map((a) => ({
                  userId: a.userId,
                  displayName: nameById.get(a.userId) ?? "",
                  acknowledgedAt: a.acknowledgedAt,
                })),
            }
          : base;
      });
      res.json(out);
    },
  );

  app.post("/api/broadcasts/:id/ack", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: "not_found" });
    const broadcast = await storage().getBroadcast(me.organizationId, id);
    if (!broadcast) return res.status(404).json({ error: "not_found" });
    // Idempotent: a second tap (or a retry after a lost 204) must not add a
    // duplicate row that would inflate the director's tally.
    const existing = await storage().listBroadcastAcks(me.organizationId, id);
    if (!existing.some((a) => a.userId === me.id)) {
      await storage().ackBroadcast({
        organizationId: me.organizationId,
        broadcastId: id,
        userId: me.id,
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "broadcast.ack",
        resourceType: "broadcast",
        resourceId: id,
        details: { severity: broadcast.severity },
        riskLevel: "low",
      });
    }
    const acks = await storage().listBroadcastAcks(me.organizationId, id);
    const users = await storage().listUsers(me.organizationId);
    const ackCount = new Set(
      acks.filter((a) => a.userId !== broadcast.senderId).map((a) => a.userId),
    ).size;
    // Live tally for the director's card (and the acker's own state).
    notificationDeps().ws.broadcast(me.organizationId, {
      type: "BROADCAST_ACKED",
      broadcastId: id,
      userId: me.id,
      displayName: me.displayName,
      ackCount,
      total: Math.max(0, users.length - 1),
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
