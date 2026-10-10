import type { Express } from "express";
import { erDiversionSchema, erRosterPatchSchema, SHIFT_TYPE } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { isModuleEnabled } from "../modules.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { notificationDeps } from "../services/notifications.js";
import { storage } from "../storage.js";
import { sendOrgBroadcast } from "./broadcasts.js";

/**
 * ER operations the ER director's dashboard drives (A.CON clinical #1, #2).
 *
 *   GET  /api/er/diversion            every signed-in member of the org
 *   PUT  /api/er/diversion            ER director / director — { active }
 *   GET  /api/er/roster               ER director / director
 *   PATCH /api/er/roster/:userId      ER director / director — { onShift?, shiftType? }
 *
 * Diversion is the ORG's state (org setting "erDiversion"). Declaring or
 * lifting it is a locked read-modify-write, audited, announced to every open
 * session (DIVERSION_UPDATED) and — while the broadcasts module is on — sent
 * to everyone in the org as an ordinary broadcast (critical with ack on
 * declare, info on lift). DocTurn has NO EMS / ambulance-dispatch integration:
 * nothing here notifies EMS, and nothing says it does.
 *
 * The ER roster is the org's ACTIVE er_doctor accounts (People → Add person
 * creates and deactivates them). Their on/off shift and shift type are kept
 * here (org setting "erRoster", { [userId]: { onShift, shiftType, at, by } }),
 * so every ER director sees the same staffing. Admissions are counted from the
 * patients each physician admitted in the last 24 h.
 */
export const DIVERSION_KEY = "erDiversion";
export const ER_ROSTER_KEY = "erRoster";
const ER_ADMIN_ROLES = ["er_director", "director"] as const;
const DAY_MS = 24 * 3_600_000;

export interface DiversionState {
  active: boolean;
  since: string | null;
  by: { id: number; name: string } | null;
}
const NOT_DIVERTING: DiversionState = { active: false, since: null, by: null };

/** Read the stored value defensively — anything malformed reads as "accepting". */
export function parseDiversion(raw: unknown): DiversionState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NOT_DIVERTING;
  const o = raw as Record<string, unknown>;
  if (o.active !== true) return NOT_DIVERTING;
  const by = o.by && typeof o.by === "object" ? (o.by as { id?: unknown; name?: unknown }) : null;
  return {
    active: true,
    since: typeof o.since === "string" ? o.since : null,
    by: by && typeof by.id === "number" ? { id: by.id, name: typeof by.name === "string" ? by.name : "" } : null,
  };
}

type ShiftId = (typeof SHIFT_TYPE)[number];
interface RosterEntry {
  onShift: boolean;
  shiftType: ShiftId | null;
  at: string | null;
  by: number | null;
}
function parseRoster(raw: unknown): Record<string, RosterEntry> {
  const out: Record<string, RosterEntry> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(k) || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    out[k] = {
      onShift: o.onShift === true,
      shiftType: typeof o.shiftType === "string" && (SHIFT_TYPE as readonly string[]).includes(o.shiftType) ? (o.shiftType as ShiftId) : null,
      at: typeof o.at === "string" ? o.at : null,
      by: typeof o.by === "number" ? o.by : null,
    };
  }
  return out;
}

export async function buildErRoster(orgId: number) {
  const db = storage();
  const [users, patients, raw] = await Promise.all([
    db.listUsers(orgId),
    db.listPatients(orgId),
    db.getOrgSetting(orgId, ER_ROSTER_KEY),
  ]);
  const roster = parseRoster(raw);
  const since = Date.now() - DAY_MS;
  const recent = patients.filter((p) => new Date(p.createdAt).getTime() >= since);
  const admitsBy = new Map<number, number>();
  for (const p of recent) if (p.erDoctorId != null) admitsBy.set(p.erDoctorId, (admitsBy.get(p.erDoctorId) ?? 0) + 1);
  const physicians = users
    .filter((u) => u.role === "er_doctor" && !u.disabledAt)
    .map((u) => {
      const e = roster[String(u.id)];
      return {
        userId: u.id,
        displayName: u.displayName,
        credential: u.credential ?? null,
        onShift: !!e?.onShift,
        shiftType: e?.shiftType ?? null,
        admits24h: admitsBy.get(u.id) ?? 0,
        updatedAt: e?.at ?? null,
      };
    });
  return {
    physicians,
    onShift: physicians.filter((p) => p.onShift).length,
    // Every patient admitted in the org in the last 24 h (ER intakes and
    // directors' manual admissions alike).
    admits24h: recent.length,
  };
}

