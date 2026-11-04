import type { Express, Request, Response } from "express";
import { attestationUpsertSchema, type AuditLog, type PhiAccessLog, type User } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { CONTROL_BY_ID } from "../compliance/controls.js";
import {
  auditRowCells,
  csvLine as exportCsvLine,
  EXPORT_AUDIT_COLUMNS,
  EXPORT_PHI_COLUMNS,
  isEnterpriseExportRequest,
  parseExportRequest,
  phiRowCells,
  type ExportActor,
  type ExportWho,
} from "../compliance/audit-export.js";
import { isModuleEnabled } from "../modules.js";
import {
  buildComplianceReport,
  buildEvidencePack,
} from "../compliance/report.js";
import {
  listPolicyTemplates,
  renderPolicy,
} from "../compliance/policies.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";

/** Roles allowed to see compliance posture, matching /api/reports/ops. */
const COMPLIANCE_ROLES = ["director", "er_director", "developer"] as const;

/** Rows per CSV export; a longer trail exports its newest rows and says so. */
export const EXPORT_MAX_ROWS = 50_000;

type Who = Pick<User, "id" | "displayName" | "username" | "role">;

/**
 * Who each row's actor (and, for an impersonated session, the operator) is —
 * resolved on the server, so the trail never shows "User 2" with no role
 * because the client only knew the hospitalist directory (A.CON
 * comms-account #7/#8). Operators live in the platform org, hence by id.
 */
async function actorResolver(orgId: number, rows: Array<{ userId: number | null; impersonatorUserId: number | null }>) {
  const byId = new Map<number, Who>();
  for (const u of await storage().listUsers(orgId)) byId.set(u.id, u);
  const missing = new Set<number>();
  for (const r of rows) {
    for (const id of [r.userId, r.impersonatorUserId]) if (id != null && !byId.has(id)) missing.add(id);
  }
  for (const id of missing) {
    const u = await storage().getUserById(id);
    if (u) byId.set(id, u);
  }
  return (row: { userId: number | null; impersonatorUserId: number | null }) => {
    const u = row.userId != null ? byId.get(row.userId) : undefined;
    const op = row.impersonatorUserId != null ? byId.get(row.impersonatorUserId) : undefined;
    return {
      actorName: row.userId == null ? "System" : u ? u.displayName : `User #${row.userId}`,
      actorUsername: u ? u.username : null,
      actorRole: u ? u.role : null,
      operatorName: row.impersonatorUserId == null ? null : op ? op.displayName : `User #${row.impersonatorUserId}`,
    };
  };
}

/**
 * One trail page + both trails' TRUE sizes, for the org or (userId set) for
 * one user's own rows. The rows are the latest page; the counts are not.
 */
async function trailPage(orgId: number, userId?: number) {
  const [audit, phi, phiCount, auditCount] = await Promise.all([
    storage().listAuditLogs(orgId, 100, userId),
    storage().listPhiAccess(orgId, 50, userId),
    storage().countPhiAccess(orgId, userId),
    storage().countAuditLogs(orgId, userId),
  ]);
  const who = await actorResolver(orgId, [...audit, ...phi]);
  return {
    audit: audit.map((r) => ({ ...r, ...who(r) })),
    auditCount,
    phiAccess: phi.map((r) => ({ ...r, ...who(r) })),
    phiAccessCount: phiCount,
  };
}

