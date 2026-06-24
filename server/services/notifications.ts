import type { Assignment } from "@shared/schema";
import { getNotificationProfile } from "../config.js";
import { storage } from "../storage.js";
import { smsFor, type SmsService } from "./sms.js";

/**
 * Out-of-app delivery. Push and SMS payloads carry NO PHI — only a generic
 * wake-up; the app fetches the body server-side over TLS. Every transport has a
 * stub default (no secrets); errors are swallowed and logged so the workflow
 * always continues (graceful degradation).
 *
 * Delivery model (05_WORKFLOWS.md §4): WebSocket → content-free push → after
 * ackTimeoutSec re-push → after escalationTimeoutSec, only if the org's mode
 * includes SMS, carrier SMS → optional voice → reroute. The escalation clock is
 * driven by ACKNOWLEDGEMENT, not send success.
 */
export interface PushTransport {
  send(userId: number, payload: { title: string }): Promise<void>;
}
export interface WsFanout {
  sendToUsers(userIds: number[], message: unknown): void;
  broadcast(orgId: number, message: unknown): void;
}

export class NoopPush implements PushTransport {
  sent: Array<{ userId: number; title: string }> = [];
  async send(userId: number, payload: { title: string }) {
    this.sent.push({ userId, title: payload.title });
  }
}

export class NoopWs implements WsFanout {
  delivered: Array<{ userIds: number[]; message: unknown }> = [];
  sendToUsers(userIds: number[], message: unknown) {
    this.delivered.push({ userIds, message });
  }
  broadcast(_orgId: number, _message: unknown) {}
}

export interface NotificationDeps {
  ws: WsFanout;
  push: PushTransport;
  /** Resolve an SMS adapter for a carrier (overridable in tests). */
  smsFor: (carrier: string) => SmsService;
}

let deps: NotificationDeps = {
  ws: new NoopWs(),
  push: new NoopPush(),
  smsFor,
};
export function configureNotifications(d: Partial<NotificationDeps>) {
  deps = { ...deps, ...d };
}
export function notificationDeps(): NotificationDeps {
  return deps;
}

/**
 * Tell every client in the org that assignment state changed (accept / reject /
 * reassign / cancel / expire / create), so the ER's sent board, the director's
 * board and hospitalists' pending lists all re-hydrate to the new truth. The
 * targeted ASSIGNMENT_CREATED push (notifyAssignment) still alerts the recipient.
 */
export function broadcastAssignmentChange(orgId: number) {
  try {
    deps.ws.broadcast(orgId, { type: "ASSIGNMENT_UPDATED" });
  } catch (err) {
    console.error("[notify] assignment broadcast failed", err);
  }
}

/** In-memory acknowledgement state, keyed by assignment id. */
const acked = new Set<number>();
export function acknowledgeAssignment(assignmentId: number) {
  acked.add(assignmentId);
}
export function isAcknowledged(assignmentId: number) {
  return acked.has(assignmentId);
}
export function _resetAcks() {
  acked.clear();
}

/**
 * Push-first delivery with timeout-gated SMS escalation. Returns immediately
 * after the live WS + content-free push; escalation runs on timers and is
 * cancelled the moment the assignment is acknowledged.
 */
export async function notifyAssignment(
  assignment: Assignment,
  targetUserIds: number[],
): Promise<void> {
  // 1. In-app, live (real).
  try {
    deps.ws.sendToUsers(targetUserIds, {
      type: "ASSIGNMENT_CREATED",
      assignment,
    });
  } catch (err) {
    console.error("[notify] ws failed", err);
  }

  // 2. Content-free push wake-up (no PHI).
  for (const userId of targetUserIds) {
    try {
      await deps.push.send(userId, { title: "New assignment" });
    } catch (err) {
      console.error("[notify] push failed", err);
    }
  }

  // 3 & 4. Schedule ack-gated escalation per the org delivery profile.
  const profile = await getNotificationProfile(assignment.organizationId);
  scheduleEscalation(assignment, targetUserIds, profile);
}

function scheduleEscalation(
  assignment: Assignment,
  targetUserIds: number[],
  profile: {
    mode: string;
    smsCarrier: string;
    ackTimeoutSec: number;
    escalationTimeoutSec: number;
  },
) {
  // Re-push after ackTimeout if still unacknowledged.
  const t1 = setTimeout(() => {
    if (isAcknowledged(assignment.id)) return;
    for (const userId of targetUserIds) {
      deps.push
        .send(userId, { title: "New assignment" })
        .catch((e) => console.error("[notify] re-push failed", e));
    }
  }, profile.ackTimeoutSec * 1000);
  t1.unref?.();

  // SMS after escalationTimeout, only if mode includes SMS and still unacked.
  if (profile.mode === "push") return;
  const t2 = setTimeout(() => {
    if (isAcknowledged(assignment.id)) return;
    void escalateSms(assignment, targetUserIds, profile.smsCarrier);
  }, profile.escalationTimeoutSec * 1000);
  t2.unref?.();
}

async function escalateSms(
  assignment: Assignment,
  targetUserIds: number[],
  carrier: string,
) {
  const sms = deps.smsFor(carrier);
  for (const userId of targetUserIds) {
    try {
      const user = await storage().getUserById(userId);
      if (!user?.phone) continue;
      // No PHI — generic wake-up + deep link at most.
      const body = "New DocTurn assignment — open the app";
      await sms.send(user.phone, body);
      await storage().appendSmsHistory({
        organizationId: assignment.organizationId,
        userId,
        toPhone: user.phone,
        body,
        carrier: sms.carrier,
      });
    } catch (err) {
      console.error("[notify] sms escalation failed", err);
    }
  }
}
