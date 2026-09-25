import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app.js";
import { CONTROLS, MANUAL_CONTROL_IDS } from "../server/compliance/controls.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * Continuous control monitor: GET /api/compliance/status (live checks),
 * PATCH /api/compliance/attestation (manual controls), and
 * GET /api/compliance/evidence (auditor evidence pack).
 *
 * The point of these tests is that the checks are REAL: flipping the actual
 * runtime input (SESSION_SECRET, RATE_LIMIT) must flip the reported status.
 */
let ctx: TestContext;

const ENV_KEYS = ["SESSION_SECRET", "RATE_LIMIT", "SYNTHETIC_DATA"] as const;
let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(async () => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  ctx = await createTestApp();
});
afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k] as string;
  }
  await ctx.handle.close();
});

interface ControlRow {
  id: string;
  status: string;
  detail: string;
  kind: "auto" | "manual";
  hipaa: string[];
  soc2: string[];
  remediation: string;
}

async function status(agent: import("supertest").Agent) {
  const res = await agent.get("/api/compliance/status");
  expect(res.status).toBe(200);
  return res.body as {
    generatedAt: string;
    mode: { synthetic: boolean; label: string };
    summary: {
      pass: number;
      warn: number;
      fail: number;
      manual: number;
      unknown: number;
      total: number;
      readinessPct: number;
    };
    controls: ControlRow[];
  };
}

const byId = (body: { controls: ControlRow[] }, id: string) => {
  const row = body.controls.find((c) => c.id === id);
  expect(row, `control ${id} missing from the report`).toBeTruthy();
  return row!;
};

describe("compliance monitor — access control", () => {
  it("requires authentication on every endpoint", async () => {
    await supertest(ctx.app).get("/api/compliance/status").expect(401);
    await supertest(ctx.app).get("/api/compliance/evidence").expect(401);
    await supertest(ctx.app)
      .patch("/api/compliance/attestation")
      .send({ controlId: "risk-analysis", status: "met" })
      .expect(401);
  });

  it("forbids a non-privileged clinical role", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.get("/api/compliance/status").expect(403);
    await chen.get("/api/compliance/evidence").expect(403);
    await chen
      .patch("/api/compliance/attestation")
      .send({ controlId: "risk-analysis", status: "met" })
      .expect(403);
  });

  it("allows the director", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    await agent.get("/api/compliance/status").expect(200);
  });
});

