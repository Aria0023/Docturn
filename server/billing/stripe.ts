/**
 * Billing — the STRIPE COLLECTION RAIL (docs/BILLING.md, feature 6).
 *
 * Stripe is not the source of truth. The CONTRACT is ours (`org_contracts`),
 * the invoice is ours (`billing_invoices`), the seat counts are ours
 * (`seat_snapshots`). Stripe exists to collect money and to tell us when it
 * arrived.
 *
 * Deliberately NOT used: Stripe **Subscription** objects. A hospital's
 * commercial terms live in a signed contract with net terms and a PO number,
 * and a Subscription would quietly become a second, divergent source of truth
 * for the price, the seat count and the renewal date. Instead, per invoice:
 *
 *   1. ensure a Stripe **Customer** for the hospital (one, remembered on the
 *      contract as `stripe_customer_id`);
 *   2. create one **Invoice Item** per line of OUR invoice;
 *   3. create a Stripe **Invoice** with `collection_method: "send_invoice"`
 *      and `days_until_due` from the contract — the ACH / PO / net-30 path
 *      hospitals actually use;
 *   4. finalize it with `auto_advance: false` — no automatic dunning, ever —
 *      and record its id on our row;
 *   5. ONLY when the contract carries the explicit per-contract opt-in
 *      `stripe_send_invoice_email`, call `POST /v1/invoices/:id/send`.
 *
 * That last step is the whole of the outbound-email question, and it is one
 * explicit call rather than a flag: with no opt-in there is no call, so Stripe
 * cannot email the hospital at all, and the route only reports `emailed: true`
 * when that call actually succeeded. (An earlier shape passed the opt-in as
 * `auto_advance` on the CREATE and then finalized with `auto_advance: false`,
 * which silently overwrote it — the screen would have claimed an email the
 * server never sent.)
 *
 * Every payload goes through the allow-list projection in stripe-payload.ts,
 * which THROWS on any field outside the list. Nothing but billing data can
 * reach Stripe, and that is enforced, not intended.
 */
import type { BillingInvoice, Organization, OrgContract } from "@shared/schema";
import { IntegrationCallError, integrationFetch } from "../integrations/http.js";
import { buildStripePayload } from "./stripe-payload.js";
import { stripePlatformConfig, type StripePlatformConfig } from "./stripe-config.js";

/** Stripe speaks form-encoding; `metadata` goes as metadata[key]=value. */
export function stripeForm(payload: Record<string, string | number | boolean | Record<string, string>>): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) {
    if (v !== null && typeof v === "object") {
      for (const [mk, mv] of Object.entries(v)) out.append(`${k}[${mk}]`, String(mv));
    } else {
      out.append(k, String(v));
    }
  }
  return out.toString();
}

export interface StripeCallResult<T> {
  ok: boolean;
  status: number;
  body: T | null;
  /** A short code + a sentence safe to show. Never a key, never PHI. */
  error: { code: string; message: string } | null;
}

