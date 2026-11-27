import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { generateInvoiceLines, invoiceCsvLines, peakSeatsIn } from "../server/billing/invoices.js";
import { runSeatSnapshotSweep } from "../server/billing/seats.js";
import { invalidateModules } from "../server/modules.js";

/**
 * Billing feature 4 — INVOICES, the manual path: complete and real on its own,
 * with no Stripe anywhere in it.
 *
 * The three rules this file is here to hold:
 *   • numbers are GAP-FREE and NEVER REUSED (allocated in the invoice's own
 *     transaction; a void keeps its number forever);
 *   • a line CITES the seat-snapshot dates it counted, so a hospital can audit
 *     "you charged me for 47 accounts on 3 March";
 *   • "Paid" is only ever the operator's own action (their user id, a
 *     timestamp, audited) or a Stripe event id — never a guess, never a mock.
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

async function onContract(committedSeats = 10, perSeatPriceCents = 1500) {
  const { agent: dev } = await devLogin();
  const plan = (
    await dev
      .post("/api/dev/billing/plans")
      .send({ code: "inv", name: "Invoice Test Plan", moduleIds: [], perSeatPriceCents, currency: "USD" })
      .expect(201)
  ).body.plan;
  await dev
    .put(`/api/dev/billing/contracts/${ctx.seedResult.orgId}`)
    .send({
      planId: plan.id,
      term: "monthly",
      startDate: "2026-03-01",
      endDate: null,
      committedSeats,
      status: "active",
      daysUntilDue: 30,
      poNumber: "PO-9",
      billingContactName: "A. Bursar",
      billingContactEmail: "billing@example.test",
    })
    .expect(200);
  return { dev, plan };
}

/** Snapshots for a period, with a deliberate peak. */
async function seedSnapshots(counts: Record<string, number>) {
  for (const [day, seatCount] of Object.entries(counts)) {
    await ctx.storage.upsertSeatSnapshot({
      organizationId: ctx.seedResult.orgId,
      snapshotDate: day,
      seatCount,
      breakdown: { hospitalist: seatCount },
      timezone: "America/New_York",
    });
  }
}

describe("generation is arithmetic on snapshots, never a guess", () => {
  it("the period's peak is the billable count, and every date that hit it is cited", () => {
    const rows = [
      { snapshotDate: "2026-03-01", seatCount: 40 },
      { snapshotDate: "2026-03-02", seatCount: 47 },
      { snapshotDate: "2026-03-03", seatCount: 47 },
      { snapshotDate: "2026-03-04", seatCount: 41 },
    ] as never[];
    const { peak, dates } = peakSeatsIn(rows);
    expect(peak).toBe(47);
    expect(dates).toEqual(["2026-03-02", "2026-03-03"]);
  });

  it("over-committed usage is a LINE, never a refusal, and the line cites the dates", () => {
    const gen = generateInvoiceLines(
      { committedSeats: 40, priceOverrideCents: null, term: "monthly" },
      { name: "Enterprise", perSeatPriceCents: 1500, currency: "USD" },
      [
        { snapshotDate: "2026-03-01", seatCount: 40 },
        { snapshotDate: "2026-03-02", seatCount: 47 },
      ] as never[],
    );
    expect(gen.lines).toHaveLength(2);
    expect(gen.lines[0]!.quantity).toBe(40);
    expect(gen.lines[0]!.amountCents).toBe(40 * 1500);
    expect(gen.lines[1]!.quantity).toBe(7);
    expect(gen.lines[1]!.citedDates).toEqual(["2026-03-02"]);
    expect(gen.lines[1]!.description).toContain("2026-03-02");
    expect(gen.totalCents).toBe(47 * 1500);
    // Integer cents only.
    for (const l of gen.lines) expect(Number.isInteger(l.amountCents)).toBe(true);
  });

  it("a price override replaces the plan's price for that hospital only", () => {
    const gen = generateInvoiceLines(
      { committedSeats: 10, priceOverrideCents: 999, term: "annual" },
      { name: "Enterprise", perSeatPriceCents: 1500, currency: "USD" },
      [{ snapshotDate: "2026-03-01", seatCount: 10 }] as never[],
    );
    expect(gen.lines[0]!.unitCents).toBe(999);
    expect(gen.totalCents).toBe(9990);
    expect(gen.lines[0]!.description).toContain("annual");
  });
});

