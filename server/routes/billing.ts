import type { Express } from "express";
import { billingContactPatchSchema } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { invoiceCsvLines } from "../billing/invoices.js";
import { effectivePerSeatCents, resolveContract } from "../billing/contracts.js";
import { seatEntitlementFor } from "../billing/entitlements.js";
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
    const [{ contract, plan, view }, seats, entitlement, invoices] = await Promise.all([
      resolveContract(db, orgId),
      seatUsageFor(db, orgId),
      // The SAME computation the account-creation routes use, so the screen
      // can never say "you have room" while the server refuses the account.
      seatEntitlementFor(db, orgId),
      db.listOrgInvoices(orgId, 100),
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
      entitlement,
      /**
       * The hospital's OWN invoices, drafts excluded: a draft is the
       * operator's working copy and has been issued to nobody.
       */
      invoices: invoices.filter((i) => i.status !== "draft").map(publicInvoice),
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

  /**
   * The hospital edits its own BILLING CONTACT — the only contract field a
   * director may change, because it is their own staff's name and email, not a
   * commercial term. Everything else is the operator's.
   */
  app.patch("/api/billing/contact", requireAuth, requireRole(...BILLING_ROLES), async (req, res) => {
    const me = currentUser(req);
    const parsed = billingContactPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const contract = await storage().getOrgContract(me.organizationId);
    if (!contract) return res.status(409).json({ error: "no_contract" });
    const d = parsed.data;
    const saved = await storage().updateOrgContract(me.organizationId, {
      ...(d.billingContactName !== undefined ? { billingContactName: d.billingContactName } : {}),
      ...(d.billingContactEmail !== undefined ? { billingContactEmail: d.billingContactEmail } : {}),
    });
    // The CHANGED KEYS are audited, never the values: a billing contact's name
    // and email are personal data the trail does not need to copy.
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "billing.contact_update",
      resourceType: "organization",
      resourceId: me.organizationId,
      details: { changedKeys: Object.keys(d).sort() },
      riskLevel: "low",
    });
    res.json({ contract: publicContract(saved!) });
  });

  /**
   * The hospital downloads one of its own invoices as CSV. Streamed in the
   * audit-export shape (server/compliance/audit-export.ts): the rows are
   * written as they are produced, every cell goes through `csvCell` so nothing
   * a spreadsheet would run as a formula escapes, and the file carries no PHI
   * — an invoice number, a status, the hospital's own name, dates, counts and
   * cents. Rate-limited in server/app.ts on its own budget.
   *
   * A DRAFT is never downloadable: it is the operator's working copy and has
   * not been issued to anybody.
   */
  app.get("/api/billing/invoices/:id/download", requireAuth, requireRole(...BILLING_ROLES), async (req, res) => {
    const me = currentUser(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "validation_error" });
    // Scoped read: another tenant's invoice is simply not found.
    const invoice = await storage().getOrgInvoice(me.organizationId, id);
    if (!invoice) return res.status(404).json({ error: "not_found" });
    if (invoice.status === "draft") return res.status(404).json({ error: "not_found" });
    const org = await storage().getOrganization(me.organizationId);
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "billing.invoice_download",
      resourceType: "billing_invoice",
      resourceId: invoice.id,
      details: { number: invoice.number, format: "csv" },
      riskLevel: "low",
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="docturn-invoice-${invoice.number}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    for (const line of invoiceCsvLines(invoice, { orgName: org?.name ?? "" })) res.write(line);
    res.end();
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

/** One invoice as either side may see it. Nothing here is PHI. */
export function publicInvoice(i: {
  id: number;
  organizationId: number;
  number: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  lines: Array<{ description: string; quantity: number; unitCents: number; amountCents: number; citedDates: string[] }>;
  subtotalCents: number;
  totalCents: number;
  status: string;
  issuedAt: Date | null;
  dueOn: string | null;
  paidAt: Date | null;
  paidSource: string | null;
  paidByUserId: number | null;
  paidReference: string | null;
  stripeInvoiceId: string | null;
  voidReason: string | null;
}) {
  return {
    id: i.id,
    number: i.number,
    periodStart: i.periodStart,
    periodEnd: i.periodEnd,
    currency: i.currency,
    lines: i.lines,
    subtotalCents: i.subtotalCents,
    totalCents: i.totalCents,
    status: i.status,
    issuedAt: i.issuedAt ? i.issuedAt.toISOString() : null,
    dueOn: i.dueOn,
    paidAt: i.paidAt ? i.paidAt.toISOString() : null,
    /**
     * WHERE a "Paid" came from, always shown: 'operator' (a named person's own
     * action) or 'stripe' (a webhook event id). Never a guess.
     */
    paidSource: i.paidSource,
    paidReference: i.paidReference,
    stripeInvoiceId: i.stripeInvoiceId,
    voidReason: i.voidReason,
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
