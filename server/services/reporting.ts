import { z } from "zod";
import type { DatabaseStorage } from "../storage.js";
import type { ReportDefinition } from "../../shared/schema.js";
import {
  epicConfigFor,
  fetchAllPages,
  fetchFor,
  getAccessToken,
  sanitizeError,
  type EpicClientDeps,
} from "./schedule-sources/epic-fhir.js";

/**
 * Reports: team census, pending admits, provider load and saved custom
 * reports.
 *
 * Two sources, one engine:
 *   - "docturn": DocTurn's own records (patients, admission requests,
 *     providers). Works for every hospital, today.
 *   - "ehr": a patient list read live from the hospital's Epic through FHIR R4
 *     with the SAME backend app the hospital connected in Settings →
 *     Integrations → Epic. It needs that app to hold read access to List,
 *     Patient and Encounter (system/List.read, system/Patient.read,
 *     system/Encounter.read) — granted by the hospital's Epic team. Without a
 *     connection the run answers `ehr_not_connected`; nothing is simulated.
 *
 * A saved report is a DEFINITION (dataset, columns, filters, grouping, sort).
 * Rows are built per request and never stored, cached or logged. Patients are
 * shown the way the rest of DocTurn shows them: initials, never a full name,
 * and no MRN.
 */

export type ColumnType = "text" | "number" | "datetime";
export interface ReportColumn { id: string; label: string; type: ColumnType }
export type ReportRow = Record<string, string | number | null>;

export const DATASETS = {
  team_census: {
    label: "Team census",
    source: "docturn",
    patientData: true,
    blurb: "Every patient an attending has accepted, by hospitalist.",
    columns: [
      { id: "hospitalist", label: "Hospitalist", type: "text" },
      { id: "patient", label: "Patient", type: "text" },
      { id: "room", label: "Room", type: "text" },
      { id: "department", label: "Department", type: "text" },
      { id: "specialty", label: "Specialty", type: "text" },
      { id: "acuity", label: "Acuity (ESI)", type: "number" },
      { id: "status", label: "Status", type: "text" },
      { id: "admittedAt", label: "Accepted", type: "datetime" },
      { id: "losHours", label: "Length of stay (h)", type: "number" },
      { id: "summary", label: "Summary", type: "text" },
      { id: "erDoctor", label: "ER doctor", type: "text" },
      { id: "openConsults", label: "Open consults", type: "number" },
    ],
    defaults: { columns: ["hospitalist", "patient", "room", "specialty", "acuity", "admittedAt", "losHours", "summary"], groupBy: "hospitalist", sort: { column: "room", dir: "asc" } },
  },
  pending_admits: {
    label: "Pending admits",
    source: "docturn",
    patientData: true,
    blurb: "Patients waiting for a hospitalist: not routed yet, or routed and not accepted.",
    columns: [
      { id: "patient", label: "Patient", type: "text" },
      { id: "room", label: "Room", type: "text" },
      { id: "department", label: "Department", type: "text" },
      { id: "specialty", label: "Specialty", type: "text" },
      { id: "acuity", label: "Acuity (ESI)", type: "number" },
      { id: "request", label: "Request", type: "text" },
      { id: "requestedHospitalist", label: "Requested hospitalist", type: "text" },
      { id: "arrivedAt", label: "Entered", type: "datetime" },
      { id: "waitingMin", label: "Waiting (min)", type: "number" },
      { id: "expiresAt", label: "Request expires", type: "datetime" },
      { id: "summary", label: "Summary", type: "text" },
      { id: "erDoctor", label: "ER doctor", type: "text" },
    ],
    defaults: { columns: ["patient", "room", "specialty", "acuity", "request", "requestedHospitalist", "waitingMin", "summary"], groupBy: null, sort: { column: "waitingMin", dir: "desc" } },
  },
  provider_load: {
    label: "Provider load",
    source: "docturn",
    patientData: false,
    blurb: "Each hospitalist's census, cap, open slots and requests waiting on them.",
    columns: [
      { id: "hospitalist", label: "Hospitalist", type: "text" },
      { id: "specialty", label: "Specialty", type: "text" },
      { id: "shift", label: "Shift", type: "text" },
      { id: "onShift", label: "On shift", type: "text" },
      { id: "inRotation", label: "In rotation", type: "text" },
      { id: "census", label: "Census", type: "number" },
      { id: "cap", label: "Cap", type: "number" },
      { id: "openSlots", label: "Open slots", type: "number" },
      { id: "pending", label: "Requests waiting", type: "number" },
    ],
    defaults: { columns: ["hospitalist", "shift", "onShift", "inRotation", "census", "cap", "openSlots", "pending"], groupBy: null, sort: { column: "census", dir: "desc" } },
  },
  ehr_patient_list: {
    label: "Epic patient list",
    source: "ehr",
    patientData: true,
    blurb: "A patient list from Epic — a team's census, an ED pending-admit list, a unit list — read live each time.",
    columns: [
      { id: "patient", label: "Patient", type: "text" },
      { id: "age", label: "Age", type: "number" },
      { id: "sex", label: "Sex", type: "text" },
      { id: "location", label: "Room / bed", type: "text" },
      { id: "unit", label: "Unit", type: "text" },
      { id: "attending", label: "Attending", type: "text" },
      { id: "encounterStatus", label: "Encounter status", type: "text" },
      { id: "encounterClass", label: "Class", type: "text" },
      { id: "service", label: "Service", type: "text" },
      { id: "admittedAt", label: "Encounter start", type: "datetime" },
      { id: "losHours", label: "Length of stay (h)", type: "number" },
      { id: "reason", label: "Reason", type: "text" },
    ],
    defaults: { columns: ["patient", "age", "sex", "location", "unit", "attending", "encounterStatus", "admittedAt", "losHours", "reason"], groupBy: "attending", sort: { column: "location", dir: "asc" } },
  },
} as const satisfies Record<string, {
  label: string; source: "docturn" | "ehr"; patientData: boolean; blurb: string;
  columns: readonly ReportColumn[];
  defaults: { columns: readonly string[]; groupBy: string | null; sort: { column: string; dir: "asc" | "desc" } };
}>;
export type DatasetId = keyof typeof DATASETS;
export const DATASET_IDS = Object.keys(DATASETS) as DatasetId[];

