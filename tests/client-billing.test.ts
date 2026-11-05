import { afterEach, describe, expect, it } from "vitest";
import { boot, closeAll, count, until, sleep, type Harness } from "./client-parity-harness.js";

/**
 * Billing feature 5, client half — the REAL web client (webapp/store.js +
 * webapp/api-bridge.js) in jsdom against a scripted backend.
 *
 * What this proves, and what the OLD client fails (run with
 * CLIENT_SRC_ROOT=<a checkout at the previous commit>):
 *
 *   • the billing slices do not exist before the server answers, and the
 *     client does not even ASK while the module is off;
 *   • a module refusal ({error:"module_disabled"}) clears the slice and makes
 *     the client re-read GET /api/modules at once, so the Billing tab
 *     disappears instead of lying for a minute;
 *   • the director's screen shows ONLY what the server sent — no invented
 *     plan, no invented invoice, no "Paid" the server did not report;
 *   • the billing contact is a server write, and the screen reloads from the
 *     server afterwards rather than trusting its own optimism;
 *   • an invoice download is a real file from the real route;
 *   • SIGN-OUT clears every billing slice, and none of them is persisted —
 *     the next person on a shared ward workstation sees nothing of the
 *     previous hospital's money.
 */

const DIRECTOR = { id: 31, username: "dir", displayName: "Dr. D. Rector", role: "director", credential: "MD", organizationId: 1 };

const SERVER_BILLING = {
  orgId: 1,
  contract: {
    id: 9, planId: 4, term: "monthly", startDate: "2026-01-01", endDate: null,
    committedSeats: 40, poNumber: "PO-2026-114",
    billingContactName: "A. Bursar", billingContactEmail: "billing@example.test",
    status: "active", pastDueAt: null, daysUntilDue: 30,
  },
  plan: { id: 4, code: "enterprise", name: "Enterprise", moduleIds: ["enterprise.sso"], perSeatPriceCents: 1800, currency: "USD" },
  view: { status: "active", warning: null, pastDueSince: null, graceEndsOn: null, graceDaysLeft: null, seatsRefused: false, committedSeats: 40 },
  billed: true,
  perSeatCents: 1800,
  currency: "USD",
  seats: { live: { total: 41, byRole: { hospitalist: 38, director: 3 } }, snapshot: { snapshotDate: "2026-03-03", seatCount: 47, timezone: "America/New_York" } },
  entitlement: { seatsInUse: 41, committedSeats: 40, overageSeats: 1, refused: true, reason: "seat_limit_reached", message: "…", warning: null, unbilled: false },
  invoices: [
    { id: 71, number: "DT-000071", periodStart: "2026-02-01", periodEnd: "2026-02-28", currency: "USD",
      lines: [{ description: "Enterprise — committed accounts (monthly)", quantity: 40, unitCents: 1800, amountCents: 72000, citedDates: [] }],
      subtotalCents: 72000, totalCents: 72000, status: "paid", issuedAt: "2026-03-01T00:00:00.000Z",
      dueOn: "2026-03-31", paidAt: "2026-03-10T00:00:00.000Z", paidSource: "operator", paidReference: "cheque 118",
      stripeInvoiceId: null, voidReason: null },
  ],
  notice: null,
  collection: { via: "manual", note: "Invoices are issued and marked paid by the DocTurn operator by hand. Nothing is charged automatically." },
  prorationNote: "A mid-term plan change is prorated on your NEXT invoice. Invoices already issued are never changed.",
};

afterEach(() => closeAll());

async function bootDirector(modules: Record<string, boolean>): Promise<Harness> {
  const h = await boot({ user: DIRECTOR, modules });
  return h;
}

describe("the hospital's billing screen asks for nothing it is not entitled to", () => {
  it("with the module off the client never calls /api/billing and the slice stays null", async () => {
    const h = await bootDirector({ billing: false });
    await h.w.DT.actions.loadBilling();
    await sleep(30);
    expect(h.state().billing).toBe(null);
    expect(count(h, "GET", "/api/billing")).toBe(0);
  });

  it("with the module on it loads, and shows only what the server sent", async () => {
    const h = await bootDirector({ billing: true });
    h.routes.billing = (req) => (req.method === "GET" && req.path === "/api/billing" ? { status: 200, body: SERVER_BILLING } : undefined);
    await h.w.DT.actions.loadBilling();
    await until(() => !!h.state().billing);
    const b = h.state().billing;
    expect(b.plan.name).toBe("Enterprise");
    expect(b.seats.live.total).toBe(41);
    // The SNAPSHOT DATE is carried through — an invoice line cites it.
    expect(b.seats.snapshot.snapshotDate).toBe("2026-03-03");
    expect(b.invoices).toHaveLength(1);
    // "Paid" keeps the server's SOURCE; the client never invents one.
    expect(b.invoices[0].paidSource).toBe("operator");
    expect(b.invoices[0].paidReference).toBe("cheque 118");
    expect(b.collection.via).toBe("manual");
    // Nothing is added locally.
    expect(Object.keys(b).sort()).toEqual(Object.keys(SERVER_BILLING).sort());
  });

  it("a refusal clears the slice and re-reads the module map at once", async () => {
    const h = await bootDirector({ billing: true });
    h.routes.billing = (req) =>
      req.path === "/api/billing" ? { status: 404, body: { error: "module_disabled", module: "billing" } } : undefined;
    const before = count(h, "GET", "/api/modules");
    await h.w.DT.actions.loadBilling();
    await until(() => count(h, "GET", "/api/modules") > before);
    expect(h.state().billing).toBe(null);
  });
});

