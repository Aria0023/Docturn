import type { Assignment } from "@shared/schema";

/**
 * Out-of-app delivery transports. Push and SMS payloads carry NO PHI — only a
 * generic wake-up; the app fetches the message body server-side over TLS.
 * Every transport has a stub default (no secrets); errors are swallowed and
 * logged so the workflow always continues (graceful degradation).
 */
export interface PushTransport {
  send(userId: number, payload: { title: string }): Promise<void>;
}
export interface SmsTransport {
  readonly carrier: string;
  send(phone: string, body: string): Promise<void>;
}

export class NoopPush implements PushTransport {
  sent: Array<{ userId: number; title: string }> = [];
  async send(userId: number, payload: { title: string }) {
    this.sent.push({ userId, title: payload.title });
  }
}

export class ConsoleSms implements SmsTransport {
  readonly carrier = "console";
  sent: Array<{ phone: string; body: string }> = [];
  async send(phone: string, body: string) {
    this.sent.push({ phone, body });
  }
}

export interface WsFanout {
  sendToUsers(userIds: number[], message: unknown): void;
  broadcast(orgId: number, message: unknown): void;
}

/** No-op fan-out used until the WS server is wired (M6) and in tests. */
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
  sms: SmsTransport;
}

let deps: NotificationDeps = {
  ws: new NoopWs(),
  push: new NoopPush(),
  sms: new ConsoleSms(),
};
export function configureNotifications(d: Partial<NotificationDeps>) {
  deps = { ...deps, ...d };
}
export function notificationDeps(): NotificationDeps {
  return deps;
}

/**
 * Push-first delivery: WS to the connected target, then a content-free push.
 * SMS/voice are escalation endpoints handled by the escalation scheduler when a
 * push goes unacknowledged — never on the routine path (see 05_WORKFLOWS.md §4).
 */
export async function notifyAssignment(
  assignment: Assignment,
  targetUserIds: number[],
): Promise<void> {
  try {
    deps.ws.sendToUsers(targetUserIds, {
      type: "ASSIGNMENT_CREATED",
      assignment,
    });
  } catch (err) {
    console.error("[notify] ws failed", err);
  }
  for (const userId of targetUserIds) {
    try {
      // Content-free wake-up only — no PHI.
      await deps.push.send(userId, { title: "New assignment" });
    } catch (err) {
      console.error("[notify] push failed", err);
    }
  }
}
