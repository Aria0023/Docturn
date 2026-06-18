import type { IStorage } from "../storage.js";
import { storage } from "../storage.js";

/**
 * C3 adaptive defaults: a periodic, org-scoped, READ-ONLY analysis over data we
 * already log. It proposes changes with evidence; nothing changes until a human
 * accepts (which writes the setting + an audit row). No ML infrastructure.
 */
export async function analyze(
  s: IStorage,
  orgId: number,
): Promise<number> {
  const org = await s.getOrganization(orgId);
  if (!org) return 0;
  const assignments = await s.listAssignments(orgId);

  // Median accept latency (createdAt → resolvedAt) over accepted assignments.
  const accepts = assignments
    .filter((a) => a.status === "accepted" && a.resolvedAt)
    .map(
      (a) =>
        (new Date(a.resolvedAt!).getTime() - new Date(a.createdAt).getTime()) /
        60_000,
    )
    .sort((x, y) => x - y);

  let proposed = 0;
  if (accepts.length >= 3) {
    const median = accepts[Math.floor(accepts.length / 2)]!;
    // If providers accept well within the window, suggest tightening it.
    if (median < org.assignmentTimeoutMin * 0.6) {
      const value = Math.max(1, Math.ceil(median));
      if (
        value !== org.assignmentTimeoutMin &&
        !(await storage().hasPendingSuggestion(orgId, "assignment_timeout"))
      ) {
        await storage().createSuggestion({
          organizationId: orgId,
          scope: "org",
          key: "assignment_timeout",
          proposedValue: value,
          evidence: `median accept ${median.toFixed(1)}m vs ${org.assignmentTimeoutMin}m window`,
        });
        proposed++;
      }
    }
  }
  return proposed;
}
