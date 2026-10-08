import { storage } from "../storage.js";
import { appendAudit } from "../audit.js";
import { isModuleEnabled } from "../modules.js";

/**
 * Per-org message retention: when an org sets `messageRetentionDays` (> 0) and
 * has the `ops.retention` module on, messages older than that window are
 * HARD-deleted (with their delivery rows, attachment rows AND the encrypted
 * attachment files) and the purge is audited with counts — the compliance
 * behavior buyers ask for, and the only honest basis for any "auto-deletes"
 * claim in the UI. Unset / 0 = retain indefinitely (default: never
 * surprise-delete data).
 *
 * The same hourly sweep also removes ORPHAN uploads: attachments that were
 * uploaded but never linked to a message within ORPHAN_ATTACHMENT_MAX_AGE_MS.
 * An abandoned upload is not a clinical record (no one but the uploader could
 * ever fetch it, and no client lists them), so this runs for every org
 * regardless of the retention window or the module switch — otherwise their
 * ciphertext would sit in the store forever.
 */

/** Upper bound for a retention window (10 years); larger values are invalid. */
export const RETENTION_MAX_DAYS = 3650;
/** Never-linked uploads older than this are removed by the sweep. */
export const ORPHAN_ATTACHMENT_MAX_AGE_MS = 24 * 3600_000;

export type RetentionSetting =
  | { kind: "off" }
  | { kind: "days"; days: number }
  | { kind: "invalid" };

/**
 * Interpret the stored `messageRetentionDays` value. The settings route only
 * stores 0..RETENTION_MAX_DAYS integers now, but older rows (or a direct DB
 * edit) can hold anything: a fraction, `true`, a huge number, a string. Those
 * are INVALID — never "purge at 1 day" (what `true` used to mean) and never
 * "purge everything" (what 0.5 used to mean).
 */
export function readRetentionSetting(raw: unknown): RetentionSetting {
  if (raw == null || raw === false || raw === 0 || raw === "") return { kind: "off" };
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d{1,5}$/.test(raw.trim())
        ? Number(raw.trim())
        : NaN;
  if (!Number.isInteger(n) || n < 0 || n > RETENTION_MAX_DAYS) return { kind: "invalid" };
  return n === 0 ? { kind: "off" } : { kind: "days", days: n };
}

/** The retention window the API reports: days, or 0 when off/unset/invalid. */
export function effectiveRetentionDays(raw: unknown): number {
  const s = readRetentionSetting(raw);
  return s.kind === "days" ? s.days : 0;
}

// Orgs already audited this process for an invalid setting / module-off state,
// so an hourly sweep does not write the same row forever.
const invalidAudited = new Set<number>();
const moduleOffLogged = new Set<number>();

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
      // 1) Orphan uploads (never sent). Rows + encrypted files.
      const orphans = await storage().purgeUnlinkedAttachmentsOlderThan(
        o.id,
        new Date(Date.now() - ORPHAN_ATTACHMENT_MAX_AGE_MS),
      );
      if (orphans.attachments > 0) {
        await appendAudit({
          organizationId: o.id,
          userId: null,
          action: "attachments.orphans_purged",
          resourceType: "attachment",
          resourceId: null,
          details: {
            count: orphans.attachments,
            fileDeleteFailures: orphans.fileDeleteFailures,
            maxAgeHours: ORPHAN_ATTACHMENT_MAX_AGE_MS / 3600_000,
          },
          riskLevel: orphans.fileDeleteFailures ? "high" : "low",
        });
      }

      // 2) The retention window itself.
      const setting = readRetentionSetting(
        await storage().getOrgSetting(o.id, "messageRetentionDays"),
      );
      if (setting.kind === "invalid") {
        // Skip rather than guess — and say so where an auditor will see it.
        if (!invalidAudited.has(o.id)) {
          invalidAudited.add(o.id);
          await appendAudit({
            organizationId: o.id,
            userId: null,
            action: "retention.invalid_setting",
            resourceType: "organization",
            resourceId: o.id,
            details: {
              setting: "messageRetentionDays",
              reason: `must be an integer 0..${RETENTION_MAX_DAYS}; retention is NOT being applied`,
            },
            riskLevel: "high",
          });
        }
        continue;
      }
      invalidAudited.delete(o.id);
      if (setting.kind === "off") continue;
      // The module switch: with ops.retention off the window is configured but
      // not enforced — honour the switch and leave the data alone.
      if (!(await isModuleEnabled(o.id, "ops.retention"))) {
        if (!moduleOffLogged.has(o.id)) {
          moduleOffLogged.add(o.id);
          console.log(`[retention] ops.retention is off for org ${o.id}: retention window not enforced`);
        }
        continue;
      }
      moduleOffLogged.delete(o.id);
      const cutoff = new Date(Date.now() - setting.days * 86_400_000);
      const purged = await storage().purgeMessagesOlderThan(o.id, cutoff);
      if (purged.messages > 0) {
        total += purged.messages;
        await appendAudit({
          organizationId: o.id,
          userId: null,
          action: "messages.retention_purged",
          resourceType: "message",
          resourceId: null,
          details: {
            count: purged.messages,
            attachments: purged.attachments,
            fileDeleteFailures: purged.fileDeleteFailures,
            retentionDays: setting.days,
          },
          // Rows are gone either way; ciphertext left behind is an operator
          // problem worth a high-risk row, not a silent counter.
          riskLevel: purged.fileDeleteFailures ? "high" : "medium",
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
