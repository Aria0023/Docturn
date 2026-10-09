import express, { type Express, type Request, type Response } from "express";
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
import { requireModule, isModuleEnabled } from "../modules.js";
import { currentUser, requireAuth } from "../rbac.js";
import { isDnd, resolveCovering } from "../services/escalation.js";
import {
  deliverViaCoveringThread,
  findDirectThread,
  forwardedAttachmentIds,
} from "../services/covering.js";
import { notificationDeps } from "../services/notifications.js";
import { previewNext } from "../services/rotation.js";
import {
  AttachmentStoreError,
  attachmentStoreFor,
  getAttachmentStore,
} from "../services/attachment-store.js";
import { MESSAGE_PAGE_DEFAULT, MESSAGE_PAGE_MAX, storage } from "../storage.js";
import { parseId } from "../params.js";

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
  // Voice messages (gated by the messaging.voice module, see the upload route).
  // MediaRecorder emits webm/opus on Chromium/Firefox and mp4/aac on Safari.
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/aac",
  "audio/wav",
]);
/** Max decoded attachment size (8 MB). */
const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
/** Voice-message ceilings. Opus at ~24 kbps is ~180 KB/min, so 3 min stays well
 *  under 5 MB; the duration cap is the real guardrail against unbounded audio.
 *  We never raise the shared 12 MB request-parser cap for audio. */
const VOICE_MAX_BYTES = 5 * 1024 * 1024;
const VOICE_MAX_DURATION_MS = 3 * 60 * 1000;
const isAudioMime = (m: string) => m.startsWith("audio/");

// Roles allowed to reach into a patient's care-team thread without a treatment
// relationship (clinical/administrative oversight). Their access is break-glass:
// permitted, but always audited at high risk.
const PATIENT_THREAD_OVERSIGHT_ROLES = new Set<string>([
  "director",
  "er_director",
  "developer",
]);

/** Attachment metadata as the listing queries select it (never the bytes). */
interface AttachmentMeta {
  id: number;
  fileName: string;
  mimeType: string;
  byteSize: number;
  durationMs: number | null;
}

/**
 * Client-facing attachment metadata — ONE shape for the thread view and the
 * live MESSAGE_RECEIVED frame, so a message rendered from either is identical.
 * `forwarded` marks a by-reference attachment of a forwarded message (served
 * through the forwarded-message fetch route).
 */
function attachmentView(a: AttachmentMeta, url: string, forwarded = false) {
  return {
    id: a.id,
    fileName: a.fileName,
    mimeType: a.mimeType,
    byteSize: a.byteSize,
    isImage: a.mimeType.startsWith("image/"),
    isAudio: a.mimeType.startsWith("audio/"),
    durationMs: a.durationMs ?? null,
    ...(forwarded ? { forwarded: true } : {}),
    url,
  };
}

/** A recipient's delivery row as the thread view and the live frame serve it. */
function deliveryView(
  d: {
    userId: number;
    deliveredAt: Date | null;
    readAt: Date | null;
    acknowledgedAt: Date | null;
    realertedAt?: Date | null;
    escalatedAt?: Date | null;
  },
  nameById: Map<number, string>,
) {
  return {
    userId: d.userId,
    displayName: nameById.get(d.userId) ?? "",
    deliveredAt: d.deliveredAt,
    readAt: d.readAt,
    acknowledgedAt: d.acknowledgedAt,
    // When the STAT sweep re-alerted / escalated this recipient (null = not
    // yet) — the sender's countdown shows what has actually happened.
    realertedAt: d.realertedAt ?? null,
    escalatedAt: d.escalatedAt ?? null,
    status: d.acknowledgedAt
      ? "acknowledged"
      : d.readAt
        ? "read"
        : d.deliveredAt
          ? "delivered"
          : "sent",
  };
}

/**
 * The just-created message decorated like one row of GET
 * /conversations/:id/messages (minus the viewer-specific acknowledgedByMe),
 * for the live MESSAGE_RECEIVED frame (A.CON-SHO-65). With the attachments and
 * delivery rows in the frame a client can apply the message directly instead
 * of re-fetching every conversation — and writing a PHI-access row per thread
 * — on each event. Metadata and ids only; never attachment bytes.
 */