describe("the billing contact is a server write", () => {
  it("PATCHes the server and then re-reads it, instead of trusting itself", async () => {
    const h = await bootDirector({ billing: true });
    let stored = { ...SERVER_BILLING };
    h.routes.billing = (req) => {
      if (req.method === "GET" && req.path === "/api/billing") return { status: 200, body: stored };
      if (req.method === "PATCH" && req.path === "/api/billing/contact") {
        stored = {
          ...stored,
          contract: { ...stored.contract, billingContactName: req.body.billingContactName, billingContactEmail: req.body.billingContactEmail },
        };
        return { status: 200, body: { contract: stored.contract } };
      }
      return undefined;
    };
    await h.w.DT.actions.loadBilling();
    await until(() => !!h.state().billing);
    await h.w.DT.actions.saveBillingContact({ billingContactName: "B. Ledger", billingContactEmail: "ap@example.test" });
    await until(() => h.state().billing && h.state().billing.contract.billingContactName === "B. Ledger");
    expect(count(h, "PATCH", "/api/billing/contact")).toBe(1);
    // It re-read the screen from the server after the write.
    expect(count(h, "GET", "/api/billing")).toBeGreaterThanOrEqual(2);
    expect(h.state().__toast.tone).toBe("accepted");
  });

  it("a refused save leaves the screen exactly as the server last described it", async () => {
    const h = await bootDirector({ billing: true });
    h.routes.billing = (req) => {
      if (req.method === "GET" && req.path === "/api/billing") return { status: 200, body: SERVER_BILLING };
      if (req.method === "PATCH" && req.path === "/api/billing/contact") return { status: 409, body: { error: "no_contract" } };
      return undefined;
    };
    await h.w.DT.actions.loadBilling();
    await until(() => !!h.state().billing);
    await h.w.DT.actions.saveBillingContact({ billingContactName: "Nope" });
    await until(() => h.state().__toast && h.state().__toast.tone === "rejected");
    expect(h.state().billing.contract.billingContactName).toBe("A. Bursar");
  });
});

describe("an invoice download is the server's own file", () => {
  it("downloads the CSV the route served, named as the server named it", async () => {
    const h = await bootDirector({ billing: true });
    h.routes.billing = (req) => {
      if (req.method === "GET" && req.path === "/api/billing") return { status: 200, body: SERVER_BILLING };
      if (req.path === "/api/billing/invoices/71/download") {
        return {
          status: 200,
          text: '"invoice_number"\r\n"DT-000071"\r\n',
          headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="docturn-invoice-DT-000071.csv"' },
        };
      }
      return undefined;
    };
    await h.w.DT.actions.loadBilling();
    await until(() => !!h.state().billing);
    await h.w.DT.actions.downloadInvoice(71);
    await until(() => h.downloads.length > 0);
    expect(h.downloads[0]).toBe("docturn-invoice-DT-000071.csv");
  });

  it("a refused download says so and downloads nothing", async () => {
    const h = await bootDirector({ billing: true });
    h.routes.billing = (req) =>
      /\/download$/.test(req.path) ? { status: 404, body: { error: "not_found" } } : undefined;
    await h.w.DT.actions.downloadInvoice(999);
    await until(() => h.state().__toast && h.state().__toast.tone === "rejected");
    expect(h.downloads).toEqual([]);
  });
});

