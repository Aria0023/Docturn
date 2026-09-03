import express, { type Express } from "express";
import {
  acknowledgeSchema,
  attachmentUploadSchema,
  createConversationSchema,
  createTemplateSchema,
  forwardMessageSchema,
  markReadSchema,
  sendMessageSchema,
  updateTemplateSchema,
  type Conversation,
  type Message,
  type User,
} from "@shared/schema";
import { appendAudit, logPhiAccess } from "../audit.js";
import { requireModule } from "../modules.js";
import { currentUser, requireAuth } from "../rbac.js";
import { isDnd, resolveCovering } from "../services/escalation.js";
import { notificationDeps } from "../services/notifications.js";
import { previewNext } from "../services/rotation.js";
import {
  AttachmentStoreError,
  attachmentStoreFor,
  getAttachmentStore,
} from "../services/attachment-store.js";
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

// Roles allowed to reach into a patient's care-team thread without a treatment
// relationship (clinical/administrative oversight). Their access is break-glass:
// permitted, but always audited at high risk.
const PATIENT_THREAD_OVERSIGHT_ROLES = new Set<string>([
  "director",
  "er_director",
  "developer",
]);

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

/**
 * Role/service addressing: resolve on-call roles to whoever currently holds
 * them, so a user can start a conversation with "the on-call cardiologist"
 * instead of hunting for a named person. Every read is scoped to the caller's
 * own org, and a target is ONLY returned when it resolves to a real messageable
 * user IN THAT ORG (never invented, never cross-tenant). Shared by the
 * on-call-targets listing and message forwarding (roleTarget).
 */
export async function resolveOnCallTargets(me: User): Promise<OnCallTarget[]> {
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

  return targets;
}

/**
 * Deliver a freshly created message to a conversation: a delivery row per
 * participant (the sender's own copy auto-read AND auto-acknowledged — you
 * don't ack your own STAT — so ackCount reflects only recipients), DND
 * forwarding to covering providers, the live WS fan-out and a content-free
 * push wake-up. Shared by send and forward. Returns the covering providers
 * the message was forwarded to.
 */
