import { MODULES } from "@shared/modules";
import { isModuleEnabled } from "../../modules.js";
import type { DatabaseStorage } from "../../storage.js";
import { amionFeedFor } from "../amion.js";
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

/**
 * The feature module that must be ON for a source to be offered, selected or
 * served (shared/modules.ts). The manual list is maintained in DocTurn itself
 * and needs none. This is the single place the board, the source picker, the
 * default resolution and the registry consult, so the schedule.* switches
 * cannot be honoured by one surface and ignored by another.
 */
export const SOURCE_MODULE: Readonly<Record<ScheduleSourceId, string | null>> = {
  amion: "schedule.amion",
  epic: "schedule.epic",
  manual: null,
};

export function isScheduleSourceId(v: unknown): v is ScheduleSourceId {
  return typeof v === "string" && (SCHEDULE_SOURCE_IDS as readonly string[]).includes(v);
}

/** True when the org may use this source (its module is on, or it needs none). */
export async function sourceModuleEnabled(orgId: number, id: ScheduleSourceId): Promise<boolean> {
  const mod = SOURCE_MODULE[id];
  return mod ? isModuleEnabled(orgId, mod) : true;
}

export interface SourceRegistry {
  get(id: ScheduleSourceId): ScheduleSource;
  all(): ScheduleSource[];
}

/**
 * Wrap a source so that, for an org whose module is switched off, it serves
 * NO slots and reports configured:false with a "switched off" message — even
 * if a caller asks for it directly. The underlying snapshot is left intact so
 * switching the module back on restores the board without a re-sync.
 */
function moduleGated(src: ScheduleSource, moduleId: string): ScheduleSource {
  const label = MODULES.find((m) => m.id === moduleId)?.label ?? moduleId;
  return {
    id: src.id,
    async fetch(orgId) {
      if (!(await isModuleEnabled(orgId, moduleId))) return [];
      return src.fetch(orgId);
    },
    async status(orgId) {
      const base = await src.status(orgId);
      if (await isModuleEnabled(orgId, moduleId)) return base;
      // Keep the source's own hint (e.g. which credentials it needs) and add
      // the switch state, so the operator sees everything that is true.
      const off = `${label} is switched off for this organization (module ${moduleId}); the board reads the manual list instead.`;
      return {
        ...base,
        configured: false,
        message: base.message ? `${base.message} ${off}` : off,
      };
    },
  };
}

export function createSourceRegistry(db: DatabaseStorage, deps: { epic?: EpicClientDeps } = {}): SourceRegistry {
  const sources: Record<ScheduleSourceId, ScheduleSource> = {
    amion: moduleGated(createAmionSource(db), SOURCE_MODULE.amion!),
    epic: moduleGated(createEpicSource(db, deps.epic), SOURCE_MODULE.epic!),
    manual: createManualSource(db),
  };
  return {
    get: (id) => sources[id],
    all: () => SCHEDULE_SOURCE_IDS.map((id) => sources[id]),
  };
}

/**
 * The source an org should read from when it has made no explicit choice:
 * Amion when this org has a live feed (its own saved credentials, or the env
 * feed for AMION_ORG_CODE) AND schedule.amion is on for it, else the manual list.
 */
export async function defaultSourceFor(db: DatabaseStorage, orgId: number): Promise<ScheduleSourceId> {
  if ((await amionFeedFor(db, orgId)) && (await sourceModuleEnabled(orgId, "amion"))) return "amion";
  return "manual";
}

export interface SelectedSource {
  id: ScheduleSourceId;
  /** A director chose this source (as opposed to the default resolution). */
  explicit: boolean;
  /**
   * Set when the director's stored choice is a source whose module is switched
   * off for this org: the board falls back to the manual list, and the stored
   * choice is kept so switching the module back on restores it.
   */
  overridden?: { source: ScheduleSourceId; module: string };
}

export async function getSelectedSource(db: DatabaseStorage, orgId: number): Promise<SelectedSource> {
  const raw = await db.getOrgSetting(orgId, SOURCE_SETTING_KEY);
  if (isScheduleSourceId(raw)) {
    if (await sourceModuleEnabled(orgId, raw)) return { id: raw, explicit: true };
    return { id: "manual", explicit: false, overridden: { source: raw, module: SOURCE_MODULE[raw]! } };
  }
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

/** Slots from the org's selected source (never fabricated, never from a switched-off module). */
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
