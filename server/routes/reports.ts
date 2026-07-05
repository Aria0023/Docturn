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
}
