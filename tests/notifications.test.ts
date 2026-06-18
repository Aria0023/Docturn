import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, type TestContext } from "./helpers.js";
import {
  acknowledgeAssignment,
  notifyAssignment,
} from "../server/services/notifications.js";
import { getNotificationProfile, invalidateConfig } from "../server/config.js";
import type { Assignment } from "@shared/schema";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  vi.useRealTimers();
  await ctx.handle.close();
});

function fakeAssignment(): Assignment {
  return {
    id: 9999,
    organizationId: ctx.seedResult.orgId,
    patientId: ctx.seedResult.patientIds.sc!,
    hospitalistId: ctx.seedResult.hospitalistIds.chen!,
    erDoctorId: ctx.seedResult.userIds["er.doc"]!,
    status: "pending",
    via: "round_robin",
    acceptedByUserId: null,
    expiresAt: new Date(Date.now() + 600000),
    createdAt: new Date(),
    resolvedAt: null,
  };
}

async function setProfile(mode: string, carrier = "console") {
  await ctx.storage.setOrgSetting(
    ctx.seedResult.orgId,
    "notification_profile",
    { mode, smsCarrier: carrier, ackTimeoutSec: 90, escalationTimeoutSec: 180 },
    ctx.seedResult.userIds.director!,
  );
  // Warm the config cache with real timers so the DB read doesn't run under
  // fake timers later, and reflects this test's profile (not a stale one).
  invalidateConfig(ctx.seedResult.orgId);
  await getNotificationProfile(ctx.seedResult.orgId);
}

describe("notification delivery & escalation", () => {
  it("push-first: WS + one content-free push, no SMS in push mode", async () => {
    await setProfile("push");
    const chenUserId = ctx.seedResult.userIds.chen!;
    vi.useFakeTimers();
    await notifyAssignment(fakeAssignment(), [chenUserId]);

    // WS got the assignment; push fired; no PHI in the push title.
    expect(ctx.ws.delivered.some((d) => (d.message as any).type === "ASSIGNMENT_CREATED")).toBe(true);
    expect(ctx.push.sent.length).toBeGreaterThanOrEqual(1);
    expect(ctx.push.sent[0]!.title).toBe("New assignment");

    // Advance well past escalation; push mode must NOT send SMS.
    await vi.advanceTimersByTimeAsync(200_000);
    expect(ctx.sms.sent.length).toBe(0);
  });

  it("escalates to SMS when unacknowledged past the timeout (push_sms)", async () => {
    await setProfile("push_sms");
    const chenUserId = ctx.seedResult.userIds.chen!;
    // Give Chen a phone so SMS escalation has a destination.
    await ctx.storage.updateUser(chenUserId, { phone: "+15551234567" });

    vi.useFakeTimers();
    await notifyAssignment(fakeAssignment(), [chenUserId]);
    await vi.advanceTimersByTimeAsync(200_000);

    expect(ctx.sms.sent.length).toBe(1);
    // No PHI in the SMS body.
    expect(ctx.sms.sent[0]!.body).not.toMatch(/SC|204|chest/i);
  });

  it("acknowledging before the timeout sends zero SMS", async () => {
    await setProfile("push_sms");
    const chenUserId = ctx.seedResult.userIds.chen!;
    await ctx.storage.updateUser(chenUserId, { phone: "+15551234567" });

    vi.useFakeTimers();
    const a = fakeAssignment();
    await notifyAssignment(a, [chenUserId]);
    acknowledgeAssignment(a.id);
    await vi.advanceTimersByTimeAsync(200_000);

    expect(ctx.sms.sent.length).toBe(0);
  });
});
