import type { DatabaseStorage } from "../../storage.js";
import {
  amionConfig,
  amionConfigured,
  normalizeName,
  toDisplayName,
  SYNC_SETTING_KEY,
  type AmionSyncState,
} from "../amion.js";
import type { OnCallSlot, ScheduleSource, ScheduleSourceStatus } from "./types.js";

/**
 * Amion adapter: wraps the existing sync state (org setting "amionSync",
 * written by services/amion.ts) into OnCallSlots. The live feed is scoped to
 * the AMION_ORG_CODE tenant, so any other org reports configured:false.
 */
export function createAmionSource(db: DatabaseStorage): ScheduleSource {
  async function orgMatches(orgId: number): Promise<boolean> {
    if (!amionConfigured()) return false;
    const org = await db.getOrganizationByCode(amionConfig().orgCode);
    return !!org && org.id === orgId;
  }

  async function state(orgId: number): Promise<AmionSyncState | null> {
    const raw = (await db.getOrgSetting(orgId, SYNC_SETTING_KEY)) as Partial<AmionSyncState> | null;
    if (!raw || typeof raw !== "object") return null;
    return {
      lastSyncAt: raw.lastSyncAt ?? null,
      lastStatus: raw.lastStatus ?? "ok",
      lastError: raw.lastError ?? null,
      rowCount: raw.rowCount ?? 0,
      providers: Array.isArray(raw.providers) ? raw.providers : [],
    };
  }

  return {
    id: "amion",
    async fetch(orgId) {
      // The stored snapshot is what the board shows even if the feed is
      // currently erroring (services/amion.ts keeps the last good grid).
      const s = await state(orgId);
      if (!s || !s.providers.length) return [];
      const users = await db.listUsers(orgId);
      const byName = new Map(users.map((u) => [normalizeName(u.displayName), u.id]));
      const slots: OnCallSlot[] = s.providers.map((row) => {
        const providerName = toDisplayName(row.name);
        return {
          slot: row.slot,
          service: row.group || "Hospital Medicine",
          hours: row.hrs,
          shift: row.shift,
          providerName,
          providerUserId: byName.get(normalizeName(providerName)) ?? null,
          group: row.group,
          secure: !!row.secure,
          source: "amion",
          asOf: s.lastSyncAt,
        };
      });
      return slots;
    },
    async status(orgId): Promise<ScheduleSourceStatus> {
      const configured = await orgMatches(orgId);
      const s = configured ? await state(orgId) : null;
      return {
        id: "amion",
        configured,
        lastSyncAt: s?.lastSyncAt ?? null,
        lastStatus: s ? s.lastStatus : "never",
        error: s?.lastError ?? null,
        rowCount: s?.rowCount ?? 0,
        message: configured
          ? null
          : "Amion feed not configured for this organization (set AMION_OCS_URL + AMION_ORG_CODE on the server).",
      };
    },
  };
}
