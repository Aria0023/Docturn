import { INSTANCE_ID } from "../instance.js";
import { storage } from "../storage.js";

/**
 * Background-job leases (E1 multi-instance safety, docs/ENTERPRISE_READINESS.md).
 *
 * Every per-process timer in server/index.ts — expiry, auto-clean, Amion and
 * Epic sync, STAT escalation, the unread reminder, retention — fires on each
 * instance, but a tick only RUNS after this instance has claimed the job's
 * row in `job_leases` (storage.claimJobLease: one atomic
 * `UPDATE … WHERE lease_until <= NOW()`). With N instances exactly one wins
 * each tick; the rest skip. A lease lasts 90 % of the job's interval
 * (LEASE_FRACTION): long enough that the other instances' timers for the
 * same tick find it held, short enough that the winner's own next tick finds
 * it lapsed. A holder that dies mid-lease simply loses it when it lapses — no
 * operator action, no leader election, no extra service. A tick is expected
 * to finish within its interval (every sweep here does by a wide margin);
 * the per-process `running` guard also stops one instance overlapping itself.
 *
 * The clock is the database's (NOW()), so instance clock skew is irrelevant.
 * On graceful shutdown the instance gives its leases back
 * (releaseInstanceLeases) so a sibling takes over at its next tick instead
 * of waiting for the lapse.
 */

export const JOB_NAMES = [
  "expiry",
  "autoclean",
  "amion-sync",
  "epic-sync",
  "stat-escalation",
  "unread-reminder",
  "retention",
] as const;
export type JobName = (typeof JOB_NAMES)[number];

export const LEASE_FRACTION = 0.9;
/** How long a claim for a job that ticks every `intervalMs` is held. */
export function leaseMsFor(intervalMs: number): number {
  return Math.max(1, Math.floor(intervalMs * LEASE_FRACTION));
}

export type TickOutcome = "ran" | "skipped" | "failed" | "claim_failed";

/**
 * Run one tick of `name` if this holder can claim it. Never throws: a tick
 * that fails is logged (type only) and reported as "failed"; a claim that
 * fails (database unreachable) is "claim_failed" and the tick is not run —
 * it could not have done its database work anyway.
 */
export async function runLeasedTick(
  name: JobName,
  intervalMs: number,
  tick: () => unknown,
  holder: string = INSTANCE_ID,
): Promise<TickOutcome> {
  let claimed: boolean;
  try {
    claimed = await storage().claimJobLease(name, holder, leaseMsFor(intervalMs));
  } catch (err) {
    console.error(`[jobs] lease claim failed for ${name}`, err);
    return "claim_failed";
  }
  if (!claimed) return "skipped";
  try {
    await tick();
    return "ran";
  } catch (err) {
    console.error(`[jobs] ${name} tick failed`, err);
    return "failed";
  }
}

export interface LeasedTimer {
  name: JobName;
  stop(): void;
}

const active = new Map<JobName, LeasedTimer>();

/**
 * The ONE way a background loop is scheduled: an unref'd interval (plus an
 * optional one-shot boot run) whose every firing goes through runLeasedTick.
 * Idempotent per name — a second start returns the running timer.
 */
export function startLeasedInterval(
  name: JobName,
  intervalMs: number,
  tick: () => unknown,
  opts: { bootDelayMs?: number; holder?: string; onOutcome?: (o: TickOutcome) => void } = {},
): LeasedTimer {
  const existing = active.get(name);
  if (existing) return existing;
  let running = false;
  const fire = () => {
    if (running) return; // never two overlapping runs in one process
    running = true;
    runLeasedTick(name, intervalMs, tick, opts.holder)
      .then((o) => opts.onOutcome?.(o))
      .finally(() => {
        running = false;
      });
  };
  const interval = setInterval(fire, intervalMs);
  interval.unref?.();
  const boot = opts.bootDelayMs != null ? setTimeout(fire, opts.bootDelayMs) : null;
  boot?.unref?.();
  const timer: LeasedTimer = {
    name,
    stop() {
      clearInterval(interval);
      if (boot) clearTimeout(boot);
      if (active.get(name) === timer) active.delete(name);
    },
  };
  active.set(name, timer);
  return timer;
}

/** Job names with a live timer in this process (the cluster view, tests). */
export function leasedTimers(): JobName[] {
  return [...active.keys()].sort();
}

/** Stop every timer (graceful shutdown). */
export function stopAllLeasedTimers(): void {
  for (const t of [...active.values()]) t.stop();
}

/** Give back every lease this instance holds (graceful shutdown). */
export function releaseInstanceLeases(): Promise<number> {
  return storage().releaseJobLeases(INSTANCE_ID);
}
