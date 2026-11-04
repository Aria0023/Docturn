import { beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { sql } from "drizzle-orm";
import { createApp } from "../server/app.js";
import { invalidateModules, setModule } from "../server/modules.js";
import { SAFE_DETAIL_STRING_KEYS, safeDetails } from "../server/compliance/audit-export.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * Audit export, enterprise form (E2, module `enterprise.auditExport`).
 *
 * The LEGACY form (`?trail=…&scope=…`, the Compliance screen's Export CSV
 * button) is untouched and ungated — regressing it would take the trail away
 * from every org. The enterprise form is recognised by `from` / `to` /
 * `format` / `orgId`: a date range, CSV **or** JSON, streamed, PHI-free
 * columns only, a director's own org or a developer's cross-tenant read
 * (audited on the TARGET org), rate-limited, and 404 while the module is off.
 */

const text = (req: supertest.Test) =>
  req.buffer(true).parse((r, cb) => {
    let d = "";
    r.setEncoding("utf8");
    r.on("data", (c: string) => (d += c));
    r.on("end", () => cb(null, d));
  });

describe("audit export — PHI-free detail projection", () => {
  it("keeps numbers, booleans and allow-listed strings; omits free text and names the omitted keys", () => {
    const out = safeDetails({
      serviceId: 7,
      enabled: true,
      role: "director",
      name: "Dr. Mary Patient-Name",
      description: "a free-text note",
      changed: { assignmentTimeoutMin: 12 },
      error: "ECONNREFUSED 10.0.0.1",
      fields: ["room", "admittedAt"],
      recipients: [3, 4, 5],
      nothing: null,
    });
    expect(out.kept).toEqual({
      serviceId: "7",
      enabled: "true",
      role: "director",
      fields: "room|admittedAt",
      recipients: "3|4|5",
      nothing: "",
    });
    expect(out.omitted.sort()).toEqual(["changed", "description", "error", "name"]);
  });

  it("the allow-list carries no free-text key", () => {
    for (const k of ["name", "description", "value", "changed", "error", "label", "onCall", "awayMessage", "message", "body"]) {
      expect(SAFE_DETAIL_STRING_KEYS).not.toContain(k);
    }
  });
});

describe("audit export — enterprise form", () => {
  let ctx: TestContext;
  let orgId: number;
  beforeEach(async () => {
    ctx = await createTestApp();
    orgId = ctx.seedResult.orgId;
    invalidateModules();
  });

  const turnOn = async () => {
    await setModule(orgId, "enterprise.auditExport", true);
    invalidateModules();
  };

  it("is 404 module_disabled while enterprise.auditExport is off — and the legacy form still works", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const off = await agent.get("/api/audit/export?trail=audit&format=json");
    expect(off.status).toBe(404);
    expect(off.body).toMatchObject({ error: "module_disabled", module: "enterprise.auditExport" });

    const legacy = await text(agent.get("/api/audit/export?trail=audit&scope=org"));
    expect(legacy.status).toBe(200);
    expect(legacy.headers["content-type"]).toMatch(/text\/csv/);
    expect(String(legacy.body)).toMatch(/occurred_at_utc/);
  });

  it("streams JSON with PHI-free columns and an allow-listed details projection", async () => {
    await turnOn();
    await ctx.storage.appendAudit({
      organizationId: orgId,
      userId: ctx.seedResult.userIds.director!,
      action: "test.export_probe",
      resourceType: "organization",
      resourceId: orgId,
      details: { serviceId: 3, name: "Ward B (free text)", enabled: true },
      riskLevel: "medium",
    });
    const { agent } = await login(ctx.app, { username: "director" });
    const res = await text(agent.get("/api/audit/export?trail=audit&format=json"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    // Streamed: no up-front length, and it says so.
    expect(res.headers["content-length"]).toBeUndefined();
    expect(res.headers["x-export-streamed"]).toBe("1");
    const body = JSON.parse(String(res.body));
    expect(body.trail).toBe("audit");
    expect(body.organization).toMatchObject({ id: orgId, code: "ISPN" });
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rowCount).toBe(body.rows.length);
    const probe = body.rows.find((r: any) => r.action === "test.export_probe");
    expect(probe).toBeTruthy();
    // Both formats carry the SAME declared columns, so `details` is the one
    // rendered "k=v; k=v" cell in JSON too (sorted keys — diffable exports).
    expect(probe.details).toBe("enabled=true; serviceId=3");
    expect(probe.details_omitted).toBe("name");
    expect(JSON.stringify(body)).not.toContain("free text");
    // Columns are the declared PHI-free set — nothing else leaks in.
    expect(Object.keys(probe).sort()).toEqual([...body.columns].sort());
  });

  it("honours a from/to day range (inclusive) in CSV", async () => {
    await turnOn();
    const row = async (action: string, createdAt: Date) => {
      const stored = await ctx.storage.appendAudit({
        organizationId: orgId,
        userId: null,
        action,
        resourceType: null,
        resourceId: null,
        details: {},
        riskLevel: "low",
      });
      await ctx.handle.db.execute(
        sql`UPDATE audit_logs SET created_at = ${createdAt.toISOString()} WHERE id = ${stored!.id}`,
      );
    };
    await row("test.old", new Date("2026-01-05T12:00:00Z"));
    await row("test.inside", new Date("2026-02-10T23:30:00Z"));
    await row("test.newer", new Date("2026-03-01T00:30:00Z"));

    const { agent } = await login(ctx.app, { username: "director" });
    const res = await text(agent.get("/api/audit/export?trail=audit&from=2026-02-01&to=2026-02-10"));
    expect(res.status).toBe(200);
    const csv = String(res.body);
    expect(csv).toContain("test.inside");
    expect(csv).not.toContain("test.old");
    expect(csv).not.toContain("test.newer");
    // Oldest first, one header line.
    expect(csv.split("\r\n")[0]).toMatch(/^"occurred_at_utc"/);
  });

  it("refuses a malformed range / format / trail", async () => {
    await turnOn();
    const { agent } = await login(ctx.app, { username: "director" });
    for (const q of [
      "trail=audit&format=xml",
      "trail=audit&from=not-a-date",
      "trail=audit&from=2026-03-02&to=2026-03-01",
      "trail=system&format=json",
    ]) {
      const res = await agent.get("/api/audit/export?" + q);
      expect([400], q).toContain(res.status);
    }
  });

  it("is director-and-up only: a hospitalist is refused even for their own rows", async () => {
    await turnOn();
    const { agent } = await login(ctx.app, { username: "chen" });
    expect((await agent.get("/api/audit/export?trail=audit&format=json")).status).toBe(403);
    // …and the legacy own-rows export still works for them.
    const mine = await text(agent.get("/api/audit/export?trail=audit&scope=mine"));
    expect(mine.status).toBe(200);
  });

  it("a developer exports another tenant; the read is audited on THAT tenant at high risk", async () => {
    await turnOn();
    await setModule(ctx.seedResult.platformOrgId, "enterprise.auditExport", true);
    invalidateModules();
    const { agent: dev } = await login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
    const res = await text(dev.get(`/api/audit/export?trail=audit&format=json&orgId=${orgId}`));
    expect(res.status).toBe(200);
    expect(JSON.parse(String(res.body)).organization.id).toBe(orgId);

    const rows = await ctx.storage.listAuditLogs(orgId, 20);
    const audited = rows.find((r) => r.action === "audit.export");
    expect(audited).toBeTruthy();
    expect(audited!.riskLevel).toBe("high");
    expect(audited!.details).toMatchObject({ crossTenant: true, operatorOrganizationId: ctx.seedResult.platformOrgId });
  });

  it("a director cannot name another tenant", async () => {
    await turnOn();
    const other = await ctx.storage.createOrganization({
      name: "Other", code: "OTHX", city: null, state: null, timezone: "America/New_York",
      assignmentTimeoutMin: 10, roundRobinShiftTypes: ["day"], rotationMode: "lowest_census", rotationIndex: 0,
    });
    const { agent } = await login(ctx.app, { username: "director" });
    expect((await agent.get(`/api/audit/export?trail=audit&format=json&orgId=${other.id}`)).status).toBe(403);
  });

  it("the PHI trail exports without user agents or free text, and counts its rows", async () => {
    await turnOn();
    await ctx.storage.logPhiAccess({
      organizationId: orgId,
      userId: ctx.seedResult.userIds.chen!,
      resource: "conversation-messages",
      resourceId: 9,
      patientId: ctx.seedResult.patientIds.sc,
      method: "GET",
      ip: "10.1.2.3",
      userAgent: "probe/1.0",
    });
    const { agent } = await login(ctx.app, { username: "director" });
    const res = await text(agent.get("/api/audit/export?trail=phi&format=json"));
    expect(res.status).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.rowCount).toBeGreaterThan(0);
    expect(body.columns).not.toContain("user_agent");
    const row = body.rows.find((r: any) => Number(r.resource_id) === 9);
    expect(row).toMatchObject({ method: "GET", resource: "conversation-messages", ip: "10.1.2.3" });
    expect(String(row.patient_id)).toBe(String(ctx.seedResult.patientIds.sc));
  });

  it("is rate-limited when the deployment has limiters on", async () => {
    await turnOn();
    const limited = createApp({ sessionSecret: "test-secret", rateLimiting: true, rateLimitStore: "memory" });
    const agent = supertest.agent(limited);
    await agent.post("/api/login").send({ orgCode: "ISPN", username: "director", password: "docturn" }).expect(200);
    let last = 200;
    for (let i = 0; i < 25 && last === 200; i++) {
      last = (await text(agent.get("/api/audit/export?trail=audit&format=json"))).status;
    }
    expect(last).toBe(429);
  });
});