export const FILTER_OPS = ["eq", "neq", "contains", "gte", "lte", "empty", "notEmpty"] as const;
/** A FHIR logical id (letters, digits, "-" and "."). It goes into a URL path. */
const FHIR_ID = /^[A-Za-z0-9\-.]{1,200}$/;

export const reportConfigSchema = z.object({
  columns: z.array(z.string().max(40)).min(1).max(20),
  filters: z
    .array(z.object({ column: z.string().max(40), op: z.enum(FILTER_OPS), value: z.string().max(120).default("") }))
    .max(8)
    .default([]),
  groupBy: z.string().max(40).nullable().default(null),
  sort: z.object({ column: z.string().max(40), dir: z.enum(["asc", "desc"]) }).nullable().default(null),
  ehrListId: z.string().regex(FHIR_ID).nullable().default(null),
});
export type ReportConfig = z.infer<typeof reportConfigSchema>;

export const reportInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  dataset: z.enum(DATASET_IDS as [DatasetId, ...DatasetId[]]),
  config: reportConfigSchema,
  shared: z.boolean().default(false),
});
export type ReportInput = z.infer<typeof reportInputSchema>;

/** Check a config against its dataset's columns. Returns an error code or null. */
export function configProblem(dataset: DatasetId, config: ReportConfig): string | null {
  const ids = new Set<string>(DATASETS[dataset].columns.map((c) => c.id));
  if (new Set(config.columns).size !== config.columns.length) return "duplicate_column";
  for (const c of config.columns) if (!ids.has(c)) return "unknown_column";
  for (const f of config.filters) if (!ids.has(f.column)) return "unknown_column";
  if (config.groupBy && !ids.has(config.groupBy)) return "unknown_column";
  if (config.sort && !ids.has(config.sort.column)) return "unknown_column";
  if (DATASETS[dataset].source === "ehr" && !config.ehrListId) return "ehr_list_required";
  return null;
}

export function defaultConfig(dataset: DatasetId): ReportConfig {
  const d = DATASETS[dataset].defaults;
  return { columns: [...d.columns], filters: [], groupBy: d.groupBy, sort: { ...d.sort }, ehrListId: null };
}

/** The reports every organization has without saving anything. */
export const BUILTIN_REPORTS = (["team_census", "pending_admits", "provider_load"] as const).map((dataset) => ({
  id: `builtin:${dataset}`,
  name: DATASETS[dataset].label,
  dataset,
  config: defaultConfig(dataset),
  shared: true,
  builtin: true as const,
}));