async function call<T>(
  config: StripePlatformConfig,
  path: string,
  payload: Record<string, string | number | boolean | Record<string, string>> | null,
): Promise<StripeCallResult<T>> {
  const url = config.apiBase + path;
  try {
    const res = await integrationFetch(url, {
      method: payload ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + config.secretKey,
        ...(payload ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        "Stripe-Version": "2024-06-20",
      },
      ...(payload ? { body: stripeForm(payload) } : {}),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
      return {
        ok: false,
        status: res.status,
        body: null,
        // Stripe's own message is safe to relay: it describes the request, not
        // the key. Truncated so a long body cannot flood a log or a screen.
        error: {
          code: err?.code || "http_" + res.status,
          message: String(err?.message || `Stripe answered HTTP ${res.status}.`).slice(0, 300),
        },
      };
    }
    return { ok: true, status: res.status, body: body as T, error: null };
  } catch (e) {
    if (e instanceof IntegrationCallError) {
      return { ok: false, status: 0, body: null, error: { code: e.code, message: e.message } };
    }
    return { ok: false, status: 0, body: null, error: { code: "network", message: "Stripe could not be reached." } };
  }
}

/** The operator's "Test connection": a harmless authenticated read. */
export async function stripeTestConnection(env: NodeJS.ProcessEnv = process.env) {
  const { config, missing } = stripePlatformConfig(env);
  if (!config) {
    return { ok: false, code: "not_configured", message: "Missing server settings: " + missing.join(", ") };
  }
  // A harmless read INSIDE the permission scope STRIPE_SECRET_KEY's own
  // description asks for (Customers / Invoice Items / Invoices). /v1/balance
  // would need a Balance permission a key scoped that way does not have, so
  // an operator who followed the instructions would see a false 401.
  const res = await call<{ object?: string; data?: unknown[] }>(config, "/v1/customers?limit=1", null);
  if (!res.ok) return { ok: false, code: res.error!.code, message: res.error!.message };
  return { ok: true, code: "ok", message: "Stripe accepted the credentials." };
}

export interface StripeCustomerInput {
  org: Pick<Organization, "id" | "code" | "name">;
  contract: Pick<OrgContract, "id" | "billingContactName" | "billingContactEmail" | "poNumber">;
}

/**
 * The hospital's Stripe Customer. Only billing facts: the hospital's name, the
 * billing contact's name and email, the PO number and reconciliation ids.
 */
export function customerPayload(input: StripeCustomerInput) {
  return buildStripePayload("customer", {
    name: input.org.name,
    email: input.contract.billingContactEmail ?? undefined,
    description:
      "DocTurn " + input.org.code + (input.contract.billingContactName ? " — " + input.contract.billingContactName : ""),
    metadata: {
      docturn_org_id: input.org.id,
      docturn_org_code: input.org.code,
      docturn_contract_id: input.contract.id,
      po_number: input.contract.poNumber ?? undefined,
    },
  });
}

export function invoiceItemPayload(
  customerId: string,
  invoice: Pick<BillingInvoice, "id" | "number" | "currency" | "organizationId">,
  line: { description: string; quantity: number; unitCents: number; citedDates: string[] },
) {
  return buildStripePayload("invoice_item", {
    customer: customerId,
    currency: invoice.currency.toLowerCase(),
    description: line.description,
    quantity: line.quantity,
    unit_amount: line.unitCents,
    metadata: {
      docturn_invoice_id: invoice.id,
      docturn_invoice_number: invoice.number,
      docturn_org_id: invoice.organizationId,
      docturn_cited_snapshot_dates: line.citedDates.join("|") || undefined,
    },
  });
}

export function invoicePayload(
  customerId: string,
  invoice: Pick<BillingInvoice, "id" | "number" | "currency" | "organizationId" | "periodStart" | "periodEnd">,
  contract: Pick<OrgContract, "id" | "daysUntilDue" | "poNumber" | "stripeSendInvoiceEmail" | "committedSeats">,
  planCode: string,
  peakSeats: number,
) {
  return buildStripePayload("invoice", {
    customer: customerId,
    // The ACH / PO / net-terms path hospitals actually use. Never a card charge.
    collection_method: "send_invoice",
    days_until_due: contract.daysUntilDue,
    currency: invoice.currency.toLowerCase(),
    description: "DocTurn " + invoice.number + " — " + invoice.periodStart + " to " + invoice.periodEnd,
    // NO AUTOMATIC COLLECTION. Stripe never chases this invoice by itself:
    // emailing is the single explicit `send` call below, made only on the
    // contract's opt-in, so the two can never disagree.
    auto_advance: false,
    metadata: {
      docturn_invoice_id: invoice.id,
      docturn_invoice_number: invoice.number,
      docturn_org_id: invoice.organizationId,
      docturn_contract_id: contract.id,
      docturn_plan_code: planCode,
      docturn_period_start: invoice.periodStart,
      docturn_period_end: invoice.periodEnd,
      docturn_committed_seats: contract.committedSeats,
      docturn_peak_seats: peakSeats,
      po_number: contract.poNumber ?? undefined,
    },
  });
}

/* ── the calls ────────────────────────────────────────────────────────────── */

export async function createStripeCustomer(config: StripePlatformConfig, input: StripeCustomerInput) {
  return call<{ id: string }>(config, "/v1/customers", customerPayload(input));
}
export async function createStripeInvoiceItem(
  config: StripePlatformConfig,
  customerId: string,
  invoice: Parameters<typeof invoiceItemPayload>[1],
  line: Parameters<typeof invoiceItemPayload>[2],
) {
  return call<{ id: string }>(config, "/v1/invoiceitems", invoiceItemPayload(customerId, invoice, line));
}
export async function createStripeInvoice(
  config: StripePlatformConfig,
  customerId: string,
  invoice: Parameters<typeof invoicePayload>[1],
  contract: Parameters<typeof invoicePayload>[2],
  planCode: string,
  peakSeats: number,
) {
  return call<{ id: string; hosted_invoice_url?: string }>(
    config,
    "/v1/invoices",
    invoicePayload(customerId, invoice, contract, planCode, peakSeats),
  );
}
export async function finalizeStripeInvoice(config: StripePlatformConfig, stripeInvoiceId: string) {
  return call<{ id: string; status: string; hosted_invoice_url?: string }>(
    config,
    "/v1/invoices/" + encodeURIComponent(stripeInvoiceId) + "/finalize",
    // Finalize, and nothing else: auto_advance false means Stripe will not
    // email or chase this invoice on its own.
    { auto_advance: false },
  );
}

/**
 * THE ONLY thing that makes Stripe email the hospital. Called solely when the
 * contract carries `stripe_send_invoice_email`; with no opt-in this call is
 * never made, so there is no flag anywhere that could quietly send one.
 */
export async function sendStripeInvoice(config: StripePlatformConfig, stripeInvoiceId: string) {
  return call<{ id: string; status: string; hosted_invoice_url?: string }>(
    config,
    "/v1/invoices/" + encodeURIComponent(stripeInvoiceId) + "/send",
    {},
  );
}
