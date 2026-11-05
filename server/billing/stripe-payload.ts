/**
 * Billing — what DocTurn may send to STRIPE (docs/BILLING.md, feature 6).
 *
 * Stripe is the COLLECTION RAIL, not the source of truth: the contract is
 * ours. The only things that may leave DocTurn for Stripe are billing facts:
 *
 *   • the hospital's NAME and its billing CONTACT (name, email) — the people
 *     who pay the bill, named on the bill, exactly as on a paper invoice;
 *   • the PO number, the currency, the net terms;
 *   • SEAT COUNTS and the invoice line descriptions and cents.
 *
 * That is not PHI and needs no BAA — there is no patient, no clinician's
 * patient relationship, no clinical content and no message in any of it. Said
 * plainly in docs/BILLING.md and SECURITY.md so nobody has to infer it.
 *
 * This file is the enforcement, not the intention. Every payload is built by
 * projecting a candidate object through a POSITIVE ALLOW-LIST — the same
 * pattern as the audit export's `safeDetails` (server/compliance/
 * audit-export.ts), and for the same reason: a deny-list silently passes the
 * next field somebody adds. `buildStripePayload` THROWS on any key outside the
 * list, so a field that should never go to a third party cannot reach the
 * network even if a future caller passes it by accident.
 */

export class StripePayloadRefused extends Error {
  readonly refused: string[];
  constructor(refused: string[]) {
    super("refused Stripe payload field(s): " + refused.join(", "));
    this.name = "StripePayloadRefused";
    this.refused = refused;
  }
}

/** Fields allowed on a Stripe CUSTOMER (one per hospital). */
export const STRIPE_CUSTOMER_FIELDS: readonly string[] = [
  "name",
  "email",
  "description",
  // metadata is itself allow-listed, below.
  "metadata",
];

/** Fields allowed on a Stripe INVOICE (send_invoice / net terms). */
export const STRIPE_INVOICE_FIELDS: readonly string[] = [
  "customer",
  "collection_method",
  "days_until_due",
  "currency",
  "description",
  "auto_advance",
  "metadata",
];

/** Fields allowed on a Stripe INVOICE ITEM (one per invoice line). */
export const STRIPE_INVOICE_ITEM_FIELDS: readonly string[] = [
  "customer",
  "invoice",
  "currency",
  "description",
  "quantity",
  "unit_amount",
  "metadata",
];

/**
 * Metadata keys allowed on anything. Ids, codes, counts and dates only — the
 * things that let the operator reconcile a Stripe object with a DocTurn row.
 */
export const STRIPE_METADATA_KEYS: readonly string[] = [
  "docturn_org_id",
  "docturn_org_code",
  "docturn_invoice_id",
  "docturn_invoice_number",
  "docturn_contract_id",
  "docturn_plan_code",
  "docturn_period_start",
  "docturn_period_end",
  "docturn_committed_seats",
  "docturn_peak_seats",
  "docturn_cited_snapshot_dates",
  "po_number",
];

export type StripeShape = "customer" | "invoice" | "invoice_item";

const FIELDS: Record<StripeShape, readonly string[]> = {
  customer: STRIPE_CUSTOMER_FIELDS,
  invoice: STRIPE_INVOICE_FIELDS,
  invoice_item: STRIPE_INVOICE_ITEM_FIELDS,
};

export interface StripePayloadResult {
  kept: Record<string, string | number | boolean | Record<string, string>>;
  refused: string[];
}

/**
 * Project a candidate object to exactly the allow-listed fields for `shape`.
 * Returns what was kept AND what was refused; `buildStripePayload` throws on
 * any refusal so a caller cannot ignore it.
 */
export function projectStripePayload(shape: StripeShape, candidate: Record<string, unknown>): StripePayloadResult {
  const allowed = FIELDS[shape];
  const kept: StripePayloadResult["kept"] = {};
  const refused: string[] = [];
  for (const [key, value] of Object.entries(candidate)) {
    if (value === undefined || value === null) continue;
    if (!allowed.includes(key)) {
      refused.push(key);
      continue;
    }
    if (key === "metadata") {
      if (typeof value !== "object" || Array.isArray(value)) {
        refused.push("metadata");
        continue;
      }
      const meta: Record<string, string> = {};
      for (const [mk, mv] of Object.entries(value as Record<string, unknown>)) {
        if (mv === undefined || mv === null) continue;
        if (!STRIPE_METADATA_KEYS.includes(mk)) {
          refused.push("metadata." + mk);
          continue;
        }
        meta[mk] = String(mv);
      }
      kept.metadata = meta;
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      kept[key] = value;
      continue;
    }
    // An object or array under an allowed scalar key is never sent.
    refused.push(key);
  }
  return { kept, refused };
}

/** The only way a payload reaches the Stripe client. Throws on any refusal. */
export function buildStripePayload(
  shape: StripeShape,
  candidate: Record<string, unknown>,
): Record<string, string | number | boolean | Record<string, string>> {
  const { kept, refused } = projectStripePayload(shape, candidate);
  if (refused.length) throw new StripePayloadRefused(refused.sort());
  return kept;
}
