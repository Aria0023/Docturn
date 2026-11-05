import type { Express, Request, Response } from "express";
import {
  billingPlanCreateSchema,
  billingPlanPatchSchema,
  invoiceGenerateSchema,
  invoicePaidSchema,
  invoiceVoidSchema,
  orgContractPutSchema,
  type BillingInvoice,
  type Organization,
} from "@shared/schema";
import { addDays } from "@shared/billing";
import { appendAudit } from "../audit.js";
import { effectivePerSeatCents, resolveContract } from "../billing/contracts.js";
import { seatEntitlementFor } from "../billing/entitlements.js";
import { generateInvoiceLines } from "../billing/invoices.js";
import { seatUsageFor } from "../billing/seats.js";
import { stripePlatformConfig } from "../billing/stripe-config.js";
import {
  createStripeCustomer,
  createStripeInvoice,
  createStripeInvoiceItem,
  finalizeStripeInvoice,
} from "../billing/stripe.js";
import { isModuleEnabled } from "../modules.js";
import { isPlatformOrg } from "../billing/seats.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";
import { publicContract, publicInvoice, publicPlan } from "./billing.js";

/**
 * The OPERATOR's billing console (developer console → Billing). Plans are
 * platform-wide; a contract belongs to one hospital.
 *
 *   GET    /api/dev/billing/plans
 *   POST   /api/dev/billing/plans
 *   PATCH  /api/dev/billing/plans/:id
 *   GET    /api/dev/billing/contracts              every tenant, seats, status
 *   GET    /api/dev/billing/contracts/:orgId
 *   PUT    /api/dev/billing/contracts/:orgId       put a hospital on a plan
 *   DELETE /api/dev/billing/contracts/:orgId       back to unlimited/unbilled
 *
 * Developer role only. These routes are deliberately NOT gated by the
 * `billing` module: the console has to work in order to switch it on for a
 * hospital, and the operator's own view of their business is not a tenant
 * feature.
 *
 * Every write is audited IN THE TENANT'S OWN TRAIL at medium risk — a hospital
 * that exports its audit trail can see when its contract changed and who did
 * it. The details carry ids, a plan code and a status: never the billing
 * contact's name or email (that is personal data the trail does not need), and
 * never anything clinical.
 *
 * NOTHING IS SEEDED. A plan nobody typed would be a price shown as real.
 */

const NO_PHI = { /* marker: nothing in this file reads patient data */ };
void NO_PHI;

async function tenantOr404(req: Request, res: Response): Promise<Organization | null> {
  const orgId = Number(req.params.orgId);
  if (!Number.isInteger(orgId) || orgId <= 0) {
    res.status(400).json({ error: "validation_error" });
    return null;
  }
  const org = await storage().getOrganization(orgId);
  if (!org) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  if (isPlatformOrg(org)) {
    // DocTurn does not bill itself.
    res.status(409).json({ error: "platform_org_not_billable" });
    return null;
  }
  return org;
}

async function invoiceOr404(req: Request, res: Response): Promise<BillingInvoice | null> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "validation_error" });
    return null;
  }
  const inv = await storage().getInvoice(id);
  if (!inv) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  return inv;
}

/** Console roll-ups. Only ISSUED invoices are money the operator is owed. */
function invoiceTotals(invoices: readonly BillingInvoice[]) {
  let issuedCents = 0;
  let paidCents = 0;
  for (const i of invoices) {
    if (i.status === "issued") issuedCents += i.totalCents;
    if (i.status === "paid") paidCents += i.totalCents;
  }
  return { count: invoices.length, issuedCents, paidCents };
}