export function registerErRoutes(app: Express) {
  app.get("/api/er/diversion", requireAuth, async (req, res) => {
    const me = currentUser(req);
    res.json(parseDiversion(await storage().getOrgSetting(me.organizationId, DIVERSION_KEY)));
  });

  app.put("/api/er/diversion", requireAuth, requireRole(...ER_ADMIN_ROLES), async (req, res) => {
    const me = currentUser(req);
    const parsed = erDiversionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const want = parsed.data.active;
    const next: DiversionState = want
      ? { active: true, since: new Date().toISOString(), by: { id: me.id, name: me.displayName } }
      : NOT_DIVERTING;
    type Outcome = { changed: boolean; state: DiversionState; previous: DiversionState };
    const outcome = await storage().mutateOrgSettings<Outcome>(me.organizationId, [DIVERSION_KEY], me.id, (cur) => {
      const current = parseDiversion(cur[DIVERSION_KEY]);
      if (current.active === want) return { result: { changed: false, state: current, previous: current } };
      return { write: { [DIVERSION_KEY]: next }, result: { changed: true, state: next, previous: current } };
    });
    // Already in that state (another ER director got there first): say so,
    // with the state the server holds — nothing is broadcast twice.
    if (!outcome.changed) return res.status(409).json({ error: "no_change", diversion: outcome.state });

    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: want ? "er.diversion_declare" : "er.diversion_lift",
      resourceType: "organization",
      resourceId: me.organizationId,
      details: want ? { since: next.since } : { declaredAt: outcome.previous.since, declaredBy: outcome.previous.by?.id ?? null },
      riskLevel: want ? "high" : "medium",
    });
    try {
      notificationDeps().ws.broadcast(me.organizationId, { type: "DIVERSION_UPDATED" });
    } catch (err) {
      console.error("[er] diversion broadcast frame failed", err);
    }

    let broadcast: { id: number; total: number } | null = null;
    let broadcastSkipped: "module_disabled" | null = null;
    if (await isModuleEnabled(me.organizationId, "broadcasts")) {
      const message = want
        ? `ER ON DIVERSION — divert incoming ambulances until further notice. Declared by ${me.displayName}.`
        : `ER diversion lifted — the ER is accepting patients again (${me.displayName}).`;
      const sent = await sendOrgBroadcast(me, message, want ? "critical" : "info", { reason: "er_diversion" });
      broadcast = { id: sent.broadcast.id, total: sent.total };
    } else {
      broadcastSkipped = "module_disabled";
    }
    res.json({ diversion: outcome.state, broadcast, broadcastSkipped });
  });

  app.get("/api/er/roster", requireAuth, requireRole(...ER_ADMIN_ROLES), async (req, res) => {
    const me = currentUser(req);
    res.json(await buildErRoster(me.organizationId));
  });

  app.patch("/api/er/roster/:userId", requireAuth, requireRole(...ER_ADMIN_ROLES), async (req, res) => {
    const me = currentUser(req);
    const userId = Number(req.params.userId);
    const parsed = erRosterPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    // Only this org's ACTIVE ER physicians are on the roster; anyone else
    // (another role, another tenant, deactivated, unknown) is not found.
    const target = await storage().getUser(me.organizationId, userId);
    if (!target || target.role !== "er_doctor" || target.disabledAt) return res.status(404).json({ error: "not_found" });
    const at = new Date().toISOString();
    await storage().mutateOrgSettings(me.organizationId, [ER_ROSTER_KEY], me.id, (cur) => {
      const roster = parseRoster(cur[ER_ROSTER_KEY]);
      const prev = roster[String(userId)] ?? { onShift: false, shiftType: null, at: null, by: null };
      roster[String(userId)] = {
        onShift: parsed.data.onShift ?? prev.onShift,
        shiftType: parsed.data.shiftType ?? prev.shiftType,
        at,
        by: me.id,
      };
      return { write: { [ER_ROSTER_KEY]: roster }, result: null };
    });
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "er.roster_update",
      resourceType: "user",
      resourceId: userId,
      details: { changed: parsed.data },
      riskLevel: "low",
    });
    try {
      notificationDeps().ws.broadcast(me.organizationId, { type: "ER_ROSTER_UPDATED" });
    } catch (err) {
      console.error("[er] roster broadcast frame failed", err);
    }
    const roster = await buildErRoster(me.organizationId);
    res.json({ physician: roster.physicians.find((p) => p.userId === userId) ?? null, onShift: roster.onShift });
  });
}