describe("invoice numbers are gap-free and never reused", () => {
  it("numbers run in sequence, a void keeps its number, and the next one does not reuse it", async () => {
    const { dev } = await onContract(10);
    await seedSnapshots({ "2026-03-01": 10, "2026-03-02": 12 });

    const first = (
      await dev.post("/api/dev/billing/invoices").send({ orgId: ctx.seedResult.orgId, periodStart: "2026-03-01", periodEnd: "2026-03-31" }).expect(201)
    ).body.invoice;
    const second = (
      await dev.post("/api/dev/billing/invoices").send({ orgId: ctx.seedResult.orgId, periodStart: "2026-04-01", periodEnd: "2026-04-30" }).expect(409)
    ).body;
    expect(second.error, "no snapshot in April, so nothing to cite").toBe("no_snapshots");

    await seedSnapshots({ "2026-04-01": 11 });
    const third = (
      await dev.post("/api/dev/billing/invoices").send({ orgId: ctx.seedResult.orgId, periodStart: "2026-04-01", periodEnd: "2026-04-30" }).expect(201)
    ).body.invoice;

    expect(first.number).toBe("DT-000001");
    expect(third.number).toBe("DT-000002");

    // Voiding keeps the number; the next invoice still gets the next one.
    await dev.post(`/api/dev/billing/invoices/${first.id}/void`).send({ reason: "wrong period" }).expect(200);
    await seedSnapshots({ "2026-05-01": 10 });
    const fourth = (
      await dev.post("/api/dev/billing/invoices").send({ orgId: ctx.seedResult.orgId, periodStart: "2026-05-01", periodEnd: "2026-05-31" }).expect(201)
    ).body.invoice;
    expect(fourth.number).toBe("DT-000003");
    const voided = await ctx.storage.getInvoice(first.id);
    expect(voided!.number).toBe("DT-000001");
    expect(voided!.status).toBe("void");
  });

  it("concurrent generations never collide on a number", async () => {
    const { dev } = await onContract(10);
    await seedSnapshots({ "2026-03-01": 10, "2026-06-01": 10, "2026-07-01": 10 });
    const periods = [
      ["2026-03-01", "2026-03-31"],
      ["2026-06-01", "2026-06-30"],
      ["2026-07-01", "2026-07-31"],
    ];
    const made = await Promise.all(
      periods.map(([a, b]) =>
        dev.post("/api/dev/billing/invoices").send({ orgId: ctx.seedResult.orgId, periodStart: a, periodEnd: b }),
      ),
    );
    const numbers = made.map((r) => r.body.invoice.number).sort();
    expect(new Set(numbers).size).toBe(3);
    expect(numbers).toEqual(["DT-000001", "DT-000002", "DT-000003"]);
  });
});

