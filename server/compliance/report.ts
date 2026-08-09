/**
 * DocTurn continuous-control monitor — REPORT ASSEMBLY.
 *
 * Merges the live automated results (./checks.ts) with the organization's
 * human attestations, and builds the auditor evidence pack.
 *
 * Two rules govern everything here:
 *  1. An automated control's status is whatever the check just measured. It is
 *     never overridden, defaulted, or improved by an attestation — an org
 *     cannot attest a failing technical control into passing.
 *  2. A manual control's status comes ONLY from a recorded attestation. With no
 *     attestation the status is "manual": a human still has to answer it.
 */

import { getHandle } from "../db.js";
import type { DatabaseStorage } from "../storage.js";
import type { ComplianceAttestation, Organization } from "@shared/schema";
import { runAutoChecks, type CheckResult } from "./checks.js";
import {
  CONTROLS,
  SCOPE_AND_LIMITATIONS,
  type ControlDef,
  type ControlSeverity,
  type ControlStatus,
} from "./controls.js";

export interface ControlReport extends ControlDef {
  status: ControlStatus;
  detail: string;
  evidence: Record<string, unknown>;
  /** Severity after real-PHI-mode escalation (see escalate()). */
  effectiveSeverity: ControlSeverity;
  /** True when the status came from a human attestation, not from a measurement. */
  humanAttested: boolean;
  attestation: {
    status: string;
    owner: string | null;
    note: string | null;
    evidenceUrl: string | null;
    attestedAt: string | null;
    reviewDue: string | null;
    reviewOverdue: boolean;
  } | null;
}

export interface ComplianceSummary {
  pass: number;
  warn: number;
  fail: number;
  manual: number;
  unknown: number;
  total: number;
  readinessPct: number;
}

export interface ComplianceMode {
  synthetic: boolean;
  label: "SYNTHETIC" | "REAL-PHI";
  nodeEnv: string;
  persistentDatabase: boolean;
}

export interface ComplianceReport {
  generatedAt: string;
  organization: { id: number; name: string; code: string };
  mode: ComplianceMode;
  summary: ComplianceSummary;
  controls: ControlReport[];
  limitations: typeof SCOPE_AND_LIMITATIONS;
}

const SEVERITY_ORDER: ControlSeverity[] = ["low", "medium", "high", "critical"];

/** One notch up, capped at critical. Applied only in real-PHI mode. */
function escalate(sev: ControlSeverity): ControlSeverity {
  const i = SEVERITY_ORDER.indexOf(sev);
  return SEVERITY_ORDER[Math.min(i + 1, SEVERITY_ORDER.length - 1)] ?? sev;
}

function iso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

/** Map a recorded attestation onto the shared five-status vocabulary. */
function statusFromAttestation(
  row: ComplianceAttestation | undefined,
  overdue: boolean,
): { status: ControlStatus; detail: string } {
  if (!row) {
    return {
      status: "manual",
      detail:
        "No attestation recorded. Code cannot establish this control — a named owner must confirm it and attach the evidence an auditor would ask for.",
    };
  }
  const who = row.owner ? `${row.owner}` : "an unnamed owner";
  const when = row.attestedAt
    ? new Date(row.attestedAt).toISOString().slice(0, 10)
    : "an unrecorded date";
  const suffix = row.evidenceUrl
    ? " Evidence link recorded."
    : " No evidence link recorded.";
  switch (row.status) {
    case "met":
      return overdue
        ? {
            status: "warn",
            detail: `Attested as met by ${who} on ${when}, but the scheduled review date has passed — the attestation is stale and must be renewed.${suffix}`,
          }
        : {
            status: "pass",
            detail: `Attested as met by ${who} on ${when}. This status is a HUMAN assertion, not a measurement.${suffix}`,
          };
    case "na":
      return {
        status: "pass",
        detail: `Marked not applicable by ${who} on ${when}. This status is a HUMAN assertion, not a measurement.${suffix}`,
      };
    case "in_progress":
      return {
        status: "warn",
        detail: `Recorded as in progress by ${who} on ${when}.${suffix}`,
      };
    case "not_met":
    default:
      return {
        status: "fail",
        detail: `Recorded as NOT met by ${who} on ${when}.${suffix}`,
      };
  }
}

/**
 * Run every automated check and merge in the org's attestations. Everything in
 * the returned report was computed during this call.
 */
