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
  try {
    const orgs = await storage().listOrganizations();
    for (const o of orgs) {
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
    }
  } catch (err) {
    console.error("[retention] sweep failed", err);
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
