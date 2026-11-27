import { existsSync, readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * THE BILLING SAFETY INVARIANT.
 *
 * DocTurn carries STAT messages and admission routing. Billing must NEVER be
 * able to interrupt patient care, so entitlement checks exist in EXACTLY TWO
 * places: creating a SEAT (a new user) and creating a new ORGANIZATION.
 * Nothing else is ever gated by billing — not messaging, not STAT, not
 * escalation, not broadcasts, not assignments, not on-call, not the schedule,
 * not sign-in. A lapsed contract degrades to warnings and "cannot add seats",
 * never to a clinician unable to send or receive.
 *
 * Two halves, both of which must keep passing for every later commit:
 *
 *  (a) STATIC — the entitlement module (server/billing/entitlements.ts) is
 *      imported by an EXACT allow-list of files. Not "the clinical files do
 *      not import it" (which a new file could quietly break) but "these files
 *      and no others", so adding the import anywhere else fails this test.
 *  (b) BEHAVIOURAL — an organization whose contract is past_due, and one whose
 *      contract is expired, can still sign in, send a STAT message, raise a
 *      STAT, route an admission, acknowledge a broadcast and read the on-call
 *      board. Only adding a seat is refused.
 *
 * ENTITLEMENT_IMPORTERS is the allow-list. Every entry is a place a seat or an
 * organization is created:
 *   server/routes/providers.ts — a director / ER director adds an account
 *   server/auth.ts             — a director approves a pending registration
 *   server/routes/dev.ts       — the operator creates a user or an organization
 *   server/routes/accounts.ts  — a director REACTIVATES a deactivated account
 *                                (a deactivated account is not a seat, so
 *                                restoring one creates a seat)
 * Plus the billing surfaces that READ the same computation to show it:
 *   server/routes/billing.ts, server/routes/dev-billing.ts
 *
 * Deliberately NOT on the list: server/services/provisioning.ts (SCIM and
 * SSO just-in-time accounts) and server/services/amion.ts (schedule-sync
 * accounts). An identity provider or a schedule feed that was refused would
 * strand a clinician outside DocTurn's own UI, so those paths are never
 * refused; the extra seats show up in the next snapshot and on the invoice as
 * an overage line. See docs/BILLING.md.
 */

const ENTITLEMENT_MODULE = "server/billing/entitlements.ts";

const ENTITLEMENT_IMPORTERS = [
  "server/auth.ts",
  "server/routes/accounts.ts",
  "server/routes/billing.ts",
  "server/routes/dev-billing.ts",
  "server/routes/dev.ts",
  "server/routes/providers.ts",
];

/** Files that must NEVER reference billing at all (the care paths). */
const CARE_PATH_FILES = [
  "server/routes/messaging.ts",
  "server/routes/broadcasts.ts",
  "server/routes/assignments.ts",
  "server/routes/oncall.ts",
  "server/routes/er.ts",
  "server/routes/admissions.ts",
  "server/services/escalation.ts",
  "server/services/notifications.ts",
  "server/services/rotation.ts",
  "server/services/assignments.ts",
  "server/services/provisioning.ts",
];

const ROOT = new URL("..", import.meta.url).pathname;

function serverSources(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(ROOT + rel, { withFileTypes: true })) {
      const next = rel + "/" + entry.name;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".ts")) out.push(next.replace(/^\//, ""));
    }
  };
  walk("server");
  return out.sort();
}

/** Any import/require of the entitlement module, however it is spelled. */
const ENTITLEMENT_IMPORT_RE = /["'][^"']*billing\/entitlements(\.js)?["']/;

