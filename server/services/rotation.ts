import type { Hospitalist, Organization } from "@shared/schema";
import { appendAudit } from "../audit.js";
import type { IStorage } from "../storage.js";

export interface SelectOptions {
  shiftType?: string;
  specialty?: string;
  /**
   * Provider to skip when an alternative exists — used on reroute so a patient
   * who was just rejected/expired isn't immediately re-offered to the same
   * provider. Falls back to including them if they're the only option.
   */
  excludeHospitalistId?: number;
}

/**
 * Round-robin / lowest-census selection — the highest-risk surface in DocTurn.
 * It operates STRICTLY within one organization; it can never return a provider
 * from another tenant because every read is org-scoped through `storage`.
 *
 * Algorithm (see 05_WORKFLOWS.md §2):
 *   pool     = working providers in org whose shift_type ∈ org.roundRobinShiftTypes
 *              (the ROUTABLE pool — nothing below ever looks outside it).
 *   eligible = pool members whose census < cap, specialty matching if required,
 *              minus the excluded (just-declined / just-expired) provider.
 *   if none and a specialty was asked → drop the specialty preference.
 *   if none and someone was excluded → re-offer them (a single-provider org
 *              must still route) — WITHOUT touching anybody's cap.
 *   if still none → cap relief: raise every provider's cap IN THE ROUTABLE POOL
 *              by 1 (audited), recompute.
 *   sort by (census ASC, rotationOrder ASC); pick[0]; advance rotation_index.
 *
 * `sequential` mode cycles by rotation_index instead of census.
 *
 * Cap relief is a permanent, tenant-wide change to provider caps, so it is the
 * LAST resort: it fires only when nobody in the routable pool has capacity
 * even once the exclusion is lifted, and it never raises the cap of a provider
 * rotation could not pick anyway (off-shift, not working).
 */
export async function selectNext(
  storage: IStorage,
  orgId: number,
  opts: SelectOptions = {},
): Promise<Hospitalist | null> {
  const org = await storage.getOrganization(orgId);
  if (!org) return null;

  let pool = await routablePool(storage, org);
  let eligible = eligibleFrom(pool, opts, true);

  // Specialty is a PREFERENCE, not a hard gate: hospitalists are generalists, so
  // if no provider of the requested specialty is free, fall back to the full
  // working pool rather than failing to route. (A dedicated-specialty group can
  // still be honored when such providers exist and have capacity.)
  const general = { ...opts, specialty: undefined };
  if (eligible.length === 0 && opts.specialty) {
    eligible = eligibleFrom(pool, general, true);
  }

  // Re-offer BEFORE relief: when the only reason nobody is eligible is that we
  // excluded the previous provider, offer the patient to them again. Raising
  // caps here would inflate a lone provider's cap on every decline and expiry.
  if (eligible.length === 0 && opts.excludeHospitalistId) {
    eligible = eligibleFrom(pool, general, false);
  }

  if (eligible.length === 0) {
    // Cap relief: nobody in the routable pool has capacity. Let the queue
    // drain by raising the cap of every ROUTABLE provider (never a swing /
    // off-shift / non-working one, who could not be picked by this same pass).
    if (pool.length === 0) return null;
    for (const h of pool) {
      await storage.updateHospitalist(orgId, h.id, {
        patientCap: h.patientCap + 1,
      });
    }
    await appendAudit({
      organizationId: orgId,
      userId: null,
      action: "rotation.cap_relief",
      resourceType: "hospitalist",
      resourceId: null,
      details: {
        hospitalistIds: pool.map((h) => h.id),
        raisedBy: 1,
        excludedHospitalistId: opts.excludeHospitalistId ?? null,
      },
      riskLevel: "medium",
    });
    pool = await routablePool(storage, org);
    // Prefer an alternative to the just-declined provider; fall back to them.
    eligible = eligibleFrom(pool, general, true);
    if (eligible.length === 0 && opts.excludeHospitalistId) {
      eligible = eligibleFrom(pool, general, false);
    }
  }

  if (eligible.length === 0) return null;

  const pick = pickFrom(eligible, org);

  // Advance the cursor so rotation stays fair over time.
  await storage.updateOrganization(orgId, {
    rotationIndex: org.rotationIndex + 1,
  });

  return pick;
}

/**
 * Read-only preview of who is "up next" by rotation, WITHOUT any side effects
 * (no cursor advance, no cap relief, no writes). Used by non-mutating surfaces
 * like the on-call message-addressing picker and the on-call board's "Next up"
 * row, which only need to know who currently holds the rotation without
 * disturbing the live routing state.
 *
 * It applies the SAME eligibility as selectNext (routable shift AND census <
 * cap) so it never names a provider the next round-robin patient would not go
 * to. When everybody routable is at cap it previews what selectNext's cap
 * relief would yield (census < cap + 1); when nobody is routable it returns
 * null, exactly like selectNext (which answers no_provider — never an
 * off-shift provider). The only thing it cannot know is the patient's
 * specialty preference, which has no patient context here.
 *
 * Org-scoped through `storage`, so it can never surface a provider from another
 * tenant.
 */
export async function previewNext(
  storage: IStorage,
  orgId: number,
): Promise<Hospitalist | null> {
  const org = await storage.getOrganization(orgId);
  if (!org) return null;
  const pool = await routablePool(storage, org);
  if (pool.length === 0) return null;

  let eligible = eligibleFrom(pool, {}, false);
  if (eligible.length === 0) {
    // What a cap-relief pass (+1 on every routable cap) would make eligible.
    eligible = pool.filter((h) => h.currentPatientCount < h.patientCap + 1);
  }
  if (eligible.length === 0) return null;
  return pickFrom(eligible, org);
}

/** The shift types rotation draws from for this org. */
export function routableShiftTypes(org: Pick<Organization, "roundRobinShiftTypes">): string[] {
  return org.roundRobinShiftTypes ?? ["day", "night"];
}

/**
 * The routable pool: working providers whose shift is in the org's round-robin
 * set. Shared by selection, cap relief and preview so the three can never
 * drift (e.g. relieving a swing-shift cap that selection would never pick).
 */
async function routablePool(storage: IStorage, org: Organization): Promise<Hospitalist[]> {
  const working = await storage.listWorkingHospitalists(org.id);
  const allowed = routableShiftTypes(org);
  return working.filter((h) => allowed.includes(h.shiftType));
}

/** Eligibility within an already-routable pool: exclusion, specialty, census < cap. */
function eligibleFrom(
  pool: Hospitalist[],
  opts: SelectOptions,
  applyExclude: boolean,
): Hospitalist[] {
  return pool.filter((h) => {
    if (applyExclude && opts.excludeHospitalistId === h.id) return false;
    if (opts.specialty && h.specialty && opts.specialty !== h.specialty) {
      // specialty is a soft filter: only exclude when both are set and differ
      return false;
    }
    if (h.currentPatientCount >= h.patientCap) return false;
    return true;
  });
}

/** The ordering rule, identical for the live pick and the preview. */
function pickFrom(eligible: Hospitalist[], org: Organization): Hospitalist {
  if (org.rotationMode === "sequential") {
    // Cycle deterministically through the eligible set by the persisted cursor.
    const ordered = [...eligible].sort(
      (a, b) => a.rotationOrder - b.rotationOrder || a.id - b.id,
    );
    return ordered[org.rotationIndex % ordered.length]!;
  }
  const ordered = [...eligible].sort(
    (a, b) =>
      a.currentPatientCount - b.currentPatientCount ||
      a.rotationOrder - b.rotationOrder ||
      a.id - b.id,
  );
  return ordered[0]!;
}
