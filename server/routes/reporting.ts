import type { Express, Request, Response } from "express";
import { appendAudit, logPhiAccess } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";
import { epicConfigFor } from "../services/schedule-sources/epic-fhir.js";
import {
  BUILTIN_REPORTS,
  DATASETS,
  FILTER_OPS,
  ReportError,
  configProblem,
  listEhrPatientLists,
  publicDefinition,
  reportConfigSchema,
  reportInputSchema,
  runReport,
  toCsv,
  type DatasetId,
  type ReportConfig,
  type ReportingDeps,
} from "../services/reporting.js";
import type { User } from "../../shared/schema.js";

/**
 * Reports (module ops.reports): the catalog, saved definitions, running and
 * CSV export. Everyone who can already read the organization's patients
 * (GET /api/patients) can run a report; rows are built per request and never
 * stored. A patient report is ONE PHI-access row per run, and every export
 * and every change to a saved report is audited (ids and names only).
 */
const ROLES = ["hospitalist", "er_doctor", "er_director", "director", "staff", "developer"] as const;
/** Who may publish a report to the whole organization, and edit a published one. */
const canShare = (u: User) => u.role === "director" || u.role === "er_director" || u.role === "developer";

let deps: ReportingDeps = {};
/** Tests: replace the Epic transport, clock and env. */
export function _setReportingDepsForTests(d: ReportingDeps) {
  deps = d;
}

function fail(res: Response, err: unknown) {
  if (err instanceof ReportError) {
    const [error, detail] = err.code.split(":");
    return res.status(err.status).json(detail ? { error, detail } : { error });
  }
  throw err;
}

type Resolved = { ref: string; name: string; dataset: DatasetId; config: ReportConfig };

/** The report a run / export names: a built-in, a saved one I may see, or an unsaved draft. */
async function resolve(req: Request): Promise<Resolved | null | "invalid"> {
  const me = currentUser(req);
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (typeof b.ref === "string") {
    const builtin = BUILTIN_REPORTS.find((r) => r.id === b.ref);
    if (builtin) return { ref: builtin.id, name: builtin.name, dataset: builtin.dataset, config: builtin.config };
    const id = /^\d{1,9}$/.test(b.ref) ? Number(b.ref) : NaN;
    if (!Number.isInteger(id)) return null;
    const row = await storage().getReportDefinition(me.organizationId, id);
    if (!row || (!row.shared && row.ownerUserId !== me.id)) return null;
    const pub = publicDefinition(row, null, me.id);
    return pub ? { ref: pub.id, name: pub.name, dataset: pub.dataset, config: pub.config } : null;
  }
  // A draft from the builder: run it before saving it.
  const parsed = reportInputSchema.safeParse({ name: b.name ?? "Draft", dataset: b.dataset, config: b.config });
  if (!parsed.success || configProblem(parsed.data.dataset, parsed.data.config)) return "invalid";
  return { ref: "draft", name: parsed.data.name, dataset: parsed.data.dataset, config: parsed.data.config };
}