async function liveMessageView(orgId: number, message: Message) {
  const [own, delivery, users] = await Promise.all([
    storage().listAttachmentsForMessages(orgId, [message.id]),
    storage().listDeliveryForMessages([message.id]),
    storage().listUsers(orgId),
  ]);
  const refs = await storage().listAttachmentMetaByIds(orgId, forwardedAttachmentIds(message));
  const refById = new Map(refs.map((a) => [a.id, a]));
  const nameById = new Map(users.map((u) => [u.id, u.displayName]));
  const recipients = delivery.filter((d) => d.userId !== message.senderId);
  return {
    ...message,
    ackCount: recipients.filter((d) => d.acknowledgedAt).length,
    readCount: recipients.filter((d) => d.readAt).length,
    deliveries: recipients.map((d) => deliveryView(d, nameById)),
    attachments: own
      .map((a) => attachmentView(a, "/api/messaging/attachments/" + a.id))
      .concat(
        forwardedAttachmentIds(message)
          .map((aid) => refById.get(aid))
          .filter((a): a is NonNullable<typeof a> => !!a)
          .map((a) =>
            attachmentView(a, "/api/messaging/messages/" + message.id + "/attachments/" + a.id, true),
          ),
      ),
  };
}

/**
 * Messages decorated as GET /conversations/:id/messages serves them to
 * `viewerId`: ack/read counts, acknowledgedByMe, recipient delivery rows and
 * attachment metadata (never bytes; forwarded ones by reference). Shared by
 * the thread route and the reconnect resync so both render identically.
 */
async function threadRows(orgId: number, viewerId: number, msgs: Message[]) {
  if (msgs.length === 0) return [];
  const ids = msgs.map((m) => m.id);
  const [delivery, atts, users] = await Promise.all([
    storage().listDeliveryForMessages(ids),
    storage().listAttachmentsForMessages(orgId, ids),
    storage().listUsers(orgId),
  ]);
  const byMsg: Record<number, typeof atts> = {};
  for (const a of atts) {
    if (a.messageId == null) continue;
    (byMsg[a.messageId] ||= []).push(a);
  }
  // Forwarded messages carry attachments BY REFERENCE (ids in the provenance
  // blob); resolve their metadata too — served through the forwarded-message
  // fetch route so target participants can open them.
  const refIds = Array.from(new Set(msgs.flatMap((m) => forwardedAttachmentIds(m))));
  const refMeta = await storage().listAttachmentMetaByIds(orgId, refIds);
  const refById = new Map(refMeta.map((a) => [a.id, a]));
  const nameById = new Map(users.map((u) => [u.id, u.displayName]));
  return msgs.map((m) => {
    const rows = delivery.filter((d) => d.messageId === m.id);
    const recipients = rows.filter((d) => d.userId !== m.senderId);
    const own = (byMsg[m.id] || []).map((a) =>
      attachmentView(a, "/api/messaging/attachments/" + a.id),
    );
    const forwarded = forwardedAttachmentIds(m)
      .map((aid) => refById.get(aid))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) =>
        attachmentView(a, "/api/messaging/messages/" + m.id + "/attachments/" + a.id, true),
      );
    return {
      ...m,
      ackCount: recipients.filter((d) => d.acknowledgedAt).length,
      readCount: recipients.filter((d) => d.readAt).length,
      acknowledgedByMe: rows.some((d) => d.userId === viewerId && !!d.acknowledgedAt),
      // Per-recipient delivery state (sent → delivered → read → acknowledged)
      // for the "Seen by N · Acked by M" disclosure in group threads.
      deliveries: recipients.map((d) => deliveryView(d, nameById)),
      attachments: own.concat(forwarded),
    };
  });
}

/** Reconnect resync limits (GET /api/messaging/sync). */
const SYNC_MESSAGE_LIMIT = MESSAGE_PAGE_MAX;
const SYNC_RECEIPT_LIMIT = 1000;
const SYNC_OVERLAP_MS = 5000;

