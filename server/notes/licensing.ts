import type { License } from "@shared/schema";
import { storage } from "../storage.js";
import { emitBillingEvent } from "./billing.js";

/**
 * Licensing enforcement. Runs BEFORE generate and export. Seat plans count
 * distinct users per period; usage plans count generations per period;
 * trials are time-boxed. Nothing here touches PHI.
 */
export type LicenseAction = "generate" | "export";

export interface LicenseDecision {
  ok: boolean;
  reason?: "no_license" | "suspended" | "expired" | "seats_exhausted" | "usage_exhausted";
  plan?: License["plan"];
  usage?: { seatsUsed: number; generations: number; exports: number; periodKey: string };
}

export function periodKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function checkLicense(orgId: number, userId: number, action: LicenseAction): Promise<LicenseDecision> {
  const lic = await storage().getLicense(orgId);
  if (!lic) return { ok: false, reason: "no_license" };
  if (lic.status === "suspended") return { ok: false, reason: "suspended", plan: lic.plan };
  if (lic.status === "expired" || (lic.periodEnd && lic.periodEnd.getTime() < Date.now())) {
    return { ok: false, reason: "expired", plan: lic.plan };
  }
  const pk = periodKey();
  const rows = await storage().listLicenseUsage(orgId, pk);
  const generations = rows.reduce((n, r) => n + r.generations, 0);
  const exports = rows.reduce((n, r) => n + r.exports, 0);
  const seatsUsed = rows.length;
  const usage = { seatsUsed, generations, exports, periodKey: pk };
  const isNewSeat = !rows.some((r) => r.userId === userId);
  if (lic.plan === "seat" && lic.seats != null && isNewSeat && seatsUsed >= lic.seats) {
    return { ok: false, reason: "seats_exhausted", plan: lic.plan, usage };
  }
  if (action === "generate" && lic.usageCap != null && generations >= lic.usageCap) {
    return { ok: false, reason: "usage_exhausted", plan: lic.plan, usage };
  }
  return { ok: true, plan: lic.plan, usage };
}

/** Meter the action (after it succeeds) and notify billing. */
export async function recordUsage(orgId: number, userId: number, action: LicenseAction): Promise<void> {
  await storage().incrementLicenseUsage(orgId, periodKey(), userId, action === "generate" ? "generations" : "exports");
  const lic = await storage().getLicense(orgId);
  emitBillingEvent({ orgId, userId, action, plan: lic?.plan ?? "trial", billingRef: lic?.billingRef ?? null, at: new Date() });
}
