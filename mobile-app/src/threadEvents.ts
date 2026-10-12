/**
 * Pure thread-state updates for the realtime frames the Messages screen
 * handles. No React Native imports, so the root vitest suite exercises these
 * against the server's real frames (tests/mobile-thread-events.test.ts).
 *
 * Frames carry ids only — never message content.
 */

/** The fields of a thread message these helpers read (MobileMessage satisfies it). */
export interface ThreadMessage {
  id: number;
  conversationId: number;
  senderId: number;
  deletedAt?: string | null;
  readCount?: number;
  ackCount?: number;
}

/** Sent by DELETE /api/messaging/messages/:id to every participant. */
export interface RecalledFrame {
  type: "MESSAGE_RECALLED";
  conversationId: number;
  messageId: number;
}

/** Sent by POST /api/messaging/messages/mark-read to the thread's other participants. */
export interface ReadFrame {
  type: "MESSAGE_READ";
  conversationId: number;
  messageIds: number[];
  userId: number;
}

export function isRecalledFrame(f: unknown): f is RecalledFrame {
  const o = f as Partial<RecalledFrame> | null;
  return !!o && o.type === "MESSAGE_RECALLED" && typeof o.messageId === "number" && typeof o.conversationId === "number";
}

export function isReadFrame(f: unknown): f is ReadFrame {
  const o = f as Partial<ReadFrame> | null;
  return (
    !!o &&
    o.type === "MESSAGE_READ" &&
    typeof o.conversationId === "number" &&
    typeof o.userId === "number" &&
    Array.isArray(o.messageIds)
  );
}

/**
 * Drop a recalled message from the open thread at once (the server no longer
 * lists it). Returns the SAME array when nothing changes, so a frame for
 * another thread does not re-render this one.
 */
export function applyRecall<M extends ThreadMessage>(
  messages: M[],
  openConversationId: number | null,
  frame: RecalledFrame,
): M[] {
  if (openConversationId == null || frame.conversationId !== openConversationId) return messages;
  const next = messages.filter((m) => m.id !== frame.messageId);
  return next.length === messages.length ? messages : next;
}

/**
 * Another participant read some of MY messages: bump their read count so the
 * receipt reads "Read" and the Recall control disappears (a read message can
 * no longer be recalled — the server answers 409 already_read). The server
 * sends this only for newly-read rows, so one frame = one more reader.
 */
export function applyRead<M extends ThreadMessage>(
  messages: M[],
  openConversationId: number | null,
  myUserId: number,
  frame: ReadFrame,
): M[] {
  if (openConversationId == null || frame.conversationId !== openConversationId) return messages;
  if (frame.userId === myUserId) return messages;
  const ids = new Set(frame.messageIds);
  let changed = false;
  const next = messages.map((m) => {
    if (!ids.has(m.id) || m.senderId !== myUserId) return m;
    changed = true;
    return { ...m, readCount: (m.readCount ?? 0) + 1 };
  });
  return changed ? next : messages;
}

/**
 * Same rule the web app and the server apply: my own, still unread by anyone,
 * not acknowledged, not a broadcast, and the messaging.recall module on.
 */
export function canRecall(
  m: ThreadMessage,
  myUserId: number,
  recallEnabled: boolean,
  conversationType: string | undefined,
): boolean {
  return (
    recallEnabled &&
    conversationType !== "broadcast" &&
    m.senderId === myUserId &&
    !m.deletedAt &&
    (m.readCount ?? 0) === 0 &&
    (m.ackCount ?? 0) === 0
  );
}

/** A plain-language reason for a refused recall (server error code → text). */
export function recallErrorText(code: string): string {
  if (/already_read/.test(code)) return "It has already been read, so it can't be recalled.";
  if (/module_disabled/.test(code)) return "Message recall is switched off for your organization.";
  if (/forbidden/.test(code)) return "You can only recall your own messages.";
  return "Try again.";
}
