import type { Express } from "express";
import {
  createBroadcastSchema,
  type BroadcastAudienceRole,
  type EmergencyBroadcast,
  type User,
} from "@shared/schema";
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

/**
 * The recipients of a broadcast being sent NOW: every active org member other
 * than the sender — or, with an audience, only those holding one of its roles.
 * Stored on the row (recipient_ids) so the set never moves afterwards.
 */
export function recipientsAtSend(
  users: Pick<User, "id" | "role" | "disabledAt">[],
  senderId: number,
  audience: BroadcastAudienceRole[] | null,
): number[] {
  return users
    .filter((u) => u.id !== senderId && !u.disabledAt)
    .filter((u) => !audience || (audience as string[]).includes(u.role))
    .map((u) => u.id)
    .sort((a, b) => a - b);
}

/** A stored broadcast's recipient set (rows before recipient_ids derive it). */
function recipientsOf(
  users: Pick<User, "id" | "createdAt" | "disabledAt">[],
  b: Pick<EmergencyBroadcast, "senderId" | "createdAt" | "recipientIds">,
): Set<number> {
  return Array.isArray(b.recipientIds)
    ? new Set(b.recipientIds)
    : broadcastRecipientIds(users, b);
}

/**
 * Is this broadcast addressed to `me`? Its frozen recipients are; so is a
 * member who joined later and holds an addressed role (they can read and
 * acknowledge it from the catch-up list, without moving the denominator).
 * The sender never is.
 */
function addressedTo(
  me: Pick<User, "id" | "role">,
  b: Pick<EmergencyBroadcast, "senderId" | "audience">,
  recipients: Set<number>,
): boolean {
  if (me.id === b.senderId) return false;
  if (recipients.has(me.id)) return true;
  return b.audience == null || (b.audience as string[]).includes(me.role);
}

/** Who sees a broadcast: its addressees, its sender and the org's director roles. */
function visibleTo(
  me: Pick<User, "id" | "role">,
  b: Pick<EmergencyBroadcast, "senderId" | "audience">,
  recipients: Set<number>,
): boolean {
  return addressedTo(me, b, recipients) || me.id === b.senderId || DIRECTOR_ROLES.has(me.role);
}

