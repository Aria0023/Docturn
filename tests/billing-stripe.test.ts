import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { fakeStripeSecretKey, fakeStripeWebhookSecret, startStripeStub, type StripeStub } from "./fixtures/stripe-stub.js";
import {
  STRIPE_HANDLED_EVENTS,
} from "../server/routes/stripe-webhook.js";
import {
  buildStripePayload,
  projectStripePayload,
  StripePayloadRefused,
} from "../server/billing/stripe-payload.js";
import { parseStripeSignatureHeader, stripeSignatureHeaderFor, verifyStripeSignature } from "../server/billing/stripe-webhook-verify.js";
import { stripeForm } from "../server/billing/stripe.js";
import { invalidateModules } from "../server/modules.js";

/**
 * Billing feature 6 — STRIPE, the collection rail.
 *
 * There is no Stripe key in this repository and there never will be:
 * everything below runs against a LOCAL Stripe-shaped stub
 * (tests/fixtures/stripe-stub.ts), which records every request body so what
 * actually went over the wire can be asserted — not just what the payload
 * builder would have produced.
 *
 * Ports 9300-9349 only.
 */

const STUB_PORT = 9311;
let stub: StripeStub;
let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
  invalidateModules();
  process.env.STRIPE_SECRET_KEY = fakeStripeSecretKey();
  process.env.STRIPE_WEBHOOK_SECRET = fakeStripeWebhookSecret();
  if (!stub) stub = await startStripeStub(STUB_PORT);
  stub.requests.length = 0;
  process.env.STRIPE_API_BASE = stub.baseUrl;
});
afterEach(async () => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_API_BASE;
  await ctx.handle.close();
});
afterAll(async () => {
  if (stub) await stub.close();
});

const devLogin = () => login(ctx.app, { orgCode: "DOCTURN", username: "dev" });

async function issuedInvoice(opts: { emailOptIn?: boolean; stripeOn?: boolean } = {}) {
  const { agent: dev } = await devLogin();
  const plan = (
    await dev
      .post("/api/dev/billing/plans")
      .send({ code: "stripe", name: "Stripe Test Plan", moduleIds: [], perSeatPriceCents: 1500, currency: "USD" })
      .expect(201)
  ).body.plan;
  await dev
    .put(`/api/dev/billing/contracts/${ctx.seedResult.orgId}`)
    .send({
      planId: plan.id,
      term: "monthly",
      startDate: "2026-03-01",
      committedSeats: 10,
      status: "active",
      daysUntilDue: 30,
      poNumber: "PO-2026-77",
      billingContactName: "A. Bursar",
      billingContactEmail: "billing@example.test",
      stripeSendInvoiceEmail: !!opts.emailOptIn,
    })
    .expect(200);
  await ctx.storage.upsertSeatSnapshot({
    organizationId: ctx.seedResult.orgId,
    snapshotDate: "2026-03-02",
    seatCount: 12,
    breakdown: { hospitalist: 12 },
    timezone: "America/New_York",
  });
  await dev.patch(`/api/dev/modules/${ctx.seedResult.orgId}`).send({ id: "billing", enabled: true }).expect(200);
  if (opts.stripeOn !== false) {
    await dev.patch(`/api/dev/modules/${ctx.seedResult.orgId}`).send({ id: "billing.stripe", enabled: true }).expect(200);
  }
  invalidateModules();
  const inv = (
    await dev
      .post("/api/dev/billing/invoices")
      .send({ orgId: ctx.seedResult.orgId, periodStart: "2026-03-01", periodEnd: "2026-03-31" })
      .expect(201)
  ).body.invoice;
  await dev.post(`/api/dev/billing/invoices/${inv.id}/issue`).expect(200);
  return { dev, invoice: inv, plan };
}

