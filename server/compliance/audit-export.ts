/**
 * Audit export, enterprise form (E2 — module `enterprise.auditExport`).
 *
 * GET /api/audit/export is older than this module: `?trail=audit|phi&scope=
 * org|mine` is the Compliance screen's "Export CSV" button and stays exactly
 * as it was, ungated (taking the trail away from every org would be a
 * regression, not a feature). The ENTERPRISE form is recognised by any of
 * `from`, `to`, `format` or `orgId` and adds what a hospital IT security
 * review asks for:
 *
 *   • a date range (`from` / `to`, UTC days or full ISO instants, inclusive);
 *   • CSV **or** JSON (`format`);
 *   • a developer's cross-tenant read (`orgId`), audited on the TARGET org;
 *   • streaming — the rows are written in pages as they are read, so a
 *     six-year trail never has to fit in memory;
 *   • PHI-FREE columns only (below), with the free-text `details` object
 *     projected through an allow-list instead of being dumped verbatim.
 *
 * Why `details` needs projecting: `audit_logs.details` is JSONB that every
 * route fills with whatever it needs, and a handful of routes put a NAME in
 * it (a consult service's name, an org's name, an error string). None of
 * those is patient data today, but an export that an auditor keeps outside
 * DocTurn must not depend on that staying true, so the projection is a
 * positive allow-list, not a deny-list:
 *
 *   • a number, boolean or null value is emitted whatever its key — ids,
 *     counts and flags cannot carry free text;
 *   • an array of numbers is emitted joined with "|" (id lists);
 *   • a STRING value is emitted only under one of SAFE_DETAIL_STRING_KEYS —
 *     the structural keys below (a role, an action, a module id, a reason …);
 *   • an array of strings is emitted only under SAFE_DETAIL_KEY_LIST_KEYS,
 *     whose values are COLUMN / SETTING NAMES, never their values;
 *   • everything else is dropped and its KEY is named in the row's
 *     `details_omitted` column, so the export never hides that something was
 *     recorded — it only refuses to copy the value out.
 */
import type { AuditLog, PhiAccessLog } from "@shared/schema";

/** String-valued detail keys whose values are structural, never free text. */
export const SAFE_DETAIL_STRING_KEYS: readonly string[] = [
  "action",
  "code",
  "controlId",
  "format",
  "integration",
  "key",
  "level",
  "method",
  "mimeType",
  "module",
  "priority",
  "reason",
  "requestedRole",
  "result",
  "riskLevel",
  "role",
  "scope",
  "severity",
  "shift",
  "source",
  "status",
  "targetKind",
  "trail",
  "trigger",
  "username",
  "vendor",
];

/** Array-valued detail keys that list COLUMN / SETTING NAMES, not values. */
export const SAFE_DETAIL_KEY_LIST_KEYS: readonly string[] = ["changedKeys", "fields", "keys", "themeKeys"];

export interface SafeDetails {
  /** Key → the exported scalar, already stringified. */
  kept: Record<string, string>;
  /** Keys whose value was NOT exported (free text, or a nested object). */
  omitted: string[];
}

/** Project one audit row's `details` down to its PHI-free part. */
export function safeDetails(details: unknown): SafeDetails {
  const kept: Record<string, string> = {};
  const omitted: string[] = [];
  if (!details || typeof details !== "object" || Array.isArray(details)) return { kept, omitted };
  for (const [k, v] of Object.entries(details as Record<string, unknown>)) {
    if (v === null || v === undefined) {
      kept[k] = "";
    } else if (typeof v === "number" || typeof v === "boolean") {
      kept[k] = String(v);
    } else if (typeof v === "string") {
      if (SAFE_DETAIL_STRING_KEYS.includes(k)) kept[k] = v;
      else omitted.push(k);
    } else if (Array.isArray(v)) {
      if (v.every((x) => typeof x === "number")) kept[k] = v.join("|");
      else if (SAFE_DETAIL_KEY_LIST_KEYS.includes(k) && v.every((x) => typeof x === "string")) kept[k] = v.join("|");
      else omitted.push(k);
    } else {
      omitted.push(k);
    }
  }
  return { kept, omitted };
}

/** Rendered `details` cell: "k=v; k=v" — stable key order for diffable exports. */
export function renderDetails(d: SafeDetails): string {
  return Object.keys(d.kept)
    .sort()
    .map((k) => `${k}=${d.kept[k]}`)
    .join("; ");
}

/* ── columns ────────────────────────────────────────────────────────────────
 * Both sets carry ids, actions, times and workforce identity. No patient
 * name, no clinical content, no message text, no note. `patient_id` is
 * DocTurn's own row id — not an MRN, a name or a date of birth — and it is
 * what makes the PHI trail usable for a §164.528 accounting of disclosures,
 * so it stays. `user_agent` does NOT: it is the only column that carries a
 * free-form string the client chose, and an accounting never needs it (the
 * in-app PHI trail and the legacy CSV still show it).
 */