describe("nothing of a hospital's money survives a sign-out", () => {
  it("every billing slice is cleared on sign-out and none is persisted", async () => {
    const h = await bootDirector({ billing: true });
    h.routes.billing = (req) => (req.path === "/api/billing" ? { status: 200, body: SERVER_BILLING } : undefined);
    h.routes.dev = (req) => {
      if (req.path === "/api/dev/billing/contracts") return { status: 200, body: { tenants: [], totals: { tenants: 0, committedTotalCents: 0 } } };
      if (req.path === "/api/dev/billing/plans") return { status: 200, body: { plans: [] } };
      if (req.path === "/api/dev/billing/invoices") return { status: 200, body: { invoices: [] } };
      return undefined;
    };
    await h.w.DT.actions.loadBilling();
    await h.w.DT.actions.loadDevBilling();
    await until(() => !!h.state().billing && !!h.state().devBilling);

    // Nothing billing-shaped is in localStorage at any point.
    const saved = h.w.localStorage.getItem("docturn.v1") || h.w.localStorage.getItem("docturn") || "";
    const allKeys = Object.keys(h.w.localStorage).map((k) => h.w.localStorage.getItem(k) || "").join("\n") + saved;
    expect(allKeys).not.toMatch(/PO-2026-114|DT-000071|committedSeats/);

    await h.w.DT.actions.logout();
    await sleep(40);
    expect(h.state().billing).toBe(null);
    expect(h.state().devBilling).toBe(null);
  });
});

describe("the operator's console reads every tenant from the server", () => {
  it("loads tenants, plans and invoices together, and a write re-reads all three", async () => {
    const h = await bootDirector({ billing: true });
    let contracts = {
      tenants: [
        {
          orgId: 1, orgCode: "ISPN", orgName: "Inspira", timezone: "America/New_York",
          contract: SERVER_BILLING.contract, plan: SERVER_BILLING.plan, view: SERVER_BILLING.view,
          seats: SERVER_BILLING.seats, perSeatCents: 1800, monthlyCents: 73800, overageSeats: 1,
        },
      ],
      totals: { tenants: 1, committedTotalCents: 73800 },
    };
    h.routes.dev = (req) => {
      if (req.path === "/api/dev/billing/contracts") return { status: 200, body: contracts };
      if (req.path === "/api/dev/billing/plans") return { status: 200, body: { plans: [{ ...SERVER_BILLING.plan, archived: false, contracts: 1 }] } };
      if (req.path === "/api/dev/billing/invoices") return { status: 200, body: { invoices: SERVER_BILLING.invoices.map((i) => ({ ...i, orgId: 1, orgCode: "ISPN", orgName: "Inspira" })) } };
      if (req.method === "PUT" && req.path === "/api/dev/billing/contracts/1") {
        contracts = { ...contracts, tenants: [{ ...contracts.tenants[0], contract: { ...contracts.tenants[0]!.contract, committedSeats: req.body.committedSeats } }] } as typeof contracts;
        return { status: 200, body: { contract: contracts.tenants[0]!.contract } };
      }
      return undefined;
    };
    await h.w.DT.actions.loadDevBilling();
    await until(() => !!h.state().devBilling);
    expect(h.state().devBilling.tenants).toHaveLength(1);
    expect(h.state().devBilling.plans).toHaveLength(1);
    expect(h.state().devBilling.invoices).toHaveLength(1);
    expect(h.state().devBilling.totals.committedTotalCents).toBe(73800);

    await h.w.DT.actions.saveDevContract(1, { planId: 4, term: "monthly", startDate: "2026-01-01", committedSeats: 50, status: "active" });
    await until(() => h.state().devBilling && h.state().devBilling.tenants[0].contract.committedSeats === 50);
    expect(count(h, "GET", "/api/dev/billing/contracts")).toBeGreaterThanOrEqual(2);
  });

  it("a refused operator write says so and leaves the console as the server described it", async () => {
    const h = await bootDirector({ billing: true });
    h.routes.dev = (req) => {
      if (req.path === "/api/dev/billing/contracts" && req.method === "GET") return { status: 200, body: { tenants: [], totals: { tenants: 0, committedTotalCents: 0 } } };
      if (req.path === "/api/dev/billing/plans" && req.method === "GET") return { status: 200, body: { plans: [] } };
      if (req.path === "/api/dev/billing/invoices" && req.method === "GET") return { status: 200, body: { invoices: [] } };
      if (req.method === "POST" && req.path === "/api/dev/billing/plans") return { status: 400, body: { error: "validation_error" } };
      return undefined;
    };
    await h.w.DT.actions.loadDevBilling();
    await until(() => !!h.state().devBilling);
    const out = await h.w.DT.actions.createBillingPlan({ code: "x", name: "X", perSeatPriceCents: 1.5, currency: "USD", moduleIds: [] });
    expect(out).toBe(null);
    await until(() => h.state().__toast && h.state().__toast.tone === "rejected");
    expect(h.state().devBilling.plans).toEqual([]);
    expect(h.state().devBilling.busy).toBe(false);
  });
});
