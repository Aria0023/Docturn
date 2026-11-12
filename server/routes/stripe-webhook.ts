/**
 * Stripe WEBHOOKS (docs/BILLING.md, feature 6).
 *
 *   POST /webhooks/stripe
 *
 * Mounted OUTSIDE /api on purpose:
 *   • it is unauthenticated — the signature is the authentication;
 *   • it must not share the /api rate-limit budget with a hospital's clinicians
 *     (Stripe retries on failure, and a dropped delivery would silently lose a
 *     payment), so it has its own budget in server/app.ts, like /scim;
 *   • it must read the RAW body, so server/app.ts excludes this one path from
 *     the global JSON parser and this route mounts express.raw itself.
 *
 * Three guarantees:
 *   1. SIGNATURE VERIFICATION first, on the raw bytes, timing-safe, with a
 *      300-second tolerance (server/billing/stripe-webhook-verify.ts). An
 *      unsigned, mis-signed or stale delivery changes nothing.
 *   2. IDEMPOTENCY keyed on the Stripe EVENT ID: the row goes into
 *      `billing_events` FIRST, with a unique index, so a redelivery of the
 *      same event is recognised before anything is applied and answered 200
 *      (Stripe must not keep retrying a delivery we already honoured).
 *   3. The event only ever touches BILLING state: an invoice's status, or a
 *      contract going past due. It can never refuse a message, a STAT, an
 *      escalation, a broadcast, an assignment or a sign-in.
 *
 * Stripe is the collection rail, so an event can mark OUR invoice paid — with
 * `paid_source = 'stripe'` and the EVENT ID in `paid_reference`, which is the
 * only other way an invoice becomes Paid besides the operator's own action.
 */
import express, { type Express, type Request, type Response } from "express";
import { appendAudit } from "../audit.js";
import { addDays } from "@shared/billing";
import { isModuleEnabled } from "../modules.js";
import { storage } from "../storage.js";
import { stripePlatformConfig } from "../billing/stripe-config.js";
import { STRIPE_SIGNATURE_HEADER, verifyStripeSignature } from "../billing/stripe-webhook-verify.js";

export const STRIPE_WEBHOOK_PATH = "/webhooks/stripe";

/** The only event types that do anything. Anything else is recorded and ignored. */
export const STRIPE_HANDLED_EVENTS = ["invoice.paid", "invoice.payment_failed", "invoice.voided"] as const;

interface StripeEventShape {
  id?: unknown;
  type?: unknown;
  data?: { object?: Record<string, unknown> };
}

function invoiceRefsOf(obj: Record<string, unknown> | undefined) {
  const metadata = (obj?.metadata ?? {}) as Record<string, unknown>;
  const ourId = Number(metadata.docturn_invoice_id);
  return {
    stripeInvoiceId: typeof obj?.id === "string" ? obj.id : null,
    customerId: typeof obj?.customer === "string" ? obj.customer : null,
    ourInvoiceId: Number.isInteger(ourId) && ourId > 0 ? ourId : null,
  };
}