describe("the payload allow-list — enforcement, not intention", () => {
  it("keeps only billing fields and REFUSES anything else, naming the key", () => {
    const projected = projectStripePayload("customer", {
      name: "Example General",
      email: "billing@example.test",
      // Everything below is outside the list and must be refused.
      patientName: "Sarah Chen",
      roomNumber: "412",
      chiefComplaint: "chest pain",
      mrn: "000123",
      metadata: { docturn_org_id: 7, patient_initials: "SC" },
    });
    expect(projected.kept.name).toBe("Example General");
    expect(projected.kept.email).toBe("billing@example.test");
    expect(projected.kept.metadata).toEqual({ docturn_org_id: "7" });
    expect(projected.refused.sort()).toEqual(
      ["chiefComplaint", "metadata.patient_initials", "mrn", "patientName", "roomNumber"].sort(),
    );
  });

  it("buildStripePayload THROWS on any refused field, so nothing can slip to the network", () => {
    expect(() => buildStripePayload("invoice", { customer: "cus_1", chiefComplaint: "chest pain" })).toThrow(
      StripePayloadRefused,
    );
    try {
      buildStripePayload("invoice_item", { customer: "cus_1", patientId: 12, note: "see chart" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(StripePayloadRefused);
      expect((e as StripePayloadRefused).refused).toEqual(["note", "patientId"]);
    }
    // A nested object under an allowed SCALAR key is never sent either.
    expect(() => buildStripePayload("customer", { name: { first: "x" } })).toThrow(StripePayloadRefused);
  });

  it("form-encodes metadata the way Stripe expects", () => {
    const form = stripeForm({ customer: "cus_1", quantity: 2, metadata: { docturn_org_id: "7" } });
    expect(form).toContain("customer=cus_1");
    expect(form).toContain("quantity=2");
    expect(form).toContain("metadata%5Bdocturn_org_id%5D=7");
  });
});

describe("signature verification", () => {
  const SECRET = fakeStripeWebhookSecret();
  const body = '{"id":"evt_1","type":"invoice.paid"}';

  it("accepts a correct signature and rejects every way it can be wrong", () => {
    const now = 1_800_000_000;
    expect(verifyStripeSignature(body, stripeSignatureHeaderFor(body, SECRET, now), SECRET, now).ok).toBe(true);
    expect(verifyStripeSignature(body, undefined, SECRET, now)).toEqual({ ok: false, reason: "no_signature" });
    expect(verifyStripeSignature(body, "nonsense", SECRET, now)).toEqual({ ok: false, reason: "malformed_signature" });
    // A different secret.
    expect(verifyStripeSignature(body, stripeSignatureHeaderFor(body, "other", now), SECRET, now)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    // The body changed after signing.
    expect(verifyStripeSignature(body + " ", stripeSignatureHeaderFor(body, SECRET, now), SECRET, now)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    // A replay from more than the tolerance ago.
    expect(verifyStripeSignature(body, stripeSignatureHeaderFor(body, SECRET, now - 400), SECRET, now)).toEqual({
      ok: false,
      reason: "timestamp_out_of_tolerance",
    });
  });

  it("accepts EITHER v1 in the header, as Stripe sends during a secret rotation", () => {
    const now = 1_800_000_000;
    const mine = stripeSignatureHeaderFor(body, SECRET, now).split("v1=")[1]!;
    const theirs = stripeSignatureHeaderFor(body, "rotating", now).split("v1=")[1]!;
    const header = `t=${now},v1=${theirs},v1=${mine}`;
    expect(parseStripeSignatureHeader(header).v1).toHaveLength(2);
    expect(verifyStripeSignature(body, header, SECRET, now).ok).toBe(true);
  });
});

describe("pushing an invoice to Stripe", () => {
  it("creates a customer, an item per line and a send_invoice invoice — and sends ONLY billing data", async () => {
    const { dev, invoice } = await issuedInvoice();
    const pushed = await dev.post(`/api/dev/billing/invoices/${invoice.id}/stripe`).expect(200);
    expect(pushed.body.stripeInvoiceId).toMatch(/^in_stub/);
    expect(pushed.body.emailed, "outbound email is OFF unless the contract opted in").toBe(false);

    const paths = stub.requests.map((r) => r.path);
    expect(paths).toContain("/v1/customers");
    expect(paths.filter((p) => p === "/v1/invoiceitems")).toHaveLength(invoice.lines.length);
    expect(paths).toContain("/v1/invoices");
    expect(paths.some((p) => /\/finalize$/.test(p))).toBe(true);
    // No Stripe SUBSCRIPTION object is ever created.
    expect(paths.some((p) => p.includes("subscription"))).toBe(false);

    const invoiceReq = stub.requests.find((r) => r.path === "/v1/invoices")!;
    expect(invoiceReq.form.collection_method).toBe("send_invoice");
    expect(invoiceReq.form.days_until_due).toBe("30");
    expect(invoiceReq.form.auto_advance).toBe("false");
    expect(invoiceReq.form["metadata[po_number]"]).toBe("PO-2026-77");
    expect(invoiceReq.form["metadata[docturn_invoice_number]"]).toBe(invoice.number);

    // EVERY field of EVERY request is a billing field. Nothing clinical, no
    // patient, no room, no note, no message, no initials.
    const allValues = stub.requests.flatMap((r) => Object.entries(r.form).map(([k, v]) => k + "=" + v)).join("\n");
    expect(allValues).not.toMatch(/patient|mrn|room|complaint|diagnos|note|message|initials/i);

    // Audited in the hospital's own trail, saying whether Stripe will email.
    const trail = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 60);
    const row = trail.find((a) => a.action === "billing.stripe_push");
    expect(row).toBeTruthy();
    expect(row!.details).toMatchObject({ emailOptIn: false });
  });

  it("the per-contract email opt-in is the ONLY thing that lets Stripe email the hospital", async () => {
    const { dev, invoice } = await issuedInvoice({ emailOptIn: true });
    const pushed = await dev.post(`/api/dev/billing/invoices/${invoice.id}/stripe`).expect(200);
    expect(pushed.body.emailed).toBe(true);
    const invoiceReq = stub.requests.find((r) => r.path === "/v1/invoices")!;
    expect(invoiceReq.form.auto_advance).toBe("true");
  });

  it("refuses when the module is off, when the invoice is not issued, and twice over", async () => {
    const { dev, invoice } = await issuedInvoice({ stripeOn: false });
    const off = await dev.post(`/api/dev/billing/invoices/${invoice.id}/stripe`);
    expect(off.status).toBe(409);
    expect(off.body.error).toBe("module_disabled");

    await dev.patch(`/api/dev/modules/${ctx.seedResult.orgId}`).send({ id: "billing.stripe", enabled: true }).expect(200);
    invalidateModules();
    await dev.post(`/api/dev/billing/invoices/${invoice.id}/stripe`).expect(200);
    const again = await dev.post(`/api/dev/billing/invoices/${invoice.id}/stripe`);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("already_pushed");
  });

  it("reuses the one Stripe Customer per hospital", async () => {
    const { dev, invoice } = await issuedInvoice();
    await dev.post(`/api/dev/billing/invoices/${invoice.id}/stripe`).expect(200);
    const customerCalls = stub.requests.filter((r) => r.path === "/v1/customers").length;
    expect(customerCalls).toBe(1);
    const contract = await ctx.storage.getOrgContract(ctx.seedResult.orgId);
    expect(contract!.stripeCustomerId).toMatch(/^cus_stub/);

    // A second invoice does not create a second customer.
    await ctx.storage.upsertSeatSnapshot({
      organizationId: ctx.seedResult.orgId, snapshotDate: "2026-04-02", seatCount: 12,
      breakdown: { hospitalist: 12 }, timezone: "America/New_York",
    });
    const second = (
      await dev.post("/api/dev/billing/invoices").send({ orgId: ctx.seedResult.orgId, periodStart: "2026-04-01", periodEnd: "2026-04-30" }).expect(201)
    ).body.invoice;
    await dev.post(`/api/dev/billing/invoices/${second.id}/issue`).expect(200);
    await dev.post(`/api/dev/billing/invoices/${second.id}/stripe`).expect(200);
    expect(stub.requests.filter((r) => r.path === "/v1/customers")).toHaveLength(1);
  });
});

describe("webhooks", () => {
  /** POST at the in-process app (no network server needed). */
  function deliver(event: Record<string, unknown>, opts: { secret?: string; timestamp?: number; signature?: string | null } = {}) {
    const raw = JSON.stringify(event);
    const header =
      opts.signature !== undefined
        ? opts.signature
        : stripeSignatureHeaderFor(raw, opts.secret ?? fakeStripeWebhookSecret(), opts.timestamp ?? Math.floor(Date.now() / 1000));
    const req = supertest(ctx.app)
      .post("/webhooks/stripe")
      .set("content-type", "application/json");
    if (header) req.set("stripe-signature", header);
    return req.send(raw);
  }

  it("handles only the three documented types", () => {
    expect([...STRIPE_HANDLED_EVENTS]).toEqual(["invoice.paid", "invoice.payment_failed", "invoice.voided"]);
  });

  it("an unsigned, mis-signed or stale delivery changes NOTHING and answers one shape", async () => {
    const { dev, invoice } = await issuedInvoice();
    await dev.post(`/api/dev/billing/invoices/${invoice.id}/stripe`).expect(200);
    const stripeId = (await ctx.storage.getInvoice(invoice.id))!.stripeInvoiceId!;
    const event = { id: "evt_bad", type: "invoice.paid", data: { object: { id: stripeId, customer: stub.customers[0], metadata: { docturn_invoice_id: String(invoice.id) } } } };

    for (const opts of [{ signature: null }, { secret: "wrong" }, { timestamp: Math.floor(Date.now() / 1000) - 600 }]) {
      const res = await deliver(event, opts);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "signature_invalid" });
    }
    expect((await ctx.storage.getInvoice(invoice.id))!.status).toBe("issued");
    expect(await ctx.storage.getBillingEventByStripeId("evt_bad")).toBeUndefined();
  });

  it("invoice.paid marks OUR invoice paid with the EVENT ID as the source, and is idempotent", async () => {
    const { dev, invoice } = await issuedInvoice();
    await dev.post(`/api/dev/billing/invoices/${invoice.id}/stripe`).expect(200);
    const stripeId = (await ctx.storage.getInvoice(invoice.id))!.stripeInvoiceId!;
    const event = {
      id: "evt_paid_1",
      type: "invoice.paid",
      data: { object: { id: stripeId, customer: stub.customers[0], metadata: { docturn_invoice_id: String(invoice.id) } } },
    };

    const first = await deliver(event).expect(200);
    expect(first.body).toMatchObject({ received: true, applied: "invoice.paid" });
    const paid = await ctx.storage.getInvoice(invoice.id);
    expect(paid!.status).toBe("paid");
    expect(paid!.paidSource).toBe("stripe");
    expect(paid!.paidReference).toBe("evt_paid_1");
    expect(paid!.paidByUserId).toBe(null);

    // Redelivery: recognised by the EVENT ID and not applied a second time.
    const second = await deliver(event).expect(200);
    expect(second.body).toMatchObject({ received: true, duplicate: true });
    const events = await ctx.storage.listBillingEvents(ctx.seedResult.orgId, 50);
    expect(events.filter((e) => e.stripeEventId === "evt_paid_1")).toHaveLength(1);
    expect(events.find((e) => e.type === "status_transition" && e.toStatus === "paid")).toBeTruthy();

    // The hospital's screen says WHERE the "Paid" came from.
    const { agent: director } = await login(ctx.app, { username: "director" });
    const screen = await director.get("/api/billing").expect(200);
    const row = screen.body.invoices.find((i: { number: string }) => i.number === invoice.number);
    expect(row.status).toBe("paid");
    expect(row.paidSource).toBe("stripe");
    expect(row.paidReference).toBe("evt_paid_1");
  });

  it("invoice.payment_failed puts the CONTRACT past due — and nothing else changes", async () => {
    const { dev, invoice } = await issuedInvoice();
    await dev.post(`/api/dev/billing/invoices/${invoice.id}/stripe`).expect(200);
    const stripeId = (await ctx.storage.getInvoice(invoice.id))!.stripeInvoiceId!;
    await deliver({
      id: "evt_fail_1",
      type: "invoice.payment_failed",
      data: { object: { id: stripeId, customer: stub.customers[0], metadata: { docturn_invoice_id: String(invoice.id) } } },
    }).expect(200);

    const contract = await ctx.storage.getOrgContract(ctx.seedResult.orgId);
    expect(contract!.status).toBe("past_due");
    expect(contract!.pastDueAt).toBeTruthy();
    // The invoice has NOT been paid, so it stays issued.
    expect((await ctx.storage.getInvoice(invoice.id))!.status).toBe("issued");

    // AND care is untouched: a STAT still goes out, inside the grace period
    // and regardless of it.
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = await er
      .post("/api/messaging/conversations")
      .send({ type: "direct", participantIds: [ctx.seedResult.userIds.chen!] });
    await er
      .post("/api/messaging/send")
      .send({ conversationId: convo.body.id, content: "STAT", priority: "stat" })
      .expect(201);
  });

  it("invoice.voided voids ours; an unknown invoice and an off module change nothing", async () => {
    const { dev, invoice } = await issuedInvoice();
    await dev.post(`/api/dev/billing/invoices/${invoice.id}/stripe`).expect(200);
    const stripeId = (await ctx.storage.getInvoice(invoice.id))!.stripeInvoiceId!;

    const unknown = await deliver({ id: "evt_x", type: "invoice.paid", data: { object: { id: "in_nothing", customer: "cus_nothing" } } }).expect(200);
    expect(unknown.body.ignored).toBe("no_matching_invoice");

    const unhandled = await deliver({ id: "evt_y", type: "customer.updated", data: { object: { id: stripeId, customer: stub.customers[0] } } }).expect(200);
    expect(unhandled.body.ignored).toBe("unhandled_type");

    await deliver({
      id: "evt_void_1",
      type: "invoice.voided",
      data: { object: { id: stripeId, customer: stub.customers[0], metadata: { docturn_invoice_id: String(invoice.id) } } },
    }).expect(200);
    expect((await ctx.storage.getInvoice(invoice.id))!.status).toBe("void");

    // With the tenant's billing.stripe switched off, an event changes nothing.
    await dev.patch(`/api/dev/modules/${ctx.seedResult.orgId}`).send({ id: "billing.stripe", enabled: false }).expect(200);
    invalidateModules();
    const ignored = await deliver({
      id: "evt_after_off",
      type: "invoice.paid",
      data: { object: { id: stripeId, customer: stub.customers[0], metadata: { docturn_invoice_id: String(invoice.id) } } },
    }).expect(200);
    expect(ignored.body.ignored).toBe("module_disabled");
    expect((await ctx.storage.getInvoice(invoice.id))!.status).toBe("void");
  });

  it("with Stripe not configured at all, the endpoint refuses rather than accept the unverifiable", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await deliver({ id: "evt_z", type: "invoice.paid", data: { object: {} } });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("stripe_not_configured");
  });
});