/** A message-id cursor: a non-negative integer (0 = "from the beginning"). */
function parseCursorId(v: unknown): number | null | "invalid" {
  if (v === undefined) return null;
  if (v === "0") return 0;
  const n = parseId(v);
  return n === null ? "invalid" : n;
}
/** A sync cursor: an ISO timestamp the server handed out. */
function parseCursorTime(v: unknown): number | "invalid" {
  if (typeof v !== "string" || v.length > 40) return "invalid";
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : "invalid";
}

/** Decoded byte length of a base64 string without allocating the buffer. */
function base64ByteSize(b64: string): number {
  const clean = b64.replace(/=+$/, "");
  return Math.floor((clean.length * 3) / 4);
}

/**
 * RFC 6266 Content-Disposition for an uploaded file name. Node refuses header
 * values with characters outside Latin-1 or with CR/LF (ERR_INVALID_CHAR), so
 * a raw CJK / Cyrillic / emoji name — or one with a stray newline — used to
 * make the attachment GET hang after the audit row was already written. Emit a
 * printable-ASCII `filename=` fallback and, when the name needs it, the RFC
 * 5987 `filename*=UTF-8''…` form every current browser prefers.
 */
export function contentDispositionInline(fileName: string): string {
  // Control characters can never be part of a header value.
  const clean = fileName.replace(/[\x00-\x1f\x7f]/g, "").trim() || "attachment";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  let out = `inline; filename="${ascii}"`;
  if (ascii !== clean) {
    try {
      // attr-char per RFC 5987: percent-encode everything else (as UTF-8).
      const ext = encodeURIComponent(clean).replace(
        /['()*]/g,
        (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
      );
      out += `; filename*=UTF-8''${ext}`;
    } catch {
      // Lone surrogates make encodeURIComponent throw; the ASCII fallback stands.
    }
  }
  return out;
}

/**
 * Parse a single `Range: bytes=a-b` / `a-` / `-n` header against a known
 * length (RFC 7233). Returns null when there is no usable range (absent,
 * malformed, multi-range or an a>b spec — all of which mean "send the whole
 * body with 200"), "unsatisfiable" when the start is past the end (416), or
 * the inclusive byte window to serve with 206.
 */
export function parseByteRange(
  header: string | undefined,
  total: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === "" && b === "") return null;
  if (a === "") {
    // Suffix range: the last n bytes.
    const n = Number(b);
    if (!Number.isSafeInteger(n)) return null;
    if (n === 0 || total === 0) return "unsatisfiable";
    return { start: Math.max(0, total - n), end: total - 1 };
  }
  const start = Number(a);
  if (!Number.isSafeInteger(start)) return null;
  if (start >= total) return "unsatisfiable";
  const requestedEnd = b === "" ? total - 1 : Number(b);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, total - 1) };
}

/**
 * Serve attachment bytes with a safe Content-Disposition and HTTP Range
 * support, so <audio> scrubbing works (browsers seek with Range requests and
 * refuse to seek without Accept-Ranges) and iOS Safari can probe the media
 * with its initial `bytes=0-1` request. Shared by both byte-serving routes.
 */
export function sendAttachmentBytes(
  req: Request,
  res: Response,
  att: { fileName: string; mimeType: string },
  bytes: Buffer,
) {
  res.setHeader("Content-Type", att.mimeType);
  // Never let a browser MIME-sniff user-uploaded bytes into something
  // executable, even though the upload allowlist already excludes HTML/JS.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", contentDispositionInline(att.fileName));
  res.setHeader("Accept-Ranges", "bytes");
  const total = bytes.length;
  const range = parseByteRange(req.headers.range, total);
  if (range === "unsatisfiable") {
    res.setHeader("Content-Range", `bytes */${total}`);
    return res.status(416).end();
  }
  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${total}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
    return res.end(bytes.subarray(range.start, range.end + 1));
  }
  res.setHeader("Content-Length", String(total));
  res.end(bytes);
}

/**
 * API shape of a conversation. A direct thread's stored `name` is the label
 * the CREATOR addressed it with ("Next hospitalist (Dr. X)") — never a shared
 * title: the other party would see a thread named after themselves. So for
 * direct threads `name` is served as null (each client then falls back to the
 * other participant's display name) and the label travels as `addressedAs`
 * for a secondary "addressed as …" line.
 */