async function fanOutMessage(
  me: User,
  convo: Conversation,
  message: Message,
): Promise<number[]> {
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

  if (message.priority === "stat") {
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
    message.priority === "stat"
      ? "STAT secure message"
      : message.priority === "urgent"
        ? "Urgent secure message"
        : "New secure message";
  for (const uid of notifyIds) {
    if (uid === me.id) continue;
    void notificationDeps().push.send(uid, { title: pushTitle }).catch(() => {});
  }
  return forwardedTo;
}

// Roles that may create/edit/delete ORG-WIDE message templates.
const TEMPLATE_ORG_ROLES = new Set<string>(["director", "er_director", "developer"]);

/** Attachment ids a forwarded message carries by reference (ids only, no bytes). */
function forwardedAttachmentIds(m: Message): number[] {
  const ff = m.forwardedFrom as (Record<string, unknown> | null) | undefined;
  const ids = ff && Array.isArray(ff.attachmentIds) ? ff.attachmentIds : [];
  return ids.filter((x): x is number => Number.isInteger(x));
}

export function registerMessagingRoutes(app: Express) {
  app.get("/api/messaging/on-call-targets", requireAuth, async (req, res) => {
    res.json(await resolveOnCallTargets(currentUser(req)));
  });

  // Upload an attachment (image/file) as base64. Route-level 12 MB JSON parser
  // (the global cap is 1 MB — too small for uploads). Stored UNLINKED (message_id
  // NULL) until it's attached to a message at send time. Bytes go through the
  // attachment store (server/services/attachment-store.ts): the row's
  // data_base64 column holds the store's REF — inline base64 for the default
  // "db" store, "fsenc:<id>" for ATTACHMENT_STORE=fs-encrypted (AES-256-GCM
  // files, never plaintext). Object storage (S3/GCS) is the next step there.
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
      // Size-gate on the base64 length BEFORE decoding so an oversize body
      // never allocates a multi-megabyte buffer.
      if (base64ByteSize(parsed.data.dataBase64) > ATTACHMENT_MAX_BYTES) {
        return res.status(400).json({ error: "too_large" });
      }
      const bytes = Buffer.from(parsed.data.dataBase64, "base64");
      const byteSize = bytes.length;
      if (byteSize === 0) {
        return res.status(400).json({ error: "validation_error" });
      }
      let ref: string;
      try {
        ref = await getAttachmentStore().put(bytes, {
          organizationId: me.organizationId,
          uploaderId: me.id,
          fileName: parsed.data.fileName,
          mimeType: parsed.data.mimeType,
          byteSize,
        });
      } catch (err) {
        if (err instanceof AttachmentStoreError) {
          console.error("[attachments] store unavailable:", err.message);
          return res.status(503).json({ error: "attachment_store_unavailable" });
        }
        throw err;
      }
      const { id } = await storage().createAttachment({
        organizationId: me.organizationId,
        uploaderId: me.id,
        fileName: parsed.data.fileName,
        mimeType: parsed.data.mimeType,
        byteSize,
        dataBase64: ref,
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

    // Resolve the store FROM THE REF, so rows written while the "db" store was
    // active still serve after a switch to fs-encrypted (and vice versa).
    let bytes: Buffer;
    try {
      bytes = await attachmentStoreFor(att.dataBase64).get(att.dataBase64);
    } catch (err) {
      if (err instanceof AttachmentStoreError) {
        console.error("[attachments] fetch failed:", err.code, err.message);
        return res
          .status(err.code === "attachment_store_misconfigured" ? 503 : 404)
          .json({ error: err.code === "attachment_store_misconfigured" ? "attachment_store_unavailable" : "not_found" });
      }
      throw err;
    }

    res.setHeader("Content-Type", att.mimeType);
    // Never let a browser MIME-sniff user-uploaded bytes into something
    // executable, even though the upload allowlist already excludes HTML/JS.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      'inline; filename="' + att.fileName.replace(/"/g, "") + '"',
    );
    res.send(bytes);
  });

  // Availability of a peer, so a 1:1 thread can show an auto-response status:
  // whether they're do-not-disturb and, if so, who covers them, plus their
  // optional away message (user preference "awayMessage"). Operational (not
  // PHI); scoped to the caller's org. "off shift" comes from their hospitalist
  // working flag when they have one.
  app.get(
    "/api/messaging/availability/:userId",
    requireAuth,
    requireModule("messaging.dnd"),
    async (req, res) => {
      const me = currentUser(req);
      const userId = Number(req.params.userId);
      if (!Number.isInteger(userId)) {
        return res.status(400).json({ error: "bad_user" });
      }
      const user = await storage().getUser(me.organizationId, userId);
      if (!user) return res.status(404).json({ error: "not_found" });
      const dnd = await isDnd(storage(), userId);
      const awayRaw = await storage().getUserPreference(userId, "awayMessage");
      const awayMessage =
        typeof awayRaw === "string" && awayRaw.trim()
          ? awayRaw.trim().slice(0, 280)
          : null;
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
      res.json({
        userId,
        displayName: user.displayName,
        dnd,
        covering,
        working,
        awayMessage,
      });
    },
  );

  app.get("/api/messaging/conversations", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const convos = await storage().listConversationsForUser(
      me.organizationId,
      me.id,
    );
    // The list carries `lastMessage` (full content) for every thread, so it is a
    // PHI read too. One row for the whole listing — a per-thread fan-out would
    // bloat the log without telling an investigator anything more.
    await logPhiAccess(req, "conversations");
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
  // consultants. Idempotent: repeat calls reopen it (and refresh membership as
  // the care team grows).
  //
  // ACCESS CONTROL: the care team is computed BEFORE the caller is considered.
  // A caller who is not on it cannot self-join and read the thread's PHI —
  // only oversight roles may, and that is recorded as a break-glass access.
  app.post("/api/messaging/patient-thread", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const patientId = Number((req.body ?? {}).patientId);
    if (!Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({ error: "validation_error" });
    }
    const patient = await storage().getPatient(me.organizationId, patientId);
    if (!patient) return res.status(404).json({ error: "not_found" });

    // Assemble the LEGITIMATE care team (userIds, in-org by construction).
    // Deliberately does NOT include the caller — membership must be earned by a
    // real clinical relationship, not by asking for the thread.
    const careTeam = new Set<number>();
    // The patient's ER physician of record (set when the patient was admitted),
    // so an admitting ER doc is on the team even before routing produces an
    // assignment row.
    if (patient.erDoctorId) careTeam.add(patient.erDoctorId);
    const assignments = await storage().listAssignments(me.organizationId);
    for (const a of assignments) {
      if (a.patientId !== patientId) continue;
      if (a.erDoctorId) careTeam.add(a.erDoctorId);
      if (a.status === "accepted") {
        if (a.acceptedByUserId) careTeam.add(a.acceptedByUserId);
        const h = await storage().getHospitalist(
          me.organizationId,
          a.hospitalistId,
        );
        if (h?.userId) careTeam.add(h.userId);
      }
    }
    for (const c of await storage().listConsultsForPatient(
      me.organizationId,
      patientId,
    )) {
      if (c.status === "accepted" && c.consultantUserId)
        careTeam.add(c.consultantUserId);
    }

    const onCareTeam = careTeam.has(me.id);
    const hasOversight = PATIENT_THREAD_OVERSIGHT_ROLES.has(me.role);
    if (!onCareTeam && !hasOversight) {
      // No leak about whether a thread exists — the only signal above this
      // point is the pre-existing 404-on-missing-patient.
      return res.status(403).json({ error: "forbidden" });
    }
    // An oversight role reaching into a patient thread they have no treatment
    // relationship with is a break-glass access, audited as such below.
    const breakGlass = !onCareTeam && hasOversight;

    const members = new Set<number>(careTeam);
    members.add(me.id);

    /** Record an oversight role opening a thread they aren't on the team for. */
    async function auditBreakGlass(conversationId: number) {
      if (!breakGlass) return;
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "message.patient_thread_breakglass",
        resourceType: "conversation",
        resourceId: conversationId,
        details: { patientId, conversationId, role: me.role },
        riskLevel: "high",
      });
    }

    const existing = await storage().getConversationByPatient(
      me.organizationId,
      patientId,
    );
    if (existing) {
      // Membership follows the care team: add anyone new (incl. the requester).
      // EVERY addition is audited — joining a patient thread is a PHI grant.
      for (const uid of members) {
        if (!existing.participantIds.includes(uid)) {
          await storage().addConversationParticipant(
            me.organizationId,
            existing.id,
            uid,
          );
          await appendAudit({
            organizationId: me.organizationId,
            userId: me.id,
            action: "message.patient_thread_joined",
            resourceType: "conversation",
            resourceId: existing.id,
            details: { patientId, conversationId: existing.id, addedUserId: uid },
            riskLevel: "medium",
          });
        }
      }
      await auditBreakGlass(existing.id);
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
    await auditBreakGlass(convo.id);
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
      // This response carries full message bodies — a PHI read. Log it AFTER the
      // participant check (a rejected read discloses nothing, so it must not
      // create a PHI-access row) and exactly once for the whole thread.
      await logPhiAccess(req, "conversation-messages", {
        resourceId: id,
        patientId: convo.patientId ?? null,
      });
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
      // Forwarded messages carry attachments BY REFERENCE (ids in the
      // provenance blob); resolve their metadata too — served through the
      // forwarded-message fetch route so target participants can open them.
      const refIds = Array.from(
        new Set(msgs.flatMap((m) => forwardedAttachmentIds(m))),
      );
      const refMeta = await storage().listAttachmentMetaByIds(
        me.organizationId,
        refIds,
      );
      const refById = new Map(refMeta.map((a) => [a.id, a]));
      // Per-recipient status needs names; one roster read for the thread.
      const users = await storage().listUsers(me.organizationId);
      const nameById = new Map(users.map((u) => [u.id, u.displayName]));
      const out = msgs.map((m) => {
        const rows = delivery.filter((d) => d.messageId === m.id);
        const recipients = rows.filter((d) => d.userId !== m.senderId);
        const own = (byMsg[m.id] || []).map((a) => ({
          id: a.id,
          fileName: a.fileName,
          mimeType: a.mimeType,
          byteSize: a.byteSize,
          isImage: a.mimeType.startsWith("image/"),
          url: "/api/messaging/attachments/" + a.id,
        }));
        const forwarded = forwardedAttachmentIds(m)
          .map((aid) => refById.get(aid))
          .filter((a): a is NonNullable<typeof a> => !!a)
          .map((a) => ({
            id: a.id,
            fileName: a.fileName,
            mimeType: a.mimeType,
            byteSize: a.byteSize,
            isImage: a.mimeType.startsWith("image/"),
            forwarded: true,
            url: "/api/messaging/messages/" + m.id + "/attachments/" + a.id,
          }));
        return {
          ...m,
          ackCount: recipients.filter((d) => d.acknowledgedAt).length,
          readCount: recipients.filter((d) => d.readAt).length,
          acknowledgedByMe: rows.some(
            (d) => d.userId === me.id && !!d.acknowledgedAt,
          ),
          // Per-recipient delivery state (sent → delivered → read → acknowledged)
          // for the "Seen by N · Acked by M" disclosure in group threads.
          deliveries: recipients.map((d) => ({
            userId: d.userId,
            displayName: nameById.get(d.userId) ?? "",
            deliveredAt: d.deliveredAt,
            readAt: d.readAt,
            acknowledgedAt: d.acknowledgedAt,
            status: d.acknowledgedAt
              ? "acknowledged"
              : d.readAt
                ? "read"
                : d.deliveredAt
                  ? "delivered"
                  : "sent",
          })),
          attachments: own.concat(forwarded),
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

    // Delivery rows, DND forwarding, WS fan-out + push (see fanOutMessage).
    const forwardedTo = await fanOutMessage(me, convo, message);
    res.status(201).json({ ...message, forwardedTo });
  });

  // Forward an existing message into another thread (server-backed, with
  // provenance). Target: an existing conversation, a set of people (direct or
  // group thread created/reused), or an on-call role resolved exactly like
  // /api/messaging/on-call-targets. Attachments are carried by REFERENCE (ids
  // only — bytes are never duplicated) and served to the target thread's
  // participants through the forwarded-message fetch route below.
  app.post(
    "/api/messaging/messages/:id/forward",
    requireAuth,
    requireModule("messaging.forwarding"),
    async (req, res) => {
      const me = currentUser(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(404).json({ error: "not_found" });
      const parsed = forwardMessageSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });

      const original = await storage().getMessage(me.organizationId, id);
      if (!original || original.deletedAt) {
        return res.status(404).json({ error: "not_found" });
      }
      const source = await storage().getConversation(
        me.organizationId,
        original.conversationId,
      );
      // Only a participant of the source thread may forward out of it.
      if (!source || !source.participantIds.includes(me.id)) {
        return res.status(403).json({ error: "forbidden" });
      }

      // Resolve the target conversation.
      let target: Conversation | undefined;
      let createdConversation = false;
      if (parsed.data.conversationId != null) {
        target = await storage().getConversation(
          me.organizationId,
          parsed.data.conversationId,
        );
        if (!target) return res.status(404).json({ error: "target_not_found" });
        if (!target.participantIds.includes(me.id)) {
          return res.status(403).json({ error: "forbidden" });
        }
      } else {
        let participantIds: number[];
        let name: string | null = null;
        if (parsed.data.roleTarget) {
          const t = (await resolveOnCallTargets(me)).find(
            (x) => x.id === parsed.data.roleTarget,
          );
          if (!t) return res.status(404).json({ error: "role_unresolved" });
          participantIds = [t.userId];
          name = t.label;
        } else {
          participantIds = parsed.data.participantIds ?? [];
          for (const pid of participantIds) {
            const u = await storage().getUser(me.organizationId, pid);
            if (!u) return res.status(400).json({ error: "participant_not_in_org" });
          }
        }
        const members = Array.from(new Set([me.id, ...participantIds]));
        if (members.length < 2) {
          return res.status(400).json({ error: "no_recipients" });
        }
        // Reuse the existing 1:1 thread with that person rather than opening a
        // duplicate direct conversation.
        if (members.length === 2) {
          const other = members.find((m) => m !== me.id)!;
          const existing = (
            await storage().listConversationsForUser(me.organizationId, me.id)
          ).find(
            (c) =>
              c.type === "direct" &&
              c.participantIds.length === 2 &&
              c.participantIds.includes(other),
          );
          if (existing) target = existing;
        }
        if (!target) {
          target = await storage().createConversation({
            organizationId: me.organizationId,
            type: members.length > 2 ? "group" : "direct",
            name,
            participantIds: members,
            patientId: null,
          });
          createdConversation = true;
        }
      }
      if (target.id === source.id) {
        return res.status(400).json({ error: "same_conversation" });
      }

      const author = await storage().getUser(me.organizationId, original.senderId);
      const attachmentIds = (
        await storage().listAttachmentsForMessages(me.organizationId, [original.id])
      )
        .map((a) => a.id)
        // A forward of a forward keeps pointing at the ORIGINAL bytes.
        .concat(forwardedAttachmentIds(original));
      const note = parsed.data.note?.trim();
      const message = await storage().createMessage({
        conversationId: target.id,
        organizationId: me.organizationId,
        senderId: me.id,
        content: (note ? note + "\n" : "") + original.content,
        priority: parsed.data.keepPriority ? original.priority : "routine",
        forwardedFrom: {
          messageId: original.id,
          senderId: original.senderId,
          senderName: author?.displayName ?? "",
          conversationId: source.id,
          sentAt: new Date(original.createdAt).toISOString(),
          ...(attachmentIds.length ? { attachmentIds } : {}),
        },
      });
      const forwardedTo = await fanOutMessage(me, target, message);
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "message.forward",
        resourceType: "message",
        resourceId: message.id,
        details: {
          sourceMessageId: original.id,
          sourceConversationId: source.id,
          targetConversationId: target.id,
          attachmentIds,
          priority: message.priority,
        },
        riskLevel: "medium",
      });
      res.status(201).json({
        ...message,
        conversationId: target.id,
        createdConversation,
        forwardedTo,
      });
    },
  );

  // Bytes of an attachment carried by reference on a forwarded message. Access
  // is participant-only on the FORWARDED message's conversation, and the
  // attachment must actually be referenced by that message (no id guessing).
  app.get(
    "/api/messaging/messages/:id/attachments/:attId",
    requireAuth,
    requireModule("messaging.forwarding"),
    async (req, res) => {
      const me = currentUser(req);
      const id = Number(req.params.id);
      const attId = Number(req.params.attId);
      if (!Number.isInteger(id) || !Number.isInteger(attId)) {
        return res.status(404).json({ error: "not_found" });
      }
      const msg = await storage().getMessage(me.organizationId, id);
      if (!msg || msg.deletedAt || !forwardedAttachmentIds(msg).includes(attId)) {
        return res.status(404).json({ error: "not_found" });
      }
      const convo = await storage().getConversation(
        me.organizationId,
        msg.conversationId,
      );
      if (!convo || !convo.participantIds.includes(me.id)) {
        return res.status(403).json({ error: "forbidden" });
      }
      const att = await storage().getAttachment(me.organizationId, attId);
      if (!att) return res.status(404).json({ error: "not_found" });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "message.attachment_view",
        resourceType: "attachment",
        resourceId: att.id,
        details: { messageId: msg.id, via: "forward" },
        riskLevel: "low",
      });
      res.setHeader("Content-Type", att.mimeType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Disposition",
        'inline; filename="' + att.fileName.replace(/"/g, "") + '"',
      );
      res.send(Buffer.from(att.dataBase64, "base64"));
    },
  );

  // ── Message templates ──────────────────────────────────────────────────────
  // Org-wide templates (ownerUserId NULL) are managed by directors/ER
  // directors/developers; personal ones by their owner. Everyone in the org
  // reads org-wide + their own.
  function templateView(t: { ownerUserId: number | null; [k: string]: unknown }, me: User) {
    const scope = t.ownerUserId == null ? "org" : "mine";
    const canEdit =
      scope === "mine" ? t.ownerUserId === me.id : TEMPLATE_ORG_ROLES.has(me.role);
    return { ...t, scope, canEdit };
  }
  app.get(
    "/api/messaging/templates",
    requireAuth,
    requireModule("messaging.templates"),
    async (req, res) => {
      const me = currentUser(req);
      const rows = await storage().listMessageTemplates(me.organizationId, me.id);
      res.json(rows.map((t) => templateView(t, me)));
    },
  );
  app.post(
    "/api/messaging/templates",
    requireAuth,
    requireModule("messaging.templates"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = createTemplateSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      if (parsed.data.scope === "org" && !TEMPLATE_ORG_ROLES.has(me.role)) {
        return res.status(403).json({ error: "forbidden" });
      }
      const row = await storage().createMessageTemplate({
        organizationId: me.organizationId,
        ownerUserId: parsed.data.scope === "org" ? null : me.id,
        title: parsed.data.title,
        body: parsed.data.body,
        priority: parsed.data.priority,
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "message.template_create",
        resourceType: "message_template",
        resourceId: row.id,
        details: { scope: parsed.data.scope },
        riskLevel: "low",
      });
      res.status(201).json(templateView(row, me));
    },
  );
  /** Owner may edit their own; org-wide only by the org-template roles. */
  async function loadEditableTemplate(me: User, rawId: string) {
    const id = Number(rawId);
    if (!Number.isInteger(id)) return { status: 404 as const };
    const t = await storage().getMessageTemplate(me.organizationId, id);
    if (!t) return { status: 404 as const };
    const allowed =
      t.ownerUserId == null
        ? TEMPLATE_ORG_ROLES.has(me.role)
        : t.ownerUserId === me.id;
    if (!allowed) return { status: 403 as const };
    return { status: 200 as const, template: t };
  }
  app.patch(
    "/api/messaging/templates/:id",
    requireAuth,
    requireModule("messaging.templates"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = updateTemplateSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const found = await loadEditableTemplate(me, String(req.params.id));
      if (found.status !== 200) {
        return res
          .status(found.status)
          .json({ error: found.status === 403 ? "forbidden" : "not_found" });
      }
      const row = await storage().updateMessageTemplate(
        me.organizationId,
        found.template.id,
        parsed.data,
      );
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "message.template_update",
        resourceType: "message_template",
        resourceId: found.template.id,
        details: { scope: found.template.ownerUserId == null ? "org" : "mine" },
        riskLevel: "low",
      });
      res.json(templateView(row!, me));
    },
  );
  app.delete(
    "/api/messaging/templates/:id",
    requireAuth,
    requireModule("messaging.templates"),
    async (req, res) => {
      const me = currentUser(req);
      const found = await loadEditableTemplate(me, String(req.params.id));
      if (found.status !== 200) {
        return res
          .status(found.status)
          .json({ error: found.status === 403 ? "forbidden" : "not_found" });
      }
      await storage().deleteMessageTemplate(me.organizationId, found.template.id);
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "message.template_delete",
        resourceType: "message_template",
        resourceId: found.template.id,
        details: { scope: found.template.ownerUserId == null ? "org" : "mine" },
        riskLevel: "low",
      });
      res.status(204).end();
    },
  );

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
