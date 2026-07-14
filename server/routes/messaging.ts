import express, { type Express } from "express";
import {
  acknowledgeSchema,
  attachmentUploadSchema,
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

// Attachment mime allowlist — only these types can be uploaded. Anything else is
// rejected (400 bad_type) so we never store arbitrary executable/unknown blobs.
const ATTACHMENT_ALLOWED_MIME = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
/** Max decoded attachment size (8 MB). */
const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

/** Decoded byte length of a base64 string without allocating the buffer. */
function base64ByteSize(b64: string): number {
  const clean = b64.replace(/=+$/, "");
  return Math.floor((clean.length * 3) / 4);
}

/** A single addressable on-call / role target the compose picker can message. */
interface OnCallTarget {
  id: string;
  label: string;
  kind: "consult_service" | "next_hospitalist" | "care_team";
  userId: number;
  /** Display name of the user who currently holds this on-call role (after any
   *  DND→covering redirect), so a "who's on call now" view can name the person. */
  holder: string;
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
      targets.push({
        id,
        label,
        kind,
        userId,
        holder: byId.get(userId)?.displayName ?? "",
      });
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

  // Upload an attachment (image/file) as base64. Route-level 12 MB JSON parser
  // (the global cap is 1 MB — too small for uploads). Stored UNLINKED (message_id
  // NULL) until it's attached to a message at send time. SYNTHETIC-DATA PILOT
  // ONLY — production PHI needs encrypted object storage + AV scanning + a BAA.
  app.post(
    "/api/messaging/attachments",
    express.json({ limit: "12mb" }),
    requireAuth,
    async (req, res) => {
      const me = currentUser(req);
      const parsed = attachmentUploadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "validation_error" });
      }
      if (!ATTACHMENT_ALLOWED_MIME.has(parsed.data.mimeType)) {
        return res.status(400).json({ error: "bad_type" });
      }
      const byteSize = base64ByteSize(parsed.data.dataBase64);
      if (byteSize > ATTACHMENT_MAX_BYTES) {
        return res.status(400).json({ error: "too_large" });
      }
      const { id } = await storage().createAttachment({
        organizationId: me.organizationId,
        uploaderId: me.id,
        fileName: parsed.data.fileName,
        mimeType: parsed.data.mimeType,
        byteSize,
        dataBase64: parsed.data.dataBase64,
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "message.attachment_upload",
        resourceType: "attachment",
        resourceId: id,
        details: { mimeType: parsed.data.mimeType, byteSize },
        riskLevel: "low",
      });
      res.status(201).json({
        id,
        fileName: parsed.data.fileName,
        mimeType: parsed.data.mimeType,
        byteSize,
      });
    },
  );

  // Fetch attachment bytes. Access control: if the attachment is linked to a
  // message, only participants of that message's conversation may fetch it; if
  // still unlinked, only the uploader may. Same-origin cookie auth means <img>
  // and <a download> requests carry the session automatically.
  app.get("/api/messaging/attachments/:id", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: "not_found" });
    const att = await storage().getAttachment(me.organizationId, id);
    if (!att) return res.status(404).json({ error: "not_found" });

    if (att.messageId != null) {
      const msg = await storage().getMessage(me.organizationId, att.messageId);
      if (!msg) return res.status(404).json({ error: "not_found" });
      const convo = await storage().getConversation(
        me.organizationId,
        msg.conversationId,
      );
      if (!convo || !convo.participantIds.includes(me.id)) {
        return res.status(403).json({ error: "forbidden" });
      }
    } else if (att.uploaderId !== me.id) {
      return res.status(403).json({ error: "forbidden" });
    }

    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "message.attachment_view",
      resourceType: "attachment",
      resourceId: att.id,
      details: { messageId: att.messageId },
      riskLevel: "low",
    });

    res.setHeader("Content-Type", att.mimeType);
    // Never let a browser MIME-sniff user-uploaded bytes into something
    // executable, even though the upload allowlist already excludes HTML/JS.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      'inline; filename="' + att.fileName.replace(/"/g, "") + '"',
    );
    res.send(Buffer.from(att.dataBase64, "base64"));
  });

  // Availability of a peer, so a 1:1 thread can show an auto-response status:
  // whether they're do-not-disturb and, if so, who covers them. Operational
  // (not PHI); scoped to the caller's org. "off shift" comes from their
  // hospitalist working flag when they have one.
  app.get(
    "/api/messaging/availability/:userId",
    requireAuth,
    async (req, res) => {
      const me = currentUser(req);
      const userId = Number(req.params.userId);
      if (!Number.isInteger(userId)) {
        return res.status(400).json({ error: "bad_user" });
      }
      const user = await storage().getUser(me.organizationId, userId);
      if (!user) return res.status(404).json({ error: "not_found" });
      const dnd = await isDnd(storage(), userId);
      let covering: { userId: number; displayName: string } | null = null;
      if (dnd) {
        const coveringId = await resolveCovering(
          storage(),
          me.organizationId,
          userId,
        );
        if (coveringId != null) {
          const cu = await storage().getUser(me.organizationId, coveringId);
          if (cu) covering = { userId: cu.id, displayName: cu.displayName };
        }
      }
      const hospitalist = await storage().getHospitalistByUser(
        me.organizationId,
        userId,
      );
      const working = hospitalist ? !!hospitalist.working : null;
      res.json({ userId, dnd, covering, working });
    },
  );

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
      patientId: null,
    });
    res.status(201).json(convo);
  });

  // Patient-linked care-team thread: ONE conversation per patient, named after
  // the patient (minimum-necessary: initials + room), auto-membered with the
  // current care team — accepted attending, routing ER physician, and accepted
  // consultants — plus the requester. Idempotent: repeat calls reopen it (and
  // refresh membership as the care team grows).
  app.post("/api/messaging/patient-thread", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const patientId = Number((req.body ?? {}).patientId);
    if (!Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({ error: "validation_error" });
    }
    const patient = await storage().getPatient(me.organizationId, patientId);
    if (!patient) return res.status(404).json({ error: "not_found" });

    // Assemble the care team (userIds, in-org by construction).
    const members = new Set<number>([me.id]);
    const assignments = await storage().listAssignments(me.organizationId);
    for (const a of assignments) {
      if (a.patientId !== patientId) continue;
      if (a.erDoctorId) members.add(a.erDoctorId);
      if (a.status === "accepted") {
        if (a.acceptedByUserId) members.add(a.acceptedByUserId);
        const h = await storage().getHospitalist(
          me.organizationId,
          a.hospitalistId,
        );
        if (h?.userId) members.add(h.userId);
      }
    }
    for (const c of await storage().listConsultsForPatient(
      me.organizationId,
      patientId,
    )) {
      if (c.status === "accepted" && c.consultantUserId)
        members.add(c.consultantUserId);
    }

    const existing = await storage().getConversationByPatient(
      me.organizationId,
      patientId,
    );
    if (existing) {
      // Membership follows the care team: add anyone new (incl. the requester).
      for (const uid of members) {
        if (!existing.participantIds.includes(uid)) {
          await storage().addConversationParticipant(
            me.organizationId,
            existing.id,
            uid,
          );
        }
      }
      const fresh = await storage().getConversation(
        me.organizationId,
        existing.id,
      );
      return res.json(fresh);
    }

    const convo = await storage().createConversation({
      organizationId: me.organizationId,
      type: "group",
      name:
        "Patient " +
        patient.initials +
        (patient.roomNumber ? " · Rm " + patient.roomNumber : ""),
      participantIds: [...members],
      patientId,
    });
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "messaging.patient_thread_created",
      resourceType: "conversation",
      resourceId: convo.id,
      details: { patientId, participants: convo.participantIds },
      riskLevel: "low",
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
      // Attach per-message attachment metadata (never the bytes) so the thread
      // can render thumbnails / download chips; bytes are fetched per-attachment.
      const atts = await storage().listAttachmentsForMessages(
        me.organizationId,
        msgs.map((m) => m.id),
      );
      const byMsg: Record<number, typeof atts> = {};
      for (const a of atts) {
        if (a.messageId == null) continue;
        (byMsg[a.messageId] ||= []).push(a);
      }
      const out = msgs.map((m) => {
        const rows = delivery.filter((d) => d.messageId === m.id);
        return {
          ...m,
          ackCount: rows.filter((d) => d.userId !== m.senderId && d.acknowledgedAt)
            .length,
          acknowledgedByMe: rows.some(
            (d) => d.userId === me.id && !!d.acknowledgedAt,
          ),
          attachments: (byMsg[m.id] || []).map((a) => ({
            id: a.id,
            fileName: a.fileName,
            mimeType: a.mimeType,
            byteSize: a.byteSize,
            isImage: a.mimeType.startsWith("image/"),
          })),
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
    // A message must carry something: text or at least one attachment.
    if (!parsed.data.content.trim() && !parsed.data.attachmentIds?.length) {
      return res.status(400).json({ error: "empty_message" });
    }

    const message = await storage().createMessage({
      conversationId: convo.id,
      organizationId: me.organizationId,
      senderId: me.id,
      content: parsed.data.content,
      priority: parsed.data.priority,
    });

    // Link any pre-uploaded attachments to this message (only the uploader's own
    // still-unlinked attachments in this org are claimed).
    if (parsed.data.attachmentIds?.length) {
      await storage().linkAttachmentsToMessage(
        me.organizationId,
        message.id,
        parsed.data.attachmentIds,
        me.id,
      );
    }

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
    // Content-free push wake-up so the message reaches a closed phone. Never
    // includes message text or patient data (push services have no BAA).
    const pushTitle =
      parsed.data.priority === "stat"
        ? "STAT secure message"
        : parsed.data.priority === "urgent"
          ? "Urgent secure message"
          : "New secure message";
    for (const uid of notifyIds) {
      if (uid === me.id) continue;
      void notificationDeps().push.send(uid, { title: pushTitle }).catch(() => {});
    }
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