describe("the lifecycle, and what 'paid' is allowed to mean", () => {
  it("draft → issued (due date from the net terms) → paid, with the operator recorded", async () => {
    const { dev } = await onContract(10);
    await seedSnapshots({ "2026-03-02": 12 });
    const draft = (
      await dev.post("/api/dev/billing/invoices").send({ orgId: ctx.seedResult.orgId, periodStart: "2026-03-01", periodEnd: "2026-03-31" }).expect(201)
    ).body.invoice;
    expect(draft.status).toBe("draft");
    expect(draft.issuedAt).toBe(null);

    // A draft is never downloadable by the hospital: it was issued to nobody.
    await dev.patch(`/api/dev/modules/${ctx.seedResult.orgId}`).send({ id: "billing", enabled: true }).expect(200);
    invalidateModules();
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.get(`/api/billing/invoices/${draft.id}/download`).expect(404);

    const issued = (await dev.post(`/api/dev/billing/invoices/${draft.id}/issue`).expect(200)).body.invoice;
    expect(issued.status).toBe("issued");
    expect(issued.issuedAt).toBeTruthy();
    expect(issued.dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Paying needs an issue first; a draft cannot be paid.
    await dev.post(`/api/dev/billing/invoices/${draft.id}/mark-paid`).send({}).expect(200);
    const paid = await ctx.storage.getInvoice(draft.id);
    expect(paid!.status).toBe("paid");
    expect(paid!.paidSource).toBe("operator");
    expect(paid!.paidByUserId).toBe(ctx.seedResult.userIds.dev);
    expect(paid!.paidAt).toBeTruthy();

    // A paid invoice can no longer be voided.
    await dev.post(`/api/dev/billing/invoices/${draft.id}/void`).send({ reason: "changed my mind" }).expect(409);

    // Every operator action is in the HOSPITAL's own trail at medium risk.
    const trail = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 80);
    for (const action of ["billing.invoice_create", "billing.invoice_issue", "billing.invoice_paid"]) {
      const row = trail.find((a) => a.action === action);
      expect(row, action).toBeTruthy();
      expect(row!.riskLevel).toBe("medium");
      expect(row!.organizationId).toBe(ctx.seedResult.orgId);
    }
  });

  it("a void needs a reason, and an issued invoice is never recomputed", async () => {
    const { dev } = await onContract(10);
    await seedSnapshots({ "2026-03-02": 12 });
    const inv = (
      await dev.post("/api/dev/billing/invoices").send({ orgId: ctx.seedResult.orgId, periodStart: "2026-03-01", periodEnd: "2026-03-31" }).expect(201)
    ).body.invoice;
    await dev.post(`/api/dev/billing/invoices/${inv.id}/void`).send({}).expect(400);
    await dev.post(`/api/dev/billing/invoices/${inv.id}/issue`).expect(200);
    const before = await ctx.storage.getInvoice(inv.id);

    // The contract's price changes mid-term. The ISSUED invoice is untouched —
    // proration lands on the NEXT invoice, never retroactively.
    await ctx.storage.updateOrgContract(ctx.seedResult.orgId, { priceOverrideCents: 9900 });
    const after = await ctx.storage.getInvoice(inv.id);
    expect(after!.totalCents).toBe(before!.totalCents);
    expect(after!.lines).toEqual(before!.lines);

    await seedSnapshots({ "2026-04-02": 12 });
    const next = (
      await dev.post("/api/dev/billing/invoices").send({ orgId: ctx.seedResult.orgId, periodStart: "2026-04-01", periodEnd: "2026-04-30" }).expect(201)
    ).body.invoice;
    expect(next.lines[0].unitCents, "the NEXT invoice carries the new price").toBe(9900);

    // Issuing twice is refused, not silently re-done.
    await dev.post(`/api/dev/billing/invoices/${inv.id}/issue`).expect(409);
  });

  it("a hospital with no contract cannot be invoiced, and the platform org never", async () => {
    const { agent: dev } = await devLogin();
    const bare = await ctx.storage.createOrganization({
      name: "Bare General", code: "BARE", city: null, state: null, timezone: "UTC",
      assignmentTimeoutMin: 10, roundRobinShiftTypes: ["day"], rotationMode: "lowest_census", rotationIndex: 0,
    });
    await dev
      .post("/api/dev/billing/invoices")
      .send({ orgId: bare.id, periodStart: "2026-03-01", periodEnd: "2026-03-31" })
      .expect(409);
    await dev
      .post("/api/dev/billing/invoices")
      .send({ orgId: ctx.seedResult.platformOrgId, periodStart: "2026-03-01", periodEnd: "2026-03-31" })
      .expect(409);
  });
});

