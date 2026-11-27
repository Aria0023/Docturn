import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { CONTROLS } from "../server/compliance/controls.js";
import {
  POLICY_TEMPLATES,
  listPolicyTemplates,
  renderPolicy,
} from "../server/compliance/policies.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * Policy starter pack: GET /api/compliance/policies (metadata + attestation
 * state) and GET /api/compliance/policies/:controlId (rendered markdown), plus
 * the policyPack section of the evidence export.
 *
 * The load-bearing test here is "every manual control has a template": it is
 * what stops the pack silently drifting out of sync the next time somebody adds
 * a manual control to the catalog.
 */
let ctx: TestContext;

const MANUAL = CONTROLS.filter((c) => c.kind === "manual");
const AUTO = CONTROLS.filter((c) => c.kind === "auto");

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

interface PolicyMetaRow {
  controlId: string;
  title: string;
  hipaa: string[];
  actionRequired: string;
  attested: boolean;
  attestationStatus: string | null;
}

describe("policy pack — access control", () => {
  it("requires authentication on both endpoints", async () => {
    await supertest(ctx.app).get("/api/compliance/policies").expect(401);
    await supertest(ctx.app)
      .get("/api/compliance/policies/risk-analysis")
      .expect(401);
  });

  it("forbids a non-privileged clinical role", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.get("/api/compliance/policies").expect(403);
    await chen.get("/api/compliance/policies/risk-analysis").expect(403);
  });

  it("allows the director", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    await agent.get("/api/compliance/policies").expect(200);
    await agent.get("/api/compliance/policies/risk-analysis").expect(200);
  });
});

describe("policy pack — catalog coverage", () => {
  it("has a template for EVERY manual control in the catalog", async () => {
    const templateIds = new Set(POLICY_TEMPLATES.map((t) => t.controlId));
    const missing = MANUAL.map((c) => c.id).filter((id) => !templateIds.has(id));
    expect(
      missing,
      `manual controls with no policy template: ${missing.join(", ")}`,
    ).toEqual([]);
    expect(POLICY_TEMPLATES).toHaveLength(MANUAL.length);
  });

  it("has NO template for an automated control", () => {
    const templateIds = new Set(POLICY_TEMPLATES.map((t) => t.controlId));
    for (const c of AUTO) expect(templateIds.has(c.id)).toBe(false);
  });

  it("reuses the control's own HIPAA citations and carries real prose", () => {
    for (const t of POLICY_TEMPLATES) {
      const def = CONTROLS.find((c) => c.id === t.controlId)!;
      expect(t.hipaa).toEqual(def.hipaa);
      expect(t.title.length).toBeGreaterThan(8);
      // A starter document, not a stub.
      expect(t.body.split("\n").length).toBeGreaterThan(40);
      expect(t.actionRequired.length).toBeGreaterThan(40);
      // Every template must close with the "this is a template" disclaimer.
      expect(t.body).toMatch(/This is a template, not legal advice/);
      expect(t.body).toMatch(/not legal advice/i);
    }
  });

  it("says plainly that the three PROCESS controls cannot be satisfied by signing", () => {
    for (const id of ["risk-analysis", "backup-tested", "access-review"]) {
      const t = POLICY_TEMPLATES.find((x) => x.controlId === id)!;
      expect(t.actionRequired).toMatch(/do not sign this page/i);
      expect(t.body).toMatch(/process, not a document/i);
    }
    // The risk analysis must point at the free HHS/ONC tool.
    const ra = POLICY_TEMPLATES.find((t) => t.controlId === "risk-analysis")!;
    expect(ra.body).toMatch(/Security Risk Assessment \(SRA\) Tool/);
    expect(ra.body).toMatch(/HealthIT\.gov/);
  });

  it("lists metadata only — never the body", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const res = await agent.get("/api/compliance/policies").expect(200);
    const rows = res.body.policies as PolicyMetaRow[];
    expect(rows).toHaveLength(MANUAL.length);
    for (const row of rows) {
      expect(row.controlId).toBeTruthy();
      expect(row.title).toBeTruthy();
      expect(Array.isArray(row.hipaa)).toBe(true);
      expect(row.actionRequired.length).toBeGreaterThan(40);
      expect(row).not.toHaveProperty("body");
      expect(row).not.toHaveProperty("markdown");
    }
    // Metadata from listPolicyTemplates() must match what the route serves.
    expect(rows.map((r) => r.controlId)).toEqual(
      listPolicyTemplates().map((t) => t.controlId),
    );
  });

  it("annotates each policy with whether the control is attested", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const before = (await agent.get("/api/compliance/policies").expect(200)).body
      .policies as PolicyMetaRow[];
    expect(before.every((r) => r.attested === false)).toBe(true);
    expect(before.every((r) => r.attestationStatus === null)).toBe(true);

    await agent
      .patch("/api/compliance/attestation")
      .send({ controlId: "sanction-policy", status: "in_progress", owner: "HR" })
      .expect(200);

    const after = (await agent.get("/api/compliance/policies").expect(200)).body
      .policies as PolicyMetaRow[];
    const row = after.find((r) => r.controlId === "sanction-policy")!;
    expect(row.attested).toBe(true);
    expect(row.attestationStatus).toBe("in_progress");
    // Every other control is untouched.
    expect(
      after.filter((r) => r.controlId !== "sanction-policy").every((r) => !r.attested),
    ).toBe(true);
  });
});

