import type { Express } from "express";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
const toMin = (ms: number | null) =>
  ms == null ? null : Math.round((ms / 60_000) * 10) / 10;

export function registerReportsRoutes(app: Express) {
  // Director operations report — the numbers a medical director actually asks
  // for, computed from data the workflow already records. Org-scoped; ids and
  // aggregates only (no patient content).
  app.get(
    "/api/reports/ops",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const weekAgo = new Date(Date.now() - 7 * 86_400_000);

      const assignments = await storage().listAssignments(me.organizationId);
      const acceptLatencies = assignments
        .filter((a) => a.status === "accepted" && a.resolvedAt)
        .map(
          (a) =>
            new Date(a.resolvedAt as unknown as Date).getTime() -
            new Date(a.createdAt).getTime(),
        )
        .filter((ms) => ms >= 0);
      const statusCounts: Record<string, number> = {};
      for (const a of assignments)
        statusCounts[a.status] = (statusCounts[a.status] ?? 0) + 1;

      const consults = await storage().listConsultsForOrg(me.organizationId);
      const consultLatencies = consults
        .filter((c) => c.respondedAt)
        .map(
          (c) =>
            new Date(c.respondedAt as unknown as Date).getTime() -
            new Date(c.createdAt).getTime(),
        )
        .filter((ms) => ms >= 0);

      const statAckLatencies = await storage().listStatAckLatencies(
        me.organizationId,
      );
      const messages7d = await storage().countMessagesSince(
        me.organizationId,
        weekAgo,
      );

      res.json({
        assignments: {
          total: assignments.length,
          byStatus: statusCounts,
          timeToAcceptMinAvg: toMin(avg(acceptLatencies)),
          timeToAcceptMinMedian: toMin(median(acceptLatencies)),
        },
        consults: {
          total: consults.length,
          responded: consultLatencies.length,
          responseMinAvg: toMin(avg(consultLatencies)),
        },
        messaging: {
          last7d: messages7d,
          statAcks: statAckLatencies.length,
          statAckMinAvg: toMin(avg(statAckLatencies)),
        },
      });
    },
  );

  // ER throughput (A.CON clinical #3) — the numbers the ER director's "Avg
  // time-to-accept" / "Admits" tiles and the ER doctor's "My shift" tiles
  // show, computed here instead of a constant. An ER doctor gets their OWN
  // (assignments they routed, patients they admitted); the ER director,
  // director and developer get the org's. Aggregates only, no patient content.
  // Gated with the rest of /api/reports (ops.analytics).
  app.get(
    "/api/reports/er",
    requireAuth,
    requireRole("er_doctor", "er_director", "director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const mineOnly = me.role === "er_doctor";
      const [all, patients] = await Promise.all([
        storage().listAssignments(me.organizationId),
        storage().listPatients(me.organizationId),
      ]);
      const scoped = mineOnly ? all.filter((a) => a.erDoctorId === me.id) : all;
      const acceptLatencies = scoped
        .filter((a) => a.status === "accepted" && a.resolvedAt)
        .map((a) => new Date(a.resolvedAt as unknown as Date).getTime() - new Date(a.createdAt).getTime())
        .filter((ms) => ms >= 0);
      const since = Date.now() - 24 * 3_600_000;
      const admits24h = patients.filter(
        (p) => new Date(p.createdAt).getTime() >= since && (!mineOnly || p.erDoctorId === me.id),
      ).length;
      res.json({
        scope: mineOnly ? "mine" : "org",
        assignments: {
          total: scoped.length,
          accepted: scoped.filter((a) => a.status === "accepted").length,
          declined: scoped.filter((a) => a.status === "rejected").length,
          pending: scoped.filter((a) => a.status === "pending").length,
          timeToAcceptMinAvg: toMin(avg(acceptLatencies)),
          timeToAcceptMinMedian: toMin(median(acceptLatencies)),
        },
        admits24h,
      });
    },
  );
  // ── Shift review and trends (directors) ───────────────────────────────────
  // Every admission request in a window — the live ones plus the outcomes
  // kept after their patients were removed (assignment_facts) — as counts and
  // times by day, by time of day and by hospitalist, with the codes called.
  // Ids, names of staff and numbers only: no patient appears here.
  app.get(
    "/api/reports/review",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const orgId = me.organizationId;
      const hours = Math.min(24 * 90, Math.max(1, Number(req.query.hours) || 12));
      const now = new Date();
      const since = new Date(now.getTime() - hours * 3_600_000);
      const db = storage();
      const [org, live, facts, hosps, users, codes, audit] = await Promise.all([
        db.getOrganization(orgId),
        db.listAssignments(orgId),
        db.listAssignmentFacts(orgId, since),
        db.listHospitalists(orgId),
        db.listUsers(orgId),
        db.listAllCodeActivations(orgId),
        db.listAuditLogs(orgId, 2000),
      ]);
      type Row = { id: number; hospitalistId: number; status: string; createdAt: Date; resolvedAt: Date | null };
      const seen = new Set<number>();
      const rows: Row[] = [];
      for (const a of live) {
        if (new Date(a.createdAt) < since) continue;
        seen.add(a.id);
        rows.push({ id: a.id, hospitalistId: a.hospitalistId, status: a.status, createdAt: new Date(a.createdAt), resolvedAt: a.resolvedAt ? new Date(a.resolvedAt) : null });
      }
      for (const f of facts) {
        if (seen.has(f.assignmentId)) continue;
        rows.push({ id: f.assignmentId, hospitalistId: f.hospitalistId, status: f.status, createdAt: new Date(f.createdAt), resolvedAt: f.resolvedAt ? new Date(f.resolvedAt) : null });
      }
      const tz = (org?.timezone ?? "").trim() || "UTC";
      const part = (d: Date, opt: Intl.DateTimeFormatOptions) => {
        try {
          return new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...opt }).format(d);
        } catch {
          return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", ...opt }).format(d);
        }
      };
      const dayOf = (d: Date) => part(d, { year: "numeric", month: "2-digit", day: "2-digit" });
      const hourOf = (d: Date) => Number(part(d, { hour: "2-digit", hourCycle: "h23" }).slice(0, 2));
      // Time of day in the hospital's own clock: 07–15, 15–23, 23–07.
      const blockOf = (d: Date): string => { const h = hourOf(d); return h >= 7 && h < 15 ? "Day (07–15)" : h >= 15 && h < 23 ? "Evening (15–23)" : "Night (23–07)"; };
      const acceptMin = (r: Row) => (r.status === "accepted" && r.resolvedAt ? (r.resolvedAt.getTime() - r.createdAt.getTime()) / 60_000 : null);
      const summarize = (set: Row[]) => {
        const mins = set.map(acceptMin).filter((m): m is number => m != null && m >= 0);
        return {
          requests: set.length,
          accepted: set.filter((r) => r.status === "accepted").length,
          declined: set.filter((r) => r.status === "rejected").length,
          unanswered: set.filter((r) => r.status === "expired").length,
          waiting: set.filter((r) => r.status === "pending").length,
          medianAcceptMin: toMin(median(mins.map((m) => m * 60_000))),
          slowestAcceptMin: mins.length ? Math.round(Math.max(...mins) * 10) / 10 : null,
        };
      };
      const groupBy = <K extends string | number>(key: (r: Row) => K) => {
        const m = new Map<K, Row[]>();
        for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
        return m;
      };
      const name = new Map(users.map((u) => [u.id, u.displayName]));
      const hospName = new Map(hosps.map((h) => [h.id, name.get(h.userId) ?? "Former provider"]));
      const blocks = ["Day (07–15)", "Evening (15–23)", "Night (23–07)"];
      const byBlock = groupBy<string>((r) => blockOf(r.createdAt));
      const inWindow = codes.filter((c) => new Date(c.activatedAt) >= since);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        hours,
        from: since.toISOString(),
        to: now.toISOString(),
        timezone: tz,
        totals: summarize(rows),
        byDay: [...groupBy((r) => dayOf(r.createdAt))].sort((a, b) => a[0].localeCompare(b[0])).map(([day, set]) => ({ day, ...summarize(set) })),
        byTimeOfDay: blocks.map((b) => ({ block: b, ...summarize(byBlock.get(b) ?? []) })),
        byHospitalist: [...groupBy((r) => r.hospitalistId)]
          .map(([id, set]) => ({ hospitalist: hospName.get(id) ?? "Former provider", ...summarize(set) }))
          .sort((a, b) => b.requests - a.requests || a.hospitalist.localeCompare(b.hospitalist)),
        stuckAlerts: audit.filter((r) => r.action === "assignment.escalated" && new Date(r.createdAt) >= since).length,
        codes: {
          called: inWindow.length,
          completed: inWindow.filter((c) => c.status === "completed").length,
          stoodDown: inWindow.filter((c) => c.status === "stood_down").length,
          running: inWindow.filter((c) => c.status === "active").length,
          byProtocol: Object.entries(inWindow.reduce<Record<string, number>>((m, c) => ((m[c.protocolName] = (m[c.protocolName] ?? 0) + 1), m), {})).map(([protocol, count]) => ({ protocol, count })),
        },
        // What this cannot see, said once: requests removed before this
        // version kept their outcomes are not in the older days.
        note: "Requests are counted by when they were sent, in the hospital's time zone. Outcomes of requests whose patient was removed before DocTurn began keeping them are not included.",
      });
    },
  );
}
