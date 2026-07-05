import type { Express } from "express";
import {
  acknowledgeSchema,
  createConversationSchema,
  markReadSchema,
  sendMessageSchema,
} from "@shared/schema";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth } from "../rbac.js";
import { isDnd, resolveCovering } from "../services/escalation.js";
import { notificationDeps } from "../services/notifications.js";
import { previewNext } from "../services/rotation.js";
import { storage } from "../storage.js";

/** A single addressable on-call / role target the compose picker can message. */
interface OnCallTarget {
  id: string;
  label: string;
  kind: "consult_service" | "next_hospitalist" | "care_team";
  userId: number;
}

export function registerMessagingRoutes(app: Express) {
  // Role/service addressing: resolve on-call roles to whoever currently holds
  // them, so a user can start a conversation with "the on-call cardiologist"
  // instead of hunting for a named person. Every read below is scoped to the
  // caller's own org, and a target is ONLY returned when it resolves to a real
  // messageable user IN THAT ORG (never invented, never cross-tenant).
  app.get("/api/messaging/on-call-targets", requireAuth, async (req, res) => {
    const me = currentUser(req);

    // The org's user roster is the single source of truth for "is this a real,
    // messageable user in my tenant?" — resolution never looks outside it.
    const users = await storage().listUsers(me.organizationId);
    const byId = new Map(users.map((u) => [u.id, u]));
    const byName = new Map(
      users.map((u) => [u.displayName.trim().toLowerCase(), u]),
    );

    const targets: OnCallTarget[] = [];
    const seen = new Set<string>();
    async function add(
      kind: OnCallTarget["kind"],
      id: string,
      label: string,
      userId: number | null | undefined,
    ) {
      // Must resolve to a real in-org user, must not be the caller (messaging
      // yourself as "the on-call X" is meaningless), and de-duped per target.
      if (userId == null || userId === me.id || !byId.has(userId)) return;
      // DND-aware: if the holder is do-not-disturb, address their designated
      // covering provider instead; with no covering, the role is unreachable
      // and is excluded rather than silently routing into a muted inbox.
      if (await isDnd(storage(), userId)) {
        const coveringId = await resolveCovering(
          storage(),
          me.organizationId,
          userId,
        );
        if (coveringId == null || coveringId === me.id) return;
        const cu = byId.get(coveringId);
        userId = coveringId;
        label = label + (cu ? " · covering: " + cu.displayName : " · covering");
      }
      const key = kind + ":" + userId;
      if (seen.has(key)) return;
      seen.add(key);
      targets.push({ id, label, kind, userId });
    }

    // 1) Consult services (org_settings "consultServices"). The on-call entry
    //    historically carries only a display name + avatar — NOT a userId — so
    //    resolve by matching that display name to an org user. If a future
    //    writer stamps a real userId we honor it directly. Unresolvable →
    //    excluded (we never fabricate a user).
    const consultServices = await storage().getOrgSetting(
      me.organizationId,
      "consultServices",
    );
    if (Array.isArray(consultServices)) {
      for (const svc of consultServices) {
        const onCall = svc?.onCall;
        if (!svc?.name || !onCall) continue;
        let userId: number | null =
          typeof onCall.userId === "number" ? onCall.userId : null;
        if (userId == null && typeof onCall.name === "string") {
          const match = byName.get(onCall.name.trim().toLowerCase());
          if (match) userId = match.id;
        }
        await add(
          "consult_service",
          "consult_service:" + (svc.id ?? svc.name),
          "On-call " + svc.name,
          userId,
        );
      }
    }

    // 2) Next hospitalist by rotation (read-only preview — no state change).
    const next = await previewNext(storage(), me.organizationId);
    if (next) {
      const u = byId.get(next.userId);
      await add(
        "next_hospitalist",
        "next_hospitalist",
        u ? "Next hospitalist (" + u.displayName + ")" : "Next hospitalist",
        next.userId,
      );
    }

    // 3) The caller's own care-team members flagged on-call.
    const members = await storage().listCareTeamOwnedBy(
      me.organizationId,
      me.id,
    );
    for (const m of members) {
      if (!m.onCall) continue;
      const u = byId.get(m.memberUserId);
      await add(
        "care_team",
        "care_team:" + m.memberUserId,
        u ? "On-call: " + u.displayName : "On-call care-team member",
        m.memberUserId,
      );
    }

    res.json(targets);
  });

  app.get("/api/messaging/conversations", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const convos = await storage().listConversationsForUser(
      me.organizationId,
      me.id,
    );
    // Decorate with last message + unread count.
    const out = [];
    for (const c of convos) {
      const msgs = await storage().listMessages(me.organizationId, c.id);
      const delivery = await storage().listDeliveryForMessages(
        msgs.map((m) => m.id),
      );
      const unread = delivery.filter(
        (d) => d.userId === me.id && !d.readAt,
      ).length;
      out.push({
        ...c,
        lastMessage: msgs.at(-1) ?? null,
        unreadCount: unread,
      });
    }
    res.json(out);
  });

  app.post("/api/messaging/conversations", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = createConversationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });

    // Ensure the creator is a participant; validate all members are in-org.
    const participantIds = Array.from(
      new Set([me.id, ...parsed.data.participantIds]),
    );
    for (const pid of participantIds) {
      const u = await storage().getUser(me.organizationId, pid);
      if (!u) return res.status(400).json({ error: "participant_not_in_org" });
    }

    const convo = await storage().createConversation({
      organizationId: me.organizationId,
      type: parsed.data.type,
      name: parsed.data.name ?? null,
      participantIds,
    });
    res.status(201).json(convo);
  });

  app.get(
    "/api/messaging/conversations/:id/messages",
    requireAuth,
    async (req, res) => {
      const me = currentUser(req);
      const id = Number(req.params.id);
      const convo = await storage().getConversation(me.organizationId, id);
      if (!convo) return res.status(404).json({ error: "not_found" });
      if (!convo.participantIds.includes(me.id)) {
        return res.status(403).json({ error: "forbidden" });
      }
      const msgs = await storage().listMessages(me.organizationId, id);
      // Decorate each message with acknowledgement info so STAT senders can see
      // it was acknowledged and recipients know if they still owe an ack.
      const delivery = await storage().listDeliveryForMessages(
        msgs.map((m) => m.id),
      );
      const out = msgs.map((m) => {
        const rows = delivery.filter((d) => d.messageId === m.id);
        return {
          ...m,
          ackCount: rows.filter((d) => d.userId !== m.senderId && d.acknowledgedAt)
            .length,
          acknowledgedByMe: rows.some(
            (d) => d.userId === me.id && !!d.acknowledgedAt,
          ),
        };
      });
      res.json(out);
    },
  );

  app.post("/api/messaging/send", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const convo = await storage().getConversation(
      me.organizationId,
      parsed.data.conversationId,
    );
    if (!convo) return res.status(404).json({ error: "not_found" });
    if (!convo.participantIds.includes(me.id)) {
      return res.status(403).json({ error: "forbidden" });
    }

    const message = await storage().createMessage({
      conversationId: convo.id,
      organizationId: me.organizationId,
      senderId: me.id,
      content: parsed.data.content,
      priority: parsed.data.priority,
    });

    // A delivery row per participant; delivered_at=now for everyone (stub). The
    // sender's own copy is auto-read AND auto-acknowledged (you don't ack your
    // own STAT), so ackCount reflects only the recipients.
    await storage().createDeliveryStatuses(
      convo.participantIds.map((uid) => ({
        messageId: message.id,
        userId: uid,
        deliveredAt: new Date(),
        readAt: uid === me.id ? new Date() : null,
        acknowledgedAt: uid === me.id ? new Date() : null,
        realertedAt: null,
        escalatedAt: null,
      })),
    );

    if (parsed.data.priority === "stat") {
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "message.stat_sent",
        resourceType: "message",
        resourceId: message.id,
        details: { conversationId: convo.id },
        riskLevel: "medium",
      });
    }

    // DND forwarding: a recipient who is off/do-not-disturb with a designated
    // covering provider gets their messages forwarded — the covering provider is
    // added to the conversation and delivered THIS message, so nothing sits
    // unseen behind a DND flag (DND without forwarding is clinically unsafe).
    let notifyIds = [...convo.participantIds];
    const forwardedTo: number[] = [];
    for (const uid of convo.participantIds) {
      if (uid === me.id) continue;
      if (!(await isDnd(storage(), uid))) continue;
      const coveringId = await resolveCovering(storage(), me.organizationId, uid);
      if (
        coveringId == null ||
        coveringId === me.id ||
        notifyIds.includes(coveringId) ||
        forwardedTo.includes(coveringId)
      )
        continue;
      await storage().addConversationParticipant(
        me.organizationId,
        convo.id,
        coveringId,
      );
      await storage().createDeliveryStatuses([
        {
          messageId: message.id,
          userId: coveringId,
          deliveredAt: new Date(),
          readAt: null,
          acknowledgedAt: null,
          realertedAt: null,
          escalatedAt: null,
        },
      ]);
      forwardedTo.push(coveringId);
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "message.dnd_forwarded",
        resourceType: "message",
        resourceId: message.id,
        details: { dndUserId: uid, coveringUserId: coveringId },
        riskLevel: "medium",
      });
    }
    notifyIds = notifyIds.concat(forwardedTo);

    notificationDeps().ws.sendToUsers(notifyIds, {
      type: "MESSAGE_RECEIVED",
      message,
    });
    res.status(201).json({ ...message, forwardedTo });
  });

  // Acknowledge STAT/urgent messages — a stronger signal than "read". Notifies
  // the whole conversation so the sender sees the ack land live.
  app.post("/api/messaging/messages/ack", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = acknowledgeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    // Only allow acking messages in conversations the user participates in.
    const owned: number[] = [];
    for (const mid of parsed.data.messageIds) {
      const msg = await storage().getMessage(me.organizationId, mid);
      if (!msg) continue;
      const convo = await storage().getConversation(
        me.organizationId,
        msg.conversationId,
      );
      if (convo && convo.participantIds.includes(me.id)) owned.push(mid);
    }
    if (owned.length === 0) return res.status(404).json({ error: "not_found" });
    await storage().acknowledgeMessages(me.id, owned);
    // Tell participants (sender included) so the ack reflects live.
    for (const mid of owned) {
      const msg = await storage().getMessage(me.organizationId, mid);
      if (!msg) continue;
      const convo = await storage().getConversation(
        me.organizationId,
        msg.conversationId,
      );
      if (convo) {
        notificationDeps().ws.sendToUsers(convo.participantIds, {
          type: "MESSAGE_ACK",
          messageId: mid,
          conversationId: msg.conversationId,
          userId: me.id,
        });
      }
    }
    res.status(204).end();
  });

  app.post("/api/messaging/messages/mark-read", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = markReadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    await storage().markRead(me.id, parsed.data.messageIds);
    res.status(204).end();
  });

  app.delete("/api/messaging/messages/:id", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const id = Number(req.params.id);
    const msg = await storage().getMessage(me.organizationId, id);
    if (!msg) return res.status(404).json({ error: "not_found" });
    if (msg.senderId !== me.id) {
      return res.status(403).json({ error: "forbidden" });
    }
    await storage().softDeleteMessage(me.organizationId, id);
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "message.delete",
      resourceType: "message",
      resourceId: id,
      details: {},
      riskLevel: "low",
    });
    res.status(204).end();
  });
}