function conversationView<T extends Conversation>(c: T) {
  if (c.type !== "direct") return { ...c, addressedAs: null as string | null };
  return { ...c, name: null as string | null, addressedAs: c.name ?? null };
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
  // covering provider gets THIS message forwarded to that provider, so nothing
  // sits unseen behind a DND flag (DND without forwarding is clinically
  // unsafe). The copy lands in a sender ↔ covering thread with provenance
  // (services/covering.ts) — the covering provider is NEVER joined to the
  // original conversation, so they see only messages sent while coverage is
  // active, never the thread's prior history, and nothing has to be undone
  // when coverage ends.
  const notifyIds = [...convo.participantIds];
  const forwardedTo: number[] = [];
  let attachmentIds: number[] | null = null;
  for (const uid of convo.participantIds) {
    if (uid === me.id) continue;
    if (!(await isDnd(storage(), uid))) continue;
    const coveringId = await resolveCovering(storage(), me.organizationId, uid);
    if (
      coveringId == null ||
      coveringId === me.id ||
      notifyIds.includes(coveringId) || // already a member: they have it
      forwardedTo.includes(coveringId)
    )
      continue;
    if (attachmentIds == null) {
      attachmentIds = (
        await storage().listAttachmentsForMessages(me.organizationId, [message.id])
      )
        .map((a) => a.id)
        .concat(forwardedAttachmentIds(message));
    }
    const dndUser = await storage().getUser(me.organizationId, uid);
    const delivery = await deliverViaCoveringThread(storage(), {
      orgId: me.organizationId,
      sender: me,
      original: message,
      originalConvo: convo,
      coveringFor: uid,
      coveringForName: dndUser?.displayName ?? "",
      coveringId,
      reason: "dnd",
      attachmentIds,
    });
    forwardedTo.push(coveringId);
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "message.dnd_forwarded",
      resourceType: "message",
      resourceId: message.id,
      details: {
        dndUserId: uid,
        coveringUserId: coveringId,
        // Ids only: the thread + copy the covering provider received.
        coveringConversationId: delivery.conversationId,
        coveringMessageId: delivery.messageId,
        createdThread: delivery.createdThread,
      },
      riskLevel: "medium",
    });
  }

  // The frame carries the message decorated like the thread view (attachment
  // metadata + recipient delivery rows) so clients apply it as-is (A.CON-SHO-65).
  notificationDeps().ws.sendToUsers(notifyIds, {
    type: "MESSAGE_RECEIVED",
    message: await liveMessageView(me.organizationId, message),
  });
  // Content-free push wake-up so the message reaches a closed phone. Never
  // includes message text or patient data (push services have no BAA). The
  // covering providers get the same wake-up for their copy.
  const pushTitle =
    message.priority === "stat"
      ? "STAT secure message"
      : message.priority === "urgent"
        ? "Urgent secure message"
        : "New secure message";
  for (const uid of notifyIds.concat(forwardedTo)) {
    if (uid === me.id) continue;
    void notificationDeps().push.send(uid, { title: pushTitle }).catch(() => {});
  }
  return forwardedTo;
}

