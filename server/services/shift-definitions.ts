import { z } from "zod";
import { SHIFT_TYPE } from "@shared/schema";
import type { DatabaseStorage } from "../storage.js";

/**
 * The organization's names and published hours for DocTurn's three shift types
 * (Day / Swing / Night — shared/schema.ts SHIFT_TYPE, the enum every
 * hospitalist profile carries). Stored per org in the org-settings row
 * "shiftDefinitions" as { [shiftId]: { label?, start?, end? } } — only what a
 * director changed; everything else is the built-in default below.
 *
 * What these are, and are not:
 *   - The label is what the Director dashboard, the shift selects and the
 *     ER roster call that shift for everyone in the org.
 *   - start / end are the org's published hours for it ("HH:MM", 24 h, or
 *     null when the org has not set them). They are REFERENCE: nothing in
 *     DocTurn switches a provider on or off shift by the clock — the director's
 *     On/Off switch and an Amion pull do (services/amion.ts maps the grid's
 *     own hours tokens to a shift type).
 * An org that never set them has the plain names and NO hours — never the
 * kit's demo 07:00–15:00 / 15:00–23:00 / 23:00–07:00.
 */
export const SHIFT_SETTING_KEY = "shiftDefinitions";

export type ShiftId = (typeof SHIFT_TYPE)[number];

export interface ShiftDefinition {
  id: ShiftId;
  label: string;
  start: string | null;
  end: string | null;
}

/** Display order on every screen (the enum's own order is day, night, swing). */
export const SHIFT_ORDER: readonly ShiftId[] = ["day", "swing", "night"];

export const DEFAULT_SHIFT_LABELS: Readonly<Record<ShiftId, string>> = {
  day: "Day",
  swing: "Swing",
  night: "Night",
};

export const SHIFT_LABEL_MAX = 40;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// No control characters (C0, DEL, C1) in a label.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function isShiftId(v: unknown): v is ShiftId {
  return typeof v === "string" && (SHIFT_TYPE as readonly string[]).includes(v);
}

const labelSchema = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => s.length >= 1 && s.length <= SHIFT_LABEL_MAX && !CONTROL.test(s));
const hhmmSchema = z.string().regex(HHMM).nullable();

/** PATCH /api/org/shifts/:id body — at least one of label / start / end. */
export const shiftDefinitionPatchSchema = z
  .object({
    label: labelSchema.optional(),
    start: hhmmSchema.optional(),
    end: hhmmSchema.optional(),
  })
  .strict()
  .refine((b) => b.label !== undefined || b.start !== undefined || b.end !== undefined);

export type ShiftDefinitionPatch = z.infer<typeof shiftDefinitionPatchSchema>;

type StoredOne = { label?: string; start?: string | null; end?: string | null };
type Stored = Partial<Record<ShiftId, StoredOne>>;

/** Read a stored value defensively: anything malformed is ignored, never served. */
export function normalizeStored(raw: unknown): Stored {
  const out: Stored = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const id of SHIFT_ORDER) {
    const v = (raw as Record<string, unknown>)[id];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const one: StoredOne = {};
    if (typeof o.label === "string") {
      const l = labelSchema.safeParse(o.label);
      if (l.success) one.label = l.data;
    }
    if (o.start === null || (typeof o.start === "string" && HHMM.test(o.start))) one.start = o.start as string | null;
    if (o.end === null || (typeof o.end === "string" && HHMM.test(o.end))) one.end = o.end as string | null;
    out[id] = one;
  }
  return out;
}

export function resolveShiftDefinitions(raw: unknown): ShiftDefinition[] {
  const stored = normalizeStored(raw);
  return SHIFT_ORDER.map((id) => ({
    id,
    label: stored[id]?.label ?? DEFAULT_SHIFT_LABELS[id],
    start: stored[id]?.start ?? null,
    end: stored[id]?.end ?? null,
  }));
}

export async function getShiftDefinitions(db: DatabaseStorage, orgId: number): Promise<ShiftDefinition[]> {
  return resolveShiftDefinitions(await db.getOrgSetting(orgId, SHIFT_SETTING_KEY));
}

/**
 * Merge one shift's change into the org's stored definitions under the org
 * settings row lock (two directors editing different shifts never undo each
 * other). Returns the full resolved list after the write.
 */
export async function updateShiftDefinition(
  db: DatabaseStorage,
  orgId: number,
  id: ShiftId,
  patch: ShiftDefinitionPatch,
  actorUserId: number | null,
): Promise<ShiftDefinition[]> {
  return db.mutateOrgSettings<ShiftDefinition[]>(orgId, [SHIFT_SETTING_KEY], actorUserId, (cur) => {
    const stored = normalizeStored(cur[SHIFT_SETTING_KEY]);
    const one: StoredOne = { ...(stored[id] ?? {}) };
    if (patch.label !== undefined) one.label = patch.label;
    if (patch.start !== undefined) one.start = patch.start;
    if (patch.end !== undefined) one.end = patch.end;
    const next: Stored = { ...stored, [id]: one };
    return { write: { [SHIFT_SETTING_KEY]: next }, result: resolveShiftDefinitions(next) };
  });
}
