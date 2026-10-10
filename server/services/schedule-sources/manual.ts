import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseStorage } from "../../storage.js";
import { mapHoursToShift, normalizeName } from "../amion.js";
import type { OnCallSlot, ScheduleSource, ScheduleSourceStatus, ShiftType } from "./types.js";

/**
 * Manual adapter: director-maintained on-call slots stored per org in the
 * org setting "manualOnCall". The fallback for organizations without an
 * Amion feed or Epic credentials — and the override when a schedule is wrong.
 */
export const MANUAL_SETTING_KEY = "manualOnCall";

export interface ManualSlot {
  id: string;
  slot: string;
  service: string;
  hours: string;
  shift: ShiftType;
  providerName: string;
  /** Explicit user pin; when null the name is matched against the roster. */
  providerUserId: number | null;
  group: string;
  updatedAt: string;
  updatedBy: number | null;
}

interface ManualState {
  updatedAt: string | null;
  slots: ManualSlot[];
}

const SHIFTS = ["day", "swing", "night"] as const;

export const manualSlotInputSchema = z.object({
  slot: z.string().trim().min(1).max(80),
  service: z.string().trim().max(80).optional(),
  hours: z.string().trim().max(24).optional(),
  shift: z.enum(SHIFTS).optional(),
  providerName: z.string().trim().min(1).max(120),
  providerUserId: z.number().int().positive().nullable().optional(),
  group: z.string().trim().max(80).optional(),
});
export const manualSlotPatchSchema = manualSlotInputSchema.partial();
export type ManualSlotInput = z.infer<typeof manualSlotInputSchema>;

async function readState(db: DatabaseStorage, orgId: number): Promise<ManualState> {
  const raw = (await db.getOrgSetting(orgId, MANUAL_SETTING_KEY)) as Partial<ManualState> | null;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.slots)) {
    return { updatedAt: null, slots: [] };
  }
  return { updatedAt: raw.updatedAt ?? null, slots: raw.slots };
}

async function writeState(
  db: DatabaseStorage,
  orgId: number,
  slots: ManualSlot[],
  actorUserId: number | null,
): Promise<ManualState> {
  const state: ManualState = { updatedAt: new Date().toISOString(), slots };
  await db.setOrgSetting(orgId, MANUAL_SETTING_KEY, state, actorUserId);
  return state;
}

/** Only a user of THIS org can be pinned; anything else is dropped to null. */
async function sanitizeUserId(
  db: DatabaseStorage,
  orgId: number,
  userId: number | null | undefined,
): Promise<number | null> {
  if (userId == null) return null;
  const u = await db.getUser(orgId, userId);
  return u ? u.id : null;
}

export async function listManualSlots(db: DatabaseStorage, orgId: number): Promise<ManualSlot[]> {
  return (await readState(db, orgId)).slots;
}

export async function addManualSlot(
  db: DatabaseStorage,
  orgId: number,
  input: ManualSlotInput,
  actorUserId: number | null,
): Promise<ManualSlot> {
  const state = await readState(db, orgId);
  const hours = input.hours ?? "";
  const slot: ManualSlot = {
    id: randomUUID(),
    slot: input.slot,
    service: input.service || "Hospital Medicine",
    hours,
    shift: input.shift ?? mapHoursToShift(hours),
    providerName: input.providerName,
    providerUserId: await sanitizeUserId(db, orgId, input.providerUserId),
    group: input.group ?? "",
    updatedAt: new Date().toISOString(),
    updatedBy: actorUserId,
  };
  await writeState(db, orgId, [...state.slots, slot], actorUserId);
  return slot;
}

export async function updateManualSlot(
  db: DatabaseStorage,
  orgId: number,
  id: string,
  patch: Partial<ManualSlotInput>,
  actorUserId: number | null,
): Promise<ManualSlot | null> {
  const state = await readState(db, orgId);
  const idx = state.slots.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const prev = state.slots[idx]!;
  const hours = patch.hours ?? prev.hours;
  const next: ManualSlot = {
    ...prev,
    slot: patch.slot ?? prev.slot,
    service: patch.service ?? prev.service,
    hours,
    shift: patch.shift ?? (patch.hours !== undefined ? mapHoursToShift(hours) : prev.shift),
    providerName: patch.providerName ?? prev.providerName,
    providerUserId:
      patch.providerUserId !== undefined
        ? await sanitizeUserId(db, orgId, patch.providerUserId)
        : prev.providerUserId,
    group: patch.group ?? prev.group,
    updatedAt: new Date().toISOString(),
    updatedBy: actorUserId,
  };
  const slots = state.slots.slice();
  slots[idx] = next;
  await writeState(db, orgId, slots, actorUserId);
  return next;
}

export async function removeManualSlot(
  db: DatabaseStorage,
  orgId: number,
  id: string,
  actorUserId: number | null,
): Promise<boolean> {
  const state = await readState(db, orgId);
  const slots = state.slots.filter((s) => s.id !== id);
  if (slots.length === state.slots.length) return false;
  await writeState(db, orgId, slots, actorUserId);
  return true;
}

export function createManualSource(db: DatabaseStorage): ScheduleSource {
  return {
    id: "manual",
    async fetch(orgId) {
      const state = await readState(db, orgId);
      if (!state.slots.length) return [];
      const users = await db.listUsers(orgId);
      const byId = new Map(users.map((u) => [u.id, u]));
      const byName = new Map(users.map((u) => [normalizeName(u.displayName), u.id]));
      return state.slots.map<OnCallSlot>((s) => {
        // A pinned user wins (and re-validates against the roster); otherwise
        // resolve by display name, exactly like the Amion adapter.
        const pinned = s.providerUserId != null && byId.has(s.providerUserId) ? s.providerUserId : null;
        return {
          slot: s.slot,
          service: s.service,
          hours: s.hours,
          shift: s.shift,
          providerName: s.providerName,
          providerUserId: pinned ?? byName.get(normalizeName(s.providerName)) ?? null,
          group: s.group,
          secure: true,
          source: "manual",
          asOf: s.updatedAt,
        };
      });
    },
    async status(orgId): Promise<ScheduleSourceStatus> {
      const state = await readState(db, orgId);
      return {
        id: "manual",
        configured: true, // always available — it's maintained in DocTurn itself
        lastSyncAt: state.updatedAt,
        lastStatus: state.updatedAt ? "ok" : "never",
        error: null,
        rowCount: state.slots.length,
        message: state.slots.length ? null : "No manual on-call slots yet — a director can add them on the On call board.",
      };
    },
  };
}
