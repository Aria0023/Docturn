import type { Assignment } from "@shared/schema";
import type { DatabaseStorage } from "../storage.js";

/**
 * The Admissions log (Director → Admissions log and the dashboard counter),
 * built from the org's REAL assignments — never a client-side list.
 *
 * One row per patient routed to a hospitalist: a decline, re-route or hand-off
 * adds an assignment row on the server but is still ONE admission, so the
 * patient's first routing is "when" and "how" (round-robin / manual) and its
 * latest routing is "to whom" and "status". Patients with no assignment (a
 * board row nobody routed) are not admissions. Rows go as long as the patient
 * does: Clear 24h+ / Clear all and the auto-clean sweep delete the patient
 * and its assignments, and the log follows.
 *
 * The counter's reset is an org-wide marker (org setting
 * "admissionsCounterReset" = { at, by }): "since last reset" counts admissions
 * first routed at or after it, for everyone in the org.
 */
export const ADMISSIONS_RESET_KEY = "admissionsCounterReset";
export const ADMISSIONS_LOG_MAX_ROWS = 500;

export interface AdmissionRow {
  patientId: number;
  initials: string;
  room: string | null;
  specialty: string | null;
  /** Display name of the hospitalist holding the latest routing, or null. */
  provider: string | null;
  /** How the admission was first routed. */
  via: Assignment["via"];
  /** Status of the latest routing. */
  status: Assignment["status"];
  /** First routing (ISO). */
  routedAt: string;
  /** Latest routing (ISO). */
  lastRoutedAt: string;
  /** How many times it was routed (1 = never re-routed). */
  routings: number;
}

export interface AdmissionsReset {
  at: string;
  by: { id: number; name: string | null } | null;
}

export interface AdmissionsLog {
  rows: AdmissionRow[];
  /** Admissions on record (may exceed rows.length when capped). */
  total: number;
  last24h: number;
  sinceReset: number;
  reset: AdmissionsReset | null;
  limit: number;
  generatedAt: string;
}

/** The stored reset marker, or null when never reset / malformed. */
export function parseReset(raw: unknown): { at: string; by: number | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { at?: unknown; by?: unknown };
  if (typeof r.at !== "string" || !Number.isFinite(Date.parse(r.at))) return null;
  return { at: r.at, by: typeof r.by === "number" ? r.by : null };
}

export async function buildAdmissionsLog(
  db: DatabaseStorage,
  orgId: number,
  opts: { now?: Date; limit?: number } = {},
): Promise<AdmissionsLog> {
  const now = opts.now ?? new Date();
  const limit = Math.max(1, Math.min(opts.limit ?? ADMISSIONS_LOG_MAX_ROWS, ADMISSIONS_LOG_MAX_ROWS));
  const [assignments, patients, hospitalists, users, resetRaw] = await Promise.all([
    db.listAssignments(orgId), // newest first
    db.listPatients(orgId),
    db.listHospitalists(orgId),
    db.listUsers(orgId),
    db.getOrgSetting(orgId, ADMISSIONS_RESET_KEY),
  ]);
  const pById = new Map(patients.map((p) => [p.id, p]));
  const hById = new Map(hospitalists.map((h) => [h.id, h]));
  const uById = new Map(users.map((u) => [u.id, u]));

  // Group per patient; listAssignments is newest-first, so [0] is the latest.
  const byPatient = new Map<number, Assignment[]>();
  for (const a of assignments) {
    const list = byPatient.get(a.patientId);
    if (list) list.push(a);
    else byPatient.set(a.patientId, [a]);
  }

  const rows: AdmissionRow[] = [];
  for (const [patientId, list] of byPatient) {
    const patient = pById.get(patientId);
    if (!patient) continue; // purged — not on record
    const latest = list[0]!;
    const first = list[list.length - 1]!;
    const h = hById.get(latest.hospitalistId);
    const u = h ? uById.get(h.userId) : undefined;
    rows.push({
      patientId,
      initials: patient.initials,
      room: patient.roomNumber ?? null,
      specialty: patient.specialty ?? null,
      provider: u?.displayName ?? null,
      via: first.via,
      status: latest.status,
      routedAt: new Date(first.createdAt).toISOString(),
      lastRoutedAt: new Date(latest.createdAt).toISOString(),
      routings: list.length,
    });
  }
  rows.sort((x, y) => Date.parse(y.routedAt) - Date.parse(x.routedAt) || y.patientId - x.patientId);

  const stored = parseReset(resetRaw);
  const resetMs = stored ? Date.parse(stored.at) : null;
  const dayAgo = now.getTime() - 24 * 3600_000;
  let last24h = 0;
  let sinceReset = 0;
  for (const r of rows) {
    const t = Date.parse(r.routedAt);
    if (t >= dayAgo) last24h++;
    if (resetMs == null || t >= resetMs) sinceReset++;
  }
  const resetBy = stored && stored.by != null ? uById.get(stored.by) : undefined;
  return {
    rows: rows.slice(0, limit),
    total: rows.length,
    last24h,
    sinceReset,
    reset: stored ? { at: stored.at, by: stored.by != null ? { id: stored.by, name: resetBy?.displayName ?? null } : null } : null,
    limit,
    generatedAt: now.toISOString(),
  };
}