describe("policy pack — rendering", () => {
  it("substitutes the caller's real organization name and today's date", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const org = await ctx.storage.getOrganization(ctx.seedResult.orgId);
    const res = await agent
      .get("/api/compliance/policies/risk-analysis")
      .expect(200);

    expect(res.body.controlId).toBe("risk-analysis");
    expect(res.body.title).toBeTruthy();
    expect(Array.isArray(res.body.hipaa)).toBe(true);
    expect(res.body.actionRequired).toMatch(/SRA/);
    const md = res.body.markdown as string;
    expect(md).toContain(org!.name);
    expect(md).toContain(new Date().toISOString().slice(0, 10));
    expect(md).toMatch(/45 CFR §164\.308\(a\)\(1\)\(ii\)\(A\)/);
  });

  it("leaves NO unresolved placeholder in ANY rendered template", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    for (const t of POLICY_TEMPLATES) {
      const res = await agent
        .get(`/api/compliance/policies/${t.controlId}`)
        .expect(200);
      const md = res.body.markdown as string;
      const leftovers = md.match(/\{[a-zA-Z][a-zA-Z0-9]*\}/g);
      expect(
        leftovers,
        `${t.controlId} rendered with unresolved placeholders: ${(leftovers || []).join(", ")}`,
      ).toBeNull();
      expect(md.length).toBeGreaterThan(1500);
    }
  });

  it("renderPolicy() fills optional vars with explicit markers, never blanks", () => {
    const out = renderPolicy("access-review", {
      organizationName: "Test Hospital",
      effectiveDate: "2026-01-01",
    })!;
    expect(out.markdown).toContain("Test Hospital");
    expect(out.markdown).toContain("[assign a named owner]");
    expect(out.markdown).toMatch(/DRAFT, not yet approved/);
    expect(out.markdown).not.toMatch(/\{[a-zA-Z]+\}/);
    // Explicit vars win.
    const named = renderPolicy("access-review", {
      organizationName: "Test Hospital",
      effectiveDate: "2026-01-01",
      version: "2.1",
      owner: "Dana Director",
    })!;
    expect(named.markdown).toContain("Dana Director");
    expect(named.markdown).toContain("2.1");
  });

  it("404s an unknown control id and an AUTOMATED control id", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    await agent.get("/api/compliance/policies/not-a-control").expect(404);
    // Policies are for manual controls only — an automated control has none.
    await agent.get("/api/compliance/policies/auth-rate-limit").expect(404);
    await agent.get("/api/compliance/policies/pwd-hashing").expect(404);
    expect(renderPolicy("auth-rate-limit", {
      organizationName: "x",
      effectiveDate: "2026-01-01",
    })).toBeNull();
  });

  it("writes a low-risk compliance.policy_rendered audit row naming the control only", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    await agent.get("/api/compliance/policies/incident-response-plan").expect(200);

    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    const row = audit.find((a) => a.action === "compliance.policy_rendered");
    expect(row).toBeTruthy();
    expect(row!.riskLevel).toBe("low");
    expect(row!.organizationId).toBe(ctx.seedResult.orgId);
    expect(row!.details).toMatchObject({ controlId: "incident-response-plan" });
    // The rendered document itself never lands in the audit trail.
    expect(JSON.stringify(row!.details).length).toBeLessThan(200);
  });

  it("is org-scoped — each tenant renders its own name", async () => {
    const { agent: ispn } = await login(ctx.app, { username: "director" });
    const { agent: platform } = await login(ctx.app, {
      orgCode: "DOCTURN",
      username: "dev",
    });
    const ispnOrg = await ctx.storage.getOrganization(ctx.seedResult.orgId);
    const platformOrg = await ctx.storage.getOrganization(
      ctx.seedResult.platformOrgId,
    );

    const a = await ispn.get("/api/compliance/policies/baa-hosting").expect(200);
    const b = await platform
      .get("/api/compliance/policies/baa-hosting")
      .expect(200);
    expect(a.body.markdown).toContain(ispnOrg!.name);
    expect(a.body.markdown).not.toContain(platformOrg!.name);
    expect(b.body.markdown).toContain(platformOrg!.name);
  });
});

describe("policy pack — evidence pack integration", () => {
  it("adds a policyPack section listing template + attestation coverage, without bodies", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    await agent
      .patch("/api/compliance/attestation")
      .send({ controlId: "workforce-training", status: "met", owner: "HR" })
      .expect(200);

    const res = await agent.get("/api/compliance/evidence").expect(200);
    const pack = res.body.policyPack as {
      note: string;
      manualControls: number;
      templatesAvailable: number;
      attested: number;
      policies: Array<{
        controlId: string;
        title: string;
        hasTemplate: boolean;
        attested: boolean;
        attestationStatus: string | null;
        actionRequired: string;
      }>;
    };
    expect(pack).toBeTruthy();
    expect(pack.manualControls).toBe(MANUAL.length);
    expect(pack.templatesAvailable).toBe(MANUAL.length);
    expect(pack.attested).toBe(1);
    expect(pack.policies).toHaveLength(MANUAL.length);
    expect(pack.policies.every((p) => p.hasTemplate)).toBe(true);
    expect(
      pack.policies.find((p) => p.controlId === "workforce-training")!
        .attestationStatus,
    ).toBe("met");

    // Metadata only — the bodies would swamp the pack and are not evidence.
    const raw = JSON.stringify(pack);
    expect(raw).not.toContain("## 1. Purpose");
    expect(raw.length).toBeLessThan(12000);
  });

  it("keeps the evidence pack PHI-free and keeps its limitations section", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
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
    expect(res.body.scopeAndLimitations).toBeTruthy();
    expect(res.body.scopeAndLimitations.limitations.length).toBeGreaterThan(4);
    expect(res.body.phiStatement).toMatch(/no protected health information/i);
    expect(raw).not.toContain('"resourceId"');
  });
});