// Roles that may create/edit/delete ORG-WIDE message templates.
const TEMPLATE_ORG_ROLES = new Set<string>(["director", "er_director", "developer"]);

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
      const audio = isAudioMime(parsed.data.mimeType);
      // Voice messages are a separately switchable capability. The central
      // moduleGate covers the attachments path as a whole (messaging.attachments);
      // audio additionally requires messaging.voice for the caller's org.
      if (audio && !(await isModuleEnabled(me.organizationId, "messaging.voice"))) {
        return res.status(404).json({ error: "module_disabled", module: "messaging.voice" });
      }
      // A voice clip over the duration ceiling is rejected before we touch bytes.
      if (audio && parsed.data.durationMs && parsed.data.durationMs > VOICE_MAX_DURATION_MS) {
        return res.status(400).json({ error: "too_long" });
      }
      // Size-gate on the base64 length BEFORE decoding so an oversize body
      // never allocates a multi-megabyte buffer. Audio uses a tighter ceiling.
      const maxBytes = audio ? VOICE_MAX_BYTES : ATTACHMENT_MAX_BYTES;
      if (base64ByteSize(parsed.data.dataBase64) > maxBytes) {
        return res.status(400).json({ error: "too_large" });
      }
      const bytes = Buffer.from(parsed.data.dataBase64, "base64");
      const byteSize = bytes.length;
      if (byteSize === 0) {
        return res.status(400).json({ error: "validation_error" });
      }
      const durationMs = audio ? parsed.data.durationMs ?? null : null;
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
        durationMs,
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "message.attachment_upload",
        resourceType: "attachment",
        resourceId: id,
        details: { mimeType: parsed.data.mimeType, byteSize, durationMs },
        riskLevel: "low",
      });
      res.status(201).json({
        id,
        fileName: parsed.data.fileName,
        mimeType: parsed.data.mimeType,
        byteSize,
        durationMs,
        isAudio: audio,
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

    sendAttachmentBytes(req, res, att, bytes);
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
    // Decorate with last message + unread count — two indexed reads for the
    // whole list, never a whole thread (A.CON-SHO-65). The last message is a
    // full thread row (receipts, my delivery row, attachment metadata), so a
    // client can show it as the thread's newest message without opening it.
    const ids = convos.map((c) => c.id);
    const [last, unread] = await Promise.all([
      storage().lastMessagesFor(me.organizationId, ids),
      storage().unreadCountsFor(me.organizationId, me.id, ids),
    ]);
    const lastRows = await threadRows(me.organizationId, me.id, Array.from(last.values()));
    const lastById = new Map(lastRows.map((m) => [m.conversationId, m]));
    res.json(
      convos.map((c) => ({
        ...conversationView(c),
        lastMessage: lastById.get(c.id) ?? null,
        unreadCount: unread.get(c.id) ?? 0,
      })),
    );
  });

  // Reconnect resync for the web client (A.CON-SHO-65): what changed in the
  // caller's conversations while its socket was down, replacing a re-read of
  // every thread that could have changed (each a PHI-access "read" the user
  // never made).
  //   ?after=<messageId>  newest message id the client holds: live messages
  //                       with a larger id come back, decorated like thread
  //                       rows, at most SYNC_MESSAGE_LIMIT (`more` = call again
  //                       with the last id).
  //   ?since=<cursor>     the `cursor` of the client's previous sync: recipient
  //                       receipts (delivered/read/acknowledged, and the STAT
  //                       sweep's re-alert/escalation steps) on messages it
  //                       already holds, and recalls, since then.
  // Always: `cursor` for next time and a PHI-free per-thread summary (ids and
  // counters only). A response that carries no message content writes no
  // PHI-access row; one that does logs one row per thread it delivered, as
  // "conversation-sync" — a background delivery, not the user opening it.
  app.get("/api/messaging/sync", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const after = parseCursorId(req.query.after);
    const sinceMs = req.query.since === undefined ? null : parseCursorTime(req.query.since);
    if (after === "invalid" || sinceMs === "invalid") {
      return res.status(400).json({ error: "validation_error" });
    }
    // Taken BEFORE anything is read: a change racing this request is returned
    // again next time rather than lost.
    const cursor = new Date().toISOString();
    const orgId = me.organizationId;
    const convos = await storage().listConversationsForUser(orgId, me.id);
    const ids = convos.map((c) => c.id);
    const [last, unread] = await Promise.all([
      storage().lastMessagesFor(orgId, ids),
      storage().unreadCountsFor(orgId, me.id, ids),
    ]);
    const conversations = convos.map((c) => ({
      id: c.id,
      lastMessageId: last.get(c.id)?.id ?? null,
      unreadCount: unread.get(c.id) ?? 0,
    }));

    let messages: Awaited<ReturnType<typeof threadRows>> = [];
    let more = false;
    if (after !== null) {
      const page = await storage().listMessagesAfter(orgId, ids, after, SYNC_MESSAGE_LIMIT);
      more = page.hasMore;
      if (page.messages.length) {
        const byId = new Map(convos.map((c) => [c.id, c]));
        const delivered = Array.from(new Set(page.messages.map((m) => m.conversationId)));
        for (const cid of delivered) {
          await logPhiAccess(req, "conversation-sync", {
            resourceId: cid,
            patientId: byId.get(cid)?.patientId ?? null,
          });
        }
        messages = await threadRows(orgId, me.id, page.messages);
      }
    }

    let receipts: Array<ReturnType<typeof deliveryView> & { messageId: number; conversationId: number }> = [];
    let recalled: Array<{ messageId: number; conversationId: number }> = [];
    if (sinceMs !== null) {
      // A few seconds of overlap absorbs clock skew between app instances;
      // re-sent receipts/recalls are idempotent on the client.
      const since = new Date(sinceMs - SYNC_OVERLAP_MS);
      if (after !== null) {
        const rows = await storage().listReceiptChangesSince(orgId, ids, since, after, SYNC_RECEIPT_LIMIT);
        if (rows.length) {
          const users = await storage().listUsers(orgId);
          const nameById = new Map(users.map((u) => [u.id, u.displayName]));
          receipts = rows.map((d) => ({
            messageId: d.messageId,
            conversationId: d.conversationId,
            ...deliveryView(d, nameById),
          }));
        }
      }
      recalled = await storage().listRecalledSince(orgId, ids, since, SYNC_RECEIPT_LIMIT);
    }
    res.json({
      cursor,
      conversations,
      messages,
      receipts,
      recalled,
      more,
      // A capped receipt/recall list: the client re-reads open threads instead.
      complete: receipts.length < SYNC_RECEIPT_LIMIT && recalled.length < SYNC_RECEIPT_LIMIT,
    });
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
      // For a direct thread this is the creator's addressing label (e.g. the
      // on-call role picked), served back as `addressedAs` — see conversationView.
      name: parsed.data.name ?? null,
      participantIds,
      patientId: null,
    });
    res.status(201).json(conversationView(convo));
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
      // Paging (A.CON-SHO-65): ?limit (default 50, max 200) and ONE of
      // ?before=<messageId> (older page) / ?after=<messageId> (newer page).
      const limitRaw = req.query.limit;
      let limit = MESSAGE_PAGE_DEFAULT;
      if (limitRaw !== undefined) {
        const n = parseId(limitRaw);
        if (n === null) return res.status(400).json({ error: "validation_error" });
        limit = Math.min(n, MESSAGE_PAGE_MAX);
      }
      const before = req.query.before === undefined ? null : parseCursorId(req.query.before);
      const after = req.query.after === undefined ? null : parseCursorId(req.query.after);
      if (before === "invalid" || after === "invalid" || (before !== null && after !== null)) {
        return res.status(400).json({ error: "validation_error" });
      }
      const convo = await storage().getConversation(me.organizationId, id);
      if (!convo) return res.status(404).json({ error: "not_found" });
      if (!convo.participantIds.includes(me.id)) {
        return res.status(403).json({ error: "forbidden" });
      }
      // This response carries full message bodies — a PHI read. Log it AFTER the
      // participant check (a rejected read discloses nothing, so it must not
      // create a PHI-access row) and exactly once per page.
      await logPhiAccess(req, "conversation-messages", {
        resourceId: id,
        patientId: convo.patientId ?? null,
      });
      const page = await storage().listMessagesPage(me.organizationId, id, {
        limit,
        beforeId: before ?? undefined,
        afterId: after ?? undefined,
      });
      // More in the paging direction (older for a newest/before page, newer for
      // an after page) — the client's "Load earlier" / catch-up loop reads it.
      res.setHeader("X-Has-More", page.hasMore ? "1" : "0");
      res.json(await threadRows(me.organizationId, me.id, page.messages));
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
          target = await findDirectThread(storage(), me.organizationId, me.id, other);
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
      // Resolve the store FROM THE REF exactly like the primary attachment
      // route: under ATTACHMENT_STORE=fs-encrypted the column holds "fsenc:<id>",
      // not bytes — decoding it as base64 served 27 bytes of garbage.
      let bytes: Buffer;
      try {
        bytes = await attachmentStoreFor(att.dataBase64).get(att.dataBase64);
      } catch (err) {
        if (err instanceof AttachmentStoreError) {
          console.error("[attachments] forwarded fetch failed:", err.code, err.message);
          return res
            .status(err.code === "attachment_store_misconfigured" ? 503 : 404)
            .json({ error: err.code === "attachment_store_misconfigured" ? "attachment_store_unavailable" : "not_found" });
        }
        throw err;
      }
      sendAttachmentBytes(req, res, att, bytes);
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

  // Mark messages read for the caller, and tell the thread's other
  // participants live (A.CON-SHO-26) so a sender's receipt turns "Read" without
  // a reload. Only messages that were unread IN THE CALLER'S OWN delivery row
  // produce a frame: a repeat call is silent, and nobody can fake a receipt for
  // a message they never received. The frame carries ids only, never content.
  app.post("/api/messaging/messages/mark-read", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = markReadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const before = await storage().listDeliveryForMessages(parsed.data.messageIds);
    const newlyRead = Array.from(
      new Set(before.filter((d) => d.userId === me.id && !d.readAt).map((d) => d.messageId)),
    );
    await storage().markRead(me.id, parsed.data.messageIds);
    if (newlyRead.length) {
      const readAt = new Date().toISOString();
      const byConvo = new Map<number, number[]>();
      for (const mid of newlyRead) {
        const msg = await storage().getMessage(me.organizationId, mid);
        if (!msg || msg.deletedAt || msg.senderId === me.id) continue;
        const ids = byConvo.get(msg.conversationId) ?? [];
        ids.push(mid);
        byConvo.set(msg.conversationId, ids);
      }
      for (const [conversationId, messageIds] of byConvo) {
        const convo = await storage().getConversation(me.organizationId, conversationId);
        if (!convo) continue;
        const others = convo.participantIds.filter((uid) => uid !== me.id);
        if (!others.length) continue;
        notificationDeps().ws.sendToUsers(others, {
          type: "MESSAGE_READ",
          conversationId,
          messageIds,
          userId: me.id,
          readAt,
        });
      }
    }
    res.status(204).end();
  });

  // Recall (unsend) a message the caller sent. The advertised rule — module
  // blurb "Sender can recall an unread message" — is enforced here: once any
  // recipient has read it (or a covering copy of it), it can no longer be
  // recalled (409 already_read). A recall removes the message AND every
  // covering copy made of it, and tells every affected thread live so an open
  // conversation drops it immediately instead of on the next re-hydrate.
  app.delete("/api/messaging/messages/:id", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: "not_found" });
    const msg = await storage().getMessage(me.organizationId, id);
    if (!msg) return res.status(404).json({ error: "not_found" });
    if (msg.senderId !== me.id) {
      return res.status(403).json({ error: "forbidden" });
    }
    // Idempotent: a retry after a lost 204 is not an error and is not re-audited.
    if (msg.deletedAt) return res.status(204).end();

    const copies = await storage().listCoveringCopies(me.organizationId, id);
    const targets = [msg, ...copies];
    const delivery = await storage().listDeliveryForMessages(targets.map((t) => t.id));
    const recipientRows = delivery.filter((d) => d.userId !== me.id);
    const readBy = new Set(recipientRows.filter((d) => d.readAt).map((d) => d.userId));
    if (readBy.size > 0) {
      return res.status(409).json({ error: "already_read", readBy: readBy.size });
    }

    for (const t of targets) {
      await storage().softDeleteMessage(me.organizationId, t.id);
    }
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "message.delete",
      resourceType: "message",
      resourceId: id,
      details: {
        conversationId: msg.conversationId,
        recipients: new Set(recipientRows.map((d) => d.userId)).size,
        coveringCopies: copies.map((c) => c.id),
      },
      riskLevel: "low",
    });
    // Live removal in every thread that held it (same pattern as the ack route).
    for (const t of targets) {
      const convo = await storage().getConversation(me.organizationId, t.conversationId);
      if (!convo) continue;
      notificationDeps().ws.sendToUsers(convo.participantIds, {
        type: "MESSAGE_RECALLED",
        messageId: t.id,
        conversationId: t.conversationId,
        userId: me.id,
      });
    }
    res.status(204).end();
  });
}