describe("the hospital's own view and download", () => {
  it("the director sees their issued invoices and downloads one as PHI-free CSV", async () => {
    const { dev } = await onContract(10);
    await runSeatSnapshotSweep(new Date("2026-03-03T12:00:00Z"));
    const inv = (
      await dev.post("/api/dev/billing/invoices").send({ orgId: ctx.seedResult.orgId, periodStart: "2026-03-01", periodEnd: "2026-03-31" }).expect(201)
    ).body.invoice;
    await dev.post(`/api/dev/billing/invoices/${inv.id}/issue`).expect(200);
    await dev.patch(`/api/dev/modules/${ctx.seedResult.orgId}`).send({ id: "billing", enabled: true }).expect(200);
    invalidateModules();

    const { agent: director } = await login(ctx.app, { username: "director" });
    const screen = await director.get("/api/billing").expect(200);
    expect(screen.body.invoices).toHaveLength(1);
    expect(screen.body.invoices[0].number).toBe(inv.number);

    const csv = await director.get(`/api/billing/invoices/${inv.id}/download`).expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain(inv.number);
    expect(csv.text).toContain("invoice_number");
    expect(csv.text).toContain(inv.number);
    expect(csv.text).toContain("TOTAL");
    // PHI-free: no patient initials, room, complaint or clinician's note.
    expect(csv.text).not.toMatch(/Sarah Chen|abdominal|Room|complaint/i);
    // The download is audited in the hospital's own trail.
    const trail = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    expect(trail.find((a) => a.action === "billing.invoice_download")).toBeTruthy();
  });

  it("a director can never download another tenant's invoice", async () => {
    const { dev } = await onContract(10);
    const other = await ctx.storage.createOrganization({
      name: "Other General", code: "OTH3", city: null, state: null, timezone: "UTC",
      assignmentTimeoutMin: 10, roundRobinShiftTypes: ["day"], rotationMode: "lowest_census", rotationIndex: 0,
    });
    const plan = (await dev.get("/api/dev/billing/plans").expect(200)).body.plans[0];
    await dev
      .put(`/api/dev/billing/contracts/${other.id}`)
      .send({ planId: plan.id, term: "monthly", startDate: "2026-03-01", committedSeats: 5, status: "active" })
      .expect(200);
    await ctx.storage.upsertSeatSnapshot({
      organizationId: other.id, snapshotDate: "2026-03-02", seatCount: 5,
      breakdown: { hospitalist: 5 }, timezone: "UTC",
    });
    const theirs = (
      await dev.post("/api/dev/billing/invoices").send({ orgId: other.id, periodStart: "2026-03-01", periodEnd: "2026-03-31" }).expect(201)
    ).body.invoice;
    await dev.post(`/api/dev/billing/invoices/${theirs.id}/issue`).expect(200);
    await dev.patch(`/api/dev/modules/${ctx.seedResult.orgId}`).send({ id: "billing", enabled: true }).expect(200);
    invalidateModules();

    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.get(`/api/billing/invoices/${theirs.id}/download`).expect(404);
    const mine = await director.get("/api/billing").expect(200);
    expect(JSON.stringify(mine.body)).not.toContain(theirs.number);
  });

  it("the CSV generator writes a header, a line per invoice line and a total", () => {
    const out = [
      ...invoiceCsvLines(
        {
          number: "DT-000007",
          status: "issued",
          periodStart: "2026-03-01",
          periodEnd: "2026-03-31",
          issuedAt: new Date("2026-04-01T00:00:00Z"),
          dueOn: "2026-05-01",
          paidAt: null,
          lines: [
            { description: "Committed", quantity: 10, unitCents: 1500, amountCents: 15000, citedDates: [] },
            { description: "Extra", quantity: 2, unitCents: 1500, amountCents: 3000, citedDates: ["2026-03-02"] },
          ],
          totalCents: 18000,
          currency: "USD",
        } as never,
        { orgName: "Example General" },
      ),
    ].join("");
    expect(out.split("\r\n").filter(Boolean)).toHaveLength(4);
    expect(out).toContain('"DT-000007"');
    expect(out).toContain('"2026-03-02"');
    expect(out).toContain('"TOTAL"');
  });
});