export function registerStripeWebhookRoutes(app: Express) {
  // This route's OWN parser: the raw bytes, because the signature covers them.
  // server/app.ts leaves this path alone, so nothing has consumed the stream.
  const raw = express.raw({ type: "*/*", limit: "512kb" });

  app.post(STRIPE_WEBHOOK_PATH, raw, async (req: Request, res: Response) => {
    const { config } = stripePlatformConfig();
    if (!config) {
      // Nothing is configured, so nothing can be verified: refuse rather than
      // accept an unverifiable delivery.
      return res.status(503).json({ error: "stripe_not_configured" });
    }
    const body = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.from("");
    const verdict = verifyStripeSignature(
      body,
      req.header(STRIPE_SIGNATURE_HEADER) ?? undefined,
      config.webhookSecret,
    );
    if (!verdict.ok) {
      // One shape for every failure: the endpoint is not an oracle for which.
      console.warn("[billing] stripe webhook refused:", verdict.reason);
      return res.status(400).json({ error: "signature_invalid" });
    }

    let event: StripeEventShape;
    try {
      event = JSON.parse(body.toString("utf8")) as StripeEventShape;
    } catch {
      return res.status(400).json({ error: "malformed_body" });
    }
    const eventId = typeof event.id === "string" ? event.id : "";
    const type = typeof event.type === "string" ? event.type : "";
    if (!eventId || !type) return res.status(400).json({ error: "malformed_body" });

    const obj = event.data?.object;
    const refs = invoiceRefsOf(obj);

    // Resolve the tenant from OUR records, never from anything the payload
    // claims about an organization: the Stripe Customer we created, or the
    // invoice id we put in the metadata ourselves.
    let ourInvoice =
      (refs.ourInvoiceId ? await storage().getInvoice(refs.ourInvoiceId) : undefined) ??
      (refs.stripeInvoiceId ? await storage().getInvoiceByStripeId(refs.stripeInvoiceId) : undefined);
    const contract = refs.customerId ? await storage().getOrgContractByStripeCustomer(refs.customerId) : undefined;
    if (ourInvoice && contract && ourInvoice.organizationId !== contract.organizationId) {
      // The customer and the invoice disagree about whose they are. Record it
      // and change nothing.
      ourInvoice = undefined;
    }
    const orgId = ourInvoice?.organizationId ?? contract?.organizationId ?? null;

    // IDEMPOTENCY: the event row first, then the work.
    const claimed = await storage().recordStripeEvent({
      organizationId: orgId,
      invoiceId: ourInvoice?.id ?? null,
      stripeEventId: eventId,
      type,
      detail: { stripeInvoiceId: refs.stripeInvoiceId, customer: refs.customerId },
    });
    if (!claimed) return res.status(200).json({ received: true, duplicate: true });

    if (!STRIPE_HANDLED_EVENTS.includes(type as (typeof STRIPE_HANDLED_EVENTS)[number])) {
      return res.status(200).json({ received: true, ignored: "unhandled_type" });
    }
    if (orgId == null || !ourInvoice) {
      return res.status(200).json({ received: true, ignored: "no_matching_invoice" });
    }
    // The tenant's own switch. An organization whose billing.stripe is off is
    // not collected through Stripe, so an event about it changes nothing.
    if (!(await isModuleEnabled(orgId, "billing.stripe"))) {
      return res.status(200).json({ received: true, ignored: "module_disabled" });
    }

    const from = ourInvoice.status;
    if (type === "invoice.paid") {
      if (from !== "paid" && from !== "void") {
        await storage().updateInvoice(ourInvoice.id, {
          status: "paid",
          paidAt: new Date(),
          paidSource: "stripe",
          paidByUserId: null,
          // The EVENT ID: a "Paid" on any screen traces back to this.
          paidReference: eventId,
        });
        await storage().recordBillingTransition({
          organizationId: orgId,
          invoiceId: ourInvoice.id,
          stripeEventId: null,
          type: "status_transition",
          fromStatus: from,
          toStatus: "paid",
          detail: { source: "stripe", stripeEventId: eventId },
        });
      }
    } else if (type === "invoice.voided") {
      if (from === "draft" || from === "issued") {
        await storage().updateInvoice(ourInvoice.id, { status: "void", voidReason: "voided in Stripe" });
        await storage().recordBillingTransition({
          organizationId: orgId,
          invoiceId: ourInvoice.id,
          stripeEventId: null,
          type: "status_transition",
          fromStatus: from,
          toStatus: "void",
          detail: { source: "stripe", stripeEventId: eventId },
        });
      }
    } else if (type === "invoice.payment_failed") {
      // The ONLY thing a failed payment changes: the contract goes past due,
      // which starts 30 days of WARNINGS. Nothing is switched off, and even
      // after the grace period the only effect is that a new account cannot be
      // added. The invoice itself stays issued — it has not been paid.
      const c = await storage().getOrgContract(orgId);
      if (c && c.status !== "past_due" && c.status !== "cancelled") {
        const pastDueAt = new Date();
        await storage().updateOrgContract(orgId, { status: "past_due", pastDueAt });
        await storage().recordBillingTransition({
          organizationId: orgId,
          invoiceId: ourInvoice.id,
          stripeEventId: null,
          type: "contract_transition",
          fromStatus: c.status,
          toStatus: "past_due",
          detail: {
            source: "stripe",
            stripeEventId: eventId,
            graceEndsOn: addDays(pastDueAt.toISOString().slice(0, 10), 30),
          },
        });
      }
    }

    await appendAudit({
      organizationId: orgId,
      userId: null,
      action: "billing.stripe_event",
      resourceType: "billing_invoice",
      resourceId: ourInvoice.id,
      details: { action: type, status: from, number: ourInvoice.number, source: "stripe" },
      riskLevel: "medium",
    });
    res.status(200).json({ received: true, applied: type });
  });
}
