import type { Express, Request, Response } from "express";
import {
  billingPlanCreateSchema,
  billingPlanPatchSchema,
  orgContractPutSchema,
  type Organization,
} from "@shared/schema";
import { appendAudit } from "../audit.js";
import { effectivePerSeatCents, resolveContract } from "../billing/contracts.js";
import { seatEntitlementFor } from "../billing/entitlements.js";
import { seatUsageFor } from "../billing/seats.js";
import { isPlatformOrg } from "../billing/seats.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";
import { publicContract, publicPlan } from "./billing.js";

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
    let committedTotalCents = 0;
    for (const org of orgs) {
      const { contract, view } = await resolveContract(db, org.id);
      const plan = contract ? plans.get(contract.planId) ?? null : null;
      const seats = await seatUsageFor(db, org.id);
      const perSeatCents = contract && plan ? effectivePerSeatCents(contract, plan) : null;
      const monthlyCents =
        contract && perSeatCents != null ? Math.max(contract.committedSeats, seats.live.total) * perSeatCents : null;
      if (monthlyCents != null && (view.status === "active" || view.status === "trial" || view.status === "past_due")) {
        committedTotalCents += monthlyCents;
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
    res.json({ tenants: rows, totals: { tenants: rows.length, committedTotalCents } });
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
}
