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
 *   pool     = working, in-rotation providers in org whose shift_type ∈
 *              org.roundRobinShiftTypes (the ROUTABLE pool — nothing below
 *              ever looks outside it).
 *   eligible = pool members whose census < cap, specialty matching if required,
 *              minus the excluded (just-declined / just-expired) provider.
 *   if none and a specialty was asked → drop the specialty preference.
 *   if none and someone was excluded → re-offer them (a single-provider org
 *              must still route) — WITHOUT touching anybody's cap.
 *   if still none → cap relief: raise every provider's cap IN THE ROUTABLE POOL
 *              by 1 (audited), recompute with the same three steps.
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

  const pool = await routablePool(storage, org);
  const plan = planSelection(pool, opts);
  let eligible = plan.eligible;

  if (plan.relief) {
    // Cap relief: nobody in the routable pool has capacity. Let the queue
    // drain by raising the cap of every ROUTABLE provider (never a swing /
    // off-shift / non-working one, who could not be picked by this same pass).
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
    // Recompute on the relieved pool with the SAME rule the preview simulated.
    eligible = eligibleWithoutRelief(await routablePool(storage, org), opts);
  }

  if (eligible.length === 0) return null;

  const pick = rankEligible(eligible, org)[0]!;

  // Advance the cursor so rotation stays fair over time.
  await storage.updateOrganization(orgId, {
    rotationIndex: org.rotationIndex + 1,
  });

  return pick;
}

/** What the next round-robin pick looks like, computed without side effects. */
export interface RotationPreview {
  mode: Organization["rotationMode"];
  /** org.roundRobinShiftTypes — the only shifts rotation ever draws from. */
  shiftTypes: string[];
  /**
   * True when nobody routable has capacity, so the next round-robin admission
   * will first raise every routable cap by 1 (audited) and then pick `next`.
   */
  capRelief: boolean;
  /** Who the next round-robin patient goes to; null → the create answers no_provider. */
  next: Hospitalist | null;
  /** The eligible set in pick order (next first). Never contains an off-shift or at-cap provider. */
  order: Hospitalist[];
}

/**
 * Read-only preview of the next round-robin pick, WITHOUT any side effects
 * (no cursor advance, no cap relief, no writes). Built from the very planner
 * selectNext uses (`planSelection` + `rankEligible`), so the preview and the
 * live pick cannot disagree: same routable pool (working AND shift ∈
 * org.roundRobinShiftTypes), same census < cap test, same specialty
 * preference when one is given, same simulated cap relief when everybody
 * routable is at cap, same ordering (and the same modulus in sequential
 * mode). Nobody routable → next: null, exactly like selectNext.
 *
 * Org-scoped through `storage`, so it can never surface a provider from another
 * tenant.
 */
export async function previewRotation(
  storage: IStorage,
  orgId: number,
  opts: Pick<SelectOptions, "specialty"> = {},
): Promise<RotationPreview | null> {
  const org = await storage.getOrganization(orgId);
  if (!org) return null;
  const pool = await routablePool(storage, org);
  const plan = planSelection(pool, { specialty: opts.specialty });
  const order = rankEligible(plan.eligible, org);
  return {
    mode: org.rotationMode,
    shiftTypes: routableShiftTypes(org),
    capRelief: plan.relief,
    next: order[0] ?? null,
    order,
  };
}

/**
 * Who is "up next" with no patient context — the on-call board's "Next up"
 * row and the messaging "Next hospitalist" target. See previewRotation.
 */
export async function previewNext(
  storage: IStorage,
  orgId: number,
): Promise<Hospitalist | null> {
  return (await previewRotation(storage, orgId))?.next ?? null;
}

/** The shift types rotation draws from for this org. */
export function routableShiftTypes(org: Pick<Organization, "roundRobinShiftTypes">): string[] {
  return org.roundRobinShiftTypes ?? ["day", "night"];
}

/**
 * The routable pool: working providers whose shift is in the org's round-robin
 * set and whom the director has not taken off rotation (inRotation). Shared by
 * selection, cap relief and preview so the three can never drift (e.g.
 * relieving a swing-shift cap that selection would never pick).
 */
async function routablePool(storage: IStorage, org: Organization): Promise<Hospitalist[]> {
  const working = await storage.listWorkingHospitalists(org.id);
  const allowed = routableShiftTypes(org);
  return working.filter((h) => allowed.includes(h.shiftType) && h.inRotation !== false);
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

/**
 * Eligibility without cap relief, in selectNext's order of fallbacks:
 *   1. census < cap, specialty preference, minus the excluded provider;
 *   2. no candidate and a specialty was asked → drop the specialty preference;
 *   3. still none and someone was excluded → re-offer them (a single-provider
 *      org must still route) — BEFORE any cap relief.
 */
function eligibleWithoutRelief(pool: Hospitalist[], opts: SelectOptions): Hospitalist[] {
  let eligible = eligibleFrom(pool, opts, true);
  // Specialty is a PREFERENCE, not a hard gate: hospitalists are generalists, so
  // if no provider of the requested specialty is free, fall back to the full
  // routable pool rather than failing to route.
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
  return eligible;
}

/**
 * The whole selection plan, pure: who is eligible, and whether getting there
 * needs cap relief (+1 on every ROUTABLE cap). When relief is needed the
 * eligible set is what the same rules yield on the relieved pool — which is
 * exactly what selectNext recomputes after writing the caps.
 */
function planSelection(
  pool: Hospitalist[],
  opts: SelectOptions,
): { eligible: Hospitalist[]; relief: boolean } {
  const eligible = eligibleWithoutRelief(pool, opts);
  if (eligible.length > 0 || pool.length === 0) return { eligible, relief: false };
  const relieved = pool.map((h) => ({ ...h, patientCap: h.patientCap + 1 }));
  return { eligible: eligibleWithoutRelief(relieved, opts), relief: true };
}

/** The ordering rule, identical for the live pick and the preview (pick = [0]). */
function rankEligible(eligible: Hospitalist[], org: Organization): Hospitalist[] {
  if (org.rotationMode === "sequential") {
    // Cycle deterministically through the eligible set by the persisted cursor.
    const ordered = [...eligible].sort(
      (a, b) => a.rotationOrder - b.rotationOrder || a.id - b.id,
    );
    if (ordered.length === 0) return ordered;
    const start = org.rotationIndex % ordered.length;
    return [...ordered.slice(start), ...ordered.slice(0, start)];
  }
  return [...eligible].sort(
    (a, b) =>
      a.currentPatientCount - b.currentPatientCount ||
      a.rotationOrder - b.rotationOrder ||
      a.id - b.id,
  );
}