describe("billing safety invariant — static: the entitlement module has exactly two callers' worth of importers", () => {
  it("the entitlement module exists at the one expected path", () => {
    expect(
      existsSync(ROOT + ENTITLEMENT_MODULE),
      `${ENTITLEMENT_MODULE} must be the ONE module that decides a billing refusal`,
    ).toBe(true);
  });

  it("exactly the allow-listed files import it", () => {
    const importers = serverSources()
      .filter((f) => !f.startsWith("server/billing/"))
      .filter((f) => ENTITLEMENT_IMPORT_RE.test(readFileSync(ROOT + f, "utf8")));
    expect(importers.sort()).toEqual([...ENTITLEMENT_IMPORTERS].sort());
  });

  it("no care path mentions billing or entitlements at all", () => {
    const offenders = CARE_PATH_FILES.filter((f) => {
      const src = readFileSync(ROOT + f, "utf8");
      return /["'][^"']*\/billing\//.test(src) || /entitlement/i.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("no GATE_TABLE rule gates a care path with a billing module", async () => {
    const { GATE_TABLE } = await import("../server/modules.js");
    const billingRules = GATE_TABLE.filter((r) => r.module.startsWith("billing"));
    // Every billing gate rule may only cover /api/billing*.
    for (const r of billingRules) {
      for (const p of [
        "/api/messaging/send",
        "/api/broadcasts",
        "/api/assignments",
        "/api/oncall/board",
        "/api/admissions",
        "/api/er/diversion",
        "/api/login",
        "/api/shift/end",
        "/api/rotation/next",
      ]) {
        expect(r.path.test(p), `${String(r.path)} must not gate ${p}`).toBe(false);
      }
    }
  });
});

describe("billing safety invariant — behavioural: a lapsed contract never interrupts care", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(async () => {
    await ctx.handle.close();
  });

  async function putOnLapsedContract(status: "past_due" | "expired") {
    const plan = await ctx.storage.createBillingPlan({
      code: "inv-test-" + status,
      name: "Invariant test plan",
      moduleIds: [],
      perSeatPriceCents: 1500,
      currency: "USD",
    });
    return ctx.storage.upsertOrgContract({
      organizationId: ctx.seedResult.orgId,
      planId: plan.id,
      term: "monthly",
      startDate: "2026-01-01",
      endDate: status === "expired" ? "2026-01-31" : null,
      committedSeats: 1, // already over: the seeded org has more than one seat
      priceOverrideCents: null,
      poNumber: null,
      billingContactName: null,
      billingContactEmail: null,
      status,
      pastDueAt: status === "past_due" ? new Date("2026-01-01T00:00:00Z") : null,
      createdBy: null,
    });
  }

  for (const status of ["past_due", "expired"] as const) {
    it(`${status}: sign-in, STAT send, admission routing, broadcast ack and the on-call board all still work`, async () => {
      await putOnLapsedContract(status);

      // Sign-in itself is never gated.
      const { agent: er, res: erLogin } = await login(ctx.app, { username: "er.doc" });
      expect(erLogin.status).toBe(200);
      const { agent: chen } = await login(ctx.app, { username: "chen" });
      const { agent: director } = await login(ctx.app, { username: "director" });

      // A STAT message to a hospitalist.
      const convo = await er
        .post("/api/messaging/conversations")
        .send({ type: "direct", participantIds: [ctx.seedResult.userIds.chen!] });
      expect(convo.status).toBeLessThan(300);
      const stat = await er
        .post("/api/messaging/send")
        .send({ conversationId: convo.body.id, content: "Bed 4 crashing", priority: "stat" });
      expect(stat.status, "a STAT message must never be refused for billing").toBe(201);

      // Admission routing: a patient and a round-robin assignment.
      const patient = await er
        .post("/api/patients")
        .send({ initials: "QQ", roomNumber: "101", issueSummary: "test" });
      expect(patient.status).toBe(201);
      const assignment = await er
        .post("/api/assignments")
        .send({ patientId: patient.body.id, mode: "round_robin" });
      expect(assignment.status, "admission routing must never be refused for billing").toBe(201);
      const accepted = await chen.patch(`/api/assignments/${assignment.body.id}/accept`);
      expect(accepted.status).toBe(200);

      // A broadcast, and a clinician acknowledging it.
      const broadcast = await director
        .post("/api/broadcasts")
        .send({ message: "Mass-casualty drill", severity: "critical" });
      expect(broadcast.status).toBe(201);
      await chen.post(`/api/broadcasts/${broadcast.body.id}/ack`).expect(204);

      // The on-call board and the escalation-facing on-call targets.
      await chen.get("/api/oncall/board").expect(200);
      await er.get("/api/messaging/on-call-targets").expect(200);

      // ONLY adding a seat is refused — and for the director, with a reason.
      const refused = await director
        .post("/api/director/hospitalists")
        .send({ username: "new.doc." + status, displayName: "Dr. New", role: "hospitalist" });
      expect(refused.status).toBe(402);
      expect(refused.body.error).toBe("seat_refused");
    });
  }
});
