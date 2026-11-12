import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { checkOrgCreationAllowed, seatEntitlementFor } from "../server/billing/entitlements.js";
import { countBillableSeats } from "../server/billing/seats.js";
import { provisionUser } from "../server/services/provisioning.js";
import { invalidateModules } from "../server/modules.js";

/**
 * Billing feature 3 — ENTITLEMENTS.
 *
 * The seat limit is the ONLY thing billing can refuse, and only to a
 * DIRECTOR. The operator can always add an account (an over-limit add is
 * audited in the tenant's own trail, so the overage line on the next invoice
 * is not a surprise). An identity provider is never refused at all. The
 * safety invariant itself is proved in tests/billing-safety-invariant.test.ts.
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

async function putOnContract(over: Record<string, unknown> = {}) {
  const plan = await ctx.storage.createBillingPlan({
    code: "ent-" + Math.random().toString(36).slice(2, 8),
    name: "Entitlement test plan",
    moduleIds: [],
    perSeatPriceCents: 1500,
    currency: "USD",
  });
  const seats = (await countBillableSeats(ctx.storage, ctx.seedResult.orgId)).total;
  return {
    seats,
    contract: await ctx.storage.upsertOrgContract({
      organizationId: ctx.seedResult.orgId,
      planId: plan.id,
      term: "monthly",
      startDate: "2026-01-01",
      endDate: null,
      committedSeats: seats + 5,
      priceOverrideCents: null,
      poNumber: null,
      billingContactName: null,
      billingContactEmail: null,
      status: "active",
      pastDueAt: null,
      createdBy: null,
      ...over,
    }),
  };
}

const newProvider = (n: string) => ({
  username: "seat." + n,
  displayName: "Dr. Seat " + n,
  role: "hospitalist" as const,
});

describe("no contract on file — exactly today's behaviour", () => {
  it("the entitlement is unlimited and unbilled, and a director adds an account as before", async () => {
    const ent = await seatEntitlementFor(ctx.storage, ctx.seedResult.orgId);
    expect(ent.unbilled).toBe(true);
    expect(ent.committedSeats).toBe(null);
    expect(ent.refused).toBe(false);
    expect(ent.message).toBe(null);

    const { agent: director } = await login(ctx.app, { username: "director" });
    const res = await director.post("/api/director/hospitalists").send(newProvider("a"));
    expect(res.status).toBe(201);
  });

  it("a failure reading the billing tables allows the account and never blocks the director", async () => {
    // A billing hiccup must never stop a hospital adding a clinician.
    const broken = Object.create(ctx.storage) as typeof ctx.storage;
    broken.getOrgContract = () => Promise.reject(new Error("billing table unavailable"));
    const ent = await seatEntitlementFor(broken, ctx.seedResult.orgId);
    expect(ent.unbilled).toBe(true);
    expect(ent.refused).toBe(false);
  });
});

describe("the seat limit — refused for the director, with a reason", () => {
  it("below the commitment the director adds accounts; at it they are refused 402", async () => {
    const { seats } = await putOnContract();
    const { agent: director } = await login(ctx.app, { username: "director" });
    // committedSeats = seats + 5, so five more fit.
    for (let i = 0; i < 5; i++) {
      const ok = await director.post("/api/director/hospitalists").send(newProvider("ok" + i));
      expect(ok.status, `account ${i} should fit inside the commitment`).toBe(201);
    }
    const refused = await director.post("/api/director/hospitalists").send(newProvider("over"));
    expect(refused.status).toBe(402);
    expect(refused.body.error).toBe("seat_refused");
    expect(refused.body.reason).toBe("seat_limit_reached");
    expect(refused.body.seatsInUse).toBe(seats + 5);
    expect(refused.body.committedSeats).toBe(seats + 5);
    // The reason is plain, names the number, and says what is NOT affected.
    expect(String(refused.body.message)).toMatch(new RegExp(String(seats + 5)));
    expect(String(refused.body.message)).toMatch(/STAT/);

    // Audited in the hospital's own trail.
    const trail = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    const row = trail.find((a) => a.action === "billing.seat_refused");
    expect(row).toBeTruthy();
    expect(row!.riskLevel).toBe("medium");
    expect(row!.details).toMatchObject({ reason: "seat_limit_reached" });

    // Deactivating a leaver frees the seat immediately — the same definition.
    await director.post(`/api/accounts/${ctx.seedResult.userIds.chen}/deactivate`).expect(200);
    const again = await director.post("/api/director/hospitalists").send(newProvider("freed"));
    expect(again.status).toBe(201);
  });

  it("approving a pending registration is the same one check, not a way around it", async () => {
    await putOnContract({ committedSeats: 1 });
    const reg = await ctx.storage.createPendingRegistration({
      organizationId: ctx.seedResult.orgId,
      username: "walkin.doc",
      passwordHash: "x",
      displayName: "Dr. Walk In",
      requestedRole: "hospitalist",
      status: "pending",
    });
    const { agent: director } = await login(ctx.app, { username: "director" });
    const refused = await director.post(`/api/registrations/${reg.id}/approve`);
    expect(refused.status).toBe(402);
    expect(refused.body.error).toBe("seat_refused");
    const trail = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    expect(
      trail.find((a) => a.action === "billing.seat_refused" && (a.details as Record<string, unknown>).via === "registration_approval"),
    ).toBeTruthy();
  });

  it("a past-due contract inside its 30-day grace changes NOTHING, including seats", async () => {
    await putOnContract({
      committedSeats: 1,
      status: "past_due",
      // Today-ish: well inside the grace window.
      pastDueAt: new Date(),
    });
    const ent = await seatEntitlementFor(ctx.storage, ctx.seedResult.orgId);
    expect(ent.warning, "the hospital is warned from day one").toBeTruthy();
    // Over the commitment, so the seat limit still bites — but NOT because of
    // the past-due state, which is still inside its grace period.
    expect(ent.reason).toBe("seat_limit_reached");

    // With room inside the commitment, a past-due hospital still adds accounts.
    await ctx.storage.updateOrgContract(ctx.seedResult.orgId, { committedSeats: 999 });
    const roomy = await seatEntitlementFor(ctx.storage, ctx.seedResult.orgId);
    expect(roomy.refused).toBe(false);
    expect(roomy.warning).toBeTruthy();
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.post("/api/director/hospitalists").send(newProvider("grace")).expect(201);
  });

  it("past the grace period, and on an expired contract, a new account is refused with the right reason", async () => {
    await putOnContract({
      committedSeats: 999,
      status: "past_due",
      pastDueAt: new Date(Date.now() - 45 * 86_400_000),
    });
    const lapsed = await seatEntitlementFor(ctx.storage, ctx.seedResult.orgId);
    expect(lapsed.refused).toBe(true);
    expect(lapsed.reason).toBe("contract_past_due");
    const { agent: director } = await login(ctx.app, { username: "director" });
    const res = await director.post("/api/director/hospitalists").send(newProvider("lapsed"));
    expect(res.status).toBe(402);
    expect(res.body.reason).toBe("contract_past_due");

    await ctx.storage.updateOrgContract(ctx.seedResult.orgId, {
      status: "active",
      pastDueAt: null,
      endDate: "2026-01-31",
    });
    const expired = await seatEntitlementFor(ctx.storage, ctx.seedResult.orgId);
    expect(expired.reason).toBe("contract_expired");
  });
});

describe("the paths that are never refused", () => {
  it("the OPERATOR always adds the account, and an over-limit add is audited in the tenant's trail", async () => {
    await putOnContract({ committedSeats: 1 });
    const { agent: dev } = await devLogin();
    const created = await dev.post("/api/dev/users").send({
      organizationId: ctx.seedResult.orgId,
      username: "operator.added",
      displayName: "Dr. Operator Added",
      role: "hospitalist",
    });
    expect(created.status, "the operator is never refused their own console").toBe(201);

    const trail = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    const override = trail.find((a) => a.action === "billing.seat_override");
    expect(override, "an over-limit add must be recorded in the hospital's trail").toBeTruthy();
    expect(override!.riskLevel).toBe("medium");
    expect(override!.details).toMatchObject({ via: "developer_console", reason: "seat_limit_reached" });
  });

  it("an identity provider (SCIM / SSO just-in-time) is never refused — the seats become an overage", async () => {
    await putOnContract({ committedSeats: 1 });
    const before = (await countBillableSeats(ctx.storage, ctx.seedResult.orgId)).total;
    const user = await provisionUser({
      organizationId: ctx.seedResult.orgId,
      username: "idp.pushed",
      displayName: "Dr. IdP Pushed",
      role: "hospitalist",
      source: "scim",
      actorUserId: null,
    });
    expect(user.id).toBeGreaterThan(0);
    const after = await seatEntitlementFor(ctx.storage, ctx.seedResult.orgId);
    expect(after.seatsInUse).toBe(before + 1);
    expect(after.overageSeats).toBe(after.seatsInUse - 1);
    expect(after.overageSeats).toBeGreaterThan(0);
  });
});

describe("creating an ORGANIZATION — the second and last entitlement place", () => {
  it("only the platform operator may create one; a director is refused", () => {
    expect(checkOrgCreationAllowed({ role: "developer" }, null)).toEqual({ allowed: true });
    const no = checkOrgCreationAllowed({ role: "director" }, null);
    expect(no.allowed).toBe(false);
    expect(no.allowed === false && no.reason).toBe("not_operator");
  });

  it("a new organization starts with no contract: unlimited and unbilled", async () => {
    const { agent: dev } = await devLogin();
    const created = await dev
      .post("/api/dev/organizations")
      .send({ name: "Brand New General", code: "BNEW" })
      .expect(201);
    const ent = await seatEntitlementFor(ctx.storage, created.body.id);
    expect(ent.unbilled).toBe(true);
    expect(ent.refused).toBe(false);
    expect(await ctx.storage.getOrgContract(created.body.id)).toBeUndefined();
  });
});

describe("the screens show the same computation the server enforces", () => {
  it("GET /api/billing carries the entitlement the account route would apply", async () => {
    const { seats } = await putOnContract({ committedSeats: 7 });
    const { agent: dev } = await devLogin();
    await dev
      .patch(`/api/dev/modules/${ctx.seedResult.orgId}`)
      .send({ id: "billing", enabled: true })
      .expect(200);
    invalidateModules();
    const { agent: director } = await login(ctx.app, { username: "director" });
    const screen = await director.get("/api/billing").expect(200);
    expect(screen.body.entitlement.seatsInUse).toBe(seats);
    expect(screen.body.entitlement.committedSeats).toBe(7);
    expect(screen.body.entitlement.refused).toBe(seats >= 7);
  });
});
