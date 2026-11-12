/**
 * Billing — ENTITLEMENTS (docs/BILLING.md, feature 3).
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE SAFETY INVARIANT. This module is the ONLY place in DocTurn where a
 *  billing state can refuse anything, and it may be consulted in exactly two
 *  kinds of place:
 *
 *    1. creating a SEAT (a new user account), and
 *    2. creating a new ORGANIZATION.
 *
 *  Nothing else is ever gated by billing. Not messaging, not STAT, not
 *  escalation, not broadcasts, not assignments, not on-call, not the schedule,
 *  not sign-in. A lapsed contract degrades to warnings and "cannot add
 *  accounts" — never to a clinician unable to send or receive.
 *
 *  tests/billing-safety-invariant.test.ts proves it two ways: statically, that
 *  exactly an allow-list of files imports this module (so adding the import
 *  anywhere else fails the suite), and behaviourally, that a past-due and an
 *  expired organization can still sign in, send a STAT, route an admission,
 *  acknowledge a broadcast and read the on-call board.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Which seat-creating paths consult it, and which deliberately do not:
 *
 *   server/routes/providers.ts  a director / ER director adds an account  → CHECKED
 *   server/auth.ts              a director approves a registration        → CHECKED
 *   server/routes/accounts.ts   a director reactivates an account         → CHECKED (a
 *                                                                           deactivated account
 *                                                                           is not a seat)
 *   server/routes/dev.ts        the operator adds an account              → CHECKED, never
 *                                                                           refused, an
 *                                                                           over-limit add
 *                                                                           is audited
 *   server/services/provisioning.ts  SCIM / SSO just-in-time              → NOT CHECKED
 *   server/services/amion.ts         schedule-sync accounts               → NOT CHECKED
 *
 * The last two are the deliberate ones. An identity provider or a schedule
 * feed whose push was refused would strand a clinician outside DocTurn's own
 * UI, with nothing on any screen to explain it — exactly the kind of silent
 * failure the invariant exists to prevent. Those seats simply appear, show up
 * in the next snapshot, and are charged as an overage line. Over-committed
 * usage is an invoice line item, never a blocker.
 */
import type { Organization } from "@shared/schema";
import { resolveContract } from "./contracts.js";
import { countBillableSeats } from "./seats.js";
import type { DatabaseStorage } from "../storage.js";

export type SeatRefusalReason =
  | "seat_limit_reached"
  | "contract_past_due"
  | "contract_expired"
  | "contract_cancelled";

export interface SeatEntitlement {
  /** Seats in use right now (the ONE seat definition, server/billing/seats.ts). */
  seatsInUse: number;
  /** The contract's committed seats, or null when there is no contract. */
  committedSeats: number | null;
  /** Seats beyond the commitment: an invoice line, never a blocker. */
  overageSeats: number;
  /** Would a DIRECTOR be refused a new account right now? */
  refused: boolean;
  reason: SeatRefusalReason | null;
  /** One plain sentence for the person who hit it, or null. */
  message: string | null;
  /** The contract's own warning (past due, trial ending, …), or null. */
  warning: string | null;
  /** There is no contract on file: unlimited and unbilled. */
  unbilled: boolean;
}

const UNLIMITED: SeatEntitlement = {
  seatsInUse: 0,
  committedSeats: null,
  overageSeats: 0,
  refused: false,
  reason: null,
  message: null,
  warning: null,
  unbilled: true,
};

const CARE_UNAFFECTED =
  "Messaging, STAT alerts, escalation and admission routing are not affected.";

/**
 * The seat entitlement for one organization.
 *
 * A tenant with NO CONTRACT — every tenant until the operator puts it on one —
 * is UNLIMITED AND UNBILLED. That is this pass's judgment call: an implicit
 * default plan would have to name a module set and a seat count, and both
 * would start changing what existing hospitals see. No contract means no
 * billing relationship.
 *
 * A storage failure is treated the same way: allow, and log the error TYPE
 * only. A hiccup in a billing table must never stop a director adding a
 * clinician.
 */
