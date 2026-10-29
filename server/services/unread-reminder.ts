import { REMINDER_INTERVALS_MIN } from "@shared/schema";
import { pushAllowedForOrg } from "../integrations/gates.js";
import { isModuleEnabled } from "../modules.js";
import { storage, type DatabaseStorage } from "../storage.js";
import { isDnd } from "./escalation.js";
import { notificationDeps } from "./notifications.js";

/**
 * Unread-message reminder sweep (PerfectServe parity #5, module
 * messaging.unreadReminder), modelled on the STAT re-alert loop
 * (services/escalation.ts): every tick, for every org, each opted-in user
 * whose OLDEST unread message is at least their interval old — and who was
 * not reminded within the last interval — gets ONE content-free push
 * ("You have unread messages in DocTurn": no count, no names, no text; push
 * vendors sign no BAA). Skipped: the module off for the org, push off for the
 * org (Settings → Integrations), DND, a deactivated account, a Done thread
 * (while messaging.done is on). Each org runs in its own try/catch so one
 * failing tenant never stops another's reminders.
 *
 * The timer is PER PROCESS: run N server instances and an opted-in user can
 * receive up to N reminders per interval (lastRemindedAt narrows but does not
 * close that race). A multi-instance deployment should run the sweep on one
 * instance or move it to a shared scheduler.
 */

export const UNREAD_REMINDER_MODULE = "messaging.unreadReminder";
export const UNREAD_REMINDER_TITLE = "You have unread messages in DocTurn";
const MIN = 60_000;

export interface UnreadReminderSweepResult {
  reminded: number;
  /** Opted-in users left alone because their org has the module off. */
  skippedModuleOff: number;
  /** Orgs whose sweep threw (logged; the others still ran). */
  failedOrgs: number[];
}

/** A stored interval, clamped to the offered choices (never a 0-minute loop). */
function intervalMs(min: number): number {
  return ((REMINDER_INTERVALS_MIN as readonly number[]).includes(min) ? min : 10) * MIN;
}

export async function runUnreadReminderSweep(
  s: DatabaseStorage,
  opts: { now?: Date } = {},
): Promise<UnreadReminderSweepResult> {
  const now = opts.now ?? new Date();
  const deps = notificationDeps();
  let reminded = 0;
  let skippedModuleOff = 0;
  const failedOrgs: number[] = [];
  for (const org of await s.listOrganizations()) {
    try {
      const optIns = await s.listReminderOptIns(org.id);
      if (!optIns.length) continue;
      if (!(await isModuleEnabled(org.id, UNREAD_REMINDER_MODULE))) {
        skippedModuleOff += optIns.length;
        continue; // before ANY side effect
      }
      // Push off for the org: nothing would leave, so nothing is marked either.
      if (!(await pushAllowedForOrg(org.id))) continue;
      const respectDone = await isModuleEnabled(org.id, "messaging.done");
      for (const p of optIns) {
        const every = intervalMs(p.intervalMin);
        if (p.lastRemindedAt && now.getTime() - new Date(p.lastRemindedAt).getTime() < every) continue;
        const user = await s.getUser(org.id, p.userId);
        if (!user || user.disabledAt) continue;
        if (await isDnd(s, user.id)) continue;
        const oldest = await s.oldestUnreadFor(org.id, user.id, new Date(now.getTime() - every), respectDone);
        if (!oldest) continue;
        await deps.push.send(user.id, { title: UNREAD_REMINDER_TITLE }).catch(() => {});
        await s.markReminded(org.id, user.id, now);
        reminded++;
      }
    } catch (err) {
      failedOrgs.push(org.id);
      // Ids only — the error is a storage failure, never message content.
      console.error(`[unread-reminder] sweep failed for org ${org.id}:`, (err as Error)?.message ?? err);
    }
  }
  return { reminded, skippedModuleOff, failedOrgs };
}

let timer: NodeJS.Timeout | null = null;
/** Per-process loop (see the note above). Every minute by default. */
export function startUnreadReminderLoop(intervalMs = 60_000) {
  if (timer) return;
  timer = setInterval(() => {
    runUnreadReminderSweep(storage()).then((r) => {
      // A count only — no user, org, or message identifiers.
      if (r.reminded > 0) console.log(`[unread-reminder] ${r.reminded} reminder(s) sent`);
    }).catch((err) =>
      console.error("[unread-reminder] sweep failed", (err as Error)?.message ?? err),
    );
  }, intervalMs);
  timer.unref?.();
}
export function stopUnreadReminderLoop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