describe("compliance monitor — live status", () => {
  it("returns the full catalog with a real status on every control", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const body = await status(agent);

    expect(body.controls).toHaveLength(CONTROLS.length);
    const allowed = ["pass", "warn", "fail", "manual", "unknown"];
    for (const c of body.controls) {
      expect(allowed).toContain(c.status);
      // Every control must explain itself — an empty detail is a fake result.
      expect(c.detail.length).toBeGreaterThan(20);
      expect(c.remediation.length).toBeGreaterThan(10);
      expect(c.hipaa.length + c.soc2.length).toBeGreaterThan(0);
    }
    // Counts must add up to the catalog size.
    const { pass, warn, fail, manual, unknown } = body.summary;
    expect(pass + warn + fail + manual + unknown).toBe(CONTROLS.length);
    expect(body.summary.readinessPct).toBe(
      Math.round((pass / CONTROLS.length) * 100),
    );
    expect(body.mode.label).toBe("SYNTHETIC");
  });

  it("never reports every control as passing — the manual ones start unanswered", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const body = await status(agent);
    // No org has attested anything yet, so every manual control must be
    // "manual" (needs a human), not silently green.
    for (const id of MANUAL_CONTROL_IDS) {
      expect(byId(body, id).status).toBe("manual");
    }
    // Plus the automated checks that legitimately refuse to conclude — the
    // hosting-tier ones (encryption at rest) are "manual" by design.
    const autoManual = body.controls.filter(
      (c) => c.kind === "auto" && c.status === "manual",
    );
    expect(autoManual.map((c) => c.id)).toContain("encryption-at-rest");
    expect(body.summary.manual).toBe(
      MANUAL_CONTROL_IDS.length + autoManual.length,
    );
    expect(body.summary.readinessPct).toBeLessThan(100);
  });

  it("session-secret FAILS when SESSION_SECRET is unset and PASSES when it is long enough", async () => {
    const { agent } = await login(ctx.app, { username: "director" });

    delete process.env.SESSION_SECRET;
    const unset = byId(await status(agent), "session-secret");
    expect(unset.status).toBe("fail");
    expect(unset.detail).toMatch(/not set/i);

    process.env.SESSION_SECRET = "a".repeat(20);
    const tooShort = byId(await status(agent), "session-secret");
    expect(tooShort.status).toBe("fail");
    expect(tooShort.detail).toMatch(/20 characters/);

    const secret = "s".repeat(48);
    process.env.SESSION_SECRET = secret;
    const set = byId(await status(agent), "session-secret");
    expect(set.status).toBe("pass");
    expect(set.detail).toContain("48 characters");
    // The secret's VALUE must never leave the process.
    expect(JSON.stringify(set)).not.toContain(secret);
  });

  it("auth-rate-limit FAILS while limiters are off and PASSES once they are mounted", async () => {
    const { agent } = await login(ctx.app, { username: "director" });

    // The test harness builds the app with rateLimiting:false — the check must
    // report that honestly rather than assuming limits are on.
    const harness = byId(await status(agent), "auth-rate-limit");
    expect(harness.status).toBe("fail");

    // RATE_LIMIT=off (how the Render deploy currently runs) → still a failure,
    // and the reason names the environment variable.
    process.env.RATE_LIMIT = "off";
    createApp({ sessionSecret: "x".repeat(40) });
    const envOff = byId(await status(agent), "auth-rate-limit");
    expect(envOff.status).toBe("fail");
    expect(envOff.detail).toContain("RATE_LIMIT");

    // Limiters actually mounted → pass.
    delete process.env.RATE_LIMIT;
    createApp({ sessionSecret: "x".repeat(40) });
    const on = byId(await status(agent), "auth-rate-limit");
    expect(on.status).toBe("pass");
  });

  it("computes password-hash and MFA controls from real user rows", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const body = await status(agent);

    const users = await ctx.storage.listUsers(ctx.seedResult.orgId);
    const pwd = byId(body, "pwd-hashing");
    expect(pwd.status).toBe("pass");
    expect(pwd.detail).toContain(String(users.length));

    // Nobody is enrolled in the seed, so this must NOT be green.
    const mfa = byId(body, "mfa-enrollment");
    expect(mfa.status).toBe("warn");
    expect(mfa.detail).toContain(`of ${users.length} users have MFA enabled`);
  });

  it("proves tenant isolation with a live probe against the other seeded tenant", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const iso = byId(await status(agent), "tenant-isolation");
    expect(iso.status).toBe("pass");
    expect(iso.detail).toContain(`organizationId=${ctx.seedResult.orgId}`);
  });

  it("reports encryption-at-rest as manual even though the check runs", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const row = byId(await status(agent), "encryption-at-rest");
    expect(row.status).toBe("manual");
    expect(row.detail).toMatch(/human must confirm|A human must/i);
  });
});

describe("compliance monitor — attestations", () => {
  it("persists an attestation, flips the control, and writes an audit row", async () => {
    const { agent } = await login(ctx.app, { username: "director" });

    const before = byId(await status(agent), "risk-analysis");
    expect(before.status).toBe("manual");

    const res = await agent.patch("/api/compliance/attestation").send({
      controlId: "risk-analysis",
      status: "met",
      owner: "Dana Director",
      note: "Annual risk analysis completed with outside counsel.",
      evidenceUrl: "https://example.org/risk-analysis-2026.pdf",
      reviewDue: "2027-01-31",
    });
    expect(res.status).toBe(200);
    expect(res.body.controlId).toBe("risk-analysis");
    expect(res.body.organizationId).toBe(ctx.seedResult.orgId);
    expect(res.body.attestedAt).toBeTruthy();

    const after = byId(await status(agent), "risk-analysis");
    expect(after.status).toBe("pass");
    expect(after.detail).toContain("Dana Director");
    // The report must keep flagging that this is a human assertion.
    expect(after.detail).toMatch(/HUMAN assertion/);

    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    const row = audit.find(
      (a) => a.action === "compliance.attestation_updated",
    );
    expect(row).toBeTruthy();
    expect(row!.riskLevel).toBe("medium");
    expect(row!.details).toMatchObject({
      controlId: "risk-analysis",
      status: "met",
    });
    // The free-text note and evidence URL must not be copied into the audit row.
    expect(JSON.stringify(row!.details)).not.toContain("outside counsel");
  });

  it("upserts rather than duplicating, and marks a stale review as a warning", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    await agent
      .patch("/api/compliance/attestation")
      .send({ controlId: "backup-tested", status: "met", owner: "Ops" })
      .expect(200);
    await agent
      .patch("/api/compliance/attestation")
      .send({
        controlId: "backup-tested",
        status: "met",
        owner: "Ops",
        reviewDue: "2020-01-01",
      })
      .expect(200);

    const rows = await ctx.storage.listAttestations(ctx.seedResult.orgId);
    expect(rows.filter((r) => r.controlId === "backup-tested")).toHaveLength(1);

    const row = byId(await status(agent), "backup-tested");
    expect(row.status).toBe("warn");
    expect(row.detail).toMatch(/review date has passed|stale/i);
  });

  it("refuses to attest an AUTOMATED control", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const res = await agent
      .patch("/api/compliance/attestation")
      .send({ controlId: "auth-rate-limit", status: "met" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("control_is_automated");
  });

  it("rejects an unknown control id and an invalid body", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    await agent
      .patch("/api/compliance/attestation")
      .send({ controlId: "not-a-control", status: "met" })
      .expect(404);
    await agent
      .patch("/api/compliance/attestation")
      .send({ controlId: "risk-analysis", status: "totally-fine" })
      .expect(400);
    await agent
      .patch("/api/compliance/attestation")
      .send({ controlId: "risk-analysis", status: "met", evidenceUrl: "not a url" })
      .expect(400);
  });

  it("is org-scoped — one tenant never sees or overwrites another's attestation", async () => {
    const { agent: ispn } = await login(ctx.app, { username: "director" });
    const { agent: platform } = await login(ctx.app, {
      orgCode: "DOCTURN",
      username: "dev",
    });

    await ispn
      .patch("/api/compliance/attestation")
      .send({
        controlId: "workforce-training",
        status: "met",
        owner: "ISPN HR",
      })
      .expect(200);

    // The other tenant still sees the control as unanswered.
    const other = byId(await status(platform), "workforce-training");
    expect(other.status).toBe("manual");

    // …and writing its own row does not touch ISPN's.
    await platform
      .patch("/api/compliance/attestation")
      .send({
        controlId: "workforce-training",
        status: "not_met",
        owner: "Platform",
      })
      .expect(200);

    const ispnRows = await ctx.storage.listAttestations(ctx.seedResult.orgId);
    const ispnRow = ispnRows.find((r) => r.controlId === "workforce-training");
    expect(ispnRow!.status).toBe("met");
    expect(ispnRow!.owner).toBe("ISPN HR");

    const platformRows = await ctx.storage.listAttestations(
      ctx.seedResult.platformOrgId,
    );
    expect(platformRows.find((r) => r.controlId === "workforce-training")!.status).toBe(
      "not_met",
    );

    expect(byId(await status(ispn), "workforce-training").status).toBe("pass");
    expect(byId(await status(platform), "workforce-training").status).toBe("fail");
  });
});

