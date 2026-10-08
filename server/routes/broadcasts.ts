import type { Express } from "express";
import { createBroadcastSchema, type User } from "@shared/schema";
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

/**
 * The recipient set of a broadcast is fixed AT SEND TIME: every org member
 * other than the sender who existed, and was not deactivated, when it went
 * out. Members added later can still read and acknowledge it from the catch-up
 * list, but they never move the denominator — otherwise a director's "7/9
 * acknowledged" drifts to "7/12" as the roster grows, and a tally that was
 * complete stops reading as complete. Derived from users.created_at /
 * disabled_at, so it needs no new column and is stable across reads.
 */
export function broadcastRecipientIds(
  users: Pick<User, "id" | "createdAt" | "disabledAt">[],
  broadcast: { senderId: number; createdAt: Date | string },
): Set<number> {
  const sentAt = new Date(broadcast.createdAt).getTime();
  const out = new Set<number>();
  for (const u of users) {
    if (u.id === broadcast.senderId) continue;
    if (new Date(u.createdAt).getTime() > sentAt) continue; // joined after the send
    if (u.disabledAt && new Date(u.disabledAt).getTime() <= sentAt) continue; // already deactivated
    out.add(u.id);
  }
  return out;
}

/** Acked / total over the send-time recipient set (never > total). */
function ackTally(
  recipients: Set<number>,
  acks: Array<{ userId: number }>,
): { ackCount: number; total: number } {
  const acked = new Set<number>();
  for (const a of acks) if (recipients.has(a.userId)) acked.add(a.userId);
  return { ackCount: acked.size, total: recipients.size };
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
      const users = await storage().listUsers(me.organizationId);
      const total = broadcastRecipientIds(users, broadcast).size;
      notificationDeps().ws.broadcast(me.organizationId, {
        type: "BROADCAST_CREATED",
        broadcast: {
          ...broadcast,
          senderName: me.displayName,
          ackRequired: broadcastRequiresAck(broadcast.severity),
          ackCount: 0,
          total,
        },
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "broadcast.create",
        resourceType: "broadcast",
        resourceId: broadcast.id,
        details: { severity: broadcast.severity, recipients: total },
        riskLevel: "medium",
      });
      res.status(201).json({ ...broadcast, total });
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
        // Recipients = the org roster at send time, minus the sender.
        const recipients = broadcastRecipientIds(users, b);
        const { ackCount, total } = ackTally(recipients, mine);
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
              ackCount,
              total,
              ackedBy: mine
                .filter((a) => recipients.has(a.userId))
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
    const { ackCount, total } = ackTally(broadcastRecipientIds(users, broadcast), acks);
    // Live tally for the director's card (and the acker's own state). Same
    // denominator as the list: the send-time recipient set.
    notificationDeps().ws.broadcast(me.organizationId, {
      type: "BROADCAST_ACKED",
      broadcastId: id,
      userId: me.id,
      displayName: me.displayName,
      ackCount,
      total,
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
      if (!Number.isInteger(id)) return res.status(404).json({ error: "not_found" });
      const broadcast = await storage().getBroadcast(me.organizationId, id);
      if (!broadcast) return res.status(404).json({ error: "not_found" });
      const acks = await storage().listBroadcastAcks(me.organizationId, id);
      const users = await storage().listUsers(me.organizationId);
      const { ackCount, total } = ackTally(broadcastRecipientIds(users, broadcast), acks);
      res.json({ broadcast: { ...broadcast, total }, acks, ackCount, total });
    },
  );
}