describe("tenant delete keeps the invoices and drops the seat history", () => {
  it("invoices are archived to the platform's retained store; snapshots and the contract go", async () => {
    const { dev } = await onContract(10);
    await seedSnapshots({ "2026-03-02": 12 });
    const inv = (
      await dev.post("/api/dev/billing/invoices").send({ orgId: ctx.seedResult.orgId, periodStart: "2026-03-01", periodEnd: "2026-03-31" }).expect(201)
    ).body.invoice;
    await dev.post(`/api/dev/billing/invoices/${inv.id}/issue`).expect(200);
    await dev.post(`/api/dev/billing/invoices/${inv.id}/mark-paid`).send({ reference: "cheque 118" }).expect(200);

    const orgId = ctx.seedResult.orgId;
    await dev.delete(`/api/dev/organizations/${orgId}?force=true`).expect(204);

    expect(await ctx.storage.getOrganization(orgId)).toBeUndefined();
    expect(await ctx.storage.listOrgInvoices(orgId, 10)).toEqual([]);
    expect(await ctx.storage.listSeatSnapshots(orgId, 10)).toEqual([]);
    expect(await ctx.storage.getOrgContract(orgId)).toBeUndefined();

    const retained = await ctx.storage.listRetainedInvoices(orgId);
    expect(retained, "a financial record must outlive the tenant").toHaveLength(1);
    expect(retained[0]!.number).toBe(inv.number);
    expect(retained[0]!.status).toBe("paid");
    expect(retained[0]!.paidReference).toBe("cheque 118");
    expect(retained[0]!.organizationCode).toBe("ISPN");
  });
});

describe("a period is invoiced once", () => {
  it("a second invoice overlapping a live one is refused; voiding the first lets the period be re-billed", async () => {
    const { dev } = await onContract(10);
    await seedSnapshots({ "2026-05-01": 10, "2026-05-15": 12 });
    const org = ctx.seedResult.orgId;
    const first = (
      await dev.post("/api/dev/billing/invoices").send({ orgId: org, periodStart: "2026-05-01", periodEnd: "2026-05-31" }).expect(201)
    ).body.invoice;

    // The same period, and one that merely overlaps it, are both refused —
    // while the first is a draft, and again once it is issued.
    for (const period of [
      { periodStart: "2026-05-01", periodEnd: "2026-05-31" },
      { periodStart: "2026-05-15", periodEnd: "2026-06-14" },
    ]) {
      const dup = await dev.post("/api/dev/billing/invoices").send({ orgId: org, ...period });
      expect(dup.status).toBe(409);
      expect(dup.body.error).toBe("period_already_invoiced");
      expect(dup.body.invoice.number).toBe(first.number);
      expect(dup.body.message).toContain(first.number);
    }
    await dev.post(`/api/dev/billing/invoices/${first.id}/issue`).send({}).expect(200);
    const afterIssue = await dev.post("/api/dev/billing/invoices").send({ orgId: org, periodStart: "2026-05-01", periodEnd: "2026-05-31" });
    expect(afterIssue.status).toBe(409);
    expect((await ctx.storage.listOrgInvoices(org)).length).toBe(1);

    // Voiding is how a period is corrected: after it, the period can be billed again.
    await dev.post(`/api/dev/billing/invoices/${first.id}/void`).send({ reason: "wrong seat count" }).expect(200);
    const rebill = await dev.post("/api/dev/billing/invoices").send({ orgId: org, periodStart: "2026-05-01", periodEnd: "2026-05-31" });
    expect(rebill.status).toBe(201);
    expect(rebill.body.invoice.number).not.toBe(first.number);
  });
});
