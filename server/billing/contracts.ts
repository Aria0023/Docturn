/**
 * Billing — PLANS and CONTRACTS (docs/BILLING.md, feature 2).
 *
 * The contract is OURS. Stripe, once it is configured at all, is only the
 * collection rail (feature 6); nothing here depends on it.
 *
 * Two judgment calls this pass made, both documented in docs/BILLING.md:
 *
 *  1. A tenant with NO CONTRACT — which is every tenant today — is
 *     **unlimited and unbilled**, not implicitly on a default plan. An
 *     implicit plan would have to name its module set, and every module
 *     outside that set would start telling directors "not in your plan": that
 *     IS a behaviour change, and the brief forbids one until the operator puts
 *     the hospital on a contract. No contract therefore means no plan
 *     restriction, no seat limit and no invoice.
 *  2. A STORAGE FAILURE reading the contract is treated as "no contract":
 *     allow, and log the error type only. A hiccup in a billing table must
 *     never stop a director adding a clinician.
 *
 * PLANS ONLY GRANT. `resolveModules` (shared/modules.ts) is untouched by any
 * of this: a contract never switches a module off, never changes the effective
 * map, and never hides a screen. The single effect a plan has is that a
 * DIRECTOR's attempt to switch ON a module the plan does not include is
 * refused with `not_in_plan` — the operator can still switch it on from the
 * developer console, which is today's behaviour for every module anyway.
 */
import {
  PAST_DUE_GRACE_DAYS,
  addDays,
  type ContractStatus,
} from "@shared/billing";
import type { BillingPlan, OrgContract } from "@shared/schema";
import type { DatabaseStorage } from "../storage.js";