// ── the engine: filter → sort → pick columns ─────────────────────────────────
function compare(a: string | number | null, b: string | number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // blanks last
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function matches(row: ReportRow, f: ReportConfig["filters"][number], type: ColumnType): boolean {
  const v = row[f.column] ?? null;
  const blank = v == null || v === "";
  if (f.op === "empty") return blank;
  if (f.op === "notEmpty") return !blank;
  if (f.op === "gte" || f.op === "lte") {
    if (blank) return false;
    const left = type === "datetime" ? Date.parse(String(v)) : Number(v);
    const right = type === "datetime" ? Date.parse(f.value) : Number(f.value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    return f.op === "gte" ? left >= right : left <= right;
  }
  const hay = blank ? "" : String(v).toLowerCase();
  const needle = f.value.trim().toLowerCase();
  if (f.op === "contains") return hay.includes(needle);
  const same = type === "number" && !blank && needle !== "" ? Number(v) === Number(needle) : hay === needle;
  return f.op === "eq" ? same : !same;
}

export function applyConfig(dataset: DatasetId, config: ReportConfig, all: ReportRow[]): { columns: ReportColumn[]; rows: ReportRow[] } {
  const catalog = new Map<string, ReportColumn>(DATASETS[dataset].columns.map((c) => [c.id, c]));
  let rows = all.filter((r) => config.filters.every((f) => matches(r, f, catalog.get(f.column)!.type)));
  const sort = config.sort;
  const group = config.groupBy;
  rows = [...rows].sort((a, b) => {
    const g = group ? compare(a[group] ?? null, b[group] ?? null) : 0;
    if (g) return g;
    if (!sort) return 0;
    const s = compare(a[sort.column] ?? null, b[sort.column] ?? null);
    // Blanks stay last in either direction.
    if ((a[sort.column] ?? null) == null || (b[sort.column] ?? null) == null) return s;
    return sort.dir === "desc" ? -s : s;
  });
  // The group column is always sent, so the screen can draw group headings.
  const ids = group && !config.columns.includes(group) ? [group, ...config.columns] : config.columns;
  return {
    columns: ids.map((id) => catalog.get(id)!),
    rows: rows.map((r) => Object.fromEntries(ids.map((id) => [id, r[id] ?? null]))),
  };
}

// ── DocTurn's own records ────────────────────────────────────────────────────
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const hoursSince = (d: Date | string | null | undefined, now: Date) =>
  d ? Math.max(0, Math.round(((now.getTime() - new Date(d).getTime()) / 3_600_000) * 10) / 10) : null;

async function docturnRows(db: DatabaseStorage, orgId: number, dataset: DatasetId, now: Date): Promise<ReportRow[]> {
  const [hosp, users] = await Promise.all([db.listHospitalists(orgId), db.listUsers(orgId)]);
  const userName = new Map(users.map((u) => [u.id, u.displayName]));
  const hospName = new Map(hosp.map((h) => [h.id, userName.get(h.userId) ?? `Provider ${h.id}`]));

  if (dataset === "provider_load") {
    const pending = await db.pendingCountsByHospitalist(orgId);
    return hosp.map((h) => ({
      hospitalist: hospName.get(h.id)!,
      specialty: h.specialty,
      shift: h.shiftType,
      onShift: h.working ? "Yes" : "No",
      inRotation: h.inRotation ? "Yes" : "No",
      census: h.currentPatientCount,
      cap: h.patientCap,
      openSlots: Math.max(0, h.patientCap - h.currentPatientCount),
      pending: pending.get(h.id) ?? 0,
    }));
  }

  const [patients, assignments] = await Promise.all([db.listPatients(orgId), db.listAssignments(orgId)]);

  if (dataset === "team_census") {
    const consults = await db.listConsultsForOrg(orgId);
    const openConsults = new Map<number, number>();
    for (const c of consults) {
      if (c.status === "closed" || c.status === "declined") continue;
      openConsults.set(c.patientId, (openConsults.get(c.patientId) ?? 0) + 1);
    }
    // When the current attending accepted: the newest accepted request.
    const acceptedAt = new Map<number, Date>();
    for (const a of assignments) {
      if (a.status !== "accepted" || !a.resolvedAt) continue;
      const at = new Date(a.resolvedAt);
      const prev = acceptedAt.get(a.patientId);
      if (!prev || at > prev) acceptedAt.set(a.patientId, at);
    }
    return patients
      .filter((p) => p.assignedHospitalistId != null && p.status !== "discharged")
      .map((p) => {
        const since = acceptedAt.get(p.id) ?? p.createdAt;
        return {
          hospitalist: hospName.get(p.assignedHospitalistId!) ?? "Unknown",
          patient: p.initials,
          room: p.roomNumber,
          department: p.department,
          specialty: p.specialty,
          acuity: p.acuity,
          status: p.status,
          admittedAt: iso(since),
          losHours: hoursSince(since, now),
          summary: p.issueSummary || null,
          erDoctor: p.erDoctorId != null ? userName.get(p.erDoctorId) ?? null : null,
          openConsults: openConsults.get(p.id) ?? 0,
        };
      });
  }

  // pending_admits
  const live = new Map<number, (typeof assignments)[number]>();
  for (const a of assignments) if (a.status === "pending" && !live.has(a.patientId)) live.set(a.patientId, a);
  return patients
    .filter((p) => p.status !== "discharged" && (live.has(p.id) || (p.status === "waiting" && p.assignedHospitalistId == null)))
    .map((p) => {
      const a = live.get(p.id);
      return {
        patient: p.initials,
        room: p.roomNumber,
        department: p.department,
        specialty: p.specialty,
        acuity: p.acuity,
        request: a ? "Sent, not accepted yet" : "Not routed yet",
        requestedHospitalist: a ? hospName.get(a.hospitalistId) ?? null : null,
        arrivedAt: iso(p.createdAt),
        waitingMin: Math.max(0, Math.round((now.getTime() - new Date(p.createdAt).getTime()) / 60_000)),
        expiresAt: a ? iso(a.expiresAt) : null,
        summary: p.issueSummary || null,
        erDoctor: p.erDoctorId != null ? userName.get(p.erDoctorId) ?? null : null,
      };
    });
}

// ── Epic (FHIR R4) ───────────────────────────────────────────────────────────
type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const codeText = (cc: unknown): string => {
  const o = (cc ?? {}) as Json;
  return str(o.text) || str(arr(o.coding)[0]?.display) || str(arr(o.coding)[0]?.code);
};
const refId = (ref: unknown, type: string): string => {
  const m = str((ref as Json | undefined)?.reference).match(new RegExp(`(?:^|/)${type}/([A-Za-z0-9\\-.]{1,200})$`));
  return m ? m[1]! : "";
};

/** Most a single run reads from one list. More than this is reported as cut short. */
export const EHR_LIST_CAP = 150;
/** One run (token, list, every patient) must finish within this. */
export const EHR_REPORT_DEADLINE_MS = 60_000;
const EHR_PARALLEL = 6;

export class ReportError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

/** Initials from a FHIR Patient name — never the name itself. */
export function initialsOf(patient: Json | undefined): string {
  const names = arr(patient?.name);
  const n = names.find((x) => x.use === "official") ?? names[0];
  if (!n) return "—";
  const given = arr(n.given as unknown).length ? (n.given as unknown as string[]) : [];
  const first = str(given[0]) || str(n.text).trim().split(/\s+/)[0] || "";
  const last = str(n.family) || str(n.text).trim().split(/\s+/).slice(-1)[0] || "";
  const out = ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
  return out || "—";
}

export function ageOf(patient: Json | undefined, now: Date): number | null {
  const b = str(patient?.birthDate);
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(b)) return null;
  const [y, m = "01", d = "01"] = b.split("-");
  let age = now.getUTCFullYear() - Number(y);
  if (now.getUTCMonth() + 1 < Number(m) || (now.getUTCMonth() + 1 === Number(m) && now.getUTCDate() < Number(d))) age--;
  return age >= 0 && age < 130 ? age : null;
}

/** The encounter a census row describes: the one in progress, else the newest. */
export function currentEncounter(encounters: Json[]): Json | undefined {
  const start = (e: Json) => Date.parse(str((e.period as Json | undefined)?.start)) || 0;
  const order = ["in-progress", "arrived", "triaged", "onleave", "planned"];
  return [...encounters].sort((a, b) => {
    const ra = order.indexOf(str(a.status)), rb = order.indexOf(str(b.status));
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || start(b) - start(a);
  })[0];
}

export function ehrRow(patient: Json | undefined, enc: Json | undefined, now: Date): ReportRow {
  const locs = arr(enc?.location);
  // The current location is the one still open (no period.end), else the last.
  const loc = locs.find((l) => !str((l.period as Json | undefined)?.end)) ?? locs[locs.length - 1];
  const attending =
    arr(enc?.participant).find((p) => arr(p.type).some((t) => arr(t.coding).some((c) => str(c.code) === "ATND"))) ??
    arr(enc?.participant)[0];
  const startAt = str((enc?.period as Json | undefined)?.start);
  const open = enc && !str((enc.period as Json | undefined)?.end);
  return {
    patient: initialsOf(patient),
    age: ageOf(patient, now),
    sex: str(patient?.gender) || null,
    location: str((loc?.location as Json | undefined)?.display) || null,
    unit: str((enc?.serviceProvider as Json | undefined)?.display) || null,
    attending: str((attending?.individual as Json | undefined)?.display) || null,
    encounterStatus: str(enc?.status) || null,
    encounterClass: str((enc?.class as Json | undefined)?.display) || str((enc?.class as Json | undefined)?.code) || null,
    service: codeText(enc?.serviceType) || null,
    admittedAt: startAt && Number.isFinite(Date.parse(startAt)) ? new Date(startAt).toISOString() : null,
    losHours: open && startAt ? hoursSince(startAt, now) : null,
    reason: arr(enc?.reasonCode).map(codeText).filter(Boolean).join("; ") || null,
  };
}

export interface ReportingDeps extends EpicClientDeps {}

async function ehrSession(db: DatabaseStorage, orgId: number, deps: ReportingDeps) {
  const cfg = await epicConfigFor(db, orgId, deps.env);
  if (!cfg) throw new ReportError("ehr_not_connected", 409);
  const fetchImpl = fetchFor(cfg, deps.fetchImpl, AbortSignal.timeout(EHR_REPORT_DEADLINE_MS));
  try {
    const token = await getAccessToken(cfg, { fetchImpl, now: deps.now });
    return { cfg, fetchImpl, token };
  } catch (err) {
    throw new ReportError(`ehr_failed:${sanitizeError(err, cfg)}`, 502);
  }
}

async function fhirGet(url: string, token: string, fetchImpl: typeof fetch): Promise<Json> {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/fhir+json" } });
  if (!res.ok) throw new Error(`epic_fhir_http_${res.status}`);
  return (await res.json()) as Json;
}

/** The patient lists the connected Epic app can see (id and title only). */
export async function listEhrPatientLists(db: DatabaseStorage, orgId: number, deps: ReportingDeps = {}): Promise<Array<{ id: string; title: string }>> {
  const { cfg, fetchImpl, token } = await ehrSession(db, orgId, deps);
  try {
    const bundle = await fetchAllPages(`${cfg.baseUrl}/List?code=patients&_count=100`, token, fetchImpl);
    return (bundle.entry ?? [])
      .map((e) => e.resource as Json | undefined)
      .filter((r): r is Json => !!r && r.resourceType === "List" && FHIR_ID.test(str(r.id)))
      .map((r) => ({ id: str(r.id), title: (str(r.title) || codeText(r.code) || str(r.id)).slice(0, 120) }))
      .slice(0, 200);
  } catch (err) {
    throw new ReportError(`ehr_failed:${sanitizeError(err, cfg)}`, 502);
  }
}

async function ehrRows(
  db: DatabaseStorage,
  orgId: number,
  listId: string,
  now: Date,
  deps: ReportingDeps,
): Promise<{ rows: ReportRow[]; title: string | null; truncated: boolean; unread: number }> {
  if (!FHIR_ID.test(listId)) throw new ReportError("ehr_list_required");
  const { cfg, fetchImpl, token } = await ehrSession(db, orgId, deps);
  let list: Json;
  try {
    list = await fhirGet(`${cfg.baseUrl}/List/${listId}`, token, fetchImpl);
  } catch (err) {
    throw new ReportError(`ehr_failed:${sanitizeError(err, cfg)}`, 502);
  }
  // Entries point at a Patient; some sites also name the Encounter.
  const members: Array<{ patientId: string; encounterId: string }> = [];
  const seen = new Set<string>();
  for (const e of arr(list.entry)) {
    if (e.deleted === true) continue;
    const patientId = refId(e.item, "Patient");
    const encounterId =
      refId(e.item, "Encounter") ||
      refId(arr(e.extension).map((x) => x.valueReference).find((r) => refId(r, "Encounter")), "Encounter");
    const key = patientId || `enc:${encounterId}`;
    if ((!patientId && !encounterId) || seen.has(key)) continue;
    seen.add(key);
    members.push({ patientId, encounterId });
  }
  const truncated = members.length > EHR_LIST_CAP;
  const work = members.slice(0, EHR_LIST_CAP);

  let unread = 0;
  const rows: ReportRow[] = new Array(work.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < work.length; i = next++) {
      const m = work[i]!;
      try {
        let enc: Json | undefined;
        let patientId = m.patientId;
        if (m.encounterId) {
          enc = await fhirGet(`${cfg.baseUrl}/Encounter/${m.encounterId}`, token, fetchImpl);
          patientId = patientId || refId(enc.subject, "Patient");
        }
        if (!patientId) throw new Error("no_patient");
        const patient = await fhirGet(`${cfg.baseUrl}/Patient/${patientId}`, token, fetchImpl);
        if (!enc) {
          const found = await fetchAllPages(`${cfg.baseUrl}/Encounter?patient=${patientId}&_count=20`, token, fetchImpl);
          enc = currentEncounter((found.entry ?? []).map((x) => x.resource as Json).filter((r) => r && r.resourceType === "Encounter"));
        }
        rows[i] = ehrRow(patient, enc, now);
      } catch {
        unread++; // one unreadable patient never fails the whole list
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(EHR_PARALLEL, work.length) }, worker));
  const read = rows.filter(Boolean);
  // Every patient failing is a failed report, not an empty list.
  if (work.length && !read.length) throw new ReportError("ehr_failed:epic_patients_unreadable", 502);
  return { rows: read, title: str(list.title) || null, truncated, unread };
}