export async function buildComplianceReport(
  store: DatabaseStorage,
  org: Organization,
): Promise<ComplianceReport> {
  const rows = await store.listAttestations(org.id);
  const attestations = new Map(rows.map((r) => [r.controlId, r]));
  const auto = await runAutoChecks({
    organizationId: org.id,
    store,
    attestations,
  });

  const synthetic = process.env.SYNTHETIC_DATA !== "false";
  const now = Date.now();

  const controls: ControlReport[] = CONTROLS.map((def) => {
    let status: ControlStatus;
    let detail: string;
    let evidence: Record<string, unknown>;
    let humanAttested = false;
    let attestation: ControlReport["attestation"] = null;

    if (def.kind === "auto") {
      const result: CheckResult | undefined = auto[def.id];
      if (!result) {
        // A catalogued auto control with no implementation must never look OK.
        status = "unknown";
        detail =
          "This control is catalogued as automated but no check is implemented for it — treat it as unverified.";
        evidence = { implemented: false };
      } else {
        status = result.status;
        detail = result.detail;
        evidence = result.evidence;
      }
    } else {
      const row = attestations.get(def.id);
      const overdue = !!(
        row?.reviewDue && new Date(row.reviewDue).getTime() < now
      );
      const mapped = statusFromAttestation(row, overdue);
      status = mapped.status;
      detail = mapped.detail;
      humanAttested = !!row;
      evidence = {
        source: "human attestation",
        attested: !!row,
        attestationStatus: row?.status ?? null,
      };
      attestation = row
        ? {
            status: row.status,
            owner: row.owner,
            note: row.note,
            evidenceUrl: row.evidenceUrl,
            attestedAt: iso(row.attestedAt),
            reviewDue: iso(row.reviewDue),
            reviewOverdue: overdue,
          }
        : null;
    }

    // Real-PHI mode: anything not clean carries real patient risk.
    const needsAttention =
      status === "fail" || status === "warn" || status === "unknown";
    const effectiveSeverity =
      !synthetic && needsAttention ? escalate(def.severity) : def.severity;

    return {
      ...def,
      status,
      detail,
      evidence,
      effectiveSeverity,
      humanAttested,
      attestation,
    };
  });

  const summary = summarize(controls);

  return {
    generatedAt: new Date().toISOString(),
    organization: { id: org.id, name: org.name, code: org.code },
    mode: {
      synthetic,
      label: synthetic ? "SYNTHETIC" : "REAL-PHI",
      nodeEnv: process.env.NODE_ENV ?? "development",
      persistentDatabase: !getHandle().ephemeral,
    },
    summary,
    controls,
    limitations: SCOPE_AND_LIMITATIONS,
  };
}

export function summarize(controls: ControlReport[]): ComplianceSummary {
  const counts = { pass: 0, warn: 0, fail: 0, manual: 0, unknown: 0 };
  for (const c of controls) counts[c.status] += 1;
  const total = controls.length;
  // Only an actual pass counts. Warn, fail, manual and unknown are all zero —
  // readiness never borrows credit from a control nobody has answered.
  const readinessPct = total === 0 ? 0 : Math.round((counts.pass / total) * 100);
  return { ...counts, total, readinessPct };
}

/**
 * The auditor evidence pack. A single self-describing JSON document:
 * what was checked, what it found, who attested to what, aggregate audit-log
 * statistics, and — critically — what this evidence does NOT establish.
 *
 * Contains NO patient data of any kind: no patient rows, no initials, no room
 * numbers, no message content, and no raw audit rows (which can carry
 * free-text details). Only counts, dates, control results and attestations.
 */
export async function buildEvidencePack(
  store: DatabaseStorage,
  org: Organization,
  exportedBy: { id: number; role: string },
): Promise<Record<string, unknown>> {
  const report = await buildComplianceReport(store, org);
  const auditStats = await store.auditStats(org.id);
  const phiStats = await store.phiAccessStats(org.id);
  const attestations = await store.listAttestations(org.id);

  return {
    document: "DocTurn compliance evidence pack",
    version: 1,
    generatedAt: report.generatedAt,
    exportedBy: { userId: exportedBy.id, role: exportedBy.role },
    system: {
      application: process.env.APP_NAME ?? "DocTurn",
      organization: report.organization,
      mode: report.mode,
      runtime: {
        node: process.version,
        platform: process.platform,
      },
      database: {
        persistent: report.mode.persistentDatabase,
        driver: report.mode.persistentDatabase
          ? "postgres (external)"
          : "pglite (in-process)",
      },
    },
    summary: report.summary,
    controls: report.controls.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      category: c.category,
      kind: c.kind,
      status: c.status,
      detail: c.detail,
      severity: c.effectiveSeverity,
      baselineSeverity: c.severity,
      humanAttested: c.humanAttested,
      citations: { hipaa: c.hipaa, soc2: c.soc2 },
      evidence: c.evidence,
      remediation: c.remediation,
    })),
    attestationRegister: attestations.map((a) => ({
      controlId: a.controlId,
      status: a.status,
      owner: a.owner,
      note: a.note,
      evidenceUrl: a.evidenceUrl,
      attestedAt: iso(a.attestedAt),
      reviewDue: iso(a.reviewDue),
      updatedByUserId: a.updatedBy,
    })),
    auditLogStatistics: {
      note: "Aggregate counts only. Raw audit rows are deliberately excluded from this export — their free-text details can reference clinical context.",
      totalEvents: auditStats.total,
      eventsLast24h: auditStats.last24h,
      eventsLast30d: auditStats.last30d,
      oldestEventAt: iso(auditStats.oldestAt),
      newestEventAt: iso(auditStats.newestAt),
      countsByRiskLevel: auditStats.byRisk,
      countsByAction: auditStats.byAction,
      phiAccess: {
        total: phiStats.total,
        reads: phiStats.reads,
        writes: phiStats.writes,
        oldestAt: iso(phiStats.oldestAt),
        newestAt: iso(phiStats.newestAt),
      },
    },
    scopeAndLimitations: SCOPE_AND_LIMITATIONS,
    phiStatement:
      "This document contains no protected health information: no patient records, identifiers, initials, room numbers, clinical notes, message content or raw audit rows are included. It carries control results, aggregate counts, and organizational attestations only.",
  };
}
