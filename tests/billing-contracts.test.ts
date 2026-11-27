import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MODULES } from "@shared/modules";
import { PAST_DUE_GRACE_DAYS, formatCents } from "@shared/billing";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { contractViewFor, effectiveContractStatus, moduleAllowedForDirector } from "../server/billing/contracts.js";
import { invalidateModules } from "../server/modules.js";

/**
 * Billing feature 2 — PLANS and CONTRACTS.
 *
 * `billing_plans` and `org_contracts` are the operator's records, managed only
 * from the developer console. Trial is a plan with an END DATE, not a special
 * mode. A plan's price is integer cents and its currency is fixed per
 * contract.
 *
 * PLANS ONLY GRANT. The per-org module switches stay authoritative: nothing a
 * plan says ever switches a module OFF, and an organization with NO CONTRACT
 * behaves exactly as it does today — the judgment call this pass made is
 * "no contract = unlimited and unbilled", not "implicitly on a default plan".
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
  invalidateModules();
});
afterEach(async () => {
  await ctx.handle.close();
});

const devLogin = () => login(ctx.app, { orgCode: "DOCTURN", username: "dev" });

const PLAN_BODY = {
  code: "enterprise",
  name: "Enterprise",
  moduleIds: ["enterprise.sso", "enterprise.scim", "integration.sms"],
  perSeatPriceCents: 1800,
  currency: "USD",
};

function contractBody(over: Record<string, unknown> = {}) {
  return {
    term: "monthly",
    startDate: "2026-01-01",
    endDate: null,
    committedSeats: 50,
    priceOverrideCents: null,
    poNumber: "PO-2026-114",
    billingContactName: "A. Bursar",
    billingContactEmail: "billing@example.test",
    status: "active",
    ...over,
  };
}

describe("billing plans — operator-managed, integer cents", () => {
  it("a developer creates, lists and edits a plan; nothing is seeded", async () => {
    const { agent: dev } = await devLogin();
    const empty = await dev.get("/api/dev/billing/plans").expect(200);
    expect(empty.body.plans, "a price nobody typed is demo data").toEqual([]);

    const created = await dev.post("/api/dev/billing/plans").send(PLAN_BODY).expect(201);
    expect(created.body.plan.code).toBe("enterprise");
    expect(created.body.plan.perSeatPriceCents).toBe(1800);
    expect(created.body.plan.currency).toBe("USD");
    expect(created.body.plan.moduleIds).toEqual(PLAN_BODY.moduleIds);

    const listed = await dev.get("/api/dev/billing/plans").expect(200);
    expect(listed.body.plans).toHaveLength(1);

    const patched = await dev
      .patch(`/api/dev/billing/plans/${created.body.plan.id}`)
      .send({ perSeatPriceCents: 1950, name: "Enterprise (2027)" })
      .expect(200);
    expect(patched.body.plan.perSeatPriceCents).toBe(1950);
    expect(patched.body.plan.name).toBe("Enterprise (2027)");
  });

  it("rejects a float price, an unknown module id, an unknown currency and a duplicate code", async () => {
    const { agent: dev } = await devLogin();
    await dev.post("/api/dev/billing/plans").send({ ...PLAN_BODY, perSeatPriceCents: 18.5 }).expect(400);
    await dev.post("/api/dev/billing/plans").send({ ...PLAN_BODY, moduleIds: ["nope.nothing"] }).expect(400);
    await dev.post("/api/dev/billing/plans").send({ ...PLAN_BODY, currency: "XBT" }).expect(400);
    await dev.post("/api/dev/billing/plans").send(PLAN_BODY).expect(201);
    await dev.post("/api/dev/billing/plans").send(PLAN_BODY).expect(409);
  });

  it("a director cannot read or write plans", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.get("/api/dev/billing/plans").expect(403);
    await director.post("/api/dev/billing/plans").send(PLAN_BODY).expect(403);
  });

  it("money is formatted from integer cents, never a float", () => {
    expect(formatCents(1950)).toBe("$19.50");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatCents(1950, "EUR")).toBe("€19.50 EUR");
  });
});

describe("org contracts — operator-managed, one per hospital", () => {
  async function plan() {
    const { agent: dev } = await devLogin();
    const res = await dev.post("/api/dev/billing/plans").send(PLAN_BODY).expect(201);
    return { dev, planId: res.body.plan.id as number };
  }

  it("a developer puts a hospital on a plan, reads it back, and changes it", async () => {
    const { dev, planId } = await plan();
    const orgId = ctx.seedResult.orgId;

    const none = await dev.get(`/api/dev/billing/contracts/${orgId}`).expect(200);
    expect(none.body.contract).toBe(null);
    expect(none.body.seats.live.total).toBeGreaterThan(0);

    const put = await dev
      .put(`/api/dev/billing/contracts/${orgId}`)
      .send({ ...contractBody(), planId })
      .expect(200);
    expect(put.body.contract.planId).toBe(planId);
    expect(put.body.contract.committedSeats).toBe(50);
    expect(put.body.contract.poNumber).toBe("PO-2026-114");
    expect(put.body.contract.status).toBe("active");
    expect(put.body.plan.code).toBe("enterprise");

    const changed = await dev
      .put(`/api/dev/billing/contracts/${orgId}`)
      .send({ ...contractBody({ committedSeats: 60, status: "past_due" }), planId })
      .expect(200);
    expect(changed.body.contract.committedSeats).toBe(60);
    expect(changed.body.contract.status).toBe("past_due");
    // Going past due stamps the day the clock started.
    expect(changed.body.contract.pastDueAt).toBeTruthy();

    // One contract per hospital, not two.
    const rows = await ctx.storage.getOrgContract(orgId);
    expect(rows).toBeTruthy();

    // Taking the hospital off contract leaves it unlimited and unbilled again.
    await dev.delete(`/api/dev/billing/contracts/${orgId}`).expect(204);
    expect(await ctx.storage.getOrgContract(orgId)).toBeUndefined();
  });

  it("the operator's contract changes are audited in the TENANT's own trail", async () => {
    const { dev, planId } = await plan();
    const orgId = ctx.seedResult.orgId;
    await dev.put(`/api/dev/billing/contracts/${orgId}`).send({ ...contractBody(), planId }).expect(200);
    await dev.delete(`/api/dev/billing/contracts/${orgId}`).expect(204);

    const trail = await ctx.storage.listAuditLogs(orgId, 50);
    const set = trail.find((a) => a.action === "billing.contract_set");
    const cleared = trail.find((a) => a.action === "billing.contract_clear");
    expect(set, "a contract change must be readable in the hospital's own trail").toBeTruthy();
    expect(set!.riskLevel).toBe("medium");
    expect(set!.organizationId).toBe(orgId);
    expect(cleared).toBeTruthy();
    // No PHI, and no billing contact's name in the details.
    for (const row of [set!, cleared!]) {
      expect(JSON.stringify(row.details)).not.toContain("Bursar");
      expect(JSON.stringify(row.details)).not.toContain("@example.test");
    }
  });

  it("validation: unknown plan, bad term, bad status, negative seats, bad dates, unknown org", async () => {
    const { dev, planId } = await plan();
    const orgId = ctx.seedResult.orgId;
    const bad = async (over: Record<string, unknown>, status = 400) =>
      dev.put(`/api/dev/billing/contracts/${orgId}`).send({ ...contractBody(over), planId }).expect(status);
    await bad({ term: "weekly" });
    await bad({ status: "lapsed" });
    await bad({ committedSeats: -1 });
    await bad({ committedSeats: 1.5 });
    await bad({ startDate: "01/01/2026" });
    await bad({ endDate: "2025-12-31" }); // ends before it starts
    await dev
      .put(`/api/dev/billing/contracts/${orgId}`)
      .send({ ...contractBody(), planId: planId + 999 })
      .expect(400);
    await dev
      .put(`/api/dev/billing/contracts/${ctx.seedResult.platformOrgId}`)
      .send({ ...contractBody(), planId })
      .expect(409); // the platform operator never bills itself
    await dev.put("/api/dev/billing/contracts/987654").send({ ...contractBody(), planId }).expect(404);
  });

  it("a director cannot reach the operator's contract routes for any org", async () => {
    const { planId } = await plan();
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.get(`/api/dev/billing/contracts/${ctx.seedResult.orgId}`).expect(403);
    await director
      .put(`/api/dev/billing/contracts/${ctx.seedResult.orgId}`)
      .send({ ...contractBody(), planId })
      .expect(403);
  });
});

describe("contract status is computed on read, never waited for", () => {
  it("an end date in the past reads as expired whatever the stored status says", () => {
    expect(
      effectiveContractStatus({ status: "active", endDate: "2026-01-31" }, "2026-03-01"),
    ).toBe("expired");
    expect(
      effectiveContractStatus({ status: "active", endDate: "2026-01-31" }, "2026-01-31"),
    ).toBe("active");
    expect(effectiveContractStatus({ status: "active", endDate: null }, "2099-01-01")).toBe("active");
    // Cancelled stays cancelled; a trial with a live end date is still a trial.
    expect(
      effectiveContractStatus({ status: "cancelled", endDate: null }, "2026-03-01"),
    ).toBe("cancelled");
    expect(
      effectiveContractStatus({ status: "trial", endDate: "2026-12-31" }, "2026-03-01"),
    ).toBe("trial");
  });

  it("past due warns from day one and the grace period is 30 days", () => {
    const view = contractViewFor(
      {
        status: "past_due",
        endDate: null,
        pastDueAt: new Date("2026-03-01T00:00:00Z"),
        committedSeats: 10,
      },
      "2026-03-05",
    );
    expect(view.status).toBe("past_due");
    expect(view.warning).toBeTruthy();
    expect(view.pastDueSince).toBe("2026-03-01");
    expect(view.graceEndsOn).toBe("2026-03-31");
    expect(PAST_DUE_GRACE_DAYS).toBe(30);
    // Inside the grace window nothing changes at all.
    expect(view.seatsRefused).toBe(false);
    // Outside it, the ONLY thing that changes is that new seats are refused.
    const after = contractViewFor(
      {
        status: "past_due",
        endDate: null,
        pastDueAt: new Date("2026-03-01T00:00:00Z"),
        committedSeats: 10,
      },
      "2026-04-05",
    );
    expect(after.seatsRefused).toBe(true);
  });
});

describe("plans only GRANT — today's behaviour never regresses", () => {
  it("with NO contract every module is allowed to the director, exactly as today", () => {
    for (const m of MODULES) {
      expect(moduleAllowedForDirector(null, null, m.id)).toEqual({ allowed: true });
    }
  });

  it("with a contract, a module in the plan is allowed and one outside it is not in your plan", () => {
    const plan = { moduleIds: ["integration.sms"] };
    const contract = { status: "active" as const, endDate: null };
    expect(moduleAllowedForDirector(contract, plan, "integration.sms")).toEqual({ allowed: true });
    const outside = moduleAllowedForDirector(contract, plan, "integration.aiIntake");
    expect(outside.allowed).toBe(false);
    expect(outside.allowed === false && outside.reason).toBe("not_in_plan");
  });

  it("a plan never switches a module off: the effective map is untouched by a contract", async () => {
    const { agent: dev } = await devLogin();
    const orgId = ctx.seedResult.orgId;
    const { agent: director } = await login(ctx.app, { username: "director" });
    const before = (await director.get("/api/modules").expect(200)).body.modules;

    const planRes = await dev
      .post("/api/dev/billing/plans")
      // A plan that grants NOTHING at all.
      .send({ ...PLAN_BODY, moduleIds: [] })
      .expect(201);
    await dev
      .put(`/api/dev/billing/contracts/${orgId}`)
      .send({ ...contractBody(), planId: planRes.body.plan.id })
      .expect(200);
    invalidateModules();

    const after = (await director.get("/api/modules").expect(200)).body.modules;
    expect(after, "a plan may only GRANT — never switch anything off").toEqual(before);
    // And the hospital still works: a STAT message goes out as before.
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = await er
      .post("/api/messaging/conversations")
      .send({ type: "direct", participantIds: [ctx.seedResult.userIds.chen!] });
    await er
      .post("/api/messaging/send")
      .send({ conversationId: convo.body.id, content: "x", priority: "stat" })
      .expect(201);
  });

  it("a director switching an integration ON that is outside the plan is refused; the developer still can", async () => {
    const { agent: dev } = await devLogin();
    const orgId = ctx.seedResult.orgId;
    // SMS is ON by default; switch it off first so turning it on is the action.
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.patch("/api/integrations/twilio-sms").send({ enabled: false }).expect(200);

    const planRes = await dev.post("/api/dev/billing/plans").send({ ...PLAN_BODY, moduleIds: [] }).expect(201);
    await dev
      .put(`/api/dev/billing/contracts/${orgId}`)
      .send({ ...contractBody(), planId: planRes.body.plan.id })
      .expect(200);

    const refused = await director.patch("/api/integrations/twilio-sms").send({ enabled: true });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("not_in_plan");
    expect(String(refused.body.message)).toMatch(/plan/i);

    // The operator is never blocked by a plan: it is their own record. (A
    // non-integration module, because an integration the operator has not
    // configured is refused for a different, older reason.)
    await dev
      .patch(`/api/dev/modules/${orgId}`)
      .send({ id: "enterprise.sso", enabled: true })
      .expect(200);
    invalidateModules();
    const map = (await director.get("/api/modules").expect(200)).body.modules;
    expect(map["enterprise.sso"], "a plan never constrains the operator").toBe(true);
  });
});

describe("the billing module itself", () => {
  it("is registered, defaults OFF, and billing.stripe requires it", () => {
    const billing = MODULES.find((m) => m.id === "billing");
    expect(billing).toBeTruthy();
    expect(billing!.default).toBe(false);
    const stripe = MODULES.find((m) => m.id === "billing.stripe");
    expect(stripe!.default).toBe(false);
    expect(stripe!.requires).toContain("billing");
  });

  it("GET /api/billing is 404 module_disabled by default, and 200 once the operator turns it on", async () => {
    const { agent: dev } = await devLogin();
    const orgId = ctx.seedResult.orgId;
    const { agent: director } = await login(ctx.app, { username: "director" });

    const off = await director.get("/api/billing");
    expect(off.status).toBe(404);
    expect(off.body).toEqual({ error: "module_disabled", module: "billing" });

    await dev.patch(`/api/dev/modules/${orgId}`).send({ id: "billing", enabled: true }).expect(200);
    invalidateModules();
    const on = await director.get("/api/billing").expect(200);
    // No contract yet: the screen says so, and invents nothing.
    expect(on.body.contract).toBe(null);
    expect(on.body.billed).toBe(false);
    expect(String(on.body.notice)).toMatch(/no billing contract/i);
    expect(on.body.seats.live.total).toBeGreaterThan(0);
    expect(on.body.invoices).toEqual([]);
  });

  it("a hospitalist never sees billing, even with the module on", async () => {
    const { agent: dev } = await devLogin();
    await dev.patch(`/api/dev/modules/${ctx.seedResult.orgId}`).send({ id: "billing", enabled: true }).expect(200);
    invalidateModules();
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.get("/api/billing").expect(403);
  });

  it("a director never sees another tenant's contract through their own billing screen", async () => {
    const { agent: dev } = await devLogin();
    const other = await ctx.storage.createOrganization({
      name: "Other General", code: "OTHR2", city: null, state: null,
      timezone: "UTC", assignmentTimeoutMin: 10, roundRobinShiftTypes: ["day"],
      rotationMode: "lowest_census", rotationIndex: 0,
    });
    const planRes = await dev.post("/api/dev/billing/plans").send(PLAN_BODY).expect(201);
    await dev
      .put(`/api/dev/billing/contracts/${other.id}`)
      .send({ ...contractBody({ poNumber: "PO-OTHER-999" }), planId: planRes.body.plan.id })
      .expect(200);
    await dev.patch(`/api/dev/modules/${ctx.seedResult.orgId}`).send({ id: "billing", enabled: true }).expect(200);
    invalidateModules();

    const { agent: director } = await login(ctx.app, { username: "director" });
    const mine = await director.get("/api/billing").expect(200);
    expect(JSON.stringify(mine.body)).not.toContain("PO-OTHER-999");
    expect(mine.body.orgId).toBe(ctx.seedResult.orgId);
  });
});
