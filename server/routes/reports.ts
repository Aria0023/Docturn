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
}
