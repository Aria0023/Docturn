import type { Express } from "express";
import {
  createConversationSchema,
  markReadSchema,
  sendMessageSchema,
} from "@shared/schema";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth } from "../rbac.js";
import { notificationDeps } from "../services/notifications.js";
import { storage } from "../storage.js";

export function registerMessagingRoutes(app: Express) {
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
      res.json(await storage().listMessages(me.organizationId, id));
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
    });

    // A delivery row per participant; delivered_at=now for everyone (stub).
    await storage().createDeliveryStatuses(
      convo.participantIds.map((uid) => ({
        messageId: message.id,
        userId: uid,
        deliveredAt: new Date(),
        readAt: uid === me.id ? new Date() : null,
      })),
    );

    notificationDeps().ws.sendToUsers(convo.participantIds, {
      type: "MESSAGE_RECEIVED",
      message,
    });
    res.status(201).json(message);
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