export async function seatEntitlementFor(db: DatabaseStorage, orgId: number): Promise<SeatEntitlement> {
  let seatsInUse = 0;
  try {
    seatsInUse = (await countBillableSeats(db, orgId)).total;
  } catch (err) {
    console.error("[billing] seat count failed; allowing", (err as Error)?.name ?? "error");
    return { ...UNLIMITED };
  }
  const { contract, view } = await resolveContract(db, orgId);
  if (!contract) return { ...UNLIMITED, seatsInUse };

  const overageSeats = Math.max(0, seatsInUse - contract.committedSeats);
  const base: SeatEntitlement = {
    seatsInUse,
    committedSeats: contract.committedSeats,
    overageSeats,
    refused: false,
    reason: null,
    message: null,
    warning: view.warning,
    unbilled: false,
  };

  // A lapsed contract: the ONLY thing that changes is that a new account is
  // refused, and only after the past-due grace period has run out.
  if (view.seatsRefused) {
    const reason: SeatRefusalReason =
      view.status === "expired"
        ? "contract_expired"
        : view.status === "cancelled"
          ? "contract_cancelled"
          : "contract_past_due";
    const what =
      reason === "contract_expired"
        ? "This organization's DocTurn contract has ended"
        : reason === "contract_cancelled"
          ? "This organization's DocTurn contract is cancelled"
          : "This organization's DocTurn account is past due";
    return {
      ...base,
      refused: true,
      reason,
      message: `${what}, so a new account cannot be added. Contact DocTurn to settle it. ${CARE_UNAFFECTED}`,
    };
  }

  if (seatsInUse >= contract.committedSeats) {
    return {
      ...base,
      refused: true,
      reason: "seat_limit_reached",
      message:
        `This organization is using all ${contract.committedSeats} of the accounts in its DocTurn contract ` +
        `(${seatsInUse} in use). Deactivate someone who has left, or contact DocTurn to add accounts. ${CARE_UNAFFECTED}`,
    };
  }
  return base;
}

export type SeatActor = "director" | "operator";

export interface SeatDecision extends SeatEntitlement {
  /** May THIS actor create the seat? */
  allowed: boolean;
  /**
   * The operator went past the commitment. Never refused — the extra seats are
   * an invoice line — but recorded, so the next invoice is not a surprise.
   */
  override: boolean;
}

/**
 * May this actor create a seat in this organization?
 *
 * A DIRECTOR is refused when the entitlement says so, with the reason above.
 * The OPERATOR is never refused: they are the party doing the billing, and a
 * platform operator locked out of their own console by their own invoice would
 * be absurd. An over-limit add by the operator comes back with
 * `override: true` so the caller audits it in the tenant's trail.
 */
export async function checkSeatAvailability(
  db: DatabaseStorage,
  orgId: number,
  actor: SeatActor,
): Promise<SeatDecision> {
  const ent = await seatEntitlementFor(db, orgId);
  if (actor === "operator") {
    return { ...ent, allowed: true, override: ent.refused };
  }
  return { ...ent, allowed: !ent.refused, override: false };
}

/** The 402 body every refused seat answers with. One shape, one client path. */
export function seatRefusalBody(decision: SeatEntitlement) {
  return {
    error: "seat_refused" as const,
    reason: decision.reason,
    message: decision.message,
    seatsInUse: decision.seatsInUse,
    committedSeats: decision.committedSeats,
  };
}

/* ── the second place: creating an ORGANIZATION ───────────────────────────── */

export type OrgCreationDecision = { allowed: true } | { allowed: false; reason: "not_operator"; message: string };

/**
 * May this actor create a new tenant organization?
 *
 * The honest answer today, stated plainly rather than dressed up: only the
 * PLATFORM OPERATOR (role `developer`, in the platform organization) can
 * create a tenant, and the operator is not billed, so there is no contract to
 * weigh. This function is defence in depth behind the route's own
 * requireRole("developer") — and it is the ONE designated place an
 * organization-creation entitlement would live if the operator ever sells a
 * contract that caps how many hospitals a customer may create (a health
 * system with several sites, say). Keeping the seam real and in one place is
 * why it exists; it refuses nothing a director could otherwise have done.
 *
 * A new organization is created with NO CONTRACT, i.e. unlimited and unbilled,
 * until the operator puts it on a plan.
 */
export function checkOrgCreationAllowed(actor: { role: string }, actorOrg: Organization | null): OrgCreationDecision {
  const isOperator = actor.role === "developer";
  if (!isOperator) {
    return {
      allowed: false,
      reason: "not_operator",
      message: "Only DocTurn can create a new organization.",
    };
  }
  void actorOrg;
  return { allowed: true };
}