/** One CSV cell: quoted, and never something a spreadsheet would run as a formula. */
function csvCell(v: unknown): string {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
const csvLine = (cells: unknown[]) => cells.map(csvCell).join(",") + "\r\n";

const AUDIT_COLUMNS = ["occurred_at_utc", "actor", "actor_username", "actor_role", "operator", "action", "resource_type", "resource_id", "risk", "details"];
const PHI_COLUMNS = ["occurred_at_utc", "actor", "actor_username", "actor_role", "operator", "method", "resource", "resource_id", "patient_id", "ip", "user_agent"];

/* ── E2 enterprise audit export ──────────────────────────────────────────────
 * Module `enterprise.auditExport` (GATE_TABLE, off by default) — the module
 * gate in server/modules.ts answers 404 for the enterprise form only, so the
 * legacy export above keeps working for every org.
 */

/** Rows read (and written) per page while streaming. */
const EXPORT_PAGE = 500;

/**
 * Resolve actors as the stream goes: the org's own users are loaded once,
 * and any id from outside it (an operator in the platform org, a user since
 * deleted) is looked up at most once and remembered.
 */
function actorStream(orgId: number) {
  const byId = new Map<number, Who | null>();
  let loaded = false;
  const nobody: ExportActor = { userId: null, username: null, role: null, name: "" };
  const of = (id: number | null): ExportActor => {
    if (id == null) return nobody;
    const u = byId.get(id) ?? null;
    return { userId: id, username: u?.username ?? null, role: u?.role ?? null, name: u ? u.displayName : `User #${id}` };
  };
  return {
    async learn(rows: Array<{ userId: number | null; impersonatorUserId: number | null }>) {
      if (!loaded) {
        for (const u of await storage().listUsers(orgId)) byId.set(u.id, u);
        loaded = true;
      }
      for (const r of rows) {
        for (const id of [r.userId, r.impersonatorUserId]) {
          if (id != null && !byId.has(id)) byId.set(id, (await storage().getUserById(id)) ?? null);
        }
      }
    },
    who(row: { userId: number | null; impersonatorUserId: number | null }): ExportWho {
      return { actor: of(row.userId), operator: of(row.impersonatorUserId) };
    },
  };
}

/**
 * The enterprise export. Director (and ER director) read their OWN org; a
 * developer may name any tenant with `orgId`, which is audited on THAT
 * tenant at high risk as the cross-tenant read it is. Streamed page by page;
 * PHI-free columns only (server/compliance/audit-export.ts).
 */
async function streamEnterpriseExport(req: Request, res: Response) {
  const me = currentUser(req);
  const parsed = parseExportRequest(req.query as Record<string, unknown>);
  if (!parsed.ok) return res.status(400).json({ error: "validation_error" });
  if (!(COMPLIANCE_ROLES as readonly string[]).includes(me.role)) {
    return res.status(403).json({ error: "forbidden" });
  }
  // Another tenant is the developer's privilege alone.
  const crossTenant = parsed.orgId != null && parsed.orgId !== me.organizationId;
  if (crossTenant && me.role !== "developer") return res.status(403).json({ error: "forbidden" });
  const orgId = parsed.orgId ?? me.organizationId;
  const org = await storage().getOrganization(orgId);
  if (!org) return res.status(404).json({ error: "not_found" });
  // A developer reading ANOTHER tenant's trail needs the module on for that
  // tenant too — the gate above only measured the operator's own org.
  if (crossTenant && !(await isModuleEnabled(orgId, "enterprise.auditExport"))) {
    return res.status(404).json({ error: "module_disabled", module: "enterprise.auditExport" });
  }

  const columns = parsed.trail === "audit" ? EXPORT_AUDIT_COLUMNS : EXPORT_PHI_COLUMNS;
  const stamp = new Date().toISOString().slice(0, 10);
  const code = String(org.code).replace(/[^A-Za-z0-9_-]/g, "");
  res.setHeader("Content-Type", parsed.format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="docturn-${parsed.trail}-${code}-${stamp}.${parsed.format}"`,
  );
  res.setHeader("Cache-Control", "no-store");
  // Written as it is read: there is no row count to put in a header.
  res.setHeader("X-Export-Streamed", "1");

  const actors = actorStream(orgId);
  let rows = 0;
  if (parsed.format === "json") {
    res.write(
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        organization: { id: org.id, code: org.code },
        trail: parsed.trail,
        from: parsed.from ? parsed.from.toISOString() : null,
        to: parsed.to ? parsed.to.toISOString() : null,
        columns: [...columns],
      }).replace(/\}$/, ',"rows":['),
    );
  } else {
    res.write(exportCsvLine([...columns]));
  }

  let afterId: number | undefined;
  for (;;) {
    const page =
      parsed.trail === "audit"
        ? await storage().pageAuditLogs(orgId, { limit: EXPORT_PAGE, afterId, from: parsed.from, to: parsed.to })
        : await storage().pagePhiAccess(orgId, { limit: EXPORT_PAGE, afterId, from: parsed.from, to: parsed.to });
    if (page.length === 0) break;
    await actors.learn(page as Array<{ userId: number | null; impersonatorUserId: number | null }>);
    for (const row of page) {
      const cells =
        parsed.trail === "audit"
          ? auditRowCells(row as AuditLog, actors.who(row as AuditLog))
          : phiRowCells(row as PhiAccessLog, actors.who(row as PhiAccessLog));
      if (parsed.format === "json") {
        res.write((rows ? "," : "") + JSON.stringify(cells));
      } else {
        res.write(exportCsvLine(columns.map((c) => cells[c] ?? "")));
      }
      rows++;
    }
    afterId = page[page.length - 1]!.id;
    if (page.length < EXPORT_PAGE) break;
  }
  if (parsed.format === "json") res.write(`],"rowCount":${rows}}`);

  await appendAudit({
    organizationId: orgId,
    userId: me.id,
    action: "audit.export",
    resourceType: "audit_trail",
    resourceId: null,
    details: {
      trail: parsed.trail,
      format: parsed.format,
      scope: "org",
      rows,
      from: parsed.from ? parsed.from.toISOString() : null,
      to: parsed.to ? parsed.to.toISOString() : null,
      ...(crossTenant ? { crossTenant: true, operatorOrganizationId: me.organizationId } : {}),
    },
    riskLevel: crossTenant ? "high" : "medium",
  });
  res.end();
}

// HIPAA audit trail + PHI access summary for the Compliance screen, plus the
// continuous control monitor (Vanta-style) and its auditor evidence export.
export function registerComplianceRoutes(app: Express) {
  app.get(
    "/api/audit",
    requireAuth,
    requireRole(...COMPLIANCE_ROLES),
    async (req, res) => {
      const me = currentUser(req);
      // The latest page of each trail plus each trail's TRUE size — a count
      // tile must never show the page length (A.CON developer #12/#14).
      res.json({ scope: "org", ...(await trailPage(me.organizationId)) });
    },
  );

  /**
   * The signed-in user's OWN trail — the audit events they performed and the
   * PHI they read (A.CON comms-account #9). Any role; their own org; rows
   * written while a developer operated as them carry that operator's name.
   */
  app.get("/api/audit/mine", requireAuth, async (req, res) => {
    const me = currentUser(req);
    res.json({ scope: "mine", ...(await trailPage(me.organizationId, me.id)) });
  });

  /**
   * The trail as CSV, produced here (A.CON comms-account #8): every row up to
   * EXPORT_MAX_ROWS (the newest, said in the headers when cut), oldest first,
   * full UTC timestamps, actor + username + role + operator; the PHI trail
   * with method, record ids, patient id, IP and user agent. Nothing the
   * server does not record (no "allowed"/"purpose"). scope=org is the
   * compliance roles'; scope=mine is anyone's own rows. Every export is
   * itself an audit row.
   */
  app.get("/api/audit/export", requireAuth, async (req, res) => {
    const me = currentUser(req);
    // E2: the enterprise form (a date range / JSON / another tenant) is a
    // different export with its own rules — see streamEnterpriseExport().
    if (isEnterpriseExportRequest(req.query as Record<string, unknown>)) {
      return streamEnterpriseExport(req, res);
    }
    const trail = String(req.query.trail ?? "");
    const scope = String(req.query.scope ?? "org");
    if ((trail !== "audit" && trail !== "phi") || (scope !== "org" && scope !== "mine")) {
      return res.status(400).json({ error: "validation_error" });
    }
    if (scope === "org" && !(COMPLIANCE_ROLES as readonly string[]).includes(me.role)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const userId = scope === "mine" ? me.id : undefined;
    const org = await storage().getOrganization(me.organizationId);
    if (!org) return res.status(404).json({ error: "not_found" });

    const total = trail === "audit"
      ? await storage().countAuditLogs(me.organizationId, userId)
      : await storage().countPhiAccess(me.organizationId, userId);
    let body = csvLine(trail === "audit" ? AUDIT_COLUMNS : PHI_COLUMNS);
    let rows = 0;
    if (trail === "audit") {
      const list = (await storage().listAuditLogs(me.organizationId, EXPORT_MAX_ROWS, userId)).reverse();
      const who = await actorResolver(me.organizationId, list);
      for (const r of list) {
        const w = who(r);
        body += csvLine([r.createdAt, w.actorName, w.actorUsername, w.actorRole, w.operatorName, r.action, r.resourceType, r.resourceId, r.riskLevel, r.details]);
      }
      rows = list.length;
    } else {
      const list = (await storage().listPhiAccess(me.organizationId, EXPORT_MAX_ROWS, userId)).reverse();
      const who = await actorResolver(me.organizationId, list);
      for (const r of list) {
        const w = who(r);
        body += csvLine([r.createdAt, w.actorName, w.actorUsername, w.actorRole, w.operatorName, r.method, r.resource, r.resourceId, r.patientId, r.ip, r.userAgent]);
      }
      rows = list.length;
    }
    const truncated = rows < total;
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "audit.export",
      resourceType: "audit_trail",
      resourceId: null,
      details: { trail, scope, rows, total, truncated },
      riskLevel: scope === "org" ? "medium" : "low",
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const code = String(org.code).replace(/[^A-Za-z0-9_-]/g, "");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="docturn-${trail}-${code}${scope === "mine" ? "-mine" : ""}-${stamp}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Export-Rows", String(rows));
    res.setHeader("X-Export-Total", String(total));
    res.setHeader("X-Export-Truncated", truncated ? "1" : "0");
    res.send(body);
  });

  /**
   * Live control posture. Every automated control is RECOMPUTED on each call
   * from database state and runtime configuration — nothing is cached, so a
   * stale green can never be served.
   */
  app.get(
    "/api/compliance/status",
    requireAuth,
    requireRole(...COMPLIANCE_ROLES),
    async (req, res) => {
      const me = currentUser(req);
      const org = await storage().getOrganization(me.organizationId);
      if (!org) return res.status(404).json({ error: "not_found" });
      const report = await buildComplianceReport(storage(), org);
      res.json(report);
    },
  );

  /**
   * Record one MANUAL attestation. Automated controls are rejected outright:
   * an organization must never be able to attest a failing technical safeguard
   * into a passing state.
   */
  app.patch(
    "/api/compliance/attestation",
    requireAuth,
    requireRole(...COMPLIANCE_ROLES),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = attestationUpsertSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "validation_error" });
      }
      const def = CONTROL_BY_ID.get(parsed.data.controlId);
      if (!def) return res.status(404).json({ error: "unknown_control" });
      if (def.kind !== "manual") {
        return res.status(400).json({ error: "control_is_automated" });
      }
      const reviewDue = parsed.data.reviewDue
        ? new Date(parsed.data.reviewDue)
        : null;
      if (reviewDue && Number.isNaN(reviewDue.getTime())) {
        return res.status(400).json({ error: "validation_error" });
      }
      const row = await storage().upsertAttestation(
        me.organizationId,
        parsed.data.controlId,
        {
          status: parsed.data.status,
          owner: parsed.data.owner ?? null,
          note: parsed.data.note ?? null,
          evidenceUrl: parsed.data.evidenceUrl || null,
          reviewDue,
        },
        me.id,
      );
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "compliance.attestation_updated",
        resourceType: "compliance_attestation",
        resourceId: row.id,
        // Control id + status only. No note text, no evidence URL.
        details: { controlId: parsed.data.controlId, status: parsed.data.status },
        riskLevel: "medium",
      });
      res.json(row);
    },
  );

  /**
   * The policy starter pack: one editable draft per MANUAL control, so the
   * controls a human must answer arrive with a document instead of a blank.
   * Metadata only here — each row says whether that control is already
   * attested, so the screen can show what is drafted vs. what is signed.
   */
  app.get(
    "/api/compliance/policies",
    requireAuth,
    requireRole(...COMPLIANCE_ROLES),
    async (req, res) => {
      const me = currentUser(req);
      const rows = await storage().listAttestations(me.organizationId);
      const attested = new Map(rows.map((r) => [r.controlId, r]));
      res.json({
        policies: listPolicyTemplates().map((t) => ({
          ...t,
          attested: attested.has(t.controlId),
          attestationStatus: attested.get(t.controlId)?.status ?? null,
        })),
      });
    },
  );

  /**
   * One rendered policy, with the caller's own organization name and today's
   * date substituted. 404 for anything that is not a manual control with a
   * template — an automated control is never given a policy to sign.
   */
  app.get(
    "/api/compliance/policies/:controlId",
    requireAuth,
    requireRole(...COMPLIANCE_ROLES),
    async (req, res) => {
      const me = currentUser(req);
      const org = await storage().getOrganization(me.organizationId);
      if (!org) return res.status(404).json({ error: "not_found" });
      const rendered = renderPolicy(String(req.params.controlId ?? ""), {
        organizationName: org.name,
        effectiveDate: new Date().toISOString().slice(0, 10),
      });
      if (!rendered) return res.status(404).json({ error: "unknown_policy" });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "compliance.policy_rendered",
        resourceType: "compliance_policy",
        resourceId: null,
        // Control id only — never the document text.
        details: { controlId: rendered.controlId },
        riskLevel: "low",
      });
      res.json(rendered);
    },
  );

  /**
   * The auditor evidence pack — one JSON document a CPA firm or an OCR
   * investigator can read cold. Contains control results, the attestation
   * register, aggregate audit statistics and an explicit scope-and-limitations
   * section. Contains NO PHI and no raw audit rows.
   */
  app.get(
    "/api/compliance/evidence",
    requireAuth,
    requireRole(...COMPLIANCE_ROLES),
    async (req, res) => {
      const me = currentUser(req);
      const org = await storage().getOrganization(me.organizationId);
      if (!org) return res.status(404).json({ error: "not_found" });
      const pack = await buildEvidencePack(storage(), org, {
        id: me.id,
        role: me.role,
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "compliance.evidence_exported",
        resourceType: "compliance_report",
        resourceId: null,
        details: {
          readinessPct: (pack.summary as { readinessPct: number }).readinessPct,
        },
        riskLevel: "medium",
      });
      res.json(pack);
    },
  );
}
