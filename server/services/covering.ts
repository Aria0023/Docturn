import type { Conversation, ForwardedFrom, Message, User } from "@shared/schema";
import type { IStorage } from "../storage.js";
import { notificationDeps } from "./notifications.js";

/**
 * Covering-provider delivery WITHOUT joining the covering provider to the
 * original thread.
 *
 * Both DND forwarding (at send time) and STAT escalation (from the sweep) used
 * to `addConversationParticipant(covering)` on the ORIGINAL conversation. For a
 * private 1:1 thread that silently turned it into a 3-person "group", exposed
 * the full prior history to the covering provider, kept delivering every later
 * message to them, and offered no removal path once coverage ended.
 *
 * Instead, the message is COPIED into a direct thread between the original
 * sender and the covering provider (reused when it already exists — the same
 * reuse rule the forward route applies). The copy carries provenance in
 * `forwardedFrom` ({ messageId, senderId, senderName, conversationId, sentAt,
 * coveringFor, coveringForName, reason, attachmentIds }) so the covering
 * provider sees WHO they are covering for and WHERE the message came from, and
 * attachments travel by reference exactly like a user forward. The covering
 * provider therefore sees only messages sent while coverage is active — never
 * the pre-DND history — and the original thread's membership never changes.
 */

/** Attachment ids a forwarded (or covering-copied) message carries by reference. */
export function forwardedAttachmentIds(m: Message): number[] {
  const ff = m.forwardedFrom as (Record<string, unknown> | null) | undefined;
  const ids = ff && Array.isArray(ff.attachmentIds) ? ff.attachmentIds : [];
  return ids.filter((x): x is number => Number.isInteger(x));
}

/** Provenance stamped on a covering copy (a superset of ForwardedFrom). */
export interface CoveringProvenance extends ForwardedFrom {
  /** The DND / unresponsive user the covering provider is standing in for. */
  coveringFor: number;
  coveringForName: string;
  reason: "dnd" | "escalation";
  attachmentIds?: number[];
}

/** Why a message reached the covering provider, if it is a covering copy. */
export function coveringReasonOf(m: Message): "dnd" | "escalation" | null {
  const ff = m.forwardedFrom as (Record<string, unknown> | null) | undefined;
  if (!ff || typeof ff.coveringFor !== "number") return null;
  return ff.reason === "dnd" || ff.reason === "escalation" ? ff.reason : null;
}

export interface CoveringDelivery {
  /** The sender ↔ covering-provider thread the copy lives in. */
  conversationId: number;
  /** The copy's message id (or the existing copy's, when one was already there). */
  messageId: number;
  createdThread: boolean;
  /** True when a copy of this message already existed in that thread. */
  duplicate: boolean;
}

export interface CoveringDeliveryInput {
  orgId: number;
  /** The ORIGINAL message's sender — the copy is sent on their behalf. */
  sender: User;
  original: Message;
  originalConvo: Conversation;
  /** The user whose covering provider receives the copy. */
  coveringFor: number;
  coveringForName: string;
  coveringId: number;
  reason: "dnd" | "escalation";
  /** Attachments of the original (own + by-reference), carried by reference. */
  attachmentIds: number[];
}

/** The existing 1:1 thread between two users in an org, if any. */
export async function findDirectThread(
  s: IStorage,
  orgId: number,
  userA: number,
  userB: number,
): Promise<Conversation | undefined> {
  return (await s.listConversationsForUser(orgId, userA)).find(
    (c) =>
      c.type === "direct" &&
      c.participantIds.length === 2 &&
      c.participantIds.includes(userB),
  );
}

export async function deliverViaCoveringThread(
  s: IStorage,
  input: CoveringDeliveryInput,
): Promise<CoveringDelivery> {
  const { orgId, sender, original, originalConvo, coveringId } = input;
  let thread = await findDirectThread(s, orgId, sender.id, coveringId);
  let createdThread = false;
  if (!thread) {
    thread = await s.createConversation({
      organizationId: orgId,
      type: "direct",
      name: null,
      participantIds: [sender.id, coveringId],
      patientId: null,
    });
    createdThread = true;
  }

  // Idempotent per (original message, covering thread): a STAT that was
  // DND-forwarded at send time and later escalates must not land twice.
  const existing = await s.findForwardedCopy(orgId, thread.id, original.id);
  if (existing) {
    return {
      conversationId: thread.id,
      messageId: existing.id,
      createdThread,
      duplicate: true,
    };
  }

  const provenance: CoveringProvenance = {
    messageId: original.id,
    senderId: sender.id,
    senderName: sender.displayName,
    conversationId: originalConvo.id,
    sentAt: new Date(original.createdAt).toISOString(),
    coveringFor: input.coveringFor,
    coveringForName: input.coveringForName,
    reason: input.reason,
    ...(input.attachmentIds.length ? { attachmentIds: input.attachmentIds } : {}),
  };
  const copy = await s.createMessage({
    conversationId: thread.id,
    organizationId: orgId,
    senderId: sender.id,
    content: original.content,
    priority: original.priority,
    forwardedFrom: provenance,
  });
  const now = new Date();
  await s.createDeliveryStatuses([
    {
      // The sender's own copy: auto-read + auto-acked, like any message they send.
      messageId: copy.id,
      userId: sender.id,
      deliveredAt: now,
      readAt: now,
      acknowledgedAt: now,
      realertedAt: null,
      escalatedAt: null,
    },
    {
      messageId: copy.id,
      userId: coveringId,
      deliveredAt: now,
      readAt: null,
      acknowledgedAt: null,
      // An escalation copy starts past the re-alert step and never escalates
      // onward from itself (no chain of escalations); a DND copy makes the
      // covering provider the primary recipient and goes through the full loop.
      realertedAt: input.reason === "escalation" ? now : null,
      escalatedAt: input.reason === "escalation" ? now : null,
    },
  ]);
  // Live update for both members of the covering thread (push is the caller's
  // job — it knows the right content-free title for the situation).
  notificationDeps().ws.sendToUsers([coveringId, sender.id], {
    type: "MESSAGE_RECEIVED",
    message: copy,
  });
  return {
    conversationId: thread.id,
    messageId: copy.id,
    createdThread,
    duplicate: false,
  };
}