export interface ReportResult {
  dataset: DatasetId;
  source: "docturn" | "ehr";
  columns: ReportColumn[];
  rows: ReportRow[];
  groupBy: string | null;
  total: number;
  generatedAt: string;
  /** Plain statements about what this result does not include. */
  notes: string[];
}

export async function runReport(
  db: DatabaseStorage,
  orgId: number,
  dataset: DatasetId,
  config: ReportConfig,
  deps: ReportingDeps = {},
): Promise<ReportResult> {
  const problem = configProblem(dataset, config);
  if (problem) throw new ReportError(problem);
  const now = deps.now?.() ?? new Date();
  const notes: string[] = [];
  let all: ReportRow[];
  if (DATASETS[dataset].source === "ehr") {
    const r = await ehrRows(db, orgId, config.ehrListId!, now, deps);
    all = r.rows;
    if (r.truncated) notes.push(`This list has more than ${EHR_LIST_CAP} patients; only the first ${EHR_LIST_CAP} are shown.`);
    if (r.unread) notes.push(`${r.unread} patient${r.unread === 1 ? "" : "s"} on the list could not be read from Epic and ${r.unread === 1 ? "is" : "are"} not shown.`);
  } else {
    all = await docturnRows(db, orgId, dataset, now);
    if (dataset === "team_census") {
      // The census COUNTER on each hospitalist is a number the team keeps
      // (accepts add to it; a director can set it). The rows here are the
      // patients DocTurn still has on record. When they differ, say so.
      const counted = (await db.listHospitalists(orgId)).reduce((n, h) => n + h.currentPatientCount, 0);
      if (counted !== all.length) {
        const raw = await db.getOrgSetting(orgId, "autoCleanHours");
        const hours = typeof raw === "number" ? Math.max(0, raw) : 24;
        notes.push(
          `Hospitalists' census counters add up to ${counted}; DocTurn has ${all.length} of those patients on record. ` +
            (hours > 0 ? `DocTurn removes a patient ${hours} hours after it was entered. ` : "") +
            "A complete census comes from an Epic patient list report.",
        );
      }
    }
  }
  const { columns, rows } = applyConfig(dataset, config, all);
  return { dataset, source: DATASETS[dataset].source, columns, rows, groupBy: config.groupBy, total: rows.length, generatedAt: now.toISOString(), notes };
}

// ── CSV ──────────────────────────────────────────────────────────────────────
function csvCell(v: string | number | null): string {
  if (v == null) return "";
  let s = String(v);
  // A cell a spreadsheet would run as a formula is written as text.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(result: Pick<ReportResult, "columns" | "rows">): string {
  const lines = [result.columns.map((c) => csvCell(c.label)).join(",")];
  for (const r of result.rows) lines.push(result.columns.map((c) => csvCell(r[c.id] ?? null)).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** A saved row → the shape the API returns, or null when its config no longer validates. */
export function publicDefinition(row: ReportDefinition, ownerName: string | null, meId: number) {
  const parsed = reportConfigSchema.safeParse(row.config);
  if (!parsed.success || !(row.dataset in DATASETS)) return null;
  return {
    id: String(row.id),
    name: row.name,
    dataset: row.dataset as DatasetId,
    config: parsed.data,
    shared: row.shared,
    builtin: false as const,
    mine: row.ownerUserId === meId,
    ownerName,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}
