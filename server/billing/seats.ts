/**
 * Billing — SEATS (docs/BILLING.md, feature 1).
 *
 * THE seat definition lives here, in ONE function, so every path that cares
 * — the People screen, SCIM, the entitlement check, the invoice — counts the
 * same thing. A billable seat is a user in a TENANT organization who is
 *
 *   • not deactivated (users.disabled_at IS NULL), and
 *   • not a `developer` (shared/billing.ts BILLABLE_SEAT_ROLES).
 *
 * The platform organization (DOCTURN) is never billed, so it is never counted
 * and never snapshotted.
 *
 * `seat_snapshots` is what an invoice line cites, so a hospital can audit
 * "you charged me for 47 seats on 3 March". Two consequences:
 *
 *   • The snapshot's DATE is the calendar day in the ORGANIZATION's own
 *     timezone (organizations.timezone), not the server's. A hospital in
 *     Honolulu and one in Boston cross midnight eight hours apart.
 *   • Because of that the sweep ticks HOURLY, not daily: every org's local
 *     midnight falls inside some hour, and an hourly sweep writes each org's
 *     current local day. The write is an upsert on (org, date), so the day's
 *     row is simply corrected as people are added or deactivated — the row
 *     for a finished day stops changing because the sweep has moved on to the
 *     next local day.
 *
 * EVERY tenant is snapshotted, whether or not the `billing` module is on, so
 * that the day an operator puts a hospital on a contract there is already
 * history to invoice from. A seat count is not PHI and not a product feature.
 */
import { PLATFORM_ORG_CODE, type Organization, type SeatSnapshot, type User } from "@shared/schema";
import { isBillableSeatRole, type SeatCount } from "@shared/billing";
import { startLeasedInterval, type LeasedTimer } from "../services/job-leases.js";
import { storage, type DatabaseStorage } from "../storage.js";

/**
 * The platform operator's own organization, compared on its CODE rather than
 * through server/auth.ts — billing must not import the authentication module
 * (server/auth.ts imports the entitlement module, and a cycle through it would
 * make the order these two initialise in matter).
 */
export function isPlatformOrg(org: { code: string }): boolean {
  return org.code.toUpperCase() === PLATFORM_ORG_CODE;
}

/** THE seat definition. Everything else in billing defers to this. */
export function isBillableSeat(user: Pick<User, "role" | "disabledAt">): boolean {
  return !user.disabledAt && isBillableSeatRole(user.role);
}

/** Count one organization's billable seats right now, with the role breakdown. */
export async function countBillableSeats(db: DatabaseStorage, orgId: number): Promise<SeatCount> {
  const users = await db.listUsers(orgId);
  const byRole: Record<string, number> = {};
  let total = 0;
  for (const u of users) {
    if (!isBillableSeat(u)) continue;
    byRole[u.role] = (byRole[u.role] ?? 0) + 1;
    total += 1;
  }
  return { total, byRole };
}

/**
 * The calendar day (`YYYY-MM-DD`) in `timezone` at `at`. "en-CA" formats as
 * YYYY-MM-DD in every ICU build. An unknown or empty timezone falls back to
 * UTC rather than throwing: a bad `organizations.timezone` must not stop the
 * whole sweep, and the row records which timezone was used.
 */
export function orgDateFor(timezone: string | null | undefined, at: Date = new Date()): string {
  const tz = (timezone ?? "").trim();
  if (tz) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(at);
    } catch {
      // RangeError: an invalid timezone name. Fall through to UTC.
    }
  }
  return at.toISOString().slice(0, 10);
}

export interface SeatUsage {
  live: SeatCount;
  /** The most recent snapshot, or null before the first sweep has run. */
  snapshot: SeatSnapshot | null;
}

/**
 * What a billing screen shows: the live count AND the latest snapshot with
 * its date. Both, never one pretending to be the other — the live count is
 * what the hospital has now, the snapshot is what an invoice can cite.
 */
export async function seatUsageFor(db: DatabaseStorage, orgId: number): Promise<SeatUsage> {
  const [live, snapshot] = await Promise.all([
    countBillableSeats(db, orgId),
    db.latestSeatSnapshot(orgId),
  ]);
  return { live, snapshot: snapshot ?? null };
}

/** Write (or correct) one org's snapshot for its own current day. */
export async function snapshotOrg(
  db: DatabaseStorage,
  org: Organization,
  at: Date = new Date(),
): Promise<SeatSnapshot> {
  const count = await countBillableSeats(db, org.id);
  return db.upsertSeatSnapshot({
    organizationId: org.id,
    snapshotDate: orgDateFor(org.timezone, at),
    seatCount: count.total,
    breakdown: count.byRole,
    timezone: (org.timezone ?? "").trim() || "UTC",
  });
}

export interface SeatSnapshotSweepResult {
  written: number;
  skipped: number;
  failed: number;
}

/**
 * One tick: every tenant organization's current local day. A single org's
 * failure is logged (type only, no tenant identity beyond its id) and the
 * sweep carries on — one bad row must not cost every other hospital its
 * billing history.
 */
export async function runSeatSnapshotSweep(at: Date = new Date()): Promise<SeatSnapshotSweepResult> {
  const db = storage();
  const orgs = await db.listOrganizations();
  const out: SeatSnapshotSweepResult = { written: 0, skipped: 0, failed: 0 };
  for (const org of orgs) {
    if (isPlatformOrg(org)) {
      out.skipped += 1;
      continue;
    }
    try {
      await snapshotOrg(db, org, at);
      out.written += 1;
    } catch (err) {
      out.failed += 1;
      console.error(`[billing] seat snapshot failed for org ${org.id}`, err);
    }
  }
  return out;
}

/* ── the one timer (job lease: "seat-snapshot") ──────────────────────────── */

let timer: LeasedTimer | null = null;

/** Hourly, lease-guarded: with N instances exactly one writes each tick. */
export function startSeatSnapshotLoop(intervalMs = 3_600_000) {
  if (timer) return;
  timer = startLeasedInterval("seat-snapshot", intervalMs, () => runSeatSnapshotSweep(), {
    // A fresh deployment has a snapshot within a minute instead of an hour.
    bootDelayMs: 30_000,
  });
}
export function stopSeatSnapshotLoop() {
  if (timer) {
    timer.stop();
    timer = null;
  }
}