describe("compliance monitor — evidence pack", () => {
  it("includes the scope & limitations section and audits the export", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const res = await agent.get("/api/compliance/evidence");
    expect(res.status).toBe(200);

    const pack = res.body as Record<string, any>;
    expect(pack.scopeAndLimitations).toBeTruthy();
    expect(Array.isArray(pack.scopeAndLimitations.limitations)).toBe(true);
    expect(pack.scopeAndLimitations.limitations.length).toBeGreaterThan(4);
    expect(JSON.stringify(pack.scopeAndLimitations)).toMatch(
      /HIPAA has no certification/,
    );
    expect(JSON.stringify(pack.scopeAndLimitations)).toMatch(/licensed CPA/);
    expect(pack.scopeAndLimitations.readinessFormula).toBeTruthy();

    expect(pack.controls).toHaveLength(CONTROLS.length);
    expect(pack.auditLogStatistics.totalEvents).toBeGreaterThan(0);
    expect(pack.attestationRegister).toEqual([]);

    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    const row = audit.find((a) => a.action === "compliance.evidence_exported");
    expect(row).toBeTruthy();
    expect(row!.riskLevel).toBe("medium");
  });

  it("contains no PHI — no patient rows, identifiers or raw audit rows", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    // Create a patient with a distinctive identifier and a clinical note, then
    // export and assert none of it can appear in the pack.
    const created = await er.post("/api/patients").send({
      initials: "ZQX",
      roomNumber: "ER-99",
      issueSummary: "chest pain radiating to jaw",
    });
    expect(created.status).toBe(201);

    const { agent } = await login(ctx.app, { username: "director" });
    const res = await agent.get("/api/compliance/evidence").expect(200);
    const raw = JSON.stringify(res.body);

    for (const needle of ["ZQX", "ER-99", "chest pain", "radiating"]) {
      expect(raw).not.toContain(needle);
    }
    // Aggregate audit statistics only — never the rows themselves.
    expect(res.body.auditLogStatistics.countsByAction).toBeTruthy();
    expect(res.body).not.toHaveProperty("auditLogs");
    expect(raw).not.toContain('"resourceId"');
    expect(res.body.phiStatement).toMatch(/no protected health information/i);
  });

  it("reports the patient count only as an aggregate, never as rows", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const res = await agent.get("/api/compliance/evidence").expect(200);
    const phiControl = (res.body.controls as Array<{ id: string; evidence: any }>).find(
      (c) => c.id === "phi-access-logging",
    );
    expect(typeof phiControl!.evidence.patients).toBe("number");
    expect(phiControl!.evidence).not.toHaveProperty("patientIds");
  });
});
