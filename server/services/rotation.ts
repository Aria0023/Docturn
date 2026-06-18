import type { Hospitalist, Organization } from "@shared/schema";
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
 *   eligible = working providers in org whose shift_type ∈ org.roundRobinShiftTypes,
 *              specialty matches if required, and census < cap.
 *   if none → cap relief: raise every working provider's cap by 1, recompute.
 *   sort by (census ASC, rotationOrder ASC); pick[0]; advance rotation_index.
 *
 * `sequential` mode cycles by rotation_index instead of census.
 */
export async function selectNext(
  storage: IStorage,
  orgId: number,
  opts: SelectOptions = {},
): Promise<Hospitalist | null> {
  const org = await storage.getOrganization(orgId);
  if (!org) return null;

  let eligible = await computeEligible(storage, org, opts, true);

  if (eligible.length === 0) {
    // Cap relief: let the queue drain by raising every working provider's cap.
    const working = await storage.listWorkingHospitalists(orgId);
    for (const h of working) {
      await storage.updateHospitalist(orgId, h.id, {
        patientCap: h.patientCap + 1,
      });
    }
    eligible = await computeEligible(storage, org, opts, true);
  }

  // Last resort: if excluding the previous provider left nobody, re-offer to
  // them (a single-provider org must still route).
  if (eligible.length === 0 && opts.excludeHospitalistId) {
    eligible = await computeEligible(storage, org, opts, false);
  }

  if (eligible.length === 0) return null;

  let pick: Hospitalist;
  if (org.rotationMode === "sequential") {
    // Cycle deterministically through the eligible set by the persisted cursor.
    const ordered = [...eligible].sort(
      (a, b) => a.rotationOrder - b.rotationOrder || a.id - b.id,
    );
    const idx = org.rotationIndex % ordered.length;
    pick = ordered[idx]!;
  } else {
    const ordered = [...eligible].sort(
      (a, b) =>
        a.currentPatientCount - b.currentPatientCount ||
        a.rotationOrder - b.rotationOrder ||
        a.id - b.id,
    );
    pick = ordered[0]!;
  }

  // Advance the cursor so rotation stays fair over time.
  await storage.updateOrganization(orgId, {
    rotationIndex: org.rotationIndex + 1,
  });

  return pick;
}

async function computeEligible(
  storage: IStorage,
  org: Organization,
  opts: SelectOptions,
  applyExclude: boolean,
): Promise<Hospitalist[]> {
  const working = await storage.listWorkingHospitalists(org.id);
  const allowedShifts = org.roundRobinShiftTypes ?? ["day", "night"];
  return working.filter((h) => {
    if (applyExclude && opts.excludeHospitalistId === h.id) return false;
    if (!allowedShifts.includes(h.shiftType)) return false;
    if (opts.specialty && h.specialty && opts.specialty !== h.specialty) {
      // specialty is a soft filter: only exclude when both are set and differ
      return false;
    }
    if (h.currentPatientCount >= h.patientCap) return false;
    return true;
  });
}