/** Org members who see a targeted broadcast without being addressed by it. */
function observersOf(
  users: Pick<User, "id" | "role" | "disabledAt">[],
  b: Pick<EmergencyBroadcast, "senderId">,
  recipients: Set<number>,
): number[] {
  return users
    .filter((u) => !u.disabledAt && !recipients.has(u.id) && (u.id === b.senderId || DIRECTOR_ROLES.has(u.role)))
    .map((u) => u.id);
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

/**
 * Store a broadcast from `sender` — to everyone in the org (audience null) or
 * to the roles in `audience` — with its recipient set frozen now, announce it
 * (BROADCAST_CREATED) and audit it. Org-wide: one frame to every signed-in
 * member. Targeted: the recipients get it as recipients, the sender and the
 * org's director roles as observers (recipient:false) — nobody else is told.
 * Shared by POST /api/broadcasts and the ER diversion switch
 * (server/routes/er.ts), so a diversion alert is an ordinary broadcast: in
 * every clinician's catch-up list, with its ack requirement and tally.
 */
export async function sendOrgBroadcast(
  sender: Pick<User, "id" | "organizationId" | "displayName">,
  message: string,
  severity: (typeof createBroadcastSchema)["_output"]["severity"],
  extraAudit: Record<string, unknown> = {},
  audience: BroadcastAudienceRole[] | null = null,
) {
  const users = await storage().listUsers(sender.organizationId);
  const recipientIds = recipientsAtSend(users, sender.id, audience);
  const broadcast = await storage().createBroadcast({
    organizationId: sender.organizationId,
    senderId: sender.id,
    message,
    severity,
    audience,
    recipientIds,
  });
  const total = recipientIds.length;
  // The frame names no recipient ids (everyone in the org may receive it).
  const { recipientIds: _ids, ...shown } = broadcast;
  const frame = (recipient: boolean) => ({
    type: "BROADCAST_CREATED",
    broadcast: {
      ...shown,
      senderName: sender.displayName,
      ackRequired: broadcastRequiresAck(broadcast.severity),
      ackCount: 0,
      total,
      recipient,
    },
  });
  const ws = notificationDeps().ws;
  if (!audience) {
    ws.broadcast(sender.organizationId, frame(true));
  } else {
    const recipients = new Set(recipientIds);
    ws.sendToUsers(recipientIds, frame(true));
    ws.sendToUsers(observersOf(users, broadcast, recipients), frame(false));
  }
  await appendAudit({
    organizationId: sender.organizationId,
    userId: sender.id,
    action: "broadcast.create",
    resourceType: "broadcast",
    resourceId: broadcast.id,
    details: { severity: broadcast.severity, recipients: total, audience: audience ?? "all", ...extraAudit },
    riskLevel: "medium",
  });
  return { broadcast, total };
}

// Emergency broadcasts — to the whole org or to chosen roles — with a
// recipient set frozen at send time and per-recipient acks.
export function registerBroadcastRoutes(app: Express) {
  app.post(
    "/api/broadcasts",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = createBroadcastSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const audience =
        parsed.data.audience === "all"
          ? null
          : (Array.from(new Set(parsed.data.audience)).sort() as BroadcastAudienceRole[]);
      if (audience) {
        // A targeted send that would reach nobody is refused, not "sent".
        const users = await storage().listUsers(me.organizationId);
        if (recipientsAtSend(users, me.id, audience).length === 0) {
          return res.status(422).json({ error: "no_recipients" });
        }
      }
      const { broadcast, total } = await sendOrgBroadcast(
        me,
        parsed.data.message,
        parsed.data.severity,
        {},
        audience,
      );
      const { recipientIds: _ids, ...shown } = broadcast;
      res.status(201).json({ ...shown, audience: broadcast.audience ?? null, total });
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
      // A targeted broadcast is listed only to the people it was addressed
      // to, its sender and the org's director roles.
      const visible = rows
        .map((b) => ({ b, recipients: recipientsOf(users, b) }))
        .filter(({ b, recipients }) => visibleTo(me, b, recipients));
      const out = visible.map(({ b, recipients }) => {
        const mine = acks.filter((a) => a.broadcastId === b.id);
        const myAck = mine.find((a) => a.userId === me.id);
        // Recipients = frozen at send time (never the live roster).
        const { ackCount, total } = ackTally(recipients, mine);
        const base = {
          id: b.id,
          severity: b.severity,
          message: b.message,
          createdAt: b.createdAt,
          senderId: b.senderId,
          senderName: nameById.get(b.senderId) ?? "",
          audience: b.audience ?? null,
          // Addressed to me: I get the Acknowledge button. A director (or
          // the sender) seeing someone else's broadcast is an observer.
          recipient: addressedTo(me, b, recipients),
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
    const users = await storage().listUsers(me.organizationId);
    const recipients = recipientsOf(users, broadcast);
    // Not shown to me at all → as if it did not exist; shown but not
    // addressed to me (the sender, a director observing a targeted send) →
    // there is nothing for me to acknowledge.
    if (!visibleTo(me, broadcast, recipients)) return res.status(404).json({ error: "not_found" });
    if (!addressedTo(me, broadcast, recipients)) return res.status(403).json({ error: "not_a_recipient" });
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
    const { ackCount, total } = ackTally(recipients, acks);
    // Live tally for the director's card (and the acker's own state). Same
    // denominator as the list: the send-time recipient set. A targeted
    // broadcast's tally goes only to the people who can see it.
    const ackFrame = {
      type: "BROADCAST_ACKED",
      broadcastId: id,
      userId: me.id,
      displayName: me.displayName,
      ackCount,
      total,
    };
    if (broadcast.audience == null) {
      notificationDeps().ws.broadcast(me.organizationId, ackFrame);
    } else {
      notificationDeps().ws.sendToUsers(
        [...recipients, ...observersOf(users, broadcast, recipients), me.id],
        ackFrame,
      );
    }
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
      const { ackCount, total } = ackTally(recipientsOf(users, broadcast), acks);
      res.json({ broadcast: { ...broadcast, total }, acks, ackCount, total });
    },
  );
}