describe("the integration card", () => {
  it("Stripe is a PLATFORM-scope entry with no PHI, listed for the operator", async () => {
    const { agent: dev } = await devLogin();
    const res = await dev.get("/api/dev/integrations").expect(200);
    const card = (res.body.integrations as Array<{ id: string; scope: string; phi: boolean; baaRequired: boolean }>)
      .find((c) => c.id === "stripe");
    expect(card, "Stripe must appear in the existing Integrations registry").toBeTruthy();
    expect(card!.scope).toBe("platform");
    expect(card!.phi, "no PHI ever goes to Stripe").toBe(false);
    expect(card!.baaRequired).toBe(false);
  });

  it("'Test connection' is a real call: it passes against the stub and fails with a wrong key", async () => {
    const { agent: dev } = await devLogin();
    await dev.patch(`/api/dev/modules/${ctx.seedResult.orgId}`).send({ id: "billing", enabled: true }).expect(200);
    await dev.patch(`/api/dev/modules/${ctx.seedResult.orgId}`).send({ id: "billing.stripe", enabled: true }).expect(200);
    invalidateModules();
    const { agent: director } = await login(ctx.app, { username: "director" });
    const ok = await director.post("/api/integrations/stripe/test").expect(200);
    expect(ok.body.ok, JSON.stringify(ok.body).slice(0, 200)).toBe(true);

    process.env.STRIPE_SECRET_KEY = ["sk", "test", "wrongkey000000000000"].join("_");
    const bad = await director.post("/api/integrations/stripe/test").expect(200);
    expect(bad.body.ok).toBe(false);
    // The message relays Stripe's own words about the REQUEST, never the key.
    expect(String(bad.body.message)).not.toContain("sk_");
  });
});