export const EXPORT_AUDIT_COLUMNS = [
  "occurred_at_utc",
  "action",
  "risk",
  "actor_user_id",
  "actor_username",
  "actor_role",
  "actor_name",
  "operator_user_id",
  "operator_username",
  "resource_type",
  "resource_id",
  "details",
  "details_omitted",
] as const;

export const EXPORT_PHI_COLUMNS = [
  "occurred_at_utc",
  "method",
  "actor_user_id",
  "actor_username",
  "actor_role",
  "actor_name",
  "operator_user_id",
  "operator_username",
  "resource",
  "resource_id",
  "patient_id",
  "ip",
] as const;

export type ExportTrail = "audit" | "phi";
export type ExportFormat = "csv" | "json";

/** Who an exported row's actor / operator was, resolved server-side. */
export interface ExportActor {
  userId: number | null;
  username: string | null;
  role: string | null;
  name: string;
}

export interface ExportWho {
  actor: ExportActor;
  operator: ExportActor;
}

const NOBODY: ExportActor = { userId: null, username: null, role: null, name: "" };

export function auditRowCells(row: AuditLog, who: ExportWho): Record<string, string> {
  const d = safeDetails(row.details);
  return {
    occurred_at_utc: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    action: row.action,
    risk: row.riskLevel,
    actor_user_id: row.userId == null ? "" : String(row.userId),
    actor_username: who.actor.username ?? "",
    actor_role: who.actor.role ?? "",
    actor_name: who.actor.name,
    operator_user_id: row.impersonatorUserId == null ? "" : String(row.impersonatorUserId),
    operator_username: who.operator.username ?? "",
    resource_type: row.resourceType ?? "",
    resource_id: row.resourceId == null ? "" : String(row.resourceId),
    details: renderDetails(d),
    details_omitted: d.omitted.sort().join("|"),
  };
}

export function phiRowCells(row: PhiAccessLog, who: ExportWho): Record<string, string> {
  return {
    occurred_at_utc: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    method: row.method,
    actor_user_id: row.userId == null ? "" : String(row.userId),
    actor_username: who.actor.username ?? "",
    actor_role: who.actor.role ?? "",
    actor_name: who.actor.name,
    operator_user_id: row.impersonatorUserId == null ? "" : String(row.impersonatorUserId),
    operator_username: who.operator.username ?? "",
    resource: row.resource,
    resource_id: row.resourceId == null ? "" : String(row.resourceId),
    patient_id: row.patientId == null ? "" : String(row.patientId),
    ip: row.ip ?? "",
  };
}

export function emptyWho(): ExportWho {
  return { actor: NOBODY, operator: NOBODY };
}

/* ── request parsing ──────────────────────────────────────────────────────── */

/**
 * Does this request use the ENTERPRISE form? Also the GATE_TABLE predicate
 * (server/modules.ts), so the legacy `?trail=…&scope=…` export is never
 * refused by the module switch.
 */
export function isEnterpriseExportRequest(query: Record<string, unknown>): boolean {
  for (const k of ["from", "to", "format", "orgId"]) {
    const v = query[k];
    if (typeof v === "string" && v.trim() !== "") return true;
  }
  return false;
}

export type ExportRequest =
  | { ok: false }
  | {
      ok: true;
      trail: ExportTrail;
      format: ExportFormat;
      /** Inclusive lower bound, or null for "from the beginning". */
      from: Date | null;
      /** Inclusive upper bound, or null for "up to now". */
      to: Date | null;
      /** Another tenant named by a developer, else null (the caller's own). */
      orgId: number | null;
    };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A bound: a UTC day (`2026-02-10`) or a full ISO instant. A day used as the
 * UPPER bound covers the whole day (…T23:59:59.999Z), so from=to=one day is
 * that day — what "a date range" means to the person typing it.
 */
function parseBound(raw: string, end: boolean): Date | null {
  const s = raw.trim();
  if (DAY_RE.test(s)) {
    const d = new Date(s + (end ? "T23:59:59.999Z" : "T00:00:00.000Z"));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Validate the enterprise query. Returns { ok:false } for a 400. */
export function parseExportRequest(query: Record<string, unknown>): ExportRequest {
  const str = (k: string) => {
    const v = query[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const trail = str("trail") || "audit";
  if (trail !== "audit" && trail !== "phi") return { ok: false };
  const format = str("format") || "csv";
  if (format !== "csv" && format !== "json") return { ok: false };
  let from: Date | null = null;
  let to: Date | null = null;
  if (str("from")) {
    from = parseBound(str("from"), false);
    if (!from) return { ok: false };
  }
  if (str("to")) {
    to = parseBound(str("to"), true);
    if (!to) return { ok: false };
  }
  if (from && to && from.getTime() > to.getTime()) return { ok: false };
  let orgId: number | null = null;
  if (str("orgId")) {
    const n = Number(str("orgId"));
    if (!Number.isInteger(n) || n <= 0) return { ok: false };
    orgId = n;
  }
  return { ok: true, trail, format, from, to, orgId };
}

/** One CSV cell: quoted, and never something a spreadsheet would run as a formula. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export const csvLine = (cells: unknown[]) => cells.map(csvCell).join(",") + "\r\n";
