import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestContext } from "./helpers.js";
import {
  JOB_NAMES,
  LEASE_FRACTION,
  leaseMsFor,
  leasedTimers,
  runLeasedTick,
  startLeasedInterval,
  stopAllLeasedTimers,
} from "../server/services/job-leases.js";
import { startExpiryLoop, stopExpiryLoop, startAutoCleanLoop, stopAutoCleanLoop } from "../server/services/expiry.js";
import { startAmionSyncLoop, stopAmionSyncLoop } from "../server/services/amion.js";
import { startEpicSyncLoop, stopEpicSyncLoop } from "../server/services/schedule-sources/epic-fhir.js";
import { startStatEscalationLoop, stopStatEscalationLoop } from "../server/services/escalation.js";
import { startUnreadReminderLoop, stopUnreadReminderLoop } from "../server/services/unread-reminder.js";
import { startRetentionLoop, stopRetentionLoop } from "../server/services/retention.js";
import { startSeatSnapshotLoop, stopSeatSnapshotLoop } from "../server/billing/seats.js";

/**
 * E1 multi-instance safety — background-job leases (docs/ENTERPRISE_READINESS.md).
 *
 * Every timer in server/index.ts claims a `job_leases` row before it runs a
 * tick. Two instances are two HOLDERS of the same table here (one process,
 * one database — the claim is a single atomic statement, so the race is real).
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  stopAllLeasedTimers();
  await ctx.handle.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("job leases — two instances never run the same tick", () => {
  it("of two instances racing for one tick exactly one runs; the other skips", async () => {
    let ran = 0;
    const tick = async () => {
      ran++;
    };
    const outcomes = await Promise.all([
      runLeasedTick("expiry", 60_000, tick, "instance-A"),
      runLeasedTick("expiry", 60_000, tick, "instance-B"),
    ]);
    expect(outcomes.sort()).toEqual(["ran", "skipped"]);
    expect(ran).toBe(1);
    // And a third try while the lease is held skips too.
    expect(await runLeasedTick("expiry", 60_000, tick, "instance-C")).toBe("skipped");
    expect(ran).toBe(1);
    const [lease] = await ctx.storage.listJobLeases();
    expect(lease!.name).toBe("expiry");
    expect(["instance-A", "instance-B"]).toContain(lease!.holder);
  });

  it("a lease lasts 90 % of the interval: a sibling's tick in the same interval skips, the next interval runs", async () => {
    expect(LEASE_FRACTION).toBe(0.9);
    expect(leaseMsFor(1000)).toBe(900);
    let ran = 0;
    const tick = async () => {
      ran++;
    };
    expect(await runLeasedTick("retention", 300, tick, "A")).toBe("ran");
    await sleep(120);
    expect(await runLeasedTick("retention", 300, tick, "B")).toBe("skipped");
    await sleep(200); // past 270 ms
    expect(await runLeasedTick("retention", 300, tick, "B")).toBe("ran");
    expect(ran).toBe(2);
  });

  it("a stale lease (its holder died) is reclaimed by another instance once it lapses", async () => {
    let ran = 0;
    const tick = async () => {
      ran++;
    };
    expect(await runLeasedTick("stat-escalation", 200, tick, "died")).toBe("ran");
    expect(await runLeasedTick("stat-escalation", 200, tick, "survivor")).toBe("skipped");
    await sleep(220);
    expect(await runLeasedTick("stat-escalation", 200, tick, "survivor")).toBe("ran");
    const lease = (await ctx.storage.listJobLeases()).find((l) => l.name === "stat-escalation");
    expect(lease!.holder).toBe("survivor");
    expect(ran).toBe(2);
  });

  it("a failing tick is reported, never thrown, and never poisons the lease", async () => {
    const boom = async () => {
      throw new Error("sweep exploded");
    };
    expect(await runLeasedTick("autoclean", 100, boom, "A")).toBe("failed");
    await sleep(110);
    let ran = 0;
    expect(
      await runLeasedTick(
        "autoclean",
        100,
        async () => {
          ran++;
        },
        "B",
      ),
    ).toBe("ran");
    expect(ran).toBe(1);
  });

  it("releasing an instance's leases hands back only that instance's unexpired ones", async () => {
    const noop = async () => {};
    expect(await runLeasedTick("expiry", 60_000, noop, "A")).toBe("ran");
    expect(await runLeasedTick("retention", 60_000, noop, "A")).toBe("ran");
    expect(await runLeasedTick("autoclean", 60_000, noop, "B")).toBe("ran");
    expect(await ctx.storage.releaseJobLeases("A")).toBe(2);
    // A sibling takes A's jobs over at once; B's own lease is untouched.
    expect(await runLeasedTick("expiry", 60_000, noop, "B")).toBe("ran");
    expect(await runLeasedTick("retention", 60_000, noop, "B")).toBe("ran");
    expect(await runLeasedTick("autoclean", 60_000, noop, "A")).toBe("skipped");
    expect(await ctx.storage.releaseJobLeases("A")).toBe(0);
    expect(await ctx.storage.releaseJobLeases("B")).toBe(3);
  });

  it("startLeasedInterval fires through the lease: a held lease silences the timer, a free one runs it", async () => {
    let ran = 0;
    const tick = async () => {
      ran++;
    };
    // Another instance holds the lease for a long time.
    expect(await runLeasedTick("unread-reminder", 10_000, async () => {}, "other")).toBe("ran");
    const timer = startLeasedInterval("unread-reminder", 25, tick, { holder: "me" });
    expect(leasedTimers()).toEqual(["unread-reminder"]);
    await sleep(150);
    expect(ran).toBe(0);
    timer.stop();
    expect(leasedTimers()).toEqual([]);

    // Free lease: the timer runs (and keeps running on its own cadence).
    expect(await ctx.storage.releaseJobLeases("other")).toBe(1);
    const again = startLeasedInterval("unread-reminder", 25, tick, { holder: "me" });
    await sleep(200);
    expect(ran).toBeGreaterThanOrEqual(1);
    again.stop();
    // Starting the same job twice returns the running timer (idempotent).
    const first = startLeasedInterval("epic-sync", 1000, tick);
    expect(startLeasedInterval("epic-sync", 1000, tick)).toBe(first);
    first.stop();
  });

  it("every background loop in server/index.ts schedules through the lease registry", () => {
    startExpiryLoop();
    startAutoCleanLoop();
    startAmionSyncLoop();
    startEpicSyncLoop();
    startStatEscalationLoop();
    startUnreadReminderLoop();
    startRetentionLoop();
    startSeatSnapshotLoop();
    expect(leasedTimers()).toEqual([...JOB_NAMES].sort());
    stopExpiryLoop();
    stopAutoCleanLoop();
    stopAmionSyncLoop();
    stopEpicSyncLoop();
    stopStatEscalationLoop();
    stopUnreadReminderLoop();
    stopRetentionLoop();
    stopSeatSnapshotLoop();
    expect(leasedTimers()).toEqual([]);
  });
});