export function registerDevBillingRoutes(app: Express) {
  /* ── plans ──────────────────────────────────────────────────────────────── */

  app.get("/api/dev/billing/plans", requireAuth, requireRole("developer"), async (req, res) => {
    const includeArchived = String(req.query.archived ?? "") === "true";
    const plans = await storage().listBillingPlans(includeArchived);
    const inUse = new Map<number, number>();
    for (const c of await storage().listOrgContracts()) {
      inUse.set(c.planId, (inUse.get(c.planId) ?? 0) + 1);
    }
    res.json({
      plans: plans.map((p) => ({
        ...publicPlan(p),
        archived: !!p.archivedAt,
        contracts: inUse.get(p.id) ?? 0,
      })),
    });
  });

  app.post("/api/dev/billing/plans", requireAuth, requireRole("developer"), async (req, res) => {
    const me = currentUser(req);
    const parsed = billingPlanCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const d = parsed.data;
    if (await storage().getBillingPlanByCode(d.code)) {
      return res.status(409).json({ error: "code_taken" });
    }
    const plan = await storage().createBillingPlan({
      code: d.code,
      name: d.name,
      moduleIds: d.moduleIds,
      perSeatPriceCents: d.perSeatPriceCents,
      currency: d.currency,
      createdBy: me.id,
    });
    // A plan is the operator's own record, so it is filed in the operator's org.
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "billing.plan_create",
      resourceType: "billing_plan",
      resourceId: plan.id,
      details: { code: plan.code, perSeatPriceCents: plan.perSeatPriceCents, currency: plan.currency },
      riskLevel: "medium",
    });
    res.status(201).json({ plan: { ...publicPlan(plan), archived: false, contracts: 0 } });
  });

  app.patch("/api/dev/billing/plans/:id", requireAuth, requireRole("developer"), async (req, res) => {
    const me = currentUser(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "validation_error" });
    const parsed = billingPlanPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const existing = await storage().getBillingPlan(id);
    if (!existing) return res.status(404).json({ error: "not_found" });
    const d = parsed.data;
    if (d.code && d.code !== existing.code && (await storage().getBillingPlanByCode(d.code))) {
      return res.status(409).json({ error: "code_taken" });
    }
    const plan = await storage().updateBillingPlan(id, {
      ...(d.code != null ? { code: d.code } : {}),
      ...(d.name != null ? { name: d.name } : {}),
      ...(d.moduleIds != null ? { moduleIds: d.moduleIds } : {}),
      ...(d.perSeatPriceCents != null ? { perSeatPriceCents: d.perSeatPriceCents } : {}),
      ...(d.currency != null ? { currency: d.currency } : {}),
      ...(d.archived != null ? { archivedAt: d.archived ? new Date() : null } : {}),
    });
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "billing.plan_update",
      resourceType: "billing_plan",
      resourceId: id,
      details: { code: plan?.code ?? existing.code, changedKeys: Object.keys(d).sort() },
      riskLevel: "medium",
    });
    res.json({
      plan: { ...publicPlan(plan!), archived: !!plan!.archivedAt, contracts: await storage().countContractsOnPlan(id) },
    });
  });

  /* ── contracts ──────────────────────────────────────────────────────────── */

  /** Every tenant: seats, contract status, what it is worth. The console list. */
  app.get("/api/dev/billing/contracts", requireAuth, requireRole("developer"), async (_req, res) => {
    const db = storage();
    const orgs = (await db.listOrganizations()).filter((o) => !isPlatformOrg(o));
    const plans = new Map((await db.listBillingPlans(true)).map((p) => [p.id, p]));
    const rows = [];
    /**
     * Per CURRENCY, never one number: a contract's currency is fixed per
     * contract, and adding USD cents to EUR cents would produce a total that
     * means nothing. The console shows one line per currency.
     */
    const committedByCurrency: Record<string, number> = {};
    for (const org of orgs) {
      const { contract, view } = await resolveContract(db, org.id);
      const plan = contract ? plans.get(contract.planId) ?? null : null;
      const seats = await seatUsageFor(db, org.id);
      const perSeatCents = contract && plan ? effectivePerSeatCents(contract, plan) : null;
      const monthlyCents =
        contract && perSeatCents != null ? Math.max(contract.committedSeats, seats.live.total) * perSeatCents : null;
      if (monthlyCents != null && plan && (view.status === "active" || view.status === "trial" || view.status === "past_due")) {
        committedByCurrency[plan.currency] = (committedByCurrency[plan.currency] ?? 0) + monthlyCents;
      }
      rows.push({
        orgId: org.id,
        orgCode: org.code,
        orgName: org.name,
        timezone: org.timezone,
        contract: contract ? publicContract(contract) : null,
        plan: plan ? publicPlan(plan) : null,
        view,
        seats,
        perSeatCents,
        monthlyCents,
        /** Over the committed seat count — an invoice line, never a blocker. */
        overageSeats: contract ? Math.max(0, seats.live.total - contract.committedSeats) : 0,
      });
    }
    // Whether the operator has configured Stripe AT ALL, so the console can
    // say in plain words who issues invoices and who marks them paid. The
    // per-tenant switch is `billing.stripe`; this is the platform half.
    const { config, missing } = stripePlatformConfig();
    res.json({
      tenants: rows,
      totals: { tenants: rows.length, committedByCurrency },
      stripe: { configured: !!config, missing },
    });
  });

  app.get("/api/dev/billing/contracts/:orgId", requireAuth, requireRole("developer"), async (req, res) => {
    const me = currentUser(req);
    const org = await tenantOr404(req, res);
    if (!org) return;
    const db = storage();
    // A developer reading a tenant's contract is a cross-tenant read, filed in
    // that tenant's trail before the read — the same rule as every other
    // cross-tenant read in the console.
    await appendAudit({
      organizationId: org.id,
      userId: me.id,
      action: "billing.contract_read",
      resourceType: "organization",
      resourceId: org.id,
      details: { orgId: org.id },
      riskLevel: "low",
    });
    const { contract, plan, view } = await resolveContract(db, org.id);
    res.json({
      orgId: org.id,
      orgCode: org.code,
      orgName: org.name,
      contract: contract ? publicContract(contract) : null,
      plan: plan ? publicPlan(plan) : null,
      view,
      seats: await seatUsageFor(db, org.id),
      entitlement: await seatEntitlementFor(db, org.id),
      stripeCustomerId: contract?.stripeCustomerId ?? null,
      stripeSendInvoiceEmail: contract?.stripeSendInvoiceEmail ?? false,
    });
  });

  app.put("/api/dev/billing/contracts/:orgId", requireAuth, requireRole("developer"), async (req, res) => {
    const me = currentUser(req);
    const org = await tenantOr404(req, res);
    if (!org) return;
    const parsed = orgContractPutSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const d = parsed.data;
    const plan = await storage().getBillingPlan(d.planId);
    if (!plan) return res.status(400).json({ error: "unknown_plan" });

    const existing = await storage().getOrgContract(org.id);
    // The past-due clock starts the moment the status is set, and is kept
    // across an unrelated edit so the 30-day grace cannot be reset by accident.
    const pastDueAt =
      d.status === "past_due" ? (existing?.status === "past_due" ? existing.pastDueAt ?? new Date() : new Date()) : null;

    const contract = await storage().upsertOrgContract({
      organizationId: org.id,
      planId: d.planId,
      term: d.term,
      startDate: d.startDate,
      endDate: d.endDate ?? null,
      committedSeats: d.committedSeats,
      priceOverrideCents: d.priceOverrideCents ?? null,
      poNumber: d.poNumber ?? null,
      billingContactName: d.billingContactName ?? null,
      billingContactEmail: d.billingContactEmail ?? null,
      status: d.status,
      pastDueAt,
      // Stripe fields are owned by the Stripe path, never overwritten here.
      stripeCustomerId: existing?.stripeCustomerId ?? null,
      stripeSendInvoiceEmail: d.stripeSendInvoiceEmail ?? existing?.stripeSendInvoiceEmail ?? false,
      daysUntilDue: d.daysUntilDue ?? existing?.daysUntilDue ?? 30,
      createdBy: existing?.createdBy ?? me.id,
    });
    await appendAudit({
      organizationId: org.id,
      userId: me.id,
      action: "billing.contract_set",
      resourceType: "organization",
      resourceId: org.id,
      details: {
        // Ids, a plan code, a term, a status and counts. No contact details.
        planId: contract.planId,
        code: plan.code,
        term: contract.term,
        status: contract.status,
        committedSeats: contract.committedSeats,
        perSeatPriceCents: effectivePerSeatCents(contract, plan),
        currency: plan.currency,
        previousStatus: existing?.status ?? null,
      },
      riskLevel: "medium",
    });
    const { view } = await resolveContract(storage(), org.id);
    res.json({ contract: publicContract(contract), plan: publicPlan(plan), view });
  });

  app.delete("/api/dev/billing/contracts/:orgId", requireAuth, requireRole("developer"), async (req, res) => {
    const me = currentUser(req);
    const org = await tenantOr404(req, res);
    if (!org) return;
    const existing = await storage().getOrgContract(org.id);
    if (!existing) return res.status(204).end();
    await storage().deleteOrgContract(org.id);
    await appendAudit({
      organizationId: org.id,
      userId: me.id,
      action: "billing.contract_clear",
      resourceType: "organization",
      resourceId: org.id,
      details: { planId: existing.planId, previousStatus: existing.status },
      riskLevel: "medium",
    });
    res.status(204).end();
  });

  /* ── invoices (the manual path — complete and real on its own) ──────────── */

  app.get("/api/dev/billing/invoices", requireAuth, requireRole("developer"), async (req, res) => {
    const db = storage();
    const orgIdRaw = String(req.query.orgId ?? "");
    const orgs = new Map((await db.listOrganizations()).map((o) => [o.id, o]));
    let invoices;
    if (orgIdRaw) {
      const orgId = Number(orgIdRaw);
      if (!Number.isInteger(orgId) || orgId <= 0) return res.status(400).json({ error: "validation_error" });
      invoices = await db.listOrgInvoices(orgId, 200);
    } else {
      invoices = await db.listAllInvoices(500);
    }
    res.json({
      invoices: invoices.map((i) => ({
        ...publicInvoice(i),
        orgId: i.organizationId,
        orgCode: orgs.get(i.organizationId)?.code ?? "—",
        orgName: orgs.get(i.organizationId)?.name ?? "—",
      })),
      totals: invoiceTotals(invoices),
    });
  });

  /** Generate a DRAFT from the contract and the period's seat snapshots. */
  app.post("/api/dev/billing/invoices", requireAuth, requireRole("developer"), async (req, res) => {
    const me = currentUser(req);
    const parsed = invoiceGenerateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const d = parsed.data;
    const db = storage();
    const org = await db.getOrganization(d.orgId);
    if (!org) return res.status(404).json({ error: "not_found" });
    if (isPlatformOrg(org)) return res.status(409).json({ error: "platform_org_not_billable" });
    const contract = await db.getOrgContract(d.orgId);
    if (!contract) return res.status(409).json({ error: "no_contract" });
    const plan = await db.getBillingPlan(contract.planId);
    if (!plan) return res.status(409).json({ error: "no_plan" });

    const snapshots = await db.listSeatSnapshotsInRange(d.orgId, d.periodStart, d.periodEnd);
    if (snapshots.length === 0) {
      // Never invent a count. Without a snapshot there is nothing to cite.
      return res.status(409).json({ error: "no_snapshots", message: "No seat snapshot exists in that period, so there is nothing an invoice line could cite." });
    }
    const generated = generateInvoiceLines(contract, plan, snapshots);
    const invoice = await db.createInvoiceWithNumber({
      organizationId: d.orgId,
      contractId: contract.id,
      periodStart: d.periodStart,
      periodEnd: d.periodEnd,
      currency: generated.currency,
      lines: generated.lines,
      subtotalCents: generated.subtotalCents,
      totalCents: generated.totalCents,
      status: "draft",
      createdBy: me.id,
    });
    await appendAudit({
      organizationId: d.orgId,
      userId: me.id,
      action: "billing.invoice_create",
      resourceType: "billing_invoice",
      resourceId: invoice.id,
      details: {
        number: invoice.number,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        totalCents: invoice.totalCents,
        currency: invoice.currency,
        peakSeats: generated.peakSeats,
        snapshotDays: generated.snapshotDays,
      },
      riskLevel: "medium",
    });
    res.status(201).json({ invoice: publicInvoice(invoice), generated });
  });

  /**
   * ISSUE. The number is already fixed (allocated with the row); issuing sets
   * the issue time and the due date from the contract's net terms. An issued
   * invoice is immutable except for its status.
   */
  app.post("/api/dev/billing/invoices/:id/issue", requireAuth, requireRole("developer"), async (req, res) => {
    const me = currentUser(req);
    const inv = await invoiceOr404(req, res);
    if (!inv) return;
    if (inv.status !== "draft") return res.status(409).json({ error: "not_draft", status: inv.status });
    const contract = await storage().getOrgContract(inv.organizationId);
    const issuedAt = new Date();
    const dueOn = addDays(issuedAt.toISOString().slice(0, 10), contract?.daysUntilDue ?? 30);
    const saved = await storage().updateInvoice(inv.id, { status: "issued", issuedAt, dueOn });
    await appendAudit({
      organizationId: inv.organizationId,
      userId: me.id,
      action: "billing.invoice_issue",
      resourceType: "billing_invoice",
      resourceId: inv.id,
      details: { number: inv.number, totalCents: inv.totalCents, currency: inv.currency, dueOn },
      riskLevel: "medium",
    });
    res.json({ invoice: publicInvoice(saved!) });
  });

  /**
   * VOID. The only correction path — an issued invoice is never recomputed.
   * The NUMBER IS KEPT FOREVER and is never reused, so the sequence stays
   * gap-free and a hospital's records still line up.
   */
  app.post("/api/dev/billing/invoices/:id/void", requireAuth, requireRole("developer"), async (req, res) => {
    const me = currentUser(req);
    const inv = await invoiceOr404(req, res);
    if (!inv) return;
    const parsed = invoiceVoidSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    if (inv.status === "paid") return res.status(409).json({ error: "already_paid" });
    if (inv.status === "void") return res.json({ invoice: publicInvoice(inv) });
    const saved = await storage().updateInvoice(inv.id, { status: "void", voidReason: parsed.data.reason });
    await appendAudit({
      organizationId: inv.organizationId,
      userId: me.id,
      action: "billing.invoice_void",
      resourceType: "billing_invoice",
      resourceId: inv.id,
      details: { number: inv.number, reason: parsed.data.reason, previousStatus: inv.status },
      riskLevel: "medium",
    });
    res.json({ invoice: publicInvoice(saved!) });
  });

  /**
   * MARK PAID — the operator's own action. "Paid" is never a guess: the row
   * records WHO (their user id), WHEN, the source (`operator`) and their
   * reference. The only other source is a Stripe webhook event id.
   */
  app.post("/api/dev/billing/invoices/:id/mark-paid", requireAuth, requireRole("developer"), async (req, res) => {
    const me = currentUser(req);
    const inv = await invoiceOr404(req, res);
    if (!inv) return;
    const parsed = invoicePaidSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    if (inv.status === "void") return res.status(409).json({ error: "is_void" });
    if (inv.status === "draft") return res.status(409).json({ error: "not_issued" });
    if (inv.status === "paid") return res.json({ invoice: publicInvoice(inv) });
    const paidAt = new Date();
    const saved = await storage().updateInvoice(inv.id, {
      status: "paid",
      paidAt,
      paidSource: "operator",
      paidByUserId: me.id,
      paidReference: parsed.data.reference ?? null,
    });
    await appendAudit({
      organizationId: inv.organizationId,
      userId: me.id,
      action: "billing.invoice_paid",
      resourceType: "billing_invoice",
      resourceId: inv.id,
      details: { number: inv.number, totalCents: inv.totalCents, currency: inv.currency, source: "operator" },
      riskLevel: "medium",
    });
    res.json({ invoice: publicInvoice(saved!) });
  });

  /**
   * Push an ISSUED invoice to Stripe for collection (module `billing.stripe`).
   *
   * Stripe is the collection rail, so this changes nothing about OUR invoice
   * except remembering the Stripe id: the amount, the lines and the period are
   * already fixed. One Stripe Customer per hospital (remembered on the
   * contract), one Invoice Item per line of our invoice, then a Stripe Invoice
   * with collection_method "send_invoice" and the contract's net terms.
   *
   * No Stripe Subscription object is ever created — see server/billing/stripe.ts
   * for why.
   */
  app.post("/api/dev/billing/invoices/:id/stripe", requireAuth, requireRole("developer"), async (req, res) => {
    const me = currentUser(req);
    const inv = await invoiceOr404(req, res);
    if (!inv) return;
    const { config, missing } = stripePlatformConfig();
    if (!config) return res.status(409).json({ error: "stripe_not_configured", missing });
    if (!(await isModuleEnabled(inv.organizationId, "billing.stripe"))) {
      return res.status(409).json({ error: "module_disabled", module: "billing.stripe" });
    }
    if (inv.status !== "issued") return res.status(409).json({ error: "not_issued", status: inv.status });
    if (inv.stripeInvoiceId) return res.status(409).json({ error: "already_pushed", stripeInvoiceId: inv.stripeInvoiceId });

    const org = await storage().getOrganization(inv.organizationId);
    const contract = await storage().getOrgContract(inv.organizationId);
    if (!org || !contract) return res.status(409).json({ error: "no_contract" });
    const plan = await storage().getBillingPlan(contract.planId);
    if (!plan) return res.status(409).json({ error: "no_plan" });

    // One Customer per hospital, remembered on the contract.
    let customerId = contract.stripeCustomerId;
    if (!customerId) {
      const made = await createStripeCustomer(config, { org, contract });
      if (!made.ok || !made.body?.id) return res.status(502).json({ error: "stripe_failed", stage: "customer", detail: made.error });
      customerId = made.body.id;
      await storage().updateOrgContract(org.id, { stripeCustomerId: customerId });
    }

    for (const line of inv.lines) {
      const item = await createStripeInvoiceItem(config, customerId, inv, line);
      if (!item.ok) return res.status(502).json({ error: "stripe_failed", stage: "invoice_item", detail: item.error });
    }
    const peakSeats = Math.max(contract.committedSeats, ...inv.lines.map((l) => l.quantity), 0);
    const made = await createStripeInvoice(config, customerId, inv, contract, plan.code, peakSeats);
    if (!made.ok || !made.body?.id) return res.status(502).json({ error: "stripe_failed", stage: "invoice", detail: made.error });
    const finalized = await finalizeStripeInvoice(config, made.body.id);
    if (!finalized.ok) return res.status(502).json({ error: "stripe_failed", stage: "finalize", detail: finalized.error });

    const saved = await storage().updateInvoice(inv.id, { stripeInvoiceId: made.body.id });
    await storage().recordBillingTransition({
      organizationId: org.id,
      invoiceId: inv.id,
      stripeEventId: null,
      type: "stripe_push",
      fromStatus: inv.status,
      toStatus: inv.status,
      actorUserId: me.id,
      detail: { stripeInvoiceId: made.body.id, emailOptIn: contract.stripeSendInvoiceEmail },
    });
    await appendAudit({
      organizationId: org.id,
      userId: me.id,
      action: "billing.stripe_push",
      resourceType: "billing_invoice",
      resourceId: inv.id,
      details: {
        number: inv.number,
        totalCents: inv.totalCents,
        currency: inv.currency,
        // Whether STRIPE will email the hospital — off unless this contract
        // opted in explicitly.
        emailOptIn: contract.stripeSendInvoiceEmail,
      },
      riskLevel: "medium",
    });
    res.json({
      invoice: publicInvoice(saved!),
      stripeInvoiceId: made.body.id,
      /** Truthful: Stripe only emails when the contract opted in. */
      emailed: contract.stripeSendInvoiceEmail,
    });
  });
}
