import type { IStorage } from "../storage.js";
import { storage } from "../storage.js";
import { appendAudit } from "../audit.js";
import { getNotificationProfile } from "../config.js";
import { isModuleEnabled } from "../modules.js";
import { notificationDeps } from "./notifications.js";
import { smsAllowedForOrg } from "../integrations/gates.js";
import {
  deliverViaCoveringThread,
  forwardedAttachmentIds,
  type CoveringDelivery,
} from "./covering.js";

/**
 * PHI-free SMS fallback — the last-resort nudge when a STAT message is still
 * unacknowledged at the escalate step. Sent to the unresponsive recipient's
 * phone; the body carries NO PHI (a generic wake-up). Gated per-org by the
 * `statSmsFallback` setting (default ON) so the operator/developer can turn it
 * off. Without SMS credentials the carrier adapter is the recording console
 * stub outside production; in production it fails closed (typed
 * sms_unavailable throw — see services/sms.ts), which lands in the catch below:
 * no sms_history row, `false` returned. Errors never interrupt the sweep.
 */
async function sendStatSmsFallback(
  s: IStorage,
  orgId: number,
  userId: number,
): Promise<boolean> {
  if ((await s.getOrgSetting(orgId, "statSmsFallback")) === false) return false;
  // SMS switched off for the org (Settings → Integrations → Twilio).
  if (!(await smsAllowedForOrg(orgId))) return false;
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
 *                                 deliver the message to them in a sender ↔
 *                                 covering thread (see services/covering.ts —
 *                                 the original thread's membership is never
 *                                 changed), notify, and audit (risk high).
 *                                 The sender and the recipient get a
 *                                 STAT_ESCALATED frame whether or not anyone
 *                                 was covering.
 *
 * Each step fires exactly once per recipient (realerted_at / escalated_at on the
 * delivery row). No PHI leaves the system: pushes are generic wake-ups and audit
 * details carry ids only.
 *
 * MODULE SWITCH: the whole loop is the `messaging.escalation` module. The HTTP
 * module gate cannot reach a background timer, so the sweep checks the switch
 * itself, once per org per sweep, and skips every row of an org that has it
 * off — no re-alert, no escalation, no SMS nudge, no audit row, and the
 * delivery rows are left untouched (so switching the module back on resumes
 * the loop for anything still unacknowledged).
 */

const REALERT_MS_DEFAULT = 2 * 60_000;
const ESCALATE_MS_DEFAULT = 5 * 60_000;
export const ESCALATION_MODULE = "messaging.escalation";

function positiveMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
/**
 * The re-alert / escalation intervals the sweep applies: STAT_REALERT_MS /
 * STAT_ESCALATE_MS when they are positive integers, else 2 / 5 minutes. ONE
 * reader for the sweep and for GET /api/settings, so the client's countdown
 * (A.CON-MIN-18) can never promise a different schedule than the server runs.
 */
export function statEscalationTimings(): { realertMs: number; escalateMs: number } {
  return {
    realertMs: positiveMs(process.env.STAT_REALERT_MS, REALERT_MS_DEFAULT),
    escalateMs: positiveMs(process.env.STAT_ESCALATE_MS, ESCALATE_MS_DEFAULT),
  };
}

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

export interface EscalationSweepResult {
  realerted: number;
  escalated: number;
  /** Unacked STAT delivery rows left alone because their org has the module off. */
  skippedModuleOff: number;
}

// Orgs whose "module off" state has already been logged this process — the
// sweep runs every 15 s, so log on the transition, not every tick.
const loggedOff = new Set<number>();

export async function runStatEscalationSweep(
  s: IStorage,
  opts: EscalationOptions = {},
): Promise<EscalationSweepResult> {
  const timings = statEscalationTimings();
  const realertMs = opts.realertMs ?? timings.realertMs;
  const escalateMs = opts.escalateMs ?? timings.escalateMs;
  const deps = notificationDeps();
  const now = Date.now();
  let realerted = 0;
  let escalated = 0;
  let skippedModuleOff = 0;

  const rows = await s.listUnackedStatDeliveries();
  // Resolve the module switch once per org per sweep (the module cache is 5 s,
  // but the lookup is still a settings read per row without this).
  const enabledByOrg = new Map<number, boolean>();
  for (const row of rows) {
    let on = enabledByOrg.get(row.organizationId);
    if (on === undefined) {
      on = await isModuleEnabled(row.organizationId, ESCALATION_MODULE);
      enabledByOrg.set(row.organizationId, on);
      if (!on && !loggedOff.has(row.organizationId)) {
        loggedOff.add(row.organizationId);
        console.log(
          `[escalation] ${ESCALATION_MODULE} is off for org ${row.organizationId}: unacknowledged STAT deliveries are not re-alerted or escalated`,
        );
      }
      if (on) loggedOff.delete(row.organizationId);
    }
    if (!on) {
      skippedModuleOff++;
      continue; // before ANY side effect
    }

    const age = now - new Date(row.createdAt).getTime();

    // Step 1 — re-alert the original recipient.
    if (age >= realertMs && !row.realertedAt) {
      const realertedAt = new Date();
      await s.markDeliveryRealerted(row.deliveryId, realertedAt);
      // To the recipient (the nudge) and the sender (their countdown moves on,
      // A.CON-MIN-18). Ids only; `userId` = who was re-alerted, `at` = the
      // stored realertedAt.
      deps.ws.sendToUsers(Array.from(new Set([row.userId, row.senderId])), {
        type: "STAT_REALERT",
        messageId: row.messageId,
        conversationId: row.conversationId,
        userId: row.userId,
        at: realertedAt.toISOString(),
      });
      await deps.push
        .send(row.userId, { title: "STAT message awaiting your acknowledgement" })
        .catch(() => {});
      realerted++;
    }

    // Step 2 — escalate to the covering provider.
    if (age >= escalateMs && !row.escalatedAt) {
      const escalatedAt = new Date();
      const coveringId = await resolveCovering(
        s,
        row.organizationId,
        row.userId,
      );
      let delivery: CoveringDelivery | null = null;
      // The sweep created the covering provider's delivery row on the original
      // message (a thread member who had none) — the sender's open thread
      // re-reads once to show it.
      let coveringRowAdded = false;
      if (coveringId != null && coveringId !== row.senderId) {
        const [convo, message, sender, unresponsive] = await Promise.all([
          s.getConversation(row.organizationId, row.conversationId),
          s.getMessage(row.organizationId, row.messageId),
          s.getUser(row.organizationId, row.senderId),
          s.getUser(row.organizationId, row.userId),
        ]);
        if (convo && message && sender) {
          if (convo.participantIds.includes(coveringId)) {
            // Already a member of the thread (e.g. a care-team group): they
            // hold the message already — make sure it shows unread for them
            // and re-enters this sweep if they don't ack either.
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
              coveringRowAdded = true;
            }
            delivery = {
              conversationId: row.conversationId,
              messageId: row.messageId,
              createdThread: false,
              duplicate: false,
            };
          } else {
            // Not a member: deliver a provenance-stamped copy in the sender ↔
            // covering thread. Never joins them to the original conversation.
            const attachmentIds = (
              await s.listAttachmentsForMessages(row.organizationId, [message.id])
            )
              .map((a) => a.id)
              .concat(forwardedAttachmentIds(message));
            delivery = await deliverViaCoveringThread(s, {
              orgId: row.organizationId,
              sender,
              original: message,
              originalConvo: convo,
              coveringFor: row.userId,
              coveringForName: unresponsive?.displayName ?? "",
              coveringId,
              reason: "escalation",
              attachmentIds,
            });
          }
          deps.ws.sendToUsers([coveringId], {
            type: "STAT_ESCALATED",
            // Where the covering provider can open it (the copy's thread when
            // they are not a member of the original).
            messageId: delivery.messageId,
            conversationId: delivery.conversationId,
            originalMessageId: row.messageId,
            originalConversationId: row.conversationId,
            forUserId: row.userId,
            escalatedAt: escalatedAt.toISOString(),
          });
          // The sender and the unresponsive recipient hear about it below —
          // NEVER through MESSAGE_ACK: nobody acknowledged anything, and a
          // covering provider who is a thread member already has a delivery
          // row a client would stamp "acknowledged" (A.CON-MIN-18).
          await deps.push
            .send(coveringId, { title: "Escalated STAT message needs attention" })
            .catch(() => {});
          escalated++;
        }
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
      await s.markDeliveryEscalated(row.deliveryId, escalatedAt);
      // The step ran — with or without a covering provider: the sender's and
      // the recipient's countdowns move to "Escalated" live (A.CON-MIN-18).
      // Ids only; `userId` = whose row escalated, `escalatedAt` = the stored
      // value, `coveringUserId` = who was handed the message (null: nobody).
      deps.ws.sendToUsers([row.senderId, row.userId], {
        type: "STAT_ESCALATED",
        messageId: row.messageId,
        conversationId: row.conversationId,
        userId: row.userId,
        escalatedAt: escalatedAt.toISOString(),
        coveringUserId: delivery != null ? coveringId : null,
        coveringRowAdded,
      });
      await appendAudit({
        organizationId: row.organizationId,
        userId: null,
        action:
          delivery != null
            ? "message.stat_escalated"
            : "message.stat_escalation_no_covering",
        resourceType: "message",
        resourceId: row.messageId,
        details: {
          unresponsiveUserId: row.userId,
          coveringUserId: coveringId,
          // Ids only: where the covering provider received it.
          coveringConversationId: delivery?.conversationId ?? null,
          coveringMessageId: delivery?.messageId ?? null,
          smsFallback: smsSent,
        },
        riskLevel: "high",
      });
    }
  }
  return { realerted, escalated, skippedModuleOff };
}

let timer: NodeJS.Timeout | null = null;
export function startStatEscalationLoop(intervalMs = 15_000) {
  if (timer) return;
  timer = setInterval(() => {
    // Thresholds come from statEscalationTimings() (the same values
    // GET /api/settings reports to clients).
    runStatEscalationSweep(storage()).catch((err) =>
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
