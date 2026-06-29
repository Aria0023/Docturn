import { hospitalistStore, type HospitalistWithUser } from '../storage.js';

export interface SelectOptions {
  /** When true, raise all working providers' caps by 1 to relieve a full board. */
  capRelief?: boolean;
  /** Exclude these hospitalist ids (e.g. one that just rejected). */
  exclude?: number[];
  /** Filter to a specialty when set. */
  specialty?: string;
}

export interface SelectionResult {
  hospitalist: HospitalistWithUser | null;
  capReliefApplied: boolean;
  reason: string;
}

/**
 * Round-robin selection, strictly org-scoped.
 * Strategy: among working providers with census < capacity, pick lowest census;
 * tie-break by rotation_order. If everyone is at/over capacity and capRelief is
 * allowed, bump caps by 1 and retry once.
 */
export const rotation = {
  async selectNext(orgId: number, options: SelectOptions = {}): Promise<SelectionResult> {
    const exclude = new Set(options.exclude ?? []);

    const pick = (list: HospitalistWithUser[]): HospitalistWithUser | null => {
      const eligible = list.filter(
        (h) => !exclude.has(h.id) && h.census < h.capacity && (!options.specialty || h.specialty === options.specialty),
      );
      if (eligible.length === 0) return null;
      // listWorking already orders by census asc, rotationOrder asc.
      return eligible.sort((a, b) => a.census - b.census || a.rotationOrder - b.rotationOrder)[0];
    };

    let working = await hospitalistStore.listWorking(orgId);
    let chosen = pick(working);
    if (chosen) {
      return { hospitalist: chosen, capReliefApplied: false, reason: 'lowest_census' };
    }

    // No one has headroom. Apply cap relief if allowed.
    if (options.capRelief) {
      await hospitalistStore.bumpCapacities(orgId, 1);
      working = await hospitalistStore.listWorking(orgId);
      chosen = pick(working);
      if (chosen) {
        return { hospitalist: chosen, capReliefApplied: true, reason: 'cap_relief' };
      }
    }

    return { hospitalist: null, capReliefApplied: !!options.capRelief, reason: 'no_capacity' };
  },
};
