import type { Express } from "express";
import { effectivePerSeatCents, resolveContract } from "../billing/contracts.js";
import { seatUsageFor } from "../billing/seats.js";
import { stripeConfiguredForOrg } from "../billing/stripe-config.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";

/**
 * The HOSPITAL's own billing screen — Settings → Billing (module `billing`,
 * default OFF, so no existing tenant's screens change until the operator
 * turns it on). Directors only; nobody else in a hospital sees billing at all.
 *
 *   GET   /api/billing            the director's own organization's billing
 *
 * Everything here is REAL or absent. There is no demo plan, no sample
 * invoice, and no "Paid" that is not a record of either the operator's own
 * action or a Stripe webhook event. A hospital with no contract — which is
 * every hospital until the operator puts it on one — is told exactly that,
 * and nothing is billed.
 *
 * THE SAFETY INVARIANT: this file reads billing state and nothing else. The
 * only billing refusal in the product is a NEW SEAT (server/billing/
 * entitlements.ts, called from the account-creation routes) and a new
 * organization. Nothing here can refuse a message, a STAT, an escalation, a
 * broadcast, an assignment, the on-call board, the schedule or a sign-in.
 */

const BILLING_ROLES = ["director", "developer"] as const;

export function registerBillingRoutes(app: Express) {
  app.get("/api/billing", requireAuth, requireRole(...BILLING_ROLES), async (req, res) => {
    const me = currentUser(req);
    const db = storage();
    const orgId = me.organizationId;
    const [{ contract, plan, view }, seats] = await Promise.all([
      resolveContract(db, orgId),
      seatUsageFor(db, orgId),
    ]);
    const stripe = await stripeConfiguredForOrg(db, orgId);
    res.json({
      orgId,
      /** Null means exactly that: no contract is on file, nothing is billed. */
      contract: contract ? publicContract(contract) : null,
      plan: plan ? publicPlan(plan) : null,
      view,
      billed: !!contract,
      perSeatCents: contract && plan ? effectivePerSeatCents(contract, plan) : null,
      currency: plan?.currency ?? null,
      seats,
      invoices: [],
      notice: contract
        ? null
        : "No billing contract is on file for this organization. Nothing is billed. " +
          "DocTurn will tell you before that changes.",
      /**
       * When Stripe is not configured, the screen says in plain words who
       * issues an invoice and who marks it paid — because that is the truth.
       */
      collection: stripe.configured
        ? { via: "stripe" as const, note: "Invoices are issued through Stripe and marked paid by Stripe when payment settles." }
        : {
            via: "manual" as const,
            note: "Invoices are issued and marked paid by the DocTurn operator by hand. Nothing is charged automatically.",
          },
      prorationNote:
        "A mid-term plan change is prorated on your NEXT invoice. Invoices already issued are never changed.",
    });
  });
}

/** The contract as the HOSPITAL may see it. No operator-only fields. */
export function publicContract(c: {
  id: number;
  planId: number;
  term: string;
  startDate: string;
  endDate: string | null;
  committedSeats: number;
  poNumber: string | null;
  billingContactName: string | null;
  billingContactEmail: string | null;
  status: string;
  pastDueAt: Date | null;
  daysUntilDue: number;
}) {
  return {
    id: c.id,
    planId: c.planId,
    term: c.term,
    startDate: c.startDate,
    endDate: c.endDate,
    committedSeats: c.committedSeats,
    poNumber: c.poNumber,
    billingContactName: c.billingContactName,
    billingContactEmail: c.billingContactEmail,
    status: c.status,
    /** When the past-due clock started, so the grace period is auditable. */
    pastDueAt: c.pastDueAt ? c.pastDueAt.toISOString() : null,
    daysUntilDue: c.daysUntilDue,
  };
}

export function publicPlan(p: {
  id: number;
  code: string;
  name: string;
  moduleIds: string[];
  perSeatPriceCents: number;
  currency: string;
}) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    moduleIds: p.moduleIds,
    perSeatPriceCents: p.perSeatPriceCents,
    currency: p.currency,
  };
}
