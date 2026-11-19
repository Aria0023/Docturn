/**
 * Billing — INVOICES (docs/BILLING.md, feature 4).
 *
 * An invoice is generated from the CONTRACT and the SEAT SNAPSHOTS, and it
 * CITES the snapshot dates it counted, so a hospital can audit every line:
 * "you charged me for 47 accounts on 3 March" is answerable from
 * `seat_snapshots` plus the line's `citedDates`.
 *
 * Three rules this file exists to hold:
 *
 *  1. **Numbers are gap-free and never reused.** The number is allocated from
 *     `billing_counters` INSIDE THE SAME TRANSACTION as the invoice row
 *     (`UPDATE … RETURNING value`, which takes a row lock, so concurrent
 *     generations serialise). A transaction that rolls back gives the number
 *     back; a committed one can never be issued twice.
 *  2. **The billable count for a period is the period's DAILY MAXIMUM**, with
 *     the date(s) it occurred on cited. That is what a hospital means when it
 *     asks what it is paying for: the most people it had on the system.
 *  3. **Nothing is ever recomputed retroactively.** An issued invoice is
 *     immutable except for its status; generation reads the contract AS IT IS
 *     NOW. A mid-term plan change therefore lands on the NEXT invoice, never
 *     on one already issued — which is exactly the proration rule the UI and
 *     the docs state. The only correction path is void-and-reissue, and a void
 *     keeps its number forever.
 *
 * "Paid" is never a guess. It is either the operator's own action (their user
 * id, a timestamp, audited) or a Stripe webhook event id. There is no third
 * source and no mock invoice.
 */
import { formatCents, type InvoiceStatus } from "@shared/billing";
import type { BillingInvoice, BillingPlan, OrgContract, SeatSnapshot } from "@shared/schema";
import { csvCell, csvLine } from "../compliance/audit-export.js";
import { effectivePerSeatCents } from "./contracts.js";

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
  /** The seat-snapshot dates this line's quantity came from. */
  citedDates: string[];
}

export interface GeneratedInvoice {
  lines: InvoiceLine[];
  subtotalCents: number;
  totalCents: number;
  currency: string;
  /** The peak billable seat count in the period, and when it occurred. */
  peakSeats: number;
  peakDates: string[];
  /** Snapshot days actually found in the period. */
  snapshotDays: number;
}

/** The highest seat count in the period, with every date that hit it. */
export function peakSeatsIn(snapshots: readonly SeatSnapshot[]): { peak: number; dates: string[] } {
  let peak = 0;
  for (const s of snapshots) if (s.seatCount > peak) peak = s.seatCount;
  return { peak, dates: snapshots.filter((s) => s.seatCount === peak).map((s) => s.snapshotDate) };
}

/**
 * Build the lines for one period. Two lines at most:
 *
 *   • the committed accounts the contract says the hospital pays for, and
 *   • any accounts BEYOND the commitment, at the same per-seat price, citing
 *     the day(s) the peak occurred.
 *
 * An over-committed period is therefore a LINE ITEM, never a refusal.
 */
export function generateInvoiceLines(
  contract: Pick<OrgContract, "committedSeats" | "priceOverrideCents" | "term">,
  plan: Pick<BillingPlan, "name" | "perSeatPriceCents" | "currency">,
  snapshots: readonly SeatSnapshot[],
): GeneratedInvoice {
  const unitCents = effectivePerSeatCents(contract, plan);
  const { peak, dates } = peakSeatsIn(snapshots);
  const lines: InvoiceLine[] = [];
  const termWord = contract.term === "annual" ? "annual" : "monthly";

  lines.push({
    description: `${plan.name} — committed accounts (${termWord})`,
    quantity: contract.committedSeats,
    unitCents,
    amountCents: contract.committedSeats * unitCents,
    citedDates: [],
  });

  const overage = Math.max(0, peak - contract.committedSeats);
  if (overage > 0) {
    lines.push({
      description:
        `Additional accounts above the committed ${contract.committedSeats} ` +
        `(peak ${peak} on ${dates.join(", ")})`,
      quantity: overage,
      unitCents,
      amountCents: overage * unitCents,
      citedDates: [...dates],
    });
  }

  const subtotalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  return {
    lines,
    subtotalCents,
    totalCents: subtotalCents,
    currency: plan.currency,
    peakSeats: peak,
    peakDates: dates,
    snapshotDays: snapshots.length,
  };
}

/** `DT-000042`. Zero-padded so a list sorts the way a human reads it. */
export function formatInvoiceNumber(value: number): string {
  return "DT-" + String(value).padStart(6, "0");
}

/* ── the hospital's download ──────────────────────────────────────────────── */

export const INVOICE_CSV_COLUMNS = [
  "invoice_number",
  "status",
  "organization",
  "period_start",
  "period_end",
  "issued_at_utc",
  "due_on",
  "paid_at_utc",
  "line_description",
  "quantity",
  "unit_cents",
  "amount_cents",
  "cited_snapshot_dates",
  "currency",
] as const;

export interface InvoiceCsvContext {
  orgName: string;
}

/**
 * One invoice as CSV rows — a header line, then one line per invoice line, then
 * a total line. Streamed by the route (the audit-export pattern), so a long
 * invoice never has to be held in memory, and every cell goes through
 * `csvCell` so nothing a spreadsheet would run as a formula escapes.
 *
 * PHI-free by construction: the only columns are an invoice number, a status,
 * the hospital's own name, dates, counts and cents.
 */
export function* invoiceCsvLines(
  invoice: Pick<
    BillingInvoice,
    | "number"
    | "status"
    | "periodStart"
    | "periodEnd"
    | "issuedAt"
    | "dueOn"
    | "paidAt"
    | "lines"
    | "totalCents"
    | "currency"
  >,
  ctx: InvoiceCsvContext,
): Generator<string> {
  yield csvLine([...INVOICE_CSV_COLUMNS]);
  const common = [
    invoice.number,
    invoice.status,
    ctx.orgName,
    invoice.periodStart,
    invoice.periodEnd,
    invoice.issuedAt ? invoice.issuedAt.toISOString() : "",
    invoice.dueOn ?? "",
    invoice.paidAt ? invoice.paidAt.toISOString() : "",
  ];
  for (const line of invoice.lines) {
    yield csvLine([
      ...common,
      line.description,
      line.quantity,
      line.unitCents,
      line.amountCents,
      line.citedDates.join("|"),
      invoice.currency,
    ]);
  }
  yield csvLine([...common, "TOTAL", "", "", invoice.totalCents, "", invoice.currency]);
}

/** A one-line human summary for a list row. Never a guess about payment. */
export function invoiceSummary(invoice: {
  number: string;
  status: InvoiceStatus | string;
  totalCents: number;
  currency: string;
}): string {
  return `${invoice.number} — ${formatCents(invoice.totalCents, invoice.currency)} (${invoice.status})`;
}

export const INVOICE_CSV_CELL = csvCell;