/** Today as `YYYY-MM-DD` in UTC — the day contract bounds are compared in. */
export function billingToday(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/**
 * The status a contract really has, computed on READ. An end date that has
 * passed reads as `expired` without waiting for any tick to flip it, so a
 * contract can never look live because a timer was down.
 */
export function effectiveContractStatus(
  contract: Pick<OrgContract, "status" | "endDate">,
  today: string = billingToday(),
): ContractStatus {
  if (contract.status === "cancelled") return "cancelled";
  if (contract.endDate && contract.endDate < today) return "expired";
  return contract.status;
}

export interface ContractView {
  status: ContractStatus;
  /** A plain sentence for the director and the operator, or null. */
  warning: string | null;
  /** The day the past-due clock started (`YYYY-MM-DD`), or null. */
  pastDueSince: string | null;
  /** The last day of the past-due grace period, or null. */
  graceEndsOn: string | null;
  /** Days of grace left (0 once it has run out), or null when not past due. */
  graceDaysLeft: number | null;
  /**
   * The ONE thing a lapsed contract changes: a new seat is refused. Never a
   * message, never a STAT, never sign-in.
   */
  seatsRefused: boolean;
  committedSeats: number | null;
}

type ContractForView = Pick<OrgContract, "status" | "endDate" | "pastDueAt" | "committedSeats">;

/**
 * What both billing screens render. A past-due contract behaves EXACTLY like
 * an active one for PAST_DUE_GRACE_DAYS: warnings from the first day, and
 * nothing else changes at all until the grace period has run out.
 */
export function contractViewFor(
  contract: ContractForView | null,
  today: string = billingToday(),
): ContractView {
  if (!contract) {
    return {
      status: "active",
      warning: null,
      pastDueSince: null,
      graceEndsOn: null,
      graceDaysLeft: null,
      seatsRefused: false,
      committedSeats: null,
    };
  }
  const status = effectiveContractStatus(contract, today);
  const base: ContractView = {
    status,
    warning: null,
    pastDueSince: null,
    graceEndsOn: null,
    graceDaysLeft: null,
    seatsRefused: false,
    committedSeats: contract.committedSeats,
  };
  if (status === "past_due") {
    const since = (contract.pastDueAt ?? new Date()).toISOString().slice(0, 10);
    const graceEndsOn = addDays(since, PAST_DUE_GRACE_DAYS);
    const left = Math.max(0, Math.round((Date.parse(graceEndsOn) - Date.parse(today)) / 86_400_000));
    return {
      ...base,
      pastDueSince: since,
      graceEndsOn,
      graceDaysLeft: left,
      seatsRefused: today > graceEndsOn,
      warning:
        today > graceEndsOn
          ? "This account is past due. New accounts cannot be added until it is settled. " +
            "Messaging, STAT alerts, escalation and admission routing are unaffected."
          : `This account is past due. Nothing changes until ${graceEndsOn} (${left} day${left === 1 ? "" : "s"}); ` +
            "after that new accounts cannot be added. Messaging, STAT alerts, escalation and admission routing are never affected.",
    };
  }
  if (status === "expired") {
    return {
      ...base,
      seatsRefused: true,
      warning:
        "This contract has ended. New accounts cannot be added until it is renewed. " +
        "Messaging, STAT alerts, escalation and admission routing are unaffected.",
    };
  }
  if (status === "cancelled") {
    return {
      ...base,
      seatsRefused: true,
      warning:
        "This contract is cancelled. New accounts cannot be added. " +
        "Messaging, STAT alerts, escalation and admission routing are unaffected.",
    };
  }
  if (status === "trial" && contract.endDate) {
    return { ...base, warning: `Trial — ends ${contract.endDate}.` };
  }
  return base;
}

/** The per-seat price that applies: the contract's override, else the plan's. */
export function effectivePerSeatCents(
  contract: Pick<OrgContract, "priceOverrideCents">,
  plan: Pick<BillingPlan, "perSeatPriceCents">,
): number {
  return contract.priceOverrideCents ?? plan.perSeatPriceCents;
}

export type DirectorModuleDecision = { allowed: true } | { allowed: false; reason: "not_in_plan"; message: string };

/**
 * May a DIRECTOR switch this module ON? With no contract: yes, exactly as
 * today. With a contract: only if the plan includes it. The operator is never
 * subject to this — the plan is the operator's own record.
 *
 * This never switches anything OFF and is never consulted on a switch-off.
 */
export function moduleAllowedForDirector(
  contract: Pick<OrgContract, "status" | "endDate"> | null,
  plan: Pick<BillingPlan, "moduleIds"> | null,
  moduleId: string,
): DirectorModuleDecision {
  if (!contract || !plan) return { allowed: true };
  if (plan.moduleIds.includes(moduleId)) return { allowed: true };
  return {
    allowed: false,
    reason: "not_in_plan",
    message:
      "This feature is not in your plan. Ask DocTurn to add it to your contract — " +
      "nothing about your current setup has changed.",
  };
}

export interface ResolvedContract {
  contract: OrgContract | null;
  plan: BillingPlan | null;
  view: ContractView;
}

/**
 * Read an organization's contract and its plan. A storage failure resolves to
 * "no contract" (see the header): billing never breaks the rest of DocTurn.
 */
export async function resolveContract(db: DatabaseStorage, orgId: number): Promise<ResolvedContract> {
  let contract: OrgContract | null = null;
  let plan: BillingPlan | null = null;
  try {
    contract = (await db.getOrgContract(orgId)) ?? null;
    if (contract) plan = (await db.getBillingPlan(contract.planId)) ?? null;
  } catch (err) {
    // Type only — never a tenant's identity or contract detail in a log.
    console.error("[billing] contract read failed; treating as unbilled", (err as Error)?.name ?? "error");
    contract = null;
    plan = null;
  }
  return { contract, plan, view: contractViewFor(contract) };
}

/** May a director switch this module on, resolved from the database. */
export async function directorModuleDecision(
  db: DatabaseStorage,
  orgId: number,
  moduleId: string,
): Promise<DirectorModuleDecision> {
  const { contract, plan } = await resolveContract(db, orgId);
  return moduleAllowedForDirector(contract, plan, moduleId);
}
