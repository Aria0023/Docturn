import { storage } from "../storage.js";
import { appendAudit } from "../audit.js";

/**
 * Per-org message retention: when an org sets `messageRetentionDays` (> 0),
 * messages older than that window are HARD-deleted (with their delivery rows)
 * and the purge is audited with a count — the compliance behavior buyers ask
 * for, and the only honest basis for any "auto-deletes" claim in the UI.
 * Unset / 0 = retain indefinitely (default: never surprise-delete data).
 */
export async function runMessageRetentionSweep(): Promise<number> {
  let total = 0;
  let orgs: Awaited<ReturnType<ReturnType<typeof storage>["listOrganizations"]>>;
  try {
    orgs = await storage().listOrganizations();
  } catch (err) {
    // Only a total failure to enumerate tenants aborts the sweep.
    console.error("[retention] could not list organizations", err);
    return 0;
  }
  for (const o of orgs) {
    // Per-org isolation: one tenant's failure must never silently cancel the
    // sweep for every tenant after it (which is what a loop-wide try/catch did
    // — a single FK violation stopped retention platform-wide and nothing
    // surfaced it). Failures are recorded as a HIGH-risk audit event, then the
    // sweep continues.
    try {
      const raw = await storage().getOrgSetting(o.id, "messageRetentionDays");
      const days = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(days) || days <= 0) continue;
      const cutoff = new Date(Date.now() - days * 86_400_000);
      const purged = await storage().purgeMessagesOlderThan(o.id, cutoff);
      if (purged > 0) {
        total += purged;
        await appendAudit({
          organizationId: o.id,
          userId: null,
          action: "messages.retention_purged",
          resourceType: "message",
          resourceId: null,
          details: { count: purged, retentionDays: days },
          riskLevel: "medium",
        });
      }
    } catch (err) {
      console.error(`[retention] sweep failed for org ${o.id}`, err);
      await appendAudit({
        organizationId: o.id,
        userId: null,
        action: "retention.sweep_failed",
        resourceType: "organization",
        resourceId: o.id,
        // Error text only — never a message body or any other clinical content.
        details: { error: String((err as Error)?.message ?? err).slice(0, 300) },
        riskLevel: "high",
      });
    }
  }
  if (total) console.log(`[retention] purged ${total} expired message(s)`);
  return total;
}

let timer: NodeJS.Timeout | null = null;
export function startRetentionLoop(intervalMs = 3600_000) {
  if (timer) return;
  timer = setInterval(() => {
    void runMessageRetentionSweep();
  }, intervalMs);
  timer.unref?.();
}
export function stopRetentionLoop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