export function registerReportingRoutes(app: Express) {
  app.get("/api/reporting/catalog", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    const ehrConnected = !!(await epicConfigFor(storage(), me.organizationId, deps.env));
    res.json({
      ehrConnected,
      canShare: canShare(me),
      filterOps: FILTER_OPS,
      datasets: Object.entries(DATASETS).map(([id, d]) => ({
        id,
        label: d.label,
        source: d.source,
        blurb: d.blurb,
        columns: d.columns,
        defaults: d.defaults,
      })),
    });
  });

  app.get("/api/reporting/reports", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    const [rows, users] = await Promise.all([
      storage().listReportDefinitions(me.organizationId),
      storage().listUsers(me.organizationId),
    ]);
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    const saved = rows
      .filter((r) => r.shared || r.ownerUserId === me.id)
      .map((r) => publicDefinition(r, names.get(r.ownerUserId) ?? null, me.id))
      .filter((r) => r !== null);
    res.json({ reports: [...BUILTIN_REPORTS.map((r) => ({ ...r, mine: false, ownerName: null })), ...saved] });
  });

  app.post("/api/reporting/reports", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    const parsed = reportInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const problem = configProblem(parsed.data.dataset, parsed.data.config);
    if (problem) return res.status(400).json({ error: problem });
    if (parsed.data.shared && !canShare(me)) return res.status(403).json({ error: "cannot_share" });
    const mineCount = (await storage().listReportDefinitions(me.organizationId)).filter((r) => r.ownerUserId === me.id).length;
    if (mineCount >= 50) return res.status(409).json({ error: "too_many_reports" });
    const row = await storage().createReportDefinition({
      organizationId: me.organizationId,
      ownerUserId: me.id,
      name: parsed.data.name,
      dataset: parsed.data.dataset,
      config: parsed.data.config,
      shared: parsed.data.shared,
    });
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "report.create",
      resourceType: "report",
      resourceId: row.id,
      details: { name: row.name, dataset: row.dataset, shared: row.shared },
      riskLevel: "low",
    });
    res.status(201).json(publicDefinition(row, me.displayName, me.id));
  });

  // `:ref`, not `:id`: built-in reports have non-numeric refs (never editable).
  app.patch("/api/reporting/reports/:ref", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    const id = /^\d{1,9}$/.test(req.params.ref ?? "") ? Number(req.params.ref) : NaN;
    const row = Number.isInteger(id) ? await storage().getReportDefinition(me.organizationId, id) : undefined;
    if (!row || (!row.shared && row.ownerUserId !== me.id)) return res.status(404).json({ error: "not_found" });
    if (row.ownerUserId !== me.id && !canShare(me)) return res.status(403).json({ error: "forbidden" });
    const parsed = reportInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const problem = configProblem(parsed.data.dataset, parsed.data.config);
    if (problem) return res.status(400).json({ error: problem });
    if (parsed.data.shared !== row.shared && !canShare(me)) return res.status(403).json({ error: "cannot_share" });
    const saved = await storage().updateReportDefinition(me.organizationId, id, {
      name: parsed.data.name,
      dataset: parsed.data.dataset,
      config: parsed.data.config,
      shared: parsed.data.shared,
    });
    if (!saved) return res.status(404).json({ error: "not_found" });
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "report.update",
      resourceType: "report",
      resourceId: saved.id,
      details: { name: saved.name, dataset: saved.dataset, shared: saved.shared },
      riskLevel: "low",
    });
    const owner = saved.ownerUserId === me.id ? me.displayName : (await storage().getUser(me.organizationId, saved.ownerUserId))?.displayName ?? null;
    res.json(publicDefinition(saved, owner, me.id));
  });

  app.delete("/api/reporting/reports/:ref", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    const id = /^\d{1,9}$/.test(req.params.ref ?? "") ? Number(req.params.ref) : NaN;
    const row = Number.isInteger(id) ? await storage().getReportDefinition(me.organizationId, id) : undefined;
    if (!row || (!row.shared && row.ownerUserId !== me.id)) return res.status(404).json({ error: "not_found" });
    if (row.ownerUserId !== me.id && !canShare(me)) return res.status(403).json({ error: "forbidden" });
    await storage().deleteReportDefinition(me.organizationId, id);
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "report.delete",
      resourceType: "report",
      resourceId: id,
      details: { name: row.name, dataset: row.dataset },
      riskLevel: "low",
    });
    res.status(204).end();
  });

  const run = (format: "json" | "csv") => async (req: Request, res: Response) => {
    const me = currentUser(req);
    const target = await resolve(req);
    if (target === "invalid") return res.status(400).json({ error: "validation_error" });
    if (!target) return res.status(404).json({ error: "not_found" });
    try {
      const result = await runReport(storage(), me.organizationId, target.dataset, target.config, deps);
      if (DATASETS[target.dataset].patientData) await logPhiAccess(req, "reports");
      // Clinical rows: never cached by the browser or anything in between.
      res.setHeader("Cache-Control", "no-store");
      if (format === "json") return res.json({ ref: target.ref, name: target.name, ...result });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "report.export",
        resourceType: "report",
        resourceId: /^\d+$/.test(target.ref) ? Number(target.ref) : null,
        details: { name: target.name, dataset: target.dataset, source: result.source, rows: result.total },
        riskLevel: DATASETS[target.dataset].patientData ? "medium" : "low",
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="docturn-report.csv"');
      return res.send(toCsv(result));
    } catch (err) {
      return fail(res, err);
    }
  };
  app.post("/api/reporting/run", requireAuth, requireRole(...ROLES), run("json"));
  app.post("/api/reporting/export", requireAuth, requireRole(...ROLES), run("csv"));

  // The patient lists the hospital's connected Epic app can see (titles only).
  app.get("/api/reporting/ehr/lists", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    try {
      res.json({ lists: await listEhrPatientLists(storage(), me.organizationId, deps) });
    } catch (err) {
      return fail(res, err);
    }
  });
}
