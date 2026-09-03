import type { IStorage } from "../storage.js";
import { storage } from "../storage.js";
import { appendAudit } from "../audit.js";
import { getNotificationProfile } from "../config.js";
import { notificationDeps } from "./notifications.js";

/**
 * PHI-free SMS fallback — the last-resort nudge when a STAT message is still
 * unacknowledged at the escalate step. Sent to the unresponsive recipient's
 * phone; the body carries NO PHI (a generic wake-up). Gated per-org by the
 * `statSmsFallback` setting (default ON) so the operator/developer can turn it
 * off. Without SMS credentials the carrier adapter is a no-op stub, so this is
 * always safe to call. Errors never interrupt the sweep.
 */
async function sendStatSmsFallback(
  s: IStorage,
  orgId: number,
  userId: number,
): Promise<boolean> {
  if ((await s.getOrgSetting(orgId, "statSmsFallback")) === false) return false;
  try {
    const user = await s.getUser(orgId, userId);
    if (!user?.phone) return false;
    const profile = await getNotificationProfile(orgId);
    const sms = notificationDeps().smsFor(profile.smsCarrier);
    const body = "Urgent DocTurn message needs your acknowledgement — open the app";
    await sms.send(user.phone, body);
    await storage().appendSmsHistory({
      organizationId: orgId,
      userId,
      toPhone: user.phone,
      body,
      carrier: sms.carrier,
    });
    return true;
  } catch (err) {
    console.error("[escalation] STAT SMS fallback failed", err);
    return false;
  }
}

/**
 * STAT escalation sweep — the PerfectServe-style non-response loop, driven by
 * ACKNOWLEDGEMENT (not read/delivery):
 *
 *   unacked after `realertMs`   → re-alert the recipient (WS + content-free push)
 *   unacked after `escalateMs`  → escalate to the recipient's covering provider:
 *                                 add them to the conversation, deliver the
 *                                 message to them, notify, and audit (risk high)
 *
 * Each step fires exactly once per recipient (realerted_at / escalated_at on the
 * delivery row). No PHI leaves the system: pushes are generic wake-ups and audit
 * details carry ids only.
 */

const REALERT_MS_DEFAULT = 2 * 60_000;
const ESCALATE_MS_DEFAULT = 5 * 60_000;

/** The covering provider a user designated (user_preferences.coveringUserId). */
export async function resolveCovering(
  s: IStorage,
  orgId: number,
  userId: number,
): Promise<number | null> {
  const raw = await s.getUserPreference(userId, "coveringUserId");
  const coveringId = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(coveringId) || coveringId <= 0 || coveringId === userId)
    return null;
  const u = await s.getUser(orgId, coveringId);
  return u ? u.id : null; // must be a real user in the SAME org
}

export async function isDnd(s: IStorage, userId: number): Promise<boolean> {
  return (await s.getUserPreference(userId, "dnd")) === true;
}

export interface EscalationOptions {
  realertMs?: number;
  escalateMs?: number;
}

export async function runStatEscalationSweep(
  s: IStorage,
  opts: EscalationOptions = {},
): Promise<{ realerted: number; escalated: number }> {
  const realertMs = opts.realertMs ?? REALERT_MS_DEFAULT;
  const escalateMs = opts.escalateMs ?? ESCALATE_MS_DEFAULT;
  const deps = notificationDeps();
  const now = Date.now();
  let realerted = 0;
  let escalated = 0;

  const rows = await s.listUnackedStatDeliveries();
  for (const row of rows) {
    const age = now - new Date(row.createdAt).getTime();

    // Step 1 — re-alert the original recipient.
    if (age >= realertMs && !row.realertedAt) {
      deps.ws.sendToUsers([row.userId], {
        type: "STAT_REALERT",
        messageId: row.messageId,
        conversationId: row.conversationId,
      });
      await deps.push
        .send(row.userId, { title: "STAT message awaiting your acknowledgement" })
        .catch(() => {});
      await s.markDeliveryRealerted(row.deliveryId);
      realerted++;
    }

    // Step 2 — escalate to the covering provider.
    if (age >= escalateMs && !row.escalatedAt) {
      const coveringId = await resolveCovering(
        s,
        row.organizationId,
        row.userId,
      );
      if (coveringId != null && coveringId !== row.senderId) {
        await s.addConversationParticipant(
          row.organizationId,
          row.conversationId,
          coveringId,
        );
        // Give the covering provider their own delivery row for THIS message so
        // it shows unread (and re-enters this sweep if they don't ack either).
        const existing = await s.listDeliveryForMessages([row.messageId]);
        if (!existing.some((d) => d.userId === coveringId)) {
          await s.createDeliveryStatuses([
            {
              messageId: row.messageId,
              userId: coveringId,
              deliveredAt: new Date(),
              readAt: null,
              acknowledgedAt: null,
              realertedAt: new Date(), // covering starts past the re-alert step
              escalatedAt: new Date(), // and never re-escalates from this row
            },
          ]);
        }
        deps.ws.sendToUsers([coveringId], {
          type: "STAT_ESCALATED",
          messageId: row.messageId,
          conversationId: row.conversationId,
          forUserId: row.userId,
        });
        deps.ws.sendToUsers([row.senderId, row.userId], {
          type: "MESSAGE_ACK", // reuse: nudges clients to re-hydrate the thread
          messageId: row.messageId,
          conversationId: row.conversationId,
          userId: coveringId,
        });
        await deps.push
          .send(coveringId, { title: "Escalated STAT message needs attention" })
          .catch(() => {});
        escalated++;
      }
      // Last-resort PHI-free SMS nudge to the unresponsive recipient (default
      // on; developer/operator can disable per org). No-op stub without creds.
      const smsSent = await sendStatSmsFallback(
        s,
        row.organizationId,
        row.userId,
      );
      // Mark even when no covering exists so the sweep doesn't retry forever;
      // the audit row records whether it went anywhere.
      await s.markDeliveryEscalated(row.deliveryId);
      await appendAudit({
        organizationId: row.organizationId,
        userId: null,
        action:
          coveringId != null
            ? "message.stat_escalated"
            : "message.stat_escalation_no_covering",
        resourceType: "message",
        resourceId: row.messageId,
        details: {
          unresponsiveUserId: row.userId,
          coveringUserId: coveringId,
          smsFallback: smsSent,
        },
        riskLevel: "high",
      });
    }
  }
  return { realerted, escalated };
}

let timer: NodeJS.Timeout | null = null;
export function startStatEscalationLoop(intervalMs = 15_000) {
  if (timer) return;
  const realertMs = Number(process.env.STAT_REALERT_MS) || undefined;
  const escalateMs = Number(process.env.STAT_ESCALATE_MS) || undefined;
  timer = setInterval(() => {
    runStatEscalationSweep(storage(), { realertMs, escalateMs }).catch((err) =>
      console.error("[escalation] sweep failed", err),
    );
  }, intervalMs);
  timer.unref?.();
}
export function stopStatEscalationLoop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
