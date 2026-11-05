/**
 * Organization billing — the shared vocabulary (server and web client).
 *
 * DocTurn (the PLATFORM operator, org code DOCTURN) bills each HOSPITAL (a
 * tenant organization). Money is INTEGER CENTS everywhere; currency is fixed
 * per contract. Nothing in this file touches patient data: a billing record
 * carries a hospital's name, a billing contact, a PO number and seat counts.
 *
 * THE SAFETY INVARIANT: a billing state can only ever refuse a NEW SEAT or a
 * NEW ORGANIZATION. It never touches messaging, STAT, escalation, broadcasts,
 * assignments, on-call, the schedule or sign-in. See docs/BILLING.md and
 * tests/billing-safety-invariant.test.ts.
 */
import { ROLES, type Role } from "./schema.js";

/**
 * A BILLABLE SEAT is a user in a tenant organization who is not deactivated
 * and whose role is one of these — every role that has an account except
 * `developer`. Developers are the platform operator's own staff and the
 * platform organization is never billed.
 *
 * Derived from ROLES rather than written out, so a new clinical role becomes
 * billable the day it is added instead of silently escaping the count.
 */
export const BILLABLE_SEAT_ROLES: readonly Role[] = ROLES.filter((r) => r !== "developer");

export function isBillableSeatRole(role: string): boolean {
  return (BILLABLE_SEAT_ROLES as readonly string[]).includes(role);
}

/** Seat counts for one organization at one moment. */
export interface SeatCount {
  total: number;
  /** role → count; a role with nobody in it is absent. */
  byRole: Record<string, number>;
}

/* ── plans and contracts ──────────────────────────────────────────────────── */

export const CONTRACT_TERMS = ["monthly", "annual"] as const;
export type ContractTerm = (typeof CONTRACT_TERMS)[number];

export const CONTRACT_STATUSES = ["trial", "active", "past_due", "cancelled", "expired"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** A contract in one of these states still bills and still grants seats. */
export const CONTRACT_STATUSES_IN_GOOD_STANDING: readonly ContractStatus[] = ["trial", "active"];

/**
 * How long a past-due contract keeps behaving exactly as an active one. The
 * hospital's directors and the operator are warned from the first day;
 * nothing changes at all until the grace period has run out, and the only
 * thing that changes then is that a new seat is refused.
 */
export const PAST_DUE_GRACE_DAYS = 30;

export const INVOICE_STATUSES = ["draft", "issued", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** The currencies a contract may be priced in (ISO 4217, upper case). */
export const BILLING_CURRENCIES = ["USD", "CAD", "EUR", "GBP"] as const;
export type BillingCurrency = (typeof BILLING_CURRENCIES)[number];

/* ── money ────────────────────────────────────────────────────────────────── */

/** Integer cents → "$1,234.50". Never a float, never a locale surprise. */
export function formatCents(cents: number, currency: string = "USD"): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol = currency === "USD" || currency === "CAD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  const body = symbol + grouped + "." + frac;
  const suffix = symbol ? (currency === "USD" ? "" : " " + currency) : " " + currency;
  return (negative ? "-" : "") + body + suffix;
}

/** quantity × unit cents, as integer cents. */
export function lineAmountCents(quantity: number, unitCents: number): number {
  return Math.round(quantity) * Math.round(unitCents);
}

/* ── dates ────────────────────────────────────────────────────────────────── */

export const BILLING_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Add whole days to a `YYYY-MM-DD` day, staying on the calendar. */
export function addDays(day: string, days: number): string {
  const d = new Date(day + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
