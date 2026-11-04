import { appendAudit } from "../audit.js";
import { storage } from "../storage.js";
import { runExpirySweep } from "./assignments.js";
import { startLeasedInterval, type LeasedTimer } from "./job-leases.js";

/**
 * Background sweep that expires overdue pending assignments and reroutes them.
 * Server-authoritative: the client never computes the next provider. Each
 * tick claims the "expiry" job lease first (services/job-leases.ts), so with
 * several instances only one runs it.
 */
let timer: LeasedTimer | null = null;

export function startExpiryLoop(intervalMs = 15_000) {
  if (timer) return;
  timer = startLeasedInterval("expiry", intervalMs, () =>
    runExpirySweep(storage()).catch((err) => console.error("[expiry] sweep failed", err)),
  );
}

export function stopExpiryLoop() {
  if (timer) {
    timer.stop();
    timer = null;
  }
}

/**
 * Daily auto-clean: every org's patients (and their assignments/consults) older
 * than `olderThanHours` are purged so stale board/log data clears itself rather
 * than piling up. Runs on an interval; also safe to call directly.
 */
let cleanTimer: LeasedTimer | null = null;
export async function runAutoClean(olderThanHours = 24): Promise<number> {
  let removed = 0;
  let orgs: Awaited<ReturnType<ReturnType<typeof storage>["listOrganizations"]>> = [];
  try {
    orgs = await storage().listOrganizations();
  } catch (err) {
    console.error("[autoclean] could not list organizations", err);
    return 0;
  }
  for (const o of orgs) {
    // One tenant's failure must never stall the sweep for every later tenant:
    // each org is purged in its own try/catch and the failure is audited.
    try {
      // Each org can individualize its retention window (or disable auto-clean
      // with 0). Falls back to the platform default when unset.
      const perOrg = await storage().getOrgSetting(o.id, "autoCleanHours");
      const hours = typeof perOrg === "number" ? perOrg : olderThanHours;
      if (hours <= 0) continue; // 0 = retain indefinitely for this org
      const r = await storage().purgeOldPatients(o.id, hours * 3600_000);
      removed += r.patients;
      if (r.patients > 0) {
        await appendAudit({
          organizationId: o.id,
          userId: null,
          action: "maintenance.autoclean_purged",
          resourceType: "patient",
          resourceId: null,
          details: { ...r, olderThanHours: hours },
          riskLevel: "medium",
        });
      }
    } catch (err) {
      console.error(`[autoclean] purge failed for org ${o.id}`, err);
      try {
        await appendAudit({
          organizationId: o.id,
          userId: null,
          action: "maintenance.autoclean_failed",
          resourceType: "patient",
          resourceId: null,
          details: { error: String((err as Error)?.message ?? err).slice(0, 200) },
          riskLevel: "high",
        });
      } catch { /* auditing must not throw out of the sweep */ }
    }
  }
  if (removed) console.log(`[autoclean] purged ${removed} stale patient record(s)`);
  return removed;
}

export function startAutoCleanLoop(intervalMs = 3600_000, olderThanHours = 24) {
  if (cleanTimer) return;
  cleanTimer = startLeasedInterval("autoclean", intervalMs, () => runAutoClean(olderThanHours));
}

export function stopAutoCleanLoop() {
  if (cleanTimer) {
    cleanTimer.stop();
    cleanTimer = null;
  }
}
