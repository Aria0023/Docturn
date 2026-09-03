import type { DatabaseStorage } from "../../storage.js";
import { amionConfig, amionConfigured } from "../amion.js";
import { createAmionSource } from "./amion.js";
import { createEpicSource, type EpicClientDeps } from "./epic-fhir.js";
import { createManualSource } from "./manual.js";
import {
  SCHEDULE_SOURCE_IDS,
  type OnCallSlot,
  type ScheduleSource,
  type ScheduleSourceId,
  type ScheduleSourceStatus,
} from "./types.js";

export * from "./types.js";
export { createAmionSource } from "./amion.js";
export { createManualSource } from "./manual.js";
export { createEpicSource } from "./epic-fhir.js";

/** Org setting holding the selected source id. */
export const SOURCE_SETTING_KEY = "scheduleSource";

export function isScheduleSourceId(v: unknown): v is ScheduleSourceId {
  return typeof v === "string" && (SCHEDULE_SOURCE_IDS as readonly string[]).includes(v);
}

export interface SourceRegistry {
  get(id: ScheduleSourceId): ScheduleSource;
  all(): ScheduleSource[];
}

export function createSourceRegistry(db: DatabaseStorage, deps: { epic?: EpicClientDeps } = {}): SourceRegistry {
  const sources: Record<ScheduleSourceId, ScheduleSource> = {
    amion: createAmionSource(db),
    epic: createEpicSource(db, deps.epic),
    manual: createManualSource(db),
  };
  return {
    get: (id) => sources[id],
    all: () => SCHEDULE_SOURCE_IDS.map((id) => sources[id]),
  };
}

/**
 * The source an org should read from: its explicit choice, else Amion when the
 * live feed is configured for this org, else the manual list.
 */
export async function defaultSourceFor(db: DatabaseStorage, orgId: number): Promise<ScheduleSourceId> {
  if (amionConfigured()) {
    const org = await db.getOrganizationByCode(amionConfig().orgCode);
    if (org && org.id === orgId) return "amion";
  }
  return "manual";
}

export async function getSelectedSource(db: DatabaseStorage, orgId: number): Promise<{ id: ScheduleSourceId; explicit: boolean }> {
  const raw = await db.getOrgSetting(orgId, SOURCE_SETTING_KEY);
  if (isScheduleSourceId(raw)) return { id: raw, explicit: true };
  return { id: await defaultSourceFor(db, orgId), explicit: false };
}

export async function setSelectedSource(
  db: DatabaseStorage,
  orgId: number,
  id: ScheduleSourceId,
  actorUserId: number | null,
): Promise<void> {
  await db.setOrgSetting(orgId, SOURCE_SETTING_KEY, id, actorUserId);
}

/** Slots from the org's selected source (never fabricated). */
export async function fetchSelectedSlots(
  db: DatabaseStorage,
  registry: SourceRegistry,
  orgId: number,
): Promise<{ source: ScheduleSourceId; slots: OnCallSlot[] }> {
  const { id } = await getSelectedSource(db, orgId);
  return { source: id, slots: await registry.get(id).fetch(orgId) };
}

export async function allSourceStatuses(
  registry: SourceRegistry,
  orgId: number,
): Promise<Record<ScheduleSourceId, ScheduleSourceStatus>> {
  const out = {} as Record<ScheduleSourceId, ScheduleSourceStatus>;
  for (const s of registry.all()) out[s.id] = await s.status(orgId);
  return out;
}
