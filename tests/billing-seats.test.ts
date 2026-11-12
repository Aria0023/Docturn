import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { BILLABLE_SEAT_ROLES, isBillableSeatRole } from "@shared/billing";
import {
  countBillableSeats,
  isBillableSeat,
  orgDateFor,
  runSeatSnapshotSweep,
  seatUsageFor,
} from "../server/billing/seats.js";
import { JOB_NAMES } from "../server/services/job-leases.js";

/**
 * Billing feature 1 — SEATS.
 *
 * A billable seat is a user in a TENANT organization who is not deactivated
 * and whose role is not `developer`. The platform organization (DOCTURN) is
 * never billed. The definition lives in ONE function so the SCIM path, the
 * People-screen path and the invoice can never disagree.
 *
 * `seat_snapshots` is written by one job-lease timer; the snapshot's DATE is
 * the day in the ORGANIZATION's own timezone, because that is the day a
 * hospital will argue about ("you charged me for 47 seats on 3 March").
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

describe("the seat definition — one function, used everywhere", () => {
  it("every role except developer is a billable seat role", () => {
    expect([...BILLABLE_SEAT_ROLES].sort()).toEqual(
      ["director", "er_director", "er_doctor", "hospitalist"].sort(),
    );
    expect(isBillableSeatRole("developer")).toBe(false);
    expect(isBillableSeatRole("hospitalist")).toBe(true);
    expect(isBillableSeatRole("nonsense")).toBe(false);
  });

  it("a deactivated user is not a seat; a developer is never a seat", () => {
    const base = { organizationId: 2, role: "hospitalist", disabledAt: null } as never;
    expect(isBillableSeat(base)).toBe(true);
    expect(isBillableSeat({ organizationId: 2, role: "hospitalist", disabledAt: new Date() } as never)).toBe(false);
    expect(isBillableSeat({ organizationId: 2, role: "developer", disabledAt: null } as never)).toBe(false);
  });

  it("counts the seeded tenant, and never the platform organization", async () => {
    const tenant = await countBillableSeats(ctx.storage, ctx.seedResult.orgId);
    expect(tenant.total).toBeGreaterThan(0);
    expect(tenant.total).toBe(
      Object.values(tenant.byRole).reduce((a, b) => a + b, 0),
    );
    expect(tenant.byRole.developer).toBeUndefined();

    // The platform org holds the operator's own developer account(s) only.
    const platform = await countBillableSeats(ctx.storage, ctx.seedResult.platformOrgId);
    expect(platform.total).toBe(0);
  });

  it("deactivating someone through the ordinary account route drops the count by one", async () => {
    const before = (await countBillableSeats(ctx.storage, ctx.seedResult.orgId)).total;
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.post(`/api/accounts/${ctx.seedResult.userIds.chen}/deactivate`).expect(200);
    const after = (await countBillableSeats(ctx.storage, ctx.seedResult.orgId)).total;
    expect(after).toBe(before - 1);
  });
});

describe("the org's own day", () => {
  it("formats the calendar date in the organization's timezone", () => {
    // 2026-03-03T04:30Z is still 2 March in New York and already 3 March in UTC.
    const at = new Date("2026-03-03T04:30:00Z");
    expect(orgDateFor("America/New_York", at)).toBe("2026-03-02");
    expect(orgDateFor("UTC", at)).toBe("2026-03-03");
    expect(orgDateFor("Asia/Tokyo", at)).toBe("2026-03-03");
  });

  it("falls back to UTC for a timezone the platform does not know", () => {
    const at = new Date("2026-03-03T04:30:00Z");
    expect(orgDateFor("Mars/Olympus_Mons", at)).toBe("2026-03-03");
    expect(orgDateFor("", at)).toBe("2026-03-03");
  });
});

describe("seat snapshots", () => {
  it("the sweep writes one row per tenant org for the org's own day, and is idempotent", async () => {
    const at = new Date("2026-03-03T12:00:00Z");
    const first = await runSeatSnapshotSweep(at);
    expect(first.written).toBeGreaterThan(0);

    const orgId = ctx.seedResult.orgId;
    const org = await ctx.storage.getOrganization(orgId);
    const day = orgDateFor(org!.timezone, at);
    const row = await ctx.storage.getSeatSnapshot(orgId, day);
    expect(row).toBeTruthy();
    expect(row!.seatCount).toBe((await countBillableSeats(ctx.storage, orgId)).total);
    expect(row!.timezone).toBe(org!.timezone);
    expect(row!.breakdown.hospitalist).toBeGreaterThan(0);

    // The platform org is never snapshotted: it is never billed.
    const platformRows = await ctx.storage.listSeatSnapshots(ctx.seedResult.platformOrgId, 10);
    expect(platformRows).toEqual([]);

    // Running it again the same day updates the one row instead of adding another.
    await runSeatSnapshotSweep(at);
    const rows = await ctx.storage.listSeatSnapshots(orgId, 50);
    expect(rows.filter((r) => r.snapshotDate === day)).toHaveLength(1);
  });

  it("re-running after a deactivation corrects the same day's row", async () => {
    const at = new Date("2026-03-03T12:00:00Z");
    await runSeatSnapshotSweep(at);
    const orgId = ctx.seedResult.orgId;
    const org = await ctx.storage.getOrganization(orgId);
    const day = orgDateFor(org!.timezone, at);
    const before = (await ctx.storage.getSeatSnapshot(orgId, day))!.seatCount;

    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.post(`/api/accounts/${ctx.seedResult.userIds.chen}/deactivate`).expect(200);
    await runSeatSnapshotSweep(at);
    const after = (await ctx.storage.getSeatSnapshot(orgId, day))!.seatCount;
    expect(after).toBe(before - 1);
  });

  it("seatUsageFor reports the live count with the latest snapshot and its date", async () => {
    const at = new Date("2026-03-03T12:00:00Z");
    await runSeatSnapshotSweep(at);
    const usage = await seatUsageFor(ctx.storage, ctx.seedResult.orgId);
    expect(usage.live.total).toBeGreaterThan(0);
    expect(usage.snapshot).toBeTruthy();
    expect(usage.snapshot!.snapshotDate).toBe("2026-03-03");
  });

  it("the snapshot job has a lease name of its own", () => {
    expect(JOB_NAMES).toContain("seat-snapshot");
  });

  it("snapshots are listed newest-day first and bounded by range", async () => {
    for (const day of ["2026-03-01", "2026-03-02", "2026-03-03"]) {
      await ctx.storage.upsertSeatSnapshot({
        organizationId: ctx.seedResult.orgId,
        snapshotDate: day,
        seatCount: day === "2026-03-02" ? 47 : 40,
        breakdown: { hospitalist: 40 },
        timezone: "America/New_York",
      });
    }
    const all = await ctx.storage.listSeatSnapshots(ctx.seedResult.orgId, 50);
    expect(all.map((r) => r.snapshotDate)).toEqual(["2026-03-03", "2026-03-02", "2026-03-01"]);
    const ranged = await ctx.storage.listSeatSnapshotsInRange(
      ctx.seedResult.orgId,
      "2026-03-02",
      "2026-03-03",
    );
    expect(ranged.map((r) => r.snapshotDate)).toEqual(["2026-03-02", "2026-03-03"]);
    expect(ranged.find((r) => r.snapshotDate === "2026-03-02")!.seatCount).toBe(47);
  });

  it("a tenant with seat snapshots still deletes atomically, and its snapshots go", async () => {
    const doomed = await ctx.storage.createOrganization({
      name: "Doomed General", code: "DOOM", city: null, state: null,
      timezone: "America/New_York", assignmentTimeoutMin: 10,
      roundRobinShiftTypes: ["day"], rotationMode: "lowest_census", rotationIndex: 0,
    });
    await ctx.storage.createUser({
      organizationId: doomed.id, username: "doomed.doc", passwordHash: "x",
      role: "hospitalist", displayName: "Doomed Doc", credential: "MD",
      phone: null, twoFactorEnabled: false,
    });
    await runSeatSnapshotSweep(new Date("2026-03-03T12:00:00Z"));
    expect(await ctx.storage.listSeatSnapshots(doomed.id, 10)).toHaveLength(1);

    const { agent: dev } = await login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
    await dev.delete(`/api/dev/organizations/${doomed.id}?force=true`).expect(204);

    expect(await ctx.storage.getOrganization(doomed.id)).toBeUndefined();
    expect(await ctx.storage.listSeatSnapshots(doomed.id, 10)).toEqual([]);
  });

  it("snapshots are scoped per org: another tenant's rows are never returned", async () => {
    const other = await ctx.storage.createOrganization({
      name: "Other General", code: "OTHR", city: null, state: null,
      timezone: "America/Los_Angeles", assignmentTimeoutMin: 10,
      roundRobinShiftTypes: ["day"], rotationMode: "lowest_census", rotationIndex: 0,
    });
    await ctx.storage.upsertSeatSnapshot({
      organizationId: other.id, snapshotDate: "2026-03-03", seatCount: 99,
      breakdown: { hospitalist: 99 }, timezone: "America/Los_Angeles",
    });
    const mine = await ctx.storage.listSeatSnapshots(ctx.seedResult.orgId, 50);
    expect(mine.every((r) => r.organizationId === ctx.seedResult.orgId)).toBe(true);
    expect(await ctx.storage.getSeatSnapshot(ctx.seedResult.orgId, "2026-03-03")).toBeUndefined();
  });
});
